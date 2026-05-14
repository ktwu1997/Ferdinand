/**
 * Heatmap layout regression test — close #15.
 * Asserts that the stats page heatmap stretches to container width
 * by verifying the CSS uses responsive sizing (not a fixed px grid).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const statsPage = readFileSync(
    resolve(__dirname, "../../src/routes/stats/+page.svelte"),
    "utf8",
);

describe("#15 — heatmap fills container width", () => {
    it("heatmap grid wrapper uses width: 100% not flex-centre", () => {
        expect(statsPage).toMatch(/\.sx-heatmap-grid-wrap\s*\{[^}]*width:\s*100%/s);
    });

    it("heatmap SVG CSS uses width: 100%, not repeat(N, <px>)", () => {
        // No fixed pixel column repeat (which caused the narrow layout).
        expect(statsPage).not.toMatch(/grid-template-columns:\s*repeat\(\d+,\s*\d+px\)/);
        expect(statsPage).toMatch(/\.sx-heatmap-grid\s*\{[^}]*width:\s*100%/s);
    });

    it("heatmap SVG opening tag has no inline pixel width attribute", () => {
        // Extract just the opening SVG tag of the heatmap (up to the first >).
        // We identify it by its class and data-testid proximity.
        const tagStart = statsPage.indexOf('class="sx-heatmap-grid"');
        const tagEnd = statsPage.indexOf(">", tagStart);
        const svgOpenTag = statsPage.slice(tagStart, tagEnd);
        // The opening tag should NOT have a width={...} binding.
        // (child <rect> elements may still use width={HEAT_CELL} — that's fine).
        expect(svgOpenTag).not.toMatch(/width=/);
    });

    it("heatmap panel has data-testid for e2e tests", () => {
        expect(statsPage).toMatch(/data-testid="stats-heatmap-panel"/);
    });
});
