#!/usr/bin/env python3
"""Ingest cloze cards.jsonl into the running anki_server collection.

Sister script to ingest_toeic_cards.py — same architecture but targets
the Cloze-Deep notetype (4 fields: Text/Why/Example/Source). Tracking key
is `_meta.id` (e.g. "responsible-for" or "immense") since cloze cards have
no single-word Front identifier.

Profile-driven: pass `--profile decks/<name>.json` (e.g. `sesame_cloze`)
to read `<data_dir>/cards.jsonl`, route to `profile.deck` /
`profile.deck_template`, and tag `[profile.name, "cloze", level-…,
category-…, theme-…]`. Without the flag, defaults to the historical TOEIC
cloze paths (`data/toeic/cloze_cards.jsonl` / `cloze_ingested.txt`),
notetype `"Cloze-Deep"`, the `--deck` / `--deck-template` flags, and tags
`["toeic","cloze",…]`. CLI `--deck` / `--deck-template` override the
profile's routing when both are present.

Usage:
    ./scripts/ingest_toeic_cloze.py                                    # legacy → Default deck
    ./scripts/ingest_toeic_cloze.py --deck "TOEIC::Cloze::Pilot"
    ./scripts/ingest_toeic_cloze.py --deck-template "TOEIC::Cloze::L{level}"
    ./scripts/ingest_toeic_cloze.py --profile sesame_cloze --auto-create
    ./scripts/ingest_toeic_cloze.py --profile sesame_cloze --base https://… --login user:pass --force
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _profile import DeckProfile, load_profile  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
LEGACY_CARDS_IN = REPO_ROOT / "data" / "toeic" / "cloze_cards.jsonl"
LEGACY_INGESTED_TXT = REPO_ROOT / "data" / "toeic" / "cloze_ingested.txt"

CLOZE_DEEP = "Cloze-Deep"
FIELD_ORDER = ("Text", "Why", "Example", "Source")
DEFAULT_BASE = "http://127.0.0.1:40001"
DEFAULT_DECK = "Default"
DEFAULT_DECK_TEMPLATE = None

# Cookie-aware opener so `--login` lets this script hit a session-guarded
# server (e.g. the deployed instance). Without `--login` it behaves exactly
# like the bare urlopen this file used before.
_OPENER = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
)


@dataclass(frozen=True)
class IngestConfig:
    """Resolved per-run config: paths + notetype + tag prefix.

    Built from a DeckProfile (`--profile`) or the legacy module-level
    constants. Deck routing is resolved separately so CLI overrides apply.
    """

    cards_in: Path
    ingested_txt: Path
    notetype_name: str
    tag_prefix: list[str]

    @classmethod
    def from_profile(cls, profile: DeckProfile) -> "IngestConfig":
        return cls(
            cards_in=profile.cards,
            ingested_txt=profile.ingested,
            notetype_name=profile.notetype,
            tag_prefix=[profile.name, "cloze"],
        )

    @classmethod
    def legacy(cls) -> "IngestConfig":
        return cls(
            cards_in=LEGACY_CARDS_IN,
            ingested_txt=LEGACY_INGESTED_TXT,
            notetype_name=CLOZE_DEEP,
            tag_prefix=["toeic", "cloze"],
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
    print(f"[ingest-cloze] logged in as {username!r} — session cookie attached")


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


def load_cards(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def load_ingested(path: Path, force: bool) -> set[str]:
    if force or not path.exists():
        return set()
    return {ln.strip() for ln in path.read_text().splitlines() if ln.strip()}


def build_tags(prefix: list[str], card: dict) -> list[str]:
    tags = list(prefix)
    meta = card.get("_meta", {})
    if level := meta.get("level"):
        tags.append(f"level-{level}")
    if category := meta.get("category"):
        tags.append(f"category-{category}")
    if theme := meta.get("theme"):
        tags.append(f"theme-{theme}")
    return tags


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--profile", default=None,
                    help="path or shorthand for deck profile (e.g. 'sesame_cloze' → "
                         "decks/sesame_cloze.json). Default = legacy TOEIC cloze paths.")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--login", default=None, metavar="USER:PASS",
                    help="authenticate before ingesting — needed for a session-guarded "
                         "server like https://ferdinand.zeabur.app. Format: username:password")
    ap.add_argument("--deck", default=None,
                    help="single-deck name. Overrides the profile's deck. Default (legacy): "
                         f"{DEFAULT_DECK!r}")
    ap.add_argument("--deck-template", default=None,
                    help="route via _meta keys, e.g. 'TOEIC::Cloze::L{level}'. Overrides the "
                         "profile's deck_template. Implies --auto-create.")
    ap.add_argument("--auto-create", action="store_true")
    ap.add_argument("--force", action="store_true",
                    help="ignore ingested.txt contents (re-ingest everything, e.g. into a "
                         "different user's collection). Successful ids are still appended.")
    ap.add_argument("--only", default=None, help="ingest one specific cloze id")
    args = ap.parse_args()

    if args.login:
        if ":" not in args.login:
            sys.exit("--login must be USERNAME:PASSWORD")
        _user, _pw = args.login.split(":", 1)
        login(args.base, _user, _pw)

    if args.profile:
        profile = load_profile(args.profile)
        cfg = IngestConfig.from_profile(profile)
        prof_deck = profile.deck
        prof_template = profile.deck_template
    else:
        cfg = IngestConfig.legacy()
        prof_deck = DEFAULT_DECK
        prof_template = DEFAULT_DECK_TEMPLATE

    # CLI overrides win. If CLI sets exactly one of --deck / --deck-template,
    # that one wins outright (the other is cleared).
    if args.deck and args.deck_template:
        sys.exit("conflicting deck routing: pass only one of --deck / --deck-template")
    if args.deck:
        deck_name, deck_template = args.deck, None
    elif args.deck_template:
        deck_name, deck_template = None, args.deck_template
    else:
        deck_name, deck_template = prof_deck, prof_template
    if deck_name and deck_template:
        sys.exit("conflicting deck routing: profile specifies both deck and deck_template")
    if not deck_name and not deck_template:
        sys.exit("no deck routing: specify --deck or --deck-template")

    if not cfg.cards_in.exists():
        sys.exit(f"cards file missing: {cfg.cards_in}")

    notetype_id = resolve_notetype_id(args.base, cfg.notetype_name)
    use_template = bool(deck_template)
    auto_create = args.auto_create or use_template
    if use_template:
        print(f"[ingest-cloze] notetype={cfg.notetype_name} ({notetype_id})  "
              f"deck_template={deck_template!r}")
    else:
        deck_id = resolve_deck_id(args.base, deck_name, auto_create=auto_create)
        print(f"[ingest-cloze] notetype={cfg.notetype_name} ({notetype_id})  "
              f"deck={deck_name} ({deck_id})")
    deck_id_cache: dict[str, int] = {}

    cards = load_cards(cfg.cards_in)
    ingested = load_ingested(cfg.ingested_txt, args.force)

    if args.only:
        cards = [c for c in cards if c.get("_meta", {}).get("id") == args.only]
        if not cards:
            sys.exit(f"no card with id={args.only!r} found")

    pending = [c for c in cards if c["_meta"]["id"] not in ingested]
    print(f"[ingest-cloze] {len(pending)} pending of {len(cards)} ({len(ingested)} already ingested)")

    cfg.ingested_txt.parent.mkdir(parents=True, exist_ok=True)
    ok = fail = 0
    with cfg.ingested_txt.open("a", encoding="utf-8") as ingested_fh:
        for card in pending:
            cid = card["_meta"]["id"]
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
                    "tags": build_tags(cfg.tag_prefix, card),
                }
                resp = http_post_json(f"{args.base}/api/notes", payload)
                ingested_fh.write(cid + "\n")
                ingested_fh.flush()
                ok += 1
                deck_label = f" → {routed_deck}" if use_template else ""
                print(f"  ok    {cid:25}  note_id={resp['note_id']}  cards={resp['card_count']}{deck_label}")
            except Exception as exc:  # noqa: BLE001
                fail += 1
                print(f"  FAIL  {cid:25}  {type(exc).__name__}: {exc}")

    print(f"\n[ingest-cloze] done: ok={ok} fail={fail}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
