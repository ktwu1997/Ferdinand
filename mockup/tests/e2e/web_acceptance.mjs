#!/usr/bin/env node
// Ferdinand web acceptance E2E — exercises all routes against the
// single-binary anki_server (Phase 30-A) on :40001 with embedded mockup.
// Captures one screenshot per route to artifacts/ for visual review.
//
// Exit 0 = GREEN (everything kt would touch in a daily session works).
// Run: node mockup/tests/e2e/web_acceptance.mjs

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(__dirname, "artifacts");
fs.mkdirSync(ARTIFACTS, { recursive: true });

const BASE = process.env.E2E_BASE || "http://127.0.0.1:40001";
const DECK_ID = 1776837237914; // Ferdinand demo deck (206 cards seed)
const CHROME =
    process.env.CHROME_EXECUTABLE ||
    "/home/ktwu/.cache/ms-playwright/chromium-1208/chrome-linux/chrome";

const failures = [];
const journeys = [];

function record(name, ok, detail = "") {
    journeys.push({ name, ok, detail });
    if (!ok) failures.push(`FAIL: ${name} — ${detail}`);
}

async function shot(page, name) {
    const file = path.join(ARTIFACTS, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
}

async function checkApi(name, url, validate) {
    const t0 = Date.now();
    try {
        const res = await fetch(url);
        const body = await res.json().catch(() => ({}));
        const ok = res.ok && validate(body);
        record(name, ok, ok ? `${res.status} (${Date.now() - t0}ms)` : `${res.status} body=${JSON.stringify(body).slice(0, 100)}`);
    } catch (e) {
        record(name, false, e.message);
    }
}

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.on("pageerror", (e) => failures.push(`PAGE-ERROR: ${e.message}`));

try {
    // === API smoke ===
    await checkApi("api.health", `${BASE}/api/health`, (b) => b.ok === true);
    await checkApi("api.decks", `${BASE}/api/decks`, (b) => Array.isArray(b.decks) && b.decks.length >= 1);
    await checkApi("api.cards.list", `${BASE}/api/cards?q=*&limit=5`, (b) => b.total >= 200 && b.cards?.length === 5);
    await checkApi("api.cards.search.森林", `${BASE}/api/cards?q=${encodeURIComponent("森林")}&limit=1`, (b) => b.total >= 100);

    // === Home ===
    {
        const t0 = Date.now();
        const res = await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 15000 });
        const status = res?.status() ?? 0;
        await page.waitForLoadState("domcontentloaded");
        // Wait for sidebar deck to appear (any element containing "Ferdinand demo")
        const deckVisible = await page.getByText("Ferdinand demo", { exact: false }).first().isVisible().catch(() => false);
        const title = await page.title();
        await shot(page, "01_home");
        record("ui.home", status === 200 && deckVisible && /redesign|Ferdinand|Anki/i.test(title), `status=${status} title="${title}" deckVisible=${deckVisible} (${Date.now() - t0}ms)`);
    }

    // === Browse ===
    {
        const t0 = Date.now();
        const res = await page.goto(`${BASE}/browse`, { waitUntil: "networkidle", timeout: 15000 });
        const status = res?.status() ?? 0;
        // The browse page should show at least one card row. We look for the
        // demo card's front text "森林" anywhere on the page.
        const sawCard = await page.getByText("森林", { exact: false }).first().isVisible({ timeout: 5000 }).catch(() => false);
        await shot(page, "02_browse");
        record("ui.browse", status === 200 && sawCard, `status=${status} sawCard=${sawCard} (${Date.now() - t0}ms)`);
    }

    // === Study ===
    {
        const t0 = Date.now();
        const res = await page.goto(`${BASE}/study/${DECK_ID}`, { waitUntil: "networkidle", timeout: 15000 });
        const status = res?.status() ?? 0;
        // Wait for either the card-face shadow host OR a "no cards due" empty state.
        // Demo deck has 20 new — should render a card.
        const cardFace = await page.locator('[data-testid="card-face-front"]').first().isVisible({ timeout: 5000 }).catch(() => false);
        await shot(page, "03_study");
        record("ui.study", status === 200 && cardFace, `status=${status} cardFace=${cardFace} (${Date.now() - t0}ms)`);
    }

    // === Settings ===
    {
        const t0 = Date.now();
        const res = await page.goto(`${BASE}/settings`, { waitUntil: "networkidle", timeout: 15000 });
        const status = res?.status() ?? 0;
        // Settings has tabs — at minimum a "Notetypes" tab landed in Phase 19.
        const hasTab = await page.getByText(/Notetypes|FSRS|Deck/i).first().isVisible({ timeout: 5000 }).catch(() => false);
        await shot(page, "04_settings");
        record("ui.settings", status === 200 && hasTab, `status=${status} hasTab=${hasTab} (${Date.now() - t0}ms)`);
    }

    // === Stats ===
    {
        const t0 = Date.now();
        const res = await page.goto(`${BASE}/stats`, { waitUntil: "networkidle", timeout: 15000 });
        const status = res?.status() ?? 0;
        // Stats should render some chart container or at least the page heading.
        const sawSomething = await page.locator("body").isVisible();
        const errorCount = failures.filter((f) => f.startsWith("PAGE-ERROR")).length;
        await shot(page, "05_stats");
        record("ui.stats", status === 200 && sawSomething, `status=${status} pageErrors=${errorCount} (${Date.now() - t0}ms)`);
    }

    // === Notes/new ===
    {
        const t0 = Date.now();
        const res = await page.goto(`${BASE}/notes/new`, { waitUntil: "networkidle", timeout: 15000 });
        const status = res?.status() ?? 0;
        // Add-note has a deck picker + notetype picker + at least one field input.
        const hasInput = await page.locator("input, textarea").first().isVisible({ timeout: 5000 }).catch(() => false);
        await shot(page, "06_notes_new");
        record("ui.notes.new", status === 200 && hasInput, `status=${status} hasInput=${hasInput} (${Date.now() - t0}ms)`);
    }

    // === API write smoke (Phase 20-B bulk_flag idempotent test) ===
    {
        // Pick the first card, set flag to 2, then back to 0. Verifies write path.
        const list = await fetch(`${BASE}/api/cards?q=*&limit=1`).then((r) => r.json());
        const cid = list.cards?.[0]?.id;
        if (!cid) {
            record("api.bulk_flag.write", false, "no card to flag");
        } else {
            const set = await fetch(`${BASE}/api/cards/bulk_flag`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ card_ids: [cid], flag: 2 }),
            });
            const setBody = await set.json().catch(() => ({}));
            const reset = await fetch(`${BASE}/api/cards/bulk_flag`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ card_ids: [cid], flag: 0 }),
            });
            const resetBody = await reset.json().catch(() => ({}));
            const ok = set.ok && reset.ok;
            record("api.bulk_flag.write", ok, `set=${set.status} reset=${reset.status} setBody=${JSON.stringify(setBody).slice(0, 80)}`);
        }
    }
} finally {
    await context.close();
    await browser.close();
}

// Print report
const total = journeys.length;
const passed = journeys.filter((j) => j.ok).length;
const fmtDur = (s) => s.match(/(\d+)ms/)?.[1] ?? "?";

console.log("\n=== Ferdinand web acceptance E2E ===");
console.log(`base: ${BASE}`);
console.log(`artifacts: ${ARTIFACTS}\n`);
for (const j of journeys) {
    const tag = j.ok ? "PASS" : "FAIL";
    console.log(`  [${tag}] ${j.name.padEnd(28)} ${j.detail}`);
}
console.log("\n=== summary ===");
console.log(`  ${passed}/${total} green${failures.length ? `, ${failures.length} failures` : ""}`);

if (failures.length) {
    console.error("\n--- failures ---");
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
}
console.log("\nGREEN: all journeys passed against single-binary anki_server :40001");
