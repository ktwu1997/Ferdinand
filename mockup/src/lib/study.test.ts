import { describe, expect, test } from "vitest";

import { STUDY_INTERVALS, formatMMSS } from "./study";

describe("formatMMSS", () => {
    test("renders zero as 00:00", () => {
        expect(formatMMSS(0)).toBe("00:00");
    });

    test("zero-pads single-digit seconds", () => {
        expect(formatMMSS(9_000)).toBe("00:09");
    });

    test("rolls seconds into minutes", () => {
        expect(formatMMSS(125_000)).toBe("02:05");
    });

    test("floors sub-second remainders", () => {
        expect(formatMMSS(5_900)).toBe("00:05");
    });

    test("does not cap minutes at 60", () => {
        expect(formatMMSS(3_661_000)).toBe("61:01");
    });

    test("clamps negative input to 00:00", () => {
        expect(formatMMSS(-4_000)).toBe("00:00");
    });
});

describe("STUDY_INTERVALS", () => {
    test("matches the design placeholder labels", () => {
        expect(STUDY_INTERVALS).toEqual({
            again: "<10m",
            hard: "1d",
            good: "5d",
            easy: "12d",
        });
    });
});
