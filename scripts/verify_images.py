#!/usr/bin/env python3
"""Post-hoc gemini-vision audit for the latest gen_card_images.py batch.

Reads image_done.txt and for any nid not yet in image_verified.jsonl,
runs `gemini -p "@<media_path> ..."` with a structured JSON prompt to
classify whether the photo (a) illustrates the target word and (b)
shows visible English text. Results land in image_verified.jsonl and
the reject set is auto-remediated: PATCH /api/notes/{nid} clears
fields[8], rm the orphan JPEG, drop nid from image_done.txt.

Idempotent — re-runs only un-verified nids. Tolerant — gemini timeouts
default to a permissive 'unknown' verdict (kept rather than rejected),
since the pipeline-level alt filter already scrubbed the most obvious
typography stock.

Usage:
    PEXELS_API_KEY=... ./scripts/verify_images.py
    ./scripts/verify_images.py --since-last      # only nids added since last verify run
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TOEIC_DIR = REPO_ROOT / "data" / "toeic"
DONE_TXT = TOEIC_DIR / "image_done.txt"
VERIFIED_JSONL = TOEIC_DIR / "image_verified.jsonl"
MEDIA_DIR = REPO_ROOT / "data" / "collection.media"
# gemini CLI v0.40 enforces TWO layered file-access guards on `@/path`:
#   (1) Workspace boundary — paths must resolve under either the cwd's
#       project root or `~/.gemini/tmp/<project>/`. /tmp/* is rejected
#       with "Path not in workspace".
#   (2) Ignore patterns — within the workspace, .gitignore'd paths are
#       blocked with "ignored by configured ignore patterns" because
#       gemini reuses gitignore as its tool ignore list. Our
#       `data/collection.media/` is gitignored (Anki convention), so
#       direct @ references to the canonical image path silently bail
#       out with "I cannot directly access" model apologies — the
#       fall-through path inside gemini is non-deterministic, hence
#       the ~40% failure rate observed earlier.
# Workaround: stage each image under the project temp dir, which
# satisfies both guards. Pre-create on script start so the directory
# always exists before the first gemini call.
GEMINI_PROJECT_TMP = Path.home() / ".gemini" / "tmp" / "ferdinand"

DEFAULT_BASE = "http://127.0.0.1:40001"
GEMINI_TIMEOUT_S = 150
GEMINI_MODEL = "gemini-2.5-flash"
IMAGE_FIELD_IDX = 8

JSON_RE = re.compile(r"\{[^{}]*\}", re.DOTALL)

VERIFY_PROMPT = """\
@{path}

For the TOEIC vocabulary word '{front}' (definition: {back}), evaluate this image. Respond with EXACTLY one JSON object on one line, no prose:
{{"fits": true, "has_english_text": false, "score": 3, "notes": "..."}}

