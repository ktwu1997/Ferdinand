# Live Deployment Smoke Tests (a13 + a14)

Pre-written Playwright smokes that run against the **deployed VPS** instance
(behind Caddy basic_auth + TLS), not localhost. Companion to the rest of the
`mockup/tests/e2e/a*.mjs` suite, which targets `127.0.0.1:40001`.

| File | What it covers | Browser |
|------|----------------|---------|
| `a13_live_multiuser_smoke.mjs` | 2 parallel users (USER1 + USER2): login, /study Again, /browse search, /notes/new import-toggle, cookie isolation, mutual logout | Chromium (desktop 1280x900) |
| `a14_live_iphone_safari_smoke.mjs` | Mobile dashboard, touch tap on Again, IME chip on /browse, cookie persistence across reload | WebKit (iPhone 13 emulation) |

## When to run

- **Once per deploy**, against a freshly-deployed VPS, after Caddy has acquired
  its TLS cert and `docker compose ps` shows `caddy` and `anki_server` healthy.
- **Not** in normal CI against localhost — those tests live alongside (a1–a12)
  and run against `E2E_BASE=http://127.0.0.1:40001` instead.

## Required env vars

| Var | Description | Sensitivity |
|-----|-------------|-------------|
| `BASE_URL` | Full HTTPS origin of the deployed instance, e.g. `https://anki.example.com` | low (domain) |
| `BASIC_AUTH_USER` | Caddy basic_auth username | medium (gateway cred) |
| `BASIC_AUTH_PASS` | Caddy basic_auth password | **high** — never log/commit |
| `FERDINAND_USER1` | App login username for primary user | low |
| `FERDINAND_PASS1` | App login password for primary user | **high** — never log/commit |
| `FERDINAND_USER2` | App login username for second user (a13 only) | low |
| `FERDINAND_PASS2` | App login password for second user (a13 only) | **high** — never log/commit |

a14 only needs `BASE_URL` + `BASIC_AUTH_*` + `FERDINAND_USER1`/`FERDINAND_PASS1`.

## Run command

Run both (one-shot, env-prefixed):

```bash
BASE_URL=https://yourdomain.example.com \
  BASIC_AUTH_USER=... BASIC_AUTH_PASS=... \
  FERDINAND_USER1=... FERDINAND_PASS1=... \
  FERDINAND_USER2=... FERDINAND_PASS2=... \
  node mockup/tests/e2e/a13_live_multiuser_smoke.mjs && \
BASE_URL=https://yourdomain.example.com \
  BASIC_AUTH_USER=... BASIC_AUTH_PASS=... \
  FERDINAND_USER1=... FERDINAND_PASS1=... \
  node mockup/tests/e2e/a14_live_iphone_safari_smoke.mjs
```

Or source a `.env.live` (gitignored) to keep the creds out of shell history:

```bash
set -a; source .env.live; set +a
node mockup/tests/e2e/a13_live_multiuser_smoke.mjs
node mockup/tests/e2e/a14_live_iphone_safari_smoke.mjs
```

`.env.live` is **never** to be committed; verify with `git check-ignore -v .env.live`
before sourcing it on a shared box.

## Expected runtime

- a13: ~30–60s (browser launch + 2 contexts + parallel /study, /browse, /notes/new)
- a14: ~20–40s (WebKit launch + mobile /, /study, /browse, reload)
- Combined: ~60–90s end-to-end against a healthy deployment.

## Skip conditions

If **any** required env var is missing or empty, the script prints
`SKIP: a1X_live_..._smoke — live smoke requires deployed VPS env. Missing: …`
and exits **0**. This is the safe default when the file is invoked by mistake
on a dev box without live creds. The skip message lists every missing var so
the operator knows exactly what to set.

There is no partial-skip: a13 skips the whole file if any of its 7 vars is
absent; a14 skips the whole file if any of its 5 vars is absent.

## Artifacts

Each run writes to `mockup/tests/e2e/artifacts/a13_live_multiuser_smoke/` and
`.../a14_live_iphone_safari_smoke/`:

- `result.json` — full check log (passed/failed per case + console errors)
- `*.png` — per-case screenshots for triage

These directories are git-ignored at the repo level (under `mockup/tests/e2e/artifacts/`).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 Unauthorized` on every request | `BASIC_AUTH_USER`/`PASS` mismatch with Caddyfile hash | Re-derive the bcrypt hash with `caddy hash-password` and confirm Caddyfile has the new hash; restart `docker compose restart caddy`. |
| `net::ERR_CERT_AUTHORITY_INVALID` or TLS handshake failure | Caddy hasn't finished ACME challenge yet | Wait 1–2 min, then `docker compose logs caddy \| grep -E 'obtain\|certificate'`. If still failing, check DNS A record points to VPS IP. |
| `webkit not installed` / launcher missing | Playwright didn't fetch the WebKit browser bundle | `npx playwright install webkit` from the `mockup/` directory. |
| `Cannot read properties of null (reading 'json')` on `/api/decks` | App login succeeded at HTTP layer but session cookie didn't pass through Caddy | Check Caddy reverse-proxy block forwards `Cookie` header; confirm `proxy_set_header` style directive (or absence of header-stripping). |
| CORS errors in the WebKit run | `BASE_URL` scheme/host/port doesn't match what the SPA fetched on first paint | Confirm `BASE_URL` exactly matches the deployed origin — including `https://` and any non-default port. |
| `FERDINAND_USER2` login 401 | Second user not yet provisioned on the deployed instance | Provision via `cargo run -p anki_server -- create-user USER2 PASS2` (or whatever the deploy ops doc specifies) before running a13. |

## Relationship to (a1–a12)

The localhost suite (a1–a12) covers behavior. The live smokes (a13, a14) cover
**deployment integrity**: that Caddy basic_auth + TLS + reverse-proxy + the
embedded mockup build all line up correctly in production. They intentionally
re-cover a small slice of (a3 login, a5 study, a6 browse, a12b import) to
catch deploy-only regressions like header-stripping, cookie domain mismatch,
TLS-only redirect loops, and viewport-specific WebKit failures that don't
reproduce on localhost Chromium.
