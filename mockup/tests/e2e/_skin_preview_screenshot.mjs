// Phase A4-α visual smoke-test screenshot. Captures /_skin_preview at
// desktop + mobile in light + dark themes so the user can review the
// kraft-paper aesthetic before approving Phase A4-β.
//
// IMPORTANT: This script is INTENTIONALLY temporary — delete in the
// Phase A4-β cleanup pass alongside the /_skin_preview route.

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.join(__dirname, "artifacts", "_skin_preview");
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

const BASE = process.env.MOCKUP_BASE ?? "http://localhost:5174";

async function shoot(page, file, viewport, prep = async () => {}) {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE}/_skin_preview`, { waitUntil: "networkidle" });
    await prep(page);
    // Give Google Fonts a beat to swap.
    await page.waitForTimeout(700);
    const out = path.join(ARTIFACTS_DIR, file);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`✓ ${file} (${viewport.width}x${viewport.height})`);
}

async function setTheme(page, target) {
    const btn = page.locator("#toggle-theme");
    await btn.waitFor({ state: "visible", timeout: 5000 });
    for (let i = 0; i < 3; i++) {
        const label = (await btn.textContent()) ?? "";
        if (label.toLowerCase().includes(target)) return;
        await btn.click();
        await page.waitForTimeout(120);
    }
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await shoot(page, "01-desktop-light.png", { width: 1280, height: 880 });
    await shoot(
        page,
        "02-desktop-dark.png",
        { width: 1280, height: 880 },
        (p) => setTheme(p, "dark"),
    );
    await shoot(page, "03-mobile-light.png", { width: 390, height: 844 });
    await shoot(
        page,
        "04-mobile-dark.png",
        { width: 390, height: 844 },
        (p) => setTheme(p, "dark"),
    );

    await browser.close();
    console.log(`\nartifacts dir: ${ARTIFACTS_DIR}`);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
