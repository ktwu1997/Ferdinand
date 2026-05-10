# Ferdinand — deploy SOP

Single-tenant single-VPS deployment of the Ferdinand fork. Two supported
paths:

| Path | Edge / TLS | Image build | Use when |
|------|------------|-------------|----------|
| **Zeabur-native** *(default, recommended)* | Zeabur platform gateway terminates TLS, manages LE cert, routes domain → container EXPOSE 40001 | Zeabur builds from `Dockerfile` automatically | Hosting on Zeabur (or any PaaS that owns 0.0.0.0:80/443) |
| **Self-Host on Raw VPS** *(fallback)* | Caddy 2 + own LE cert + HTTP basic_auth gate, all in compose | `docker compose -f docker-compose.raw-vps.yml build` | Hosting on a vanilla VPS where YOU own ports 80/443 |

The two paths share the **same Dockerfile and codebase**, but differ in
which compose file is consumed and whether Caddy / basic_auth / `DOMAIN`
env vars apply.

| Concern | Zeabur path | Raw-VPS path |
|---------|-------------|--------------|
| Compose file | `docker-compose.yml` | `docker-compose.raw-vps.yml` |
| Owns 0.0.0.0:80/443 | Zeabur platform gateway | the Caddy container in this compose |
| TLS / LE cert | Zeabur (auto) | Caddy (auto via ACME HTTP-01) |
| basic_auth gate | none | Caddy `basic_auth` directive |
| Env var source | Zeabur dashboard | local `.env` + `init-env.sh` |
| Backup cron | manual / out-of-scope | `deploy/scripts/backup.sh` |
| Update flow | git push → auto rebuild | `git pull && docker compose ... up -d --build` |

Repo artifacts:

| Path                          | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `Dockerfile`                  | Multi-stage build: SvelteKit → Rust → slim Debian        |
| `docker-compose.yml`          | **Zeabur path**: ferdinand only, no caddy, no host ports |
| `docker-compose.raw-vps.yml`  | **Raw-VPS path**: ferdinand + caddy + 80/443 binding     |
| `Caddyfile`                   | Raw-VPS only: TLS + basic_auth + reverse_proxy → :40001  |
| `.dockerignore`               | Trims build context (no target/, node_modules/, etc)     |
| `.env.example`                | Documents every env var; Zeabur block + raw-VPS block    |
| `deploy/scripts/`             | **Raw-VPS only**: bootstrap / init-env / backup / restore / verify |
| `deploy/README.md`            | This file                                                |

## Zeabur Quick Start (recommended)

Zeabur builds from this repo's `Dockerfile` directly. The default
`docker-compose.yml` declares the single `ferdinand` service that the
platform gateway routes traffic into.

### 1. Connect the repo

In the [Zeabur dashboard](https://zeabur.com/), create a project and add a
new service:

- Source: this Git repo (your fork)
- Build: Zeabur auto-detects the `Dockerfile` at the repo root
- (No `zbpack.json` is needed — the repo intentionally omits it; auto-
  detection covers the Dockerfile, and Zeabur's port/volume/env config is
  managed dashboard-side rather than via repo file.)

### 2. Set environment variables (dashboard)

Open the service's "Environment Variables" panel and set:

| Var | Required? | How to generate |
|-----|-----------|-----------------|
| `FERDINAND_SESSION_KEY` | yes | `openssl rand -base64 64 \| tr -d '\n'` |
| `ANKI_ADMIN_USERNAME` | optional | the username allowed to hit `/api/admin/*`; leave empty to disable admin |
| `ANKI_IMPORT_MAX_BYTES` | optional | apkg upload size cap in bytes (default ~100 MiB) |
| `FERDINAND_SEED_USER` | optional | first-run seed user (idempotent — skipped if user exists) |
| `FERDINAND_SEED_PASSWORD` | optional | seed user's plaintext password |
| `RUST_LOG` | optional | log filter (default `info,anki_server=debug`) |

`DOMAIN`, `ACME_EMAIL`, `BASIC_AUTH_USER`, `BASIC_AUTH_HASH` are **not used**
on Zeabur — leave them unset. They only apply to the raw-VPS compose file.

### 3. Provision a persistent volume

In the service's "Volumes" panel, mount a volume at `/data`. The container
writes the Anki collection (`/data/users/<username>/collection.anki2`),
its media (`/data/users/<username>/collection.media/`), and the auth DB
(`/data/auth.db`) under that path. **Without a volume the data resets on
every redeploy.**

### 4. Bind the public domain

In the service's "Networking" / "Domains" panel:

- Use a generated `*.zeabur.app` subdomain for a quick preview, **or**
- Add a custom domain (the project uses e.g. `ferdy-app.duckdns.org`) and
  follow the dashboard's CNAME instructions; Zeabur provisions the LE
  cert automatically.
- Confirm the domain forwards to the container's port `40001` (the
  `EXPOSE 40001` in the Dockerfile is what the gateway discovers).

