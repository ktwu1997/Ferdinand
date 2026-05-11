#!/usr/bin/env node
// WS2 admin create-user e2e (pure API, no DOM).
//
// Companion to a11_admin.mjs — exercises the new `POST /api/admin/users`
// route end-to-end against the live anki_server (BASE =
// http://127.0.0.1:40001 by default): the require_auth + require_admin
// layers, the shared `validate_username` policy, the 409-on-clash and
// 400-on-bad-input branches, and that a freshly-minted account can
// actually authenticate with the password the admin set.
//
// Required env:
//   FERDINAND_TEST_PASSWORD  — the configured ktwu password
//   ANKI_ADMIN_USERNAME      — must be set (and equal to TEST_USER) on the
//                              running server, otherwise every admin call
//                              403s. Start the server with
//                              `ANKI_ADMIN_USERNAME=ktwu cargo run -p
//                              anki_server`.
//
// Cases:
//   1. anon     POST /api/admin/users                    → 401
//   2. non-admin POST /api/admin/users                    → 403
//      (a self-registered helper account that is NOT the admin)
//   3. admin    POST /api/admin/users {username,password} → 201, new row
//      appears in GET /api/admin/users
//   4. the new user POST /api/auth/login with that pw     → 200
//   5. admin    POST /api/admin/users (same username)     → 409
//   6. admin    POST /api/admin/users {username:""}       → 400
//   7. admin    POST /api/admin/users {password:""}       → 400
//
// Cleanup note: there's no DELETE /api/admin/users yet (deferred), so the
// created account ("b2_created_<run-id>") is left behind — the run-id
// suffix keeps re-runs from clashing. Case 5 deliberately re-uses the
// just-created name to assert the 409 path.
//
// Login-budget note: same per-(ip,username) limiter as a11. We make at
// most TWO fresh logins (admin + the new user) plus one for the non-admin
// helper, well under the per-IP budget. If running back-to-back with the
// visual suites, set FERDINAND_FRIEND_COOLDOWN=65.
//
// Usage:
//   FERDINAND_TEST_PASSWORD=... node mockup/tests/e2e/a11b_admin_create_user.mjs
//
// Exit 0 = all green; non-zero = at least one assertion failed.

import { request } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a11b_admin_create_user");
fs.mkdirSync(ART, { recursive: true });

const BASE = process.env.E2E_BASE || "http://127.0.0.1:40001";
const TEST_USER = process.env.FERDINAND_TEST_USER || "ktwu";
const TEST_PASSWORD = process.env.FERDINAND_TEST_PASSWORD || "";
const HELPER_USER = process.env.FERDINAND_TEST_FRIEND || "b2_test_friend";
const HELPER_PASS =
    process.env.FERDINAND_TEST_FRIEND_PASS || "friend-pass-initial";
const COOLDOWN_SECS = Number(process.env.FERDINAND_FRIEND_COOLDOWN || "0");

// Unique, policy-valid (lowercase [a-z0-9_-], 3-64 chars) username per run.
const RUN_ID = `${Date.now()}`.slice(-8);
const NEW_USER = `b2_created_${RUN_ID}`;
const NEW_PASS = "created-by-admin-pw";

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

async function ensureHelper(adminCtx) {
    // A non-admin account to exercise the 403 path. Tolerate 409 (already
    // exists from a prior run / a11). Re-enable + reset so its state is
    // canonical regardless.
    const reg = await adminCtx.post("/api/auth/register", {
        data: { username: HELPER_USER, password: HELPER_PASS },
    });
    if (![201, 409].includes(reg.status())) {
        throw new Error(`helper register unexpected: ${reg.status()}`);
    }
    const r1 = await adminCtx.post(
        `/api/admin/users/${encodeURIComponent(HELPER_USER)}/reset-password`,
        { data: { new: HELPER_PASS } },
    );
    if (r1.status() !== 200) {
        throw new Error(`helper reset-password (pre): ${r1.status()}`);
    }
    const r2 = await adminCtx.post(
        `/api/admin/users/${encodeURIComponent(HELPER_USER)}/disable`,
        { data: { disabled: false } },
    );
    if (r2.status() !== 200) {
        throw new Error(`helper re-enable (pre): ${r2.status()}`);
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

    // 0. Bootstrap admin + non-admin helper.
    await adminLogin(admin);
    await ensureHelper(admin);

    // 1. anon POST → 401
    {
        const res = await anon.post("/api/admin/users", {
            data: { username: NEW_USER, password: NEW_PASS },
        });
        record(
            "1. POST /api/admin/users anon → 401",
            res.status() === 401,
            `status=${res.status()}`,
        );
    }

    // 2. non-admin POST → 403
    {
        const r = await nonAdmin.post("/api/auth/login", {
            data: { username: HELPER_USER, password: HELPER_PASS },
        });
        if (r.status() !== 200) {
            throw new Error(`non-admin helper login (pre 403 probe): ${r.status()}`);
        }
        const res = await nonAdmin.post("/api/admin/users", {
            data: { username: NEW_USER, password: NEW_PASS },
        });
        record(
            "2. POST /api/admin/users non-admin → 403",
            res.status() === 403,
            `status=${res.status()}`,
        );
    }

    // 3. admin POST → 201; new row visible in the list.
    {
        const res = await admin.post("/api/admin/users", {
            data: { username: NEW_USER, password: NEW_PASS },
        });
        const created = res.status() === 201;
        let bodyOk = false;
        if (created) {
            const body = await res.json();
            bodyOk = body.username === NEW_USER && body.disabled_at === null;
        }
        let inList = false;
        const list = await admin.get("/api/admin/users");
        if (list.status() === 200) {
            const names = ((await list.json()).users ?? []).map((u) => u.username);
            inList = names.includes(NEW_USER);
        }
        record(
            "3. admin POST → 201 + appears in GET /api/admin/users",
            created && bodyOk && inList,
            `status=${res.status()} body_ok=${bodyOk} in_list=${inList}`,
        );
    }

    // 4. the new user can log in with the password the admin set.
    {
        const ctx = await request.newContext({ baseURL: BASE });
        const r = await ctx.post("/api/auth/login", {
            data: { username: NEW_USER, password: NEW_PASS },
        });
        let isAdminFalse = false;
        if (r.status() === 200) {
            isAdminFalse = (await r.json()).is_admin === false;
        }
        record(
            "4. new user login → 200 (is_admin=false)",
            r.status() === 200 && isAdminFalse,
            `status=${r.status()}`,
        );
        await ctx.dispose();
    }

    // 5. duplicate username → 409.
    {
        const res = await admin.post("/api/admin/users", {
            data: { username: NEW_USER, password: "another-pw" },
        });
        record(
            "5. admin POST duplicate username → 409",
            res.status() === 409,
            `status=${res.status()}`,
        );
    }

    // 6. empty username → 400.
    {
        const res = await admin.post("/api/admin/users", {
            data: { username: "", password: NEW_PASS },
        });
        record(
            "6. admin POST empty username → 400",
            res.status() === 400,
            `status=${res.status()}`,
        );
    }

    // 7. empty password → 400.
    {
        const res = await admin.post("/api/admin/users", {
            data: { username: `b2_nopw_${RUN_ID}`, password: "" },
        });
        record(
            "7. admin POST empty password → 400",
            res.status() === 400,
            `status=${res.status()}`,
        );
    }
} finally {
    fs.writeFileSync(
        path.join(ART, "results.json"),
        JSON.stringify({ ...result, ended: new Date().toISOString() }, null, 2),
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
