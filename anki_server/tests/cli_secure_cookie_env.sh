#!/usr/bin/env bash
# Integration test for ANKI_SECURE_COOKIE env override (issue #8 fix).
#
# Verifies:
#   1. ANKI_SECURE_COOKIE=true + loopback bind → Set-Cookie has Secure flag.
#   2. No env var + loopback bind (existing heuristic) → Set-Cookie has no Secure flag.
#   3. ANKI_SECURE_COOKIE=false + 0.0.0.0 bind (explicit override) → Set-Cookie has no Secure flag.
#
# Each case spins a fresh server instance on a dedicated port, seeds a user,
# logs in, and inspects the Set-Cookie header.
#
# Exit 0 = GREEN, non-zero = RED.
set -u

BIN="${ANKI_SERVER_BIN:-/workspace/Ferdinand/target/debug/anki_server}"

if [[ ! -x "$BIN" ]]; then
    echo "FAIL: anki_server binary missing at $BIN (build with 'cargo build -p anki_server')" >&2
    exit 2
fi

fail=0

# Allocate an unused port on 127.0.0.1.
free_port() {
    python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
}

# kill_server PID TMP_DIR — terminate server and wipe temp dir.
kill_server() {
    local pid="$1" tmp="$2"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            if ! kill -0 "$pid" 2>/dev/null; then break; fi
            sleep 0.2
        done
        kill -9 "$pid" 2>/dev/null || true
    fi
    rm -rf "$tmp"
}

# check_secure LABEL PORT BIND_ADDR EXPECT [ENV_KEY=VAL ...]
# Spawns a server on PORT/BIND_ADDR with any extra KEY=VAL env pairs,
# logs in, and checks whether Set-Cookie contains "Secure".
# EXPECT: "present" | "absent"
check_secure() {
    local label="$1" port="$2" bind_addr="$3" expect="$4"
    shift 4
    # Remaining args are KEY=VALUE env overrides.
    local extra_env=("$@")

    local tmp
    tmp=$(mktemp -d -t ferdinand-sc-XXXXXX)
    local users_dir="$tmp/users"
    local auth_db="$tmp/auth.db"
    local server_log="$tmp/server.log"
    local cookie_jar="$tmp/cookies.txt"
    mkdir -p "$users_dir"

    local seed_user="testuser$$"
    local seed_pw="testpw-$$"
    local base="http://127.0.0.1:$port"
    local srv_pid=""

    # Spawn server with the given env overrides.
    env \
        ANKI_SERVER_PORT="$port" \
        ANKI_BIND="$bind_addr" \
        FERDINAND_SEED_USER="$seed_user" \
        FERDINAND_SEED_PASSWORD="$seed_pw" \
        RUST_LOG="info" \
        "${extra_env[@]+"${extra_env[@]}"}" \
        "$BIN" --users-dir "$users_dir" --auth-db "$auth_db" >"$server_log" 2>&1 &
    srv_pid=$!

    # Wait for server ready (poll /api/health up to ~10 s).
    local ready=0
    for _ in $(seq 1 50); do
        if curl -fsS -o /dev/null --max-time 1 "$base/api/health" 2>/dev/null; then
            ready=1
            break
        fi
        sleep 0.2
    done
    if [[ $ready -ne 1 ]]; then
        echo "RED: $label — server never became ready on $base" >&2
        tail -30 "$server_log" >&2 || true
        kill_server "$srv_pid" "$tmp"
        fail=1
        return
    fi

    # POST /api/auth/login — capture full response headers.
    local response
    response=$(curl -si -c "$cookie_jar" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$seed_user\",\"password\":\"$seed_pw\"}" \
        "$base/api/auth/login")

    kill_server "$srv_pid" "$tmp"

    local set_cookie_line
    set_cookie_line=$(echo "$response" | grep -i "^set-cookie:" | head -1)

    if [[ "$expect" == "present" ]]; then
        if echo "$set_cookie_line" | grep -qi "Secure"; then
            echo "  ✓ $label → Secure present in Set-Cookie"
        else
            echo "RED: $label — expected Secure flag but Set-Cookie was: $set_cookie_line" >&2
            fail=1
        fi
    else
        if echo "$set_cookie_line" | grep -qi "Secure"; then
            echo "RED: $label — expected NO Secure flag but Set-Cookie was: $set_cookie_line" >&2
            fail=1
        else
            echo "  ✓ $label → Secure absent from Set-Cookie"
        fi
    fi
}

# ---- Cases ----------------------------------------------------------------

# 1. ANKI_SECURE_COOKIE=true + loopback → Secure must be present.
PORT1=$(free_port)
check_secure \
    "1. ANKI_SECURE_COOKIE=true on loopback" \
    "$PORT1" "127.0.0.1" "present" \
    "ANKI_SECURE_COOKIE=true"

# 2. No env var + loopback → heuristic fires: Secure absent.
PORT2=$(free_port)
check_secure \
    "2. No env var on loopback (heuristic)" \
    "$PORT2" "127.0.0.1" "absent"

# 3. ANKI_SECURE_COOKIE=false + 0.0.0.0 → explicit override: Secure absent
#    even though heuristic would set it for non-loopback.
#    Non-loopback bind requires FERDINAND_SESSION_KEY.
PORT3=$(free_port)
SESSION_KEY=$(openssl rand -base64 64 | tr -d '\n')
check_secure \
    "3. ANKI_SECURE_COOKIE=false on 0.0.0.0 (explicit override)" \
    "$PORT3" "0.0.0.0" "absent" \
    "ANKI_SECURE_COOKIE=false" \
    "FERDINAND_SESSION_KEY=$SESSION_KEY"

# ---- Result ----------------------------------------------------------------
if [[ $fail -eq 0 ]]; then
    echo "GREEN: 3/3 secure-cookie-env cases passed"
fi
exit $fail
