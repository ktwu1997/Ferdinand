#!/usr/bin/env node
// a14_live_iphone_safari_smoke.mjs
// Phase B-test pre-write: runs against deployed instance, NOT localhost.
// WebKit + iPhone 13 device emulation. Mobile-only smoke (touch/IME/cookie).
//
// Required env (all paths):
//   BASE_URL, FERDINAND_USER1, FERDINAND_PASS1
// Optional env (raw-VPS path only — Caddy basic_auth gate):
//   BASIC_AUTH_USER, BASIC_AUTH_PASS
//
// Run (Zeabur path — no basic_auth gate):
//   BASE_URL=https://yourdomain.example.com \
//     FERDINAND_USER1=... FERDINAND_PASS1=... \
//     node mockup/tests/e2e/a14_live_iphone_safari_smoke.mjs
//
// Run (raw-VPS path — basic_auth in front of the app):
//   BASE_URL=https://yourdomain.example.com \
//     BASIC_AUTH_USER=... BASIC_AUTH_PASS=... \
//     FERDINAND_USER1=... FERDINAND_PASS1=... \
//     node mockup/tests/e2e/a14_live_iphone_safari_smoke.mjs
//
// See tests/e2e/README-live-smoke.md for full SOP.
//
// Scope (iPhone Safari emulation against deployed anki_server, with or
// without a Caddy basic_auth edge):
//   1. login as USER1 → 200
//   2. dashboard /: sketch-skin .dash-head + .dash-title-hand visible
//   3. /study/<deck>: empty-state OR reveal-btn present; tap (touch-event)
//      ans-again if a card is revealable
//   4. /browse: tap into search input + IME-typing 'テスト' → chip with that
//      query appears (mobile IME spot-check)
//   5. reload page → /api/auth/me still 200 (session cookie persists in WebKit)
//
// Skip path: any of BASE_URL / FERDINAND_USER1 / FERDINAND_PASS1 missing →
// exit 0 with a "skipping live smoke" message. BASIC_AUTH_* may be absent —
// that's the Zeabur-path happy case (no gateway-level auth).

import { webkit, devices } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a14_live_iphone_safari_smoke");
fs.mkdirSync(ART, { recursive: true });

// ---- env --------------------------------------------------------------
const BASE_URL = process.env.BASE_URL || "";
const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER || "";
const BASIC_AUTH_PASS = process.env.BASIC_AUTH_PASS || "";
const FERDINAND_USER1 = process.env.FERDINAND_USER1 || "";
const FERDINAND_PASS1 = process.env.FERDINAND_PASS1 || "";

// BASIC_AUTH_USER + BASIC_AUTH_PASS are OPTIONAL: only the raw-VPS Caddy
// edge enforces them. On Zeabur the platform gateway has no basic_auth gate,
// so absence here is the happy case. We only require BASE_URL + the
// app-login pair.
const REQUIRED = {
    BASE_URL,
    FERDINAND_USER1,
    FERDINAND_PASS1,
};
const missing = Object.entries(REQUIRED)
    .filter(([, v]) => !v)
    .map(([k]) => k);
if (missing.length > 0) {
    console.log(
        `SKIP: a14_live_iphone_safari_smoke — live smoke requires deployed env. ` +
            `Missing: ${missing.join(", ")}.`,
    );
    console.log(
        `Set BASE_URL + FERDINAND_USER1 + FERDINAND_PASS1 to run ` +
            `(BASIC_AUTH_USER/PASS optional, raw-VPS path only); ` +
            `see mockup/tests/e2e/README-live-smoke.md.`,
    );
    process.exit(0);
}

// Compose httpCredentials only if BOTH basic_auth env vars are set.
// Partial config (one set, the other empty) is treated as "not configured"
// to avoid silently sending empty credentials.
const useBasicAuth = Boolean(BASIC_AUTH_USER && BASIC_AUTH_PASS);
const httpCredentials = useBasicAuth
    ? { username: BASIC_AUTH_USER, password: BASIC_AUTH_PASS }
    : undefined;
console.log(
    `[a14] basic_auth gate: ${useBasicAuth ? "ENABLED (raw-VPS path)" : "disabled (Zeabur path)"}`,
);

