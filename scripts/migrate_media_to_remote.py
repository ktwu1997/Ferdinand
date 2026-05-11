#!/usr/bin/env python3
"""Push already-generated local card images to a remote anki_server collection.

Phase F was usually run against a *local* dev server, so the JPEGs ended
up only in that machine's `collection.media/` — they never reached the
deployed instance (collection.media + data/users/ are gitignored, `data/`
is in .dockerignore, and `cards.jsonl` carries an empty `Image` field
because gen_card_images_codex.py PATCHes the live note, not the JSONL).

This script bridges that gap **without re-spending codex quota**: for
every note in the remote collection (scoped to the profile's deck +
notetype), it derives the image filename the way
`gen_card_images_codex.build_filename` does (`{prefix}_{slug}.jpg`), and
if a matching file exists under `--media-dir` AND the remote note's image
field is still empty, it uploads the JPEG (`POST /media`) and PATCHes the
note (`PATCH /api/notes/{nid}` fields[image_field_idx]). Idempotent: a
note that already has an image is left alone, so re-runs are safe.

These images were presumably already visually-audited when generated, so
no re-audit is implied — but if a JPEG predates the audit cycle, audit it
before relying on it (see the "Image backfill SOP").

Usage:
    ./scripts/migrate_media_to_remote.py --profile toeic_vocab \\
        --base https://ferdinand.zeabur.app --login ktwu:PASS
    ./scripts/migrate_media_to_remote.py --profile sesame \\
        --base https://ferdinand.zeabur.app --login grace:PASS
    ./scripts/migrate_media_to_remote.py --profile sesame --base ... \\
        --login grace:PASS --only architectural   # one note
    ./scripts/migrate_media_to_remote.py --profile sesame --base ... \\
        --login grace:PASS --dry-run              # report only, no writes
"""
from __future__ import annotations

import argparse
import http.cookiejar
import io
import json
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _profile import DeckProfile, default_toeic_profile, load_profile  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BASE = "http://127.0.0.1:40001"
DEFAULT_MEDIA_DIR = REPO_ROOT / "data" / "collection.media"  # symlink → data/users/<u>/collection.media
SAFE_NAME_RE = re.compile(r"[^a-z0-9]+")

_OPENER = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
)


# ---------------------------------------------------------------------------
# HTTP helpers (urllib — no extra deps)
# ---------------------------------------------------------------------------


def login(base: str, username: str, password: str) -> None:
    body = json.dumps({"username": username, "password": password}).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/api/auth/login", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with _OPENER.open(req, timeout=15) as r:
            r.read()
    except urllib.error.HTTPError as exc:
        sys.exit(f"login failed for {username!r}: HTTP {exc.code} {exc.reason}")
    print(f"[migrate] logged in as {username!r} — session cookie attached")


def http_get_json(url: str) -> dict:
    with _OPENER.open(url, timeout=20) as r:
        return json.loads(r.read())


def http_patch_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="PATCH"
    )
    with _OPENER.open(req, timeout=20) as r:
        return json.loads(r.read())


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
    with _OPENER.open(req, timeout=30) as r:
        return json.loads(r.read())


# ---------------------------------------------------------------------------
# Remote note enumeration (mirrors gen_card_images_codex.enumerate_pending)
# ---------------------------------------------------------------------------


def resolve_notetype_id(base: str, name: str) -> int:
    data = http_get_json(f"{base}/api/notetypes")
    for nt in data.get("notetypes", []):
        if nt["name"] == name:
            return nt["id"]
    sys.exit(f"notetype {name!r} not found on server {base} — is the collection seeded?")


def remote_notes(base: str, profile: DeckProfile) -> list[dict]:
    notetype_id = resolve_notetype_id(base, profile.notetype)
    q = f"mid:{notetype_id} {profile.deck_query_clause}".strip()
    nids: set[int] = set()
    offset, page_size = 0, 500
    while True:
        resp = http_get_json(
            f"{base}/api/cards?{urllib.parse.urlencode({'q': q, 'limit': page_size, 'offset': offset})}"
        )
        page = resp.get("cards", [])
        if not page:
            break
        nids.update(c["note_id"] for c in page)
        if len(page) < page_size:
            break
        offset += page_size
    notes = []
    for nid in sorted(nids):
        notes.append(http_get_json(f"{base}/api/notes/{nid}"))
    return notes


