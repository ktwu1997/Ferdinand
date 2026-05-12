#!/usr/bin/env node
// a14_live_iphone_safari_smoke.mjs
// Phase B-test pre-write: runs against deployed instance, NOT localhost.
// WebKit + iPhone 13 device emulation. Mobile-only smoke (touch/IME/cookie).
//
// ── WebKit-vs-chromium fallback note ────────────────────────────────────
// The PREFERRED engine is WebKit (real Safari rendering/JS engine), launched
// via Playwright's bundled `webkit`. Some sandboxes/CI images can't run it —
// `npx playwright install webkit` fails host-requirements validation, or
// `webkit.launch()` throws on missing system libraries. In that case this
// script FALLS BACK to chromium with `devices['iPhone 13']` emulation so the
// touch/IME/cookie flow still gets exercised. That fallback is NOT a true
// Safari run — Blink ≠ WebKit. A genuine Safari smoke needs an environment
// with WebKit's runtime deps installed (or a real macOS/iOS device). The
// chosen engine is logged at startup and recorded in result.json.
// ─────────────────────────────────────────────────────────────────────────
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

import { webkit, chromium, devices } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Optional override: A14_ENGINE=chromium forces the fallback engine without
// even attempting WebKit (useful when you already know WebKit is unavailable).
const FORCE_ENGINE = (process.env.A14_ENGINE || "").toLowerCase();

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
    engine: null, // "webkit" (preferred) | "chromium-iphone-emulation" (fallback)
    checks: [],
    consoleErrors: [],
    failedRequests: [],
};
const record = (name, passed, detail) => {
    result.checks.push({ name, passed, detail });
    console.log(`${passed ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry a thunk on a thrown error OR a 5xx-status result (Zeabur cold-start
// idle-sleep produces both), with linear backoff.
async function retryTransient(label, thunk, { tries = 4, baseMs = 1500 } = {}) {
    let lastErr;
    for (let i = 1; i <= tries; i++) {
        try {
            const out = await thunk();
            if (out && typeof out.status === "function" && out.status() >= 500) {
                if (i < tries) {
                    console.log(
                        `  [retry] ${label}: status ${out.status()} (attempt ${i}/${tries}), backing off…`,
                    );
                    await sleep(baseMs * i);
                    continue;
                }
            }
            return out;
        } catch (err) {
            lastErr = err;
            if (i < tries) {
                console.log(
                    `  [retry] ${label}: ${err?.message ?? err} (attempt ${i}/${tries}), backing off…`,
                );
                await sleep(baseMs * i);
                continue;
            }
        }
    }
    if (lastErr) throw lastErr;
}

// Best-effort warm-up against the cheap public /api/health endpoint.
async function warmUp(ctx, { tries = 8, baseMs = 2000 } = {}) {
    for (let i = 1; i <= tries; i++) {
        try {
            const res = await ctx.request.get(`${BASE_URL}/api/health`);
            if (res.status() === 200) {
                console.log(`[a14] warm-up: /api/health 200 on attempt ${i}`);
                return true;
            }
            console.log(
                `[a14] warm-up: /api/health ${res.status()} (attempt ${i}/${tries})`,
            );
        } catch (err) {
            console.log(
                `[a14] warm-up: ${err?.message ?? err} (attempt ${i}/${tries})`,
            );
        }
        if (i < tries) await sleep(baseMs);
    }
    console.log("[a14] warm-up: gave up polling /api/health — proceeding anyway");
    return false;
}

// ---- launch (prefer WebKit; fall back to chromium iPhone emulation) ----
async function launchEngine() {
    if (FORCE_ENGINE === "chromium") {
        console.log(
            "[a14] A14_ENGINE=chromium → using chromium iPhone-13 emulation (NOT a true Safari run)",
        );
        return {
            browser: await chromium.launch({ headless: true }),
            engine: "chromium-iphone-emulation",
        };
    }
    if (FORCE_ENGINE === "webkit") {
        console.log("[a14] A14_ENGINE=webkit → forcing WebKit (no fallback)");
        return { browser: await webkit.launch({ headless: true }), engine: "webkit" };
    }
    // Default: try WebKit first, fall back to chromium if it can't launch
    // (missing host libraries, browser binary not installed, …).
    try {
        const browser = await webkit.launch({ headless: true });
        console.log("[a14] engine: WebKit (real Safari engine) ✓");
        return { browser, engine: "webkit" };
    } catch (err) {
        console.log(
            `[a14] WebKit unavailable (${err?.message ?? err}).\n` +
                "[a14] FALLING BACK to chromium with devices['iPhone 13'] emulation.\n" +
                "[a14] NOTE: this is Blink, not WebKit — a true Safari smoke needs a\n" +
                "[a14]       different environment (WebKit runtime deps / real iOS device).",
        );
        return {
            browser: await chromium.launch({ headless: true }),
            engine: "chromium-iphone-emulation",
        };
    }
}

const { browser, engine } = await launchEngine();
result.engine = engine;
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
    // ===== 0. Warm-up: wake the (possibly idle-slept) container =====
    await warmUp(ctx);

    // ===== 1. Login as USER1 via API (mobile UI happy-path is covered by
    //         a3 against localhost; this smoke just needs the cookie). =====
    {
        const res = await retryTransient("login (USER1)", () =>
            ctx.request.post(`${BASE_URL}/api/auth/login`, {
                data: { username: FERDINAND_USER1, password: FERDINAND_PASS1 },
                headers: { "content-type": "application/json" },
            }),
        );
        record(
            "1. POST /api/auth/login (USER1) → 200",
            res.status() === 200,
            `status=${res.status()}`,
        );
    }

    // ===== 2. Dashboard /: sketch-skin .dash-head + .dash-title-hand =====
    {
        const page = await ctx.newPage();
        await retryTransient("goto /", () =>
            page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" }),
        );
        // At iPhone-13 width (390px ≤ 640px breakpoint) the dashboard renders
        // its `.dash-mobile` branch, NOT `.dash-desktop` — `.dash-head` /
        // `.dash-title-hand` live inside `.dash-desktop` (display:none here).
        // The mobile markup exposes `data-testid="dash-root"` plus `.m-sub` and
        // the `.m-deck-list` container. (There is no in-content `.m-head` brand
        // row anymore — the global MobileTopBar carries the brand on every route.)
        const dashRoot = page.locator('[data-testid="dash-root"]');
        await dashRoot
            .waitFor({ state: "visible", timeout: 12000 })
            .catch(() => null);
        const mSub = page.locator(".m-sub");
        const mDeckList = page.locator(".m-deck-list");
        const rootVisible = await dashRoot.isVisible().catch(() => false);
        const mSubVisible = await mSub.isVisible().catch(() => false);
        const mDeckListVisible = await mDeckList.isVisible().catch(() => false);
        // Sanity: the desktop branch must NOT be visible on a phone viewport.
        const dashDesktopVisible = await page
            .locator(".dash-desktop")
            .isVisible()
            .catch(() => false);
        await page.screenshot({
            path: path.join(ART, "02-dashboard-mobile.png"),
            fullPage: true,
        });
        record(
            "2. mobile dashboard: dash-root + .m-sub + .m-deck-list render (desktop branch hidden)",
            rootVisible &&
                mSubVisible &&
                mDeckListVisible &&
                !dashDesktopVisible,
            `root=${rootVisible} m_sub=${mSubVisible} ` +
                `m_deck_list=${mDeckListVisible} desktop_hidden=${!dashDesktopVisible}`,
        );
        await page.close();
    }

    // ===== 3. /study/<deckId>: tap (touch event, NOT click) on Again =====
    {
        const apiRes = await retryTransient("GET /api/decks", () =>
            ctx.request.get(`${BASE_URL}/api/decks`),
        );
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
            // /study fans out to /api/deck_config* + /api/fsrs/* — cold-start
            // 5xx culprits, so retry the navigation.
            await retryTransient(`goto /study/${deckId}`, () =>
                page.goto(`${BASE_URL}/study/${deckId}`, {
                    waitUntil: "networkidle",
                }),
            );
            const reveal = page.locator('[data-testid="reveal-btn"]');
            const empty = page.locator('[data-testid="study-empty"]');
            const errBanner = page.locator('[data-testid="study-error"]');
            await Promise.race([
                reveal
                    .waitFor({ state: "visible", timeout: 12000 })
                    .catch(() => null),
                empty
                    .waitFor({ state: "visible", timeout: 12000 })
                    .catch(() => null),
                errBanner
                    .waitFor({ state: "visible", timeout: 12000 })
                    .catch(() => null),
            ]);
            // Cold-start error banner → wait + reload once before deciding.
            if (await errBanner.isVisible().catch(() => false)) {
                console.log("  [study] error banner visible — reloading once");
                await sleep(2500);
                await page.reload({ waitUntil: "networkidle" }).catch(() => null);
                await Promise.race([
                    reveal
                        .waitFor({ state: "visible", timeout: 12000 })
                        .catch(() => null),
                    empty
                        .waitFor({ state: "visible", timeout: 12000 })
                        .catch(() => null),
                ]);
            }
            const emptyVisible = await empty.isVisible().catch(() => false);
            // Queue-exhausted edge: fetchQueue returned 0 cards → study page
            // shows neither study-empty (needs sessionStartedWith>0) nor an
            // enabled reveal-btn (disabled while !currentCard). A visible-but-
            // disabled reveal-btn is the "nothing to study" signal.
            const revealVisible = await reveal.isVisible().catch(() => false);
            const revealEnabled = revealVisible
                ? await reveal.isEnabled().catch(() => false)
                : false;
            if (emptyVisible) {
                outcome = "empty";
                detail = `deckId=${deckId}`;
            } else if (revealVisible && !revealEnabled) {
                outcome = "empty-queue";
                detail = `deckId=${deckId}`;
            } else {
                // .tap() drives a real touchstart/touchend pair under WebKit +
                // iPhone emulation (and chromium with hasTouch from the
                // iPhone-13 device descriptor), which `.click()` would not.
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
            "3. /study mobile tap path: tapped-again OR empty OR empty-queue OR no-deck",
            ["tapped-again", "empty", "empty-queue", "no-deck"].includes(outcome),
            `outcome=${outcome} ${detail}`,
        );
    }

    // ===== 4. /browse mobile IME chip: type 'テスト' + Enter =====
    {
        const page = await ctx.newPage();
        await retryTransient("goto /browse", () =>
            page.goto(`${BASE_URL}/browse`, { waitUntil: "networkidle" }),
        );
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
        await retryTransient("goto / (reload step)", () =>
            page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" }),
        );
        await page.reload({ waitUntil: "networkidle" });
        const me = await retryTransient("GET /api/auth/me", () =>
            ctx.request.get(`${BASE_URL}/api/auth/me`),
        );
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
} catch (err) {
    // A thrown error mid-flow (stale selector, transient 5xx outlasting the
    // retries, navigation timeout, …) must be RECORDED, never swallowed. The
    // summary then shows the partial run + this entry and the finally block
    // exits non-zero — which is the correct signal, not something to hide.
    const msg = err?.stack || err?.message || String(err);
    console.error(`\n!!! a14 flow aborted by thrown error:\n${msg}\n`);
    record("FLOW ABORTED (uncaught error mid-smoke)", false, msg.split("\n")[0]);
} finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    result.finished = new Date().toISOString();
    // This smoke has 5 named steps; fewer means the flow died early.
    const EXPECTED_STEPS = 5;
    result.summary = {
        total: result.checks.length,
        passed: result.checks.filter((c) => c.passed).length,
        failed: result.checks.filter((c) => !c.passed).length,
        expectedSteps: EXPECTED_STEPS,
        incomplete: result.checks.length < EXPECTED_STEPS,
    };
    fs.writeFileSync(
        path.join(ART, "result.json"),
        JSON.stringify(result, null, 2),
    );
    console.log(
        `\n=== engine=${result.engine} :: ${result.summary.passed}/${result.summary.total} passed (${result.summary.failed} failed) ===`,
    );
    if (result.engine !== "webkit") {
        console.log(
            "!!! ran on FALLBACK engine (chromium iPhone-13 emulation), NOT WebKit — not a true Safari run",
        );
    }
    if (result.summary.incomplete) {
        console.log(
            `!!! incomplete run: only ${result.checks.length}/${EXPECTED_STEPS} steps recorded — treating as FAILED`,
        );
    }
    if (result.consoleErrors.length) {
        console.log(`\nConsole errors (${result.consoleErrors.length}):`);
        for (const e of result.consoleErrors) console.log(`  ${e}`);
    }
    if (result.failedRequests.length) {
        console.log(`\nFailed requests (${result.failedRequests.length}):`);
        for (const r of result.failedRequests) console.log(`  ${r}`);
    }
    const ok = result.summary.failed === 0 && !result.summary.incomplete;
    process.exit(ok ? 0 : 1);
}
