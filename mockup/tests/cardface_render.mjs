// Phase 5-A: the reviewer must render each card's front/back as real HTML
// scoped inside a shadow DOM that also carries the notetype's CSS.
//
// Exit 0 = GREEN, non-zero = RED.
//
// Requires anki_server on :40001 and mockup dev on :5174.
// Run: node mockup/tests/cardface_render.mjs

import { chromium } from "playwright";

const URL = "http://localhost:5174/study/1776837237914";
const CHROME =
    process.env.CHROME_EXECUTABLE ||
    "/home/ktwu/.cache/ms-playwright/chromium-1208/chrome-linux/chrome";

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const failures = [];

try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error") failures.push(`console.error: ${m.text()}`);
    });

    await page.goto(URL, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="card-face-front"]', { timeout: 5000 });

    const shape = await page.evaluate(() => {
        const host = document.querySelector('[data-testid="card-face-front"]');
        if (!host) return { hasHost: false };
        const shadow = host.shadowRoot;
        if (!shadow) return { hasHost: true, hasShadow: false };
        const styleEl = shadow.querySelector("style");
        const styleLen = styleEl ? styleEl.textContent.length : 0;
        // Find a rendered element from the card template (Anki default Basic
        // notetype wraps content inside a `.card` class via its CSS selector,
        // so we sniff for something with visible text).
        const text = shadow.textContent.trim();
        const innerHTMLLen = shadow.innerHTML.length;
        return {
            hasHost: true,
            hasShadow: true,
            styleLen,
            textSample: text.slice(0, 40),
            innerHTMLLen,
        };
    });

    if (!shape.hasHost) failures.push("RED: no [data-testid=card-face-front] element");
    else if (!shape.hasShadow)
        failures.push("RED: card-face-front has no shadowRoot (html not rendered in isolation)");
    else {
        if (shape.styleLen === 0)
            failures.push("RED: shadowRoot has no <style> — notetype CSS not injected");
        if (!shape.textSample)
            failures.push("RED: shadowRoot text empty — HTML not rendered");
        if (shape.innerHTMLLen < 20)
            failures.push(`RED: shadow innerHTML suspiciously short (${shape.innerHTMLLen})`);
    }

    // Verify reveal + back face too.
    await page.keyboard.press("Space");
    await page.waitForTimeout(150);
    const backShape = await page.evaluate(() => {
        const host = document.querySelector('[data-testid="card-face-back"]');
        if (!host) return { hasHost: false };
        const shadow = host.shadowRoot;
        return {
            hasHost: true,
            hasShadow: !!shadow,
            styleLen: shadow?.querySelector("style")?.textContent.length ?? 0,
            textSample: shadow?.textContent?.trim().slice(0, 40) ?? "",
        };
    });
    if (!backShape.hasHost) failures.push("RED: no [data-testid=card-face-back] element after reveal");
    else if (!backShape.hasShadow) failures.push("RED: back face has no shadowRoot");
    else if (backShape.styleLen === 0) failures.push("RED: back face shadowRoot has no notetype CSS");

    console.log(JSON.stringify({ front: shape, back: backShape }, null, 2));
} finally {
    await browser.close();
}

if (failures.length) {
    for (const f of failures) console.error(f);
    process.exit(1);
}
console.log("GREEN: front + back rendered inside shadow DOM with notetype CSS");
