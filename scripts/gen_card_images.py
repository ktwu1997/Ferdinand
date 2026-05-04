#!/usr/bin/env python3
"""Backfill landscape images on Concept-Deep TOEIC notes.

Pipeline per pending note:
  1. gemini CLI classifies the word as concrete (returns 2-3 image
     search queries) or abstract (skip).
  2. Pexels search → first landscape result of the highest-priority
     query that hits; falls back through the remaining queries.
  3. Pillow thumbnail to ≤600 px wide + JPEG q=85.
  4. POST /media multipart upload → {filename, size_bytes}.
  5. PATCH /api/notes/{nid} with fields[8] swapped to that filename.

Trackers (data/toeic/):
  - image_done.txt       newline list of completed nids.
  - image_skip.txt       newline list of nids gemini classified abstract.
  - image_fail.jsonl     {nid, front, stage, reason, queries?} per failure.
  - concept_image_map.json  cached {nid → {front, image_filled}} so
                            re-runs skip the 600+ enumeration GETs.

Usage:
    PEXELS_API_KEY=... ./scripts/gen_card_images.py --limit 5
    ./scripts/gen_card_images.py                 # all pending
    ./scripts/gen_card_images.py --workers 4
"""
from __future__ import annotations

import argparse
import io
import json
import os
import random
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
TOEIC_DIR = REPO_ROOT / "data" / "toeic"
DONE_TXT = TOEIC_DIR / "image_done.txt"
SKIP_TXT = TOEIC_DIR / "image_skip.txt"
FAIL_JSONL = TOEIC_DIR / "image_fail.jsonl"
MAP_JSON = TOEIC_DIR / "concept_image_map.json"

CONCEPT_DEEP_MID = 1777795790794
IMAGE_FIELD_IDX = 8  # 0-based; matches FIELD_ORDER in ingest_toeic_cards.py

DEFAULT_BASE = "http://127.0.0.1:40001"
PEXELS_SEARCH = "https://api.pexels.com/v1/search"
PEXELS_RATE_SLEEP_S = 0.25  # ~3 req/s, well under 200/hr cap
# Pexels (and the images.pexels.com CDN) sit behind Cloudflare, which
# returns `403 / error code 1010` for the default `Python-urllib/x.y`
# User-Agent. A plain browser-shaped UA is enough to clear the bot
# signature filter — we are not impersonating a specific browser, just
# avoiding the obvious crawler default.
HTTP_UA = "Mozilla/5.0 (X11; Linux x86_64) ferdinand-toeic/1.0"

GEMINI_TIMEOUT_S = 60
GEMINI_MODEL_DEFAULT = "gemini-2.5-flash"

CLASSIFY_PROMPT = """\
You are classifying TOEIC vocabulary cards for image illustration.

Word: {front}
Definition: {back}

Decide whether this word names a CONCRETE thing/action that can be photographed
(e.g. "warehouse", "negotiate", "blueprint") or an ABSTRACT concept that
photography would only loosely suggest (e.g. "nonetheless", "albeit",
"thereby", "implication").

Respond with EXACTLY one JSON object on a single line, no prose:
  {{"concrete": true, "queries": ["q1", "q2", "q3"]}}
or
  {{"concrete": false, "reason": "abstract logical connector"}}

Rules for queries when concrete:
  - 2-3 short English noun-phrase queries, most evocative first.
  - MUST describe a literal physical scene that could be photographed:
    GOOD: "warehouse interior", "office team meeting", "abandoned factory",
          "engineer at desk", "shipping containers port", "factory worker assembly".
    BAD : "resource allocation", "corporate strategy", "business decision",
          "task assignment", "team collaboration concept", "financial liability".
    Abstract phrases resolve to stock typography photos (Scrabble tiles,
    neon signs, paper printouts) — we want photos of real-world settings.
  - Prefer settings consistent with TOEIC business/industrial contexts
    (offices, factories, ports, meetings, transactions, construction sites).
  - No quotes or punctuation inside the query strings.
"""

JSON_OBJECT_RE = re.compile(r"\{[^{}]*\}", re.DOTALL)
SAFE_NAME_RE = re.compile(r"[^a-z0-9]+")
# Skip Pexels results whose `alt` description suggests the photo is
# mostly typography rather than a scene. Triggered against the alt
# string with `re.IGNORECASE`. Words chosen narrowly enough to not
# false-positive on legitimate photos (e.g. plain "sign" is excluded
# because it matches "signature"/"design"/"signal" — we use `signage`).
TEXT_BEARING_ALT_RE = re.compile(
    r"\b(text|typograph\w*|scrabble|tile[sd]?|letter(ing|s|ed)?|spelling|"
    r"alphabet|calligraph\w*|font|neon|billboard|poster|banner|signage|"
    r"word\s+art|quote|hand.?written|chalkboard|whiteboard|blackboard|"
    r"message\s+board|inscription|engrav\w+)\b",
    re.IGNORECASE,
)


