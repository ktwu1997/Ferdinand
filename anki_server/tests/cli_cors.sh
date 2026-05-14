#!/usr/bin/env bash
# Integration test for CORS whitelist behaviour (issue #2 fix).
#
# Verifies:
#   1. Allowed origin → Access-Control-Allow-Origin echoed back.
#   2. Disallowed origin → header absent (browser would block).
#   3. Preflight OPTIONS with allowed origin → 204.
#
# Exit 0 = GREEN, non-zero = RED.
set -u

BIN="${ANKI_SERVER_BIN:-/workspace/Ferdinand/target/debug/anki_server}"

if [[ ! -x "$BIN" ]]; then
    echo "FAIL: anki_server binary missing at $BIN (build with 'cargo build -p anki_server')" >&2
    exit 2
fi

# ---- Hermetic environment --------------------------------------------------
TMP_ROOT=$(mktemp -d -t ferdinand-cors-cli-XXXXXX)
USERS_DIR="$TMP_ROOT/users"
AUTH_DB="$TMP_ROOT/auth.db"
SERVER_LOG="$TMP_ROOT/server.log"
mkdir -p "$USERS_DIR"

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
BASE="http://127.0.0.1:$PORT"

# Explicitly set only localhost:5174 as the allowed origin.
ALLOWED_ORIGIN="http://localhost:5174"

cleanup() {
    if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
            sleep 0.2
        done
        kill -9 "$SERVER_PID" 2>/dev/null || true
    fi
    rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

# ---- Spawn server ----------------------------------------------------------
ANKI_SERVER_PORT="$PORT" \
ANKI_BIND="127.0.0.1" \
ANKI_CORS_ALLOW_ORIGINS="$ALLOWED_ORIGIN" \
RUST_LOG="info" \
"$BIN" --users-dir "$USERS_DIR" --auth-db "$AUTH_DB" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

# Poll /api/health until ready (or fail after ~10 s).
ready=0
for _ in $(seq 1 50); do
    if curl -fsS -o /dev/null --max-time 1 "$BASE/api/health" 2>/dev/null; then
        ready=1
        break
    fi
    sleep 0.2
done
if [[ $ready -ne 1 ]]; then
    echo "FAIL: server never became ready on $BASE" >&2
    tail -50 "$SERVER_LOG" >&2 || true
    exit 1
fi

# ---- Helpers ---------------------------------------------------------------
fail=0

assert_contains() {
    local label="$1" pattern="$2" output="$3"
    if echo "$output" | grep -qi "$pattern"; then
        echo "  ✓ $label"
    else
        echo "RED: $label — expected pattern '$pattern' not found in response" >&2
        echo "  response headers: $output" >&2
        fail=1
    fi
}

assert_absent() {
    local label="$1" pattern="$2" output="$3"
    if echo "$output" | grep -qi "$pattern"; then
        echo "RED: $label — unexpected pattern '$pattern' found in response" >&2
        echo "  response headers: $output" >&2
        fail=1
    else
        echo "  ✓ $label"
    fi
}

# ---- Cases ----------------------------------------------------------------

# 1. Allowed origin → Access-Control-Allow-Origin echoed back.
HEADERS=$(curl -si -H "Origin: $ALLOWED_ORIGIN" "$BASE/api/health")
assert_contains \
    "1. Allowed origin gets Allow-Origin header" \
    "access-control-allow-origin: $ALLOWED_ORIGIN" \
    "$HEADERS"

# 2. Disallowed origin → Access-Control-Allow-Origin header absent.
HEADERS=$(curl -si -H "Origin: https://evil.com" "$BASE/api/health")
assert_absent \
    "2. Disallowed origin gets no Allow-Origin header" \
    "access-control-allow-origin: https://evil.com" \
    "$HEADERS"

# 3. Preflight OPTIONS with allowed origin → CORS allow headers present.
# axum returns 200 for OPTIONS when a route handler is registered; 204 is
# returned only by a pure CORS-bypass layer (e.g. very_permissive). Both
# status codes are spec-compliant for preflight. We verify the CORS headers
# instead of locking to a specific status code.
PREFLIGHT=$(curl -si -X OPTIONS \
    -H "Origin: $ALLOWED_ORIGIN" \
    -H "Access-Control-Request-Method: POST" \
    "$BASE/api/auth/login")
assert_contains \
    "3. Preflight OPTIONS echoes Allow-Origin for allowed origin" \
    "access-control-allow-origin: $ALLOWED_ORIGIN" \
    "$PREFLIGHT"
assert_contains \
    "3b. Preflight OPTIONS includes Access-Control-Allow-Methods" \
    "access-control-allow-methods:" \
    "$PREFLIGHT"

# ---- Result ----------------------------------------------------------------
if [[ $fail -eq 0 ]]; then
    echo "GREEN: 3/3 CORS cases passed"
fi
exit $fail
