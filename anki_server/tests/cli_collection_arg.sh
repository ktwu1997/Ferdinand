#!/usr/bin/env bash
# Integration check: --collection <path> CLI flag (Phase 8-F).
#
# Verifies the binary's collection-path resolution logic:
#   (a) --collection flag works on its own,
#   (b) ANKI_COLLECTION env var still works as a fallback,
#   (c) the CLI flag wins when both are set (precedence),
#   (d) absence of both yields a clear error.
#
# We intentionally point at non-existent paths so the binary fails fast
# inside `AppState::open` after path resolution. The error message echoes
# the path it tried — that's the observable signal we assert on. This
# keeps the test self-contained: no port binding, no real collection,
# no shared long-running server instance.
#
# Exit 0 = GREEN, non-zero = RED.
set -u

BIN="${ANKI_SERVER_BIN:-/workspace/Ferdinand/target/debug/anki_server}"

if [[ ! -x "$BIN" ]]; then
    echo "FAIL: anki_server binary missing at $BIN (build with 'cargo build -p anki_server')" >&2
    exit 2
fi

# Unique sentinels so we can grep precisely. Both paths point under a
# non-existent directory so SQLite refuses to create the file — that
# guarantees `AppState::open` fails fast (before any port bind) AND the
# anyhow context line "failed to open collection at <path>" echoes the
# exact path we asked for. If we used /tmp, CollectionBuilder would
# happily create a fresh collection and the test would race against the
# port bind.
CLI_PATH="/nonexistent/ferdinand_phase8f_cli_$$.anki2"
ENV_PATH="/nonexistent/ferdinand_phase8f_env_$$.anki2"

# Run the binary and capture stderr. We expect non-zero exit because the
# collection path doesn't exist; we only care about which path appears in
# the error context.
run_server() {
    # Disable env_logger output noise; we want the anyhow error chain.
    # `unset ANKI_COLLECTION` happens per-invocation via `env -u` /
    # explicit assignment so there is no cross-test bleed.
    timeout 10s "$@" 2>&1 || true
}

fail=0

# Case 1: --collection flag, no env var set.
out=$(run_server env -u ANKI_COLLECTION "$BIN" --collection "$CLI_PATH")
if ! grep -qF "$CLI_PATH" <<<"$out"; then
    echo "RED case1: --collection flag path not in error output" >&2
    echo "expected to find: $CLI_PATH" >&2
    echo "got: $out" >&2
    fail=1
fi

# Case 2: env var fallback, no flag.
out=$(run_server env "ANKI_COLLECTION=$ENV_PATH" "$BIN")
if ! grep -qF "$ENV_PATH" <<<"$out"; then
    echo "RED case2: ANKI_COLLECTION env path not in error output" >&2
    echo "expected to find: $ENV_PATH" >&2
    echo "got: $out" >&2
    fail=1
fi

# Case 3: both set → CLI flag wins, env path must NOT appear.
out=$(run_server env "ANKI_COLLECTION=$ENV_PATH" "$BIN" --collection "$CLI_PATH")
if ! grep -qF "$CLI_PATH" <<<"$out"; then
    echo "RED case3: CLI path missing when both set (precedence broken)" >&2
    echo "expected to find: $CLI_PATH" >&2
    echo "got: $out" >&2
    fail=1
fi
if grep -qF "$ENV_PATH" <<<"$out"; then
    echo "RED case3: env path leaked when --collection should override it" >&2
    echo "got: $out" >&2
    fail=1
fi

# Case 4: neither set → clear error mentioning both options.
out=$(run_server env -u ANKI_COLLECTION "$BIN")
if ! grep -qiE 'collection path required|--collection|ANKI_COLLECTION' <<<"$out"; then
    echo "RED case4: missing-path error message not actionable" >&2
    echo "got: $out" >&2
    fail=1
fi

if [[ $fail -eq 0 ]]; then
    echo "GREEN: --collection flag works, env fallback works, CLI wins precedence, missing-both errors clearly"
fi
exit $fail