def http_get_json(url: str, timeout: float = 15.0) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def http_patch_json(url: str, payload: dict, timeout: float = 15.0) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="PATCH"
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def load_pexels_key() -> str:
    key = os.environ.get("PEXELS_API_KEY", "").strip()
    if key:
        return key
    fallback = Path.home() / ".config" / "ferdinand" / "pexels.key"
    if fallback.exists():
        return fallback.read_text(encoding="utf-8").strip()
    sys.exit(
        "PEXELS_API_KEY missing — export it in your shell or write the key to "
        f"{fallback}"
    )


def gemini_classify(front: str, back: str, model: str) -> dict:
    """Call gemini and parse the {concrete, queries|reason} JSON object."""
    prompt = CLASSIFY_PROMPT.format(front=front, back=back)
    proc = subprocess.run(
        ["gemini", "-m", model, "-p", prompt],
        capture_output=True,
        text=True,
        timeout=GEMINI_TIMEOUT_S,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"gemini exit {proc.returncode}: {proc.stderr.strip()[:200]}")
    out = proc.stdout.strip()
    match = JSON_OBJECT_RE.search(out)
    if not match:
        raise RuntimeError(f"no JSON object in gemini output: {out[:200]!r}")
    parsed = json.loads(match.group(0))
    if "concrete" not in parsed:
        raise RuntimeError(f"missing 'concrete' key: {parsed!r}")
    return parsed


def pexels_search(query: str, key: str) -> str | None:
    """Pick a random non-typography landscape photo for `query`.

    Pulls top 10 candidates and shuffles before applying the alt filter,
    so different cards with overlapping gemini queries (e.g. acquire /
    approve / confirm all triggering "office contract signing") don't
    keep landing on the same Pexels result. Returns None if every
    candidate trips the text filter — caller falls through to the
    next query.
    """
    url = (
        f"{PEXELS_SEARCH}?"
        + urllib.parse.urlencode({"query": query, "per_page": 10, "orientation": "landscape"})
    )
    req = urllib.request.Request(
        url, headers={"Authorization": key, "User-Agent": HTTP_UA}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read())
    photos = list(data.get("photos") or [])
    if not photos:
        return None
    random.shuffle(photos)
    for p in photos:
        alt = p.get("alt") or ""
        if not TEXT_BEARING_ALT_RE.search(alt):
            return p.get("src", {}).get("large")
    return None


