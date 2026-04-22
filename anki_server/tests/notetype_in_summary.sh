#!/usr/bin/env bash
# Integration check: /api/study/queue must surface notetype_id + notetype_css
# so the mockup reviewer can style cards per notetype (Phase 5-A).
#
# Exit 0 = GREEN, non-zero = RED.
set -u

BASE="${ANKI_SERVER:-http://localhost:40001}"
DECK_ID="${DECK_ID:-1776837237914}"

body="$(curl -sS --fail "${BASE}/api/study/queue?deck_id=${DECK_ID}&limit=1")" || {
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
