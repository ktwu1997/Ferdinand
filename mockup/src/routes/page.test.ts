import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import Page from "./+page.svelte";
import { resetPageStub } from "../test/stubs/app-stores";
import { decks as fakeDecks, history as fakeHistory, totalDue } from "$lib/data";
import type {
    ApiDeckListResponse,
    ApiForecastResponse,
    ApiHealth,
    ApiStatsRecent,
} from "$lib/api";

// Phase 8-D: contract tests for the home route. Mock only the network
// surface (fetchDecks + fetchHealth + fetchStatsRecent) — LiveIndicator
// calls fetchHealth on its own onMount, so we must control all three to
// exercise the live / offline branches. `importOriginal` keeps mediaBase,
// apiBase, and the rest of $lib/api real, matching the 8-C pattern.
vi.mock("$lib/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("$lib/api")>();
    return {
        ...actual,
        fetchDecks: vi.fn(),
        fetchHealth: vi.fn(),
        fetchStatsRecent: vi.fn(),
        fetchForecast: vi.fn(),
        postDeck: vi.fn(),
    };
});

import {
    fetchDecks,
    fetchForecast,
    fetchHealth,
    fetchStatsRecent,
    postDeck,
} from "$lib/api";

const decksOk: ApiDeckListResponse = {
    decks: [
        {
            id: 42,
            name: "Spanish",
            level: 1,
            new_count: 5,
            learn_count: 2,
            review_count: 3,
            total_in_deck: 10,
            filtered: false,
            collapsed: false,
            preset_id: 1,
            children: [],
        },
    ],
};

const healthLive: ApiHealth = { ok: true, version: "0.1.0" };

// Phase 11-B: default stats payload mirrors fakeHistory's totals so the
// live path produces the same `.stat-value` as the pre-11-B fakeHistory
// path. Individual tests override with `mockResolvedValueOnce` /
// `mockRejectedValueOnce` to exercise specific scenarios.
const fakeHistoryAsApi: ApiStatsRecent = {
    days: fakeHistory.length,
    history: fakeHistory.map((d) => ({ date: d.date, reviews: d.reviews })),
};

// Phase 17-B: default forecast payload — 7 days of zero reviews. Most
// tests don't care about the bar chart so the default keeps the chart
// rendered (non-null) but visually empty. Tests that DO care override
// with mockResolvedValueOnce.
const emptyForecast: ApiForecastResponse = {
    days: 7,
    history: Array.from({ length: 7 }, (_, i) => ({ offset: i, reviews: 0 })),
};

// Three concurrent async onMount chains run under one mount(): the page's
// fetchDecks (then fetchStatsRecent in the same async scope) and
// LiveIndicator's fetchHealth. 12 microtask turns leaves headroom for the
// sequential awaits inside the page's own onMount.
async function settle(): Promise<void> {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    flushSync();
}

