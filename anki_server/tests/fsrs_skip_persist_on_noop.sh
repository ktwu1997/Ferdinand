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
# Exit 0 = GREEN, non-zero = RED.
set -u

BASE="${ANKI_SERVER:-http://localhost:40001}"

fail=0

# 1. PUT /api/fsrs/enabled with the current state twice — both must be 200,
#    second must echo identical body to the first.
current="$(curl -sS --fail "${BASE}/api/fsrs/enabled" | jq -r '.enabled')" || {
    echo "FAIL: GET /api/fsrs/enabled unreachable" >&2
    exit 2
}

first="$(curl -sS -w '\n%{http_code}' -X PUT "${BASE}/api/fsrs/enabled" \
    -H 'Content-Type: application/json' \
    -d "{\"enabled\":${current}}")"
first_code="${first##*$'\n'}"
first_body="${first%$'\n'*}"

second="$(curl -sS -w '\n%{http_code}' -X PUT "${BASE}/api/fsrs/enabled" \
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
opt_first="$(curl -sS -w '\n%{http_code}' -X POST "${BASE}/api/fsrs/optimize" \
    -H 'Content-Type: application/json')"
opt_first_code="${opt_first##*$'\n'}"
opt_first_body="${opt_first%$'\n'*}"

opt_second="$(curl -sS -w '\n%{http_code}' -X POST "${BASE}/api/fsrs/optimize" \
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
