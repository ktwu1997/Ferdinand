# Ferdinand

> Personal Anki fork — Rust axum backend + SvelteKit web + (planned) native iOS.
> Drops PyQt, drops add-ons, drops upstream sync compatibility.

Ferdinand is a single-user reimagining of [Anki](https://apps.ankiweb.net/)
optimised for one person's daily review loop. The Rust core (`rslib/`)
and the FSRS scheduler are kept; everything else is being rewritten on a
modern web/native stack.

## Status

- **Web daily driver**: shipped (M1 closed 2026-04-28)
- **iOS native**: planned (M2–M3)
- **Sync**: design pending (M4)
- **Distribution**: M5 in progress (Phase 30 — this quad)

See [docs/ROADMAP.md](docs/ROADMAP.md) for the milestone plan.

## Quick start (5-min, choose one)

All three paths assume you have already cloned the repo:

```bash
git clone https://github.com/ktwu/Ferdinand.git
cd Ferdinand
```

### macOS (recommended)

Single-binary release + launchd auto-start. Default install location is
`~/Library/Application Support/Ferdinand/`.

```bash
# 1. Build release binary (Rust 1.92+, Node 20+ required)
bash build/release.sh

# 2. Install launchd job (auto-start on login)
bash launchd/install.sh

# 3. Smoke
curl http://127.0.0.1:40001/api/health
open http://127.0.0.1:40001/
```

To stop / uninstall: `bash launchd/uninstall.sh`.

### Docker (any platform)

```bash
docker compose up -d
curl http://127.0.0.1:40001/api/health
```

Per-user collections live under `./data/users/<username>/collection.anki2`
(mounted as a volume). Phase A1 hardcodes the active user to `ktwu`; auth
arrives in Phase A2.

### Dev mode (hacking)

For active development with hot-reload mockup and a debug-build server:

```bash
# Terminal 1 — backend (defaults to ./data/users)
cargo run --bin anki_server -- --users-dir ./data/users

# Terminal 2 — web frontend
cd mockup && npm install && npm run dev
```

Backend listens on `40001`, mockup dev server on `5174`.

### One-shot bootstrap

For a fresh machine, [`scripts/bootstrap.sh`](scripts/bootstrap.sh)
detects platform + toolchain and runs the right install path
interactively:

```bash
bash scripts/bootstrap.sh
# or non-interactive:
INSTALL_METHOD=launchd bash scripts/bootstrap.sh
```

## What's different from upstream Anki

- **No PyQt desktop client.** All UI is web (SvelteKit) with a planned
  native iOS app. The `aqt/` and `qt/` directories are vestigial.
- **No add-ons.** The plugin surface is intentionally removed.
- **No upstream AnkiWeb sync.** A custom self-hosted sync is planned for
  M4; cards do not round-trip with AnkiWeb.
- **Single-user assumptions baked in.** No multi-profile, no shared
  collection workflows.
- **Rust axum backend** (`anki_server/`) replaces the Python `aqt`
  process; `pylib/` is no longer the integration boundary.
- **Build system simplified.** The release path is a single shell script
  (`build/release.sh`) producing one binary; the upstream `./check` /
  `./ninja` flow still works for development.

## Documentation

- [docs/SETUP.md](docs/SETUP.md) — full install + first-run guide
- [docs/ROADMAP.md](docs/ROADMAP.md) — milestone plan
- [docs/architecture.md](docs/architecture.md) — upstream architecture (still mostly accurate for `rslib/`)
- [CLAUDE.md](CLAUDE.md) — Claude Code project conventions

## License

Inherited from upstream Anki: GNU AGPL v3 or later, with BSD-3
contributions noted in [CONTRIBUTORS](CONTRIBUTORS). See
[LICENSE](LICENSE).

---

## Upstream Anki Documentation

The original upstream README content is preserved below for contributors
working on the shared `rslib/` core.

# Anki

[![Build Status](https://github.com/ankitects/anki/actions/workflows/ci.yml/badge.svg)](https://github.com/ankitects/anki/actions/workflows/ci.yml)
[![Documentation](https://img.shields.io/badge/docs-dev--docs.ankiweb.net-blue)](https://dev-docs.ankiweb.net)

This repo contains the source code for the computer version of
[Anki](https://apps.ankiweb.net).

# About

Anki is a spaced repetition program. Please see the [website](https://apps.ankiweb.net) to learn more.

This repo contains the source code for the computer version of
[Anki](https://apps.ankiweb.net).

## Getting Started

### Contributing

Want to contribute to Anki? Check out the [Contribution Guidelines](./docs/contributing.md).

For more information on building and developing, please see [Development](./docs/development.md).

#### Contributors

The following people have contributed to Anki: [CONTRIBUTORS](./CONTRIBUTORS)

### Anki Betas

If you'd like to try development builds of Anki but don't feel comfortable
building the code, please see [Anki betas](https://betas.ankiweb.net/).

## License

Anki's license: [LICENSE](./LICENSE)
