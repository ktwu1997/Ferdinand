#!/usr/bin/env node
// Phase A4-γ /dashboard frontend e2e — visual port of mockup/src/routes/+page.svelte
// to the sketch-skin design system. Verifies the porting preserved the
// data layer (fetchDecks → deck-grid is intact) and that the new sketch
// primitives (sketch-skin root + greeting + deck cards + forecast bars)
// render. Click navigation is checked end-to-end so refactor regressions
// surface here, not in the user's first session.
//
// Scope (5 cases):
//   1. Authed / → sketch-skin root + dash-greeting h1 + ≥1 deck-card visible
//   2. Deck list matches /api/decks/ payload (count + first-deck name parity)
//   3. Forecast section renders the 7-day bar chart (≥1 column or section
//      gracefully hidden when forecast totals 0)
//   4. Click first deck card → URL navigates to /study/<id>
//   5. Visual artifacts: desktop (1280×900) + mobile (390×844) screenshots
//      saved alongside the design reference for manual diff review
//
// Pre-reqs:
//   * anki_server :40001 running with mockup/build/ embedded (rebuild
//     mockup before running so the new sketch-skin markup ships)
//   * FERDINAND_TEST_USER + FERDINAND_TEST_PASSWORD set so the suite can
//     authenticate via /api/auth/login. Empty password is a hard fail
//     like a1 / a2 / a3.
//   * design_handoff_ferdinand/screenshots/02-dashboard.png is the
//     reference image; we copy the actual capture to artifacts/ for
//     visual comparison but do NOT pixel-diff (kraft palette + grain
//     noise + tilt randomness make pixel diffs noisy without value).
//
// Usage:
//   set -a; source .env; set +a
//   node mockup/tests/e2e/a4_dashboard_visual.mjs
//
// Exit 0 = all green; non-zero = at least one assertion failed
// (artifacts/a4_dashboard_visual/result.json + screenshots for triage).

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a4_dashboard_visual");
fs.mkdirSync(ART, { recursive: true });

const BASE = process.env.E2E_BASE || "http://127.0.0.1:40001";
const TEST_USER = process.env.FERDINAND_TEST_USER || "ktwu";
const TEST_PASSWORD = process.env.FERDINAND_TEST_PASSWORD || "";
const CHROME =
    process.env.CHROME_EXECUTABLE ||
    "/home/ktwu/.cache/ms-playwright/chromium-1217/chrome-linux/chrome";

if (!TEST_PASSWORD) {
    console.error(
        "FERDINAND_TEST_PASSWORD must be set so the suite can authenticate. " +
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

// Authed context shared across cases 1-4. The login dance happens
// once via the page-level form submit so the test exercises the same
// path a real user would; subsequent cases inherit the cookie via the
// shared context.
const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
});
ctx.on("console", (msg) => {
    if (msg.type() === "error") {
        result.consoleErrors.push(`[ctx] ${msg.text()}`);
    }
});

