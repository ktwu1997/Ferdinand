#!/usr/bin/env node
// Phase A4-β /login frontend e2e — covers the login page UI, the auth
// store's bootstrap+401 redirect glue, and the layout-level route guard.
// a2_auth_endpoints.mjs already proves the wire-level `/api/auth/*`
// surface so this suite focuses on the parts a2 can't reach: the SPA
// loads the form, submits credentials, persists the session cookie,
// honours `?next=`, and the guard rebounces post-logout.
//
// Scope (8 cases):
//   1. Direct /login → page renders with username + password fields
//   2. Anonymous /browse → redirected to /login?next=%2Fbrowse
//   3. Wrong password → inline error, URL stays on /login
//   4. Correct password → redirected to the `next` target
//   5. /api/auth/me from the authenticated context → 200 + username
//   6. POST /api/auth/logout → 204
//   7. Anonymous /browse post-logout → redirected back to /login
//   8. Phase B1 — /settings sidebar password form: toggle reveals inputs,
//      validation surfaces inline errors, cancel collapses (no server
//      mutation; happy-path mutation is covered by a2 cases 13-16)
//
// Pre-reqs:
//   * anki_server running on :40001 with mockup/build/ embedded or
//     served via the dev fallback (so navigating to /login resolves to
//     the SvelteKit page, not a 404)
//   * FERDINAND_TEST_USER + FERDINAND_TEST_PASSWORD set so case 4 can
//     log in. Empty password is a hard fail like a1 / a2.
//
// Usage:
//   set -a; source .env; set +a
//   node mockup/tests/e2e/a3_frontend_login.mjs
//
// Exit 0 = all green; non-zero = at least one assertion failed
// (artifacts/a3_frontend_login/result.json + screenshots for triage).

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a3_frontend_login");
fs.mkdirSync(ART, { recursive: true });

const BASE = process.env.E2E_BASE || "http://127.0.0.1:40001";
const TEST_USER = process.env.FERDINAND_TEST_USER || "ktwu";
const TEST_PASSWORD = process.env.FERDINAND_TEST_PASSWORD || "";
const CHROME =
    process.env.CHROME_EXECUTABLE ||
    "/home/ktwu/.cache/ms-playwright/chromium-1217/chrome-linux/chrome";

if (!TEST_PASSWORD) {
    console.error(
        "FERDINAND_TEST_PASSWORD must be set so case 4 can log in. " +
            "Source .env (set -a; source .env; set +a) or pass on the CLI.",
    );
    process.exit(2);
}

