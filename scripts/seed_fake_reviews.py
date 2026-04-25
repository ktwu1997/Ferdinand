#!/usr/bin/env python3
"""Seed fake review history into a Ferdinand collection.

Phase 9-Q helper. Inserts revlog rows for every existing card so the FSRS
optimizer has data to train on. Distribution: 75% Good / 15% Hard / 7% Again
/ 3% Easy, spaced 1-7 days apart starting `--days-ago` in the past.

Stop the anki_server process before running — it holds an exclusive lock on
the SQLite collection. Re-running is idempotent in spirit (the script picks
review IDs after the highest existing revlog id) but will append more rows;
use `--reset` to clear revlog first.

Phase 9-Q finding: uniform random ratings train no better than the FSRS-rs
default model, so `POST /api/fsrs/optimize` returns `params: []` with this
data even at 1000+ items. That is correct upstream Anki behavior — see
`fsrs-5.2.0/src/model.rs::check_and_fill_parameters` which treats `Some(&[])`
as `DEFAULT_PARAMETERS` and `rslib/src/scheduler/fsrs/params.rs:147` which
keeps current_params when log-loss does not improve. The script still
validates the wire (revlog → optimizer → response → reschedule); proving
non-empty trained params requires a learnable per-card difficulty signal,
which is future work.

Usage:
    python3 scripts/seed_fake_reviews.py --db /tmp/ferdinand_dev/collection.anki2
    python3 scripts/seed_fake_reviews.py --db /path/to.anki2 --reviews-per-card 80 --reset
    python3 scripts/seed_fake_reviews.py --db /path/to.anki2 --dry-run
"""

from __future__ import annotations

import argparse
import random
import sqlite3
import sys
from pathlib import Path

# Anki revlog rating constants. See rslib/src/storage/revlog/mod.rs.
EASE_AGAIN, EASE_HARD, EASE_GOOD, EASE_EASY = 1, 2, 3, 4

# revlog.type values: 0=learning, 1=review, 2=relearning, 3=cram, 4=manual,
# 5=rescheduled. Phase 9-Q uses (0) for the first answer per card and (1)
# for subsequent ones — matches the realistic learn→review transition.
TYPE_LEARN, TYPE_REVIEW = 0, 1

EASE_DISTRIBUTION = (
    (EASE_GOOD, 0.75),
    (EASE_HARD, 0.15),
    (EASE_AGAIN, 0.07),
    (EASE_EASY, 0.03),
)


def pick_ease(rng: random.Random) -> int:
    roll = rng.random()
    cumulative = 0.0
    for ease, weight in EASE_DISTRIBUTION:
        cumulative += weight
        if roll < cumulative:
            return ease
    return EASE_GOOD


# Anki's hard ivl cap is i32. Reschedule code reads revlog and re-derives
# memory state; values beyond a year overflow practical math and (more
# importantly) break sqlite-to-i32 unmarshalling on the read path. Cap at
# one year so the seeded data round-trips through update_deck_configs.
MAX_IVL_DAYS = 365


def next_interval_days(prev_ivl: int, ease: int, rng: random.Random) -> int:
    """Toy ivl model — FSRS retrains its own intervals so the absolute values
    matter less than the (rating, time-since-last-review) signal. Capped at
    MAX_IVL_DAYS to stay well inside Anki's i32 ivl column."""
    if ease == EASE_AGAIN:
        return 1
    if ease == EASE_HARD:
        return min(MAX_IVL_DAYS, max(1, int(prev_ivl * 1.2)))
    if ease == EASE_EASY:
        return min(MAX_IVL_DAYS, max(2, int(prev_ivl * 2.5)))
    return min(MAX_IVL_DAYS, max(1, int(prev_ivl * 2.0) + rng.randint(-1, 1)))


