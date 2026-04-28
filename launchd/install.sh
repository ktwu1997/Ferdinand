#!/usr/bin/env bash
# install.sh — install Ferdinand launchd agent for current user
#
# Substitutes __HOME__ in com.ktwu.ferdinand.plist with $HOME and loads the
# agent so anki_server starts at login and restarts on crash.
#
# Usage: bash launchd/install.sh

set -euo pipefail

# Resolve script directory so we can be invoked from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_PLIST="${SCRIPT_DIR}/com.ktwu.ferdinand.plist"

LABEL="com.ktwu.ferdinand"
BINARY_PATH="${HOME}/.local/bin/anki_server"
LOG_DIR="${HOME}/Library/Logs/Ferdinand"
DATA_DIR="${HOME}/Library/Application Support/Ferdinand"
AGENT_DIR="${HOME}/Library/LaunchAgents"
TARGET_PLIST="${AGENT_DIR}/${LABEL}.plist"

# 1. Sanity checks.
if [[ -z "${HOME:-}" ]]; then
    echo "[install] ERROR: \$HOME is not set" >&2
    exit 1
fi

if [[ ! -f "${SOURCE_PLIST}" ]]; then
    echo "[install] ERROR: source plist missing: ${SOURCE_PLIST}" >&2
    exit 1
fi

if [[ ! -x "${BINARY_PATH}" ]]; then
    echo "[install] ERROR: anki_server binary not found at ${BINARY_PATH}" >&2
    echo "[install] Build it via Phase 30-A (cargo build --release) and copy to ~/.local/bin/." >&2
    exit 1
fi

# 2. Create directories.
mkdir -p "${LOG_DIR}"
mkdir -p "${DATA_DIR}"
mkdir -p "${AGENT_DIR}"

# 3. Substitute __HOME__ -> $HOME and write installed plist.
#    sed delimiter '|' avoids escaping slashes in $HOME.
sed "s|__HOME__|${HOME}|g" "${SOURCE_PLIST}" > "${TARGET_PLIST}"
echo "[install] wrote ${TARGET_PLIST}"

# 4. Unload prior version if present (best-effort).
if launchctl list | grep -q "${LABEL}"; then
    echo "[install] unloading existing agent..."
    launchctl unload -w "${TARGET_PLIST}" 2>/dev/null || true
fi

# 5. Load the agent.
launchctl load -w "${TARGET_PLIST}"
echo "[install] loaded ${LABEL}"

# 6. Verify.
if launchctl list | grep -q "${LABEL}"; then
    echo "[install] launchctl list confirms ${LABEL} is registered:"
    launchctl list | grep "${LABEL}" || true
else
    echo "[install] WARNING: ${LABEL} not visible in launchctl list" >&2
fi

# 7. Tell the user where things live.
PORT="${ANKI_SERVER_PORT:-40001}"
echo ""
echo "[install] Ferdinand is now configured to auto-start at login."
echo "  port:     ${PORT} (override with ANKI_SERVER_PORT)"
echo "  logs:     ${LOG_DIR}/anki_server.{out,err}.log"
echo "  data:     ${DATA_DIR}/collection.anki2"
echo "  plist:    ${TARGET_PLIST}"
echo "  uninstall: bash ${SCRIPT_DIR}/uninstall.sh"
