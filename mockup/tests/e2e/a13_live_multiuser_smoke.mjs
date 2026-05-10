#!/usr/bin/env node
// a13_live_multiuser_smoke.mjs
// Phase B-test pre-write: runs against deployed instance, NOT localhost.
//
// Required env (all paths):
//   BASE_URL, FERDINAND_USER1, FERDINAND_PASS1, FERDINAND_USER2, FERDINAND_PASS2
// Optional env (raw-VPS path only — Caddy basic_auth gate):
//   BASIC_AUTH_USER, BASIC_AUTH_PASS
//
// Run (Zeabur path — no basic_auth gate):
//   BASE_URL=https://yourdomain.example.com \
//     FERDINAND_USER1=... FERDINAND_PASS1=... \
//     FERDINAND_USER2=... FERDINAND_PASS2=... \
//     node mockup/tests/e2e/a13_live_multiuser_smoke.mjs
//
// Run (raw-VPS path — basic_auth in front of the app):
//   BASE_URL=https://yourdomain.example.com \
//     BASIC_AUTH_USER=... BASIC_AUTH_PASS=... \
//     FERDINAND_USER1=... FERDINAND_PASS1=... \
//     FERDINAND_USER2=... FERDINAND_PASS2=... \
//     node mockup/tests/e2e/a13_live_multiuser_smoke.mjs
//
// See tests/e2e/README-live-smoke.md for full SOP.
//
// Scope (live multi-user smoke against deployed anki_server, with or
// without a Caddy basic_auth edge):
//   1. ctxA login (USER1) → 200 + cookie set
//   2. ctxB login (USER2) → 200 + cookie set (parallel)
//   3. ctxA /study/<deck>: empty-state OR card visible + click "Again" rating
//   4. ctxB /browse: search "test" → toolbar chip rendered
//   5. ctxB /notes/new: import-apkg toggle present + clickable (no upload)
//   6. cookie isolation: USER1 session cookie absent from ctxB and vice versa
//   7. ctxA logout + ctxB logout
//   8. /api/auth/me from BOTH contexts post-logout → 401
//
// Skip path: any of BASE_URL / FERDINAND_USER{1,2} / FERDINAND_PASS{1,2}
// missing → exit 0 with a clear "skipping live smoke" message so the file
// is safe to invoke from CI without leaking creds. BASIC_AUTH_* may be
// absent — that's the Zeabur-path happy case (no gateway-level auth).

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a13_live_multiuser_smoke");
fs.mkdirSync(ART, { recursive: true });

// ---- env --------------------------------------------------------------
const BASE_URL = process.env.BASE_URL || "";
const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER || "";
const BASIC_AUTH_PASS = process.env.BASIC_AUTH_PASS || "";
const FERDINAND_USER1 = process.env.FERDINAND_USER1 || "";
const FERDINAND_PASS1 = process.env.FERDINAND_PASS1 || "";
const FERDINAND_USER2 = process.env.FERDINAND_USER2 || "";
const FERDINAND_PASS2 = process.env.FERDINAND_PASS2 || "";
const CHROME = process.env.CHROME_EXECUTABLE || undefined;

// BASIC_AUTH_USER + BASIC_AUTH_PASS are OPTIONAL: only the raw-VPS Caddy
// edge enforces them. On Zeabur the platform gateway has no basic_auth gate,
// so absence here is the happy case. We only require BASE_URL + the two
// app-login pairs.
const REQUIRED = {
    BASE_URL,
    FERDINAND_USER1,
    FERDINAND_PASS1,
    FERDINAND_USER2,
    FERDINAND_PASS2,
};
const missing = Object.entries(REQUIRED)
    .filter(([, v]) => !v)
    .map(([k]) => k);
if (missing.length > 0) {
    console.log(
        `SKIP: a13_live_multiuser_smoke — live smoke requires deployed env. ` +
            `Missing: ${missing.join(", ")}.`,
    );
    console.log(
        `Set BASE_URL + FERDINAND_USER1/2 + FERDINAND_PASS1/2 to run ` +
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
    `[a13] basic_auth gate: ${useBasicAuth ? "ENABLED (raw-VPS path)" : "disabled (Zeabur path)"}`,
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
const browser = await chromium.launch({
    headless: true,
    ...(CHROME ? { executablePath: CHROME } : {}),
});

// Two contexts, optionally behind Caddy basic_auth (raw-VPS only). Each
// has an isolated cookie jar so we can prove session-cookie isolation
// per-user. On Zeabur, httpCredentials is undefined → context omits the
// Authorization header entirely.
const ctxA = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(httpCredentials ? { httpCredentials } : {}),
    baseURL: BASE_URL,
});
const ctxB = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(httpCredentials ? { httpCredentials } : {}),
    baseURL: BASE_URL,
});