describe("HomePage contract", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        // resetAllMocks (not clearAllMocks) wipes any unconsumed
        // mockResolvedValueOnce queue from a sibling test that errored out,
        // per the Phase 9-T fact. Defaults are re-applied below so unrelated
        // tests don't have to know about every mocked function.
        vi.resetAllMocks();
        resetPageStub();
        // Phase 11-B default: fetchStatsRecent succeeds with fakeHistory's
        // totals. Tests that don't care about stats work unchanged; tests
        // that DO care override with mockResolvedValueOnce / mockRejectedValueOnce.
        vi.mocked(fetchStatsRecent).mockResolvedValue(fakeHistoryAsApi);
        // Phase 17-B default: fetchForecast succeeds with an empty 7-day
        // window. Tests that don't care render the (zero-bar) chart and
        // pass — tests that DO care override per-test (16-A lesson:
        // every beforeEach must default-mock new fetch fns).
        vi.mocked(fetchForecast).mockResolvedValue(emptyForecast);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("fetchDecks success: backend decks drive h1 total and rendered rows", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(vi.mocked(fetchDecks)).toHaveBeenCalledTimes(1);

            // h1 reflects backend totals: 5 new + 2 learn + 3 review = 10.
            expect(container.querySelector("h1")?.textContent).toContain("10");

            // level>=1 filter leaves exactly one live row.
            const rows = container.querySelectorAll(".deck-grid .deck-row");
            expect(rows.length).toBe(1);

            expect(
                container
                    .querySelector(".deck-grid .deck-name")
                    ?.textContent?.trim(),
            ).toBe("Spanish");

            expect(
                container.querySelector(".deck-grid .deck-sub")?.textContent,
            ).toContain("10 cards");

            expect(
                container
                    .querySelector(".deck-grid .deck-due.has-due .due-count")
                    ?.textContent?.trim(),
            ).toBe("10");

            // Resume picks decks[0] → Spanish after mapping.
            expect(
                container.querySelector(".resume h2")?.textContent,
            ).toContain("Spanish");
        } finally {
            unmount(instance);
        }
    });

    test("fetchDecks rejects: explicit banner surfaces server message; fakeDecks still rendered (Phase 10-B)", async () => {
        vi.mocked(fetchDecks).mockRejectedValueOnce(
            new Error("backend unreachable"),
        );
        vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(vi.mocked(fetchDecks)).toHaveBeenCalledTimes(1);

            // Phase 10-B: banner appears with the server's error string so
            // users know counts are stale (vs. 9-S browse-tree silent
            // fallback — home page is the entry point, surfacing the
            // outage here is more valuable than dead silence).
            const banner = container.querySelector(".error-banner");
            expect(banner).not.toBeNull();
            expect(banner?.textContent).toContain("backend unreachable");
            expect(banner?.textContent).toContain("cached counts");

            // Fake fallback still renders so the page isn't blank.
            const rows = container.querySelectorAll(".deck-grid .deck-row");
            expect(rows.length).toBe(fakeDecks.length);

            // h1 sums totalDue over every fakeDeck (96 at time of writing —
            // computed rather than hardcoded so fixture updates flow through).
            const expectedTotalDue = fakeDecks.reduce(
                (a, d) => a + totalDue(d),
                0,
            );
            expect(container.querySelector("h1")?.textContent).toContain(
                String(expectedTotalDue),
            );

            expect(
                container.querySelector(".resume h2")?.textContent,
            ).toContain(fakeDecks[0].name);
        } finally {
            unmount(instance);
        }
    });

    test("fetchDecks success: no error banner on the page (Phase 10-B)", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Banner is reserved for fetch failure — happy path stays clean.
            expect(container.querySelector(".error-banner")).toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("LiveIndicator: fetchHealth ok renders .tag.live with version", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockResolvedValueOnce({
            ok: true,
            version: "0.1.0",
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const tag = container.querySelector(".tag.live");
            expect(tag).not.toBeNull();
            expect(tag?.textContent).toContain("Live");
            expect(tag?.textContent).toContain("0.1.0");
        } finally {
            unmount(instance);
        }
    });

    test("LiveIndicator: fetchHealth rejects renders .tag.offline with 'Demo data'", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockRejectedValueOnce(
            new Error("health check failed"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const tag = container.querySelector(".tag.offline");
            expect(tag).not.toBeNull();
            expect(tag?.textContent).toContain("Demo data");
        } finally {
            unmount(instance);
        }
    });

    test("Resume CTA links to first deck's study route with 'Start studying'", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Live deck id 42 is mapped to string in +page.svelte.
            const cta = container.querySelector(
                '.resume-cta a[href="/study/42"]',
            );
            expect(cta).not.toBeNull();
            expect(cta?.textContent).toContain("Start studying");
        } finally {
            unmount(instance);
        }
    });

    test("Stats section: .stat-value equals totalReviews.toLocaleString() (default mock = fakeHistory totals)", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const totalReviews = fakeHistory.reduce(
                (a, d) => a + d.reviews,
                0,
            );
            expect(
                container.querySelector(".stat-value")?.textContent?.trim(),
            ).toBe(totalReviews.toLocaleString());

            const headings = Array.from(
                container.querySelectorAll(".section-head h3"),
            ).map((h) => h.textContent?.trim());
            expect(headings).toEqual(
                expect.arrayContaining(["All decks", "Last 30 days"]),
            );
        } finally {
            unmount(instance);
        }
    });
});