### 5. Trigger the deploy

Push to the connected branch (or hit "Redeploy" in the dashboard). Watch
the build log; once the container is healthy, browse `https://<your-domain>/`
and log in with the seed user (or `/api/auth/register` if no seed).

Health check (no auth needed):

```bash
curl -fsS https://<your-domain>/api/health
# → {"status":"ok",...}
```

### 6. Run the live smoke tests

See `mockup/tests/e2e/README-live-smoke.md` for the Zeabur-path command
(no `BASIC_AUTH_*` env needed):

```bash
BASE_URL=https://<your-domain> \
  FERDINAND_USER1=... FERDINAND_PASS1=... \
  FERDINAND_USER2=... FERDINAND_PASS2=... \
  node mockup/tests/e2e/a13_live_multiuser_smoke.mjs
```

### Backups on Zeabur

Out of scope for this README — the persistent volume is managed by the
platform. For a belt-and-braces snapshot, either:

- Use Zeabur's volume snapshot mechanism (consult current Zeabur docs).
- Periodically `docker exec` into the running container and tar `/data`
  out via `kubectl cp` / Zeabur's CLI; or
- Switch to the raw-VPS path on a separate box and replicate.

The `deploy/scripts/backup.sh` cron flow documented below is **raw-VPS-only**.

---

## Self-Hosting on a Raw VPS (fallback path)

Use this path when you control the VPS yourself — i.e. you own
0.0.0.0:80/443 and want to run Caddy + basic_auth + your own LE cert flow.
This is the older path; it remains supported and the scripts under
`deploy/scripts/` only exist for it.

Target shape:

- Linode 1 GB or larger, Ubuntu 24.04 LTS, public IPv4
- One DNS A record pointing your domain at the VPS
- Docker + docker-compose-plugin installed
- Two containers: `ferdinand` (Rust API + embedded SvelteKit SPA) and
  `ferdinand-caddy` (TLS termination + HTTP basic_auth + reverse proxy)
