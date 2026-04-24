#!/usr/bin/env bash
# Integration check: GET /media/:filename must:
#   (a) serve files from the collection's .media/ sibling directory with the
#       correct content-type,
#   (b) reject path traversal attempts (percent-encoded slashes, `..`,
#       leading-dot hidden files) with 400,
#   (c) return 404 for missing files rather than leaking filesystem errors.
#
# The handler logic lives in anki_server/src/routes/media.rs. Validation
# invariants are mirrored in its #[cfg(test)] module for fast unit feedback.
#
# Exit 0 = GREEN, non-zero = RED.
set -u

BASE="${ANKI_SERVER:-http://localhost:40001}"
MEDIA_DIR="${ANKI_MEDIA_DIR:-/tmp/ferdinand_dev/collection.media}"
FIXTURE_SRC="$(dirname "$0")/fixtures/media/hello.png"
FIXTURE_NAME="ferdinand_media_probe.png"

if [[ ! -f "$FIXTURE_SRC" ]]; then
    echo "FAIL: fixture missing at $FIXTURE_SRC" >&2
    exit 2
fi

mkdir -p "$MEDIA_DIR"
cp "$FIXTURE_SRC" "$MEDIA_DIR/$FIXTURE_NAME"
trap 'rm -f "$MEDIA_DIR/$FIXTURE_NAME"' EXIT

fail=0

# Case 1: existing file → 200 + image/png + exact bytes
resp_headers=$(mktemp)
resp_body=$(mktemp)
trap 'rm -f "$resp_headers" "$resp_body" "$MEDIA_DIR/$FIXTURE_NAME"' EXIT

status=$(curl -sS --path-as-is -o "$resp_body" -D "$resp_headers" -w '%{http_code}' \
    "${BASE}/media/${FIXTURE_NAME}")
ctype=$(grep -i '^content-type:' "$resp_headers" | tr -d '\r' | awk -F': ' '{print $2}' | tr '[:upper:]' '[:lower:]')

if [[ "$status" != "200" ]]; then
    echo "RED case1: existing file expected 200, got $status" >&2
    fail=1
fi
if [[ "$ctype" != "image/png" ]]; then
    echo "RED case1: content-type expected 'image/png', got '$ctype'" >&2
    fail=1
fi
if ! cmp -s "$FIXTURE_SRC" "$resp_body"; then
    echo "RED case1: body bytes do not match fixture" >&2
    fail=1
fi

# Case 2: missing file → 404
status=$(curl -sS --path-as-is -o /dev/null -w '%{http_code}' \
    "${BASE}/media/ferdinand_definitely_absent_xyz.png")
if [[ "$status" != "404" ]]; then
    echo "RED case2: missing file expected 404, got $status" >&2
    fail=1
fi

# Case 3: percent-encoded slash traversal → 400
status=$(curl -sS --path-as-is -o /dev/null -w '%{http_code}' \
    "${BASE}/media/..%2Fetc%2Fpasswd")
if [[ "$status" != "400" ]]; then
    echo "RED case3: %2F traversal expected 400, got $status" >&2
    fail=1
fi

# Case 4: percent-encoded dot-dot → 400
status=$(curl -sS --path-as-is -o /dev/null -w '%{http_code}' \
    "${BASE}/media/%2E%2E")
if [[ "$status" != "400" ]]; then
    echo "RED case4: %2E%2E expected 400, got $status" >&2
    fail=1
fi

# Case 5: leading-dot hidden file → 400
status=$(curl -sS --path-as-is -o /dev/null -w '%{http_code}' \
    "${BASE}/media/.hidden")
if [[ "$status" != "400" ]]; then
    echo "RED case5: leading-dot expected 400, got $status" >&2
    fail=1
fi

# Case 6: null-byte → 400
status=$(curl -sS --path-as-is -o /dev/null -w '%{http_code}' \
    "${BASE}/media/hello%00.png")
if [[ "$status" != "400" ]]; then
    echo "RED case6: null-byte expected 400, got $status" >&2
    fail=1
fi

if [[ $fail -eq 0 ]]; then
    size=$(wc -c < "$resp_body" | tr -d ' ')
    echo "GREEN: /media route serves $FIXTURE_NAME ($size bytes, image/png) and rejects traversal"
fi
exit $fail