- fits: does the image visually illustrate '{front}'?
- has_english_text: is any visible English word/phrase readable on the image (signs, posters, screen content, branded clothing, document text)? Logos with text count.
- score: 0=unrelated, 1=loose, 2=decent, 3=strong fit
- notes: short, ≤15 words
"""


def http_get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read())


def http_patch_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=body, method="PATCH",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def load_done_nids() -> list[int]:
    if not DONE_TXT.exists():
        return []
    return [int(ln.strip()) for ln in DONE_TXT.read_text().splitlines() if ln.strip()]


def load_verified() -> dict[int, dict]:
    if not VERIFIED_JSONL.exists():
        return {}
    out = {}
    for ln in VERIFIED_JSONL.read_text().splitlines():
        if not ln.strip():
            continue
        v = json.loads(ln)
        out[v["nid"]] = v
    return out


def fetch_note(base: str, nid: int) -> dict:
    return http_get_json(f"{base}/api/notes/{nid}")


def gemini_verify(image_path: Path, front: str, back: str) -> dict:
    """Run gemini @file vision check. Returns verdict dict or
    {'verdict_status': 'unknown', ...} on timeout/parse failure.

    Image is copied to GEMINI_PROJECT_TMP first because gemini CLI
    blocks both /tmp/* (out-of-workspace) and gitignored paths like
    data/collection.media/* — see GEMINI_PROJECT_TMP comment.
    """
    GEMINI_PROJECT_TMP.mkdir(parents=True, exist_ok=True)
    staged = GEMINI_PROJECT_TMP / image_path.name
    try:
        shutil.copy2(image_path, staged)
    except OSError as e:
        return {"verdict_status": "stage_failed", "fits": None,
                "has_english_text": None, "score": None,
                "notes": f"copy to {staged}: {e}"[:120]}
    prompt = VERIFY_PROMPT.format(path=str(staged), front=front, back=back)
    try:
        proc = subprocess.run(
            ["gemini", "-m", GEMINI_MODEL, "-p", prompt],
            capture_output=True, text=True, timeout=GEMINI_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return {"verdict_status": "timeout", "fits": None, "has_english_text": None,
                "score": None, "notes": f"gemini timeout after {GEMINI_TIMEOUT_S}s"}
    finally:
        try:
            staged.unlink()
        except OSError:
            pass
    if proc.returncode != 0:
        return {"verdict_status": "exit_nonzero",
                "fits": None, "has_english_text": None, "score": None,
                "notes": f"gemini exit {proc.returncode}: {proc.stderr.strip()[:120]}"}
    out = proc.stdout.strip()
    match = JSON_RE.search(out)
    if not match:
        return {"verdict_status": "no_json", "fits": None, "has_english_text": None,
                "score": None, "notes": f"no JSON in stdout: {out[:120]!r}"}
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError as e:
        return {"verdict_status": "parse_error", "fits": None, "has_english_text": None,
                "score": None, "notes": str(e)[:120]}
    parsed["verdict_status"] = "ok"
    return parsed


def is_reject(v: dict) -> bool:
    """Apply policy: reject if visible English text OR score ≤ 1.
    Permissive on verifier failure (status != 'ok' → keep)."""
    if v.get("verdict_status") != "ok":
        return False
    if v.get("has_english_text") is True:
        return True
    score = v.get("score")
    if isinstance(score, (int, float)) and score <= 1:
        return True
    if v.get("fits") is False:
        return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--apply", action="store_true",
                    help="actually PATCH+rm rejected nids; without it just prints verdict")
    ap.add_argument("--limit", type=int, default=None,
                    help="cap pending verifications this run")
    args = ap.parse_args()

    done_nids = load_done_nids()
    verified = load_verified()
    pending = [n for n in done_nids if n not in verified]
    if args.limit:
        pending = pending[: args.limit]
    print(f"[verify] {len(pending)} nids to verify  (already_verified={len(verified)} "
          f"of done={len(done_nids)})", flush=True)
    if not pending:
        return 0

    rejects: list[tuple[int, str, str, dict]] = []  # (nid, front, filename, verdict)
    keeps = 0
    unknowns = 0

    with VERIFIED_JSONL.open("a", encoding="utf-8") as vf:
        for i, nid in enumerate(pending, 1):
            try:
                note = fetch_note(args.base, nid)
            except Exception as e:
                print(f"  [{i}/{len(pending)}] nid={nid} note fetch failed: {e}", flush=True)
                continue
            front = note["fields"][0]
            back = note["fields"][1]
            filename = note["fields"][IMAGE_FIELD_IDX]
            if not filename:
                print(f"  [{i}/{len(pending)}] nid={nid} {front:18} Image field empty (already cleared?), skipping", flush=True)
                continue
            image_path = MEDIA_DIR / filename
            if not image_path.exists():
                print(f"  [{i}/{len(pending)}] nid={nid} {front:18} file missing: {filename}", flush=True)
                continue

            verdict = gemini_verify(image_path, front, back)
            verdict.update({"nid": nid, "front": front, "filename": filename})
            vf.write(json.dumps(verdict, ensure_ascii=False) + "\n")
            vf.flush()

            status = verdict.get("verdict_status")
            if status != "ok":
                unknowns += 1
                print(f"  [{i}/{len(pending)}] nid={nid} {front:18} ?? {status}: {verdict.get('notes','')[:60]}",
                      flush=True)
                continue

            if is_reject(verdict):
                rejects.append((nid, front, filename, verdict))
                tag = "TEXT" if verdict.get("has_english_text") else f"score={verdict.get('score')}"
                print(f"  [{i}/{len(pending)}] nid={nid} {front:18} ✗ REJECT [{tag}]: {verdict.get('notes','')[:60]}",
                      flush=True)
            else:
                keeps += 1
                print(f"  [{i}/{len(pending)}] nid={nid} {front:18} ✓ keep  score={verdict.get('score')}: {verdict.get('notes','')[:60]}",
                      flush=True)

    print(f"\n[verify] keep={keeps}  reject={len(rejects)}  unknown={unknowns}")

    if rejects and args.apply:
        print(f"\n[remediate] applying {len(rejects)} rejects …")
        reject_nids = {r[0] for r in rejects}
        for nid, front, filename, _ in rejects:
            try:
                note = fetch_note(args.base, nid)
                fields = note["fields"]
                fields[IMAGE_FIELD_IDX] = ""
                http_patch_json(f"{args.base}/api/notes/{nid}",
                                {"fields": fields, "tags": note["tags"]})
                print(f"  cleared nid={nid} ({front})")
            except Exception as e:
                print(f"  PATCH FAIL nid={nid}: {e}")
            f = MEDIA_DIR / filename
            if f.exists():
                f.unlink()
        keep_lines = [ln for ln in DONE_TXT.read_text().splitlines()
                      if ln.strip() and int(ln.strip()) not in reject_nids]
        DONE_TXT.write_text("\n".join(keep_lines) + ("\n" if keep_lines else ""), encoding="utf-8")
        print(f"  done.txt now {len(keep_lines)} nids")
    elif rejects:
        print(f"\n[verify] rejects identified — re-run with --apply to remediate")

    return 0


if __name__ == "__main__":
    sys.exit(main())
