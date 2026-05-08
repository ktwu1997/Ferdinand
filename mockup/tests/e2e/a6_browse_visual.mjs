#!/usr/bin/env node
// Phase A4-ε₁ /browse frontend e2e — visual port of mockup/src/routes/browse/+page.svelte
// to the sketch-skin design system. Verifies the porting preserved the
// data layer (deck tree click → query, sidebar deck list, state filters,
// row select/dblclick) and that the new sketch primitives (sketch-skin
// root + FerdinandMark brand + hand title + 7-col table) render. Click
// navigation is checked end-to-end so refactor regressions surface here,
// not in the user's first session.
//
// Scope (6 cases, ε₁ — sidebar + hero + table only; toolbar search
// chips + filter sheet remain on legacy chrome and ship in ζ):
//   1. Authed /browse → sketch-skin root + brand mark + hand title visible
//   2. Sidebar renders ≥1 sidebar-deck button + click sets query="deck:..."
//   3. State filter strip renders 4 buckets (new/learning/review/suspended)
//   4. Decks section caption toggles section open/closed (regression-safe)
//   5. Row click → first browse-row gains `.selected` (accent left-border)
//   6. Row dblclick on the rename-input pathway is alive (locator robustness)
//
// + visual artifacts: desktop (1280×900) and mobile (390×844) screenshots
//   saved alongside design_handoff_ferdinand/screenshots/04-browse.png
//   for manual diff review (kraft palette + grain noise + tilt randomness
//   make pixel diffs noisy without value).
//
// Pre-reqs:
//   * anki_server :40001 running with mockup/build/ embedded (rebuild
//     mockup before running so the new sketch-skin markup ships)
//   * FERDINAND_TEST_USER + FERDINAND_TEST_PASSWORD set so the suite can
//     authenticate via /api/auth/login. Empty password is a hard fail
//     like a1 / a2 / a3 / a4 / a5.
//
// Usage:
//   set -a; source .env; set +a
//   node mockup/tests/e2e/a6_browse_visual.mjs
//
// Exit 0 = all green; non-zero = at least one assertion failed
// (artifacts/a6_browse_visual/result.json + screenshots for triage).

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a6_browse_visual");
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

