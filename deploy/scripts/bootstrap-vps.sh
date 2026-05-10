#!/usr/bin/env bash
set -euo pipefail
#
# bootstrap-vps.sh — idempotent first-boot setup for a fresh Ubuntu 22.04 / 24.04
# VPS that will host the Ferdinand stack (anki_server + Caddy).
#
# What it does (each step is safe to re-run):
#   1. Refreshes apt + installs base utilities (ca-certificates, curl, gnupg,
#      ufw, git, cron, tar, gzip).
#   2. Configures ufw: deny inbound by default, allow OpenSSH + 80/tcp +
#      443/tcp (+ 443/udp for HTTP/3). Enables ufw non-interactively.
#   3. Installs Docker CE + docker-compose-plugin from the official Docker apt
#      repo (signed-by keyring), only if they're not already installed.
#   4. Creates a dedicated `ferdinand` system user, adds it to the docker
#      group, and clones (or pulls) the Ferdinand repo into /opt/ferdinand
#      owned by that user.
#
# Re-runs are non-destructive: package installs are skipped when present,
# ufw rules are idempotent, the user is created only if missing, and the
# clone falls back to `git pull --ff-only` if the directory already exists.
#
# Must run as root.

REPO_URL="${FERDINAND_REPO_URL:-https://github.com/ktwu1997/Ferdinand.git}"
INSTALL_DIR="${FERDINAND_INSTALL_DIR:-/opt/ferdinand}"
SERVICE_USER="${FERDINAND_USER:-ferdinand}"

log() {
    echo "[bootstrap-vps] $*"
}

err() {
    echo "[bootstrap-vps] ERROR: $*" >&2
}

require_root() {
    if [[ $EUID -ne 0 ]]; then
        err "this script must be run as root (use sudo)."
        exit 1
    fi
}

apt_install_base() {
    log "refreshing apt index..."
    DEBIAN_FRONTEND=noninteractive apt-get update -y

    log "installing base utilities..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        ufw \
        git \
        cron \
        tar \
        gzip
}

configure_ufw() {
    log "configuring ufw rules (idempotent)..."
    # Defaults — re-applying these is safe.
    ufw default deny incoming >/dev/null
    ufw default allow outgoing >/dev/null
    # Rule adds are idempotent (ufw silently dedupes).
    ufw allow OpenSSH >/dev/null
    ufw allow 80/tcp comment 'http (acme http-01)' >/dev/null
    ufw allow 443/tcp comment 'https (caddy)' >/dev/null
    ufw allow 443/udp comment 'https/3 quic (caddy, optional)' >/dev/null

    # Only enable if not already active. `ufw enable` is interactive without
    # --force.
    if ufw status | grep -qE '^Status:\s+active'; then
        log "ufw is already active — leaving in place."
    else
        log "enabling ufw..."
        ufw --force enable
    fi
}

install_docker() {
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        log "docker + compose plugin already installed — skipping."
        return 0
    fi

    log "installing docker engine + compose plugin from docker.com apt repo..."

    install -m 0755 -d /etc/apt/keyrings
    if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
            -o /etc/apt/keyrings/docker.asc
        chmod a+r /etc/apt/keyrings/docker.asc
    fi

    local arch codename
    arch="$(dpkg --print-architecture)"
    # shellcheck disable=SC1091
    codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"

    local sources_line="deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable"
    if [[ ! -f /etc/apt/sources.list.d/docker.list ]] || \
       ! grep -qF "$sources_line" /etc/apt/sources.list.d/docker.list; then
        echo "$sources_line" > /etc/apt/sources.list.d/docker.list
    fi

    DEBIAN_FRONTEND=noninteractive apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin

    systemctl enable --now docker >/dev/null 2>&1 || true
}

ensure_service_user() {
    if id "$SERVICE_USER" >/dev/null 2>&1; then
        log "service user '$SERVICE_USER' already exists."
    else
        log "creating service user '$SERVICE_USER'..."
        useradd --system --create-home --shell /bin/bash "$SERVICE_USER"
    fi

    # Add to docker group (no-op if already a member).
    if getent group docker >/dev/null 2>&1; then
        usermod -aG docker "$SERVICE_USER"
    else
        log "WARNING: docker group not found — skipping group membership."
    fi
}

clone_or_update_repo() {
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        log "repo already present at $INSTALL_DIR — pulling latest..."
        git -C "$INSTALL_DIR" fetch --quiet origin
        # ff-only is safe: refuses to clobber local commits.
        if ! git -C "$INSTALL_DIR" pull --ff-only --quiet; then
            log "WARNING: git pull --ff-only failed (local divergence?). Leaving as-is."
        fi
        # Keep submodules (ftl/core-repo, ftl/qt-repo) in sync with the
        # superproject pointer.
        git -C "$INSTALL_DIR" submodule update --init --recursive --quiet \
            || log "WARNING: submodule update failed; rslib/i18n/build.rs may panic."
    else
        log "cloning repo into $INSTALL_DIR..."
        mkdir -p "$(dirname "$INSTALL_DIR")"
        # ftl/core-repo + ftl/qt-repo are git submodules; without
        # --recurse-submodules rslib/i18n/build.rs panics at gather.rs:62
        # (read_dir on the empty stub dir).
        git clone --quiet --recurse-submodules "$REPO_URL" "$INSTALL_DIR"
    fi

    chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
}

main() {
    require_root
    apt_install_base
    configure_ufw
    install_docker
    ensure_service_user
    clone_or_update_repo

    log "Done — next step: run $INSTALL_DIR/deploy/scripts/init-env.sh"
}

main "$@"