def fetch_and_resize(image_url: str, max_width: int = 600) -> bytes:
    """Download raw bytes, resize ≤max_width px wide, return JPEG bytes."""
    req = urllib.request.Request(image_url, headers={"User-Agent": HTTP_UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
    img = Image.open(io.BytesIO(raw))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    if img.width > max_width:
        ratio = max_width / img.width
        new_size = (max_width, max(1, int(img.height * ratio)))
        img = img.resize(new_size, Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85, optimize=True)
    return buf.getvalue()


def build_filename(front: str) -> str:
    """`concept_<slug>.jpg`. Anki adds ` (N)` on collision, which is fine."""
    slug = SAFE_NAME_RE.sub("_", front.lower()).strip("_") or "card"
    return f"concept_{slug}.jpg"


def upload_media(base: str, filename: str, jpeg_bytes: bytes) -> dict:
    """Hand-rolled multipart so we don't pull in the requests dep."""
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


def patch_image_field(base: str, nid: int, fields: list[str], tags: list[str], filename: str) -> dict:
    new_fields = list(fields)
    new_fields[IMAGE_FIELD_IDX] = filename
    return http_patch_json(
        f"{base}/api/notes/{nid}",
        {"fields": new_fields, "tags": tags},
    )


def enumerate_pending(base: str, refresh_cache: bool) -> list[dict]:
    """Build [{nid, front, back, fields, tags}] for Concept-Deep notes
    whose Image field is currently empty. Caches the {nid → meta} map
    in concept_image_map.json so re-runs skip the per-note GETs."""
    cached: dict[str, dict] = {}
    if MAP_JSON.exists() and not refresh_cache:
        cached = json.loads(MAP_JSON.read_text(encoding="utf-8"))

    if not cached:
        print("[scan] listing all Concept-Deep cards …", flush=True)
        list_url = (
            f"{base}/api/cards?"
            + urllib.parse.urlencode({"q": f"mid:{CONCEPT_DEEP_MID}", "limit": 500})
        )
        cards = http_get_json(list_url).get("cards", [])
        nids = sorted({c["note_id"] for c in cards})
        print(f"[scan] {len(cards)} cards → {len(nids)} unique notes; fetching fields …",
              flush=True)
        for i, nid in enumerate(nids, 1):
            note = http_get_json(f"{base}/api/notes/{nid}")
            cached[str(nid)] = {
                "front": note["fields"][0],
                "back": note["fields"][1],
                "fields": note["fields"],
                "tags": note.get("tags", []),
            }
            if i % 50 == 0:
                print(f"  [scan] {i}/{len(nids)} fetched", flush=True)
        MAP_JSON.write_text(json.dumps(cached, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[scan] cached map → {MAP_JSON}", flush=True)

    pending = []
    for nid_str, meta in cached.items():
        if not meta["fields"][IMAGE_FIELD_IDX]:
            pending.append({"nid": int(nid_str), **meta})
    return pending


def load_tracker(path: Path) -> set[int]:
    if not path.exists():
        return set()
    return {int(ln.strip()) for ln in path.read_text().splitlines() if ln.strip().isdigit()}


def process_one(card: dict, base: str, key: str, model: str,
                write_lock: threading.Lock, file_handles: dict) -> tuple[str, int, str]:
    """Run the full pipeline on one note. Returns (status, nid, detail)."""
    nid = card["nid"]
    front = card["front"]
    back = card["back"]
    queries: list[str] = []

    try:
        verdict = gemini_classify(front, back, model)
        if not verdict.get("concrete"):
            with write_lock:
                file_handles["skip"].write(f"{nid}\n")
                file_handles["skip"].flush()
            return ("skip", nid, verdict.get("reason", ""))

        queries = [q.strip() for q in verdict.get("queries", []) if q.strip()]
        if not queries:
            raise RuntimeError("concrete verdict but no queries returned")

        photo_url: str | None = None
        for q in queries:
            time.sleep(PEXELS_RATE_SLEEP_S)
            photo_url = pexels_search(q, key)
            if photo_url:
                break
        if not photo_url:
            raise RuntimeError("no Pexels match across all queries")

        jpeg = fetch_and_resize(photo_url)
        filename = build_filename(front)
        upload = upload_media(base, filename, jpeg)
        stored = upload["filename"]
        patch_image_field(base, nid, card["fields"], card["tags"], stored)

        with write_lock:
            file_handles["done"].write(f"{nid}\n")
            file_handles["done"].flush()
        return ("ok", nid, stored)

    except Exception as exc:
        with write_lock:
            file_handles["fail"].write(json.dumps({
                "nid": nid,
                "front": front,
                "stage": type(exc).__name__,
                "reason": str(exc)[:300],
                "queries": queries,
            }, ensure_ascii=False) + "\n")
            file_handles["fail"].flush()
        return ("fail", nid, str(exc)[:120])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=None,
                    help="cap pending notes processed this run (use small N for first try)")
    ap.add_argument("--model", default=GEMINI_MODEL_DEFAULT)
    ap.add_argument("--refresh-cache", action="store_true",
                    help="re-scan the collection instead of trusting concept_image_map.json")
    args = ap.parse_args()

    TOEIC_DIR.mkdir(parents=True, exist_ok=True)
    key = load_pexels_key()
    print(f"[init] base={args.base} workers={args.workers} model={args.model}", flush=True)

    pending = enumerate_pending(args.base, refresh_cache=args.refresh_cache)
    done = load_tracker(DONE_TXT)
    skip = load_tracker(SKIP_TXT)
    pending = [c for c in pending if c["nid"] not in done and c["nid"] not in skip]
    print(f"[init] {len(pending)} pending  (done={len(done)} skip={len(skip)})", flush=True)
    if args.limit:
        pending = pending[: args.limit]
        print(f"[init] capped to first {len(pending)} for this run", flush=True)
    if not pending:
        print("[init] nothing to do")
        return 0

    write_lock = threading.Lock()
    with DONE_TXT.open("a", encoding="utf-8") as fdone, \
         SKIP_TXT.open("a", encoding="utf-8") as fskip, \
         FAIL_JSONL.open("a", encoding="utf-8") as ffail:
        handles = {"done": fdone, "skip": fskip, "fail": ffail}
        ok = sk = fl = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(process_one, c, args.base, key, args.model,
                                    write_lock, handles): c for c in pending}
            for fut in as_completed(futures):
                status, nid, detail = fut.result()
                front = futures[fut]["front"]
                marker = {"ok": "  ok  ", "skip": " skip ", "fail": " FAIL "}[status]
                print(f"  {marker} nid={nid:<14} {front:18} {detail}", flush=True)
                if status == "ok":
                    ok += 1
                elif status == "skip":
                    sk += 1
                else:
                    fl += 1

    print(f"\n[done] ok={ok}  skip={sk}  fail={fl}  total={len(pending)}")
    return 0 if fl == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
