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
)
DEFAULT_BASE = "http://127.0.0.1:40001"
DEFAULT_DECK = "Ferdinand demo"


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


def resolve_deck_id(base: str, deck_name: str) -> int:
    data = http_get_json(f"{base}/api/decks")

    def walk(decks):
        for d in decks:
            if d["name"] == deck_name and not d.get("filtered"):
                return d["id"]
            found = walk(d.get("children", []))
            if found:
                return found
        return None

    deck_id = walk(data.get("decks", []))
    if not deck_id:
        sys.exit(f"deck {deck_name!r} not found")
    return deck_id


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
    ap.add_argument("--deck", default=DEFAULT_DECK)
    ap.add_argument("--only", default=None, help="ingest one specific word")
    args = ap.parse_args()

    if not CARDS_IN.exists():
        sys.exit(f"cards file missing: {CARDS_IN}")

    notetype_id = resolve_notetype_id(args.base)
    deck_id = resolve_deck_id(args.base, args.deck)
    print(f"[ingest] notetype={CONCEPT_DEEP} ({notetype_id})  deck={args.deck} ({deck_id})")

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
            payload = {
                "deck_id": deck_id,
                "notetype_id": notetype_id,
                "fields": [card.get(f, "") for f in FIELD_ORDER],
                "tags": build_tags(card),
            }
            try:
                resp = http_post_json(f"{args.base}/api/notes", payload)
                ingested_fh.write(front + "\n")
                ingested_fh.flush()
                ok += 1
                print(f"  ok    {front:14}  note_id={resp['note_id']}  cards={resp['card_count']}")
            except Exception as exc:  # noqa: BLE001 — keep going on per-card failure
                fail += 1
                print(f"  FAIL  {front:14}  {type(exc).__name__}: {exc}")

    print(f"\n[ingest] done: ok={ok} fail={fail}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
