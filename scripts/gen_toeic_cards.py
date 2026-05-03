#!/usr/bin/env python3
"""Generate TOEIC vocabulary cards by calling `gemini -p` per word.

Pipeline phase C of the TOEIC card workflow:
    A. data/toeic/wordlist.jsonl    (Claude curates)
    B. prompts/toeic_card.md        (Claude writes)
 -> C. data/toeic/cards.jsonl       (this script appends)
    D. scripts/validate_cards.py    (TBD)
    E. anki_server REST ingest      (TBD)

Idempotent: skips words already present in done.txt. Resumable after Ctrl-C.
Append-only writes — never rewrites cards.jsonl, so parallel workers cannot
corrupt earlier output beyond a single newline boundary (file-lock guarded).

Usage:
    ./scripts/gen_toeic_cards.py                # serial, all pending words
    ./scripts/gen_toeic_cards.py --limit 1      # smoke test
    ./scripts/gen_toeic_cards.py --workers 4    # parallel
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

REPO_ROOT = Path(__file__).resolve().parent.parent
PROMPT_PATH = REPO_ROOT / "prompts" / "toeic_card.md"
WORDLIST = REPO_ROOT / "data" / "toeic" / "wordlist.jsonl"
CARDS_OUT = REPO_ROOT / "data" / "toeic" / "cards.jsonl"
DONE_TXT = REPO_ROOT / "data" / "toeic" / "done.txt"
FAILED_OUT = REPO_ROOT / "data" / "toeic" / "failed.jsonl"

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


def load_wordlist() -> list[dict]:
    with WORDLIST.open() as fh:
        return [json.loads(line) for line in fh if line.strip()]


def load_done() -> set[str]:
    if not DONE_TXT.exists():
        return set()
    return {ln.strip() for ln in DONE_TXT.read_text().splitlines() if ln.strip()}


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


def write_success(card: dict, word: str) -> None:
    with write_lock:
        with CARDS_OUT.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(card, ensure_ascii=False) + "\n")
        with DONE_TXT.open("a", encoding="utf-8") as fh:
            fh.write(word + "\n")


def write_failure(entry: dict, err: str) -> None:
    with write_lock:
        with FAILED_OUT.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"entry": entry, "error": err}, ensure_ascii=False) + "\n")


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--workers", type=int, default=1, help="parallel gemini calls (default 1)")
    ap.add_argument("--limit", type=int, default=None, help="cap pending words this run")
    ap.add_argument("--rate-sleep", type=float, default=0.5,
                    help="sleep seconds between submissions (serial mode only)")
    ap.add_argument("--model", default=None, help="override gemini -m")
    return ap.parse_args()


def main() -> int:
    args = parse_args()
    if not PROMPT_PATH.exists():
        sys.exit(f"prompt template missing: {PROMPT_PATH}")
    if not WORDLIST.exists():
        sys.exit(f"wordlist missing: {WORDLIST}")

    template = PROMPT_PATH.read_text(encoding="utf-8")
    wordlist = load_wordlist()
    done = load_done()
    pending = [e for e in wordlist if e["word"] not in done]
    if args.limit:
        pending = pending[: args.limit]

    print(f"[gen] {len(pending)} pending of {len(wordlist)} total ({len(done)} already done)")
    if not pending:
        return 0

    CARDS_OUT.parent.mkdir(parents=True, exist_ok=True)
    ok = fail = 0

    def handle(entry: dict, status: str, payload: dict, err: str | None) -> None:
        nonlocal ok, fail
        if status == "ok":
            write_success(payload, entry["word"])
            ok += 1
            print(f"  ok    {entry['word']}")
        else:
            write_failure(entry, err or "unknown")
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

    print(f"\n[gen] done: ok={ok} fail={fail} -> {CARDS_OUT}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