const wireConsole = (ctx, label) => {
    ctx.on("console", (msg) => {
        if (msg.type() === "error") {
            result.consoleErrors.push(`[${label}] ${msg.text()}`);
        }
    });
};
wireConsole(ctxA, "ctxA");
wireConsole(ctxB, "ctxB");

async function apiLogin(ctx, username, password) {
    return ctx.request.post(`${BASE_URL}/api/auth/login`, {
        data: { username, password },
        headers: { "content-type": "application/json" },
    });
}

try {
    // ===== 1 + 2. Parallel login as USER1 (ctxA) and USER2 (ctxB) =====
    const [resA, resB] = await Promise.all([
        apiLogin(ctxA, FERDINAND_USER1, FERDINAND_PASS1),
        apiLogin(ctxB, FERDINAND_USER2, FERDINAND_PASS2),
    ]);
    record(
        "1. ctxA login as USER1 → 200",
        resA.status() === 200,
        `status=${resA.status()}`,
    );
    record(
        "2. ctxB login as USER2 → 200 (parallel)",
        resB.status() === 200,
        `status=${resB.status()}`,
    );

    // Sanity: confirm the per-context cookies are non-empty (proves the
    // login actually set a session cookie that Caddy passed through).
    const cookiesA = await ctxA.cookies(BASE_URL);
    const cookiesB = await ctxB.cookies(BASE_URL);
    const sessionA = cookiesA.find((c) =>
        /session|auth/i.test(c.name),
    )?.value;
    const sessionB = cookiesB.find((c) =>
        /session|auth/i.test(c.name),
    )?.value;

    // ===== 3. ctxA + ctxB run /study and /browse + /notes/new flows in parallel =====
    const studyTask = (async () => {
        // /api/decks to find a deck; pick the first non-zero, level≥1 deck.
        const apiRes = await ctxA.request.get(`${BASE_URL}/api/decks`);
        const apiBody = await apiRes.json().catch(() => null);
        const decks = (apiBody?.decks ?? []).filter(
            (d) => d.id !== 0 && (d.level ?? 1) >= 1,
        );
        const deckId = decks[0]?.id ?? null;
        const page = await ctxA.newPage();
        // Empty-state-tolerant: if no deck or no due cards, study-empty
        // becomes the success signal instead of ans-again.
        if (deckId == null) {
            await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
            await page.screenshot({
                path: path.join(ART, "03a-study-no-deck.png"),
            });
            await page.close();
            return {
                outcome: "no-deck",
                detail: `decks_count=${decks.length}`,
            };
        }
        await page.goto(`${BASE_URL}/study/${deckId}`, {
            waitUntil: "networkidle",
        });
        // Wait for either the reveal-btn (card present) OR study-empty.
        const reveal = page.locator('[data-testid="reveal-btn"]');
        const empty = page.locator('[data-testid="study-empty"]');
        await Promise.race([
            reveal.waitFor({ state: "visible", timeout: 8000 }).catch(() => null),
            empty.waitFor({ state: "visible", timeout: 8000 }).catch(() => null),
        ]);
        const emptyVisible = await empty.isVisible().catch(() => false);
        if (emptyVisible) {
            await page.screenshot({
                path: path.join(ART, "03b-study-empty.png"),
            });
            await page.close();
            return { outcome: "empty", detail: `deckId=${deckId}` };
        }
        // Show answer → click Again (rating 1).
        await reveal.click();
        const again = page.locator('[data-testid="ans-again"]');
        await again.waitFor({ state: "visible", timeout: 5000 });
        await again.click();
        // Wait for either next reveal-btn or empty state to indicate the
        // queue advanced.
        await Promise.race([
            reveal.waitFor({ state: "visible", timeout: 5000 }).catch(() => null),
            empty.waitFor({ state: "visible", timeout: 5000 }).catch(() => null),
        ]);
        await page.screenshot({
            path: path.join(ART, "03c-study-after-again.png"),
        });
        await page.close();
        return { outcome: "rated-again", detail: `deckId=${deckId}` };
    })();

    const browseTask = (async () => {
        const page = await ctxB.newPage();
        await page.goto(`${BASE_URL}/browse`, { waitUntil: "networkidle" });
        const input = page.locator('[data-testid="browse-toolbar-input"]');
        await input.waitFor({ state: "visible", timeout: 8000 });
        await input.click();
        await input.pressSequentially("test", { delay: 12 });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(200);
        const chip = page.locator('[data-testid="browse-toolbar-chip"]').first();
        const chipVisible = await chip.isVisible().catch(() => false);
        await page.screenshot({
            path: path.join(ART, "04-browse-search.png"),
        });
        await page.close();
        return { chipVisible };
    })();

    const importTask = (async () => {
        const page = await ctxB.newPage();
        await page.goto(`${BASE_URL}/notes/new`, { waitUntil: "networkidle" });
        const toggle = page.locator('[data-testid="import-apkg-toggle"]');
        const toggleVisible = await toggle
            .waitFor({ state: "visible", timeout: 5000 })
            .then(() => true)
            .catch(() => false);
        // Click toggle, but DO NOT upload anything — just confirm the
        // body region surfaces (file input becomes addressable).
        if (toggleVisible) await toggle.click();
        const body = page.locator('[data-testid="import-apkg-body"]');
        const bodyVisible = await body
            .waitFor({ state: "visible", timeout: 3000 })
            .then(() => true)
            .catch(() => false);
        await page.screenshot({
            path: path.join(ART, "05-import-toggle.png"),
        });
        await page.close();
        return { toggleVisible, bodyVisible };
    })();

    const [studyOut, browseOut, importOut] = await Promise.all([
        studyTask,
        browseTask,
        importTask,
    ]);
    record(
        "3. ctxA /study: card-rated OR empty-state OR no-deck handled",
        ["rated-again", "empty", "no-deck"].includes(studyOut.outcome),
        `outcome=${studyOut.outcome} ${studyOut.detail}`,
    );
    record(
        "4. ctxB /browse: 'test' search produced a toolbar chip",
        browseOut.chipVisible,
        `chip_visible=${browseOut.chipVisible}`,
    );
    record(
        "5. ctxB /notes/new: import-apkg toggle expands (no upload)",
        importOut.toggleVisible && importOut.bodyVisible,
        `toggle=${importOut.toggleVisible} body=${importOut.bodyVisible}`,
    );

    // ===== 6. Cookie isolation: ctxA's session cookie value not in ctxB =====
    const isolation =
        sessionA &&
        sessionB &&
        sessionA !== sessionB &&
        !cookiesB.some((c) => c.value === sessionA) &&
        !cookiesA.some((c) => c.value === sessionB);
    record(
        "6. session cookie isolation between ctxA and ctxB",
        Boolean(isolation),
        `sessionA_set=${Boolean(sessionA)} sessionB_set=${Boolean(sessionB)} ` +
            `equal=${sessionA === sessionB}`,
    );

    // ===== 7. Mutual logout =====
    const [logoutA, logoutB] = await Promise.all([
        ctxA.request.post(`${BASE_URL}/api/auth/logout`),
        ctxB.request.post(`${BASE_URL}/api/auth/logout`),
    ]);
    record(
        "7. ctxA + ctxB logout → 204",
        logoutA.status() === 204 && logoutB.status() === 204,
        `ctxA=${logoutA.status()} ctxB=${logoutB.status()}`,
    );

    // ===== 8. /api/auth/me 401 in both contexts post-logout =====
    const [meA, meB] = await Promise.all([
        ctxA.request.get(`${BASE_URL}/api/auth/me`),
        ctxB.request.get(`${BASE_URL}/api/auth/me`),
    ]);
    record(
        "8. /api/auth/me post-logout → 401 in both contexts",
        meA.status() === 401 && meB.status() === 401,
        `ctxA=${meA.status()} ctxB=${meB.status()}`,
    );
} finally {
    await ctxA.close();
    await ctxB.close();
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
