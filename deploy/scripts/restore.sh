#!/usr/bin/env bash
set -euo pipefail
#
# restore.sh — interactive restore of the ferdinand_anki_data volume from a
# backup tarball produced by backup.sh.
#
# Usage:
#     restore.sh /var/backups/anki/ferdinand-2026-05-10-0330.tar.gz
#
# Requires explicit "yes" confirmation. Replaces the contents of the volume
# (the existing data is wiped before the tarball is extracted), then brings
# the stack back up and waits for the anki service healthcheck.

REPO_DIR="${FERDINAND_INSTALL_DIR:-/opt/ferdinand}"
VOLUME="${FERDINAND_BACKUP_VOLUME:-ferdinand_anki_data}"
SERVICE_NAME="${FERDINAND_SERVICE_NAME:-ferdinand}"
HEALTH_TIMEOUT_SECONDS=60

log() {
    echo "[restore] $*"
}

err() {
    echo "[restore] ERROR: $*" >&2
}

if [[ $# -ne 1 ]]; then
    err "usage: $0 <backup-tarball.tar.gz>"
    exit 1
fi

ARCHIVE_INPUT="$1"

if [[ ! -f "$ARCHIVE_INPUT" ]]; then
    err "backup file not found: $ARCHIVE_INPUT"
    exit 1
fi

# Resolve to an absolute path so we can split into dir+name reliably for the
# docker mount.
ARCHIVE_ABS="$(readlink -f "$ARCHIVE_INPUT")"
ARCHIVE_DIR="$(dirname "$ARCHIVE_ABS")"
ARCHIVE_NAME="$(basename "$ARCHIVE_ABS")"

if ! command -v docker >/dev/null 2>&1; then
    err "docker not found in PATH."
    exit 1
fi

if [[ ! -d "$REPO_DIR" ]]; then
    err "repo dir not found: $REPO_DIR"
    err "set FERDINAND_INSTALL_DIR if it lives somewhere else."
    exit 1
fi

cd "$REPO_DIR"

if [[ ! -f docker-compose.yml ]]; then
    err "docker-compose.yml not in $REPO_DIR — wrong directory?"
    exit 1
fi

echo ""
echo "WARNING: this will REPLACE the contents of volume ${VOLUME}"
echo "         with the contents of: $ARCHIVE_ABS"
echo "         The current contents will be deleted."
echo ""
read -r -p "Type 'yes' to continue: " confirm
if [[ "$confirm" != "yes" ]]; then
    err "aborted (input was not 'yes')."
    exit 1
fi

log "stopping the stack via docker compose down..."
docker compose down

# If the volume was destroyed by `down -v` previously or doesn't exist yet,
# create an empty one so the next `docker run` mount finds it.
if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    log "creating empty volume '$VOLUME'..."
    docker volume create "$VOLUME" >/dev/null
fi

log "wiping current volume contents and extracting tarball..."
# Mount the volume rw at /data and the archive's directory ro at /backup.
# Wipe with `find -delete` (handles dotfiles + non-empty subdirs cleanly),
# then extract.
docker run --rm \
    -v "${VOLUME}:/data" \
    -v "${ARCHIVE_DIR}:/backup:ro" \
    alpine:3.20 \
    sh -c "set -e
           find /data -mindepth 1 -delete
           tar xzf '/backup/${ARCHIVE_NAME}' -C /data"

log "starting the stack via docker compose up -d..."
docker compose up -d

# Wait for the anki service to report healthy. Compose --format json emits
# one JSON object per line for newer compose versions; we just grep for
# the service name and 'healthy' string, which is good enough for an SOP
# script.
log "waiting up to ${HEALTH_TIMEOUT_SECONDS}s for service '${SERVICE_NAME}' to become healthy..."
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
healthy=0
while (( $(date +%s) < deadline )); do
    status_json="$(docker compose ps --format json 2>/dev/null || true)"
    if [[ -n "$status_json" ]] \
       && echo "$status_json" | grep -F "\"$SERVICE_NAME\"" | grep -qi 'healthy'; then
        healthy=1
        break
    fi
    sleep 3
done

if (( healthy == 1 )); then
    log "service '${SERVICE_NAME}' is healthy. Restore complete."
    exit 0
else
    err "service '${SERVICE_NAME}' did not become healthy within ${HEALTH_TIMEOUT_SECONDS}s."
    err "inspect with: docker compose ps && docker compose logs ${SERVICE_NAME}"
    exit 1
fi
