# Ferdinand — friend self-host VPS deploy SOP (Phase B-deploy)

Single-tenant single-VPS deployment of the Ferdinand fork. Target shape:

- Linode 1 GB or larger, Ubuntu 24.04 LTS, public IPv4
- One DNS A record pointing your domain at the VPS
- Docker + docker-compose-plugin installed
- Two containers: `ferdinand` (Rust API + embedded SvelteKit SPA) and
  `ferdinand-caddy` (TLS termination + HTTP basic_auth + reverse proxy)
- Two named volumes: `ferdinand_anki_data` (collection + auth.db),
  `ferdinand_caddy_data` (Let's Encrypt certs)
- Daily cron tar of the collection + media to `/var/backups/anki/`,
  14-day retention

The artifacts live at the repo root:

| Path                | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `Dockerfile`        | Multi-stage build: SvelteKit → Rust → slim Debian    |
| `Caddyfile`         | TLS + basic_auth + reverse_proxy → ferdinand:40001   |
| `docker-compose.yml`| Orchestrates `ferdinand` + `caddy`                   |
| `.dockerignore`     | Trims build context (no target/, node_modules/, etc) |
| `deploy/README.md`  | This file                                            |

## Static-asset serving choice

The `anki_server` binary, when built with `--features embed-mockup` (which
the Dockerfile turns on), embeds the SvelteKit `mockup/build/` output via
`include_dir!()` and serves it from a `fallback` route after the `/api/*`
router. Hard-refresh of any client-side route falls back to `index.html`.

This means **Caddy is a pure reverse proxy** — it does not serve static
files itself. Pros: one binary, one cert path, no ambiguity about which
process owns the SPA. Cons: an SPA-only patch still requires a full image
rebuild. Acceptable for the friend self-host route where deploys are rare
and image size stays modest.

The alternative (Caddy `file_server` for SPA, `reverse_proxy` only for
`/api/*`) would split serving across two processes and require a shared
volume for the build output. Rejected for this phase.

## 1. VPS bootstrap (Ubuntu 24.04)

Run as root or with `sudo`. The VPS IP is referenced as `$VPS_IP`; replace
with your actual address.

```bash
# Refresh package index + base utilities
apt-get update
apt-get install -y curl ca-certificates ufw cron tar gzip

# Firewall: allow ssh + http + https only. Block everything else inbound.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp     comment 'http (acme http-01)'
ufw allow 443/tcp    comment 'https (caddy)'
ufw allow 443/udp    comment 'https/3 quic (caddy, optional)'
ufw --force enable

# Docker engine + compose plugin (official upstream repo, not Ubuntu's)
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# (Optional) Run docker as a non-root user
# usermod -aG docker <your-deploy-user>

# Smoke
docker --version
docker compose version
```

## 2. DNS

Point an A record at `$VPS_IP`:

```text
anki.example.com.   A   $VPS_IP   TTL 300
```

Wait until `dig +short anki.example.com` returns `$VPS_IP` from a public
resolver before bringing Caddy up. If DNS isn't ready, Let's Encrypt's
HTTP-01 challenge will fail and you'll burn rate-limit attempts.

## 3. Clone the repo

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/<your-fork>/Ferdinand.git
cd Ferdinand
```

## 4. Generate secrets

### 4a. Caddy basic_auth bcrypt hash

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'CHANGE-ME-LONG-PASSWORD'
# → $2a$14$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Copy the full `$2a$14$...` string. **Quote it** when you paste into `.env`
because `$` triggers shell expansion and bcrypt hashes contain `$`.

### 4b. Anki session cookie key

```bash
openssl rand -base64 64
```

This produces a 64-byte key in 88 base64 characters (one line). It signs
the `ferdinand_session` cookie. Losing it logs every user out on next
restart — back it up alongside the volume tar.

### 4c. (Optional) Initial seed user

If you want a user provisioned on first boot, set `FERDINAND_SEED_USER` and
`FERDINAND_SEED_PASSWORD`. The seed runs once (idempotent — skipped if the
user already exists). You can omit both and use `/api/auth/register` later.

## 5. `.env` template

Create `.env` next to `docker-compose.yml`. **Never commit this file.** The
repo's root `.dockerignore` already excludes `.env`.

```bash
cat > .env <<'EOF'
# --- Caddy / TLS ---
DOMAIN=anki.example.com
ACME_EMAIL=you@example.com

# --- HTTP basic_auth (the soft browser-level gate in front of the app) ---
BASIC_AUTH_USER=friend
# IMPORTANT: single-quote this so $-chars in the bcrypt hash are not
# interpreted by docker compose / your shell.
BASIC_AUTH_HASH='$2a$14$REPLACE_ME_WITH_OUTPUT_FROM_caddy_hash-password'

# --- anki_server ---
# 64-byte base64-encoded cookie signing key. openssl rand -base64 64
FERDINAND_SESSION_KEY=REPLACE_ME_WITH_openssl_rand_-base64_64

# Phase B2 admin: only this username can hit /api/admin/*. Leave empty
# to disable admin endpoints entirely (recommended unless you need them).
ANKI_ADMIN_USERNAME=

# Optional: cap apkg upload size (bytes). Defaults to a code-side value.
ANKI_IMPORT_MAX_BYTES=

# Optional: seed a user on first boot. Idempotent — skipped if user exists.
# Leave both empty to skip seeding entirely.
FERDINAND_SEED_USER=
FERDINAND_SEED_PASSWORD=
EOF

chmod 600 .env
```

## 6. Bring it up

```bash
docker compose up -d --build
docker compose logs -f
```

Caddy will request a Let's Encrypt cert on first boot. Watch the logs for
`certificate obtained successfully` (typically 5-30 seconds after DNS
propagation completes). If you see ACME errors, double-check:

- `dig +short $DOMAIN` matches your VPS IP from a public resolver
- ufw allows 80/tcp and 443/tcp
- No other process is bound to 80 or 443 on the VPS (`ss -ltnp`)

Once certs are issued, browse `https://$DOMAIN/`. You'll get an HTTP
basic_auth dialog (the Caddy gate). Enter `$BASIC_AUTH_USER` and the
plaintext password. After that, the SvelteKit login page loads — log in
with your seed user (or register if you didn't seed).

Health check (no auth needed):

```bash
curl -fsS https://$DOMAIN/api/health
# → {"status":"ok",...}
```

## 7. Daily backup cron

Backs up the collection + media + auth.db to a host-side tarball. Keeps
14 days of dailies. Add to `/etc/cron.d/ferdinand-backup`:

```cron
# m h dom mon dow user command
30 3 * * * root /usr/local/bin/ferdinand-backup.sh >> /var/log/ferdinand-backup.log 2>&1
```

`/usr/local/bin/ferdinand-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

VOLUME=ferdinand_anki_data
BACKUP_DIR=/var/backups/anki
RETENTION_DAYS=14
DATE=$(date +%Y-%m-%d)

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Tar the entire docker-managed volume directory. The volume contains:
#   /data/users/<username>/collection.anki2
#   /data/users/<username>/collection.media/
#   /data/auth.db
# We tar the whole /data prefix so the restore is a single mount-and-go.
docker run --rm \
  -v "${VOLUME}:/data:ro" \
  -v "${BACKUP_DIR}:/backup" \
  alpine:3.20 \
  tar czf "/backup/${DATE}.tar.gz" -C / data

# Prune anything older than RETENTION_DAYS
find "$BACKUP_DIR" -name '*.tar.gz' -mtime "+${RETENTION_DAYS}" -delete

echo "[$(date -Is)] backup complete: ${BACKUP_DIR}/${DATE}.tar.gz ($(du -h "${BACKUP_DIR}/${DATE}.tar.gz" | cut -f1))"
```

Make it executable and test:

```bash
chmod +x /usr/local/bin/ferdinand-backup.sh
/usr/local/bin/ferdinand-backup.sh   # run once manually to verify
ls -la /var/backups/anki/
```

For an off-VPS copy, layer rclone/rsync on top — that's out of scope here.

## 8. Restore SOP

Stop the service, wipe the volume, restore the tar, bring it back up:

```bash
cd /opt/Ferdinand

# 1) Take the service down. -v also wipes Caddy's volumes; if you only
# want to restore Anki state, do `docker compose stop ferdinand` instead.
docker compose stop ferdinand

# 2) Recreate the named volume empty. (Skip this if the volume already
# exists and you just want to overwrite its contents.)
docker volume rm ferdinand_anki_data || true
docker volume create ferdinand_anki_data

# 3) Restore the tar into the volume. Mount the volume at /data and
# extract the tarball's `data/` prefix into /.
docker run --rm \
  -v ferdinand_anki_data:/data \
  -v /var/backups/anki:/backup:ro \
  alpine:3.20 \
  sh -c 'cd / && tar xzf /backup/2026-XX-XX.tar.gz'

# 4) Bring ferdinand back up. (No --build needed unless code changed.)
docker compose up -d ferdinand

# 5) Verify
docker compose logs -f ferdinand
curl -fsS https://$DOMAIN/api/health
```

## 9. Update SOP

```bash
cd /opt/Ferdinand
git fetch origin
git checkout <new-tag-or-sha>
docker compose build --pull        # rebuild with latest base images
docker compose up -d                # rolling-recreate any changed services
docker compose logs -f
```

If only the SvelteKit mockup changed, you still need a full image rebuild
because the SPA is embedded into the Rust binary at compile time.

## 10. Operational notes

- **Image size**: target < 200 MB final stage. Verify with
  `docker image ls ferdinand:local`. The biggest contributor is the
  embedded mockup directory (varies with the SvelteKit build).
- **Logs**: `docker compose logs -f --tail=200 ferdinand` and
  `... caddy`. Caddy uses structured JSON; `jq` is your friend.
- **Cert renewal**: Caddy auto-renews about 30 days before expiry. No
  cron entry needed. Watch the caddy logs for renewal events.
- **Rate-limited login**: anki_server scopes login attempts per source
  IP. Caddy passes `X-Real-IP` upstream so the limiter sees the actual
  client, not the Caddy container's bridge IP.
- **No `--build` after `.env` edits**: env changes take effect on
  `docker compose up -d` (recreates the container with new env).

## 11. Verification checklist

After a fresh deploy:

- [ ] `docker compose ps` shows both services `Up (healthy)`
- [ ] `curl -fsS https://$DOMAIN/api/health` → 200 with JSON
- [ ] Browser load shows basic_auth dialog (Caddy gate)
- [ ] After basic_auth, the SvelteKit login page loads over HTTPS
- [ ] Login with seed user (or register) succeeds
- [ ] `docker compose logs caddy` contains `certificate obtained successfully`
- [ ] `/etc/cron.d/ferdinand-backup` exists and `ferdinand-backup.sh` is `+x`
- [ ] First backup tarball exists in `/var/backups/anki/`
