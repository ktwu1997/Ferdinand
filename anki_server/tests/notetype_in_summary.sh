#!/usr/bin/env bash
# Integration check: /api/study/queue must surface notetype_id + notetype_css
# so the mockup reviewer can style cards per notetype (Phase 5-A).
#
# This test is HERMETIC: spawns its own anki_server on a random port with
# a temp users-dir, seeds a user via FERDINAND_SEED_*, uses
# ANKI_SERVER_BOOTSTRAP=1 to populate the "Ferdinand demo" deck, logs in
# with a cookie jar, then asserts on the queue card payload.
#
# Exit 0 = GREEN, non-zero = RED.
set -u

BIN="${ANKI_SERVER_BIN:-/workspace/Ferdinand/target/debug/anki_server}"

if [[ ! -x "$BIN" ]]; then
    echo "FAIL: anki_server binary missing at $BIN (build with 'cargo build -p anki_server')" >&2
    exit 2
fi

# ---- Hermetic environment --------------------------------------------------
TMP_ROOT=$(mktemp -d -t ferdinand-notetype-XXXXXX)
USERS_DIR="$TMP_ROOT/users"
AUTH_DB="$TMP_ROOT/auth.db"
COOKIE_JAR="$TMP_ROOT/cookies.txt"
SERVER_LOG="$TMP_ROOT/server.log"
mkdir -p "$USERS_DIR"

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
BASE="http://127.0.0.1:$PORT"

SEED_USER="ktwu"
SEED_PASSWORD="notetype-test-$$"

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
ANKI_SERVER_BOOTSTRAP=1 \
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

# ---- Discover the bootstrap deck id ----------------------------------------
decks_body="$(curl -sS --fail -b "$COOKIE_JAR" "$BASE/api/decks")" || {
    echo "FAIL: could not list decks after login" >&2
    exit 2
}
DECK_ID="$(printf '%s' "$decks_body" | jq -r '.. | objects | select(.name == "Ferdinand demo") | .id' | head -1)"
if [[ -z "$DECK_ID" || "$DECK_ID" == "null" ]]; then
    echo "FAIL: 'Ferdinand demo' deck not found in /api/decks response" >&2
    echo "body: $decks_body" >&2
    exit 2
fi

# ---- The actual test -------------------------------------------------------
body="$(curl -sS --fail -b "$COOKIE_JAR" "${BASE}/api/study/queue?deck_id=${DECK_ID}&limit=1")" || {
    echo "FAIL: could not reach ${BASE}/api/study/queue" >&2
    exit 2
}

card="$(printf '%s' "$body" | jq -e '.cards[0]')" || {
    echo "FAIL: response had no cards[0]" >&2
    echo "body: $body" >&2
    exit 2
}

fail=0
for field in notetype_id notetype_name notetype_css; do
    if ! printf '%s' "$card" | jq -e --arg f "$field" 'has($f)' >/dev/null; then
        echo "RED: cards[0] missing field '${field}'" >&2
        fail=1
    fi
done

if [[ $fail -eq 0 ]]; then
    # Additional shape checks once fields exist.
    printf '%s' "$card" | jq -e '.notetype_id | type == "number"' >/dev/null || {
        echo "RED: notetype_id not a number" >&2; fail=1; }
    printf '%s' "$card" | jq -e '.notetype_css | type == "string" and length > 0' >/dev/null || {
        echo "RED: notetype_css not a non-empty string" >&2; fail=1; }
fi

if [[ $fail -eq 0 ]]; then
    echo "GREEN: notetype_id=$(printf '%s' "$card" | jq -r .notetype_id)" \
        "notetype_name=$(printf '%s' "$card" | jq -r .notetype_name)" \
        "css_len=$(printf '%s' "$card" | jq -r '.notetype_css | length')"
fi
exit $fail
