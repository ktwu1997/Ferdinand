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
