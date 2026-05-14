/**
 * Token hygiene tests — close #14 (--easy) and #13 (flag tokens).
 * These are file-content assertions: they verify the CSS source has the
 * canonical token definitions and that no legacy hex literals remain.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const MOCKUP_SRC = resolve(__dirname, "../../");

function readSrc(relPath: string): string {
    return readFileSync(resolve(MOCKUP_SRC, relPath), "utf8");
}

describe("#14 — --easy token", () => {
    it("--easy is defined in styles/tokens.css (sketch-skin)", () => {
        const tokens = readSrc("src/styles/tokens.css");
        expect(tokens).toMatch(/--easy:/);
    });

    it("no hardcoded #4a6c8e fallback remains in stats page", () => {
        const stats = readSrc("src/routes/stats/+page.svelte");
        expect(stats).not.toMatch(/#4a6c8e/);
    });

    it("no hardcoded #1565c0 remains in browse page", () => {
        const browse = readSrc("src/routes/browse/+page.svelte");
        expect(browse).not.toMatch(/#1565c0/);
    });
});

describe("#13 — flag tokens", () => {
    it("tokens.css defines --flag-1 through --flag-7", () => {
        const tokens = readSrc("src/styles/tokens.css");
        for (let i = 1; i <= 7; i++) {
            expect(tokens).toMatch(new RegExp(`--flag-${i}:`));
        }
    });

    it("browse page has no Bootstrap flag hex literals", () => {
        const browse = readSrc("src/routes/browse/+page.svelte");
        expect(browse).not.toMatch(
            /#dc3545|#fd7e14|#28a745|#0d6efd|#e83e8c|#20c997|#6f42c1/,
        );
    });
});