def build_review_rows(
    card_ids: list[int],
    reviews_per_card: int,
    days_ago: int,
    base_id_ms: int,
    rng: random.Random,
) -> list[tuple[int, int, int, int, int, int, int, int, int]]:
    """Return revlog tuples in insert order. id is a unique ms-epoch timestamp.

    Spacing: each card's reviews are spread evenly across `days_ago` days,
    with ±20% jitter. Per-card streams are interleaved by sorting at the end.
    """
    one_day_ms = 86_400_000
    start_ms = base_id_ms - days_ago * one_day_ms
    span_ms = days_ago * one_day_ms

    rows: list[tuple[int, int, int, int, int, int, int, int, int]] = []
    for cid in card_ids:
        prev_ivl = 0
        spacing = max(1, span_ms // reviews_per_card)
        for i in range(reviews_per_card):
            jitter = rng.randint(-spacing // 5, spacing // 5)
            review_ms = start_ms + i * spacing + jitter
            ease = pick_ease(rng)
            new_ivl = next_interval_days(prev_ivl, ease, rng)
            rows.append((
                review_ms,                    # id (ms timestamp; uniqueness handled below)
                cid,                          # cid
                -1,                           # usn (-1 = needs sync upload)
                ease,                         # ease 1-4
                new_ivl,                      # ivl (days)
                prev_ivl,                     # lastIvl
                2500,                         # factor (SM-2 default; FSRS ignores)
                rng.randint(2000, 12000),     # time (ms taken to answer)
                TYPE_LEARN if i == 0 else TYPE_REVIEW,
            ))
            prev_ivl = new_ivl

    rows.sort(key=lambda r: r[0])
    deduped: list[tuple[int, int, int, int, int, int, int, int, int]] = []
    last_id = -1
    for row in rows:
        rid = row[0]
        if rid <= last_id:
            rid = last_id + 1
        deduped.append((rid,) + row[1:])
        last_id = rid
    return deduped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="path to collection.anki2")
    parser.add_argument("--reviews-per-card", type=int, default=80,
                        help="reviews per existing card (default 80)")
    parser.add_argument("--days-ago", type=int, default=180,
                        help="span the reviews across this many past days (default 180)")
    parser.add_argument("--seed", type=int, default=42, help="RNG seed for reproducibility")
    parser.add_argument("--dry-run", action="store_true",
                        help="print summary without writing")
    parser.add_argument("--reset", action="store_true",
                        help="DELETE all existing revlog rows before inserting")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"error: db not found: {db_path}", file=sys.stderr)
        return 2

    rng = random.Random(args.seed)

    # Reads use immutable mode so we can plan/preview while anki_server holds
    # the write lock. Writes need the live writable connection — see below.
    ro_uri = f"file:{db_path}?immutable=1"
    ro_conn = sqlite3.connect(ro_uri, uri=True)
    ro_cur = ro_conn.cursor()

    card_ids = [r[0] for r in ro_cur.execute("SELECT id FROM cards ORDER BY id")]
    if not card_ids:
        print("error: no cards in collection — add some via the UI first",
              file=sys.stderr)
        return 2

    existing_revlog = ro_cur.execute("SELECT COUNT(*) FROM revlog").fetchone()[0]
    max_existing_id = ro_cur.execute("SELECT COALESCE(MAX(id), 0) FROM revlog").fetchone()[0]
    now_ms = ro_cur.execute("SELECT CAST(strftime('%s','now') AS INTEGER) * 1000").fetchone()[0]
    base_id_ms = max(now_ms, max_existing_id + 1)
    ro_conn.close()

    rows = build_review_rows(
        card_ids, args.reviews_per_card, args.days_ago, base_id_ms, rng,
    )

    print(f"db:        {db_path}")
    print(f"cards:     {len(card_ids)}")
    print(f"revlog before: {existing_revlog} (will{'  reset' if args.reset else ' append'})")
    print(f"to insert: {len(rows)} rows over {args.days_ago} days")
    print(f"id range:  {rows[0][0]} .. {rows[-1][0]}")

    if args.dry_run:
        print("dry-run: no changes written")
        return 0

    try:
        write_conn = sqlite3.connect(str(db_path), timeout=2.0)
        write_cur = write_conn.cursor()
        if args.reset:
            write_cur.execute("DELETE FROM revlog")
        write_cur.executemany(
            "INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        write_conn.commit()
    except sqlite3.OperationalError as exc:
        print(f"error: write failed ({exc}). Stop the anki_server process and retry.",
              file=sys.stderr)
        return 3

    after = write_cur.execute("SELECT COUNT(*) FROM revlog").fetchone()[0]
    print(f"revlog after:  {after}")
    write_conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
