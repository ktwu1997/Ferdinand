#!/usr/bin/env node
// Phase B3b apkg-import UI e2e — exercises the /notes/new
// <ImportApkgPanel/> against the live anki_server (BASE =
// http://127.0.0.1:40001 by default). Mirrors a9_notes_new_visual.mjs
// in shape but goes further than the form-render check: a real upload
// is sent through the panel's <input type="file"> and we wait for the
// server-derived success toast and /browse redirect.
//
// Cases:
//   1. /notes/new renders the import panel collapsed
//   2. clicking the toggle expands the body → drop zone + file input visible
//   3. setInputFiles(sample.apkg) → success toast → URL ends up /browse
//      and a deck containing "B3a sample" appears in /api/decks
//   4. setInputFiles(garbage.apkg) → inline error visible (no redirect)
//   5. mobile viewport (390x844): panel collapsible + drop zone visible
//      after expand (touch-target sanity for iPhone Safari emulation)
//
// Cleanup: at end of the suite we DELETE every deck whose name contains
// "B3a sample" so this suite can run repeatedly without bloating ktwu's
// collection or polluting the visual baselines that screenshot the
// browse pane (a4 / a6 / a8). Cleanup runs in `finally` so it still
// fires after assertion failures.
//
// Pre-reqs:
//   * anki_server :40001 running with mockup/build/ embedded (rebuild
//     mockup before running so the new ImportApkgPanel ships)
//   * FERDINAND_TEST_USER + FERDINAND_TEST_PASSWORD set so the suite can
//     authenticate via /api/auth/login
//   * mockup/tests/fixtures/sample.apkg present (regenerate via
//     `cargo run -p anki_server --example build_test_apkg --
//     mockup/tests/fixtures/sample.apkg` if missing — see a12 docstring)
//
// Usage:
//   set -a; source .env; set +a
//   node mockup/tests/e2e/a12b_apkg_import_ui.mjs
//
// Exit 0 = all green; non-zero = at least one assertion failed.

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a12b_apkg_import_ui");
fs.mkdirSync(ART, { recursive: true });

const BASE = process.env.E2E_BASE || "http://127.0.0.1:40001";
const TEST_USER = process.env.FERDINAND_TEST_USER || "ktwu";
const TEST_PASSWORD = process.env.FERDINAND_TEST_PASSWORD || "";
const CHROME =
    process.env.CHROME_EXECUTABLE ||
    "/home/ktwu/.cache/ms-playwright/chromium-1217/chrome-linux/chrome";

const APKG_FIXTURE = path.resolve(
    __dirname,
    "..",
    "fixtures",
    "sample.apkg",
);

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

// ---- helpers -----------------------------------------------------------

