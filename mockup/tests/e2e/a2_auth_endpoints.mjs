#!/usr/bin/env node
// Phase A2 auth-endpoint e2e (pure API, no DOM).
//
// Mirrors anki_server/tests/cli_auth_endpoints.sh in spirit but exercises
// the live dev server (BASE = http://127.0.0.1:40001 by default), so it
// catches integration-layer regressions: cookie jar plumbing through
// Playwright's APIRequestContext, JSON shape on /api/auth/me, and the
// auth gate on a protected route.
//
// Scope:
//   1. /api/health (public)                          → 200
//   2. /api/auth/me unauth                            → 401
//   3. /api/decks unauth                              → 401
//   4. /api/auth/login bad password                   → 401
//   5. /api/auth/login good password                  → 200
//   6. /api/auth/me authed                            → 200, username matches
//   7. /api/decks authed                              → 200, decks present
//   8. /api/auth/logout                               → 204
//   9. /api/decks post-logout                         → 401
//  10. PATCH /api/auth/password unauth (Phase B1)     → 401
//  11. PATCH /api/auth/password wrong-current         → 401
//  12. PATCH /api/auth/password empty-new             → 400
//  13. PATCH /api/auth/password good change           → 200
//  14. login with NEW password works                  → 200
//  15. login with OLD password rejected               → 401
//  16. PATCH /api/auth/password restore back to OLD   → 200 (leaves env idempotent)
//
// Usage:
//   FERDINAND_TEST_PASSWORD=... node mockup/tests/e2e/a2_auth_endpoints.mjs
//
// Exit 0 = all green; non-zero = at least one assertion failed.

import { request } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a2_auth_endpoints");
fs.mkdirSync(ART, { recursive: true });

const BASE = process.env.E2E_BASE || "http://127.0.0.1:40001";
const TEST_USER = process.env.FERDINAND_TEST_USER || "ktwu";
const TEST_PASSWORD = process.env.FERDINAND_TEST_PASSWORD || "";

if (!TEST_PASSWORD) {
    console.error(
        "FERDINAND_TEST_PASSWORD must be set so the e2e suite can log in.",
    );
    process.exit(2);
}