def derive_filename(front: str, prefix: str) -> str:
    slug = SAFE_NAME_RE.sub("_", front.lower()).strip("_") or "card"
    return f"{prefix}_{slug}.jpg"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--profile", default=None,
                    help="deck profile name or path (decks/<name>.json); "
                         "default = legacy TOEIC profile (data/toeic, Concept-Deep)")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--login", default=None, metavar="USER:PASS",
                    help="authenticate before migrating — needed for a session-guarded "
                         "server like https://ferdinand.zeabur.app. Format: username:password")
    ap.add_argument("--media-dir", default=str(DEFAULT_MEDIA_DIR),
                    help="local dir holding the {prefix}_{slug}.jpg files "
                         f"(default: {DEFAULT_MEDIA_DIR})")
    ap.add_argument("--only", default=None, help="migrate only this Front")
    ap.add_argument("--dry-run", action="store_true", help="report what would change, write nothing")
    return ap.parse_args()


def main() -> int:
    args = parse_args()
    if args.login:
        if ":" not in args.login:
            sys.exit("--login must be USERNAME:PASSWORD")
        _user, _pw = args.login.split(":", 1)
        login(args.base, _user, _pw)

    profile = load_profile(args.profile) if args.profile else default_toeic_profile()
    media_dir = Path(args.media_dir)
    if not media_dir.is_dir():
        sys.exit(f"--media-dir not a directory: {media_dir}")
    idx = profile.image_field_idx

    print(f"[migrate] profile={profile.name} notetype={profile.notetype} "
          f"base={args.base} media_dir={media_dir} image_field_idx={idx}"
          + ("  (DRY RUN)" if args.dry_run else ""), flush=True)

    notes = remote_notes(args.base, profile)
    if args.only:
        notes = [n for n in notes if (n["fields"][0] or "").lower() == args.only.lower()]
        if not notes:
            sys.exit(f"--only {args.only!r} not found among {profile.name} notes on {args.base}")
    print(f"[migrate] {len(notes)} remote notes to consider", flush=True)

    uploaded = no_local = already = bad = 0
    for note in notes:
        nid = note["id"]
        fields = note["fields"]
        front = (fields[0] or "").strip()
        if len(fields) <= idx:
            print(f"  bad   nid={nid:<14} {front:18} note has only {len(fields)} fields, no index {idx}")
            bad += 1
            continue
        if (fields[idx] or "").strip():
            already += 1
            continue
        filename = derive_filename(front, profile.image_filename_prefix)
        local = media_dir / filename
        if not local.is_file():
            no_local += 1
            continue
        if args.dry_run:
            print(f"  WOULD nid={nid:<14} {front:18} ← {filename} ({local.stat().st_size} B)")
            uploaded += 1
            continue
        try:
            jpeg = local.read_bytes()
            stored = upload_media(args.base, filename, jpeg)["filename"]
            new_fields = list(fields)
            new_fields[idx] = stored
            http_patch_json(f"{args.base}/api/notes/{nid}",
                            {"fields": new_fields, "tags": note.get("tags", [])})
            uploaded += 1
            print(f"  ok    nid={nid:<14} {front:18} ← {stored}", flush=True)
        except Exception as exc:  # noqa: BLE001 — keep going on a per-note failure
            bad += 1
            print(f"  FAIL  nid={nid:<14} {front:18} {type(exc).__name__}: {exc}", flush=True)

    verb = "would upload" if args.dry_run else "uploaded"
    print(f"\n[migrate] {verb}={uploaded}  already-had-image={already}  "
          f"no-local-file={no_local}  failed={bad}  total={len(notes)}")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