describe("Phase 11-B stats history", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.resetAllMocks();
        resetPageStub();
        vi.mocked(fetchStatsRecent).mockResolvedValue(fakeHistoryAsApi);
        // Phase 17-B: forecast default (matches outer describe). Same
        // 16-A pattern — every beforeEach owns its own fetch defaults
        // because resetAllMocks above wipes the prior block's setup.
        vi.mocked(fetchForecast).mockResolvedValue(emptyForecast);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("fetchStatsRecent success: live history drives .stat-value", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);
        // Custom server payload — three days of activity totalling 76. The
        // mockResolvedValueOnce wins over the beforeEach default.
        vi.mocked(fetchStatsRecent).mockResolvedValueOnce({
            days: 3,
            history: [
                { date: "2026-04-24", reviews: 30 },
                { date: "2026-04-25", reviews: 25 },
                { date: "2026-04-26", reviews: 21 },
            ],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(vi.mocked(fetchStatsRecent)).toHaveBeenCalledTimes(1);
            expect(
                container.querySelector(".stat-value")?.textContent?.trim(),
            ).toBe((76).toLocaleString());
            // No banner on success — happy path stays clean.
            expect(
                container.querySelector(".stats-error-banner"),
            ).toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("fetchStatsRecent rejects: stats-error-banner surfaces and fakeHistory totals drive .stat-value", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);
        vi.mocked(fetchStatsRecent).mockRejectedValueOnce(
            new Error("stats endpoint unreachable"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const banner = container.querySelector(".stats-error-banner");
            expect(banner).not.toBeNull();
            expect(banner?.textContent).toContain("stats endpoint unreachable");
            expect(banner?.textContent).toContain("cached values");

            // Fallback: fakeHistory still drives the count so the page isn't blank.
            const totalReviews = fakeHistory.reduce(
                (a, d) => a + d.reviews,
                0,
            );
            expect(
                container.querySelector(".stat-value")?.textContent?.trim(),
            ).toBe(totalReviews.toLocaleString());
        } finally {
            unmount(instance);
        }
    });

    test("fetchStatsRecent default-mock 30 days: page calls fetchStatsRecent(30)", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            expect(vi.mocked(fetchStatsRecent)).toHaveBeenCalledWith(30);
        } finally {
            unmount(instance);
        }
    });

    // Phase 14-C: + New deck inline form. Mocks postDeck + a follow-up
    // fetchDecks (the page refetches after a successful POST so server-
    // assigned ids and auto-created parents flow into the grid).
    describe("Phase 14-C + New deck", () => {
        test("button click reveals input; Enter commits postDeck + refetches", async () => {
            vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
            vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);
            vi.mocked(postDeck).mockResolvedValueOnce({
                id: 1_777_223_500_000,
                name: "Italian",
            });
            // Refetch after success returns a list with the new deck.
            const decksOkPlusItalian: ApiDeckListResponse = {
                decks: [
                    decksOk.decks[0],
                    {
                        id: 1_777_223_500_000,
                        name: "Italian",
                        level: 1,
                        new_count: 0,
                        learn_count: 0,
                        review_count: 0,
                        total_in_deck: 0,
                        filtered: false,
                        collapsed: false,
                        preset_id: 1,
                        children: [],
                    },
                ],
            };
            vi.mocked(fetchDecks).mockResolvedValueOnce(decksOkPlusItalian);

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const newDeckBtn = container.querySelector<HTMLButtonElement>(
                    "button.new-deck-btn",
                );
                expect(newDeckBtn).not.toBeNull();
                expect(newDeckBtn!.disabled).toBe(false);
                newDeckBtn!.click();
                flushSync();

                const input = container.querySelector<HTMLInputElement>(
                    "input.new-deck-input",
                );
                expect(input).not.toBeNull();
                input!.value = "Italian";
                input!.dispatchEvent(new Event("input", { bubbles: true }));
                input!.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
                );
                await settle();

                expect(vi.mocked(postDeck)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(postDeck)).toHaveBeenCalledWith("Italian");
                // Refetch fired (initial + post-create refresh).
                expect(vi.mocked(fetchDecks)).toHaveBeenCalledTimes(2);
                // Form collapses back to button after success.
                expect(
                    container.querySelector("input.new-deck-input"),
                ).toBeNull();
                expect(
                    container.querySelector("button.new-deck-btn"),
                ).not.toBeNull();
                // Italian appears in the deck grid.
                const deckNames = Array.from(
                    container.querySelectorAll(".deck-name"),
                ).map((el) => el.textContent?.trim());
                expect(deckNames).toContain("Italian");
            } finally {
                unmount(instance);
            }
        });

        test("server 400 surfaces inline error banner; form stays open", async () => {
            vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
            vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);
            vi.mocked(postDeck).mockRejectedValueOnce(
                new Error("400 name must not contain consecutive '::' separators"),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                container
                    .querySelector<HTMLButtonElement>("button.new-deck-btn")!
                    .click();
                flushSync();

                const input = container.querySelector<HTMLInputElement>(
                    "input.new-deck-input",
                );
                input!.value = "A:::B";
                input!.dispatchEvent(new Event("input", { bubbles: true }));
                input!.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
                );
                await settle();

                expect(vi.mocked(postDeck)).toHaveBeenCalledTimes(1);
                // Form stays open so the user can fix-and-retry without
                // re-clicking + New deck.
                expect(
                    container.querySelector("input.new-deck-input"),
                ).not.toBeNull();
                const banner = container.querySelector(".error-banner");
                expect(banner).not.toBeNull();
                expect(banner?.textContent).toContain("consecutive");
                // Refetch should NOT have fired on failure (initial only).
                expect(vi.mocked(fetchDecks)).toHaveBeenCalledTimes(1);
            } finally {
                unmount(instance);
            }
        });

        test("button is disabled when liveDecks is null (backend offline)", async () => {
            // fetchDecks rejects → liveDecks stays null → create button
            // disabled (we never lie about persisting against fake data).
            vi.mocked(fetchDecks).mockRejectedValueOnce(
                new Error("backend unreachable"),
            );
            vi.mocked(fetchHealth).mockRejectedValueOnce(
                new Error("backend unreachable"),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const btn = container.querySelector<HTMLButtonElement>(
                    "button.new-deck-btn",
                );
                expect(btn).not.toBeNull();
                expect(btn!.disabled).toBe(true);
                expect(vi.mocked(postDeck)).not.toHaveBeenCalled();
            } finally {
                unmount(instance);
            }
        });
    });
});

