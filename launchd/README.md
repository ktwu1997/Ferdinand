# Ferdinand launchd agent (macOS)

Auto-starts `anki_server` at login and restarts it if it crashes.

## What this does

Installs a [LaunchAgent](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
named `com.ktwu.ferdinand` that runs `~/.local/bin/anki_server` with
`ANKI_COLLECTION` pointing at `~/Library/Application Support/Ferdinand/collection.anki2`.

The shipped plist uses `__HOME__` as a placeholder; `install.sh` substitutes
the real `$HOME` and drops the result into `~/Library/LaunchAgents/`.

## Install

```sh
# 1. Build the single-binary release (Phase 30-A) and copy to ~/.local/bin/
cp target/release/anki_server ~/.local/bin/anki_server

# 2. Load the launchd agent
bash launchd/install.sh
```

Required on the host: macOS, `~/.local/bin` on `$PATH`, and the binary at
`~/.local/bin/anki_server`. The script will fail fast if the binary is missing.

## Uninstall

```sh
bash launchd/uninstall.sh
```

Logs and the collection data dir under `~/Library` are intentionally left in
place. Delete them by hand if you want a clean slate.

## Where things go

- Plist (installed): `~/Library/LaunchAgents/com.ktwu.ferdinand.plist`
- Logs: `~/Library/Logs/Ferdinand/anki_server.{out,err}.log`
- Data: `~/Library/Application Support/Ferdinand/collection.anki2`
- Port: `40001` (override with `ANKI_SERVER_PORT`)

## Check it's running

```sh
launchctl list | grep com.ktwu.ferdinand
curl -sf http://127.0.0.1:40001/healthz && echo OK
tail -f ~/Library/Logs/Ferdinand/anki_server.err.log
```

## Troubleshooting

- **`anki_server binary not found`**: build Phase 30-A and copy the binary to
  `~/.local/bin/anki_server`. Make sure it has execute permission.
- **Agent loads but the process keeps dying**: tail the `.err.log`. Common
  culprits are a missing collection file, a busy port, or a wrong
  `ANKI_COLLECTION` path. Edit the plist (or re-run `install.sh` after
  fixing the source) and reload.
- **Port conflict**: another process is already on `40001`. Free the port
  or set `ANKI_SERVER_PORT` in the plist's `EnvironmentVariables` block and
  reload.
- **"Operation not permitted" on load**: run `launchctl unload -w
  ~/Library/LaunchAgents/com.ktwu.ferdinand.plist` first, then re-run
  `install.sh`.
- **Reapply after edits**: re-running `install.sh` regenerates the installed
  plist from source and reloads the agent — safe to run repeatedly.
