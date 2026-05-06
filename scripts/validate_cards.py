#!/usr/bin/env python3
"""Validate generated vocabulary cards against schema + heuristic quality rules.

Phase D of the per-deck card workflow. Reads <data_dir>/cards.jsonl, runs
each card through a chain of checks, writes a report to stdout and a
machine-readable rejected-cards file to <data_dir>/cards.invalid.jsonl.

Checks fall into two tiers:
- HARD (must pass): schema completeness, field non-emptiness, Front match,
  Example contains target word, Back lacks target word, Source format
  (regex from deck profile), ReverseEnabled value.
- SOFT (warning, doesn't reject): Why length, Example word count,
  Mnemonic vividness heuristic, Contrast English-word presence.

Profile-driven: pass `--profile decks/<name>.json` to validate against a
different deck. Without the flag, defaults to the historical TOEIC vocab
paths + Source regex.

Usage:
    ./scripts/validate_cards.py                          # TOEIC default
    ./scripts/validate_cards.py --profile sesame         # Sesame Street
    ./scripts/validate_cards.py --verbose                # per-card output
    ./scripts/validate_cards.py --strict                 # soft warns → fail
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _profile import DeckProfile, default_toeic_profile, load_profile  # noqa: E402

REQUIRED_FIELDS = (
    "Front", "Back", "Why", "Example",
    "Contrast", "Mnemonic", "Source", "ReverseEnabled",
)
EXAMPLE_MIN_WORDS = 12
EXAMPLE_MAX_WORDS = 25
WHY_MAX_CHARS = 80  # 60 specced, 80 tolerance for Chinese punctuation
MNEMONIC_MIN_CHARS = 25

ENGLISH_WORD_RE = re.compile(r"\b[A-Za-z]{2,}\b")
POS_TAG_RE = re.compile(r"\((v|n|adj|adv)\.\)")
# Mnemonic vividness — at least one cue indicating concrete imagery, scene,
# wordplay, or morpheme breakdown. Not perfect but catches the worst offenders
# (pure abstract restatement).
VIVIDNESS_CUES = (
    "想像", "想像中", "畫面", "聲音", "看到", "聽起來", "拆成", "音近",
    "音似", "音同", "→", "+", "-", "「", "如同", "彷彿", "好像",
)


def load_wordlist_index(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as fh:
        return {json.loads(l)["word"]: json.loads(l) for l in fh if l.strip()}


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z']+", text))


def english_words_excluding(text: str, exclude: str) -> list[str]:
    return [w for w in ENGLISH_WORD_RE.findall(text) if w.lower() != exclude.lower()]


def hard_checks(card: dict, expected_word: str | None, source_regex: re.Pattern[str]) -> list[str]:
    errors: list[str] = []
    for field in REQUIRED_FIELDS:
        if field not in card:
            errors.append(f"missing field: {field}")
        elif not isinstance(card[field], str) or not card[field].strip():
            errors.append(f"empty or non-string field: {field}")
    if errors:
        return errors

    front = card["Front"].strip()
    if expected_word and front.lower() != expected_word.lower():
        errors.append(f"Front {front!r} != wordlist word {expected_word!r}")
    if expected_word and expected_word.lower() not in card["Example"].lower():
        errors.append(f"Example missing target word {expected_word!r}")
    if front.lower() in card["Back"].lower():
        errors.append(f"Back contains the English word {front!r}")
    if not source_regex.match(card["Source"]):
        errors.append(f"Source format invalid: {card['Source']!r}")
    if card["ReverseEnabled"] != "1":
        errors.append(f"ReverseEnabled must be \"1\", got {card['ReverseEnabled']!r}")
    return errors


def soft_checks(card: dict) -> list[str]:
    warnings: list[str] = []
    if not POS_TAG_RE.search(card["Back"]):
        warnings.append("Back missing POS tag like (v.)/(n.)/(adj.)/(adv.)")
    why_len = len(card["Why"])
    if why_len > WHY_MAX_CHARS:
        warnings.append(f"Why is {why_len} chars (>{WHY_MAX_CHARS} threshold)")
    wc = word_count(card["Example"])
    if wc < EXAMPLE_MIN_WORDS:
        warnings.append(f"Example only {wc} words (<{EXAMPLE_MIN_WORDS})")
    elif wc > EXAMPLE_MAX_WORDS:
        warnings.append(f"Example has {wc} words (>{EXAMPLE_MAX_WORDS})")
    front = card["Front"].strip()
    contrast_others = english_words_excluding(card["Contrast"], front)
    if not contrast_others:
        warnings.append("Contrast names no other English word — required for semantic-near comparison")
    mnemonic = card["Mnemonic"]
    if len(mnemonic) < MNEMONIC_MIN_CHARS:
        warnings.append(f"Mnemonic only {len(mnemonic)} chars (<{MNEMONIC_MIN_CHARS}) — likely too thin")
    if not any(cue in mnemonic for cue in VIVIDNESS_CUES):
        warnings.append("Mnemonic has no vividness cue (想像/拆成/音近/→/+/「) — may be abstract")
    return warnings


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--profile", default=None,
                    help="path or shorthand for deck profile (e.g. 'sesame' → decks/sesame.json). "
                         "Default = legacy TOEIC vocab paths + Source regex.")
    ap.add_argument("--verbose", action="store_true", help="print result for every card")
    ap.add_argument("--strict", action="store_true", help="treat soft warnings as failures")
    return ap.parse_args()


def main() -> int:
    args = parse_args()
    profile = load_profile(args.profile) if args.profile else default_toeic_profile()
    print(f"[validate] profile={profile.name} cards={profile.cards.relative_to(profile.cards.parents[1])}")

    if not profile.cards.exists():
        sys.exit(f"cards file missing: {profile.cards}")

    wordlist = load_wordlist_index(profile.wordlist)
    cards = []
    with profile.cards.open(encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                cards.append(json.loads(line))

    print(f"[validate] {len(cards)} cards from {profile.cards.name}")
    print(f"[validate] {len(wordlist)} words in wordlist for cross-reference")
    print()

    rejected: list[dict] = []
    soft_warning_count = 0
    soft_warning_kinds: dict[str, int] = {}
    hard_only_kinds: dict[str, int] = {}

    for card in cards:
        front = card.get("Front", "?").strip()
        wordlist_entry = wordlist.get(front)
        expected_word = wordlist_entry["word"] if wordlist_entry else None

        hard_errs = hard_checks(card, expected_word, profile.source_regex)
        soft_warns = soft_checks(card)

        is_failure = bool(hard_errs) or (args.strict and soft_warns)
        for w in soft_warns:
            kind = w.split(" — ")[0].split(":")[0].split(" (")[0]
            soft_warning_kinds[kind] = soft_warning_kinds.get(kind, 0) + 1
        for e in hard_errs:
            kind = e.split(":")[0].split(" — ")[0]
            hard_only_kinds[kind] = hard_only_kinds.get(kind, 0) + 1

        if soft_warns:
            soft_warning_count += 1

        if is_failure:
            rejected.append({
                "front": front,
                "hard_errors": hard_errs,
                "soft_warnings": soft_warns,
                "card": card,
            })

        if args.verbose or is_failure:
            status = "FAIL" if is_failure else ("WARN" if soft_warns else "ok  ")
            print(f"  {status}  {front:14}", end="")
            if hard_errs:
                print(f"  HARD={len(hard_errs)}: {'; '.join(hard_errs)[:100]}")
            elif soft_warns:
                print(f"  warns={len(soft_warns)}: {'; '.join(soft_warns)[:120]}")
            else:
                print()

    print()
    print("=" * 70)
    print(f"[validate] cards={len(cards)}  failed={len(rejected)}  with_soft_warnings={soft_warning_count}")
    if hard_only_kinds:
        print("\nHard-error breakdown:")
        for k, v in sorted(hard_only_kinds.items(), key=lambda x: -x[1]):
            print(f"  {v:4}  {k}")
    if soft_warning_kinds:
        print("\nSoft-warning breakdown:")
        for k, v in sorted(soft_warning_kinds.items(), key=lambda x: -x[1]):
            print(f"  {v:4}  {k}")

    if rejected:
        profile.invalid.parent.mkdir(parents=True, exist_ok=True)
        with profile.invalid.open("w", encoding="utf-8") as fh:
            for r in rejected:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"\n[validate] rejected cards written to {profile.invalid}")

    return 0 if not rejected else 1


if __name__ == "__main__":
    sys.exit(main())
