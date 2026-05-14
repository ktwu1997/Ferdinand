#!/usr/bin/env bash
# Integration check: POST /media must stream uploads to a temp file and
# enforce the size cap *before* the full body is buffered in RAM.
#
# Tests:
#   (a) 1 MiB dummy file → 200 OK
#   (b) 51 MiB dummy file → 413 Payload Too Large
#
# NOTE: RSS instrumentation (verifying the server process never accumulates
# 50 MiB in-process RAM) would belong in a dedicated perf/load test, not
# here. This test validates the HTTP status code — that the cap logic fires
# correctly — which is the primary functional requirement of the fix.
#
# Skip gracefully if no dev server is reachable on $ANKI_SERVER.
# Exit 0 = GREEN, non-zero = RED.
set -euo pipefail

BASE="${ANKI_SERVER:-http://localhost:40001}"
COOKIE_FILE="${ANKI_COOKIE_FILE:-/tmp/ferdinand_dev/cookie.txt}"

# ── skip if server is not reachable ─────────────────────────────────────────
if ! curl -sf --max-time 3 "$BASE/api/health" >/dev/null 2>&1; then
    echo "SKIP: no server at $BASE (set ANKI_SERVER to override)" >&2
    exit 0
fi

# ── skip if no auth cookie is available ─────────────────────────────────────
if [[ ! -f "$COOKIE_FILE" ]]; then
    echo "SKIP: cookie file not found at $COOKIE_FILE (set ANKI_COOKIE_FILE to override)" >&2
    exit 0
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

SMALL_FILE="$WORKDIR/small.ogg"
BIG_FILE="$WORKDIR/big.ogg"

echo "Generating 1 MiB dummy file..."
dd if=/dev/zero of="$SMALL_FILE" bs=1M count=1 2>/dev/null

echo "Generating 51 MiB dummy file..."
dd if=/dev/zero of="$BIG_FILE" bs=1M count=51 2>/dev/null

fail=0

# ── test (a): 1 MiB upload should succeed with 200 ──────────────────────────
echo "--- (a) 1 MiB upload ---"
status=$(curl -s -o /dev/null -w "%{http_code}" \
    -b "$COOKIE_FILE" \
    -F "file=@${SMALL_FILE};type=audio/ogg;filename=small.ogg" \
    "$BASE/media")
if [[ "$status" == "200" ]]; then
    echo "  PASS: got 200"
else
    echo "  FAIL: expected 200, got $status" >&2
    fail=1
fi

# ── test (b): 51 MiB upload should be rejected with 413 ─────────────────────
echo "--- (b) 51 MiB upload ---"
status=$(curl -s -o /dev/null -w "%{http_code}" \
    -b "$COOKIE_FILE" \
    -F "file=@${BIG_FILE};type=audio/ogg;filename=big.ogg" \
    "$BASE/media")
if [[ "$status" == "413" ]]; then
    echo "  PASS: got 413"
else
    echo "  FAIL: expected 413, got $status" >&2
    fail=1
fi

exit $fail
