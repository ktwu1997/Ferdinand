import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("ImportApkgPanel skin token hygiene", () => {
    it("contains no hex color literals in the <style> block", () => {
        const filePath = join(
            __dirname,
            "ImportApkgPanel.svelte",
        );
        const src = readFileSync(filePath, "utf8");
        const styleBlock =
            src.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
        const hexes = styleBlock.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
        expect(hexes).toHaveLength(0);
    });
});
