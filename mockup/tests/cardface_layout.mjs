// Phase 6-polish: the reviewer's card-face must look like a real white card
// surface occupying the central column — not a 20px strip of notetype white
// on cream. This asserts geometry + computed style of the outer article
// wrapper and vertical centering of the notetype content inside the shadow.
//
// Exit 0 = GREEN, non-zero = RED.
//
// Requires anki_server on :40001 and mockup dev on :5174.
// Run: node mockup/tests/cardface_layout.mjs

import { chromium } from "playwright";

const URL = "http://localhost:5174/study/1776837237914";
const CHROME =
    process.env.CHROME_EXECUTABLE ||
    "/home/ktwu/.cache/ms-playwright/chromium-1208/chrome-linux/chrome";

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const failures = [];

try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));

    await page.goto(URL, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="card-face-front"]', { timeout: 5000 });

    const layout = await page.evaluate(() => {
        const article = document.querySelector("article.card-face.front");
        if (!article) return { hasArticle: false };
        const rect = article.getBoundingClientRect();
        const style = getComputedStyle(article);
        const host = article.querySelector('[data-testid="card-face-front"]');
        const shadow = host?.shadowRoot;
        const cardDiv = shadow?.querySelector("div.card");
        const cardRect = cardDiv?.getBoundingClientRect();
        return {
            hasArticle: true,
            article: {
                height: Math.round(rect.height),
                width: Math.round(rect.width),
                bg: style.backgroundColor,
                borderRadius: style.borderTopLeftRadius,
                borderWidth: style.borderTopWidth,
            },
            card: cardRect
                ? {
                      height: Math.round(cardRect.height),
                      width: Math.round(cardRect.width),
                      top: Math.round(cardRect.top - rect.top),
                  }
                : null,
        };
    });

    if (!layout.hasArticle) {
        failures.push("RED: article.card-face.front not found");
    } else {
        // A proper card surface is at least ~260px tall.
        if (layout.article.height < 260) {
            failures.push(
                `RED: .card-face height=${layout.article.height}px < 260 (still a thin strip)`,
            );
        }
        // Background must resolve to pure white so the notetype's `.card { background: white }`
        // blends into the outer surface instead of showing as an inner rectangle.
        const bg = layout.article.bg.replace(/\s/g, "");
        if (bg !== "rgb(255,255,255)") {
            failures.push(
                `RED: .card-face background=${bg} (expected rgb(255, 255, 255) to match notetype white)`,
            );
        }
        // Corners must read as a "card": >= 8px radius.
        const br = parseFloat(layout.article.borderRadius);
        if (!Number.isFinite(br) || br < 8) {
            failures.push(
                `RED: .card-face border-radius=${layout.article.borderRadius} (expected >= 8px)`,
            );
        }
        // Visible border.
        const bw = parseFloat(layout.article.borderWidth);
        if (!Number.isFinite(bw) || bw < 0.5) {
            failures.push(
                `RED: .card-face border-width=${layout.article.borderWidth} (expected >= 1px)`,
            );
        }
        // Vertical centering: the notetype .card content should sit near the
        // middle of the outer card surface (within 40px of the article's y-center).
        if (layout.card) {
            const articleHalf = layout.article.height / 2;
            const cardCenter = layout.card.top + layout.card.height / 2;
            const delta = Math.abs(cardCenter - articleHalf);
            if (delta > 40) {
                failures.push(
                    `RED: card content not vertically centered (offset=${delta}px from center, tolerance 40)`,
                );
            }
        } else {
            failures.push("RED: could not measure inner .card element inside shadow");
        }
    }

    console.log(JSON.stringify(layout, null, 2));
} finally {
    await browser.close();
}

if (failures.length) {
    for (const f of failures) console.error(f);
    process.exit(1);
}
console.log("GREEN: CardFace renders as a centered white card surface");
