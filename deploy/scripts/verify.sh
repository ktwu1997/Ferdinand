#!/usr/bin/env bash
set -euo pipefail
#
# verify.sh — post-deploy health check for the Ferdinand stack.
#
# Three checks:
#   1. `docker compose ps` reports both services as Up / running.
#   2. https://${DOMAIN}/api/health returns 200 (NOTE: 401 is also expected
#      if the Caddy basic_auth gate is in front of /api/health — this is the
#      default in the bundled Caddyfile, so we treat 401 as a soft pass for
#      the TLS-reachability check).
#   3. Recent caddy logs are scanned for cert-issuance lines (informational
#      only — not fail-fast).
#
# Each check prints PASS or FAIL with a reason. Exit code is 1 if any
# fail-fast check (1 or 2) failed.
#
# DOMAIN can be supplied:
#   - as the first positional arg, OR
#   - via the DOMAIN env var, OR
#   - read from /opt/ferdinand/.env (or $FERDINAND_INSTALL_DIR/.env)

REPO_DIR="${FERDINAND_INSTALL_DIR:-/opt/ferdinand}"
ENV_FILE="${REPO_DIR}/.env"

log() {
    echo "[verify] $*"
}

# Source DOMAIN from .env only if not already set and not passed positionally.
DOMAIN_ARG="${1:-}"

if [[ -n "$DOMAIN_ARG" ]]; then
    DOMAIN="$DOMAIN_ARG"
elif [[ -n "${DOMAIN:-}" ]]; then
    : # already set in env
elif [[ -f "$ENV_FILE" ]]; then
    # Pull DOMAIN out of the env file without sourcing the whole thing
    # (avoids accidentally evaluating bcrypt $-strings).
    DOMAIN="$(grep -E '^DOMAIN=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d "'\"")"
fi

if [[ -z "${DOMAIN:-}" ]]; then
    echo "[verify] ERROR: DOMAIN not set (pass as arg, set env, or populate .env)" >&2
    exit 1
fi

# Run from the repo dir so `docker compose ps` finds the compose file.
if [[ -d "$REPO_DIR" ]] && [[ -f "$REPO_DIR/docker-compose.yml" ]]; then
    cd "$REPO_DIR"
fi

OVERALL_PASS=1
declare -a RESULTS=()

# ---------- check 1: docker compose ps ----------
log "check 1: docker compose ps — services Up?"
PS_OUTPUT="$(docker compose ps 2>&1 || true)"
echo "$PS_OUTPUT"

if [[ -z "$PS_OUTPUT" ]]; then
    RESULTS+=("FAIL: check1: docker compose ps returned no output")
    OVERALL_PASS=0
else
    # Both expected services should appear and have an "Up" / "running" status.
    PS_LOWER="$(echo "$PS_OUTPUT" | tr '[:upper:]' '[:lower:]')"
    fail=0
    for svc in ferdinand caddy; do
        if ! echo "$PS_LOWER" | grep -q "$svc"; then
            RESULTS+=("FAIL: check1: service '$svc' not present in compose ps")
            fail=1
            continue
        fi
        # Find a line containing the service name with up/running status.
        if ! echo "$PS_LOWER" | grep "$svc" | grep -qE 'up|running'; then
            RESULTS+=("FAIL: check1: service '$svc' is not Up/running")
            fail=1
        fi
    done
    if (( fail == 0 )); then
        RESULTS+=("PASS: check1: ferdinand + caddy both Up")
    else
        OVERALL_PASS=0
    fi
fi

# ---------- check 2: TLS + /api/health ----------
log "check 2: https://${DOMAIN}/api/health responds"
# Allow 200 (no basic_auth on /api/health) or 401 (basic_auth gate covers it).
# Anything else (timeout, 5xx, 502 from caddy → ferdinand down) is a fail.
HTTP_CODE="$(curl -fsS -o /dev/null -w '%{http_code}' \
    --max-time 10 \
    "https://${DOMAIN}/api/health" 2>/dev/null || echo "000")"
case "$HTTP_CODE" in
    200)
        RESULTS+=("PASS: check2: /api/health returned 200")
        ;;
    401)
        # Bundled Caddyfile gates the entire site with basic_auth; 401
        # demonstrates TLS works and Caddy is reverse-proxying correctly.
        RESULTS+=("PASS: check2: /api/health returned 401 (basic_auth gate active — TLS reachable)")
        ;;
    000)
        RESULTS+=("FAIL: check2: connection failed (DNS / TLS / firewall — got 000)")
        OVERALL_PASS=0
        ;;
    *)
        RESULTS+=("FAIL: check2: /api/health returned HTTP $HTTP_CODE")
        OVERALL_PASS=0
        ;;
esac

# ---------- check 3: caddy cert log lines (informational) ----------
log "check 3: recent caddy log lines (cert-related; informational only)"
CADDY_LOG_LINES="$(docker compose logs --tail 50 caddy 2>&1 \
    | grep -Ei 'certificate|obtained|cert' \
    | tail -5 || true)"
if [[ -n "$CADDY_LOG_LINES" ]]; then
    echo "$CADDY_LOG_LINES"
    RESULTS+=("INFO: check3: caddy cert-related log lines present (see above)")
else
    RESULTS+=("INFO: check3: no cert-related caddy log lines in last 50 — may be steady-state")
fi

echo ""
echo "===== verify summary ====="
for line in "${RESULTS[@]}"; do
    echo "$line"
done
echo "=========================="

if (( OVERALL_PASS == 1 )); then
    log "overall: PASS"
    exit 0
else
    log "overall: FAIL"
    exit 1
fi
