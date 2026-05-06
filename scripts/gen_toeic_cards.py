#!/usr/bin/env python3
"""Generate vocabulary cards by calling `gemini -p` per word.

Pipeline phase C of the per-deck card workflow:
    A. <data_dir>/wordlist.jsonl    (Claude curates)
    B. <prompt_path>                (Claude writes per-deck)
 -> C. <data_dir>/cards.jsonl       (this script appends)
    D. scripts/validate_cards.py    (schema + soft heuristics)
    E. scripts/ingest_<type>.py     (POST /api/notes)

Idempotent: skips words already present in done.txt. Resumable after Ctrl-C.
Append-only writes — never rewrites cards.jsonl, so parallel workers cannot
corrupt earlier output beyond a single newline boundary (file-lock guarded).

Profile-driven: pass `--profile decks/<name>.json` to target a different
deck. Without the flag, defaults to the historical TOEIC vocab paths so
legacy invocations keep working.

Usage:
    ./scripts/gen_toeic_cards.py                          # TOEIC default
    ./scripts/gen_toeic_cards.py --profile sesame         # Sesame Street
    ./scripts/gen_toeic_cards.py --profile sesame --limit 1
    ./scripts/gen_toeic_cards.py --profile sesame --workers 4
    ./scripts/gen_toeic_cards.py --model gemini-2.5-flash
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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _profile import DeckProfile, default_toeic_profile, load_profile  # noqa: E402

REQUIRED_FIELDS = (
    "Front", "Back", "Why", "Example",
    "Contrast", "Mnemonic", "Source", "ReverseEnabled",
)
GEMINI_TIMEOUT_S = 180
MAX_RETRIES = 2
RETRY_BACKOFF_S = (2, 5)  # sleep before retry attempts 1, 2

# Gemini may wrap output in ```json ... ``` or ``` ... ``` blocks.
JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)

write_lock = threading.Lock()


def load_wordlist(path: Path) -> list[dict]:
    with path.open() as fh:
        return [json.loads(line) for line in fh if line.strip()]


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
    """Pull the first JSON object out of Gemini's response.

    Tries fenced ```json blocks first, then falls back to
    {first '{' ... last '}'}. Raises ValueError on parse failure.
    """
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


def validate_card(card: dict, word: str) -> list[str]:
    errors: list[str] = []
    for field in REQUIRED_FIELDS:
        if field not in card:
            errors.append(f"missing field: {field}")
        elif not isinstance(card[field], str):
            errors.append(f"field {field} is not a string: {type(card[field]).__name__}")
    if errors:
        return errors
    if not card["Front"].strip():
        errors.append("Front is empty")
    if not card["Back"].strip():
        errors.append("Back is empty")
    if word.lower() not in card["Example"].lower():
        errors.append(f"Example does not contain target word '{word}'")
    if card["ReverseEnabled"] != "1":
        errors.append(f"ReverseEnabled must be '1', got {card['ReverseEnabled']!r}")
    return errors


def gen_one(template: str, entry: dict, model: str | None) -> tuple[str, dict, str | None]:
    """Returns (status, payload, error). status is 'ok' or 'fail'."""
    word = entry["word"]
    last_err: str | None = None
    for attempt in range(MAX_RETRIES + 1):
        if attempt > 0:
            time.sleep(RETRY_BACKOFF_S[min(attempt - 1, len(RETRY_BACKOFF_S) - 1)])
        try:
            prompt = render_prompt(template, entry)
            output = call_gemini(prompt, model)
            card = extract_json(output)
            errors = validate_card(card, word)
            if errors:
                last_err = "schema: " + "; ".join(errors)
                continue
            # Stash original wordlist metadata for downstream auditing
            card["_meta"] = {k: entry[k] for k in entry if k != "word"}
            return "ok", card, None
        except subprocess.TimeoutExpired:
            last_err = f"gemini timeout after {GEMINI_TIMEOUT_S}s"
        except Exception as exc:  # noqa: BLE001 — driver must not crash on one bad word
            last_err = f"{type(exc).__name__}: {exc}"
    return "fail", entry, last_err


def write_success(profile: DeckProfile, card: dict, word: str) -> None:
    with write_lock:
        with profile.cards.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(card, ensure_ascii=False) + "\n")
        with profile.done.open("a", encoding="utf-8") as fh:
            fh.write(word + "\n")


def write_failure(profile: DeckProfile, entry: dict, err: str) -> None:
    with write_lock:
        with profile.failed.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"entry": entry, "error": err}, ensure_ascii=False) + "\n")


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--profile", default=None,
                    help="path or shorthand for deck profile (e.g. 'sesame' → decks/sesame.json). "
                         "Default = legacy TOEIC vocab paths.")
    ap.add_argument("--workers", type=int, default=1, help="parallel gemini calls (default 1)")
    ap.add_argument("--limit", type=int, default=None, help="cap pending words this run")
    ap.add_argument("--rate-sleep", type=float, default=0.5,
                    help="sleep seconds between submissions (serial mode only)")
    ap.add_argument("--model", default=None, help="override gemini -m")
    return ap.parse_args()


def main() -> int:
    args = parse_args()
    profile = load_profile(args.profile) if args.profile else default_toeic_profile()
    print(f"[gen] profile={profile.name} prompt={profile.prompt_path.relative_to(profile.prompt_path.parents[1])} "
          f"data_dir={profile.data_dir.name}")

    if not profile.prompt_path.exists():
        sys.exit(f"prompt template missing: {profile.prompt_path}")
    if not profile.wordlist.exists():
        sys.exit(f"wordlist missing: {profile.wordlist}")

    template = profile.prompt_path.read_text(encoding="utf-8")
    wordlist = load_wordlist(profile.wordlist)
    done = load_done(profile.done)
    pending = [e for e in wordlist if e["word"] not in done]
    if args.limit:
        pending = pending[: args.limit]

    print(f"[gen] {len(pending)} pending of {len(wordlist)} total ({len(done)} already done)")
    if not pending:
        return 0

    profile.cards.parent.mkdir(parents=True, exist_ok=True)
    ok = fail = 0

    def handle(entry: dict, status: str, payload: dict, err: str | None) -> None:
        nonlocal ok, fail
        if status == "ok":
            write_success(profile, payload, entry["word"])
            ok += 1
            print(f"  ok    {entry['word']}")
        else:
            write_failure(profile, entry, err or "unknown")
            fail += 1
            print(f"  FAIL  {entry['word']}: {(err or '')[:160]}")

    if args.workers <= 1:
        for entry in pending:
            time.sleep(args.rate_sleep)
            status, payload, err = gen_one(template, entry, args.model)
            handle(entry, status, payload, err)
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = {ex.submit(gen_one, template, e, args.model): e for e in pending}
            for fut in as_completed(futures):
                entry = futures[fut]
                status, payload, err = fut.result()
                handle(entry, status, payload, err)

    print(f"\n[gen] done: ok={ok} fail={fail} -> {profile.cards}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
