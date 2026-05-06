"""Deck profile loader — single source of truth for per-deck paths.

A profile is a small JSON file under `decks/<name>.json` describing one
deck's full pipeline:

    {
      "name": "sesame",
      "deck": "Sesame Street English",
      "notetype": "Concept-Deep",
      "data_dir": "data/sesame",
      "prompt": "prompts/sesame_card.md",
      "source_regex": "^Sesame Street English — \\w[\\w-]*$",
      "image_field_idx": 8,
      "image_filename_prefix": "sesame"
    }

Either `deck` (single anki deck) or `deck_template` (Python format string
filled from the card's `_meta`, e.g. "TOEIC::Vocabulary::L{level}") MUST
be set; not both. All file-paths are derived from `data_dir` so the
script call sites stay flag-free in the common case.

Usage from a script:

    from _profile import load_profile, default_toeic_profile

    profile = load_profile(args.profile) if args.profile else default_toeic_profile()
    template = profile.prompt_path.read_text(encoding="utf-8")
    pending = load_jsonl(profile.wordlist)
    ...
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class DeckProfile:
    name: str
    notetype: str
    data_dir: Path
    prompt_path: Path
    source_regex: re.Pattern[str]
    deck: str | None
    deck_template: str | None
    image_field_idx: int
    image_filename_prefix: str

    @property
    def wordlist(self) -> Path:
        return self.data_dir / "wordlist.jsonl"

    @property
    def cards(self) -> Path:
        return self.data_dir / "cards.jsonl"

    @property
    def done(self) -> Path:
        return self.data_dir / "done.txt"

    @property
    def failed(self) -> Path:
        return self.data_dir / "failed.jsonl"

    @property
    def ingested(self) -> Path:
        return self.data_dir / "ingested.txt"

    @property
    def invalid(self) -> Path:
        return self.data_dir / "cards.invalid.jsonl"

    @property
    def image_done(self) -> Path:
        return self.data_dir / "image_done.txt"

    @property
    def image_skip(self) -> Path:
        return self.data_dir / "image_skip.txt"

    @property
    def image_fail(self) -> Path:
        return self.data_dir / "image_fail.jsonl"

    @property
    def image_map(self) -> Path:
        return self.data_dir / "image_map.json"


def _resolve(p: str) -> Path:
    """Profile paths are stored relative to repo root; absolute paths pass through."""
    path = Path(p)
    return path if path.is_absolute() else REPO_ROOT / path


def load_profile(path: str | Path) -> DeckProfile:
    raw_path = Path(path)
    if not raw_path.is_absolute():
        # Allow `--profile sesame` shorthand for `decks/sesame.json`.
        candidates = [
            REPO_ROOT / raw_path,
            REPO_ROOT / "decks" / raw_path,
            REPO_ROOT / "decks" / f"{raw_path}.json",
        ]
        for c in candidates:
            if c.exists():
                raw_path = c
                break
        else:
            raise FileNotFoundError(
                f"deck profile not found at any of: {[str(c) for c in candidates]}"
            )

    spec = json.loads(raw_path.read_text(encoding="utf-8"))

    deck = spec.get("deck")
    deck_template = spec.get("deck_template")
    if bool(deck) == bool(deck_template):
        raise ValueError(
            f"profile {raw_path}: must set exactly one of `deck` or `deck_template`"
        )

    return DeckProfile(
        name=spec["name"],
        notetype=spec["notetype"],
        data_dir=_resolve(spec["data_dir"]),
        prompt_path=_resolve(spec["prompt"]),
        source_regex=re.compile(spec["source_regex"]),
        deck=deck,
        deck_template=deck_template,
        image_field_idx=int(spec.get("image_field_idx", 8)),
        image_filename_prefix=spec.get("image_filename_prefix", spec["name"]),
    )


def default_toeic_profile() -> DeckProfile:
    """Backward-compat default — preserves pre-profile script behavior so
    legacy `./scripts/gen_toeic_cards.py` (no flags) keeps working.

    NOTE: this default writes to `data/toeic/wordlist.jsonl` etc. — the
    same paths the scripts used before the profile system landed.
    """
    return DeckProfile(
        name="toeic_vocab",
        notetype="Concept-Deep",
        data_dir=REPO_ROOT / "data" / "toeic",
        prompt_path=REPO_ROOT / "prompts" / "toeic_card.md",
        source_regex=re.compile(r"^TOEIC vocabulary level \d+ — \w[\w-]*$"),
        deck=None,
        deck_template="TOEIC::Vocabulary::L{level}",
        image_field_idx=8,
        image_filename_prefix="concept",
    )
