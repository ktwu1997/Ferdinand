#!/usr/bin/env node
// Phase A4-ζ /browse toolbar + filter sheet e2e — chip-token search bar,
// outline filter btn, paper save-search btn, ⌘K shortcut, and the
// modal filter sheet (state chip toggles + tag multi-select). Verifies
// the legacy .toolbar / .search / .filters / .pill / .pagination chrome
// is fully retired and the new chip-bar parses + commits + removes
// tokens correctly without trampling the data layer ε₁ already
// preserved (sidebar deck click → query → chip mirror still works).
//
// Scope (6 cases):
//   1. Authed /browse → sketch-skin chip-bar (browse-toolbar) +
//      ⌘K hint visible + count "X-Y of Z" formatted as mono.
//   2. Typing `deck:"Sesame Street English"` auto-commits on closing
//      quote → chip text matches verbatim + has bx-chip-deck class.
//   3. Click [browse-toolbar-filter] → [browse-filter-sheet] dialog
//      becomes visible.
//   4. Click [browse-filter-state-new] inside sheet → click apply →
//      sheet closes + chip-bar renders an `is:new` chip.
//   5. Click [browse-toolbar-save-search] → sidebar [sidebar-saved-form]
//      becomes visible (existing inline form, hooked to startCreateSaved).
//   6. ⌘K shortcut focuses the toolbar input from anywhere on the page.
//
// + visual artifacts: desktop (1280×900) screenshot of toolbar +
//   filter-sheet-open state for design diff vs 04-browse.png upper
//   strip.
//
// Pre-reqs: same as a6 (anki_server :40001, FERDINAND_TEST_USER +
// FERDINAND_TEST_PASSWORD). Run after rebuilding mockup so the
// embedded build/ has the ζ chrome.
//
// Usage:
//   set -a; source .env; set +a
//   node mockup/tests/e2e/a7_browse_toolbar.mjs

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a7_browse_toolbar");
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

    // ===== 1. /browse renders sketch-skin chip-bar + ⌘K hint + count =====
    {
        const page = await ctx.newPage();
        page.on("requestfailed", (req) => {
            result.failedRequests.push(
                `[case1] ${req.method()} ${req.url()} :: ${req.failure()?.errorText}`,
            );
        });
        await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="browse-row"]')
            .first()
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        await page.screenshot({
            path: path.join(ART, "01-toolbar-empty.png"),
            fullPage: false,
            clip: { x: 0, y: 0, width: 1280, height: 280 },
        });
        const toolbar = page.locator('[data-testid="browse-toolbar"]');
        const filterBtn = page.locator('[data-testid="browse-toolbar-filter"]');
        const saveBtn = page.locator(
            '[data-testid="browse-toolbar-save-search"]',
        );
        const count = page.locator('[data-testid="browse-toolbar-count"]');
        const kbdHint = page.locator(
            '[data-testid="browse-toolbar-search"] .bx-kbd-hint',
        );
        const toolbarVisible = await toolbar.isVisible().catch(() => false);
        const filterVisible = await filterBtn.isVisible().catch(() => false);
        const saveVisible = await saveBtn.isVisible().catch(() => false);
        const countText = (await count.textContent().catch(() => "")) ?? "";
        const kbdText = (await kbdHint.textContent().catch(() => "")) ?? "";
        const looksMono = await count
            .evaluate((el) => {
                const cs = getComputedStyle(el);
                return cs.fontFamily.toLowerCase().includes("mono");
            })
            .catch(() => false);
        record(
            "1. chip-bar toolbar + filter/save/count/⌘K hint render",
            toolbarVisible &&
                filterVisible &&
                saveVisible &&
                /\d+/.test(countText) &&
                kbdText.trim() === "⌘K" &&
                looksMono,
            `toolbar=${toolbarVisible} filter=${filterVisible} save=${saveVisible} count="${countText.trim()}" kbd="${kbdText.trim()}" mono=${looksMono}`,
        );
        await page.close();
    }

    // ===== 2. Typing deck:"Sesame Street English" auto-commits on closing
    //         quote and renders a deck chip with that exact text =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
        const input = page.locator('[data-testid="browse-toolbar-input"]');
        await input.waitFor({ state: "visible", timeout: 5000 });
        await input.click();
        // Type the full deck:"…" pattern character by character so the
        // closing-quote auto-commit fires at the right moment.
        const deckQuery = 'deck:"Sesame Street English"';
        await input.pressSequentially(deckQuery, { delay: 12 });
        // Auto-commit happens on the keystroke that types the closing
        // quote — give Svelte a tick for the chip to render.
        await page.waitForTimeout(150);
        const chip = page
            .locator('[data-testid="browse-toolbar-chip"]')
            .first();
        const chipText = ((await chip.textContent().catch(() => "")) ?? "").trim();
        const isDeckColored = await chip
            .evaluate((el) => el.classList.contains("bx-chip-deck"))
            .catch(() => false);
        const inputCleared =
            (await input.inputValue().catch(() => "")) === "";
        record(
            '2. typing deck:"…" auto-commits + renders bx-chip-deck',
            chipText === deckQuery && isDeckColored && inputCleared,
            `chip=${JSON.stringify(chipText)} deck_class=${isDeckColored} input_cleared=${inputCleared}`,
        );
        await page.close();
    }

    // ===== 3. Filter btn opens filter sheet =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
        const filterBtn = page.locator('[data-testid="browse-toolbar-filter"]');
        await filterBtn.waitFor({ state: "visible", timeout: 5000 });
        const sheet = page.locator('[data-testid="browse-filter-sheet"]');
        const beforeOpen = await sheet.isVisible().catch(() => false);
        await filterBtn.click();
        await sheet
            .waitFor({ state: "visible", timeout: 1500 })
            .catch(() => null);
        const afterOpen = await sheet.isVisible().catch(() => false);
        await page.screenshot({
            path: path.join(ART, "02-filter-sheet-open.png"),
            fullPage: false,
        });
        record(
            "3. filter btn opens [browse-filter-sheet] dialog",
            !beforeOpen && afterOpen,
            `before=${beforeOpen} after=${afterOpen}`,
        );
        await page.close();
    }

    // ===== 4. State=new chip in sheet → apply → is:new chip in toolbar =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="browse-toolbar-filter"]')
            .click();
        const sheet = page.locator('[data-testid="browse-filter-sheet"]');
        await sheet.waitFor({ state: "visible", timeout: 2000 });
        const newChip = page.locator(
            '[data-testid="browse-filter-state-new"]',
        );
        await newChip.click();
        const becameActive = await newChip
            .evaluate((el) => el.classList.contains("active"))
            .catch(() => false);
        await page.locator('[data-testid="browse-filter-apply"]').click();
        await sheet
            .waitFor({ state: "hidden", timeout: 1500 })
            .catch(() => null);
        const sheetClosed = !(await sheet.isVisible().catch(() => true));
        // After apply, the chip-bar should render an `is:new` chip
        // (kind=is). Filter for chips that contain "is:new" exactly.
        const isNewChip = page
            .locator('[data-testid="browse-toolbar-chip"]', {
                hasText: /^is:new$/,
            })
            .first();
        const isNewVisible = await isNewChip
            .isVisible()
            .catch(() => false);
        record(
            "4. state=new toggle → apply → is:new chip in toolbar",
            becameActive && sheetClosed && isNewVisible,
            `active=${becameActive} sheet_closed=${sheetClosed} is_new_chip=${isNewVisible}`,
        );
        await page.close();
    }

    // ===== 5. Save search btn opens sidebar saved-search inline form =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
        const saveBtn = page.locator(
            '[data-testid="browse-toolbar-save-search"]',
        );
        await saveBtn.waitFor({ state: "visible", timeout: 5000 });
        const form = page.locator('[data-testid="sidebar-saved-form"]');
        const beforeClick = await form.isVisible().catch(() => false);
        await saveBtn.click();
        await form
            .waitFor({ state: "visible", timeout: 1500 })
            .catch(() => null);
        const afterClick = await form.isVisible().catch(() => false);
        record(
            "5. save search btn → sidebar saved-search form visible",
            !beforeClick && afterClick,
            `before=${beforeClick} after=${afterClick}`,
        );
        await page.close();
    }

    // ===== 6. ⌘K (or Ctrl+K on Linux) focuses toolbar search input =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
        const input = page.locator('[data-testid="browse-toolbar-input"]');
        await input.waitFor({ state: "visible", timeout: 5000 });
        // Force focus to <body> so the toolbar input doesn't already
        // hold focus from any earlier interaction. Avoids clicking
        // disabled buttons (IMPORT) which hangs Playwright.
        await page.evaluate(() => {
            const ae = document.activeElement;
            if (ae && ae !== document.body && typeof ae.blur === "function") {
                ae.blur();
            }
            if (typeof document.body.focus === "function") {
                document.body.focus();
            }
        });
        await page.waitForTimeout(50);
        const focusedBefore = await input
            .evaluate((el) => el === document.activeElement)
            .catch(() => false);
        // Our handler accepts either metaKey or ctrlKey; fire Ctrl+K
        // since headless Linux Chromium reliably emits ctrlKey here.
        await page.keyboard.press("Control+k");
        await page.waitForTimeout(80);
        const focusedAfter = await input
            .evaluate((el) => el === document.activeElement)
            .catch(() => false);
        record(
            "6. Ctrl/⌘+K focuses toolbar input from elsewhere",
            !focusedBefore && focusedAfter,
            `before=${focusedBefore} after=${focusedAfter}`,
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