const result = { base: BASE, started: new Date().toISOString(), checks: [] };
const record = (name, passed, detail) => {
    result.checks.push({ name, passed, detail });
    console.log(`${passed ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
};

// Two contexts: `anon` never authenticates (clean cookie jar); `auth`
// logs in + reuses the cookie. Keeping them separate is clearer than
// flushing cookies between phases — which Playwright's APIRequestContext
// does not expose a clean primitive for.
const anon = await request.newContext({ baseURL: BASE });
const authed = await request.newContext({ baseURL: BASE });

try {
    // 1. Health
    {
        const res = await anon.get("/api/health");
        const body = await res.json().catch(() => null);
        record(
            "1. GET /api/health → 200 ok=true",
            res.status() === 200 && body?.ok === true,
            `status=${res.status()}`,
        );
    }

    // 2. Unauth /api/auth/me → 401
    {
        const res = await anon.get("/api/auth/me");
        record(
            "2. GET /api/auth/me unauth → 401",
            res.status() === 401,
            `status=${res.status()}`,
        );
    }

    // 3. Unauth /api/decks → 401
    {
        const res = await anon.get("/api/decks");
        record(
            "3. GET /api/decks unauth → 401",
            res.status() === 401,
            `status=${res.status()}`,
        );
    }

    // 4. Bad-password login → 401
    {
        const res = await authed.post("/api/auth/login", {
            data: { username: TEST_USER, password: "definitely-not-it" },
        });
        record(
            "4. POST /api/auth/login wrong-password → 401",
            res.status() === 401,
            `status=${res.status()}`,
        );
    }

    // 5. Good login → 200, cookie now on `authed`
    {
        const res = await authed.post("/api/auth/login", {
            data: { username: TEST_USER, password: TEST_PASSWORD },
        });
        record(
            "5. POST /api/auth/login good creds → 200",
            res.status() === 200,
            `status=${res.status()}`,
        );
    }

    // 6. Authed /api/auth/me
    {
        const res = await authed.get("/api/auth/me");
        const body = await res.json().catch(() => null);
        record(
            "6. GET /api/auth/me authed → 200 username matches",
            res.status() === 200 && body?.username === TEST_USER,
            `status=${res.status()} body=${JSON.stringify(body)}`,
        );
    }

    // 7. Authed /api/decks
    {
        const res = await authed.get("/api/decks?include_counts=1");
        const body = await res.json().catch(() => null);
        record(
            "7. GET /api/decks authed → 200, decks array present",
            res.status() === 200 && Array.isArray(body?.decks),
            `status=${res.status()} decks=${body?.decks?.length}`,
        );
    }

    // 8. Logout → 204
    {
        const res = await authed.post("/api/auth/logout");
        record(
            "8. POST /api/auth/logout → 204",
            res.status() === 204,
            `status=${res.status()}`,
        );
    }

    // 9. Post-logout /api/decks → 401
    {
        const res = await authed.get("/api/decks");
        record(
            "9. GET /api/decks post-logout → 401",
            res.status() === 401,
            `status=${res.status()}`,
        );
    }

    // ─── Phase B1: PATCH /api/auth/password ─────────────────────────────
    // Re-login first so cases 11-13 have a valid session to mutate, then
    // exercise the wrong/weak/happy paths and prove the change actually
    // takes effect. Suite ends with the original password restored so
    // every run is idempotent — we explicitly do NOT leave the test user
    // in a different password state, otherwise downstream suites (and
    // future re-runs of a2 itself) would all fail.
    const NEW_PW = `${TEST_PASSWORD}_b1_e2e`; // distinct from current
    let serverChanged = false; // tracks whether case 13 actually flipped the hash

    // 10. Unauth PATCH → 401
    {
        const res = await anon.patch("/api/auth/password", {
            data: { current: TEST_PASSWORD, new: NEW_PW },
        });
        record(
            "10. PATCH /api/auth/password unauth → 401",
            res.status() === 401,
            `status=${res.status()}`,
        );
    }

    // Re-establish session on `authed` (logout in step 8 cleared it).
    {
        const res = await authed.post("/api/auth/login", {
            data: { username: TEST_USER, password: TEST_PASSWORD },
        });
        if (res.status() !== 200) {
            record(
                "11-prep: re-login for change-password cases",
                false,
                `status=${res.status()}`,
            );
        }
    }

    // 11. Wrong current password → 401
    {
        const res = await authed.patch("/api/auth/password", {
            data: { current: "definitely-not-it", new: NEW_PW },
        });
        record(
            "11. PATCH /api/auth/password wrong-current → 401",
            res.status() === 401,
            `status=${res.status()}`,
        );
    }

    // 12. Empty new password → 400 (matches register's "non-empty" policy)
    {
        const res = await authed.patch("/api/auth/password", {
            data: { current: TEST_PASSWORD, new: "" },
        });
        record(
            "12. PATCH /api/auth/password empty-new → 400",
            res.status() === 400,
            `status=${res.status()}`,
        );
    }

    // 13. Good change → 200
    {
        const res = await authed.patch("/api/auth/password", {
            data: { current: TEST_PASSWORD, new: NEW_PW },
        });
        const body = await res.json().catch(() => null);
        record(
            "13. PATCH /api/auth/password good → 200 ok=true",
            res.status() === 200 && body?.ok === true,
            `status=${res.status()} body=${JSON.stringify(body)}`,
        );
        if (res.status() === 200) serverChanged = true;
    }

    // Cases 4-5 burned login slots on TEST_USER; 14/15 each issue another
    // login from a fresh context. The per-username sliding window is
    // BUDGET=5 / WINDOW=60s (anki_server/src/auth/rate_limit.rs), so wait
    // out the oldest slot before pressing on. retryOn429 covers any
    // residual contention without sleeping the full minute every time.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const retryOn429 = async (attempt) => {
        let res = await attempt();
        if (res.status() === 429) {
            await sleep(65_000);
            res = await attempt();
        }
        return res;
    };
    await sleep(65_000);

    // 14. Login with NEW password works (proves the hash actually moved)
    {
        const verify = await request.newContext({ baseURL: BASE });
        const res = await retryOn429(() =>
            verify.post("/api/auth/login", {
                data: { username: TEST_USER, password: NEW_PW },
            }),
        );
        record(
            "14. POST /api/auth/login with NEW password → 200",
            res.status() === 200,
            `status=${res.status()}`,
        );
        await verify.dispose();
    }

    // 15. Login with OLD password rejected (proves the old hash is gone)
    {
        const verify = await request.newContext({ baseURL: BASE });
        const res = await retryOn429(() =>
            verify.post("/api/auth/login", {
                data: { username: TEST_USER, password: TEST_PASSWORD },
            }),
        );
        record(
            "15. POST /api/auth/login with OLD password → 401",
            res.status() === 401,
            `status=${res.status()}`,
        );
        await verify.dispose();
    }

    // 16. Restore — flip back so the test user ends in the same state. Uses
    //     the post-cycle session id on `authed` (cycle_id keeps that ctx
    //     authenticated; the cookie jar updated automatically).
    if (serverChanged) {
        const res = await authed.patch("/api/auth/password", {
            data: { current: NEW_PW, new: TEST_PASSWORD },
        });
        record(
            "16. PATCH /api/auth/password restore → 200",
            res.status() === 200,
            `status=${res.status()}`,
        );
    } else {
        record(
            "16. PATCH /api/auth/password restore (skipped — case 13 did not change hash)",
            false,
            "skipped",
        );
    }
} finally {
    await anon.dispose();
    await authed.dispose();
    result.finished = new Date().toISOString();
    result.summary = {
        total: result.checks.length,
        passed: result.checks.filter((c) => c.passed).length,
        failed: result.checks.filter((c) => !c.passed).length,
    };
    fs.writeFileSync(
        path.join(ART, "result.json"),
        JSON.stringify(result, null, 2),
    );
    console.log(
        `\n=== ${result.summary.passed}/${result.summary.total} passed (${result.summary.failed} failed) ===`,
    );
    process.exit(result.summary.failed > 0 ? 1 : 0);
}
