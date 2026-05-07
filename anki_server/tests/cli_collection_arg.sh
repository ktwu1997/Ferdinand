#!/usr/bin/env bash
# Integration check: --users-dir <path> CLI flag (Phase A1).
#
# Verifies the binary's users-dir resolution logic:
#   (a) --users-dir flag works on its own,
#   (b) ANKI_USERS_DIR env var works as a fallback,
#   (c) the CLI flag wins when both are set (precedence).
#
# We point the flag/env at a non-writable nonexistent root so
# `AppState::open_for_user` fails fast (its `create_dir_all` cannot
# materialise the user dir under e.g. `/nonexistent`). The error message
# echoes the users-dir it tried — that's the observable signal we assert
# on. This keeps the test self-contained: no port binding, no real
# collection, no shared long-running server instance.
#
# The "neither set" path falls back to the source-visible default
# `data/users` (see DEFAULT_USERS_DIR in main.rs). We don't runtime-test
# that fallback here because there is no cwd that's both unwritable AND
# valid for the rest of the binary's bootstrap — testing it would
# either bind port 40001 or pollute /tmp with a fresh user dir.
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
# guarantees `AppState::open_for_user` fails fast (before any port bind)
# AND the anyhow context line "failed to open collection for user 'ktwu'
# under <path>" echoes the exact path we asked for.
CLI_PATH="/nonexistent/ferdinand_a1_cli_$$"
ENV_PATH="/nonexistent/ferdinand_a1_env_$$"

# Run the binary and capture stderr. We expect non-zero exit because the
# users-dir doesn't exist; we only care about which path appears in the
# error context.
run_server() {
    timeout 10s "$@" 2>&1 || true
}

fail=0

# Case 1: --users-dir flag, no env var set.
out=$(run_server env -u ANKI_USERS_DIR "$BIN" --users-dir "$CLI_PATH")
if ! grep -qF "$CLI_PATH" <<<"$out"; then
    echo "RED case1: --users-dir flag path not in error output" >&2
    echo "expected to find: $CLI_PATH" >&2
    echo "got: $out" >&2
    fail=1
fi

# Case 2: env var fallback, no flag.
out=$(run_server env "ANKI_USERS_DIR=$ENV_PATH" "$BIN")
if ! grep -qF "$ENV_PATH" <<<"$out"; then
    echo "RED case2: ANKI_USERS_DIR env path not in error output" >&2
    echo "expected to find: $ENV_PATH" >&2
    echo "got: $out" >&2
    fail=1
fi

# Case 3: both set → CLI flag wins, env path must NOT appear.
out=$(run_server env "ANKI_USERS_DIR=$ENV_PATH" "$BIN" --users-dir "$CLI_PATH")
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
