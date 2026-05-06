#!/usr/bin/env bash
# Snapshot the Ferdinand local-state assets that the pipeline cannot
# regenerate cheaply: SQLite collection + curated media + idempotency
# trackers + nid→meta cache.
#
# What is in vs. out:
#   IN  data/collection.anki2          (FSRS state + cards/notes/decks)
#   IN  data/collection.media/         (audited JPEGs — codex gen costs
#                                       subscription quota, hard to redo)
#   IN  data/toeic/{done,ingested,image_done,image_skip}.txt
#                                       (idempotency — without these the
#                                       pipeline re-runs everything)
#   IN  data/toeic/concept_image_map.json   (saves ~600 GETs on re-run)
#   OUT data/toeic/*.jsonl              (already in git)
#   OUT data/toeic/cards.invalid.jsonl
#   OUT data/toeic/image_fail.jsonl     (stale on each gen cycle anyway)
#
# Usage:
#   scripts/backup_media.sh                       # tarball to /tmp
#   BACKUP_DEST=~/Backups scripts/backup_media.sh # explicit dest dir
#   BACKUP_RCLONE_REMOTE=b2:ferdinand-backup \
#     scripts/backup_media.sh                     # also copy to cloud
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DEST="${BACKUP_DEST:-/tmp}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
TARBALL="$DEST/ferdinand-snap-$TS.tar.gz"

if [[ ! -f data/collection.anki2 ]]; then
  echo "error: data/collection.anki2 missing — run from repo root with the server's collection in place" >&2
  exit 1
fi

# WAL checkpoint — flush in-flight writes into the main file so the
# snapshot is self-consistent. Safe to run while the server is up
# (read+truncate, no locks blocked).
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 data/collection.anki2 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null
else
  echo "warning: sqlite3 not on PATH — snapshot may include un-checkpointed WAL" >&2
fi

# Collect candidates; only include what exists so the script is idempotent
# across pipelines that haven't run yet (e.g. fresh clone with no
# image_done.txt yet).
PATHS=(data/collection.anki2)
[[ -d data/collection.media ]] && PATHS+=(data/collection.media)
for f in \
  data/toeic/done.txt \
  data/toeic/ingested.txt \
  data/toeic/cloze_done.txt \
  data/toeic/cloze_ingested.txt \
  data/toeic/image_done.txt \
  data/toeic/image_skip.txt \
  data/toeic/concept_image_map.json
do
  [[ -f "$f" ]] && PATHS+=("$f")
done

mkdir -p "$DEST"
tar czf "$TARBALL" "${PATHS[@]}"
SIZE_KB=$(( $(stat -c %s "$TARBALL" 2>/dev/null || stat -f %z "$TARBALL") / 1024 ))
echo "wrote $TARBALL  (${SIZE_KB} KB, $(echo "${PATHS[@]}" | wc -w | tr -d ' ') paths)"

# Optional cloud copy. Use rclone with a pre-configured remote:
#   rclone config            (one-time interactive setup for B2/R2/S3/etc)
#   BACKUP_RCLONE_REMOTE=b2:ferdinand-backup scripts/backup_media.sh
if [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    echo "uploading to $BACKUP_RCLONE_REMOTE ..."
    rclone copy "$TARBALL" "$BACKUP_RCLONE_REMOTE/" --progress
    echo "uploaded."
  else
    echo "warning: rclone not on PATH — skipping cloud upload" >&2
  fi
fi

# Retention: keep only the 5 most recent local snapshots in $DEST so
# /tmp doesn't fill up; cloud retention is the user's job to manage.
ls -1t "$DEST"/ferdinand-snap-*.tar.gz 2>/dev/null \
  | tail -n +6 \
  | xargs -r rm -f
