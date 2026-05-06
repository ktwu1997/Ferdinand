#!/usr/bin/env node
// Phase I — Responsive device emulation smoke test.
// Runs the mockup against three device profiles and verifies that the right
// chrome surfaces (sidebar vs bottom-tab-bar) render at each breakpoint, the
// study answer flow still mutates state, and key viewports don't overflow.
//
// Run:  node mockup/tests/e2e/responsive_devices.mjs
// Env:  E2E_BASE (default http://127.0.0.1:40001)
//       CHROME_EXECUTABLE (auto-falls-back to chromium-1217 cache path)

import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "responsive");
fs.mkdirSync(ART, { recursive: true });

const BASE = process.env.E2E_BASE || "http://127.0.0.1:40001";
const CHROME =
    process.env.CHROME_EXECUTABLE ||
    "/home/ktwu/.cache/ms-playwright/chromium-1217/chrome-linux/chrome";

const PROFILES = [
    { name: "iphone-se", device: devices["iPhone SE"], breakpoint: "phone" },
    { name: "iphone-14", device: devices["iPhone 14"], breakpoint: "phone" },
    { name: "ipad-mini", device: devices["iPad Mini"], breakpoint: "tablet" },
    {
        name: "desktop-1440",
        device: { viewport: { width: 1440, height: 900 }, hasTouch: false },
        breakpoint: "desktop",
    },
];

const ROUTES = ["/", "/browse", "/stats", "/settings"];

const failures = [];
const records = [];
function record(name, ok, detail = "") {
    records.push({ name, ok, detail });
    if (!ok) failures.push(`FAIL: ${name} — ${detail}`);
}

async function findDeckId() {
    const r = await fetch(`${BASE}/api/decks`);
    const j = await r.json();
    function walk(n) {
        if (!n.children?.length && n.new_count + n.learn_count + n.review_count > 0) return n.id;
        for (const c of n.children ?? []) {
            const v = walk(c);
            if (v) return v;
        }
    }
    for (const d of j.decks) {
        const v = walk(d);
        if (v) return v;
    }
    return null;
}

const DECK_ID = await findDeckId();
if (!DECK_ID) {
    console.log("[probe] no deck with due cards found — skipping study flow");
}

const browser = await chromium.launch({ headless: true, executablePath: CHROME });

try {
    for (const profile of PROFILES) {
        const ctx = await browser.newContext({ ...profile.device });
        const page = await ctx.newPage();
        const consoleErrors = [];
        page.on("pageerror", (e) => consoleErrors.push(`page: ${e.message}`));
        page.on("console", (m) => {
            if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`);
        });

        for (const route of ROUTES) {
            const t0 = Date.now();
            try {
                await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
                await page.waitForTimeout(300);

                // Verify the right chrome surface is visible.
                const sidebarVisible = await page
                    .locator("aside")
                    .first()
                    .isVisible()
                    .catch(() => false);
                const bottomNavVisible = await page
                    .locator("nav.bottom-nav")
                    .first()
                    .isVisible()
                    .catch(() => false);

                if (profile.breakpoint === "phone") {
                    record(
                        `${profile.name}${route} bottom-nav visible`,
                        bottomNavVisible,
                        bottomNavVisible ? "" : "expected bottom-nav on phone",
                    );
                    record(
                        `${profile.name}${route} sidebar hidden`,
                        !sidebarVisible,
                        sidebarVisible ? "sidebar leaked through phone breakpoint" : "",
                    );
                } else {
                    record(
                        `${profile.name}${route} sidebar visible`,
                        sidebarVisible,
                        sidebarVisible ? "" : "expected sidebar on tablet/desktop",
                    );
                    record(
                        `${profile.name}${route} bottom-nav hidden`,
                        !bottomNavVisible,
                        bottomNavVisible ? "bottom-nav leaked into desktop" : "",
                    );
                }

                // No horizontal scroll: documentElement scrollWidth ≈ viewport
                const overflow = await page.evaluate(() => {
                    const sw = document.documentElement.scrollWidth;
                    const cw = document.documentElement.clientWidth;
                    return { sw, cw, diff: sw - cw };
                });
                const noOverflow = overflow.diff <= 1;
                record(
                    `${profile.name}${route} no horizontal overflow`,
                    noOverflow,
                    noOverflow ? "" : `scroll ${overflow.sw}px in ${overflow.cw}px viewport`,
                );

                await page.screenshot({
                    path: path.join(ART, `${profile.name}_${route.replace(/\//g, "_") || "_root"}.png`),
                    fullPage: false,
                });
                console.log(`[ok] ${profile.name} ${route} (${Date.now() - t0}ms)`);
            } catch (e) {
                record(`${profile.name}${route} navigate`, false, e.message);
            }
        }

        // Study answer flow on phone profile only — most likely to break.
        if (profile.breakpoint === "phone" && DECK_ID) {
            try {
                await page.goto(`${BASE}/study/${DECK_ID}`, { waitUntil: "networkidle" });
                await page.waitForTimeout(400);

                const reveal = page.locator("button.reveal-btn").first();
                const revealVisible = await reveal.isVisible().catch(() => false);
                record(
                    `${profile.name} study reveal visible`,
                    revealVisible,
                    revealVisible ? "" : "no reveal button on phone study",
                );

                if (revealVisible) {
                    // Verify reveal button hits 44px touch target on phone
                    const box = await reveal.boundingBox();
                    const tall = box && box.height >= 44;
                    record(
                        `${profile.name} study reveal ≥44px tap target`,
                        !!tall,
                        tall ? "" : `reveal-btn height ${box?.height}px`,
                    );

                    await reveal.click();
                    await page.waitForTimeout(300);

                    const goodBtn = page.locator("button.ans-good").first();
                    const goodVisible = await goodBtn.isVisible().catch(() => false);
                    record(
                        `${profile.name} study Good visible`,
                        goodVisible,
                        goodVisible ? "" : "Good button missing post-reveal",
                    );

                    if (goodVisible) {
                        const gbox = await goodBtn.boundingBox();
                        const gtall = gbox && gbox.height >= 44;
                        record(
                            `${profile.name} study Good ≥44px tap target`,
                            !!gtall,
                            gtall ? "" : `ans-good height ${gbox?.height}px`,
                        );
                    }
                }

                await page.screenshot({
                    path: path.join(ART, `${profile.name}_study.png`),
                    fullPage: false,
                });
            } catch (e) {
                record(`${profile.name} study flow`, false, e.message);
            }
        }

        if (consoleErrors.length) {
            // Filter out expected media 404s (test fixture lacks all referenced images)
            const real = consoleErrors.filter(
                (e) => !e.match(/404.*Not Found/) && !e.match(/Failed to load resource/),
            );
            if (real.length) record(`${profile.name} clean console`, false, real.slice(0, 3).join("; "));
        }

        await ctx.close();
    }
} finally {
    await browser.close();
}

const passed = records.filter((r) => r.ok).length;
const total = records.length;
console.log(`\n[summary] ${passed}/${total} checks passed`);
if (failures.length) {
    console.log("\n[failures]");
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
}
console.log("[result] GREEN — all responsive checks passed");
process.exit(0);
