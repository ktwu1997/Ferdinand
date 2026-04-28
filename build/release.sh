#!/usr/bin/env bash
# Phase 30-A: build the single-binary release of `anki_server` with the
# SvelteKit mockup embedded. Output lands in `target/release-lto/`.
set -euo pipefail

# Resolve repo root (this script lives in <repo>/build/).
cd "$(dirname "$0")/.."

echo "==> Building mockup (SvelteKit + adapter-static)"
(cd mockup && npm install --silent --prefer-offline && npm run build)

echo "==> Building anki_server (release-lto + embed-mockup)"
cargo build --profile release-lto --bin anki_server --features embed-mockup

bin="target/release-lto/anki_server"
echo
echo "Built: $(ls -lh "$bin")"
