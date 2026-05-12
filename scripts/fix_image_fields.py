#!/usr/bin/env python3
"""One-off PATCH: convert bare-filename Image fields to `<img src="...">`.

Background: the older bulk image scripts (`gen_card_images_codex.py`,
`migrate_media_to_remote.py`) used to write a *bare* filename (e.g.
`concept_immense.jpg`) into a note's Image field. The Concept-Deep card
template renders `{{Image}}` verbatim, so a bare filename comes out as
literal TEXT — no `<img>` element — and the web frontend (which only
rewrites `<img src>` → `/media/...`) has nothing to show. The scripts now
write `<img src="<FILENAME>">` (a RELATIVE src, no `/media/` prefix; the
frontend's CardFace.svelte resolves a relative src to `/media/<filename>`),
but the ~243 notes already ingested still hold bare filenames.

This script fixes those existing notes in place. For every note in the
profile's deck(s) with the profile's notetype, it looks at the Image
field (`profile.image_field_idx`):

  • empty                → skipped (no_image)
  • already contains `<img` → skipped (already converted)
  • a bare filename `foo.jpg` → PATCHed to `<img src="foo.jpg">`

Idempotent: a second run converts nothing. Profile-aware (the profile
gives the notetype, image-field index, and deck scope). Defensive about
short-field notes (e.g. a 4-field Cloze-Deep note that slips through a
transitive deck match): those are skipped, not crashed on.

Usage:
    ./scripts/fix_image_fields.py --profile sesame \\
        --base https://ferdinand.zeabur.app --login grace:PASS --dry-run
    ./scripts/fix_image_fields.py --profile sesame \\
        --base https://ferdinand.zeabur.app --login grace:PASS
    ./scripts/fix_image_fields.py --profile toeic_vocab --base ... \\
        --login ktwu:PASS --only arbitration   # one note
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _profile import DeckProfile, default_toeic_profile, load_profile  # noqa: E402

DEFAULT_BASE = "http://127.0.0.1:40001"

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
    print(f"[fix-image-fields] logged in as {username!r} — session cookie attached")


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


# ---------------------------------------------------------------------------
# Remote note enumeration (mirrors migrate_media_to_remote.remote_notes)
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
    return [http_get_json(f"{base}/api/notes/{nid}") for nid in sorted(nids)]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--profile", required=True,
                    help="deck profile name or path (decks/<name>.json) — "
                         "gives notetype, image_field_idx, and deck scope")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--login", default=None, metavar="USER:PASS",
                    help="authenticate before patching — needed for a session-guarded "
                         "server like https://ferdinand.zeabur.app. Format: username:password")
    ap.add_argument("--only", default=None, help="convert only this Front")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would change, write nothing")
    return ap.parse_args()


def main() -> int:
    args = parse_args()
    if args.login:
        if ":" not in args.login:
            sys.exit("--login must be USERNAME:PASSWORD")
        _user, _pw = args.login.split(":", 1)
        login(args.base, _user, _pw)

    # `--profile toeic_vocab` resolves to decks/toeic_vocab.json (or, as a
    # fallback for a missing file, the legacy default TOEIC profile).
    try:
        profile = load_profile(args.profile)
    except FileNotFoundError:
        if args.profile in ("toeic_vocab", "toeic"):
            profile = default_toeic_profile()
        else:
            raise
    idx = profile.image_field_idx

    print(f"[fix-image-fields] profile={profile.name} notetype={profile.notetype} "
          f"base={args.base} image_field_idx={idx}"
          + ("  (DRY RUN)" if args.dry_run else ""), flush=True)

    notes = remote_notes(args.base, profile)
    if args.only:
        notes = [n for n in notes
                 if n.get("fields") and (n["fields"][0] or "").lower() == args.only.lower()]
        if not notes:
            sys.exit(f"--only {args.only!r} not found among {profile.name} notes on {args.base}")
    print(f"[fix-image-fields] {len(notes)} notes to consider", flush=True)

    converted = already = no_image = skipped_short = 0
    for note in notes:
        nid = note["id"]
        fields = note["fields"]
        front = (fields[0] or "").strip() if fields else ""
        if len(fields) <= idx:
            # e.g. a 4-field Cloze-Deep note caught by a transitive deck match
            skipped_short += 1
            continue
        v = (fields[idx] or "").strip()
        if not v:
            no_image += 1
            continue
        if "<img" in v:
            already += 1
            continue
        # Bare filename → wrap in an <img> tag with a relative src.
        new_value = f'<img src="{v}">'
        if args.dry_run:
            print(f"  WOULD nid={nid:<14} {front:18} : {v!r} -> {new_value}", flush=True)
            converted += 1
            continue
        new_fields = list(fields)
        new_fields[idx] = new_value
        try:
            http_patch_json(f"{args.base}/api/notes/{nid}",
                            {"fields": new_fields, "tags": note.get("tags", [])})
            converted += 1
            print(f"  ok    nid={nid:<14} {front:18} : {v!r} -> {new_value}", flush=True)
        except Exception as exc:  # noqa: BLE001 — keep going on a per-note failure
            print(f"  FAIL  nid={nid:<14} {front:18} {type(exc).__name__}: {exc}", flush=True)

    suffix = " (DRY RUN)" if args.dry_run else ""
    print(f"[fix-image-fields] profile={profile.name} base={args.base} "
          f"converted={converted} already-img={already} no-image={no_image} "
          f"skipped(short)={skipped_short} total={len(notes)}{suffix}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
