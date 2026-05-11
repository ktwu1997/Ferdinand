#!/usr/bin/env python3
"""Ingest cards.jsonl into the running anki_server collection.

Phase E of the per-deck card workflow. Posts each card to POST /api/notes
using the Concept-Deep notetype. Idempotent via <data_dir>/ingested.txt.

Profile-driven: pass `--profile decks/<name>.json` to target a different
deck. Without the flag, defaults to the historical TOEIC vocab paths +
the TOEIC::Vocabulary::L{level} deck template.

Usage:
    ./scripts/ingest_toeic_cards.py                                 # TOEIC default
    ./scripts/ingest_toeic_cards.py --profile sesame                # Sesame Street
    ./scripts/ingest_toeic_cards.py --profile sesame --only immense # one word
    ./scripts/ingest_toeic_cards.py --base http://...               # custom host
    ./scripts/ingest_toeic_cards.py --deck "My Deck"                # CLI override
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _profile import DeckProfile, default_toeic_profile, load_profile  # noqa: E402

FIELD_ORDER = (
    "Front", "Back", "Why", "Example",
    "Contrast", "Mnemonic", "Source", "ReverseEnabled",
    "Image",
)
DEFAULT_BASE = "http://127.0.0.1:40001"

# Cookie-aware opener so `--login` lets this script hit a session-guarded
# server (e.g. the deployed instance) and not just a local no-auth dev
# server. Without `--login` it behaves exactly like the bare urlopen this
# file used before.
_OPENER = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
)


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
    print(f"[ingest] logged in as {username!r} — session cookie attached")


def http_get_json(url: str) -> dict:
    with _OPENER.open(url, timeout=10) as r:
        return json.loads(r.read())


def http_post_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with _OPENER.open(req, timeout=15) as r:
        return json.loads(r.read())


def resolve_notetype_id(base: str, notetype_name: str) -> int:
    data = http_get_json(f"{base}/api/notetypes")
    for nt in data.get("notetypes", []):
        if nt["name"] == notetype_name:
            return nt["id"]
    sys.exit(f"notetype {notetype_name!r} not found — start the server with seeding enabled")


def resolve_deck_id(base: str, deck_name: str, auto_create: bool = False) -> int:
    """Find a deck by full human name (with `::` nesting). When
    `auto_create=True`, POST /api/decks if missing — Anki creates any
    intermediate parent decks atomically in the same call.

    NOTE: GET /api/decks returns each deck's `name` as the leaf only, with
    children nested. Reconstruct the full `Parent::Child::Grandchild` path
    during the walk — comparing leaf name against a hierarchical query
    silently misses every nested deck and triggers duplicate POSTs that
    Anki disambiguates with a "+" suffix.
    """
    data = http_get_json(f"{base}/api/decks")

    def walk(decks, prefix: str = "") -> int | None:
        for d in decks:
            full = f"{prefix}::{d['name']}" if prefix else d["name"]
            if full == deck_name and not d.get("filtered"):
                return d["id"]
            found = walk(d.get("children", []), full)
            if found:
                return found
        return None

    deck_id = walk(data.get("decks", []))
    if deck_id:
        return deck_id
    if not auto_create:
        sys.exit(f"deck {deck_name!r} not found (use --deck-template + --auto-create)")
    resp = http_post_json(f"{base}/api/decks", {"name": deck_name})
    print(f"  +deck  {deck_name!r}  id={resp['id']}")
    return resp["id"]


def load_cards(path: Path) -> list[dict]:
    with path.open() as fh:
        return [json.loads(line) for line in fh if line.strip()]


def load_ingested(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {ln.strip() for ln in path.read_text().splitlines() if ln.strip()}


def build_tags(profile: DeckProfile, card: dict) -> list[str]:
    tags = [profile.name]
    meta = card.get("_meta", {})
    if level := meta.get("level"):
        tags.append(f"level-{level}")
    if theme := meta.get("theme"):
        tags.append(f"theme-{theme}")
    if pos := meta.get("pos"):
        tags.append(f"pos-{pos}")
    return tags


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--profile", default=None,
                    help="path or shorthand for deck profile (e.g. 'sesame' → decks/sesame.json). "
                         "Default = legacy TOEIC vocab paths + TOEIC::Vocabulary::L{level}.")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--login", default=None, metavar="USER:PASS",
                    help="authenticate before ingesting — needed for a session-guarded "
                         "server like https://ferdinand.zeabur.app. Format: username:password")
    ap.add_argument("--deck", default=None,
                    help="override single-deck name (otherwise from profile). Ignored if profile uses deck_template.")
    ap.add_argument("--deck-template", default=None,
                    help="override deck-template (otherwise from profile). Implies --auto-create.")
    ap.add_argument("--auto-create", action="store_true",
                    help="POST /api/decks for any deck not already present")
    ap.add_argument("--only", default=None, help="ingest one specific word")
    args = ap.parse_args()

    if args.login:
        if ":" not in args.login:
            sys.exit("--login must be USERNAME:PASSWORD")
        _user, _pw = args.login.split(":", 1)
        login(args.base, _user, _pw)

    profile = load_profile(args.profile) if args.profile else default_toeic_profile()
    deck_name = args.deck or profile.deck
    deck_template = args.deck_template or profile.deck_template
    if deck_name and deck_template:
        sys.exit("conflicting deck routing: profile/CLI specifies both --deck and --deck-template")
    if not deck_name and not deck_template:
        sys.exit("no deck routing: profile/CLI must specify --deck or --deck-template")

    if not profile.cards.exists():
        sys.exit(f"cards file missing: {profile.cards}")

    notetype_id = resolve_notetype_id(args.base, profile.notetype)

    use_template = bool(deck_template)
    auto_create = args.auto_create or use_template
    if use_template:
        print(f"[ingest] profile={profile.name} notetype={profile.notetype} ({notetype_id})  "
              f"deck_template={deck_template!r}")
    else:
        deck_id = resolve_deck_id(args.base, deck_name, auto_create=auto_create)
        print(f"[ingest] profile={profile.name} notetype={profile.notetype} ({notetype_id})  "
              f"deck={deck_name} ({deck_id})")
    deck_id_cache: dict[str, int] = {}

    cards = load_cards(profile.cards)
    ingested = load_ingested(profile.ingested)

    if args.only:
        cards = [c for c in cards if c.get("Front", "").lower() == args.only.lower()]
        if not cards:
            sys.exit(f"no card with Front={args.only!r} found in {CARDS_IN}")

    pending = [c for c in cards if c["Front"] not in ingested]
    print(f"[ingest] {len(pending)} pending of {len(cards)} ({len(ingested)} already ingested)")

    profile.ingested.parent.mkdir(parents=True, exist_ok=True)
    ok = fail = 0
    with profile.ingested.open("a", encoding="utf-8") as ingested_fh:
        for card in pending:
            front = card["Front"]
            try:
                if use_template:
                    routed_deck = deck_template.format(**card.get("_meta", {}))
                    if routed_deck not in deck_id_cache:
                        deck_id_cache[routed_deck] = resolve_deck_id(
                            args.base, routed_deck, auto_create=True
                        )
                    target_deck_id = deck_id_cache[routed_deck]
                else:
                    target_deck_id = deck_id
                    routed_deck = deck_name
                payload = {
                    "deck_id": target_deck_id,
                    "notetype_id": notetype_id,
                    "fields": [card.get(f, "") for f in FIELD_ORDER],
                    "tags": build_tags(profile, card),
                }
                resp = http_post_json(f"{args.base}/api/notes", payload)
                ingested_fh.write(front + "\n")
                ingested_fh.flush()
                ok += 1
                deck_label = f" → {routed_deck}" if use_template else ""
                print(f"  ok    {front:14}  note_id={resp['note_id']}  cards={resp['card_count']}{deck_label}")
            except Exception as exc:  # noqa: BLE001 — keep going on per-card failure
                fail += 1
                print(f"  FAIL  {front:14}  {type(exc).__name__}: {exc}")

    print(f"\n[ingest] done: ok={ok} fail={fail}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
