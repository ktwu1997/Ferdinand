#!/usr/bin/env python3
"""Generate TOEIC Cloze cards by calling `gemini -p` per phrase.

Sister script to gen_toeic_cards.py — same architecture (parallel
subprocess driver, idempotent done.txt, schema validation, retries) but
targets the Cloze-Deep notetype (Text/Why/Example/Source) instead of
Concept-Deep.

Pipeline:
    A. data/toeic/cloze_wordlist.jsonl    (Claude curates phrases + cloze targets)
    B. prompts/toeic_cloze.md             (Claude writes prompt)
 -> C. data/toeic/cloze_cards.jsonl       (this script appends)
    D. scripts/validate_cards.py          (TBD: cloze validator)
    E. ingest with --notetype "Cloze-Deep"

Usage:
    ./scripts/gen_toeic_cloze.py                # serial
    ./scripts/gen_toeic_cloze.py --workers 4    # parallel
    ./scripts/gen_toeic_cloze.py --limit 1      # smoke test
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
PROMPT_PATH = REPO_ROOT / "prompts" / "toeic_cloze.md"
WORDLIST = REPO_ROOT / "data" / "toeic" / "cloze_wordlist.jsonl"
CARDS_OUT = REPO_ROOT / "data" / "toeic" / "cloze_cards.jsonl"
DONE_TXT = REPO_ROOT / "data" / "toeic" / "cloze_done.txt"
FAILED_OUT = REPO_ROOT / "data" / "toeic" / "cloze_failed.jsonl"

REQUIRED_FIELDS = ("Text", "Why", "Example", "Source")
GEMINI_TIMEOUT_S = 180
MAX_RETRIES = 2
RETRY_BACKOFF_S = (2, 5)

JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)
CLOZE_RE = re.compile(r"\{\{c1::([^}]+?)\}\}")

write_lock = threading.Lock()


def load_wordlist() -> list[dict]:
    with WORDLIST.open(encoding="utf-8") as fh:
        return [json.loads(l) for l in fh if l.strip()]


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


def validate_card(card: dict, entry: dict) -> list[str]:
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
    expected_source = f"TOEIC cloze level {entry['level']} — {entry['category']}"
    if card["Source"] != expected_source:
        errors.append(f"Source mismatch: {card['Source']!r} != {expected_source!r}")
    return errors


def gen_one(template: str, entry: dict, model: str | None) -> tuple[str, dict, str | None]:
    eid = entry["id"]
    last_err: str | None = None
    for attempt in range(MAX_RETRIES + 1):
        if attempt > 0:
            time.sleep(RETRY_BACKOFF_S[min(attempt - 1, len(RETRY_BACKOFF_S) - 1)])
        try:
            prompt = render_prompt(template, entry)
            output = call_gemini(prompt, model)
            card = extract_json(output)
            errors = validate_card(card, entry)
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


def write_success(card: dict, eid: str) -> None:
    with write_lock:
        with CARDS_OUT.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(card, ensure_ascii=False) + "\n")
        with DONE_TXT.open("a", encoding="utf-8") as fh:
            fh.write(eid + "\n")


def write_failure(entry: dict, err: str) -> None:
    with write_lock:
        with FAILED_OUT.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"entry": entry, "error": err}, ensure_ascii=False) + "\n")


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--rate-sleep", type=float, default=0.5)
    ap.add_argument("--model", default=None)
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
    pending = [e for e in wordlist if e["id"] not in done]
    if args.limit:
        pending = pending[: args.limit]

    print(f"[gen-cloze] {len(pending)} pending of {len(wordlist)} total ({len(done)} done)")
    if not pending:
        return 0

    CARDS_OUT.parent.mkdir(parents=True, exist_ok=True)
    ok = fail = 0

    def handle(entry: dict, status: str, payload: dict, err: str | None) -> None:
        nonlocal ok, fail
        if status == "ok":
            write_success(payload, entry["id"])
            ok += 1
            print(f"  ok    {entry['id']}")
        else:
            write_failure(entry, err or "unknown")
            fail += 1
            print(f"  FAIL  {entry['id']}: {(err or '')[:160]}")

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

    print(f"\n[gen-cloze] done: ok={ok} fail={fail} -> {CARDS_OUT}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