- Two named volumes: `ferdinand_anki_data` (collection + auth.db),
  `ferdinand_caddy_data` (Let's Encrypt certs)
- Daily cron tar of the collection + media to `/var/backups/anki/`,
  14-day retention

### Raw-VPS Quick Start (one-shot)

For a fresh Ubuntu 22.04/24.04 VPS with DNS already pointed at the box:

```bash
# 1. Bootstrap fresh VPS (run as root). Installs apt deps, ufw rules,
#    Docker CE + compose plugin, the `ferdinand` system user, and clones
#    the repo into /opt/ferdinand. Idempotent — safe to re-run.
bash <(curl -sSL https://raw.githubusercontent.com/ktwu1997/Ferdinand/main/deploy/scripts/bootstrap-vps.sh)

# 2. Configure environment. Interactive: prompts for domain, basic_auth
#    user/pass, admin username, import cap. Auto-generates the session key
#    and bcrypts the basic_auth password. Writes /opt/ferdinand/.env (chmod
#    600). Existing .env is backed up to .env.bak.<timestamp> first.
cd /opt/ferdinand && bash deploy/scripts/init-env.sh

# 3. Start the stack and run health checks (TLS reachable, services Up,
#    cert issued).
docker compose -f docker-compose.raw-vps.yml up -d \
  && bash deploy/scripts/verify.sh
```

For the daily backup cron, see `deploy/scripts/backup.sh`. To restore from a
tarball, see `deploy/scripts/restore.sh <archive>`.

If anything in the one-shot path fails, fall back to the **Manual SOP**
section below for the same steps broken out command-by-command.

### Raw-VPS Manual SOP

The remainder of this section is the manual, fully-explained step list.
Use it when:

- Debugging a Quick-Start failure
- Customizing the install (non-default repo path, alternate user, etc.)
- Reading what the scripts under `deploy/scripts/` actually do

### Static-asset serving choice

The `anki_server` binary, when built with `--features embed-mockup` (which
the Dockerfile turns on), embeds the SvelteKit `mockup/build/` output via
`include_dir!()` and serves it from a `fallback` route after the `/api/*`
router. Hard-refresh of any client-side route falls back to `index.html`.

This means **the edge (Caddy on raw-VPS, Zeabur gateway on Zeabur) is a
pure reverse proxy** — it does not serve static files itself. Pros: one
binary, one cert path, no ambiguity about which process owns the SPA.
Cons: an SPA-only patch still requires a full image rebuild. Acceptable
for the friend self-host route where deploys are rare and image size
stays modest.

The alternative (Caddy `file_server` for SPA, `reverse_proxy` only for
`/api/*`) would split serving across two processes and require a shared
volume for the build output. Rejected for this phase.

### 1. VPS bootstrap (Ubuntu 24.04)

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

### 2. DNS

Point an A record at `$VPS_IP`:

```text
anki.example.com.   A   $VPS_IP   TTL 300
```

Wait until `dig +short anki.example.com` returns `$VPS_IP` from a public
resolver before bringing Caddy up. If DNS isn't ready, Let's Encrypt's
HTTP-01 challenge will fail and you'll burn rate-limit attempts.

### 3. Clone the repo

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/<your-fork>/Ferdinand.git
cd Ferdinand
```

### 4. Generate secrets

#### 4a. Caddy basic_auth bcrypt hash

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'CHANGE-ME-LONG-PASSWORD'
# → $2a$14$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Copy the full `$2a$14$...` string. **Quote it** when you paste into `.env`
because `$` triggers shell expansion and bcrypt hashes contain `$`.

#### 4b. Anki session cookie key

```bash
openssl rand -base64 64
```

This produces a 64-byte key in 88 base64 characters (one line). It signs
the `ferdinand_session` cookie. Losing it logs every user out on next
restart — back it up alongside the volume tar.

#### 4c. (Optional) Initial seed user

If you want a user provisioned on first boot, set `FERDINAND_SEED_USER` and
`FERDINAND_SEED_PASSWORD`. The seed runs once (idempotent — skipped if the
user already exists). You can omit both and use `/api/auth/register` later.

### 5. `.env` template

Create `.env` next to `docker-compose.raw-vps.yml`. **Never commit this
file.** The repo's root `.dockerignore` already excludes `.env`.

```bash
cat > .env <<'EOF'
# --- Caddy / TLS (raw-VPS only) ---
DOMAIN=anki.example.com
ACME_EMAIL=you@example.com

# --- HTTP basic_auth (raw-VPS only — soft browser-level gate in front of the app) ---
BASIC_AUTH_USER=friend
# IMPORTANT: single-quote this so $-chars in the bcrypt hash are not
# interpreted by docker compose / your shell.
BASIC_AUTH_HASH='$2a$14$REPLACE_ME_WITH_OUTPUT_FROM_caddy_hash-password'

# --- anki_server (both paths) ---
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

### 6. Bring it up (raw-VPS)

```bash
docker compose -f docker-compose.raw-vps.yml up -d --build
docker compose -f docker-compose.raw-vps.yml logs -f
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

### 7. Daily backup cron (raw-VPS)

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

### 8. Restore SOP (raw-VPS)

Stop the service, wipe the volume, restore the tar, bring it back up:

```bash
cd /opt/Ferdinand

# 1) Take the service down. -v also wipes Caddy's volumes; if you only
# want to restore Anki state, do `docker compose -f docker-compose.raw-vps.yml stop ferdinand` instead.
docker compose -f docker-compose.raw-vps.yml stop ferdinand

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
docker compose -f docker-compose.raw-vps.yml up -d ferdinand

# 5) Verify
docker compose -f docker-compose.raw-vps.yml logs -f ferdinand
curl -fsS https://$DOMAIN/api/health
```

### 9. Update SOP (raw-VPS)

```bash
cd /opt/Ferdinand
git fetch origin
git checkout <new-tag-or-sha>
docker compose -f docker-compose.raw-vps.yml build --pull
docker compose -f docker-compose.raw-vps.yml up -d
docker compose -f docker-compose.raw-vps.yml logs -f
```

If only the SvelteKit mockup changed, you still need a full image rebuild
because the SPA is embedded into the Rust binary at compile time.

### 10. Operational notes (raw-VPS)

- **Image size**: target < 200 MB final stage. Verify with
  `docker image ls ferdinand:local`. The biggest contributor is the
  embedded mockup directory (varies with the SvelteKit build).
- **Logs**: `docker compose -f docker-compose.raw-vps.yml logs -f --tail=200 ferdinand`
  and `... caddy`. Caddy uses structured JSON; `jq` is your friend.
- **Cert renewal**: Caddy auto-renews about 30 days before expiry. No
  cron entry needed. Watch the caddy logs for renewal events.
- **Rate-limited login**: anki_server scopes login attempts per source
  IP. Caddy passes `X-Real-IP` upstream so the limiter sees the actual
  client, not the Caddy container's bridge IP.
- **No `--build` after `.env` edits**: env changes take effect on
  `docker compose -f docker-compose.raw-vps.yml up -d` (recreates the
  container with new env).

### 11. Verification checklist (raw-VPS)

After a fresh deploy:

- [ ] `docker compose -f docker-compose.raw-vps.yml ps` shows both services `Up (healthy)`
- [ ] `curl -fsS https://$DOMAIN/api/health` → 200 with JSON
- [ ] Browser load shows basic_auth dialog (Caddy gate)
- [ ] After basic_auth, the SvelteKit login page loads over HTTPS
- [ ] Login with seed user (or register) succeeds
- [ ] `docker compose -f docker-compose.raw-vps.yml logs caddy` contains `certificate obtained successfully`
- [ ] `/etc/cron.d/ferdinand-backup` exists and `ferdinand-backup.sh` is `+x`
- [ ] First backup tarball exists in `/var/backups/anki/`
