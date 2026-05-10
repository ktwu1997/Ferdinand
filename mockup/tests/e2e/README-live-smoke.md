# Live Deployment Smoke Tests (a13 + a14)

Pre-written Playwright smokes that run against a **deployed instance**
(over the public domain), not localhost. Companion to the rest of the
`mockup/tests/e2e/a*.mjs` suite, which targets `127.0.0.1:40001`.

| File | What it covers | Browser |
|------|----------------|---------|
| `a13_live_multiuser_smoke.mjs` | 2 parallel users (USER1 + USER2): login, /study Again, /browse search, /notes/new import-toggle, cookie isolation, mutual logout | Chromium (desktop 1280x900) |
| `a14_live_iphone_safari_smoke.mjs` | Mobile dashboard, touch tap on Again, IME chip on /browse, cookie persistence across reload | WebKit (iPhone 13 emulation) |

Both files support **two deploy paths**:

| Path | Edge layer | basic_auth env required? |
|------|------------|--------------------------|
| **Zeabur** (default) | Zeabur platform gateway terminates TLS; no basic_auth | **No** — leave `BASIC_AUTH_*` unset |
| **Raw VPS** (`docker-compose.raw-vps.yml`) | Caddy + own LE cert + HTTP basic_auth gate | **Yes** — `BASIC_AUTH_USER` + `BASIC_AUTH_PASS` |

The smokes detect which path you're on by whether `BASIC_AUTH_USER` +
`BASIC_AUTH_PASS` are both set. They print `basic_auth gate: ENABLED` or
`basic_auth gate: disabled` at startup so you can confirm.

## When to run

- **Once per deploy**, against a freshly-deployed instance, after the edge
  has acquired its TLS cert and the service is healthy.
- **Not** in normal CI against localhost — those tests live alongside (a1–a12)
  and run against `E2E_BASE=http://127.0.0.1:40001` instead.

## Required env vars

| Var | Description | Sensitivity | Required for |
|-----|-------------|-------------|--------------|
| `BASE_URL` | Full HTTPS origin of the deployed instance, e.g. `https://anki.example.com` | low (domain) | both paths |
| `FERDINAND_USER1` | App login username for primary user | low | both paths |
| `FERDINAND_PASS1` | App login password for primary user | **high** — never log/commit | both paths |
| `FERDINAND_USER2` | App login username for second user (a13 only) | low | both paths (a13) |
| `FERDINAND_PASS2` | App login password for second user (a13 only) | **high** — never log/commit | both paths (a13) |
| `BASIC_AUTH_USER` | Caddy basic_auth username | medium (gateway cred) | **raw-VPS only** |
| `BASIC_AUTH_PASS` | Caddy basic_auth password | **high** — never log/commit | **raw-VPS only** |

a14 only needs `BASE_URL` + `FERDINAND_USER1`/`FERDINAND_PASS1` (+ optional
`BASIC_AUTH_*` if running the raw-VPS path).

## Run command — Zeabur path

No basic_auth gate. Just app credentials:

```bash
# a13 (Chromium, two users)
BASE_URL=https://yourdomain.example.com \
  FERDINAND_USER1=... FERDINAND_PASS1=... \
  FERDINAND_USER2=... FERDINAND_PASS2=... \
  node mockup/tests/e2e/a13_live_multiuser_smoke.mjs

# a14 (WebKit, iPhone 13)
BASE_URL=https://yourdomain.example.com \
  FERDINAND_USER1=... FERDINAND_PASS1=... \
  node mockup/tests/e2e/a14_live_iphone_safari_smoke.mjs
```

Both should log `basic_auth gate: disabled (Zeabur path)` at startup.

## Run command — Raw-VPS path

Includes the Caddy basic_auth credentials:

```bash
# a13
BASE_URL=https://yourdomain.example.com \
  BASIC_AUTH_USER=... BASIC_AUTH_PASS=... \
  FERDINAND_USER1=... FERDINAND_PASS1=... \
  FERDINAND_USER2=... FERDINAND_PASS2=... \
  node mockup/tests/e2e/a13_live_multiuser_smoke.mjs

# a14
BASE_URL=https://yourdomain.example.com \
  BASIC_AUTH_USER=... BASIC_AUTH_PASS=... \
  FERDINAND_USER1=... FERDINAND_PASS1=... \
  node mockup/tests/e2e/a14_live_iphone_safari_smoke.mjs
```

