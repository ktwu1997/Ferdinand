#!/usr/bin/env bash
# Ferdinand bootstrap — fresh-machine install helper.
#
# Detects platform + toolchain, builds the release binary, then runs the
# user-chosen install path.
#
# Usage:
#   bash scripts/bootstrap.sh                  # interactive prompt
#   INSTALL_METHOD=launchd bash scripts/bootstrap.sh
#   INSTALL_METHOD=docker  bash scripts/bootstrap.sh
#   INSTALL_METHOD=dev     bash scripts/bootstrap.sh   # build only
#   INSTALL_METHOD=none    bash scripts/bootstrap.sh   # alias of dev

set -euo pipefail

# --- locate repo root (script is in scripts/) ---------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# --- helpers -----------------------------------------------------------
log()  { printf '[bootstrap] %s\n' "$*"; }
warn() { printf '[bootstrap] WARN: %s\n' "$*" >&2; }
die()  { printf '[bootstrap] ERROR: %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

PLATFORM="$(uname -s)"
log "platform: ${PLATFORM}"
log "repo root: ${REPO_ROOT}"

# --- prerequisite checks ----------------------------------------------
check_rust() {
  if ! have cargo || ! have rustc; then
    die "Rust toolchain not found. Install rustup from https://rustup.rs/ then re-run."
  fi
  local version
  version="$(rustc --version | awk '{print $2}')"
  log "rustc ${version} found"
}

check_node() {
  if ! have node; then
    die "Node.js not found. Install Node 20+ (https://nodejs.org/) then re-run."
  fi
  local version
  version="$(node --version)"
  log "node ${version} found"
}

check_docker() {
  if ! have docker; then
    die "Docker not found. Install Docker (https://docs.docker.com/get-docker/) then re-run."
  fi
  log "docker $(docker --version | awk '{print $3}' | tr -d ',') found"
}

check_rust
check_node

# --- choose install method --------------------------------------------
INSTALL_METHOD="${INSTALL_METHOD:-}"

if [[ -z "${INSTALL_METHOD}" ]]; then
  echo
  echo "Choose an install path:"
  if [[ "${PLATFORM}" == "Darwin" ]]; then
    echo "  1) launchd  — macOS auto-start (recommended)"
  else
    echo "  1) launchd  — macOS only, not available on ${PLATFORM}"
  fi
  echo "  2) docker   — docker compose up -d"
  echo "  3) dev      — build binary only, you run it manually"
  echo
  read -r -p "Select [1-3] (default 3): " choice
  case "${choice:-3}" in
    1) INSTALL_METHOD="launchd" ;;
    2) INSTALL_METHOD="docker"  ;;
    3|"") INSTALL_METHOD="dev"  ;;
    *) die "Invalid choice: ${choice}" ;;
  esac
fi

log "install method: ${INSTALL_METHOD}"

# --- validate method vs platform --------------------------------------
case "${INSTALL_METHOD}" in
  launchd)
    if [[ "${PLATFORM}" != "Darwin" ]]; then
      die "launchd is macOS-only. Pick docker or dev on ${PLATFORM}."
    fi
    ;;
  docker)
    check_docker
    ;;
  dev|none)
    INSTALL_METHOD="dev"
    ;;
  *)
    die "Unknown INSTALL_METHOD: ${INSTALL_METHOD} (expected launchd|docker|dev|none)"
    ;;
esac

# --- build release binary ---------------------------------------------
RELEASE_SCRIPT="${REPO_ROOT}/build/release.sh"
if [[ ! -x "${RELEASE_SCRIPT}" && ! -f "${RELEASE_SCRIPT}" ]]; then
  die "build/release.sh not found at ${RELEASE_SCRIPT}. Did the release-build phase ship?"
fi

log "running build/release.sh ..."
bash "${RELEASE_SCRIPT}"
log "build complete"

# --- run install path --------------------------------------------------
case "${INSTALL_METHOD}" in
  launchd)
    INSTALL_SCRIPT="${REPO_ROOT}/launchd/install.sh"
    if [[ ! -f "${INSTALL_SCRIPT}" ]]; then
      die "launchd/install.sh not found. Phase 30-B may not have shipped yet."
    fi
    log "running launchd/install.sh ..."
    bash "${INSTALL_SCRIPT}"
    log "launchd job installed. Smoke: curl http://127.0.0.1:40001/api/health"
    ;;
  docker)
    COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
    if [[ ! -f "${COMPOSE_FILE}" ]]; then
      die "docker-compose.yml not found. Phase 30-C may not have shipped yet."
    fi
    log "running docker compose up -d ..."
    docker compose up -d
    log "docker stack up. Smoke: curl http://127.0.0.1:40001/api/health"
    ;;
  dev)
    log "build done. Run the server manually:"
    log "  cargo run --bin anki_server -- --users-dir /path/to/users-dir"
    log "And in another terminal:"
    log "  cd mockup && npm install && npm run dev"
    ;;
esac

log "bootstrap complete."
