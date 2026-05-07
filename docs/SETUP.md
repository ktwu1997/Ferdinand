# Ferdinand — Setup Guide

Comprehensive install + first-run guide. The goal: clean machine to
running daily driver in under an hour.

If you just want the 5-minute version, see the [Quick start in
README.md](../README.md#quick-start-5-min-choose-one).

---

## 1. Prerequisites

| Tool        | Version       | Why                                         |
| ----------- | ------------- | ------------------------------------------- |
| Rust        | 1.92 or newer | Builds the `anki_server` binary + `rslib`   |
| Node.js     | 20 LTS+       | Builds the SvelteKit web frontend (`mockup/`)|
| pnpm or npm | latest        | Node package manager (npm ships with Node)  |
| Git         | any           | Clone the repo                              |
| Docker      | 24+ (optional)| Only needed for the Docker install path     |

Install Rust via [rustup](https://rustup.rs/):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Install Node 20 via [nvm](https://github.com/nvm-sh/nvm) or your
platform's package manager (Homebrew, apt, etc.):

```bash
# macOS (Homebrew)
brew install node@20

# Debian / Ubuntu
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify:

```bash
rustc --version   # rustc 1.92.x or newer
node --version    # v20.x or newer
```

---

## 2. Clone and build

```bash
git clone https://github.com/ktwu/Ferdinand.git
cd Ferdinand

# One-shot: detect platform + run the right install
bash scripts/bootstrap.sh
```

`scripts/bootstrap.sh` will:

1. Verify Rust + Node are installed (and Docker, if you pick that path).
2. Run `bash build/release.sh` to produce `target/release-lto/anki_server`.
3. Prompt you to choose an install path (launchd / docker / dev / none).
4. Run the corresponding install script.

To skip the prompt, set `INSTALL_METHOD` first:

```bash
INSTALL_METHOD=launchd bash scripts/bootstrap.sh   # macOS auto-start
INSTALL_METHOD=docker  bash scripts/bootstrap.sh   # docker compose
INSTALL_METHOD=dev     bash scripts/bootstrap.sh   # build only, run manually
INSTALL_METHOD=none    bash scripts/bootstrap.sh   # alias of dev
```

If you'd rather run the build by hand:

```bash
bash build/release.sh
# Output: target/release-lto/anki_server (or target/release/anki_server)
```

---

## 3. Provide a collection

Ferdinand reads the standard Anki SQLite file (`collection.anki2`).
Phase A1 stores it under a per-user directory:
`<users_dir>/<username>/collection.anki2` (with the matching
`collection.media/` sibling). Phase A1 hardcodes the active username to
`ktwu`; auth + per-request user resolution arrive in Phase A2.

You have two options:

### Option A — Bring your existing collection

Copy your existing `collection.anki2` from upstream Anki:

- macOS: `~/Library/Application Support/Anki2/<profile>/collection.anki2`
- Linux: `~/.local/share/Anki2/<profile>/collection.anki2`
- Windows: `%APPDATA%\Anki2\<profile>\collection.anki2`

Place it where Ferdinand expects it:

| Install path | Expected location                                                       |
| ------------ | ----------------------------------------------------------------------- |
| launchd      | `~/Library/Application Support/Ferdinand/users/ktwu/collection.anki2`   |
| docker       | `./data/users/ktwu/collection.anki2` (relative to the repo root)        |
| dev          | `<users_dir>/ktwu/collection.anki2` (point `--users-dir` at the parent) |

### Option B — Start fresh

Launch upstream Anki once, create a profile, then copy the empty
`collection.anki2` into Ferdinand's expected path. There is no built-in
"create empty collection" command yet.

---

## 4. Choose an install method

### 4a. macOS launchd (recommended for daily-driver use)

```bash
bash launchd/install.sh
```

This:

- Copies `target/release-lto/anki_server` to
  `/usr/local/bin/ferdinand-server` (or under `~/.local/bin` if it can't
  write to `/usr/local/bin`).
- Installs `launchd/com.ktwu.ferdinand.plist` to
  `~/Library/LaunchAgents/`.
- Loads the job via `launchctl bootstrap gui/$UID`.

After install:

- Server URL: <http://127.0.0.1:40001/>
- Logs: `~/Library/Logs/Ferdinand/server.{out,err}.log`
- Users dir: `~/Library/Application Support/Ferdinand/users/` (collection at `users/ktwu/collection.anki2`)

To stop / uninstall:

```bash
bash launchd/uninstall.sh
```

### 4b. Docker (any platform)

```bash
docker compose up -d
```

This:

- Builds the image (or pulls if pre-built).
- Mounts `./data/` into the container so your collection survives.
- Exposes port `40001` on the host.

(`docker-compose up -d` — the legacy hyphenated form — also works on
older installs.)

To stop:

```bash
docker compose down
```

To upgrade after a `git pull`:

```bash
docker compose build --no-cache && docker compose up -d
```

### 4c. Dev mode

For development. Two terminals:

```bash
# Terminal 1 — backend (defaults to ./data/users)
cargo run --bin anki_server -- --users-dir ~/path/to/users-dir

# Terminal 2 — frontend with hot reload
cd mockup
npm install
npm run dev
```

The dev mockup server proxies `/api/*` to the backend on `40001`. Open
<http://127.0.0.1:5174/>.

---

## 5. First-run smoke test

Regardless of install path:

```bash
# Health endpoint should return 200 with a JSON body
curl -i http://127.0.0.1:40001/api/health

# Open the web UI
open http://127.0.0.1:40001/   # macOS
xdg-open http://127.0.0.1:40001/   # Linux
```

You should see your decks load and a review session ready to start.

---

## 6. Daily ops

### Where things live

| Concern        | macOS launchd                                                  | Docker                              | Dev                |
| -------------- | -------------------------------------------------------------- | ----------------------------------- | ------------------ |
| Binary         | `/usr/local/bin/ferdinand-server`                              | inside container                    | `cargo run` output |
| Users dir      | `~/Library/Application Support/Ferdinand/users/`               | `./data/users/`                     | `--users-dir` arg  |
| Collection     | `…/Ferdinand/users/ktwu/collection.anki2`                      | `./data/users/ktwu/collection.anki2` | inside users-dir   |
| Logs           | `~/Library/Logs/Ferdinand/server.{out,err}.log`                | `docker compose logs -f server`     | stdout             |
| Service config | `~/Library/LaunchAgents/com.ktwu.ferdinand.plist`              | `docker-compose.yml`                | n/a                |

### Restart

```bash
# launchd
launchctl kickstart -k "gui/$UID/com.ktwu.ferdinand"

# docker
docker compose restart

# dev — Ctrl-C and re-run
```

### Upgrade

```bash
git pull

# launchd
bash build/release.sh && bash launchd/install.sh

# docker
docker compose build --no-cache && docker compose up -d

# dev
# just restart your cargo run / npm run dev
```

---

## 7. Troubleshooting

### Port 40001 already in use

```bash
lsof -i :40001
# Kill the offender, or pass --port to anki_server in dev mode.
```

For launchd, edit the `<key>ProgramArguments</key>` block in
`~/Library/LaunchAgents/com.ktwu.ferdinand.plist` and re-load:

```bash
launchctl bootout "gui/$UID/com.ktwu.ferdinand" || true
launchctl bootstrap "gui/$UID" ~/Library/LaunchAgents/com.ktwu.ferdinand.plist
```

### "collection not found"

Confirm the file exists at the path the install method expects (see
table in section 6). For launchd, the plist sets `ANKI_USERS_DIR=
~/Library/Application Support/Ferdinand/users` and the server opens
`<that>/ktwu/collection.anki2` — create the per-user directory if
missing:

```bash
mkdir -p ~/Library/Application\ Support/Ferdinand/users/ktwu
cp /path/to/your/collection.anki2 ~/Library/Application\ Support/Ferdinand/users/ktwu/
```

### Build failures

```bash
# Rust toolchain too old?
rustup update
rustc --version    # need 1.92+

# Node too old?
node --version     # need 20+

# Stale build artifacts
cargo clean
rm -rf mockup/node_modules mockup/.svelte-kit
bash build/release.sh
```

If `cargo` complains about missing system libs (libssl, pkg-config), see
the upstream [docs/linux.md](linux.md) / [docs/mac.md](mac.md) for
platform setup.

### launchd: job loaded but server not listening

```bash
# Check status
launchctl print "gui/$UID/com.ktwu.ferdinand" | head -40

# Check logs
tail -f ~/Library/Logs/Ferdinand/server.err.log
```

Common causes: collection file missing, port conflict, binary path
in plist points at a stale location after a re-build.

### Docker: container restarts in a loop

```bash
docker compose logs --tail 100 server
```

Most often: `./data/users/ktwu/collection.anki2` doesn't exist. Place a
collection file there (`mkdir -p data/users/ktwu && cp /path/to/your/
collection.anki2 data/users/ktwu/`) and `docker compose restart`.

### Web UI loads but reviews fail

Open the browser DevTools → Network tab. If `/api/*` requests return
404 or HTML, the static asset bundle is stale relative to the running
backend. Rebuild:

```bash
bash build/release.sh
# Then restart your install method (see section 6 → Restart).
```

---

## 8. Uninstall

```bash
# launchd
bash launchd/uninstall.sh
rm -rf ~/Library/Application\ Support/Ferdinand   # purges collection — be careful

# docker
docker compose down -v   # -v also drops the data volume

# dev
# nothing to uninstall — just delete the cloned repo
```

---

## See also

- [README.md](../README.md) — project overview
- [docs/ROADMAP.md](ROADMAP.md) — milestone plan
- [docs/architecture.md](architecture.md) — upstream architecture (still applies to `rslib/`)