const result = {
    base: BASE,
    started: new Date().toISOString(),
    checks: [],
    consoleErrors: [],
    failedRequests: [],
};
const record = (name, passed, detail) => {
    result.checks.push({ name, passed, detail });
    console.log(`${passed ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
});
// Two contexts: `anon` never logs in (clean cookie jar so cases 2 + 7
// see the redirect path); `auth` runs cases 3-6 with cookie state
// shared between page navigation and context.request calls. Keeping
// them separate avoids the "what cookies did Playwright remember from
// the bad-password attempt" question that nests under case 3.
const anon = await browser.newContext({
    viewport: { width: 1280, height: 900 },
});
const authed = await browser.newContext({
    viewport: { width: 1280, height: 900 },
});

const wireConsole = (page, label) => {
    page.on("console", (msg) => {
        if (msg.type() === "error") {
            result.consoleErrors.push(`[${label}] ${msg.text()}`);
        }
    });
    page.on("requestfailed", (req) => {
        result.failedRequests.push(
            `[${label}] ${req.method()} ${req.url()} :: ${req.failure()?.errorText}`,
        );
    });
};

try {
    // ===== 1. Direct /login renders the form =====
    {
        const page = await anon.newPage();
        wireConsole(page, "case1");
        await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
        await page.screenshot({ path: path.join(ART, "01-login-direct.png") });
        const root = page.locator('[data-testid="login-root"]');
        const submit = page.locator('[data-testid="login-submit"]');
        // Field labels render inside the primitive's <span class="field-label">,
        // but we don't need to query that DOM detail — the autocomplete
        // attribute on the inputs is the most stable handle since it's
        // part of the contract with the browser's password manager.
        const usernameInput = page.locator('input[autocomplete="username"]').first();
        const passwordInput = page.locator('input[autocomplete="current-password"]').first();
        const rootVisible = await root.isVisible().catch(() => false);
        const submitVisible = await submit.isVisible().catch(() => false);
        const userVisible = await usernameInput.isVisible().catch(() => false);
        const pwVisible = await passwordInput.isVisible().catch(() => false);
        record(
            "1. /login renders username + password + submit",
            rootVisible && submitVisible && userVisible && pwVisible,
            `root=${rootVisible} submit=${submitVisible} user=${userVisible} pw=${pwVisible}`,
        );
        await page.close();
    }

    // ===== 2. Anonymous /browse → redirect to /login?next=%2Fbrowse =====
    {
        const page = await anon.newPage();
        wireConsole(page, "case2");
        // The route guard fires inside `$effect`, which runs after mount;
        // `domcontentloaded` returns before that, and `networkidle` may
        // also resolve before the SPA pushes the new URL. Wait for a URL
        // change with a generous-but-bounded timeout.
        await page.goto(`${BASE}/browse`, { waitUntil: "domcontentloaded" });
        await page
            .waitForURL(/\/login\?next=/, { timeout: 5000 })
            .catch(() => null);
        await page.screenshot({
            path: path.join(ART, "02-anon-browse-redirect.png"),
        });
        const url = new URL(page.url());
        const onLogin = url.pathname === "/login";
        const nextParam = url.searchParams.get("next");
        record(
            "2. anon /browse → /login?next=/browse",
            onLogin && nextParam === "/browse",
            `pathname=${url.pathname} next=${nextParam}`,
        );
        await page.close();
    }

    // ===== 3. Wrong password → inline error, stay on /login =====
    {
        const page = await authed.newPage();
        wireConsole(page, "case3");
        await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
        const usernameInput = page.locator('input[autocomplete="username"]').first();
        const passwordInput = page.locator('input[autocomplete="current-password"]').first();
        await usernameInput.fill(TEST_USER);
        await passwordInput.fill("definitely-not-it");
        await page.locator('[data-testid="login-submit"]').click();
        // Wait for either the inline error to appear or a navigation —
        // success path would change the URL, so the error becoming
        // visible is also evidence we DIDN'T navigate.
        const errorLocator = page.locator('[data-testid="login-error"]');
        await errorLocator
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        await page.screenshot({ path: path.join(ART, "03-wrong-password.png") });
        const url = new URL(page.url());
        const errorText = (await errorLocator.textContent().catch(() => "")) ?? "";
        const stillOnLogin = url.pathname === "/login";
        record(
            "3. wrong password surfaces inline error; URL stays /login",
            stillOnLogin && errorText.toLowerCase().includes("invalid"),
            `pathname=${url.pathname} error="${errorText.trim()}"`,
        );
        await page.close();
    }

    // ===== 4. Correct password → redirected to next =====
    {
        const page = await authed.newPage();
        wireConsole(page, "case4");
        await page.goto(`${BASE}/login?next=%2Fbrowse`, {
            waitUntil: "networkidle",
        });
        const usernameInput = page.locator('input[autocomplete="username"]').first();
        const passwordInput = page.locator('input[autocomplete="current-password"]').first();
        await usernameInput.fill(TEST_USER);
        await passwordInput.fill(TEST_PASSWORD);
        await page.locator('[data-testid="login-submit"]').click();
        await page
            .waitForURL((u) => new URL(u).pathname === "/browse", {
                timeout: 8000,
            })
            .catch(() => null);
        await page.screenshot({
            path: path.join(ART, "04-after-good-login.png"),
        });
        const url = new URL(page.url());
        record(
            "4. good creds → URL ends up at /browse (next honoured)",
            url.pathname === "/browse",
            `pathname=${url.pathname}`,
        );
        await page.close();
    }

    // ===== 5. authed /api/auth/me returns 200 + username =====
    {
        const res = await authed.request.get(`${BASE}/api/auth/me`);
        const body = await res.json().catch(() => null);
        record(
            "5. /api/auth/me authed → 200 + username matches",
            res.status() === 200 && body?.username === TEST_USER,
            `status=${res.status()} body=${JSON.stringify(body)}`,
        );
    }

    // ===== 6. logout → 204 =====
    {
        const res = await authed.request.post(`${BASE}/api/auth/logout`);
        record(
            "6. POST /api/auth/logout → 204",
            res.status() === 204,
            `status=${res.status()}`,
        );
    }

    // ===== 7. Post-logout /browse redirects back to /login =====
    {
        const page = await authed.newPage();
        wireConsole(page, "case7");
        await page.goto(`${BASE}/browse`, { waitUntil: "domcontentloaded" });
        await page
            .waitForURL(/\/login\?next=/, { timeout: 5000 })
            .catch(() => null);
        await page.screenshot({
            path: path.join(ART, "07-postlogout-redirect.png"),
        });
        const url = new URL(page.url());
        const onLogin = url.pathname === "/login";
        const nextParam = url.searchParams.get("next");
        record(
            "7. post-logout /browse → /login?next=/browse",
            onLogin && nextParam === "/browse",
            `pathname=${url.pathname} next=${nextParam}`,
        );
        await page.close();
    }

    // ===== 8. Phase B1 — /settings sidebar password form (UI smoke) =====
    // Server-side mutation paths (wrong-current 401, weak-new 400, happy 200,
    // login-with-new 200) are exercised by a2 cases 11-16 against the live
    // wire. This case proves the FORM exists, toggles in/out, and surfaces
    // validation errors before touching the server. Uses a fresh context so
    // we don't depend on case 4's auth state (case 6 logged it out).
    {
        const ctx = await browser.newContext({
            viewport: { width: 1280, height: 900 },
        });
        const page = await ctx.newPage();
        wireConsole(page, "case8");
        // Login afresh so /settings is reachable.
        await page.goto(`${BASE}/login?next=%2Fsettings`, {
            waitUntil: "networkidle",
        });
        await page
            .locator('input[autocomplete="username"]')
            .first()
            .fill(TEST_USER);
        await page
            .locator('input[autocomplete="current-password"]')
            .first()
            .fill(TEST_PASSWORD);
        await page.locator('[data-testid="login-submit"]').click();
        await page
            .waitForURL((u) => new URL(u).pathname === "/settings", {
                timeout: 8000,
            })
            .catch(() => null);

        const toggle = page.locator('[data-testid="settings-pw-toggle"]');
        const toggleVisible = await toggle.isVisible().catch(() => false);
        await page.screenshot({
            path: path.join(ART, "08a-pw-collapsed.png"),
        });

        // Open the form
        if (toggleVisible) await toggle.click();
        const form = page.locator('[data-testid="settings-pw-form"]');
        const inputCurrent = page.locator('[data-testid="settings-pw-current"]');
        const inputNew = page.locator('[data-testid="settings-pw-new"]');
        const inputConfirm = page.locator('[data-testid="settings-pw-confirm"]');
        const submit = page.locator('[data-testid="settings-pw-submit"]');
        const cancel = page.locator('[data-testid="settings-pw-cancel"]');
        await form.waitFor({ state: "visible", timeout: 3000 }).catch(() => null);
        const formVisible = await form.isVisible().catch(() => false);
        const allInputsVisible =
            (await inputCurrent.isVisible().catch(() => false)) &&
            (await inputNew.isVisible().catch(() => false)) &&
            (await inputConfirm.isVisible().catch(() => false)) &&
            (await submit.isVisible().catch(() => false)) &&
            (await cancel.isVisible().catch(() => false));
        await page.screenshot({
            path: path.join(ART, "08b-pw-open-empty.png"),
        });

        // Submit empty → "current password required" inline error.
        await submit.click();
        const errorLocator = page.locator('[data-testid="settings-pw-error"]');
        await errorLocator
            .waitFor({ state: "visible", timeout: 2000 })
            .catch(() => null);
        const emptyErr = (await errorLocator.textContent().catch(() => "")) ?? "";

        // Now type a current pw + a mismatched confirm → confirm-mismatch error.
        await inputCurrent.fill(TEST_PASSWORD);
        await inputNew.fill("first-attempt");
        await inputConfirm.fill("different-attempt");
        await submit.click();
        await page.waitForTimeout(150);
        const shortErr = (await errorLocator.textContent().catch(() => "")) ?? "";

        // Cancel → form collapses, toggle reappears.
        await cancel.click();
        const reCollapsed = await toggle
            .isVisible({ timeout: 2000 })
            .catch(() => false);
        await page.screenshot({
            path: path.join(ART, "08c-pw-cancelled.png"),
        });

        record(
            "8. /settings sidebar password form toggles + validates + cancels",
            toggleVisible &&
                formVisible &&
                allInputsVisible &&
                emptyErr.toLowerCase().includes("current") &&
                /match|don'?t/i.test(shortErr) &&
                reCollapsed,
            `toggle=${toggleVisible} form=${formVisible} inputs=${allInputsVisible} emptyErr="${emptyErr.trim()}" shortErr="${shortErr.trim()}" reCollapsed=${reCollapsed}`,
        );
        await page.close();
        await ctx.close();
    }
} finally {
    await anon.close();
    await authed.close();
    await browser.close();
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
    if (result.consoleErrors.length) {
        console.log(`\nConsole errors (${result.consoleErrors.length}):`);
        for (const e of result.consoleErrors) console.log(`  ${e}`);
    }
    if (result.failedRequests.length) {
        console.log(`\nFailed requests (${result.failedRequests.length}):`);
        for (const r of result.failedRequests) console.log(`  ${r}`);
    }
    process.exit(result.summary.failed > 0 ? 1 : 0);
}
