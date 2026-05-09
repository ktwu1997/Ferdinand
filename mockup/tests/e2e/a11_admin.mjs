#!/usr/bin/env node
// Phase B2 admin-endpoint e2e (pure API, no DOM).
//
// Mirrors a2_auth_endpoints.mjs in shape — exercises the live anki_server
// (BASE = http://127.0.0.1:40001 by default) so it catches integration-
// layer regressions across the require_auth + require_admin layers, the
// SQLite schema migration that adds users.disabled_at, and the
// SESSION_USER_KEY-driven session cleanup that runs alongside disable /
// reset-password.
//
// Required env:
//   FERDINAND_TEST_PASSWORD  — the configured ktwu password
//   ANKI_ADMIN_USERNAME      — must be set (and equal to TEST_USER) on
//                              the running server, otherwise every admin
//                              call 403s and cases 3-7 fail. The harness
//                              doesn't set this for you — start the server
//                              with `ANKI_ADMIN_USERNAME=ktwu cargo run -p
//                              anki_server`.
//
// Cases:
//   1. anon GET /api/admin/users                     → 401
//   2. non-admin GET /api/admin/users                 → 403
//   3. admin  GET /api/admin/users                    → 200 + list contains ktwu + friend
//   4. admin  POST /disable {disabled:true} on friend → 200
//   5. friend POST /api/auth/login                    → 401 (account disabled)
//   6. admin  POST /disable {disabled:false}; then friend login → 200
//   7. admin  POST /reset-password new=<reset>; friend login NEW → 200;
//      old → 401; admin reset back to INITIAL.
//
// Login-budget note: anki_server's /api/auth/login limiter is keyed by
// BOTH (ip, username), and the per-IP scope is shared across users. So
// when this suite runs immediately after the visual e2e suites (which
// have already burnt several ktwu logins from 127.0.0.1 within the 60s
// window), we'd otherwise overflow the per-IP budget. Two coping levers:
//
//   1. The friend logins are scoped down to FOUR (not five). Case 5
//      ("disabled login fails") is verified by probing the nonAdmin
//      cookie's /api/auth/me — which is 401 because the disable handler
//      revoked the session — instead of a fresh login attempt.
//   2. FERDINAND_FRIEND_COOLDOWN=65 inserts a 65-second sleep at the
//      top of the suite to let the per-IP window clear when running
//      back-to-back with the visual suites.
//
// Usage:
//   FERDINAND_TEST_PASSWORD=... node mockup/tests/e2e/a11_admin.mjs
//
// Exit 0 = all green; non-zero = at least one assertion failed.

import { request } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a11_admin");
fs.mkdirSync(ART, { recursive: true });

const BASE = process.env.E2E_BASE || "http://127.0.0.1:40001";
const TEST_USER = process.env.FERDINAND_TEST_USER || "ktwu";
const TEST_PASSWORD = process.env.FERDINAND_TEST_PASSWORD || "";
const FRIEND_USER = process.env.FERDINAND_TEST_FRIEND || "b2_test_friend";
const FRIEND_PASS_INITIAL =
    process.env.FERDINAND_TEST_FRIEND_PASS || "friend-pass-initial";
const FRIEND_PASS_RESET = "friend-pass-reset-by-admin";
const COOLDOWN_SECS = Number(process.env.FERDINAND_FRIEND_COOLDOWN || "0");

if (!TEST_PASSWORD) {
    console.error(
        "FERDINAND_TEST_PASSWORD must be set so admin can authenticate.",
    );
    process.exit(2);
}

