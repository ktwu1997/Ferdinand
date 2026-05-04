#!/usr/bin/env python3
"""Ingest TOEIC reading_cards.jsonl into the running anki_server collection.

Sister script to ingest_toeic_cloze.py — same architecture but targets
the Reading-Deep notetype (6 fields) and reads
data/toeic/reading_cards.jsonl. Tracking key is `_meta.id` (e.g.
"memo-travel-policy-q3").

Usage:
    ./scripts/ingest_toeic_reading.py                                       # → Default deck
    ./scripts/ingest_toeic_reading.py --deck "TOEIC::Reading::Pilot"
    ./scripts/ingest_toeic_reading.py --deck-template "TOEIC::Reading::{passage_type}"
    ./scripts/ingest_toeic_reading.py --deck-template "TOEIC::Reading::L{level}::{passage_type}"
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CARDS_IN = REPO_ROOT / "data" / "toeic" / "reading_cards.jsonl"
INGESTED_TXT = REPO_ROOT / "data" / "toeic" / "reading_ingested.txt"

READING_DEEP = "Reading-Deep"
FIELD_ORDER = (
    "Passage",
    "Why",
    "Translation",
    "PassageType",
    "TargetWords",
    "Source",
)
DEFAULT_BASE = "http://127.0.0.1:40001"
DEFAULT_DECK = "Default"
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
        if nt["name"] == READING_DEEP:
            return nt["id"]
    sys.exit(
        f"notetype {READING_DEEP!r} not found — apply the seed_notetypes.rs "
        f"diff and rebuild/restart anki_server (see /tmp/reading_deep_seed_diff.md)"
    )


def resolve_deck_id(base: str, deck_name: str, auto_create: bool = False) -> int:
    """Walk reconstructs full `Parent::Child` paths — see ingest_toeic_cards.py
    docstring for the rationale (API returns only leaf `name`, comparing
    against a hierarchical query misses nested decks and triggers duplicate
    POSTs that Anki disambiguates with a "+" suffix).
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
    with CARDS_IN.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def load_ingested() -> set[str]:
    if not INGESTED_TXT.exists():
        return set()
    return {ln.strip() for ln in INGESTED_TXT.read_text().splitlines() if ln.strip()}


def build_tags(card: dict) -> list[str]:
    tags = ["toeic", "reading"]
    meta = card.get("_meta", {})
    if level := meta.get("level"):
        tags.append(f"level-{level}")
    if ptype := meta.get("passage_type"):
        tags.append(f"type-{ptype}")
    if theme := meta.get("theme"):
        tags.append(f"theme-{theme}")
    return tags


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--deck", default=DEFAULT_DECK)
    ap.add_argument("--deck-template", default=DEFAULT_DECK_TEMPLATE,
                    help="route via _meta keys, e.g. 'TOEIC::Reading::{passage_type}'")
    ap.add_argument("--auto-create", action="store_true")
    ap.add_argument("--only", default=None, help="ingest one specific reading id")
    args = ap.parse_args()

    if not CARDS_IN.exists():
        sys.exit(f"cards file missing: {CARDS_IN}")

    notetype_id = resolve_notetype_id(args.base)
    use_template = bool(args.deck_template)
    auto_create = args.auto_create or use_template
    if use_template:
        print(f"[ingest-reading] notetype={READING_DEEP} ({notetype_id})  deck_template={args.deck_template!r}")
    else:
        deck_id = resolve_deck_id(args.base, args.deck, auto_create=auto_create)
        print(f"[ingest-reading] notetype={READING_DEEP} ({notetype_id})  deck={args.deck} ({deck_id})")
    deck_id_cache: dict[str, int] = {}

    cards = load_cards()
    ingested = load_ingested()

    if args.only:
        cards = [c for c in cards if c.get("_meta", {}).get("id") == args.only]
        if not cards:
            sys.exit(f"no card with id={args.only!r} found")

    pending = [c for c in cards if c["_meta"]["id"] not in ingested]
    print(f"[ingest-reading] {len(pending)} pending of {len(cards)} ({len(ingested)} already ingested)")

    INGESTED_TXT.parent.mkdir(parents=True, exist_ok=True)
    ok = fail = 0
    with INGESTED_TXT.open("a", encoding="utf-8") as ingested_fh:
        for card in pending:
            cid = card["_meta"]["id"]
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
                ingested_fh.write(cid + "\n")
                ingested_fh.flush()
                ok += 1
                deck_label = f" → {deck_name}" if use_template else ""
                print(f"  ok    {cid:30}  note_id={resp['note_id']}  cards={resp['card_count']}{deck_label}")
            except Exception as exc:  # noqa: BLE001
                fail += 1
                print(f"  FAIL  {cid:30}  {type(exc).__name__}: {exc}")

    print(f"\n[ingest-reading] done: ok={ok} fail={fail}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