// Phase 17-B: forecast bar contract tests. Same vi.resetAllMocks +
// per-block default-mock pattern as 11-B; the chart renders 7 columns
// when fetchForecast resolves, hides on rejection. Bars scale to the
// peak day's reviews, so an asymmetric payload exercises the height
// math.
describe("Phase 17-B forecast bar", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.resetAllMocks();
        resetPageStub();
        // Defaults so the deck list renders and stats don't blow up.
        vi.mocked(fetchDecks).mockRejectedValue(new Error("decks default"));
        vi.mocked(fetchHealth).mockRejectedValue(new Error("health default"));
        vi.mocked(fetchStatsRecent).mockResolvedValue(fakeHistoryAsApi);
        // Forecast default — empty 7-day window. Tests that need real
        // numbers override per-test with mockResolvedValueOnce.
        vi.mocked(fetchForecast).mockResolvedValue(emptyForecast);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("fetchForecast success: 7 .forecast-col entries render with the right offsets", async () => {
        // Asymmetric payload — today=12, +1d=8, +2d=0 (zero), ..., +6d=15.
        // Lets the test pin both the column count and that zero-day
        // bars render with the .zero modifier (not the gradient bar).
        const payload: ApiForecastResponse = {
            days: 7,
            history: [
                { offset: 0, reviews: 12 },
                { offset: 1, reviews: 8 },
                { offset: 2, reviews: 0 },
                { offset: 3, reviews: 4 },
                { offset: 4, reviews: 0 },
                { offset: 5, reviews: 6 },
                { offset: 6, reviews: 15 },
            ],
        };
        vi.mocked(fetchForecast).mockResolvedValueOnce(payload);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const cols = Array.from(
                container.querySelectorAll<HTMLDivElement>(".forecast-col"),
            );
            expect(cols.length).toBe(7);

            // Per-column count text matches the payload exactly.
            const counts = cols.map(
                (c) =>
                    c.querySelector<HTMLDivElement>(".forecast-count")
                        ?.textContent ?? "",
            );
            expect(counts).toEqual([
                "12",
                "8",
                "0",
                "4",
                "0",
                "6",
                "15",
            ]);

            // Zero-day bars carry the .zero class so the gradient hides
            // — chart should not paint phantom bars.
            const bars = cols.map((c) =>
                c.querySelector<HTMLDivElement>(".forecast-bar"),
            );
            expect(bars[2]?.classList.contains("zero")).toBe(true);
            expect(bars[4]?.classList.contains("zero")).toBe(true);
            expect(bars[0]?.classList.contains("zero")).toBe(false);
            expect(bars[6]?.classList.contains("zero")).toBe(false);

            // The "today" label is the leftmost column; +Nd labels follow.
            const labels = cols.map(
                (c) =>
                    c.querySelector<HTMLDivElement>(".forecast-label")
                        ?.textContent?.trim() ?? "",
            );
            expect(labels[0]).toBe("Today");
            expect(labels[1]).toBe("+1d");
            expect(labels[6]).toBe("+6d");

            // Server fetched with default window (7 days).
            expect(vi.mocked(fetchForecast)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(fetchForecast)).toHaveBeenCalledWith(7);
        } finally {
            unmount(instance);
        }
    });

    test("total cards-due cell is the sum of the window", async () => {
        vi.mocked(fetchForecast).mockResolvedValueOnce({
            days: 7,
            history: [
                { offset: 0, reviews: 12 },
                { offset: 1, reviews: 8 },
                { offset: 2, reviews: 0 },
                { offset: 3, reviews: 4 },
                { offset: 4, reviews: 0 },
                { offset: 5, reviews: 6 },
                { offset: 6, reviews: 15 },
            ],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Sum: 12+8+0+4+0+6+15 = 45. Use the forecast-specific
            // class .forecast-total (distinct from the Last-30-days
            // .stat-value) so existing tests stay scoped.
            const total = container.querySelector<HTMLDivElement>(
                ".forecast-section .forecast-total",
            )?.textContent;
            expect(total).toBe("45");
        } finally {
            unmount(instance);
        }
    });

    test("fetchForecast rejects: section hides chart and shows error banner", async () => {
        vi.mocked(fetchForecast).mockRejectedValueOnce(
            new Error("forecast unreachable"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // No grid (chart hidden), but the error-fallback section is
            // present with the banner copy.
            expect(container.querySelector(".forecast-grid")).toBeNull();
            const banner = container
                .querySelector(".forecast-section")
                ?.querySelector(".stats-error-banner");
            expect(banner).not.toBeNull();
            expect(banner?.textContent).toContain("forecast unreachable");
        } finally {
            unmount(instance);
        }
    });
});
