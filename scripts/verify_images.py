#!/usr/bin/env python3
"""Post-hoc gemini-vision audit for the latest gen_card_images_codex.py batch.

Reads <data_dir>/image_done.txt and for any nid not yet in
<data_dir>/image_verified.jsonl, runs `gemini -m gemini-3-pro-preview
-p "@<staged_image> ..."` with a structured JSON prompt to classify
whether the JPEG (a) illustrates the target word and (b) shows visible
English text. Results land in image_verified.jsonl and the reject set
is auto-remediated via `--apply`: PATCH /api/notes/{nid} clears the
Image field, rm the orphan JPEG, drop nid from image_done.txt — so the
next codex run will re-roll those cards from scratch.

Profile-driven: pass `--profile decks/<name>.json` to verify a deck
other than the TOEIC default. Image-field index, data directory, and
notetype come from the profile.

Idempotent — re-runs only un-verified nids. Tolerant — gemini timeouts
default to a permissive 'unknown' verdict (kept rather than rejected).

Usage:
    ./scripts/verify_images.py                                    # TOEIC default, dry-run
    ./scripts/verify_images.py --profile sesame                   # Sesame, dry-run
    ./scripts/verify_images.py --profile sesame --apply           # Sesame, remediate rejects
    ./scripts/verify_images.py --profile sesame --limit 5         # only first 5 pending
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _profile import DeckProfile, default_toeic_profile, load_profile  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
MEDIA_DIR = REPO_ROOT / "data" / "collection.media"
# gemini CLI v0.40 enforces TWO layered file-access guards on `@/path`:
#   (1) Workspace boundary — paths must resolve under either the cwd's
#       project root or `~/.gemini/tmp/<project>/`. /tmp/* is rejected
#       with "Path not in workspace".
#   (2) Ignore patterns — within the workspace, .gitignore'd paths are
#       blocked with "ignored by configured ignore patterns" because
#       gemini reuses gitignore as its tool ignore list. Our
#       `data/collection.media/` is gitignored (Anki convention), so
#       direct @ references silently bail with "I cannot directly
#       access" model apologies. Workaround: stage each image under
#       the project tmp dir, which satisfies both guards.
GEMINI_PROJECT_TMP = Path.home() / ".gemini" / "tmp" / "ferdinand"

DEFAULT_BASE = "http://127.0.0.1:40001"
GEMINI_TIMEOUT_S = 180
GEMINI_MODEL_DEFAULT = "gemini-3-pro-preview"

JSON_RE = re.compile(r"\{[^{}]*\}", re.DOTALL)

VERIFY_PROMPT = """\
@{path}

For the vocabulary word '{front}' (definition: {back}), evaluate this image. Respond with EXACTLY one JSON object on one line, no prose:
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


def load_done_nids(path: Path) -> list[int]:
    if not path.exists():
        return []
    return [int(ln.strip()) for ln in path.read_text().splitlines() if ln.strip()]


def load_verified(path: Path) -> dict[int, dict]:
    if not path.exists():
        return {}
    out = {}
    for ln in path.read_text().splitlines():
        if not ln.strip():
            continue
        v = json.loads(ln)
        out[v["nid"]] = v
    return out


def fetch_note(base: str, nid: int) -> dict:
    return http_get_json(f"{base}/api/notes/{nid}")


def gemini_verify(image_path: Path, front: str, back: str, model: str) -> dict:
    """Run gemini @file vision check via gemini-3-pro-preview. Returns a
    verdict dict on success, or {'verdict_status': '<reason>', ...} on
    timeout/parse failure (caller treats those as 'unknown' = keep)."""
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
            ["gemini", "-m", model, "-p", prompt],
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
    """Reject policy: visible English text OR score ≤ 1 OR fits=false.
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
    ap.add_argument("--profile", default=None,
                    help="path or shorthand for deck profile (e.g. 'sesame'). "
                         "Default = legacy TOEIC vocab paths + Concept-Deep notetype.")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--model", default=GEMINI_MODEL_DEFAULT,
                    help=f"override gemini -m (default: {GEMINI_MODEL_DEFAULT})")
    ap.add_argument("--apply", action="store_true",
                    help="actually PATCH+rm rejected nids; without it just prints verdict")
    ap.add_argument("--limit", type=int, default=None,
                    help="cap pending verifications this run")
    args = ap.parse_args()

    profile = load_profile(args.profile) if args.profile else default_toeic_profile()
    print(f"[verify] profile={profile.name} model={args.model} apply={args.apply}", flush=True)

    done_nids = load_done_nids(profile.image_done)
    verified_path = profile.data_dir / "image_verified.jsonl"
    verified = load_verified(verified_path)
    pending = [n for n in done_nids if n not in verified]
    if args.limit:
        pending = pending[: args.limit]
    print(f"[verify] {len(pending)} nids to verify  (already_verified={len(verified)} "
          f"of done={len(done_nids)})", flush=True)
    if not pending:
        return 0

    rejects: list[tuple[int, str, str, dict]] = []
    keeps = 0
    unknowns = 0

    verified_path.parent.mkdir(parents=True, exist_ok=True)
    with verified_path.open("a", encoding="utf-8") as vf:
        for i, nid in enumerate(pending, 1):
            try:
                note = fetch_note(args.base, nid)
            except Exception as e:  # noqa: BLE001
                print(f"  [{i}/{len(pending)}] nid={nid} note fetch failed: {e}", flush=True)
                continue
            front = note["fields"][0]
            back = note["fields"][1]
            filename = note["fields"][profile.image_field_idx]
            if not filename:
                print(f"  [{i}/{len(pending)}] nid={nid} {front:18} Image field empty (already cleared?), skipping",
                      flush=True)
                continue
            image_path = MEDIA_DIR / filename
            if not image_path.exists():
                print(f"  [{i}/{len(pending)}] nid={nid} {front:18} file missing: {filename}", flush=True)
                continue

            verdict = gemini_verify(image_path, front, back, args.model)
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
                fields[profile.image_field_idx] = ""
                http_patch_json(f"{args.base}/api/notes/{nid}",
                                {"fields": fields, "tags": note["tags"]})
                print(f"  cleared nid={nid} ({front})")
            except Exception as e:  # noqa: BLE001
                print(f"  PATCH FAIL nid={nid}: {e}")
            f = MEDIA_DIR / filename
            if f.exists():
                f.unlink()
        keep_lines = [ln for ln in profile.image_done.read_text().splitlines()
                      if ln.strip() and int(ln.strip()) not in reject_nids]
        profile.image_done.write_text(
            "\n".join(keep_lines) + ("\n" if keep_lines else ""), encoding="utf-8"
        )
        print(f"  image_done.txt now {len(keep_lines)} nids")
    elif rejects:
        print(f"\n[verify] rejects identified — re-run with --apply to remediate")

    return 0


if __name__ == "__main__":
    sys.exit(main())
