#!/usr/bin/env node
// Phase A4-ε₂.b /notes/new frontend e2e — visual port of
// mockup/src/routes/notes/new/+page.svelte to the sketch-skin design
// system. Verifies the porting preserved the data layer (decks + notetypes
// fetch, dynamic fields, tag parsing, save gating) and that the new
// sketch primitives (sketch-skin root + hero + tri-strip toolbar +
// two-pane form/preview + mobile stack) render.
//
// Scope (6 cases, all read-only — no real notes created so this can run
// repeatedly without polluting the user's collection):
//   1. Authed /notes/new → sketch-skin root + hero + cancel/save buttons
//      visible; save defaults to disabled (first field empty)
//   2. /api/decks 200 + deck <select> populated with ≥ 1 option
//   3. /api/notetypes 200 + notetype <select> populated, "Basic" preferred
//      when present, dynamic field rows rendered for the active notetype
//   4. Typing into the first field flips canSubmit on (save enables) +
//      preview-primary echoes the value
//   5. Tags input parses on space + comma, preview-tags chip count
//      matches parsed token count
//   6. Mobile (390×844) screenshot artifact captured
//
// + console errors and failed requests are collected suite-wide and
//   printed in the tail summary (a8 convention: log, don't assert —
//   the auth bootstrap fires /api/auth/me before login so a 401 is
//   baseline noise, and favicon 404 lands on adapter-static builds).
//
// Pre-reqs:
//   * anki_server :40001 running with mockup/build/ embedded (rebuild
//     mockup before running so the new sketch-skin markup ships)
//   * FERDINAND_TEST_USER + FERDINAND_TEST_PASSWORD set so the suite can
//     authenticate via /api/auth/login. Empty password is a hard fail
//     like a1 / a2 / a3 / a8.
//   * design_handoff_ferdinand/screenshots/05-notes.png is the
//     reference image; we copy the actual capture to artifacts/ for
//     visual comparison but do NOT pixel-diff.
//
// Usage:
//   set -a; source .env; set +a
//   node mockup/tests/e2e/a9_notes_new_visual.mjs
//
// Exit 0 = all green; non-zero = at least one assertion failed
// (artifacts/a9_notes_new_visual/result.json + screenshots for triage).

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a9_notes_new_visual");
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
        await page.goto(`${BASE}/login?next=%2Fnotes%2Fnew`, {
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
            .waitForURL((u) => new URL(u).pathname === "/notes/new", {
                timeout: 8000,
            })
            .catch(() => null);
        await page.close();
    }

    // ===== 1. /notes/new sketch-skin root + hero + save defaults disabled =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/notes/new`, { waitUntil: "networkidle" });
        // Wait for either the form to render (decks+notetypes loaded) or
        // the form-loading placeholder. Either way the root must be present.
        await page
            .locator('[data-testid="notes-new-root"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        await page.screenshot({
            path: path.join(ART, "01-notes-new-desktop.png"),
            fullPage: true,
        });

        const root = page.locator('[data-testid="notes-new-root"]');
        const hero = page.locator('[data-testid="notes-new-hero"]');
        const cancel = page.locator('[data-testid="notes-new-cancel"]');
        const save = page.locator('[data-testid="notes-new-save"]');
        const title = page.locator('[data-testid="notes-new-title"]');

        const rootVisible = await root.isVisible().catch(() => false);
        const heroVisible = await hero.isVisible().catch(() => false);
        const cancelVisible = await cancel.isVisible().catch(() => false);
        const saveVisible = await save.isVisible().catch(() => false);
        const saveDisabled = await save.isDisabled().catch(() => false);
        const titleText =
            (await title.textContent().catch(() => "")) ?? "";

        record(
            "1. /notes/new sketch-skin root + hero + save disabled by default",
            rootVisible &&
                heroVisible &&
                cancelVisible &&
                saveVisible &&
                saveDisabled &&
                titleText.toLowerCase().includes("new note"),
            `root=${rootVisible} hero=${heroVisible} cancel=${cancelVisible} save=${saveVisible} save_disabled=${saveDisabled} title="${titleText.trim().slice(0, 32)}"`,
        );
        await page.close();
    }

    // ===== 2. /api/decks 200 + deck <select> populated =====
    {
        const apiRes = await ctx.request.get(`${BASE}/api/decks`);
        const apiBody = await apiRes.json().catch(() => null);
        const apiDeckCount = (apiBody?.decks ?? []).filter(
            (d) => d?.id !== 0 && (d?.level ?? 0) >= 1 && !d?.filtered,
        ).length;

        const page = await ctx.newPage();
        await page.goto(`${BASE}/notes/new`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="notes-new-deck-select"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);

        const select = page.locator('[data-testid="notes-new-deck-select"]');
        const selectVisible = await select.isVisible().catch(() => false);
        const optionCount = await select
            .locator("option")
            .count()
            .catch(() => 0);

        record(
            "2. /api/decks 200 + deck select populated",
            apiRes.status() === 200 &&
                selectVisible &&
                optionCount >= 1 &&
                // Allow off-by-one if server includes filtered/root decks
                // and the form filters them client-side.
                optionCount <= apiDeckCount + 2 &&
                optionCount >= apiDeckCount,
            `api=${apiRes.status()} api_decks=${apiDeckCount} select_visible=${selectVisible} option_count=${optionCount}`,
        );
        await page.close();
    }

    // ===== 3. /api/notetypes 200 + notetype select + dynamic field rows =====
    {
        const apiRes = await ctx.request.get(`${BASE}/api/notetypes`);
        const apiBody = await apiRes.json().catch(() => null);
        const apiNotetypes = apiBody?.notetypes ?? [];
        const apiBasic =
            apiNotetypes.find((n) => n?.name === "Basic") ?? apiNotetypes[0];
        const expectedFieldCount = apiBasic?.fields?.length ?? 0;

        const page = await ctx.newPage();
        await page.goto(`${BASE}/notes/new`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="notes-new-notetype-select"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);

        const ntSelect = page.locator(
            '[data-testid="notes-new-notetype-select"]',
        );
        const ntVisible = await ntSelect.isVisible().catch(() => false);
        const ntOptionCount = await ntSelect
            .locator("option")
            .count()
            .catch(() => 0);
        // Dynamic field rows mounted for the active notetype's
        // template — count them by data-testid prefix.
        const fieldRowCount = await page
            .locator('[data-testid^="notes-new-field-"]')
            .count()
            .catch(() => 0);

        record(
            "3. /api/notetypes 200 + notetype select + dynamic field rows",
            apiRes.status() === 200 &&
                ntVisible &&
                ntOptionCount >= 1 &&
                ntOptionCount === apiNotetypes.length &&
                fieldRowCount === expectedFieldCount,
            `api=${apiRes.status()} api_notetypes=${apiNotetypes.length} select_visible=${ntVisible} option_count=${ntOptionCount} field_rows=${fieldRowCount} expected_fields=${expectedFieldCount}`,
        );
        await page.close();
    }

    // ===== 4. Typing first field enables save + preview echoes the value =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/notes/new`, { waitUntil: "networkidle" });
        const f0 = page.locator('[data-testid="notes-new-field-0"] textarea');
        const save = page.locator('[data-testid="notes-new-save"]');
        const previewPrimary = page.locator(
            '[data-testid="notes-new-preview-primary"]',
        );
        const previewEmpty = page.locator(
            '[data-testid="notes-new-preview-empty"]',
        );

        await f0
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);

        const saveDisabledBefore = await save.isDisabled().catch(() => false);
        const emptyVisibleBefore = await previewEmpty
            .isVisible()
            .catch(() => false);

        await f0.fill("懐かしい");
        // Svelte 5 reactivity is synchronous in render but the DOM
        // batch-updates on the next microtask. A short wait is more
        // reliable than chained Promise.resolves on slow CI.
        await page.waitForTimeout(150);

        const saveDisabledAfter = await save.isDisabled().catch(() => true);
        const previewVisibleAfter = await previewPrimary
            .isVisible()
            .catch(() => false);
        const previewText =
            (await previewPrimary.textContent().catch(() => "")) ?? "";

        record(
            "4. typing field-0 enables save + preview echoes value",
            saveDisabledBefore &&
                emptyVisibleBefore &&
                !saveDisabledAfter &&
                previewVisibleAfter &&
                previewText.includes("懐かしい"),
            `save_before=${saveDisabledBefore} empty_before=${emptyVisibleBefore} save_after=${saveDisabledAfter} preview_visible=${previewVisibleAfter} preview_text="${previewText.trim().slice(0, 24)}"`,
        );
        await page.close();
    }

    // ===== 5. Tags input parses + preview chips render =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/notes/new`, { waitUntil: "networkidle" });
        const f0 = page.locator('[data-testid="notes-new-field-0"] textarea');
        const tagsInput = page.locator('[data-testid="notes-new-tags-input"]');

        await f0
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        // Need a value in field-0 so the preview-card renders (the empty
        // state hides preview-tags otherwise).
        await f0.fill("森林");
        await tagsInput.fill("vocab nature N2");
        await page.waitForTimeout(150);

        const previewTags = page.locator(
            '[data-testid="notes-new-preview-tags"]',
        );
        const previewTagsVisible = await previewTags
            .isVisible()
            .catch(() => false);
        const tagChipCount = await previewTags
            .locator("> *")
            .count()
            .catch(() => 0);
        const tagsHintText =
            (await page
                .locator(
                    '[data-testid="notes-new-tags-field"] .nx-field-hint',
                )
                .first()
                .textContent()
                .catch(() => "")) ?? "";

        record(
            "5. tags parse on whitespace + preview chips render",
            previewTagsVisible &&
                tagChipCount === 3 &&
                tagsHintText.includes("3 tag"),
            `preview_visible=${previewTagsVisible} chip_count=${tagChipCount} hint="${tagsHintText.trim().slice(0, 48)}"`,
        );
        await page.close();
    }

    // ===== 6. Mobile screenshot (390×844) artifact =====
    {
        const page = await ctx.newPage();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${BASE}/notes/new`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="notes-new-root"]')
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        // Let the form mount + preview pane stack below the form on
        // mobile before screenshotting.
        await page.waitForTimeout(400);
        await page.screenshot({
            path: path.join(ART, "06-notes-new-mobile.png"),
            fullPage: true,
        });
        const root = page.locator('[data-testid="notes-new-root"]');
        const rootVisible = await root.isVisible().catch(() => false);
        record(
            "6. mobile /notes/new captures screenshot artifact",
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
            "05-notes.png",
        );
        if (fs.existsSync(ref)) {
            fs.copyFileSync(
                ref,
                path.join(ART, "design-reference-05-notes.png"),
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
