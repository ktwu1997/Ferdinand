#!/usr/bin/env python3
"""Backfill Studio-Ghibli-styled images via codex CLI, profile-aware.

Pipeline per pending note:
  1. gemini-3-pro-preview classifies the word and proposes a Ghibli-friendly
     `{concrete: bool, scene: str, anchor: str}`. Abstract verdicts skip.
  2. Wrap scene + anchor into a fixed Ghibli 5-component template.
  3. Spawn `codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox`
     headless. Parse `session id: <uuid>` from banner. After exit, glob
     ~/.codex/generated_images/<sid>/*.png to recover the actual PNG (the
     SAVED stdout line is unreliable — the LLM sometimes hallucinates it).
  4. Verify file exists + size > 1 KB. PIL PNG → 800px-wide JPEG q=85.
  5. POST /media multipart upload → {filename, size_bytes}.
  6. PATCH /api/notes/{nid} with fields[8] swapped to that filename.

Notes:
  • Costs ChatGPT subscription quota (Plus/Pro), NOT API dollars.
  • Default --workers 1, --rate-sleep 20: image gen burns quota ~3-5x faster
    than text — pacing matters more than throughput.
  • Detects 'usage limit reached' in codex stderr/stdout → fail fast (no
    retry-storm).

Trackers (data/toeic/, all gitignored):
  • image_done.txt    one nid per line, idempotency
  • image_skip.txt    abstract verdicts (gemini said no)
  • image_fail.jsonl  {nid, front, stage, reason} per failure

Usage:
  ./scripts/gen_card_images_codex.py --limit 1                  # smoke test
  ./scripts/gen_card_images_codex.py --limit 10 --rate-sleep 30 # batch w/ pacing
  ./scripts/gen_card_images_codex.py                            # all pending
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from _profile import DeckProfile, default_toeic_profile, load_profile

REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_BASE = "http://127.0.0.1:40001"
GEMINI_MODEL_DEFAULT = "gemini-3-pro-preview"
GEMINI_TIMEOUT_S = 90  # 3-pro-preview is slower than 2.5-flash
CODEX_TIMEOUT_S = 300

CODEX_HOME = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
CODEX_GEN_DIR = CODEX_HOME / "generated_images"

SAFE_NAME_RE = re.compile(r"[^a-z0-9]+")
SESSION_ID_RE = re.compile(r"session id: ([0-9a-f-]{36})")
QUOTA_EXHAUSTED_RE = re.compile(r"usage limit reached|quota.{0,20}exhausted", re.IGNORECASE)
JSON_OBJECT_RE = re.compile(r"\{[^{}]*\}", re.DOTALL)


CLASSIFY_PROMPT = """\
You are designing illustrations for vocabulary cards in the
hand-painted Studio Ghibli style — soft cinematic lighting, warm
painterly textures, characters with rounded Miyazaki-style faces, no
text or signage of any kind.

Word: {front}
Definition: {back}

Decide whether this word can be illustrated as a concrete scene a viewer
would understand without reading text (e.g. "warehouse", "negotiate",
"contract", "ratify"), or whether it is too abstract / functional to
illustrate meaningfully (e.g. "nonetheless", "albeit", "thereby",
"predominantly", "customarily").

