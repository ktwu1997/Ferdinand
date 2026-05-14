#!/usr/bin/env bash
# Phase 9-R: skip-persist-on-noop hygiene for FSRS endpoints.
#
# `PUT /api/fsrs/enabled` and `POST /api/fsrs/optimize` previously walked the
# full update_deck_configs + reschedule path even when the input matched
# current state — wasted work on every idempotent call. The handlers now
# detect noop input and short-circuit:
#   - put_enabled: req.enabled == current → return early, no reschedule.
#   - post_optimize: trained params == current params → skip persist.
#
# Externally observable check: idempotent calls must still return 200 with a
# consistent payload. This script does not measure timing — it verifies the
# handler does not regress behavior under repeated identical input.
#
# This test is HERMETIC: spawns its own anki_server on a random port with
# a temp users-dir, seeds a user via FERDINAND_SEED_*, and logs in with a
# cookie jar before exercising the FSRS endpoints.
#
# Exit 0 = GREEN, non-zero = RED.
set -u

BIN="${ANKI_SERVER_BIN:-/workspace/Ferdinand/target/debug/anki_server}"

if [[ ! -x "$BIN" ]]; then
    echo "FAIL: anki_server binary missing at $BIN (build with 'cargo build -p anki_server')" >&2
    exit 2
fi

# ---- Hermetic environment --------------------------------------------------
TMP_ROOT=$(mktemp -d -t ferdinand-fsrs-XXXXXX)
USERS_DIR="$TMP_ROOT/users"
AUTH_DB="$TMP_ROOT/auth.db"
COOKIE_JAR="$TMP_ROOT/cookies.txt"
SERVER_LOG="$TMP_ROOT/server.log"
mkdir -p "$USERS_DIR"

PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
BASE="http://127.0.0.1:$PORT"

SEED_USER="ktwu"
SEED_PASSWORD="fsrs-test-$$"

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

fail=0

# Fresh collections boot with FSRS OFF. The optimize endpoint requires FSRS
# enabled (returns 400 otherwise), so flip it on up front. This is NOT part
# of the noop-idempotency assertion — that comes next, after the toggle has
# settled.
init_state="$(curl -sS --fail -b "$COOKIE_JAR" "${BASE}/api/fsrs/enabled" | jq -r '.enabled')" || {
    echo "FAIL: GET /api/fsrs/enabled unreachable" >&2
    exit 2
}
if [[ "$init_state" != "true" ]]; then
    enable_status=$(curl -sS -o "$TMP_ROOT/enable_body.txt" -w '%{http_code}' \
        -b "$COOKIE_JAR" -X PUT "${BASE}/api/fsrs/enabled" \
        -H 'Content-Type: application/json' \
        -d '{"enabled":true}')
    if [[ "$enable_status" != "200" ]]; then
        echo "FAIL: enabling FSRS for the test setup expected 200, got $enable_status" >&2
        echo "body: $(cat "$TMP_ROOT/enable_body.txt")" >&2
        exit 2
    fi
fi

# 1. PUT /api/fsrs/enabled with the current state twice — both must be 200,
#    second must echo identical body to the first.
current="$(curl -sS --fail -b "$COOKIE_JAR" "${BASE}/api/fsrs/enabled" | jq -r '.enabled')" || {
    echo "FAIL: GET /api/fsrs/enabled unreachable" >&2
    exit 2
}

first="$(curl -sS -w '\n%{http_code}' -b "$COOKIE_JAR" -X PUT "${BASE}/api/fsrs/enabled" \
    -H 'Content-Type: application/json' \
    -d "{\"enabled\":${current}}")"
first_code="${first##*$'\n'}"
first_body="${first%$'\n'*}"

second="$(curl -sS -w '\n%{http_code}' -b "$COOKIE_JAR" -X PUT "${BASE}/api/fsrs/enabled" \
    -H 'Content-Type: application/json' \
    -d "{\"enabled\":${current}}")"
second_code="${second##*$'\n'}"
second_body="${second%$'\n'*}"

if [[ "$first_code" != "200" ]] || [[ "$second_code" != "200" ]]; then
    echo "RED: noop PUT /api/fsrs/enabled expected 200/200 got ${first_code}/${second_code}" >&2
    fail=1
fi

if [[ "$first_body" != "$second_body" ]]; then
    echo "RED: noop PUT /api/fsrs/enabled body drifted between idempotent calls" >&2
    echo "  first:  $first_body" >&2
    echo "  second: $second_body" >&2
    fail=1
fi

# 2. POST /api/fsrs/optimize twice — when training data ≤ floor (6 cards in
#    dev fixture) trained params equal current params, so the new noop guard
#    triggers. Both calls must be 200 with identical params.
opt_first="$(curl -sS -w '\n%{http_code}' -b "$COOKIE_JAR" -X POST "${BASE}/api/fsrs/optimize" \
    -H 'Content-Type: application/json')"
opt_first_code="${opt_first##*$'\n'}"
opt_first_body="${opt_first%$'\n'*}"

opt_second="$(curl -sS -w '\n%{http_code}' -b "$COOKIE_JAR" -X POST "${BASE}/api/fsrs/optimize" \
    -H 'Content-Type: application/json')"
opt_second_code="${opt_second##*$'\n'}"
opt_second_body="${opt_second%$'\n'*}"

if [[ "$opt_first_code" != "200" ]] || [[ "$opt_second_code" != "200" ]]; then
    echo "RED: noop POST /api/fsrs/optimize expected 200/200 got ${opt_first_code}/${opt_second_code}" >&2
    fail=1
fi

opt_first_params="$(printf '%s' "$opt_first_body" | jq -c '.params')"
opt_second_params="$(printf '%s' "$opt_second_body" | jq -c '.params')"
if [[ "$opt_first_params" != "$opt_second_params" ]]; then
    echo "RED: optimize params drifted between idempotent calls" >&2
    echo "  first:  $opt_first_params" >&2
    echo "  second: $opt_second_params" >&2
    fail=1
fi

if [[ $fail -eq 0 ]]; then
    echo "GREEN: idempotent enabled=${current} and optimize calls returned consistent 200 payloads"
fi
exit $fail
