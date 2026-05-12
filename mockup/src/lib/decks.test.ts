import { describe, expect, test } from "vitest";
import type { ApiDeckSummary } from "./api";
import { flattenLeafDecks, leafSegment } from "./decks";

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

describe("flattenLeafDecks", () => {
    test("a flat list of top-level decks passes through unchanged", () => {
        const flat = [mk(1, "Spanish"), mk(2, "Rust"), mk(3, "日文 N2")];
        const out = flattenLeafDecks(flat);
        expect(out.map((d) => d.name)).toEqual(["Spanish", "Rust", "日文 N2"]);
        expect(out.map((d) => d.id)).toEqual([1, 2, 3]);
    });

    test("container parents are dropped; leaves get the full Parent::Child::Leaf name", () => {
        const tree = [
            mk(100, "TOEIC", {
                children: [
                    mk(110, "Vocabulary", {
                        level: 2,
                        children: [
                            mk(111, "L600", { level: 3, new_count: 12 }),
                            mk(112, "L700", { level: 3, new_count: 7 }),
                        ],
                    }),
                    mk(120, "Cloze", {
                        level: 2,
                        children: [mk(121, "L600", { level: 3, review_count: 3 })],
                    }),
                ],
            }),
        ];
        const out = flattenLeafDecks(tree);
        expect(out.map((d) => d.name)).toEqual([
            "TOEIC::Vocabulary::L600",
            "TOEIC::Vocabulary::L700",
            "TOEIC::Cloze::L600",
        ]);
        // ids + counts are the leaves' own, untouched.
        expect(out.map((d) => d.id)).toEqual([111, 112, 121]);
        expect(out.map((d) => d.new_count)).toEqual([12, 7, 0]);
        expect(out.map((d) => d.review_count)).toEqual([0, 0, 3]);
    });

    test("mixed depth: a top-level leaf alongside a nested branch", () => {
        const tree = [
            mk(1, "Spanish"),
            mk(2, "JP", {
                children: [mk(3, "N2", { level: 2 }), mk(4, "N1", { level: 2 })],
            }),
        ];
        expect(flattenLeafDecks(tree).map((d) => d.name)).toEqual([
            "Spanish",
            "JP::N2",
            "JP::N1",
        ]);
    });

    test("does not mutate the input objects", () => {
        const child = mk(2, "Child", { level: 2 });
        const parent = mk(1, "Parent", { children: [child] });
        flattenLeafDecks([parent]);
        expect(child.name).toBe("Child");
        expect(parent.children[0].name).toBe("Child");
    });
});

describe("leafSegment", () => {
    test("returns the last :: segment", () => {
        expect(leafSegment("TOEIC::Vocabulary::L600")).toBe("L600");
        expect(leafSegment("JP::N2")).toBe("N2");
    });
    test("a name with no :: is returned as-is", () => {
        expect(leafSegment("Spanish")).toBe("Spanish");
    });
    test("trailing :: falls back to the whole string", () => {
        expect(leafSegment("Deck::")).toBe("Deck::");
    });
});
