#!/usr/bin/env node
// Phase A4-ε₂.a /stats frontend e2e — visual port of mockup/src/routes/stats/+page.svelte
// to the sketch-skin design system. Verifies the porting preserved the
// data layer (fetchStatsRecent + fetchAnswerButtons) and that the new
// sketch primitives (sketch-skin root + range pills + KPI 4-tile + bar
// chart SVG + answer-mix list) render. Range-switch behaviour is
// checked end-to-end so refactor regressions surface here, not in the
// user's first session.
//
// Scope (5 cases):
//   1. Authed /stats → sketch-skin root + stats-title + KPI 4-tile grid
//      (reviews / streak / avg / best) all visible
//   2. /api/stats/recent returns 200 + bars SVG renders (or graceful
//      empty-state shown when totalReviews === 0)
//   3. /api/stats/answer_buttons returns 200 + answer-mix list renders
//      with all 4 keys (or graceful empty-state shown when totalAns 0)
//   4. Click range pill `3M` → pill becomes active + a fresh
//      /api/stats/recent?days=90 request fires
//   5. Mobile (390×844) screenshot artifact captured
//
// + console errors and failed requests are collected suite-wide and
//   printed in the tail summary (a4/a6 convention: log, don't assert —
//   the auth bootstrap fires /api/auth/me before login so a 401 is
//   baseline noise, and favicon 404 lands on adapter-static builds).
//
// Pre-reqs:
//   * anki_server :40001 running with mockup/build/ embedded (rebuild
//     mockup before running so the new sketch-skin markup ships)
//   * FERDINAND_TEST_USER + FERDINAND_TEST_PASSWORD set so the suite can
//     authenticate via /api/auth/login. Empty password is a hard fail
//     like a1 / a2 / a3.
//   * design_handoff_ferdinand/screenshots/06-stats.png is the
//     reference image; we copy the actual capture to artifacts/ for
//     visual comparison but do NOT pixel-diff.
//
// Usage:
//   set -a; source .env; set +a
//   node mockup/tests/e2e/a8_stats_visual.mjs
//
// Exit 0 = all green; non-zero = at least one assertion failed
// (artifacts/a8_stats_visual/result.json + screenshots for triage).

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a8_stats_visual");
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

