#!/usr/bin/env bash
# Integration test for Phase A2 cookie-session auth.
#
# Spins a real anki_server on an unused port with a hermetic temp users-dir
# + temp auth-db, then exercises the four /api/auth/* endpoints + the auth
# gate on /api/decks via curl with a cookie jar. Asserts on HTTP status
# codes and the JSON shape of /api/auth/me.
#
# Mirrors the "lightweight cli check" feel of cli_users_dir_arg.sh but
# differs in shape: auth needs a running socket, not just a startup-error
# string. We isolate the run with random port + temp dirs, kill the server
# in a trap, and tear everything down on exit so parallel `cargo test`
# instances don't collide.
#
# Exit 0 = GREEN, non-zero = RED (with the failing case printed to stderr).
set -u

BIN="${ANKI_SERVER_BIN:-/workspace/Ferdinand/target/debug/anki_server}"

if [[ ! -x "$BIN" ]]; then
    echo "FAIL: anki_server binary missing at $BIN (build with 'cargo build -p anki_server')" >&2
    exit 2
fi

# ---- Hermetic environment --------------------------------------------------
TMP_ROOT=$(mktemp -d -t ferdinand-a2-cli-XXXXXX)
USERS_DIR="$TMP_ROOT/users"
AUTH_DB="$TMP_ROOT/auth.db"
COOKIE_JAR="$TMP_ROOT/cookies.txt"
SERVER_LOG="$TMP_ROOT/server.log"
mkdir -p "$USERS_DIR"

# Pick an unused high port so this test stays parallelisable.
# `python3 -c '...'` opens a socket on port 0 (kernel-assigned), reads back
# what the kernel chose, and prints it. Tiny race between us closing the
# socket and the server binding it, but in practice the server takes long
# enough to start that it's fine.
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
BASE="http://127.0.0.1:$PORT"

SEED_USER="ktwu"
SEED_PASSWORD="phaseA2-test-$$"

cleanup() {
    if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null
        # SIGINT first; if it doesn't quit in 2s, escalate.
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
# Bind to loopback explicitly so the test never accidentally exposes a
# debug-mode user to the LAN.
ANKI_SERVER_PORT="$PORT" \
ANKI_BIND="127.0.0.1" \
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

# ---- Helpers ---------------------------------------------------------------
fail=0

# Run curl, capture status + body. Args: METHOD URL [DATA] [USE_COOKIE_JAR]
# Sets `STATUS` and `BODY` globals.
http() {
    local method="$1" url="$2" data="${3:-}" cookie="${4:-no}"
    local args=( -sS -o "$TMP_ROOT/body.txt" -w "%{http_code}" -X "$method" "$url" )
    if [[ -n "$data" ]]; then
        args+=( -H "Content-Type: application/json" -d "$data" )
    fi
    if [[ "$cookie" == "yes" ]]; then
        args+=( -b "$COOKIE_JAR" -c "$COOKIE_JAR" )
    fi
    STATUS=$(curl "${args[@]}")
    BODY=$(cat "$TMP_ROOT/body.txt")
}

assert_status() {
    local label="$1" want="$2"
    if [[ "$STATUS" != "$want" ]]; then
        echo "RED: $label — expected $want, got $STATUS (body=$BODY)" >&2
        fail=1
    else
        echo "  ✓ $label → $STATUS"
    fi
}

# ---- Cases ----------------------------------------------------------------

# 1. Pre-login: protected route returns 401.
http GET "$BASE/api/decks"
assert_status "1. GET /api/decks unauth" 401

# 2. Pre-login: /api/auth/me returns 401.
http GET "$BASE/api/auth/me"
assert_status "2. GET /api/auth/me unauth" 401

# 3. Login with bad password → 401.
http POST "$BASE/api/auth/login" \
    "{\"username\":\"$SEED_USER\",\"password\":\"wrong\"}" yes
assert_status "3. POST /api/auth/login wrong password" 401

# 4. Login with seed creds → 200.
http POST "$BASE/api/auth/login" \
    "{\"username\":\"$SEED_USER\",\"password\":\"$SEED_PASSWORD\"}" yes
assert_status "4. POST /api/auth/login good creds" 200

# 5. /api/auth/me now returns 200 + correct username.
http GET "$BASE/api/auth/me" "" yes
assert_status "5. GET /api/auth/me authed" 200
if ! grep -qF "\"username\":\"$SEED_USER\"" <<<"$BODY"; then
    echo "RED: /api/auth/me body did not contain username='$SEED_USER' (body=$BODY)" >&2
    fail=1
fi

# 6. Authed /api/decks → 200.
http GET "$BASE/api/decks?include_counts=1" "" yes
assert_status "6. GET /api/decks authed" 200

# 7. Logout → 204.
http POST "$BASE/api/auth/logout" "" yes
assert_status "7. POST /api/auth/logout" 204

# 8. /api/auth/me after logout → 401.
http GET "$BASE/api/auth/me" "" yes
assert_status "8. GET /api/auth/me post-logout" 401

# 9. /api/auth/register no longer exists — verify it 404 or 405 (route
# deleted in M9; tower returns 405 when a fallback GET handler shadows
# the same path — both are equivalent "route gone" signals).
http POST "$BASE/api/auth/register" \
    "{\"username\":\"alice\",\"password\":\"alice-test-pwd\"}" yes
case "$STATUS" in
    404|405)
        echo "  ✓ 9. POST /api/auth/register is gone → $STATUS"
        ;;
    *)
        echo "RED: 9. POST /api/auth/register expected 404 or 405, got $STATUS (body=$BODY)" >&2
        fail=1
        ;;
esac

# 10. Re-login after logout to confirm session cycling works end-to-end.
http POST "$BASE/api/auth/login" \
    "{\"username\":\"$SEED_USER\",\"password\":\"$SEED_PASSWORD\"}" yes
assert_status "10. POST /api/auth/login second session" 200

if [[ $fail -eq 0 ]]; then
    echo "GREEN: 10/10 auth-endpoint cases passed"
fi
exit $fail
