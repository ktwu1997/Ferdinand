#!/usr/bin/env bash
# Phase 30-A: build the single-binary release of `anki_server` with the
# SvelteKit mockup embedded. Output lands in `target/release-lto/`.
set -euo pipefail

# Resolve repo root (this script lives in <repo>/build/).
cd "$(dirname "$0")/.."

# rslib's prost build needs `protoc`. Prefer caller's PROTOC, else system
# protoc, else the bundled one that `./ninja` extracts. Fail loud otherwise
# so a fresh-machine install gets a clear hint instead of a cargo trace.
if [[ -z "${PROTOC:-}" ]]; then
  if command -v protoc >/dev/null 2>&1; then
    PROTOC="$(command -v protoc)"
  elif [[ -x "out/extracted/protoc/bin/protoc" ]]; then
    PROTOC="$(pwd)/out/extracted/protoc/bin/protoc"
  else
    echo "ERROR: protoc not found. Install protobuf-compiler (Debian: apt-get install protobuf-compiler; macOS: brew install protobuf) or run './ninja' once to download it." >&2
    exit 1
  fi
fi
export PROTOC
echo "==> Using PROTOC=$PROTOC"

echo "==> Building mockup (SvelteKit + adapter-static)"
(cd mockup && npm install --silent --prefer-offline && npm run build)

echo "==> Building anki_server (release-lto + embed-mockup)"
cargo build --profile release-lto --bin anki_server --features embed-mockup

bin="target/release-lto/anki_server"
echo
echo "Built: $(ls -lh "$bin")"
