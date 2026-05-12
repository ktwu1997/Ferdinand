import { describe, expect, test } from "vitest";
import type { ApiDeckSummary } from "./api";
import { aggregateRetentionPct, deckBreakdownRows } from "./stats";

function mk(
    id: number,
    name: string,
    extra: Partial<ApiDeckSummary> = {},
): ApiDeckSummary {
    return {
        id,
        name,
        level: 1,
        new_count: 0,
        learn_count: 0,
        review_count: 0,
        total_in_deck: 0,
        filtered: false,
        collapsed: false,
        preset_id: 1,
        children: [],
        ...extra,
    };
}

describe("deckBreakdownRows", () => {
    test("flattens to leaves with full path, 2-char glyph, total_in_deck cards", () => {
        const tree = [
            mk(1, "TOEIC", {
                children: [
                    mk(2, "Vocabulary", {
                        level: 2,
                        children: [
                            mk(3, "L600", { level: 3, total_in_deck: 200 }),
                            mk(4, "L700", { level: 3, total_in_deck: 224 }),
                        ],
                    }),
                ],
            }),
        ];
        const rows = deckBreakdownRows(tree);
        expect(rows).toEqual([
            { glyph: "L6", fullName: "TOEIC::Vocabulary::L600", cards: 200 },
            { glyph: "L7", fullName: "TOEIC::Vocabulary::L700", cards: 224 },
        ]);
    });

    test("falls back to new+learn+review when total_in_deck is 0", () => {
        const rows = deckBreakdownRows([
            mk(1, "Spanish", { new_count: 5, learn_count: 2, review_count: 8 }),
        ]);
        expect(rows[0].cards).toBe(15);
    });

    test("a flat top-level list passes through; CJK leaf yields a CJK glyph", () => {
        const rows = deckBreakdownRows([mk(1, "日本語"), mk(2, "Rust")]);
        expect(rows.map((r) => r.fullName)).toEqual(["日本語", "Rust"]);
        expect(rows[0].glyph).toBe("日本");
        expect(rows[1].glyph).toBe("RU");
    });

    test("empty input → empty rows", () => {
        expect(deckBreakdownRows([])).toEqual([]);
    });
});

describe("aggregateRetentionPct", () => {
    test("null answer buttons → null", () => {
        expect(aggregateRetentionPct(null)).toBeNull();
    });

    test("no answers in window → null (not a misleading 0%)", () => {
        expect(aggregateRetentionPct({ again: 0, hard: 0, good: 0, easy: 0 })).toBeNull();
    });

    test("everything passed (no agains) → 100", () => {
        expect(aggregateRetentionPct({ again: 0, hard: 1, good: 9, easy: 0 })).toBe(100);
    });

    test("everything lapsed → 0", () => {
        expect(aggregateRetentionPct({ again: 7, hard: 0, good: 0, easy: 0 })).toBe(0);
    });

    test("hard counts as retained; result is rounded", () => {
        // again=2044, hard=355, good=1917, easy=0 → (355+1917)/4316 = 52.6% → 53
        expect(aggregateRetentionPct({ again: 2044, hard: 355, good: 1917, easy: 0 })).toBe(53);
        // 1/3 retained → 33
        expect(aggregateRetentionPct({ again: 2, hard: 1, good: 0, easy: 0 })).toBe(33);
    });
});