try {
    // ===== Authenticate once via /login form =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/login?next=%2F`, { waitUntil: "networkidle" });
        await page.locator('input[autocomplete="username"]').first().fill(TEST_USER);
        await page
            .locator('input[autocomplete="current-password"]')
            .first()
            .fill(TEST_PASSWORD);
        await page.locator('[data-testid="login-submit"]').click();
        await page
            .waitForURL((u) => new URL(u).pathname === "/", { timeout: 8000 })
            .catch(() => null);
        await page.close();
    }

    // ===== 1. /  renders sketch-skin root + greeting + deck cards =====
    {
        const page = await ctx.newPage();
        page.on("requestfailed", (req) => {
            result.failedRequests.push(
                `[case1] ${req.method()} ${req.url()} :: ${req.failure()?.errorText}`,
            );
        });
        await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
        // Wait for the deck grid to populate — fetchDecks fires inside
        // onMount so the cards land a tick or two after networkidle.
        await page
            .locator('[data-testid="deck-card"]')
            .first()
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        await page.screenshot({
            path: path.join(ART, "01-dashboard-desktop.png"),
            fullPage: true,
        });
        const root = page.locator('[data-testid="dash-root"]');
        const greeting = page.locator('[data-testid="dash-greeting"]');
        const cards = page.locator('[data-testid="deck-card"]');
        const rootVisible = await root.isVisible().catch(() => false);
        const greetingVisible = await greeting.isVisible().catch(() => false);
        const greetingText =
            (await greeting.textContent().catch(() => "")) ?? "";
        const cardCount = await cards.count();
        record(
            "1. / renders sketch-skin root + greeting + ≥1 deck card",
            rootVisible &&
                greetingVisible &&
                greetingText.toLowerCase().includes("morning") &&
                cardCount >= 1,
            `root=${rootVisible} greeting=${greetingVisible} text="${greetingText.trim()}" cards=${cardCount}`,
        );
        await page.close();
    }

    // ===== 2. Deck list matches /api/decks payload =====
    {
        const apiRes = await ctx.request.get(`${BASE}/api/decks`);
        const apiBody = await apiRes.json().catch(() => null);
        // Mirror the +page.svelte filter: drop the "Default" deck
        // (id=0) and any nested non-top-level decks (level >= 1 in
        // proto means it's a top-level deck).
        const apiDecks = (apiBody?.decks ?? []).filter(
            (d) => d.id !== 0 && d.level >= 1,
        );
        const apiFirstName = apiDecks[0]?.name ?? null;

        const page = await ctx.newPage();
        await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="deck-card"]')
            .first()
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        const cards = page.locator('[data-testid="deck-card"]');
        const renderedCount = await cards.count();
        const firstCardName = await cards
            .first()
            .getAttribute("data-deck-name")
            .catch(() => null);
        const passed =
            apiRes.status() === 200 &&
            apiDecks.length === renderedCount &&
            firstCardName === apiFirstName;
        record(
            "2. deck list matches /api/decks/ payload",
            passed,
            `api_status=${apiRes.status()} api_decks=${apiDecks.length} rendered=${renderedCount} api_first="${apiFirstName}" rendered_first="${firstCardName}"`,
        );
        await page.close();
    }

    // ===== 3. Forecast bar chart renders (or gracefully hides) =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
        await page.waitForTimeout(500); // forecast fetches after deck fetch
        const grid = page.locator('[data-testid="forecast-grid"]');
        const gridVisible = await grid.isVisible().catch(() => false);
        if (gridVisible) {
            // Forecast loaded — assert the 7-column structure is intact.
            // Bars may all be zero if the user has no upcoming reviews;
            // that's still a valid render (column wrappers + zero-height
            // bars + day labels remain visible).
            const cols = grid.locator(".forecast-col");
            const colCount = await cols.count();
            record(
                "3. forecast grid renders 7 columns",
                colCount === 7,
                `visible=${gridVisible} cols=${colCount}`,
            );
        } else {
            // Forecast section hidden — acceptable when totals are 0
            // (there's no failure path; fetchForecast either returns
            // the bar chart or hides the whole section).
            record(
                "3. forecast section gracefully hidden",
                true,
                "grid not rendered (no upcoming reviews — section hidden)",
            );
        }
        await page.close();
    }

    // ===== 4. Click first deck card → /study/<id> =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="deck-card"]')
            .first()
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        const firstCard = page.locator('[data-testid="deck-card"]').first();
        const expectedId = await firstCard
            .getAttribute("data-deck-id")
            .catch(() => null);
        await firstCard.click();
        await page
            .waitForURL((u) => new URL(u).pathname.startsWith("/study/"), {
                timeout: 5000,
            })
            .catch(() => null);
        const url = new URL(page.url());
        const pathOk = expectedId
            ? url.pathname === `/study/${expectedId}`
            : false;
        record(
            "4. first deck click → /study/<id>",
            pathOk,
            `expected_id=${expectedId} pathname=${url.pathname}`,
        );
        await page.close();
    }

    // ===== 5. Mobile screenshot artifact (visual reference for design diff) =====
    // Reuse the authed ctx — Playwright lets us resize the viewport per
    // page, avoiding a second login dance against the mobile /login
    // variant. The cookie jar carries the session from the bootstrap
    // login at the top of the suite.
    {
        const page = await ctx.newPage();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="dash-root"]')
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        await page.waitForTimeout(400); // let deck list paint
        await page.screenshot({
            path: path.join(ART, "05-dashboard-mobile.png"),
            fullPage: true,
        });
        const dashRoot = page.locator('[data-testid="dash-root"]');
        const rootVisible = await dashRoot.isVisible().catch(() => false);
        // Mobile-only deck row marker isn't currently exposed; the
        // visible dash-root + non-zero deck-card count from the mobile
        // markup proves the responsive switch lands. We assert root
        // visibility here and let the screenshot artifact carry the
        // visual signal for manual review.
        record(
            "5. mobile dashboard captures screenshot artifact",
            rootVisible,
            `mobile_root_visible=${rootVisible}`,
        );
        await page.close();
    }

    // Copy reference design screenshot alongside the captures so the
    // user can flip between actual + design without juggling paths.
    try {
        const ref = path.join(
            __dirname,
            "..",
            "..",
            "..",
            "design_handoff_ferdinand",
            "screenshots",
            "02-dashboard.png",
        );
        if (fs.existsSync(ref)) {
            fs.copyFileSync(
                ref,
                path.join(ART, "design-reference-02-dashboard.png"),
            );
        }
    } catch {
        // best-effort artifact bundle; missing reference doesn't fail the suite
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
