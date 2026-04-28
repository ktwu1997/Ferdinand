#!/usr/bin/env bash
# uninstall.sh — remove the Ferdinand launchd agent.
#
# Unloads and deletes the installed plist. Logs and data dirs are left in
# place so you can re-install without losing review history.
#
# Usage: bash launchd/uninstall.sh

set -euo pipefail

LABEL="com.ktwu.ferdinand"
TARGET_PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

if [[ -z "${HOME:-}" ]]; then
    echo "[uninstall] ERROR: \$HOME is not set" >&2
    exit 1
fi

if [[ ! -f "${TARGET_PLIST}" ]]; then
    echo "[uninstall] no installed plist at ${TARGET_PLIST}; nothing to do."
    exit 0
fi

# Best-effort unload — ignore failure if it isn't currently loaded.
launchctl unload -w "${TARGET_PLIST}" 2>/dev/null || true
echo "[uninstall] unloaded ${LABEL}"

rm -f "${TARGET_PLIST}"
echo "[uninstall] removed ${TARGET_PLIST}"

if launchctl list | grep -q "${LABEL}"; then
    echo "[uninstall] WARNING: ${LABEL} still appears in launchctl list" >&2
    exit 1
fi

echo "[uninstall] done. Logs and data dir under ~/Library left intact."
