import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import Page from "./+page.svelte";
import { resetPageStub } from "../test/stubs/app-stores";
import { decks as fakeDecks, history as fakeHistory, totalDue } from "$lib/data";
import type {
    ApiDeckListResponse,
    ApiForecastResponse,
    ApiStatsRecent,
} from "$lib/api";

// Phase B-test-fix-1: page no longer renders LiveIndicator (and no
// longer calls fetchHealth) — A5b dashboard polish moved the framing
// to the .dash-hero CTA. Design rev 2 ("the deck ledger") then dropped
// the accent resume-CTA entirely — the deck-grid is now a ledger table
// whose rows carry data-testid="deck-card" + data-deck-id + the
// /study/<id> href, so "continue where you left off" is just clicking
// the first row. We mock the four onMount fetches plus the two
// inline-form mutators; everything else stays real.
vi.mock("$lib/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("$lib/api")>();
    return {
        ...actual,
        fetchDecks: vi.fn(),
        fetchStatsRecent: vi.fn(),
        fetchForecast: vi.fn(),
        postDeck: vi.fn(),
        postFilteredDeck: vi.fn(),
    };
});

import {
    fetchDecks,
    fetchForecast,
    fetchStatsRecent,
    postDeck,
    postFilteredDeck,
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

// Phase 11-B: default stats payload mirrors fakeHistory's totals so
// the live path produces the same .recent-total as the pre-11-B
// fakeHistory path. Tests override with mockResolvedValueOnce /
// mockRejectedValueOnce when they care about specific scenarios.
const fakeHistoryAsApi: ApiStatsRecent = {
    days: fakeHistory.length,
    history: fakeHistory.map((d) => ({ date: d.date, reviews: d.reviews })),
};

// Phase 17-B: default forecast — empty 7-day window. Tests that need
// real numbers override per-test.
const emptyForecast: ApiForecastResponse = {
    days: 7,
    history: Array.from({ length: 7 }, (_, i) => ({ offset: i, reviews: 0 })),
};

// 12 microtask turns covers the page's three sequential awaits in
// onMount (fetchDecks → fetchStatsRecent → fetchForecast) plus a
// margin for any inline-form `await tick()` that fires on click.
async function settle(): Promise<void> {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    flushSync();
}

describe("HomePage contract", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.resetAllMocks();
        resetPageStub();
        vi.mocked(fetchStatsRecent).mockResolvedValue(fakeHistoryAsApi);
        vi.mocked(fetchForecast).mockResolvedValue(emptyForecast);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("fetchDecks success: backend decks drive desktop ledger row and totalDueAll subtitle", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(vi.mocked(fetchDecks)).toHaveBeenCalledTimes(1);

            // .dash-subtitle reflects sum of totalDue across active
            // decks. Spanish has 5 new + 2 learn + 3 review = 10.
            const subtitleStrong = container.querySelector(
                ".dash-desktop .dash-subtitle strong",
            );
            expect(subtitleStrong?.textContent).toContain("10");

            // level >= 1 + id !== 0 filter leaves exactly one live row.
            // [data-testid="deck-card"] is desktop-only (the ledger
            // rows); mobile uses a separate .m-deck-row which we do not
            // assert here.
            const cards = container.querySelectorAll(
                '[data-testid="deck-card"]',
            );
            expect(cards.length).toBe(1);

            const card = cards[0]!;
            expect(card.getAttribute("data-deck-name")).toBe("Spanish");
            expect(card.getAttribute("data-deck-id")).toBe("42");
            expect(card.getAttribute("href")).toBe("/study/42");
            expect(
                card.querySelector(".deck-card-name")?.textContent?.trim(),
            ).toBe("Spanish");
            expect(
                card.querySelector(".deck-card-sub")?.textContent,
            ).toContain("10 cards");
        } finally {
            unmount(instance);
        }
    });

    test("fetchDecks rejects: explicit banner surfaces server message; fakeDecks still rendered (Phase 10-B)", async () => {
        vi.mocked(fetchDecks).mockRejectedValueOnce(
            new Error("backend unreachable"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(vi.mocked(fetchDecks)).toHaveBeenCalledTimes(1);

            // Phase 10-B: banner surfaces server error so users know
            // counts are stale — home is the entry point so the
            // outage warrants the noise (vs 9-S browse-tree's silent
            // fallback).
            const banner = container.querySelector(
                ".dash-desktop .error-banner",
            );
            expect(banner).not.toBeNull();
            expect(banner?.textContent).toContain("backend unreachable");
            expect(banner?.textContent).toContain("cached counts");

            // Fake fallback still renders so the page isn't blank.
            const cards = container.querySelectorAll(
                '[data-testid="deck-card"]',
            );
            expect(cards.length).toBe(fakeDecks.length);

            // .dash-subtitle sums totalDue over every fakeDeck —
            // computed from fixture so updates flow through.
            const expectedTotalDue = fakeDecks.reduce(
                (a, d) => a + totalDue(d),
                0,
            );
            const subtitleStrong = container.querySelector(
                ".dash-desktop .dash-subtitle strong",
            );
            expect(subtitleStrong?.textContent).toContain(
                String(expectedTotalDue),
            );

            // First ledger row mirrors the first fake deck — clicking it
            // is the rev-2 "continue where you left off" path.
            const firstRow = container.querySelector(
                '[data-testid="deck-card"]',
            );
            expect(
                firstRow?.querySelector(".deck-card-name")?.textContent?.trim(),
            ).toBe(fakeDecks[0].name);
        } finally {
            unmount(instance);
        }
    });

    test("fetchDecks success: no error banner on the page (Phase 10-B)", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            // Banner is reserved for fetch failure — happy path stays clean.
            expect(container.querySelector(".error-banner")).toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("first ledger row links to first deck's study route (rev-2 resume path)", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Design rev 2 dropped the accent resume-CTA — the deck-grid
            // is a ledger table now, and "continue where you left off"
            // is just clicking row 1. Live deck id 42 is mapped to
            // string in +page.svelte.
            const firstRow = container.querySelector<HTMLAnchorElement>(
                '[data-testid="deck-card"]',
            );
            expect(firstRow).not.toBeNull();
            expect(firstRow!.getAttribute("href")).toBe("/study/42");
            expect(firstRow!.getAttribute("data-deck-id")).toBe("42");
            expect(
                firstRow!.querySelector(".deck-card-name")?.textContent?.trim(),
            ).toBe("Spanish");
        } finally {
            unmount(instance);
        }
    });

    test("Last 30 days section: .recent-total equals totalReviews.toLocaleString() with section caption", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const totalReviews = fakeHistory.reduce(
                (a, d) => a + d.reviews,
                0,
            );
            expect(
                container
                    .querySelector(".recent-section .recent-total")
                    ?.textContent?.trim(),
            ).toBe(totalReviews.toLocaleString());

            // Section captions replace old <h3> headings — Caption
            // renders <div class="caption mono"> with a "// " prefix.
            // Lowercase content matches per A5b sketch-skin.
            const captions = Array.from(
                container.querySelectorAll(
                    ".dash-desktop .section-head .caption",
                ),
            ).map((h) => h.textContent?.toLowerCase() ?? "");
            expect(captions.some((t) => t.includes("all decks"))).toBe(true);
            expect(captions.some((t) => t.includes("last 30 days"))).toBe(
                true,
            );
        } finally {
            unmount(instance);
        }
    });
});

