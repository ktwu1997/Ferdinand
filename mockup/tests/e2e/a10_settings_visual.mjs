#!/usr/bin/env node
// Phase A4-ε₂.c /settings frontend e2e — visual port of
// mockup/src/routes/settings/+page.svelte to the sketch-skin design
// system (.tx- prefix). Verifies the sub-sidebar nav + auth-aware
// account block + theme picker render, and that the preserved data
// layer (deck-config presets, FSRS, theme switching) still hits the
// real backend.
//
// Scope (6 cases, read-only — no presets created or destroyed; no
// destructive actions taken so the suite can run repeatedly without
// polluting the user's collection):
//   1. Authed /settings → sketch-skin root + hero + panel head visible
//      (default active section "fsrs")
//   2. Sub-sidebar nav renders all 8 sections + clicking one swaps
//      panel content + aria-current updates
//   3. /api/deck_configs 200 + preset <select> populated; /api/decks
//      doesn't break (auth bootstrap also pings /api/auth/me)
//   4. Theme picker swatch click flips themeChoice (radio reflects)
//   5. Account section shows auth.user.username + logout button
//      visible; "change password — coming soon" hint rendered
//   6. Mobile (390×844) screenshot artifact captured
//
// + console errors and failed requests collected suite-wide and printed
//   in tail summary (a8 convention: log, don't assert).
//
// Pre-reqs:
//   * anki_server :40001 running with mockup/build/ embedded (rebuild
//     mockup before running so the new sketch-skin markup ships)
//   * FERDINAND_TEST_USER + FERDINAND_TEST_PASSWORD set so the suite
//     can authenticate via /api/auth/login
//   * design_handoff_ferdinand/screenshots/07-settings.png is the
//     reference image; we copy the actual capture to artifacts/ for
//     visual comparison but do NOT pixel-diff
//
// Usage:
//   set -a; source .env; set +a
//   node mockup/tests/e2e/a10_settings_visual.mjs
//
// Exit 0 = all green; non-zero = at least one assertion failed.

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a10_settings_visual");
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
        await page.close();
    }

    // ===== 1. /settings sketch-skin root + hero + panel head =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="settings-root"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        await page.screenshot({
            path: path.join(ART, "01-settings-desktop.png"),
            fullPage: true,
        });

        const root = page.locator('[data-testid="settings-root"]');
        const hero = page.locator('[data-testid="settings-hero"]');
        const panel = page.locator('[data-testid="settings-panel"]');
        const panelTitle = page.locator(
            '[data-testid="settings-panel-title"]',
        );
        const sidebar = page.locator('[data-testid="settings-sidebar"]');
        const title = page.locator('[data-testid="settings-title"]');

        const rootVisible = await root.isVisible().catch(() => false);
        const heroVisible = await hero.isVisible().catch(() => false);
        const panelVisible = await panel.isVisible().catch(() => false);
        const sidebarVisible = await sidebar.isVisible().catch(() => false);
        const titleText =
            (await title.textContent().catch(() => "")) ?? "";
        const panelTitleText =
            (await panelTitle.textContent().catch(() => "")) ?? "";

        record(
            "1. /settings sketch-skin root + hero + sidebar + panel rendered",
            rootVisible &&
                heroVisible &&
                panelVisible &&
                sidebarVisible &&
                titleText.toLowerCase().includes("preferences") &&
                panelTitleText.toLowerCase().includes("fsrs"),
            `root=${rootVisible} hero=${heroVisible} panel=${panelVisible} sidebar=${sidebarVisible} title="${titleText.trim().slice(0, 32)}" panel_title="${panelTitleText.trim().slice(0, 32)}"`,
        );
        await page.close();
    }

    // ===== 2. Sub-sidebar nav renders all 8 sections + click swaps panel =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="settings-sidebar"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);

        const expectedSections = [
            "profile",
            "scheduling",
            "fsrs",
            "notetypes",
            "recovery",
            "sync",
            "appearance",
            "advanced",
        ];
        let allVisible = true;
        const visibilityPerSection = {};
        for (const id of expectedSections) {
            const v = await page
                .locator(`[data-testid="settings-nav-${id}"]`)
                .isVisible()
                .catch(() => false);
            visibilityPerSection[id] = v;
            if (!v) allVisible = false;
        }

        // Default active = fsrs → click "appearance" → panel-title flips
        const fsrsActiveBefore = await page
            .locator('[data-testid="settings-nav-fsrs"]')
            .getAttribute("aria-current")
            .catch(() => null);
        await page
            .locator('[data-testid="settings-nav-appearance"]')
            .click();
        await page.waitForTimeout(120);
        const appearanceActiveAfter = await page
            .locator('[data-testid="settings-nav-appearance"]')
            .getAttribute("aria-current")
            .catch(() => null);
        const panelTitleAfter =
            (await page
                .locator('[data-testid="settings-panel-title"]')
                .textContent()
                .catch(() => "")) ?? "";
        const themeCardVisible = await page
            .locator('[data-testid="settings-theme-card"]')
            .isVisible()
            .catch(() => false);

        record(
            "2. sidebar nav renders 8 sections + clicking appearance swaps panel",
            allVisible &&
                fsrsActiveBefore === "page" &&
                appearanceActiveAfter === "page" &&
                panelTitleAfter.toLowerCase().includes("appearance") &&
                themeCardVisible,
            `all_nav_visible=${allVisible} fsrs_aria_before=${fsrsActiveBefore} appearance_aria_after=${appearanceActiveAfter} panel_title_after="${panelTitleAfter.trim().slice(0, 32)}" theme_card=${themeCardVisible}`,
        );
        await page.close();
    }

    // ===== 3. /api/deck_config 200 + preset select populated =====
    {
        const apiRes = await ctx.request.get(`${BASE}/api/deck_config`);
        const apiBody = await apiRes.json().catch(() => null);
        const apiPresets = apiBody?.configs ?? [];

        const page = await ctx.newPage();
        await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="settings-preset-select"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);

        const select = page.locator(
            '[data-testid="settings-preset-select"]',
        );
        const selectVisible = await select.isVisible().catch(() => false);
        const optionCount = await select
            .locator("option")
            .count()
            .catch(() => 0);

        record(
            "3. /api/deck_config 200 + preset select populated",
            apiRes.status() === 200 &&
                selectVisible &&
                optionCount >= 1 &&
                optionCount === apiPresets.length,
            `api=${apiRes.status()} api_presets=${apiPresets.length} select_visible=${selectVisible} option_count=${optionCount}`,
        );
        await page.close();
    }

    // ===== 4. Theme picker swatch click flips themeChoice =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="settings-nav-appearance"]')
            .click();
        await page.waitForTimeout(120);
        await page
            .locator('[data-testid="settings-theme-card"]')
            .waitFor({ state: "visible", timeout: 4000 })
            .catch(() => null);

        // Click the dark swatch label (input has opacity:0; label is the
        // hit target). Use the label's input child for state assertion
        // because the input is the source of truth on the radio group.
        const darkOpt = page.locator(
            '[data-testid="settings-theme-dark"]',
        );
        const darkRadio = darkOpt.locator('input[type="radio"]');
        const darkCheckedBefore = await darkRadio
            .isChecked()
            .catch(() => false);
        await darkOpt.click();
        await page.waitForTimeout(150);
        const darkCheckedAfter = await darkRadio
            .isChecked()
            .catch(() => false);

        // Click back to light so the suite leaves the user's actual
        // preference unchanged. (themeChoice persists in localStorage,
        // so a stray dark click would survive the suite end.)
        const lightOpt = page.locator(
            '[data-testid="settings-theme-light"]',
        );
        await lightOpt.click();
        await page.waitForTimeout(120);
        const lightCheckedFinal = await lightOpt
            .locator('input[type="radio"]')
            .isChecked()
            .catch(() => false);

        record(
            "4. theme picker swatch click flips themeChoice + restores",
            !darkCheckedBefore && darkCheckedAfter && lightCheckedFinal,
            `dark_before=${darkCheckedBefore} dark_after=${darkCheckedAfter} light_final=${lightCheckedFinal}`,
        );
        await page.close();
    }

    // ===== 5. Account section shows auth.user.username + logout btn =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="settings-account-block"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);

        const accountRow = page.locator(
            '[data-testid="settings-account-row"]',
        );
        const accountName = page.locator(
            '[data-testid="settings-account-name"]',
        );
        const logoutBtn = page.locator(
            '[data-testid="settings-logout-btn"]',
        );

        const rowVisible = await accountRow.isVisible().catch(() => false);
        const logoutVisible = await logoutBtn.isVisible().catch(() => false);
        const nameText =
            (await accountName.textContent().catch(() => "")) ?? "";
        const blockText =
            (await page
                .locator('[data-testid="settings-account-block"]')
                .textContent()
                .catch(() => "")) ?? "";
        const comingSoon = blockText
            .toLowerCase()
            .includes("change password");

        record(
            "5. account section shows username + logout + change password coming-soon",
            rowVisible &&
                logoutVisible &&
                nameText.trim() === TEST_USER &&
                comingSoon,
            `row=${rowVisible} logout=${logoutVisible} name="${nameText.trim()}" expected="${TEST_USER}" coming_soon=${comingSoon}`,
        );
        await page.close();
    }

    // ===== 6. Mobile screenshot (390×844) artifact =====
    {
        const page = await ctx.newPage();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="settings-root"]')
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        // Let the sidebar collapse to single-column + the panel reflow
        // before screenshotting.
        await page.waitForTimeout(400);
        await page.screenshot({
            path: path.join(ART, "06-settings-mobile.png"),
            fullPage: true,
        });
        const root = page.locator('[data-testid="settings-root"]');
        const rootVisible = await root.isVisible().catch(() => false);
        record(
            "6. mobile /settings captures screenshot artifact",
            rootVisible,
            `mobile_root_visible=${rootVisible}`,
        );
        await page.close();
    }

    // Copy reference design screenshots alongside the captures so the
    // user can flip between actual + design without juggling paths.
    try {
        for (const ref of [
            "07-settings.png",
            "08-deck-options.png",
        ]) {
            const src = path.join(
                __dirname,
                "..",
                "..",
                "..",
                "design_handoff_ferdinand",
                "screenshots",
                ref,
            );
            if (fs.existsSync(src)) {
                fs.copyFileSync(
                    src,
                    path.join(ART, `design-reference-${ref}`),
                );
            }
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
