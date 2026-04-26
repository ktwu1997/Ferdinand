#!/usr/bin/env python3
"""Seed fake review history into a Ferdinand collection.

Phase 9-Q / 9-Q' helper. Inserts revlog rows for every existing card so the
FSRS optimizer has data to train on. Two distribution modes:

* ``--difficulty-mode uniform`` (default, original 9-Q behavior): every card
  shares 75% Good / 15% Hard / 7% Again / 3% Easy. Validates the wire end
  to end but trains no better than the FSRS-rs default model on log-loss,
  so ``POST /api/fsrs/optimize`` returns ``params: []`` (upstream Anki
  behavior, not a Ferdinand bug — see ``fsrs-5.2.0/src/model.rs::
  check_and_fill_parameters`` and ``rslib/src/scheduler/fsrs/params.rs:147``).
* ``--difficulty-mode varied`` (9-Q'): cards are bucketed across a per-card
  retention gradient (very easy → very hard) and review timestamps are
  ivl-driven (each review's time-since-last matches the prior interval),
  so FSRS sees real per-card retention curves instead of uniform-cramming
  noise. Intent: produce 21 trained parameters and observe persistence
  through ``GET /api/deck_config/default``. Empirical finding (9-Q', 6-card
  collection at /tmp/ferdinand_dev): even with bimodal-extreme profiles
  and 963 fsrs_items, the trained model still loses to the default on
  log-loss because the FSRS-rs default is robust at small-collection
  sizes. Production users with 100+ cards should clear this floor; this
  script's varied mode is the right shape for them, and the wire +
  reschedule paths are validated regardless.

Stop the anki_server process before running — it holds an exclusive lock on
the SQLite collection. Re-running is idempotent in spirit (the script picks
review IDs after the highest existing revlog id) but will append more rows;
use ``--reset`` to clear revlog first, and ``--reset-cards`` to also clear
prior card scheduling state when re-seeding a previously-rescheduled
collection.

Phase 9-T adds ``--add-cards N`` which clones the first existing note+card
N times before the revlog seed runs. This breaks the 6-card FSRS training
floor observed in 9-Q' and exercises the trained-params persistence path
(POST /api/fsrs/optimize → params.length==21 → GET /api/deck_config/default
→ fsrs_params.length==21). Cloned notes share the source's notetype/fields
(same csum) — the optimizer reads revlog directly so per-card content does
not affect training.

Usage:
    python3 scripts/seed_fake_reviews.py --db /tmp/ferdinand_dev/collection.anki2
    python3 scripts/seed_fake_reviews.py --db /path/to.anki2 --reviews-per-card 80 --reset
    python3 scripts/seed_fake_reviews.py --db /path/to.anki2 --dry-run
    python3 scripts/seed_fake_reviews.py --db /path/to.anki2 \\
        --difficulty-mode varied --reset --reset-cards
    python3 scripts/seed_fake_reviews.py --db /path/to.anki2 \\
        --add-cards 200 --reset --reset-cards \\
        --difficulty-mode varied --reviews-per-card 50
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

EASE_DISTRIBUTION: tuple[tuple[int, float], ...] = (
    (EASE_GOOD, 0.75),
    (EASE_HARD, 0.15),
    (EASE_AGAIN, 0.07),
    (EASE_EASY, 0.03),
)

# Per-card profile for --difficulty-mode varied. Earlier profiles skew Good
# (easy material), later profiles skew Again (hard material). Cards are
# bucketed by index across these profiles so FSRS sees a per-card retention
# gradient — combined with ivl-driven review timing this is the learnable
# signal that can produce non-empty trained params. With only ~6 cards this
# may still fail to beat the default model on log-loss; that is fine for
# wire validation but persistence-path coverage requires larger collections
# (see Phase 9-Q' diary for the empirical floor).
VARIED_PROFILES: tuple[tuple[tuple[int, float], ...], ...] = (
    ((EASE_GOOD, 1.00),),
    ((EASE_GOOD, 0.95), (EASE_HARD, 0.05)),
    ((EASE_GOOD, 0.65), (EASE_HARD, 0.20), (EASE_AGAIN, 0.15)),
    ((EASE_GOOD, 0.30), (EASE_HARD, 0.20), (EASE_AGAIN, 0.50)),
    ((EASE_GOOD, 0.05), (EASE_HARD, 0.05), (EASE_AGAIN, 0.90)),
    ((EASE_AGAIN, 1.00),),
)


def pick_ease_from(
    rng: random.Random,
    distribution: tuple[tuple[int, float], ...],
) -> int:
    roll = rng.random()
    cumulative = 0.0
    for ease, weight in distribution:
        cumulative += weight
        if roll < cumulative:
            return ease
    return distribution[0][0]


def pick_ease(rng: random.Random) -> int:
    return pick_ease_from(rng, EASE_DISTRIBUTION)


def profile_for_card(
    card_index: int, total_cards: int,
) -> tuple[tuple[int, float], ...]:
    """Map a card index to a varied-mode difficulty profile bucket."""
    if total_cards <= 1:
        return VARIED_PROFILES[0]
    bucket = (card_index * len(VARIED_PROFILES)) // total_cards
    bucket = min(bucket, len(VARIED_PROFILES) - 1)
    return VARIED_PROFILES[bucket]


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
    difficulty_mode: str = "uniform",
) -> list[tuple[int, int, int, int, int, int, int, int, int]]:
    """Return revlog tuples in insert order. id is a unique ms-epoch timestamp.

    Timing is ivl-driven: each review's timestamp equals the previous
    review's timestamp plus the prior interval (in days, ±10% jitter), so
    the actual time-since-last-review the FSRS optimizer sees matches the
    declared ivl. This is the load-bearing realism property that lets a
    per-card retention gradient produce log-loss better than the default
    21-param model. ``reviews_per_card`` becomes a MAX cap; per-card review
    streams stop early when their cumulative time exceeds ``days_ago``,
    which means easy cards (long ivls) end up with fewer reviews than hard
    cards (short ivls) — exactly what real users look like.

    ``difficulty_mode='uniform'`` (default) shares the global distribution
    across all cards. ``difficulty_mode='varied'`` assigns each card a
    distinct retention profile from VARIED_PROFILES.
    """
    one_day_ms = 86_400_000
    start_ms = base_id_ms - days_ago * one_day_ms
    end_ms = base_id_ms

    rows: list[tuple[int, int, int, int, int, int, int, int, int]] = []
    total_cards = len(card_ids)
    for card_index, cid in enumerate(card_ids):
        distribution = (
            profile_for_card(card_index, total_cards)
            if difficulty_mode == "varied"
            else EASE_DISTRIBUTION
        )
        # Stagger card start within the first day so per-card streams don't
        # all begin at the same instant (which would confuse the optimizer
        # about within-day card density).
        review_ms = start_ms + rng.randint(0, one_day_ms)
        prev_ivl = 0
        for i in range(reviews_per_card):
            if review_ms >= end_ms:
                break
            ease = pick_ease_from(rng, distribution)
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
            jitter_pct = rng.uniform(-0.1, 0.1)
            review_ms += max(one_day_ms, int(new_ivl * one_day_ms * (1 + jitter_pct)))

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


def clone_note_and_card_rows(
    write_cur: sqlite3.Cursor,
    num_to_add: int,
    base_card_id_ms: int,
) -> int:
    """Clone the first existing note and card N times. Returns N.

    Each cloned note gets a unique guid (hex of the new note id, "f" prefix
    so it won't collide with existing user-generated guids). Each cloned
    card resets scheduling fields (queue/type/due/ivl/factor/reps/lapses/
    left/odue/odid/flags/data) so the reschedule path treats them as fresh
    new cards regardless of the source card's prior FSRS state. The shared
    notetype/deck/ord layout means the optimizer's preset-name-based
    revlog filter (`"preset:Default" -is:suspended`) still picks them up.

    Strides of 2 across base_card_id_ms keep new note ids and card ids
    disjoint (new_nid = base + 2i; new_cid = base + 2i + 1).
    """
    note_row = write_cur.execute(
        "SELECT id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data "
        "FROM notes ORDER BY id LIMIT 1"
    ).fetchone()
    if not note_row:
        raise RuntimeError("no notes to clone — collection is empty")
    card_row = write_cur.execute(
        "SELECT id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, "
        "reps, lapses, left, odue, odid, flags, data FROM cards ORDER BY id LIMIT 1"
    ).fetchone()
    if not card_row:
        raise RuntimeError("no cards to clone — add some via the UI first")

    new_notes: list[tuple] = []
    new_cards: list[tuple] = []
    for i in range(num_to_add):
        new_nid = base_card_id_ms + 2 * i
        new_cid = base_card_id_ms + 2 * i + 1
        new_guid = f"f{new_nid:016x}"
        # Note columns: id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data
        new_notes.append((
            new_nid, new_guid, note_row[2], note_row[3], note_row[4],
            note_row[5], note_row[6], note_row[7], note_row[8],
            note_row[9], note_row[10],
        ))
        # Card columns: id, nid, did, ord, mod, usn, type, queue, due, ivl,
        # factor, reps, lapses, left, odue, odid, flags, data — scheduling
        # fields zeroed so cloned cards start fresh in the new queue.
        new_cards.append((
            new_cid, new_nid, card_row[2], card_row[3], card_row[4],
            card_row[5], 0, 0, 0, 0,
            2500, 0, 0, 0, 0, 0, 0, "",
        ))
    write_cur.executemany(
        "INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        new_notes,
    )
    write_cur.executemany(
        "INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, "
        "factor, reps, lapses, left, odue, odid, flags, data) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        new_cards,
    )
    return num_to_add


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
    parser.add_argument(
        "--difficulty-mode", choices=("uniform", "varied"), default="uniform",
        help="uniform = all cards share the global 75/15/7/3 distribution; "
             "varied = per-card retention gradient for FSRS learnable signal "
             "(default: uniform)",
    )
    parser.add_argument(
        "--reset-cards", action="store_true",
        help="also reset card scheduling state (queue/type/due/ivl/factor/"
             "reps/lapses/data) before inserting revlog rows. Use when "
             "re-seeding a previously-rescheduled collection.",
    )
    parser.add_argument(
        "--add-cards", type=int, default=0, metavar="N",
        help="clone the first existing note+card N times before seeding "
             "revlog. Used by Phase 9-T to break the 6-card FSRS training "
             "floor and exercise trained-params persistence.",
    )
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"error: db not found: {db_path}", file=sys.stderr)
        return 2

    if args.add_cards < 0:
        print("error: --add-cards must be >= 0", file=sys.stderr)
        return 2

    rng = random.Random(args.seed)

    # Reads use immutable mode so we can plan/preview while anki_server holds
    # the write lock. Writes need the live writable connection — see below.
    ro_uri = f"file:{db_path}?immutable=1"
    ro_conn = sqlite3.connect(ro_uri, uri=True)
    ro_cur = ro_conn.cursor()

    existing_card_ids = [r[0] for r in ro_cur.execute("SELECT id FROM cards ORDER BY id")]
    if not existing_card_ids and args.add_cards == 0:
        print("error: no cards in collection — add some via the UI first or "
              "use --add-cards N", file=sys.stderr)
        return 2

    existing_revlog = ro_cur.execute("SELECT COUNT(*) FROM revlog").fetchone()[0]
    max_existing_revlog_id = ro_cur.execute(
        "SELECT COALESCE(MAX(id), 0) FROM revlog"
    ).fetchone()[0]
    max_existing_card_id = ro_cur.execute(
        "SELECT COALESCE(MAX(id), 0) FROM cards"
    ).fetchone()[0]
    now_ms = ro_cur.execute("SELECT CAST(strftime('%s','now') AS INTEGER) * 1000").fetchone()[0]
    revlog_base_id_ms = max(now_ms, max_existing_revlog_id + 1)
    # Card ids must not collide with existing cards or with revlog ids the
    # build_review_rows step is about to mint. Park them well past the
    # latest revlog id so the (id, ms-epoch) interpretation stays sensible.
    card_base_id_ms = max(now_ms, max_existing_card_id + 1, revlog_base_id_ms + 1)
    ro_conn.close()

    total_cards_after = len(existing_card_ids) + args.add_cards
    print(f"db:        {db_path}")
    print(f"cards:     {len(existing_card_ids)}"
          f"{f' (+{args.add_cards} clones planned)' if args.add_cards else ''}")
    print(f"mode:      {args.difficulty_mode}")
    print(f"revlog before: {existing_revlog} (will{' reset' if args.reset else ' append'})")
    if args.reset_cards:
        print("card state: will reset (queue/type/due/ivl/factor/reps/lapses/data)")
    # Estimate the row count without actually building yet — build_review_rows
    # needs the full id list and we only know it after cloning. The cap is
    # reviews_per_card per card.
    estimated_rows = total_cards_after * args.reviews_per_card
    print(f"to insert: up to {estimated_rows} rows over {args.days_ago} days "
          f"({total_cards_after} cards × {args.reviews_per_card} reviews max)")

    if args.dry_run:
        print("dry-run: no changes written")
        return 0

    try:
        write_conn = sqlite3.connect(str(db_path), timeout=2.0)
        write_cur = write_conn.cursor()
        if args.reset:
            write_cur.execute("DELETE FROM revlog")
        if args.add_cards > 0:
            clone_note_and_card_rows(write_cur, args.add_cards, card_base_id_ms)
        if args.reset_cards:
            # factor=2500 matches Anki's SM-2 default starting ease; FSRS
            # ignores it but keeps cards readable by the legacy scheduler.
            # data='' wipes any prior FSRS memory state (per-card json blob)
            # so the post-seed reschedule starts from clean revlog data.
            write_cur.execute(
                "UPDATE cards SET queue = 0, type = 0, due = 0, "
                "ivl = 0, factor = 2500, reps = 0, lapses = 0, data = ''"
            )
        # Re-fetch the full card list now that clones (if any) exist.
        all_card_ids = [
            r[0] for r in write_cur.execute("SELECT id FROM cards ORDER BY id")
        ]
        rows = build_review_rows(
            all_card_ids, args.reviews_per_card, args.days_ago,
            revlog_base_id_ms, rng, difficulty_mode=args.difficulty_mode,
        )
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

    cards_after = write_cur.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    after = write_cur.execute("SELECT COUNT(*) FROM revlog").fetchone()[0]
    print(f"cards after:   {cards_after}")
    print(f"revlog after:  {after} ({len(rows)} inserted)")
    print(f"id range:      {rows[0][0]} .. {rows[-1][0]}")
    write_conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
