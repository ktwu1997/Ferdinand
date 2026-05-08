#!/usr/bin/env node
// Phase A4-δ /study/[deckId] frontend e2e — visual + behavioural port of
// mockup/src/routes/study/[deckId]/+page.svelte to the sketch-skin design
// system. Verifies that:
//   * the kraft-paper shell + card-paper index card render
//   * the data layer (fetchQueue → showAnswer → postAnswer) still runs
//     end-to-end against the live anki_server
//   * the Phase 20-A tag inline-edit lifecycle is preserved
//   * desktop + mobile screenshots land alongside design reference
//
// Scope (5 cases):
//   1. Authed /study/<id> renders sketch-skin root + deck name + counts
//   2. show-answer btn → click → back card face appears + 4 ans buttons
//   3. click "good" rating → next card appears OR "all caught up" empty
//   4. tag inline edit: click + add tag → input → fill + Enter → chip
//      lands in the strip (round-trip via /api/notes/<id> PATCH)
//   5. mobile (390×844) screenshot artifact alongside desktop screenshot,
//      both copied next to design_handoff_ferdinand/screenshots/03-study.png
//
// Pre-reqs:
//   * anki_server :40001 running with mockup/build/ embedded (rebuild
//     mockup before running so the new sketch-skin markup ships)
//   * FERDINAND_TEST_USER + FERDINAND_TEST_PASSWORD in .env
//   * design_handoff_ferdinand/screenshots/03-study.png is the reference;
//     copied to artifacts/ for manual visual diff (no pixel diff — kraft
//     palette + grain noise + rotation make pixel diffs noisy without
//     value)
//
// Usage:
//   set -a; source .env; set +a
//   node mockup/tests/e2e/a5_study_visual.mjs
//
// Exit 0 = all green; non-zero = at least one assertion failed
// (artifacts/a5_study_visual/result.json + screenshots for triage).
//
// Rate-limit gotcha: this suite makes 1 login + 4 navigations + 1
// answer post + 1 tag PATCH within ~30s. Anki_server's rate-limit is
// 5 req/60s on /api/auth/login but unauthenticated; the rest is
// authenticated (effectively unlimited). a3 right after a5 may need
// the usual 75s settle.

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a5_study_visual");
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