If concrete, propose ONE Ghibli scene that would let a learner remember
the word's meaning. Return TWO short fields:
  • scene  – the setting + characters in one phrase (e.g. "a sunlit
    boardroom mid-meeting" / "a logistics warehouse at golden hour" /
    "a quiet courthouse hallway with two clerks comparing documents")
  • anchor – the SINGLE specific visual element that distinguishes
    THIS word from its closest semantically-near confusable (e.g. for
    `quorum`: "exactly five empty chairs at the far end with leather
    portfolios untouched" — the empty seats are the semantic core; for
    `indemnification`: "a hand sliding forward a sealed envelope while
    a damaged shipping crate sits at the table edge")

Respond with EXACTLY one JSON object on a single line, no prose:
  {{"concrete": true, "scene": "...", "anchor": "..."}}
or
  {{"concrete": false, "reason": "..."}}
"""


GHIBLI_TEMPLATE = """\
A hand-painted illustration in the lush style of Studio Ghibli. {scene}.
{anchor}. Soft painterly textures, dappled warm afternoon light, dust
motes floating in the sunbeams, gentle Miyazaki-style character faces,
warm cinematic atmosphere. 16:9 landscape composition, color-graded
warm-neutral.

Negative: no text, no signs, no logos, no captions, no English words, \
no Japanese kanji or kana, no labels, no numbers, no brand marks, \
no decorative typography, no whiteboards with writing, no scrabble tiles.
"""


CODEX_INSTRUCTION_PREFIX = """\
Use the $imagegen skill to generate an image and save it to {target}.

Image:
{ghibli_prompt}

After saving, print exactly one line: SAVED: <absolute path>
"""


# ---------------------------------------------------------------------------
# HTTP helpers (urllib — no extra deps)
# ---------------------------------------------------------------------------


def http_get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.loads(r.read())


def http_patch_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="PATCH"
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


# ---------------------------------------------------------------------------
# Trackers
# ---------------------------------------------------------------------------


def load_tracker(path: Path) -> set[int]:
    if not path.exists():
        return set()
    return {int(ln) for ln in path.read_text().splitlines() if ln.strip().isdigit()}


def resolve_notetype_id(base: str, name: str) -> int:
    data = http_get_json(f"{base}/api/notetypes")
    for nt in data.get("notetypes", []):
        if nt["name"] == name:
            return nt["id"]
    raise RuntimeError(f"notetype {name!r} not found on server {base}")


# ---------------------------------------------------------------------------
# Note enumeration — profile-aware (cache + image-field index from profile)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PendingCard:
    nid: int
    front: str
    back: str
    fields: tuple[str, ...]
    tags: tuple[str, ...]


def enumerate_pending(
    base: str, profile: DeckProfile, refresh_cache: bool
) -> list[PendingCard]:
    notetype_id = resolve_notetype_id(base, profile.notetype)

    cached: dict[str, dict] = {}
    if profile.image_map.exists() and not refresh_cache:
        cached = json.loads(profile.image_map.read_text())

    # /api/cards caps limit at 500; paginate via offset until exhausted.
    nids: set[int] = set()
    offset = 0
    page_size = 500
    while True:
        resp = http_get_json(
            f"{base}/api/cards?q=mid:{notetype_id}"
            f"&limit={page_size}&offset={offset}"
        )
        page = resp.get("cards", [])
        if not page:
            break
        nids.update(c["note_id"] for c in page)
        if len(page) < page_size:
            break
        offset += page_size
    nids = sorted(nids)

    fresh: dict[str, dict] = {}
    for nid in nids:
        meta = cached.get(str(nid))
        if not meta:
            note = http_get_json(f"{base}/api/notes/{nid}")
            meta = {
                "front": note["fields"][0],
                "back": note["fields"][1],
                "fields": note["fields"],
                "tags": note.get("tags", []),
            }
        fresh[str(nid)] = meta

    profile.image_map.parent.mkdir(parents=True, exist_ok=True)
    profile.image_map.write_text(json.dumps(fresh, ensure_ascii=False, indent=2))

    idx = profile.image_field_idx
    pending: list[PendingCard] = []
    for nid_str, meta in fresh.items():
        if not (meta["fields"][idx] or "").strip():
            pending.append(
                PendingCard(
                    nid=int(nid_str),
                    front=meta["front"],
                    back=meta["back"],
                    fields=tuple(meta["fields"]),
                    tags=tuple(meta["tags"]),
                )
            )
    return pending


# ---------------------------------------------------------------------------
# Classifier (gemini-3-pro-preview)
# ---------------------------------------------------------------------------


def gemini_classify(front: str, back: str, model: str) -> dict:
    prompt = CLASSIFY_PROMPT.format(front=front, back=back)
    proc = subprocess.run(
        ["gemini", "-m", model, "-p", prompt],
        capture_output=True,
        text=True,
        timeout=GEMINI_TIMEOUT_S,
        stdin=subprocess.DEVNULL,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"gemini exit {proc.returncode}: {proc.stderr.strip()[:300]}")
    text = proc.stdout.strip()
    # Try fenced JSON first, then any inline {…}.
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        return json.loads(fence.group(1))
    inline = JSON_OBJECT_RE.search(text)
    if inline:
        return json.loads(inline.group(0))
    raise ValueError(f"no JSON object found in gemini output: {text[:200]!r}")


# ---------------------------------------------------------------------------
# Image generator (codex CLI $imagegen)
# ---------------------------------------------------------------------------


class QuotaExhausted(RuntimeError):
    """Raised when codex returns 'usage limit reached'."""


def codex_image_gen(scene: str, anchor: str, target_path: Path) -> Path:
    """Run codex headless, recover the PNG via session-id glob, return its Path.

    The 'SAVED:' stdout line is unreliable — gpt-5.5 sometimes prints it
    even on failure (hallucination), and sometimes doesn't print it on
    success. We trust ~/.codex/generated_images/<sid>/*.png as the only
    file-system witness, then verify size > 1 KB.
    """
    ghibli_prompt = GHIBLI_TEMPLATE.format(scene=scene, anchor=anchor)
    prompt = CODEX_INSTRUCTION_PREFIX.format(
        target=target_path.as_posix(), ghibli_prompt=ghibli_prompt
    )
    target_path.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            "codex",
            "exec",
            "--skip-git-repo-check",
            "--dangerously-bypass-approvals-and-sandbox",
            "-C",
            target_path.parent.as_posix(),
            prompt,
        ],
        capture_output=True,
        text=True,
        timeout=CODEX_TIMEOUT_S,
        stdin=subprocess.DEVNULL,
    )
    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    if QUOTA_EXHAUSTED_RE.search(combined):
        raise QuotaExhausted("codex usage limit reached — pause + check /status")
    if proc.returncode != 0:
        raise RuntimeError(
            f"codex exit {proc.returncode}: {proc.stderr.strip()[-300:]}"
        )

    # Prefer the file codex copied to target_path (model behaves correctly
    # ~70% of the time). Fall back to session-id glob otherwise.
    if target_path.exists() and target_path.stat().st_size > 1024:
        return target_path

    sid_match = SESSION_ID_RE.search(proc.stdout)
    if not sid_match:
        raise RuntimeError("no session id in codex banner — skill may not have loaded")
    sid = sid_match.group(1)
    sid_dir = CODEX_GEN_DIR / sid
    pngs = sorted(sid_dir.glob("*.png"), key=lambda p: p.stat().st_mtime)
    if not pngs:
        raise RuntimeError(f"codex emitted no PNG into {sid_dir}")
    src = pngs[-1]
    if src.stat().st_size < 1024:
        raise RuntimeError(f"codex PNG under 1 KB: {src}")
    shutil.copy2(src, target_path)
    return target_path


# ---------------------------------------------------------------------------
# Image post-processing + Anki upload (mirrors gen_card_images.py)
# ---------------------------------------------------------------------------


def png_to_jpeg(png_path: Path, max_width: int = 800) -> bytes:
    img = Image.open(png_path)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    if img.width > max_width:
        ratio = max_width / img.width
        new_size = (max_width, max(1, int(img.height * ratio)))
        img = img.resize(new_size, Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85, optimize=True)
    return buf.getvalue()


def build_filename(front: str, prefix: str) -> str:
    slug = SAFE_NAME_RE.sub("_", front.lower()).strip("_") or "card"
    return f"{prefix}_{slug}.jpg"


def upload_media(base: str, filename: str, jpeg_bytes: bytes) -> dict:
    boundary = f"----ferdinand{secrets.token_hex(8)}"
    body = io.BytesIO()
    body.write(f"--{boundary}\r\n".encode())
    body.write(
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode()
    )
    body.write(b"Content-Type: image/jpeg\r\n\r\n")
    body.write(jpeg_bytes)
    body.write(f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        f"{base}/media",
        data=body.getvalue(),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def patch_image_field(
    base: str,
    nid: int,
    fields: tuple[str, ...],
    tags: tuple[str, ...],
    filename: str,
    image_field_idx: int,
) -> dict:
    new_fields = list(fields)
    new_fields[image_field_idx] = filename
    return http_patch_json(
        f"{base}/api/notes/{nid}",
        {"fields": new_fields, "tags": list(tags)},
    )


# ---------------------------------------------------------------------------
# Per-card pipeline
# ---------------------------------------------------------------------------


def process_one(
    card: PendingCard,
    base: str,
    model: str,
    work_dir: Path,
    profile: DeckProfile,
    write_lock: threading.Lock,
    file_handles: dict,
) -> tuple[str, int, str]:
    nid = card.nid
    front = card.front
    try:
        verdict = gemini_classify(front, card.back, model)
        if not verdict.get("concrete"):
            with write_lock:
                file_handles["skip"].write(f"{nid}\n")
                file_handles["skip"].flush()
            return ("skip", nid, verdict.get("reason", "")[:120])

        scene = (verdict.get("scene") or "").strip()
        anchor = (verdict.get("anchor") or "").strip()
        if not scene or not anchor:
            raise RuntimeError("concrete verdict missing scene/anchor")

        slug = SAFE_NAME_RE.sub("_", front.lower()).strip("_") or "card"
        png_target = work_dir / f"{profile.image_filename_prefix}_{slug}.png"
        png_path = codex_image_gen(scene, anchor, png_target)

        jpeg = png_to_jpeg(png_path)
        filename = build_filename(front, profile.image_filename_prefix)
        upload = upload_media(base, filename, jpeg)
        stored = upload["filename"]
        patch_image_field(
            base, nid, card.fields, card.tags, stored, profile.image_field_idx
        )

        with write_lock:
            file_handles["done"].write(f"{nid}\n")
            file_handles["done"].flush()
        return ("ok", nid, f"{stored}  scene='{scene[:40]}…'")

    except QuotaExhausted as exc:
        with write_lock:
            file_handles["fail"].write(json.dumps({
                "nid": nid, "front": front,
                "stage": "QuotaExhausted", "reason": str(exc),
            }, ensure_ascii=False) + "\n")
            file_handles["fail"].flush()
        raise

    except Exception as exc:  # noqa: BLE001 — driver must keep going
        with write_lock:
            file_handles["fail"].write(json.dumps({
                "nid": nid, "front": front,
                "stage": type(exc).__name__,
                "reason": str(exc)[:300],
            }, ensure_ascii=False) + "\n")
            file_handles["fail"].flush()
        return ("fail", nid, str(exc)[:160])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--profile", default=None,
                    help="deck profile name or path (decks/<name>.json); "
                         "default = legacy TOEIC profile (data/toeic, Concept-Deep)")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--model", default=GEMINI_MODEL_DEFAULT)
    ap.add_argument("--limit", type=int, default=None,
                    help="cap pending notes (use small N for first try)")
    ap.add_argument("--workers", type=int, default=1,
                    help="parallel codex calls; default 1 to spread quota")
    ap.add_argument("--rate-sleep", type=float, default=20.0,
                    help="seconds to sleep between codex submissions (serial mode)")
    ap.add_argument("--refresh-cache", action="store_true",
                    help="rescan collection instead of trusting <data_dir>/image_map.json")
    ap.add_argument("--work-dir", default="/tmp/codex_imagegen",
                    help="staging dir for codex PNG outputs before resize")
    ap.add_argument("--only", default=None,
                    help="process only this Front (single-word smoke test)")
    return ap.parse_args()


def main() -> int:
    args = parse_args()
    profile = load_profile(args.profile) if args.profile else default_toeic_profile()
    work_dir = Path(args.work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    profile.data_dir.mkdir(parents=True, exist_ok=True)

    print(
        f"[init] profile={profile.name} notetype={profile.notetype} "
        f"base={args.base} model={args.model} workers={args.workers} "
        f"rate-sleep={args.rate_sleep}s",
        flush=True,
    )

    pending = enumerate_pending(args.base, profile, refresh_cache=args.refresh_cache)
    done = load_tracker(profile.image_done)
    skip = load_tracker(profile.image_skip)
    pending = [c for c in pending if c.nid not in done and c.nid not in skip]
    print(f"[init] {len(pending)} pending  (done={len(done)} skip={len(skip)})", flush=True)

    if args.only:
        pending = [c for c in pending if c.front.lower() == args.only.lower()]
        if not pending:
            sys.exit(f"--only {args.only!r} not found in pending list")

    if args.limit:
        pending = pending[: args.limit]
        print(f"[init] capped to first {len(pending)} for this run", flush=True)
    if not pending:
        print("[init] nothing to do")
        return 0

    write_lock = threading.Lock()
    ok = sk = fl = 0
    quota_hit = False

    with profile.image_done.open("a", encoding="utf-8") as fdone, \
         profile.image_skip.open("a", encoding="utf-8") as fskip, \
         profile.image_fail.open("a", encoding="utf-8") as ffail:
        handles = {"done": fdone, "skip": fskip, "fail": ffail}

        if args.workers <= 1:
            for i, card in enumerate(pending):
                if i > 0:
                    time.sleep(args.rate_sleep)
                try:
                    status, nid, detail = process_one(
                        card, args.base, args.model, work_dir, profile, write_lock, handles
                    )
                except QuotaExhausted as exc:
                    print(f"\n[QUOTA] {exc} — bailing on remaining {len(pending) - i} cards", flush=True)
                    quota_hit = True
                    break
                marker = {"ok": "  ok  ", "skip": " skip ", "fail": " FAIL "}[status]
                print(f"  {marker} nid={nid:<14} {card.front:18} {detail}", flush=True)
                if status == "ok":
                    ok += 1
                elif status == "skip":
                    sk += 1
                else:
                    fl += 1
        else:
            with ThreadPoolExecutor(max_workers=args.workers) as pool:
                futures = {
                    pool.submit(process_one, c, args.base, args.model, work_dir, profile, write_lock, handles): c
                    for c in pending
                }
                for fut in as_completed(futures):
                    try:
                        status, nid, detail = fut.result()
                    except QuotaExhausted as exc:
                        print(f"\n[QUOTA] {exc} — cancelling remaining workers", flush=True)
                        quota_hit = True
                        for f in futures:
                            f.cancel()
                        break
                    front = futures[fut].front
                    marker = {"ok": "  ok  ", "skip": " skip ", "fail": " FAIL "}[status]
                    print(f"  {marker} nid={nid:<14} {front:18} {detail}", flush=True)
                    if status == "ok":
                        ok += 1
                    elif status == "skip":
                        sk += 1
                    else:
                        fl += 1

    print(f"\n[done] ok={ok}  skip={sk}  fail={fl}  total={len(pending)}"
          + ("  (quota-truncated)" if quota_hit else ""))
    return 0 if (fl == 0 and not quota_hit) else 1


if __name__ == "__main__":
    sys.exit(main())
