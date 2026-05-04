#!/usr/bin/env python3
"""Ingest TOEIC cards.jsonl into the running anki_server collection.

Phase E of the TOEIC card workflow. Posts each card to POST /api/notes
using the Concept-Deep notetype. Idempotent via ingested.txt.

Usage:
    ./scripts/ingest_toeic_cards.py                       # all pending
    ./scripts/ingest_toeic_cards.py --only abandon        # one word
    ./scripts/ingest_toeic_cards.py --base http://...     # custom host
    ./scripts/ingest_toeic_cards.py --deck "My Deck"      # custom deck
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CARDS_IN = REPO_ROOT / "data" / "toeic" / "cards.jsonl"
INGESTED_TXT = REPO_ROOT / "data" / "toeic" / "ingested.txt"

CONCEPT_DEEP = "Concept-Deep"
FIELD_ORDER = (
    "Front", "Back", "Why", "Example",
    "Contrast", "Mnemonic", "Source", "ReverseEnabled",
    "Image",
)
DEFAULT_BASE = "http://127.0.0.1:40001"
DEFAULT_DECK = "Ferdinand demo"
# Deck-template supports {level}, {pos}, {theme} placeholders pulled from
# the card's _meta block. Parent decks are auto-created via POST /api/decks
# (Anki creates intermediate parents in the same call).
DEFAULT_DECK_TEMPLATE = None


def http_get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read())


def http_post_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def resolve_notetype_id(base: str) -> int:
    data = http_get_json(f"{base}/api/notetypes")
    for nt in data.get("notetypes", []):
        if nt["name"] == CONCEPT_DEEP:
            return nt["id"]
    sys.exit(f"notetype {CONCEPT_DEEP!r} not found — start the server with seeding enabled")


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


def load_cards() -> list[dict]:
    with CARDS_IN.open() as fh:
        return [json.loads(line) for line in fh if line.strip()]


def load_ingested() -> set[str]:
    if not INGESTED_TXT.exists():
        return set()
    return {ln.strip() for ln in INGESTED_TXT.read_text().splitlines() if ln.strip()}


def build_tags(card: dict) -> list[str]:
    tags = ["toeic"]
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
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--deck", default=DEFAULT_DECK,
                    help="single-deck mode (default). Ignored if --deck-template set.")
    ap.add_argument("--deck-template", default=DEFAULT_DECK_TEMPLATE,
                    help="route each card to a deck via Python format-string of _meta keys, "
                         "e.g. 'TOEIC::Vocabulary::L{level}'. Implies --auto-create.")
    ap.add_argument("--auto-create", action="store_true",
                    help="POST /api/decks for any deck not already present")
    ap.add_argument("--only", default=None, help="ingest one specific word")
    args = ap.parse_args()

    if not CARDS_IN.exists():
        sys.exit(f"cards file missing: {CARDS_IN}")

    notetype_id = resolve_notetype_id(args.base)

    use_template = bool(args.deck_template)
    auto_create = args.auto_create or use_template
    if use_template:
        print(f"[ingest] notetype={CONCEPT_DEEP} ({notetype_id})  deck_template={args.deck_template!r}")
    else:
        deck_id = resolve_deck_id(args.base, args.deck, auto_create=auto_create)
        print(f"[ingest] notetype={CONCEPT_DEEP} ({notetype_id})  deck={args.deck} ({deck_id})")
    deck_id_cache: dict[str, int] = {}

    cards = load_cards()
    ingested = load_ingested()

    if args.only:
        cards = [c for c in cards if c.get("Front", "").lower() == args.only.lower()]
        if not cards:
            sys.exit(f"no card with Front={args.only!r} found in {CARDS_IN}")

    pending = [c for c in cards if c["Front"] not in ingested]
    print(f"[ingest] {len(pending)} pending of {len(cards)} ({len(ingested)} already ingested)")

    INGESTED_TXT.parent.mkdir(parents=True, exist_ok=True)
    ok = fail = 0
    with INGESTED_TXT.open("a", encoding="utf-8") as ingested_fh:
        for card in pending:
            front = card["Front"]
            try:
                if use_template:
                    deck_name = args.deck_template.format(**card.get("_meta", {}))
                    if deck_name not in deck_id_cache:
                        deck_id_cache[deck_name] = resolve_deck_id(
                            args.base, deck_name, auto_create=True
                        )
                    target_deck_id = deck_id_cache[deck_name]
                else:
                    target_deck_id = deck_id
                payload = {
                    "deck_id": target_deck_id,
                    "notetype_id": notetype_id,
                    "fields": [card.get(f, "") for f in FIELD_ORDER],
                    "tags": build_tags(card),
                }
                resp = http_post_json(f"{args.base}/api/notes", payload)
                ingested_fh.write(front + "\n")
                ingested_fh.flush()
                ok += 1
                deck_label = f" → {deck_name}" if use_template else ""
                print(f"  ok    {front:14}  note_id={resp['note_id']}  cards={resp['card_count']}{deck_label}")
            except Exception as exc:  # noqa: BLE001 — keep going on per-card failure
                fail += 1
                print(f"  FAIL  {front:14}  {type(exc).__name__}: {exc}")

    print(f"\n[ingest] done: ok={ok} fail={fail}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