async function loginContext(ctx, dest = "/notes/new") {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login?next=${encodeURIComponent(dest)}`, {
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
        .waitForURL((u) => new URL(u).pathname === dest, { timeout: 8000 })
        .catch(() => null);
    await page.close();
}

async function makeGarbageFixture() {
    // Smaller than the real apkg + clearly not a zip; lets us assert the
    // server's import_apkg path returns 400 rather than mock the network.
    const garbagePath = path.join(ART, "garbage.apkg");
    fs.writeFileSync(garbagePath, "this is not a zip file ".repeat(8));
    return garbagePath;
}

async function deleteB3aSampleDecks(ctx) {
    // Best-effort cleanup. Works against the authed context's cookies.
    try {
        const apiRes = await ctx.request.get(`${BASE}/api/decks`);
        if (apiRes.status() !== 200) return;
        const body = await apiRes.json().catch(() => null);
        const decks = body?.decks ?? [];
        const targets = decks.filter(
            (d) =>
                typeof d?.name === "string" &&
                d.name.toLowerCase().includes("b3a sample"),
        );
        for (const d of targets) {
            await ctx.request
                .delete(`${BASE}/api/decks/${d.id}`)
                .catch(() => null);
        }
        result.cleanup = { matched: targets.length };
    } catch (e) {
        result.cleanup = { error: String(e) };
    }
}

// ---- main --------------------------------------------------------------

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
    await loginContext(ctx, "/notes/new");

    // ===== 1. /notes/new renders the import panel collapsed =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/notes/new`, { waitUntil: "networkidle" });
        const panel = page.locator('[data-testid="import-apkg-panel"]');
        const toggle = page.locator('[data-testid="import-apkg-toggle"]');
        const body = page.locator('[data-testid="import-apkg-body"]');

        const panelVisible = await panel
            .waitFor({ state: "visible", timeout: 5000 })
            .then(() => true)
            .catch(() => false);
        const toggleVisible = await toggle.isVisible().catch(() => false);
        const bodyHidden = (await body.count()) === 0;
        const ariaExpanded =
            (await toggle.getAttribute("aria-expanded").catch(() => "")) ?? "";

        await page.screenshot({
            path: path.join(ART, "01-panel-collapsed.png"),
            fullPage: true,
        });

        record(
            "1. import panel renders collapsed on /notes/new",
            panelVisible &&
                toggleVisible &&
                bodyHidden &&
                ariaExpanded === "false",
            `panel=${panelVisible} toggle=${toggleVisible} body_hidden=${bodyHidden} aria_expanded=${ariaExpanded}`,
        );
        await page.close();
    }

    // ===== 2. expanding the toggle reveals drop zone + file input =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/notes/new`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="import-apkg-toggle"]')
            .waitFor({ state: "visible", timeout: 5000 });
        await page.locator('[data-testid="import-apkg-toggle"]').click();

        const body = page.locator('[data-testid="import-apkg-body"]');
        const drop = page.locator('[data-testid="import-apkg-drop"]');
        const fileInput = page.locator('[data-testid="import-apkg-file-input"]');
        const bodyVisible = await body
            .waitFor({ state: "visible", timeout: 3000 })
            .then(() => true)
            .catch(() => false);
        const dropVisible = await drop.isVisible().catch(() => false);
        // The hidden file input is positioned off-screen, so isVisible
        // will report false — assert via DOM presence instead.
        const fileInputCount = await fileInput.count().catch(() => 0);

        await page.screenshot({
            path: path.join(ART, "02-panel-expanded.png"),
            fullPage: true,
        });

        record(
            "2. panel expands to reveal drop zone + file input",
            bodyVisible && dropVisible && fileInputCount === 1,
            `body=${bodyVisible} drop=${dropVisible} file_input_count=${fileInputCount}`,
        );
        await page.close();
    }

    // ===== 3. import a valid sample.apkg → success + /browse redirect =====
    {
        const fixtureExists = fs.existsSync(APKG_FIXTURE);
        if (!fixtureExists) {
            record(
                "3. valid .apkg → success toast + redirect to /browse",
                false,
                `fixture missing at ${APKG_FIXTURE}`,
            );
        } else {
            const page = await ctx.newPage();
            await page.goto(`${BASE}/notes/new`, { waitUntil: "networkidle" });
            await page
                .locator('[data-testid="import-apkg-toggle"]')
                .waitFor({ state: "visible", timeout: 5000 });
            await page.locator('[data-testid="import-apkg-toggle"]').click();
            await page
                .locator('[data-testid="import-apkg-file-input"]')
                .setInputFiles(APKG_FIXTURE);

            // Wait for either the success toast OR the redirect — the panel
            // sets a 1.5s timer between toast and goto("/browse"), so we
            // catch the toast first then verify the URL flips.
            const success = page.locator('[data-testid="import-apkg-success"]');
            const toastVisible = await success
                .waitFor({ state: "visible", timeout: 15000 })
                .then(() => true)
                .catch(() => false);

            const redirected = await page
                .waitForURL((u) => new URL(u).pathname === "/browse", {
                    timeout: 4000,
                })
                .then(() => true)
                .catch(() => false);

            await page.screenshot({
                path: path.join(ART, "03-after-import.png"),
                fullPage: true,
            });

            // Cross-check: a deck containing "B3a sample" exists.
            const decksRes = await ctx.request.get(`${BASE}/api/decks`);
            const decksBody = await decksRes.json().catch(() => null);
            const importedDeck = (decksBody?.decks ?? []).find((d) =>
                String(d?.name ?? "")
                    .toLowerCase()
                    .includes("b3a sample"),
            );

            record(
                "3. valid .apkg → success toast + redirect /browse + deck visible",
                toastVisible && redirected && Boolean(importedDeck),
                `toast=${toastVisible} redirected=${redirected} imported_deck=${importedDeck ? importedDeck.name : "<missing>"}`,
            );
            await page.close();
        }
    }

    // ===== 4. garbage bytes → inline error (no redirect) =====
    {
        const garbagePath = await makeGarbageFixture();
        const page = await ctx.newPage();
        await page.goto(`${BASE}/notes/new`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="import-apkg-toggle"]')
            .waitFor({ state: "visible", timeout: 5000 });
        await page.locator('[data-testid="import-apkg-toggle"]').click();
        await page
            .locator('[data-testid="import-apkg-file-input"]')
            .setInputFiles(garbagePath);

        const errorBox = page.locator('[data-testid="import-apkg-error"]');
        const errorVisible = await errorBox
            .waitFor({ state: "visible", timeout: 8000 })
            .then(() => true)
            .catch(() => false);
        const errorText =
            (await errorBox.textContent().catch(() => "")) ?? "";

        // Garbage path should NOT navigate away from /notes/new.
        const stillOnPage =
            new URL(page.url()).pathname === "/notes/new";

        await page.screenshot({
            path: path.join(ART, "04-error-state.png"),
            fullPage: true,
        });

        record(
            "4. garbage bytes → inline error visible, no redirect",
            errorVisible &&
                stillOnPage &&
                /400|invalid|error/i.test(errorText),
            `error_visible=${errorVisible} on_page=${stillOnPage} error_text="${errorText.trim().slice(0, 64)}"`,
        );
        await page.close();
    }

    // ===== 5. mobile viewport (iPhone-13-ish 390x844) usable =====
    {
        const page = await ctx.newPage();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${BASE}/notes/new`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="import-apkg-toggle"]')
            .waitFor({ state: "visible", timeout: 5000 });
        await page.screenshot({
            path: path.join(ART, "05-mobile-collapsed.png"),
            fullPage: true,
        });
        await page.locator('[data-testid="import-apkg-toggle"]').click();
        const drop = page.locator('[data-testid="import-apkg-drop"]');
        const dropVisible = await drop
            .waitFor({ state: "visible", timeout: 3000 })
            .then(() => true)
            .catch(() => false);
        const dropBox = await drop.boundingBox().catch(() => null);
        await page.screenshot({
            path: path.join(ART, "05-mobile-expanded.png"),
            fullPage: true,
        });

        // Sanity: the drop area should be wide enough for a touch target
        // on a 390px-wide viewport (the panel itself accounts for layout
        // padding). 240+px is comfortable for a thumb tap.
        const wideEnough = (dropBox?.width ?? 0) >= 240;

        record(
            "5. mobile (390x844): panel toggles + drop zone wide enough for tap",
            dropVisible && wideEnough,
            `drop_visible=${dropVisible} drop_width=${dropBox?.width ?? "?"}`,
        );
        await page.close();
    }
} finally {
    // Cleanup happens regardless of which case failed so the visual
    // baselines (a4 / a6 / a8) don't see a stale "B3a sample" deck.
    await deleteB3aSampleDecks(ctx);
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
    if (result.cleanup) {
        console.log(
            `\nCleanup: ${
                result.cleanup.error
                    ? `error=${result.cleanup.error}`
                    : `matched=${result.cleanup.matched ?? 0}`
            }`,
        );
    }
    process.exit(result.summary.failed > 0 ? 1 : 0);
}
