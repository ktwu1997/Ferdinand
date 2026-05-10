#!/usr/bin/env bash
set -euo pipefail
#
# backup.sh — daily volume snapshot of the Ferdinand anki_data volume.
#
# Snapshots the docker-managed named volume `ferdinand_anki_data` (defined
# in docker-compose.yml; contains /data/users/<user>/collection.anki2,
# /data/users/<user>/collection.media/, /data/auth.db) into:
#
#     /var/backups/anki/ferdinand-YYYY-MM-DD-HHMM.tar.gz
#
# Then prunes anything older than 14 days.
#
# Cron-friendly: no interactive prompts, exits non-zero on any failure.
# Suggested cron entry (run as root):
#   30 3 * * * root /opt/ferdinand/deploy/scripts/backup.sh \
#                    >> /var/log/ferdinand-backup.log 2>&1

VOLUME="${FERDINAND_BACKUP_VOLUME:-ferdinand_anki_data}"
BACKUP_DIR="${FERDINAND_BACKUP_DIR:-/var/backups/anki}"
RETENTION_DAYS="${FERDINAND_BACKUP_RETENTION_DAYS:-14}"

log() {
    echo "[backup] $(date -Is) $*"
}

err() {
    echo "[backup] $(date -Is) ERROR: $*" >&2
}

require_root() {
    if [[ $EUID -ne 0 ]]; then
        err "this script must be run as root (the docker socket access + /var/backups write require it)."
        exit 1
    fi
}

require_root

if ! command -v docker >/dev/null 2>&1; then
    err "docker not found in PATH."
    exit 1
fi

# Confirm the volume actually exists — fail fast with a clear message rather
# than letting `docker run` create an empty one silently.
if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    err "docker volume '$VOLUME' does not exist."
    err "if you renamed the volume in docker-compose.yml, set FERDINAND_BACKUP_VOLUME accordingly."
    exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date +%F-%H%M)"
ARCHIVE_NAME="ferdinand-${STAMP}.tar.gz"
ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"

log "snapshotting volume '$VOLUME' → $ARCHIVE_PATH"

# Run tar inside an alpine container with the volume mounted read-only.
# Writes to a separate /backup mount so the source volume is never modified.
docker run --rm \
    -v "${VOLUME}:/data:ro" \
    -v "${BACKUP_DIR}:/backup" \
    alpine:3.20 \
    tar czf "/backup/${ARCHIVE_NAME}" -C /data .

if [[ ! -s "$ARCHIVE_PATH" ]]; then
    err "archive missing or empty after tar: $ARCHIVE_PATH"
    exit 1
fi

SIZE="$(du -h "$ARCHIVE_PATH" | cut -f1)"
log "backup complete: $ARCHIVE_PATH ($SIZE)"

# Prune old archives. -mtime +N matches files older than N*24h.
log "pruning archives older than ${RETENTION_DAYS} days from ${BACKUP_DIR}..."
find "$BACKUP_DIR" \
    -maxdepth 1 \
    -type f \
    -name 'ferdinand-*.tar.gz' \
    -mtime "+${RETENTION_DAYS}" \
    -print \
    -delete \
    || true

log "done."
