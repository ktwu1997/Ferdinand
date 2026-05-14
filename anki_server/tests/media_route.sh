#!/usr/bin/env bash
# Integration check: GET /media/:filename must:
#   (a) serve files from the collection's .media/ sibling directory with the
#       correct content-type,
#   (b) reject path traversal attempts (percent-encoded slashes, `..`,
#       leading-dot hidden files) with 400,
#   (c) return 404 for missing files rather than leaking filesystem errors.
#
# The handler logic lives in anki_server/src/routes/media.rs. Validation
# invariants are mirrored in its #[cfg(test)] module for fast unit feedback.
#
# This test is HERMETIC: spawns its own anki_server on a random port with
# a temp users-dir, seeds a user via FERDINAND_SEED_*, logs in with a
# cookie jar, then drops a fixture into the per-user collection.media/ and
# exercises /media/<file>.
#
# Exit 0 = GREEN, non-zero = RED.
set -u

BIN="${ANKI_SERVER_BIN:-/workspace/Ferdinand/target/debug/anki_server}"
FIXTURE_SRC="$(dirname "$0")/fixtures/media/hello.png"
FIXTURE_NAME="ferdinand_media_probe.png"

if [[ ! -x "$BIN" ]]; then
    echo "FAIL: anki_server binary missing at $BIN (build with 'cargo build -p anki_server')" >&2
    exit 2
fi
if [[ ! -f "$FIXTURE_SRC" ]]; then
    echo "FAIL: fixture missing at $FIXTURE_SRC" >&2
    exit 2
fi

# ---- Hermetic environment --------------------------------------------------
TMP_ROOT=$(mktemp -d -t ferdinand-media-XXXXXX)
USERS_DIR="$TMP_ROOT/users"
AUTH_DB="$TMP_ROOT/auth.db"
COOKIE_JAR="$TMP_ROOT/cookies.txt"
SERVER_LOG="$TMP_ROOT/server.log"
RESP_HEADERS="$TMP_ROOT/resp_headers.txt"
RESP_BODY="$TMP_ROOT/resp_body.bin"
mkdir -p "$USERS_DIR"

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
BASE="http://127.0.0.1:$PORT"

SEED_USER="ktwu"
SEED_PASSWORD="media-test-$$"
MEDIA_DIR="$USERS_DIR/$SEED_USER/collection.media"

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
FERDINAND_SEED_PASSWORD="$SEED_PASSWORD" \
FERDINAND_SEED_USER="$SEED_USER" \
RUST_LOG="info" \
"$BIN" --users-dir "$USERS_DIR" --auth-db "$AUTH_DB" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

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
    echo "----- server.log tail -----" >&2
    tail -50 "$SERVER_LOG" >&2 || true
    exit 1
fi

# ---- Login -----------------------------------------------------------------
login_status=$(curl -sS -o "$TMP_ROOT/login_body.txt" -w '%{http_code}' \
    -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
    -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$SEED_USER\",\"password\":\"$SEED_PASSWORD\"}")
if [[ "$login_status" != "200" ]]; then
    echo "FAIL: login expected 200, got $login_status (body=$(cat "$TMP_ROOT/login_body.txt"))" >&2
    exit 2
fi

# ---- Materialise the per-user media dir ------------------------------------
# Touch any authed endpoint so the collection (and its sibling media dir)
# gets opened on disk. After this returns, $MEDIA_DIR exists.
warmup_status=$(curl -sS -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" "$BASE/api/decks")
if [[ "$warmup_status" != "200" ]]; then
    echo "FAIL: collection warmup via /api/decks expected 200, got $warmup_status" >&2
    exit 2
fi
if [[ ! -d "$MEDIA_DIR" ]]; then
    # Belt-and-suspenders — the server should have created it; create it
    # ourselves if not so the fixture copy doesn't fail in odd setups.
    mkdir -p "$MEDIA_DIR"
fi
cp "$FIXTURE_SRC" "$MEDIA_DIR/$FIXTURE_NAME"

fail=0

# Case 1: existing file → 200 + image/png + exact bytes
status=$(curl -sS --path-as-is -b "$COOKIE_JAR" \
    -o "$RESP_BODY" -D "$RESP_HEADERS" -w '%{http_code}' \
    "${BASE}/media/${FIXTURE_NAME}")
ctype=$(grep -i '^content-type:' "$RESP_HEADERS" | tr -d '\r' | awk -F': ' '{print $2}' | tr '[:upper:]' '[:lower:]')

if [[ "$status" != "200" ]]; then
    echo "RED case1: existing file expected 200, got $status" >&2
    fail=1
fi
if [[ "$ctype" != "image/png" ]]; then
    echo "RED case1: content-type expected 'image/png', got '$ctype'" >&2
    fail=1
fi
if ! cmp -s "$FIXTURE_SRC" "$RESP_BODY"; then
    echo "RED case1: body bytes do not match fixture" >&2
    fail=1
fi

# Case 2: missing file → 404
status=$(curl -sS --path-as-is -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' \
    "${BASE}/media/ferdinand_definitely_absent_xyz.png")
if [[ "$status" != "404" ]]; then
    echo "RED case2: missing file expected 404, got $status" >&2
    fail=1
fi

# Case 3: percent-encoded slash traversal → 400
status=$(curl -sS --path-as-is -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' \
    "${BASE}/media/..%2Fetc%2Fpasswd")
if [[ "$status" != "400" ]]; then
    echo "RED case3: %2F traversal expected 400, got $status" >&2
    fail=1
fi

# Case 4: percent-encoded dot-dot → 400
status=$(curl -sS --path-as-is -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' \
    "${BASE}/media/%2E%2E")
if [[ "$status" != "400" ]]; then
    echo "RED case4: %2E%2E expected 400, got $status" >&2
    fail=1
fi

# Case 5: leading-dot hidden file → 400
status=$(curl -sS --path-as-is -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' \
    "${BASE}/media/.hidden")
if [[ "$status" != "400" ]]; then
    echo "RED case5: leading-dot expected 400, got $status" >&2
    fail=1
fi

# Case 6: null-byte → 400
status=$(curl -sS --path-as-is -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' \
    "${BASE}/media/hello%00.png")
if [[ "$status" != "400" ]]; then
    echo "RED case6: null-byte expected 400, got $status" >&2
    fail=1
fi

if [[ $fail -eq 0 ]]; then
    size=$(wc -c < "$RESP_BODY" | tr -d ' ')
    echo "GREEN: /media route serves $FIXTURE_NAME ($size bytes, image/png) and rejects traversal"
fi
exit $fail