const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
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
    // ===== Authenticate once via /login form =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/login?next=%2Fstats`, {
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
            .waitForURL((u) => new URL(u).pathname === "/stats", {
                timeout: 8000,
            })
            .catch(() => null);
        await page.close();
    }

    // ===== 1. /stats sketch-skin root + title + 4 KPI tiles =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/stats`, { waitUntil: "networkidle" });
        // The KPI grid populates after fetchStatsRecent resolves —
        // wait for the streak tile (always rendered, even when empty)
        // before screenshotting.
        await page
            .locator('[data-testid="stats-tile-streak"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        await page.screenshot({
            path: path.join(ART, "01-stats-desktop.png"),
            fullPage: true,
        });
        const root = page.locator('[data-testid="stats-root"]');
        const title = page.locator('[data-testid="stats-title"]');
        const tiles = [
            "stats-tile-reviews",
            "stats-tile-streak",
            "stats-tile-avg",
            "stats-tile-best",
        ];
        const rootVisible = await root.isVisible().catch(() => false);
        const titleVisible = await title.isVisible().catch(() => false);
        const titleText = (await title.textContent().catch(() => "")) ?? "";
        const tileVis = await Promise.all(
            tiles.map((t) =>
                page
                    .locator(`[data-testid="${t}"]`)
                    .isVisible()
                    .catch(() => false),
            ),
        );
        const allTiles = tileVis.every(Boolean);
        record(
            "1. /stats sketch-skin root + title + 4 KPI tiles",
            rootVisible &&
                titleVisible &&
                titleText.toLowerCase().includes("statistics") &&
                allTiles,
            `root=${rootVisible} title=${titleVisible} title_text="${titleText.trim().slice(0, 40)}" tiles=[${tileVis.join(",")}]`,
        );
        await page.close();
    }

    // ===== 2. /api/stats/recent 200 + bars SVG (or empty-state) =====
    {
        const apiRes = await ctx.request.get(`${BASE}/api/stats/recent?days=30`);
        const apiBody = await apiRes.json().catch(() => null);
        const totalReviews = (apiBody?.history ?? []).reduce(
            (a, d) => a + (d?.reviews ?? 0),
            0,
        );

        const page = await ctx.newPage();
        await page.goto(`${BASE}/stats`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="stats-bars-panel"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        await page.waitForTimeout(300); // bars derive after history lands
        const svg = page.locator('[data-testid="stats-bars-svg"]');
        const empty = page.locator('[data-testid="stats-bars-empty"]');
        const svgVisible = await svg.isVisible().catch(() => false);
        const emptyVisible = await empty.isVisible().catch(() => false);
        const expectsSvg = totalReviews > 0;
        const passed =
            apiRes.status() === 200 &&
            (expectsSvg ? svgVisible : svgVisible || emptyVisible);
        record(
            "2. /api/stats/recent 200 + bars SVG (or empty-state)",
            passed,
            `api=${apiRes.status()} total_reviews=${totalReviews} svg_visible=${svgVisible} empty_visible=${emptyVisible}`,
        );
        await page.close();
    }

    // ===== 3. /api/stats/answer_buttons 200 + answer-mix list =====
    {
        const apiRes = await ctx.request.get(
            `${BASE}/api/stats/answer_buttons?days=30`,
        );
        const apiBody = await apiRes.json().catch(() => null);
        const totalAns =
            (apiBody?.again ?? 0) +
            (apiBody?.hard ?? 0) +
            (apiBody?.good ?? 0) +
            (apiBody?.easy ?? 0);

        const page = await ctx.newPage();
        await page.goto(`${BASE}/stats`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="stats-answer-panel"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        const list = page.locator('[data-testid="stats-answer-list"]');
        const empty = page.locator('[data-testid="stats-answer-empty"]');
        const listVisible = await list.isVisible().catch(() => false);
        const emptyVisible = await empty.isVisible().catch(() => false);
        const keyVis = await Promise.all(
            ["again", "hard", "good", "easy"].map((k) =>
                page
                    .locator(`[data-testid="stats-answer-${k}"]`)
                    .isVisible()
                    .catch(() => false),
            ),
        );
        const allKeys = keyVis.every(Boolean);
        const expectsList = totalAns > 0;
        const passed =
            apiRes.status() === 200 &&
            (expectsList ? listVisible && allKeys : listVisible || emptyVisible);
        record(
            "3. /api/stats/answer_buttons 200 + answer-mix list",
            passed,
            `api=${apiRes.status()} total_ans=${totalAns} list_visible=${listVisible} empty_visible=${emptyVisible} keys=[${keyVis.join(",")}]`,
        );
        await page.close();
    }

    // ===== 4. Range pill 3M switch fires fresh /api/stats/recent?days=90 =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/stats`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="stats-range-1M"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);

        // Wait for any in-flight fetches from the initial 1M load to
        // settle, then capture the next /api/stats/recent request the
        // pill click triggers.
        await page.waitForLoadState("networkidle");
        const recentReq = page.waitForRequest(
            (req) =>
                req.url().includes("/api/stats/recent") &&
                req.url().includes("days=90"),
            { timeout: 5000 },
        );
        await page.locator('[data-testid="stats-range-3M"]').click();
        const req = await recentReq.catch(() => null);
        const reqOk = !!req;

        // After the click + fetch settles, the active class should
        // have moved to the 3M pill.
        await page.waitForTimeout(300);
        const activeOn3M = await page
            .locator('[data-testid="stats-range-3M"]')
            .evaluate((el) => el.classList.contains("active"))
            .catch(() => false);
        const activeOn1M = await page
            .locator('[data-testid="stats-range-1M"]')
            .evaluate((el) => el.classList.contains("active"))
            .catch(() => true);

        record(
            "4. range pill 3M switches active + fires /api/stats/recent?days=90",
            reqOk && activeOn3M && !activeOn1M,
            `req_fired=${reqOk} active_3m=${activeOn3M} active_1m=${activeOn1M}`,
        );
        await page.close();
    }

    // ===== 5. Mobile screenshot (390×844) artifact =====
    {
        const page = await ctx.newPage();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${BASE}/stats`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="stats-root"]')
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        await page
            .locator('[data-testid="stats-tile-streak"]')
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        await page.waitForTimeout(400); // let bars + answer-mix paint
        await page.screenshot({
            path: path.join(ART, "05-stats-mobile.png"),
            fullPage: true,
        });
        const root = page.locator('[data-testid="stats-root"]');
        const rootVisible = await root.isVisible().catch(() => false);
        record(
            "5. mobile /stats captures screenshot artifact",
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
            "06-stats.png",
        );
        if (fs.existsSync(ref)) {
            fs.copyFileSync(
                ref,
                path.join(ART, "design-reference-06-stats.png"),
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