describe("Phase 11-B stats history", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        // resetAllMocks (not clearAllMocks) wipes any unconsumed
        // mockResolvedValueOnce queue from a sibling test that errored
        // out, per the Phase 9-T fact. Defaults are re-applied below
        // so unrelated tests don't have to know about every mocked
        // function.
        vi.resetAllMocks();
        resetPageStub();
        vi.mocked(fetchStatsRecent).mockResolvedValue(fakeHistoryAsApi);
        vi.mocked(fetchForecast).mockResolvedValue(emptyForecast);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("fetchStatsRecent success: live history drives .recent-total", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        // Custom server payload — three days of activity totalling 76.
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
                container
                    .querySelector(".recent-section .recent-total")
                    ?.textContent?.trim(),
            ).toBe((76).toLocaleString());
            // No banner on success — happy path stays clean.
            expect(
                container.querySelector(".recent-section .error-banner"),
            ).toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("fetchStatsRecent rejects: recent-section error banner surfaces and fakeHistory totals drive .recent-total", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchStatsRecent).mockRejectedValueOnce(
            new Error("stats endpoint unreachable"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const banner = container.querySelector(
                ".recent-section .error-banner",
            );
            expect(banner).not.toBeNull();
            expect(banner?.textContent).toContain("stats endpoint unreachable");
            expect(banner?.textContent).toContain("cached values");

            // Fallback: fakeHistory still drives the count so the
            // page isn't blank.
            const totalReviews = fakeHistory.reduce(
                (a, d) => a + d.reviews,
                0,
            );
            expect(
                container
                    .querySelector(".recent-section .recent-total")
                    ?.textContent?.trim(),
            ).toBe(totalReviews.toLocaleString());
        } finally {
            unmount(instance);
        }
    });

    test("fetchStatsRecent default-mock 30 days: page calls fetchStatsRecent(30)", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            expect(vi.mocked(fetchStatsRecent)).toHaveBeenCalledWith(30);
        } finally {
            unmount(instance);
        }
    });

    // Phase 14-C / B-test-fix-1: + New deck inline form. The Btn
    // component renders a real <button class="btn ..."> so we target
    // by `button.btn[aria-label="..."]`. The alternate "deck-card-new"
    // raw <button> in the deck grid carries the same aria-label but
    // stays visible during create-mode and is therefore a worse
    // signal for "form open / closed".
    describe("Phase 14-C + New deck", () => {
        test("button click reveals input; Enter commits postDeck + refetches", async () => {
            vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
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
                    'button.btn[aria-label="Create new deck"]',
                );
                expect(newDeckBtn).not.toBeNull();
                expect(newDeckBtn!.disabled).toBe(false);
                newDeckBtn!.click();
                flushSync();

                const input = container.querySelector<HTMLInputElement>(
                    'input[aria-label="New deck name"]',
                );
                expect(input).not.toBeNull();
                input!.value = "Italian";
                input!.dispatchEvent(new Event("input", { bubbles: true }));
                input!.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        key: "Enter",
                        bubbles: true,
                    }),
                );
                await settle();

                expect(vi.mocked(postDeck)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(postDeck)).toHaveBeenCalledWith("Italian");
                // Refetch fired (initial + post-create refresh).
                expect(vi.mocked(fetchDecks)).toHaveBeenCalledTimes(2);
                // Form collapses back to the section-actions ghost
                // button after success — the input goes away, the
                // ghost button comes back (it was hidden via
                // {#if !isCreatingDeck && ...}).
                expect(
                    container.querySelector(
                        'input[aria-label="New deck name"]',
                    ),
                ).toBeNull();
                expect(
                    container.querySelector(
                        'button.btn[aria-label="Create new deck"]',
                    ),
                ).not.toBeNull();
                // Italian appears in the deck grid.
                const deckNames = Array.from(
                    container.querySelectorAll(
                        '[data-testid="deck-card"] .deck-card-name',
                    ),
                ).map((el) => el.textContent?.trim());
                expect(deckNames).toContain("Italian");
            } finally {
                unmount(instance);
            }
        });

        test("server 400 surfaces inline error banner; form stays open", async () => {
            vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
            vi.mocked(postDeck).mockRejectedValueOnce(
                new Error(
                    "400 name must not contain consecutive '::' separators",
                ),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                container
                    .querySelector<HTMLButtonElement>(
                        'button.btn[aria-label="Create new deck"]',
                    )!
                    .click();
                flushSync();

                const input = container.querySelector<HTMLInputElement>(
                    'input[aria-label="New deck name"]',
                );
                input!.value = "A:::B";
                input!.dispatchEvent(new Event("input", { bubbles: true }));
                input!.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        key: "Enter",
                        bubbles: true,
                    }),
                );
                await settle();

                expect(vi.mocked(postDeck)).toHaveBeenCalledTimes(1);
                // Form stays open so the user can fix-and-retry without
                // re-clicking + New deck.
                expect(
                    container.querySelector(
                        'input[aria-label="New deck name"]',
                    ),
                ).not.toBeNull();
                const banner = container.querySelector(
                    ".deck-section .error-banner",
                );
                expect(banner).not.toBeNull();
                expect(banner?.textContent).toContain("consecutive");
                // Refetch should NOT fire on failure.
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

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const btn = container.querySelector<HTMLButtonElement>(
                    'button.btn[aria-label="Create new deck"]',
                );
                expect(btn).not.toBeNull();
                expect(btn!.disabled).toBe(true);
                expect(vi.mocked(postDeck)).not.toHaveBeenCalled();
            } finally {
                unmount(instance);
            }
        });
    });

    // Phase 18-B: + Filtered deck inline form. Two-input variant of
    // the 14-C pattern (name + Anki search expression). Defaults for
    // limit and order are applied server-side (100 / "due") so the v1
    // surface stays minimal — clients only send the two required
    // fields.
    describe("Phase 18-B + Filtered", () => {
        test("button click reveals two inputs; Enter commits postFilteredDeck + refetches", async () => {
            vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
            vi.mocked(postFilteredDeck).mockResolvedValueOnce({
                id: 1_777_223_500_001,
                name: "Cram session",
            });
            const decksOkPlusCram: ApiDeckListResponse = {
                decks: [
                    decksOk.decks[0],
                    {
                        id: 1_777_223_500_001,
                        name: "Cram session",
                        level: 1,
                        new_count: 0,
                        learn_count: 0,
                        review_count: 7,
                        total_in_deck: 7,
                        // filtered: true so the deck-tree contract still
                        // round-trips — the filter flag is what makes
                        // this row distinct from a normal deck.
                        filtered: true,
                        collapsed: false,
                        preset_id: null,
                        children: [],
                    },
                ],
            };
            vi.mocked(fetchDecks).mockResolvedValueOnce(decksOkPlusCram);

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const filteredBtn =
                    container.querySelector<HTMLButtonElement>(
                        'button.btn[aria-label="Create new filtered deck"]',
                    );
                expect(filteredBtn).not.toBeNull();
                expect(filteredBtn!.disabled).toBe(false);
                filteredBtn!.click();
                flushSync();

                const nameInput = container.querySelector<HTMLInputElement>(
                    'input[aria-label="New filtered deck name"]',
                );
                const searchInput =
                    container.querySelector<HTMLInputElement>(
                        'input[aria-label="Filtered deck search expression"]',
                    );
                expect(nameInput).not.toBeNull();
                expect(searchInput).not.toBeNull();

                nameInput!.value = "Cram session";
                nameInput!.dispatchEvent(
                    new Event("input", { bubbles: true }),
                );
                searchInput!.value = "deck:Spanish is:due";
                searchInput!.dispatchEvent(
                    new Event("input", { bubbles: true }),
                );
                searchInput!.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        key: "Enter",
                        bubbles: true,
                    }),
                );
                await settle();

                expect(vi.mocked(postFilteredDeck)).toHaveBeenCalledTimes(1);
                // Wire body matches the v1 surface: only name + search,
                // no limit / order — client trusts server defaults.
                expect(vi.mocked(postFilteredDeck)).toHaveBeenCalledWith({
                    name: "Cram session",
                    search: "deck:Spanish is:due",
                });
                // Refetch ran (initial + post-create refresh).
                expect(vi.mocked(fetchDecks)).toHaveBeenCalledTimes(2);
                // Form collapses back to the buttons.
                expect(
                    container.querySelector(
                        'input[aria-label="Filtered deck search expression"]',
                    ),
                ).toBeNull();
                expect(
                    container.querySelector(
                        'button.btn[aria-label="Create new filtered deck"]',
                    ),
                ).not.toBeNull();
                // New filtered deck appears in the grid.
                const deckNames = Array.from(
                    container.querySelectorAll(
                        '[data-testid="deck-card"] .deck-card-name',
                    ),
                ).map((el) => el.textContent?.trim());
                expect(deckNames).toContain("Cram session");
            } finally {
                unmount(instance);
            }
        });

        test("server 400 (invalid search) surfaces inline error; form stays open", async () => {
            vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
            // rslib `normalize_search` rejects unmatched parens; the
            // server maps AnkiError::SearchError → 400 with the
            // "invalid search query" prefix.
            vi.mocked(postFilteredDeck).mockRejectedValueOnce(
                new Error("400 invalid search query: bad expression"),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                container
                    .querySelector<HTMLButtonElement>(
                        'button.btn[aria-label="Create new filtered deck"]',
                    )!
                    .click();
                flushSync();

                const nameInput = container.querySelector<HTMLInputElement>(
                    'input[aria-label="New filtered deck name"]',
                )!;
                const searchInput =
                    container.querySelector<HTMLInputElement>(
                        'input[aria-label="Filtered deck search expression"]',
                    )!;
                nameInput.value = "Bad cram";
                nameInput.dispatchEvent(new Event("input", { bubbles: true }));
                searchInput.value = "((((";
                searchInput.dispatchEvent(
                    new Event("input", { bubbles: true }),
                );
                searchInput.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        key: "Enter",
                        bubbles: true,
                    }),
                );
                await settle();

                expect(vi.mocked(postFilteredDeck)).toHaveBeenCalledTimes(1);
                // Form stays open so user can fix-and-retry the search
                // without losing the typed name.
                expect(
                    container.querySelector(
                        'input[aria-label="Filtered deck search expression"]',
                    ),
                ).not.toBeNull();
                // Error banner surfaces the server message verbatim.
                const banners = Array.from(
                    container.querySelectorAll(
                        ".deck-section .error-banner",
                    ),
                );
                expect(banners.length).toBeGreaterThan(0);
                expect(
                    banners.some((b) =>
                        b.textContent?.includes("invalid search query"),
                    ),
                ).toBe(true);
                // Refetch should NOT fire on failure.
                expect(vi.mocked(fetchDecks)).toHaveBeenCalledTimes(1);
            } finally {
                unmount(instance);
            }
        });

        test("button is disabled when liveDecks is null (backend offline)", async () => {
            // Same offline-guard as the + New deck button. Without a
            // live deck list we can't refresh after the POST, so we'd
            // be lying about whether the create persisted.
            vi.mocked(fetchDecks).mockRejectedValueOnce(
                new Error("backend unreachable"),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const btn = container.querySelector<HTMLButtonElement>(
                    'button.btn[aria-label="Create new filtered deck"]',
                );
                expect(btn).not.toBeNull();
                expect(btn!.disabled).toBe(true);
                expect(vi.mocked(postFilteredDeck)).not.toHaveBeenCalled();
            } finally {
                unmount(instance);
            }
        });
    });
});