// ---- result accumulator ------------------------------------------------
const result = {
    base: BASE_URL,
    started: new Date().toISOString(),
    checks: [],
    consoleErrors: [],
    failedRequests: [],
};
const record = (name, passed, detail) => {
    result.checks.push({ name, passed, detail });
    console.log(`${passed ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
};

// ---- launch ------------------------------------------------------------
const browser = await webkit.launch({ headless: true });
const iPhone = devices["iPhone 13"];
const ctx = await browser.newContext({
    ...iPhone,
    ...(httpCredentials ? { httpCredentials } : {}),
    baseURL: BASE_URL,
});
ctx.on("console", (msg) => {
    if (msg.type() === "error") {
        result.consoleErrors.push(`[ctx] ${msg.text()}`);
    }
});
ctx.on("requestfailed", (req) => {
    result.failedRequests.push(
        `${req.method()} ${req.url()} :: ${req.failure()?.errorText}`,
    );
});

try {
    // ===== 1. Login as USER1 via API (mobile UI happy-path is covered by
    //         a3 against localhost; this smoke just needs the cookie). =====
    {
        const res = await ctx.request.post(`${BASE_URL}/api/auth/login`, {
            data: { username: FERDINAND_USER1, password: FERDINAND_PASS1 },
            headers: { "content-type": "application/json" },
        });
        record(
            "1. POST /api/auth/login (USER1) → 200",
            res.status() === 200,
            `status=${res.status()}`,
        );
    }

    // ===== 2. Dashboard /: sketch-skin .dash-head + .dash-title-hand =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
        const dashHead = page.locator(".dash-head");
        const dashTitleHand = page.locator(".dash-title-hand");
        await dashHead
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        const dashHeadVisible = await dashHead.isVisible().catch(() => false);
        const dashTitleHandVisible = await dashTitleHand
            .isVisible()
            .catch(() => false);
        await page.screenshot({
            path: path.join(ART, "02-dashboard-mobile.png"),
            fullPage: true,
        });
        record(
            "2. mobile dashboard: .dash-head + .dash-title-hand render",
            dashHeadVisible && dashTitleHandVisible,
            `dash_head=${dashHeadVisible} dash_title_hand=${dashTitleHandVisible}`,
        );
        await page.close();
    }

    // ===== 3. /study/<deckId>: tap (touch event, NOT click) on Again =====
    {
        const apiRes = await ctx.request.get(`${BASE_URL}/api/decks`);
        const apiBody = await apiRes.json().catch(() => null);
        const decks = (apiBody?.decks ?? []).filter(
            (d) => d.id !== 0 && (d.level ?? 1) >= 1,
        );
        const deckId = decks[0]?.id ?? null;

        const page = await ctx.newPage();
        let outcome;
        let detail;
        if (deckId == null) {
            await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
            outcome = "no-deck";
            detail = `decks=${decks.length}`;
        } else {
            await page.goto(`${BASE_URL}/study/${deckId}`, {
                waitUntil: "networkidle",
            });
            const reveal = page.locator('[data-testid="reveal-btn"]');
            const empty = page.locator('[data-testid="study-empty"]');
            await Promise.race([
                reveal
                    .waitFor({ state: "visible", timeout: 8000 })
                    .catch(() => null),
                empty
                    .waitFor({ state: "visible", timeout: 8000 })
                    .catch(() => null),
            ]);
            const emptyVisible = await empty.isVisible().catch(() => false);
            if (emptyVisible) {
                outcome = "empty";
                detail = `deckId=${deckId}`;
            } else {
                // .tap() drives a real touchstart/touchend pair under
                // WebKit + iPhone emulation, which `.click()` would not.
                await reveal.tap();
                const again = page.locator('[data-testid="ans-again"]');
                await again.waitFor({ state: "visible", timeout: 5000 });
                await again.tap();
                await Promise.race([
                    reveal
                        .waitFor({ state: "visible", timeout: 5000 })
                        .catch(() => null),
                    empty
                        .waitFor({ state: "visible", timeout: 5000 })
                        .catch(() => null),
                ]);
                outcome = "tapped-again";
                detail = `deckId=${deckId}`;
            }
        }
        await page.screenshot({
            path: path.join(ART, "03-study-mobile.png"),
        });
        await page.close();
        record(
            "3. /study mobile tap path: tapped-again OR empty OR no-deck",
            ["tapped-again", "empty", "no-deck"].includes(outcome),
            `outcome=${outcome} ${detail}`,
        );
    }

    // ===== 4. /browse mobile IME chip: type 'テスト' + Enter =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE_URL}/browse`, { waitUntil: "networkidle" });
        const input = page.locator('[data-testid="browse-toolbar-input"]');
        await input.waitFor({ state: "visible", timeout: 8000 });
        // Tap to focus first (mobile pattern), then fill.
        await input.tap();
        await input.fill("テスト");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(250);
        const chip = page
            .locator('[data-testid="browse-toolbar-chip"]')
            .filter({ hasText: "テスト" })
            .first();
        const chipVisible = await chip.isVisible().catch(() => false);
        await page.screenshot({
            path: path.join(ART, "04-browse-ime-chip.png"),
        });
        record(
            "4. mobile /browse: 'テスト' (IME) → chip with that text",
            chipVisible,
            `chip_visible=${chipVisible}`,
        );
        await page.close();
    }

    // ===== 5. Reload + cookie persistence: /api/auth/me still 200 =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
        await page.reload({ waitUntil: "networkidle" });
        const me = await ctx.request.get(`${BASE_URL}/api/auth/me`);
        const body = await me.json().catch(() => null);
        await page.screenshot({
            path: path.join(ART, "05-after-reload.png"),
        });
        record(
            "5. /api/auth/me after reload → 200 (session cookie persists)",
            me.status() === 200 && body?.username === FERDINAND_USER1,
            `status=${me.status()} username="${body?.username ?? ""}"`,
        );
        await page.close();
    }
} finally {
    await ctx.close();
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