try {
    // ===== Authenticate once via /login form =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/login?next=%2Fbrowse`, {
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
            .waitForURL((u) => new URL(u).pathname === "/browse", {
                timeout: 8000,
            })
            .catch(() => null);
        await page.close();
    }

    // ===== 1. /browse renders sketch-skin root + brand + title =====
    {
        const page = await ctx.newPage();
        page.on("requestfailed", (req) => {
            result.failedRequests.push(
                `[case1] ${req.method()} ${req.url()} :: ${req.failure()?.errorText}`,
            );
        });
        await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
        // Wait for at least one row to land — fetchCards fires inside
        // onMount so the table populates a tick or two after networkidle.
        await page
            .locator('[data-testid="browse-row"]')
            .first()
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        await page.screenshot({
            path: path.join(ART, "01-browse-desktop.png"),
            fullPage: true,
        });
        const root = page.locator('[data-testid="browse-root"]');
        const sidebar = page.locator('[data-testid="browse-sidebar"]');
        const brand = page.locator('[data-testid="browse-brand"]');
        const title = page.locator('[data-testid="browse-title"]');
        const titleText = (await title.textContent().catch(() => "")) ?? "";
        const rootHasSketchSkin = await root
            .evaluate((el) => el.classList.contains("sketch-skin"))
            .catch(() => false);
        const handVisible = await page
            .locator('[data-testid="browse-title"] .hand')
            .isVisible()
            .catch(() => false);
        record(
            "1. /browse renders sketch-skin root + brand + hand title",
            rootHasSketchSkin &&
                (await sidebar.isVisible().catch(() => false)) &&
                (await brand.isVisible().catch(() => false)) &&
                titleText.toLowerCase().includes("browse") &&
                handVisible,
            `sketch-skin=${rootHasSketchSkin} title="${titleText.trim()}" hand=${handVisible}`,
        );
        await page.close();
    }

    // ===== 2. Sidebar deck buttons + click sets search query =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="sidebar-deck"]')
            .first()
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        const decks = page.locator('[data-testid="sidebar-deck"]');
        const deckCount = await decks.count();
        let queryAfterClick = "";
        let firstDeckName = "";
        if (deckCount > 0) {
            firstDeckName =
                (
                    await decks
                        .first()
                        .locator(".bx-deck-name")
                        .textContent()
                        .catch(() => "")
                )?.trim() ?? "";
            await decks.first().click();
            await page.waitForTimeout(250);
            queryAfterClick = await page
                .locator('.toolbar input[type="search"]')
                .inputValue();
        }
        const expected = `deck:"${firstDeckName}"`;
        record(
            "2. sidebar deck click sets query to deck:\"<name>\"",
            deckCount >= 1 && queryAfterClick === expected,
            `deck_count=${deckCount} clicked="${firstDeckName}" query=${JSON.stringify(queryAfterClick)}`,
        );
        await page.close();
    }

    // ===== 3. State filter strip renders 4 buckets =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
        const filters = page.locator('[data-testid="browse-state-filters"]');
        await filters
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        const newBtn = page.locator('[data-testid="sidebar-state-new"]');
        const learnBtn = page.locator(
            '[data-testid="sidebar-state-learning"]',
        );
        const reviewBtn = page.locator('[data-testid="sidebar-state-review"]');
        const suspBtn = page.locator(
            '[data-testid="sidebar-state-suspended"]',
        );
        const allFour =
            (await newBtn.isVisible()) &&
            (await learnBtn.isVisible()) &&
            (await reviewBtn.isVisible()) &&
            (await suspBtn.isVisible());
        record(
            "3. state filter strip renders 4 buckets",
            allFour,
            `new=${await newBtn.isVisible()} learning=${await learnBtn.isVisible()} review=${await reviewBtn.isVisible()} suspended=${await suspBtn.isVisible()}`,
        );
        await page.close();
    }

    // ===== 4. Decks section caption toggles open/closed =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
        const deckList = page.locator('[data-testid="browse-deck-list"]');
        await deckList
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        const visibleBefore = await deckList.isVisible().catch(() => false);
        // Click the // decks caption (button.bx-section-title containing
        // the Caption "decks") to collapse the deck list section.
        const decksToggle = page
            .locator("button.bx-section-title")
            .filter({ hasText: /decks/i })
            .first();
        await decksToggle.click();
        await page.waitForTimeout(150);
        const hiddenAfter = await deckList.isVisible().catch(() => false);
        await decksToggle.click();
        await page.waitForTimeout(150);
        const visibleAgain = await deckList.isVisible().catch(() => false);
        record(
            "4. decks section caption toggles open ↔ closed",
            visibleBefore && !hiddenAfter && visibleAgain,
            `before=${visibleBefore} hidden=${hiddenAfter} restored=${visibleAgain}`,
        );
        await page.close();
    }

    // ===== 5. Row click → first row gains .selected =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
        const firstRow = page.locator('[data-testid="browse-row"]').first();
        await firstRow
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        const rowBtn = firstRow.locator('[data-testid="browse-row-btn"]');
        await rowBtn.click();
        await page.waitForTimeout(200);
        const selectedClass = await firstRow
            .evaluate((el) => el.classList.contains("selected"))
            .catch(() => false);
        // Verify the accent left-border is the *visual* outcome of `.selected`,
        // by reading the computed border-left-width — should be ≥ 1px.
        const borderLeftPx = await firstRow
            .evaluate((el) => {
                const cs = getComputedStyle(el);
                return parseFloat(cs.borderLeftWidth || "0");
            })
            .catch(() => 0);
        record(
            "5. first row click → .selected class + accent left-border",
            selectedClass && borderLeftPx >= 1,
            `selected=${selectedClass} border_left_px=${borderLeftPx}`,
        );
        await page.close();
    }

    // ===== 6. Deck row dblclick → rename input opens (regression-safe) =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
        const firstDeck = page
            .locator('[data-testid="sidebar-deck"]')
            .first();
        await firstDeck
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        await firstDeck.dblclick();
        const renameInput = page.locator('input[aria-label="Rename deck"]');
        let renameVisible = false;
        try {
            await renameInput.waitFor({ state: "visible", timeout: 2000 });
            renameVisible = true;
        } catch {}
        if (renameVisible) {
            await page.keyboard.press("Escape");
            await page.waitForTimeout(150);
        }
        record(
            "6. sidebar deck dblclick opens rename input",
            renameVisible,
            `rename_input_visible=${renameVisible}`,
        );
        await page.close();
    }

    // ===== Mobile screenshot artifact (visual reference for design diff) =====
    {
        const page = await ctx.newPage();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="browse-root"]')
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        await page.waitForTimeout(400);
        await page.screenshot({
            path: path.join(ART, "02-browse-mobile.png"),
            fullPage: true,
        });
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
            "04-browse.png",
        );
        if (fs.existsSync(ref)) {
            fs.copyFileSync(
                ref,
                path.join(ART, "design-reference-04-browse.png"),
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
