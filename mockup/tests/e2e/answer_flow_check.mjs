#!/usr/bin/env node
// One-off probe: does Study really record answers?
// Walks: /study/<deckId> → Show answer → Good → next card.
// Verifies via /api/decks counts that one card was actually answered.

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts");
fs.mkdirSync(ART, { recursive: true });

const BASE = process.env.E2E_BASE || "http://127.0.0.1:40001";
const DECK_ID = process.env.DECK_ID || "1777799312423"; // TOEIC::Cloze::L600 (37 due)
const CHROME =
    process.env.CHROME_EXECUTABLE ||
    "/home/ktwu/.cache/ms-playwright/chromium-1208/chrome-linux/chrome";

function dueOf(decks, id) {
    for (const d of decks) {
        if (d.id == id) return d.new_count + d.learn_count + d.review_count;
        if (d.children) {
            const v = dueOf(d.children, id);
            if (v != null) return v;
        }
    }
    return null;
}

async function deckCounts() {
    const r = await fetch(`${BASE}/api/decks`);
    const j = await r.json();
    return dueOf(j.decks, DECK_ID);
}

const beforeDue = await deckCounts();
console.log(`[probe] deck ${DECK_ID} due BEFORE: ${beforeDue}`);

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(`PAGE: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errs.push(`CONSOLE: ${m.text()}`); });

try {
    await page.goto(`${BASE}/study/${DECK_ID}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(ART, "answer_01_loaded.png"), fullPage: true });

    // 1. Look for "Show answer" reveal button
    const reveal = page.locator('button.reveal-btn, button:has-text("Show answer")').first();
    const revealVisible = await reveal.isVisible().catch(() => false);
    console.log(`[probe] reveal button visible: ${revealVisible}`);

    if (!revealVisible) {
        console.log(`[probe] FAIL — no reveal button found, dumping body`);
        const txt = await page.locator("body").innerText();
        console.log(txt.slice(0, 800));
        process.exit(2);
    }

    await reveal.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(ART, "answer_02_revealed.png"), fullPage: true });

    // 2. Answer "Good" (rating 3)
    const good = page.locator('button.ans-good, button[class*="good"]').first();
    const goodVisible = await good.isVisible().catch(() => false);
    console.log(`[probe] Good button visible after reveal: ${goodVisible}`);

    if (!goodVisible) {
        // try keyboard shortcut "3"
        await page.keyboard.press("3");
    } else {
        await good.click();
    }
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(ART, "answer_03_after_good.png"), fullPage: true });

    // 3. Verify backend count moved
    const afterDue = await deckCounts();
    console.log(`[probe] deck ${DECK_ID} due AFTER:  ${afterDue}`);
    const moved = afterDue !== beforeDue;
    console.log(`[probe] counts changed: ${moved} (delta ${beforeDue - afterDue})`);

    // 4. Check for errors surfaced in UI
    const errBanner = await page.locator('[class*="error"], [class*="lastError"]').first().textContent().catch(() => "");
    if (errBanner) console.log(`[probe] error banner: ${errBanner.slice(0, 200)}`);

    if (errs.length) {
        console.log(`[probe] page/console errors:`);
        errs.forEach((e) => console.log(`  ${e}`));
    }

    console.log(`\n[probe] RESULT: ${moved ? "GREEN — answer endpoint mutates state" : "RED — no state change after answer"}`);
    process.exit(moved ? 0 : 3);
} finally {
    await browser.close();
}