// We need a deck id with at least one due card to exercise the queue.
// The dashboard is the source of truth — pick the first deck card (the
// dashboard already uses fetchDecks → filters level≥1) so we don't have
// to second-guess the API shape here.
async function pickStudyableDeck(page) {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page
        .locator('[data-testid="deck-card"]')
        .first()
        .waitFor({ state: "visible", timeout: 8000 })
        .catch(() => null);
    const cards = page.locator('[data-testid="deck-card"]');
    const n = await cards.count();
    for (let i = 0; i < n; i += 1) {
        const id = await cards.nth(i).getAttribute("data-deck-id");
        const name = await cards.nth(i).getAttribute("data-deck-name");
        if (!id) continue;
        const queueRes = await ctx.request.get(
            `${BASE}/api/study/queue?deck_id=${encodeURIComponent(id)}&limit=1`,
        );
        if (queueRes.status() !== 200) continue;
        const body = await queueRes.json().catch(() => null);
        if (!body) continue;
        const total =
            (body.new ?? 0) + (body.learning ?? 0) + (body.review ?? 0);
        if (total > 0 && (body.cards ?? []).length > 0) {
            return { id, name, body };
        }
    }
    return null;
}

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

    // ===== Discover a deck with cards in queue =====
    const probePage = await ctx.newPage();
    const studyable = await pickStudyableDeck(probePage);
    await probePage.close();
    if (!studyable) {
        record(
            "0. study probe found a deck with ≥1 card in queue",
            false,
            "no deck had cards — empty-state path can't be exercised",
        );
        // Continue anyway; case 1 will fail loudly if there's truly no
        // study path available, which is a real signal for the operator.
    } else {
        record(
            "0. study probe found a deck with ≥1 card in queue",
            true,
            `id=${studyable.id} name="${studyable.name}" total=${(studyable.body.new ?? 0) + (studyable.body.learning ?? 0) + (studyable.body.review ?? 0)}`,
        );
    }
    const studyId = studyable?.id ?? "0";

    // ===== 1. /study/<id> renders sketch-skin root + deck name + counts =====
    {
        const page = await ctx.newPage();
        page.on("requestfailed", (req) => {
            result.failedRequests.push(
                `[case1] ${req.method()} ${req.url()} :: ${req.failure()?.errorText}`,
            );
        });
        await page.goto(`${BASE}/study/${studyId}`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="study-root"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        await page
            .locator('[data-testid="study-deck-name"]')
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        await page.screenshot({
            path: path.join(ART, "01-study-front-desktop.png"),
            fullPage: true,
        });
        const root = page.locator('[data-testid="study-root"]');
        const deckLabel = page.locator('[data-testid="study-deck-name"]');
        const counts = page.locator('[data-testid="study-counts"]');
        const reveal = page.locator('[data-testid="reveal-btn"]');
        const rootVisible = await root.isVisible().catch(() => false);
        const deckText = (await deckLabel.textContent().catch(() => "")) ?? "";
        const countsVisible = await counts.isVisible().catch(() => false);
        const revealVisible = await reveal.isVisible().catch(() => false);
        record(
            "1. /study/<id> renders sketch-skin root + deck name + reveal CTA",
            rootVisible && revealVisible && deckText.trim().length > 0,
            `root=${rootVisible} deck="${deckText.trim()}" counts=${countsVisible} reveal=${revealVisible}`,
        );
        await page.close();
    }

    // ===== 2. show answer → back face + 4 rating buttons =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/study/${studyId}`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="reveal-btn"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        await page.locator('[data-testid="reveal-btn"]').click();
        // Back face renders inside CardFace (shadow DOM); the wrapper
        // has its own data-testid so we can assert it without poking
        // into the shadow root.
        await page
            .locator('[data-testid="card-back-wrap"]')
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        await page.screenshot({
            path: path.join(ART, "02-study-back-desktop.png"),
            fullPage: true,
        });
        const backVisible = await page
            .locator('[data-testid="card-back-wrap"]')
            .isVisible()
            .catch(() => false);
        const answers = page.locator('[data-testid="answers"]');
        const answersVisible = await answers.isVisible().catch(() => false);
        const ansAgain = await page
            .locator('[data-testid="ans-again"]')
            .isVisible()
            .catch(() => false);
        const ansEasy = await page
            .locator('[data-testid="ans-easy"]')
            .isVisible()
            .catch(() => false);
        record(
            "2. show answer reveals back face + 4 rating buttons",
            backVisible && answersVisible && ansAgain && ansEasy,
            `back=${backVisible} answers=${answersVisible} again=${ansAgain} easy=${ansEasy}`,
        );
        await page.close();
    }

    // ===== 3. click "good" → postAnswer 200 → next card OR empty state =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/study/${studyId}`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="reveal-btn"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);
        await page.locator('[data-testid="reveal-btn"]').click();
        await page
            .locator('[data-testid="ans-good"]')
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);

        // Watch the postAnswer round-trip so we can confirm the data
        // layer is wired (not just the visuals). Post is one POST to
        // /api/answer — match by method + path so query strings don't
        // throw the regex off.
        const responseP = page
            .waitForResponse(
                (resp) =>
                    resp.url().includes("/api/study/answer") &&
                    resp.request().method() === "POST",
                { timeout: 5000 },
            )
            .catch(() => null);
        await page.locator('[data-testid="ans-good"]').click();
        const resp = await responseP;
        const respOk = resp ? resp.status() === 200 : false;

        // Either the next card's reveal-btn shows up again, or the deck
        // is exhausted and we land on the empty state. Both are valid.
        const revealBack = page.locator('[data-testid="reveal-btn"]');
        const emptyState = page.locator('[data-testid="study-empty"]');
        await Promise.race([
            revealBack.waitFor({ state: "visible", timeout: 4000 }).catch(() => null),
            emptyState.waitFor({ state: "visible", timeout: 4000 }).catch(() => null),
        ]);
        const advanced =
            (await revealBack.isVisible().catch(() => false)) ||
            (await emptyState.isVisible().catch(() => false));
        record(
            "3. click \"good\" posts answer and advances queue",
            respOk && advanced,
            `post_status=${resp?.status() ?? "n/a"} advanced=${advanced}`,
        );
        await page.close();
    }

    // ===== 4. tag inline edit — add tag round-trips through /api/notes =====
    {
        const page = await ctx.newPage();
        await page.goto(`${BASE}/study/${studyId}`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="tag-add-btn"]')
            .waitFor({ state: "visible", timeout: 8000 })
            .catch(() => null);

        const tagAddVisible = await page
            .locator('[data-testid="tag-add-btn"]')
            .isVisible()
            .catch(() => false);
        if (!tagAddVisible) {
            // tag-add-btn only renders in live mode with a current card.
            // If we got here without one, the previous case ran the
            // queue dry and there's nothing to tag — record the
            // condition rather than failing silently.
            record(
                "4. tag inline edit round-trips through /api/notes",
                false,
                "tag-add-btn not visible — no current card (queue dry)",
            );
        } else {
            await page.locator('[data-testid="tag-add-btn"]').click();
            await page
                .locator('[data-testid="tag-input"]')
                .waitFor({ state: "visible", timeout: 3000 })
                .catch(() => null);
            const stamp = `a5-${Date.now().toString(36)}`;
            const patchP = page
                .waitForResponse(
                    (resp) =>
                        /\/api\/notes\/\d+/.test(resp.url()) &&
                        resp.request().method() === "PATCH",
                    { timeout: 5000 },
                )
                .catch(() => null);
            await page.locator('[data-testid="tag-input"]').fill(stamp);
            await page.locator('[data-testid="tag-input"]').press("Enter");
            const patchResp = await patchP;
            const patchOk = patchResp ? patchResp.status() === 200 : false;

            // After commit, the tag-edit row should contain a chip with
            // the stamp value (mirrored back from server-canonical tags).
            // patchNote may normalize so we match by substring rather
            // than literal.
            await page.waitForTimeout(300);
            const editText =
                (await page
                    .locator('[data-testid="tag-edit"]')
                    .textContent()
                    .catch(() => "")) ?? "";
            const landed = editText.toLowerCase().includes(stamp.toLowerCase());
            record(
                "4. tag inline edit round-trips through /api/notes",
                patchOk && landed,
                `patch_status=${patchResp?.status() ?? "n/a"} landed=${landed} stamp="${stamp}"`,
            );
        }
        await page.close();
    }

    // ===== 5. Mobile screenshot artifact (visual diff against design) =====
    {
        const page = await ctx.newPage();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${BASE}/study/${studyId}`, { waitUntil: "networkidle" });
        await page
            .locator('[data-testid="study-root"]')
            .waitFor({ state: "visible", timeout: 5000 })
            .catch(() => null);
        await page.waitForTimeout(400);
        await page.screenshot({
            path: path.join(ART, "05-study-mobile.png"),
            fullPage: true,
        });
        const rootVisible = await page
            .locator('[data-testid="study-root"]')
            .isVisible()
            .catch(() => false);
        record(
            "5. mobile study captures screenshot artifact",
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
            "03-study.png",
        );
        if (fs.existsSync(ref)) {
            fs.copyFileSync(
                ref,
                path.join(ART, "design-reference-03-study.png"),
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
