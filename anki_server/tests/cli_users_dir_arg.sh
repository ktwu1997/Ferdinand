#!/usr/bin/env bash
# Integration check: --users-dir <path> CLI flag (Phase A1, kept current
# through Phase A2's auth refactor).
#
# Verifies the binary's users-dir resolution logic:
#   (a) --users-dir flag works on its own,
#   (b) ANKI_USERS_DIR env var works as a fallback,
#   (c) the CLI flag wins when both are set (precedence).
#
# We point the flag/env at a non-writable nonexistent root so the
# startup-time `create_dir_all(&users_dir)` in main.rs fails fast. The
# error message echoes the users-dir it tried — that's the observable
# signal we assert on. This keeps the test self-contained: no port
# binding, no real collection, no shared long-running server instance.
#
# Phase A2 added an auth db whose path defaults to a sibling of users_dir.
# A bad users_dir would also produce a bad default auth-db path, so we
# point ANKI_AUTH_DB at a writable temp file: that lets the auth-db open
# succeed, leaving the users-dir failure as the (only) observable error.
#
# The "neither set" path falls back to the source-visible default
# `data/users` (see DEFAULT_USERS_DIR in main.rs). We don't runtime-test
# that fallback here because there is no cwd that's both unwritable AND
# valid for the rest of the binary's bootstrap.
#
# Exit 0 = GREEN, non-zero = RED.
set -u

BIN="${ANKI_SERVER_BIN:-/workspace/Ferdinand/target/debug/anki_server}"

if [[ ! -x "$BIN" ]]; then
    echo "FAIL: anki_server binary missing at $BIN (build with 'cargo build -p anki_server')" >&2
    exit 2
fi

# Unique sentinels so we can grep precisely. Both paths point under a
# non-existent, non-writable root so `create_dir_all` refuses — that
# guarantees the early users-dir validation in main.rs fails fast (before
# any port bind) AND the anyhow context line "failed to create users-dir
# at <path>" echoes the exact path we asked for.
CLI_PATH="/nonexistent/ferdinand_a2_cli_$$"
ENV_PATH="/nonexistent/ferdinand_a2_env_$$"

# Hermetic auth db so the auth-bootstrap doesn't fail first and short-
# circuit the test. Cleaned up at exit.
TMP_AUTH=$(mktemp -t ferdinand_a2_auth_XXXXXX.db)
trap 'rm -f "$TMP_AUTH" "$TMP_AUTH"-shm "$TMP_AUTH"-wal' EXIT

# Run the binary and capture stderr. We expect non-zero exit because the
# users-dir doesn't exist; we only care about which path appears in the
# error context.
run_server() {
    timeout 10s "$@" 2>&1 || true
}

fail=0

# Case 1: --users-dir flag, no env var set.
out=$(run_server env -u ANKI_USERS_DIR ANKI_AUTH_DB="$TMP_AUTH" "$BIN" --users-dir "$CLI_PATH")
if ! grep -qF "$CLI_PATH" <<<"$out"; then
    echo "RED case1: --users-dir flag path not in error output" >&2
    echo "expected to find: $CLI_PATH" >&2
    echo "got: $out" >&2
    fail=1
fi

# Case 2: env var fallback, no flag.
out=$(run_server env "ANKI_USERS_DIR=$ENV_PATH" ANKI_AUTH_DB="$TMP_AUTH" "$BIN")
if ! grep -qF "$ENV_PATH" <<<"$out"; then
    echo "RED case2: ANKI_USERS_DIR env path not in error output" >&2
    echo "expected to find: $ENV_PATH" >&2
    echo "got: $out" >&2
    fail=1
fi

# Case 3: both set → CLI flag wins, env path must NOT appear.
out=$(run_server env "ANKI_USERS_DIR=$ENV_PATH" ANKI_AUTH_DB="$TMP_AUTH" "$BIN" --users-dir "$CLI_PATH")
if ! grep -qF "$CLI_PATH" <<<"$out"; then
    echo "RED case3: CLI path missing when both set (precedence broken)" >&2
    echo "expected to find: $CLI_PATH" >&2
    echo "got: $out" >&2
    fail=1
fi
if grep -qF "$ENV_PATH" <<<"$out"; then
    echo "RED case3: env path leaked when --users-dir should override it" >&2
    echo "got: $out" >&2
    fail=1
fi

if [[ $fail -eq 0 ]]; then
    echo "GREEN: --users-dir flag works, env fallback works, CLI wins precedence"
fi
exit $fail