// Phase 17-B: forecast bar contract tests. Same vi.resetAllMocks +
// per-block default-mock pattern as 11-B; the chart renders 7 columns
// when fetchForecast resolves, hides on rejection. Bars scale to the
// peak day's reviews so an asymmetric payload exercises the height
// math.
describe("Phase 17-B forecast bar", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.resetAllMocks();
        resetPageStub();
        // Defaults so the deck list renders and stats don't blow up.
        vi.mocked(fetchDecks).mockRejectedValue(new Error("decks default"));
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
        // Lets the test pin both column count and that zero-day bars
        // render with the .zero modifier (not the gradient bar).
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
                container.querySelectorAll<HTMLDivElement>(
                    ".forecast-section .forecast-col",
                ),
            );
            expect(cols.length).toBe(7);

            // Per-column count text matches the payload exactly.
            const counts = cols.map(
                (c) =>
                    c.querySelector<HTMLDivElement>(".forecast-count")
                        ?.textContent ?? "",
            );
            expect(counts).toEqual(["12", "8", "0", "4", "0", "6", "15"]);

            // Zero-day bars carry the .zero class so the gradient
            // hides — chart should not paint phantom bars.
            const bars = cols.map((c) =>
                c.querySelector<HTMLDivElement>(".forecast-bar"),
            );
            expect(bars[2]?.classList.contains("zero")).toBe(true);
            expect(bars[4]?.classList.contains("zero")).toBe(true);
            expect(bars[0]?.classList.contains("zero")).toBe(false);
            expect(bars[6]?.classList.contains("zero")).toBe(false);

            // Day labels live on .forecast-day in the sketch-skin
            // port (formerly .forecast-label). Today's column reads
            // "today" lowercase; +Nd labels follow.
            const labels = cols.map(
                (c) =>
                    c.querySelector<HTMLDivElement>(".forecast-day")
                        ?.textContent?.trim() ?? "",
            );
            expect(labels[0]).toBe("today");
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
            // .forecast-total (distinct from the Last-30-days
            // .recent-total) so existing tests stay scoped.
            const total = container.querySelector<HTMLDivElement>(
                ".forecast-section .forecast-total",
            )?.textContent;
            expect(total?.trim()).toBe("45");
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

            // No grid (chart hidden); the {:else if forecastError}
            // branch in +page.svelte renders the error fallback inside
            // .forecast-section. Both banners use .error-banner —
            // scoping to .forecast-section distinguishes from the
            // loadError banner emitted at the top of the dash by the
            // fetchDecks default rejection.
            expect(container.querySelector(".forecast-grid")).toBeNull();
            const banner = container.querySelector(
                ".forecast-section .error-banner",
            );
            expect(banner).not.toBeNull();
            expect(banner?.textContent).toContain("forecast unreachable");
        } finally {
            unmount(instance);
        }
    });
});