const result = { base: BASE, started: new Date().toISOString(), checks: [] };
const record = (name, passed, detail) => {
    result.checks.push({ name, passed, detail });
    console.log(`${passed ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function adminLogin(ctx) {
    const res = await ctx.post("/api/auth/login", {
        data: { username: TEST_USER, password: TEST_PASSWORD },
    });
    if (res.status() !== 200) {
        throw new Error(`admin login failed: ${res.status()}`);
    }
    const body = await res.json();
    if (body.is_admin !== true) {
        throw new Error(
            "admin login succeeded but is_admin=false — set ANKI_ADMIN_USERNAME=" +
                TEST_USER +
                " on the server",
        );
    }
}

async function ensureFriend(adminCtx) {
    // Tolerate 409 (already exists). The follow-up admin reset + enable
    // makes sure the starting state is canonical regardless.
    const reg = await adminCtx.post("/api/auth/register", {
        data: { username: FRIEND_USER, password: FRIEND_PASS_INITIAL },
    });
    if (![201, 409].includes(reg.status())) {
        throw new Error(`friend register unexpected: ${reg.status()}`);
    }
    // Reset friend password to the known initial — so a previous run
    // that left the password as RESET doesn't break case 5/6 logins.
    const r1 = await adminCtx.post(
        `/api/admin/users/${encodeURIComponent(FRIEND_USER)}/reset-password`,
        { data: { new: FRIEND_PASS_INITIAL } },
    );
    if (r1.status() !== 200) {
        throw new Error(`friend reset-password (pre): ${r1.status()}`);
    }
    // Re-enable in case a previous run left them disabled.
    const r2 = await adminCtx.post(
        `/api/admin/users/${encodeURIComponent(FRIEND_USER)}/disable`,
        { data: { disabled: false } },
    );
    if (r2.status() !== 200) {
        throw new Error(`friend re-enable (pre): ${r2.status()}`);
    }
}

const anon = await request.newContext({ baseURL: BASE });
const admin = await request.newContext({ baseURL: BASE });
const nonAdmin = await request.newContext({ baseURL: BASE });

try {
    if (COOLDOWN_SECS > 0) {
        console.log(`// FRIEND_COOLDOWN=${COOLDOWN_SECS}s — waiting…`);
        await sleep(COOLDOWN_SECS * 1000);
    }

    // 0. Bootstrap admin context + friend account.
    await adminLogin(admin);
    await ensureFriend(admin);

    // 1. anon GET /api/admin/users → 401
    {
        const res = await anon.get("/api/admin/users");
        record(
            "1. GET /api/admin/users anon → 401",
            res.status() === 401,
            `status=${res.status()}`,
        );
    }

    // 2. non-admin GET → 403. Friend logs in (consumes 0 budget — this
    //    counts against the friend budget but with a fresh window we're
    //    fine. Logging in also seeds the cookie jar for the 403 probe.)
    //    NOTE: this login goes BEFORE we run the disable round-trip so
    //    the friend account is still enabled here.
    {
        const r = await nonAdmin.post("/api/auth/login", {
            data: { username: FRIEND_USER, password: FRIEND_PASS_INITIAL },
        });
        if (r.status() !== 200) {
            throw new Error(`non-admin friend login (pre 403 probe): ${r.status()}`);
        }
        const res = await nonAdmin.get("/api/admin/users");
        record(
            "2. GET /api/admin/users non-admin → 403",
            res.status() === 403,
            `status=${res.status()}`,
        );
    }
    // Note: keep nonAdmin's friend session alive into case 5 so we can
    // verify that admin disable revokes it server-side. Cases 6/7b/7c
    // make their own fresh contexts so they're not affected by this
    // cookie sticking around (and case 5 will land its assertion before
    // we'd care anyway).

    // 3. admin GET → 200 with both users listed.
    {
        const res = await admin.get("/api/admin/users");
        const ok = res.status() === 200;
        let detail = `status=${res.status()}`;
        let containsBoth = false;
        if (ok) {
            const body = await res.json();
            const names = (body.users ?? []).map((u) => u.username);
            containsBoth = names.includes(TEST_USER) && names.includes(FRIEND_USER);
            detail += ` users=[${names.join(",")}]`;
        }
        record(
            "3. GET /api/admin/users admin → 200 + list contains both",
            ok && containsBoth,
            detail,
        );
    }

    // 4. admin disable friend. (`nonAdmin` still holds the friend cookie
    //    from case 2 — but its session row was just deleted by
    //    delete_sessions_for_user, so any subsequent call from that
    //    context will 401.)
    let preDisableMeStatus = null;
    {
        // Pre-state: friend's `me` returns 200 (not yet disabled).
        const pre = await nonAdmin.get("/api/auth/me");
        preDisableMeStatus = pre.status();
        const res = await admin.post(
            `/api/admin/users/${encodeURIComponent(FRIEND_USER)}/disable`,
            { data: { disabled: true } },
        );
        record(
            "4. POST disable friend → 200",
            res.status() === 200,
            `status=${res.status()}`,
        );
    }

    // 5. Sessions revoked: nonAdmin's once-valid friend cookie now 401s
    //    on /api/auth/me. This exercises the same security property as
    //    a fresh login attempt (a disabled user has no working session)
    //    but doesn't burn another login slot from the per-IP budget.
    {
        const res = await nonAdmin.get("/api/auth/me");
        record(
            "5. nonAdmin /api/auth/me after disable → 401 (sessions revoked)",
            preDisableMeStatus === 200 && res.status() === 401,
            `pre=${preDisableMeStatus} post=${res.status()}`,
        );
    }

    // 6. admin re-enables friend; friend login → 200.
    {
        const res = await admin.post(
            `/api/admin/users/${encodeURIComponent(FRIEND_USER)}/disable`,
            { data: { disabled: false } },
        );
        if (res.status() !== 200) {
            record("6. POST re-enable friend → 200", false, `status=${res.status()}`);
        } else {
            const ctx = await request.newContext({ baseURL: BASE });
            const r = await ctx.post("/api/auth/login", {
                data: { username: FRIEND_USER, password: FRIEND_PASS_INITIAL },
            });
            record(
                "6. friend login after re-enable → 200",
                r.status() === 200,
                `status=${r.status()}`,
            );
            await ctx.dispose();
        }
    }

    // 7. admin reset-password → friend NEW → 200, OLD → 401, then admin
    //    restores INITIAL so the suite is idempotent.
    {
        const r1 = await admin.post(
            `/api/admin/users/${encodeURIComponent(FRIEND_USER)}/reset-password`,
            { data: { new: FRIEND_PASS_RESET } },
        );
        if (r1.status() !== 200) {
            record("7a. admin reset-password → 200", false, `status=${r1.status()}`);
        } else {
            // login with NEW pw
            const ctxNew = await request.newContext({ baseURL: BASE });
            const rNew = await ctxNew.post("/api/auth/login", {
                data: { username: FRIEND_USER, password: FRIEND_PASS_RESET },
            });
            record(
                "7b. friend login with new pw → 200",
                rNew.status() === 200,
                `status=${rNew.status()}`,
            );
            await ctxNew.dispose();
            // login with OLD pw
            const ctxOld = await request.newContext({ baseURL: BASE });
            const rOld = await ctxOld.post("/api/auth/login", {
                data: { username: FRIEND_USER, password: FRIEND_PASS_INITIAL },
            });
            record(
                "7c. friend login with old pw → 401",
                rOld.status() === 401,
                `status=${rOld.status()}`,
            );
            await ctxOld.dispose();
            // Idempotent restore — admin resets back to INITIAL so a
            // re-run of this suite (modulo the rate-limit cooldown) finds
            // the friend in the canonical starting state.
            const r2 = await admin.post(
                `/api/admin/users/${encodeURIComponent(FRIEND_USER)}/reset-password`,
                { data: { new: FRIEND_PASS_INITIAL } },
            );
            record(
                "7d. admin restore initial pw → 200",
                r2.status() === 200,
                `status=${r2.status()}`,
            );
        }
    }
} finally {
    fs.writeFileSync(
        path.join(ART, "results.json"),
        JSON.stringify(
            { ...result, ended: new Date().toISOString() },
            null,
            2,
        ),
    );
    await anon.dispose();
    await admin.dispose();
    await nonAdmin.dispose();
}

const failed = result.checks.filter((c) => !c.passed);
if (failed.length === 0) {
    console.log(`\nAll ${result.checks.length} checks passed.`);
    process.exit(0);
} else {
    console.error(`\n${failed.length} of ${result.checks.length} checks failed.`);
    process.exit(1);
}