Both should log `basic_auth gate: ENABLED (raw-VPS path)` at startup.

## Sourcing from a `.env.live` file

To keep credentials out of shell history, source a `.env.live` (gitignored):

```bash
set -a; source .env.live; set +a
node mockup/tests/e2e/a13_live_multiuser_smoke.mjs
node mockup/tests/e2e/a14_live_iphone_safari_smoke.mjs
```

`.env.live` is **never** to be committed; verify with
`git check-ignore -v .env.live` before sourcing it on a shared box.

## Expected runtime

- a13: ~30–60s (browser launch + 2 contexts + parallel /study, /browse, /notes/new)
- a14: ~20–40s (WebKit launch + mobile /, /study, /browse, reload)
- Combined: ~60–90s end-to-end against a healthy deployment.

## Skip conditions

If **any** required env var is missing or empty, the script prints
`SKIP: a1X_live_..._smoke — live smoke requires deployed env. Missing: …`
and exits **0**. This is the safe default when the file is invoked by mistake
on a dev box without live creds.

The skip conditions deliberately do **not** include `BASIC_AUTH_*`:

- a13 skips the whole file if any of `BASE_URL` / `FERDINAND_USER1` /
  `FERDINAND_PASS1` / `FERDINAND_USER2` / `FERDINAND_PASS2` is absent.
- a14 skips the whole file if any of `BASE_URL` / `FERDINAND_USER1` /
  `FERDINAND_PASS1` is absent.

`BASIC_AUTH_USER` + `BASIC_AUTH_PASS` are optional and only consumed by the
raw-VPS path; their absence does not skip the test.

## Artifacts

Each run writes to `mockup/tests/e2e/artifacts/a13_live_multiuser_smoke/` and
`.../a14_live_iphone_safari_smoke/`:

- `result.json` — full check log (passed/failed per case + console errors)
- `*.png` — per-case screenshots for triage

These directories are git-ignored at the repo level (under `mockup/tests/e2e/artifacts/`).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 Unauthorized` on every request (raw-VPS path) | `BASIC_AUTH_USER`/`PASS` mismatch with Caddyfile hash | Re-derive the bcrypt hash with `caddy hash-password` and confirm Caddyfile has the new hash; restart `docker compose -f docker-compose.raw-vps.yml restart caddy`. |
| `401 Unauthorized` on Zeabur path | You probably set `BASIC_AUTH_*` by mistake — Zeabur has no basic_auth gate, so the credentials get sent to anki_server itself which doesn't expect them | Unset `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` and re-run. |
| `net::ERR_CERT_AUTHORITY_INVALID` or TLS handshake failure | Edge hasn't finished ACME challenge yet | **Zeabur**: wait for the deploy log to confirm cert issued; **raw-VPS**: `docker compose -f docker-compose.raw-vps.yml logs caddy \| grep -E 'obtain\|certificate'`. If still failing, check DNS A record points to the right IP. |
| `webkit not installed` / launcher missing | Playwright didn't fetch the WebKit browser bundle | `npx playwright install webkit` from the `mockup/` directory. |
| `Cannot read properties of null (reading 'json')` on `/api/decks` | App login succeeded at HTTP layer but session cookie didn't pass through the edge | **Raw-VPS**: check Caddy reverse-proxy block forwards `Cookie` header. **Zeabur**: check the dashboard "Custom Domain" settings forward all paths to the service. |
| CORS errors in the WebKit run | `BASE_URL` scheme/host/port doesn't match what the SPA fetched on first paint | Confirm `BASE_URL` exactly matches the deployed origin — including `https://` and any non-default port. |
| `FERDINAND_USER2` login 401 | Second user not yet provisioned on the deployed instance | Provision via the in-app `/settings` admin panel (Phase B2) or `cargo run -p anki_server -- create-user USER2 PASS2` before running a13. |

## Relationship to (a1–a12)

The localhost suite (a1–a12) covers behavior. The live smokes (a13, a14) cover
**deployment integrity**: that the edge (Zeabur gateway or raw-VPS Caddy) +
TLS + reverse-proxy + the embedded mockup build all line up correctly in
production. They intentionally re-cover a small slice of (a3 login, a5 study,
a6 browse, a12b import) to catch deploy-only regressions like
header-stripping, cookie domain mismatch, TLS-only redirect loops, and
viewport-specific WebKit failures that don't reproduce on localhost Chromium.
