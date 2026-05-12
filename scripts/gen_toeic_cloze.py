#!/usr/bin/env python3
"""Generate Cloze cards by calling `gemini -p` per phrase.

Sister script to gen_toeic_cards.py — same architecture (parallel
subprocess driver, idempotent done.txt, schema validation, retries) but
targets the Cloze-Deep notetype (Text/Why/Example/Source) instead of
Concept-Deep.

Profile-driven: pass `--profile decks/<name>.json` to target a different
deck (e.g. `--profile sesame_cloze`). Without the flag, defaults to the
historical TOEIC cloze paths (`data/toeic/cloze_*`) + the exact-string
Source check, so legacy invocations keep working.

Pipeline:
    A. <wordlist>.jsonl           (Claude curates phrases + cloze targets)
    B. <prompt>.md                (Claude writes prompt)
 -> C. <cards>.jsonl              (this script appends)
    D. validate inline / validate_cards.py
    E. ingest with the Cloze-Deep notetype

Usage:
    ./scripts/gen_toeic_cloze.py                            # TOEIC cloze default
    ./scripts/gen_toeic_cloze.py --profile sesame_cloze     # Sesame cloze
    ./scripts/gen_toeic_cloze.py --profile sesame_cloze --limit 1
    ./scripts/gen_toeic_cloze.py --workers 4
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _profile import DeckProfile, load_profile  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent

# Legacy (no --profile) module-level paths — preserved verbatim.
LEGACY_PROMPT_PATH = REPO_ROOT / "prompts" / "toeic_cloze.md"
LEGACY_WORDLIST = REPO_ROOT / "data" / "toeic" / "cloze_wordlist.jsonl"
LEGACY_CARDS_OUT = REPO_ROOT / "data" / "toeic" / "cloze_cards.jsonl"
LEGACY_DONE_TXT = REPO_ROOT / "data" / "toeic" / "cloze_done.txt"
LEGACY_FAILED_OUT = REPO_ROOT / "data" / "toeic" / "cloze_failed.jsonl"

REQUIRED_FIELDS = ("Text", "Why", "Example", "Source")
GEMINI_TIMEOUT_S = 180
MAX_RETRIES = 2
RETRY_BACKOFF_S = (2, 5)

JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)
CLOZE_RE = re.compile(r"\{\{c1::([^}]+?)\}\}")

write_lock = threading.Lock()


@dataclass(frozen=True)
class RunPaths:
    """Resolved per-run paths + Source-validation strategy.

    Built either from a DeckProfile (`--profile`) or from the legacy
    module-level constants. Keeps main() single-path.
    """

    prompt_path: Path
    wordlist: Path
    cards_out: Path
    done_txt: Path
    failed_out: Path
    profile: DeckProfile | None  # None => legacy exact-string Source check

    @classmethod
    def from_profile(cls, profile: DeckProfile) -> "RunPaths":
        return cls(
            prompt_path=profile.prompt_path,
            wordlist=profile.wordlist,
            cards_out=profile.cards,
            done_txt=profile.done,
            failed_out=profile.failed,
            profile=profile,
        )

    @classmethod
    def legacy(cls) -> "RunPaths":
        return cls(
            prompt_path=LEGACY_PROMPT_PATH,
            wordlist=LEGACY_WORDLIST,
            cards_out=LEGACY_CARDS_OUT,
            done_txt=LEGACY_DONE_TXT,
            failed_out=LEGACY_FAILED_OUT,
            profile=None,
        )


def load_wordlist(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as fh:
        return [json.loads(l) for l in fh if l.strip()]


def load_done(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {ln.strip() for ln in path.read_text().splitlines() if ln.strip()}


def render_prompt(template: str, entry: dict) -> str:
    out = template
    for key, val in entry.items():
        out = out.replace(f"__{key.upper()}__", str(val))
    return out


def call_gemini(prompt: str, model: str | None) -> str:
    cmd = ["gemini", "-p", prompt]
    if model:
        cmd[1:1] = ["-m", model]
    proc = subprocess.run(
        cmd, capture_output=True, text=True, timeout=GEMINI_TIMEOUT_S
    )
    if proc.returncode != 0:
        raise RuntimeError(f"gemini exit {proc.returncode}: {proc.stderr.strip()[:300]}")
    return proc.stdout


def extract_json(text: str) -> dict:
    fence_match = JSON_FENCE_RE.search(text)
    candidates = []
    if fence_match:
        candidates.append(fence_match.group(1))
    stripped = text.strip()
    candidates.append(stripped)
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        candidates.append(stripped[start : end + 1])
    for raw in candidates:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            continue
    raise ValueError(f"no JSON object found in response (first 200 chars): {text[:200]!r}")


def validate_card(card: dict, entry: dict, profile: DeckProfile | None) -> list[str]:
    errors: list[str] = []
    for field in REQUIRED_FIELDS:
        if field not in card:
            errors.append(f"missing field: {field}")
        elif not isinstance(card[field], str) or not card[field].strip():
            errors.append(f"empty or non-string field: {field}")
    if errors:
        return errors

    cloze_matches = CLOZE_RE.findall(card["Text"])
    if len(cloze_matches) != 1:
        errors.append(f"Text must contain exactly one {{{{c1::...}}}}, found {len(cloze_matches)}")
    elif cloze_matches[0].strip() != entry["cloze_part"].strip():
        errors.append(
            f"cloze content {cloze_matches[0]!r} != expected cloze_part {entry['cloze_part']!r}"
        )
    if entry["phrase"].lower() not in card["Example"].lower():
        errors.append(f"Example missing target phrase {entry['phrase']!r}")
    if profile is not None:
        if not profile.source_regex.match(card["Source"]):
            errors.append(
                f"Source {card['Source']!r} fails profile regex {profile.source_regex.pattern}"
            )
    else:
        expected_source = f"TOEIC cloze level {entry['level']} — {entry['category']}"
        if card["Source"] != expected_source:
            errors.append(f"Source mismatch: {card['Source']!r} != {expected_source!r}")
    return errors


def gen_one(
    template: str, entry: dict, model: str | None, profile: DeckProfile | None
) -> tuple[str, dict, str | None]:
    eid = entry["id"]
    last_err: str | None = None
    for attempt in range(MAX_RETRIES + 1):
        if attempt > 0:
            time.sleep(RETRY_BACKOFF_S[min(attempt - 1, len(RETRY_BACKOFF_S) - 1)])
        try:
            prompt = render_prompt(template, entry)
            output = call_gemini(prompt, model)
            card = extract_json(output)
            errors = validate_card(card, entry, profile)
            if errors:
                last_err = "schema: " + "; ".join(errors)
                continue
            card["_meta"] = {k: entry[k] for k in entry if k != "id"}
            card["_meta"]["id"] = eid  # keep id in meta for traceability
            return "ok", card, None
        except subprocess.TimeoutExpired:
            last_err = f"gemini timeout after {GEMINI_TIMEOUT_S}s"
        except Exception as exc:  # noqa: BLE001
            last_err = f"{type(exc).__name__}: {exc}"
    return "fail", entry, last_err


def write_success(paths: RunPaths, card: dict, eid: str) -> None:
    with write_lock:
        with paths.cards_out.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(card, ensure_ascii=False) + "\n")
        with paths.done_txt.open("a", encoding="utf-8") as fh:
            fh.write(eid + "\n")


def write_failure(paths: RunPaths, entry: dict, err: str) -> None:
    with write_lock:
        with paths.failed_out.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"entry": entry, "error": err}, ensure_ascii=False) + "\n")


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--profile", default=None,
                    help="path or shorthand for deck profile (e.g. 'sesame_cloze' → "
                         "decks/sesame_cloze.json). Default = legacy TOEIC cloze paths.")
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--rate-sleep", type=float, default=0.5)
    ap.add_argument("--model", default=None)
    return ap.parse_args()


def main() -> int:
    args = parse_args()
    if args.profile:
        profile = load_profile(args.profile)
        paths = RunPaths.from_profile(profile)
        print(f"[gen-cloze] profile={profile.name} prompt={paths.prompt_path.name} "
              f"data_dir={paths.cards_out.parent.name}")
    else:
        paths = RunPaths.legacy()
        print("[gen-cloze] legacy TOEIC cloze paths (no --profile)")

    if not paths.prompt_path.exists():
        sys.exit(f"prompt template missing: {paths.prompt_path}")
    if not paths.wordlist.exists():
        sys.exit(f"wordlist missing: {paths.wordlist}")

    template = paths.prompt_path.read_text(encoding="utf-8")
    wordlist = load_wordlist(paths.wordlist)
    done = load_done(paths.done_txt)
    pending = [e for e in wordlist if e["id"] not in done]
    if args.limit:
        pending = pending[: args.limit]

    print(f"[gen-cloze] {len(pending)} pending of {len(wordlist)} total ({len(done)} done)")
    if not pending:
        return 0

    paths.cards_out.parent.mkdir(parents=True, exist_ok=True)
    ok = fail = 0

    def handle(entry: dict, status: str, payload: dict, err: str | None) -> None:
        nonlocal ok, fail
        if status == "ok":
            write_success(paths, payload, entry["id"])
            ok += 1
            print(f"  ok    {entry['id']}")
        else:
            write_failure(paths, entry, err or "unknown")
            fail += 1
            print(f"  FAIL  {entry['id']}: {(err or '')[:160]}")

    if args.workers <= 1:
        for entry in pending:
            time.sleep(args.rate_sleep)
            status, payload, err = gen_one(template, entry, args.model, paths.profile)
            handle(entry, status, payload, err)
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = {
                ex.submit(gen_one, template, e, args.model, paths.profile): e
                for e in pending
            }
            for fut in as_completed(futures):
                entry = futures[fut]
                status, payload, err = fut.result()
                handle(entry, status, payload, err)

    print(f"\n[gen-cloze] done: ok={ok} fail={fail} -> {paths.cards_out}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
