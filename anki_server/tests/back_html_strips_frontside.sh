#!/usr/bin/env bash
# Integration check: /api/study/queue back_html must not carry the
# {{FrontSide}}<hr id=answer> prefix that Anki's default Basic template
# bakes in. The mockup renders front and back as two separate cards, so
# the prefix duplicates the question and leaves a faint default <hr>
# floating in the middle of the back card (Phase 6-polish observation).
#
# Canonical strip pattern lives in rslib/src/import_export/text/csv/
# export.rs:174 and pylib/anki/exporting.py:120. We mirror it server-side
# in cards.rs::build_summary so every consumer (study queue + browse +
# future iOS client) sees a clean back_html.
#
# This test is HERMETIC: it spawns its own anki_server on a random port
# with a temp users-dir, seeds a user via FERDINAND_SEED_*, and uses
# ANKI_SERVER_BOOTSTRAP=1 to populate the "Ferdinand demo" deck so we
# have real cards to assert against. Mirrors cli_auth_endpoints.sh.
#
# Exit 0 = GREEN, non-zero = RED.
set -u

BIN="${ANKI_SERVER_BIN:-/workspace/Ferdinand/target/debug/anki_server}"

if [[ ! -x "$BIN" ]]; then
    echo "FAIL: anki_server binary missing at $BIN (build with 'cargo build -p anki_server')" >&2
    exit 2
fi

# ---- Hermetic environment --------------------------------------------------
TMP_ROOT=$(mktemp -d -t ferdinand-backhtml-XXXXXX)
USERS_DIR="$TMP_ROOT/users"
AUTH_DB="$TMP_ROOT/auth.db"
COOKIE_JAR="$TMP_ROOT/cookies.txt"
SERVER_LOG="$TMP_ROOT/server.log"
mkdir -p "$USERS_DIR"

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
BASE="http://127.0.0.1:$PORT"

SEED_USER="ktwu"
SEED_PASSWORD="back-html-test-$$"

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
# ANKI_SERVER_BOOTSTRAP=1 seeds the "Ferdinand demo" deck with 6 cards on
# first collection-open, giving us guaranteed queueable content.
ANKI_SERVER_PORT="$PORT" \
ANKI_BIND="127.0.0.1" \
ANKI_SERVER_BOOTSTRAP=1 \
FERDINAND_SEED_PASSWORD="$SEED_PASSWORD" \
FERDINAND_SEED_USER="$SEED_USER" \
RUST_LOG="info" \
"$BIN" --users-dir "$USERS_DIR" --auth-db "$AUTH_DB" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

# Poll /api/health until it responds (or fail after ~10s).
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
# The bootstrap seeds "Ferdinand demo" with 6 cards. Pick it dynamically so
# we don't hard-code a generated deck id that differs across runs.
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

front_html="$(printf '%s' "$card" | jq -r '.front_html')"
back_html="$(printf '%s' "$card" | jq -r '.back_html')"

fail=0

# Primary assertion: the <hr id=answer> marker must be gone.
if printf '%s' "$back_html" | grep -qi '<hr id=answer>'; then
    echo "RED: back_html still contains the <hr id=answer> marker" >&2
    echo "back_html (first 200 chars): $(printf '%s' "$back_html" | head -c 200)" >&2
    fail=1
fi

# Defense in depth: the back must not start with the front content.
# (Only meaningful when front_html is non-empty; FrontSide can render
# as empty in some notetypes, but if it's non-empty it must not reappear
# at the head of back_html.)
if [[ -n "$front_html" ]] && [[ "$back_html" == "$front_html"* ]]; then
    echo "RED: back_html starts with front_html — FrontSide prefix not stripped" >&2
    fail=1
fi

if [[ $fail -eq 0 ]]; then
    len=$(printf '%s' "$back_html" | wc -c | tr -d ' ')
    echo "GREEN: back_html clean (len=${len}) front_html='${front_html}' back_html='${back_html}'"
fi
exit $fail
