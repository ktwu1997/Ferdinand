import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import Page from "./+page.svelte";
import { resetPageStub } from "../../test/stubs/app-stores";
import { cards as fakeCards, decks as fakeDecks } from "$lib/data";
import type {
    ApiCardListResponse,
    ApiCardSummary,
    ApiDeckListResponse,
    ApiDeckSummary,
} from "$lib/api";

// Phase 8-E + 9-P + 9-S: contract tests for the browse route. Mock
// fetchCards + fetchDecks (mount-time hydrate, parallel) plus patchDeckName
// / postCardSuspend (editor + tree mutations). mediaBase stays real so
// BrowseRow's image src resolution continues to work under jsdom (the same
// 8-A/8-C rationale). No LiveIndicator on this route, so fetchHealth stays
// untouched.
vi.mock("$lib/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("$lib/api")>();
    return {
        ...actual,
        bulkFlag: vi.fn(),
        bulkSuspend: vi.fn(),
        fetchCards: vi.fn(),
        fetchDecks: vi.fn(),
        fetchDeckConfigs: vi.fn(),
        fetchNote: vi.fn(),
        fetchNotetype: vi.fn(),
        fetchNotetypes: vi.fn(),
        fetchSavedSearches: vi.fn(),
        fetchTags: vi.fn(),
        getCardHistory: vi.fn(),
        patchDeckName: vi.fn(),
        patchDeckPreset: vi.fn(),
        patchNote: vi.fn(),
        patchNotetype: vi.fn(),
        postCardSuspend: vi.fn(),
        postCardFlag: vi.fn(),
        postMoveCards: vi.fn(),
        postSavedSearch: vi.fn(),
        deleteNote: vi.fn(),
        deleteDeck: vi.fn(),
        deleteSavedSearch: vi.fn(),
    };
});

import {
    bulkFlag,
    bulkSuspend,
    deleteDeck,
    deleteNote,
    deleteSavedSearch,
    fetchCards,
    fetchDecks,
    fetchDeckConfigs,
    fetchNote,
    fetchNotetype,
    fetchNotetypes,
    fetchSavedSearches,
    fetchTags,
    getCardHistory,
    patchDeckName,
    patchDeckPreset,
    patchNote,
    patchNotetype,
    postCardFlag,
    postCardSuspend,
    postMoveCards,
    postSavedSearch,
} from "$lib/api";

const emptyDecks: ApiDeckListResponse = { decks: [] };

function deck(
    id: number,
    name: string,
    overrides: Partial<ApiDeckSummary> = {},
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
        ...overrides,
    };
}

function card(
    id: number,
    front: string,
    back: string,
    overrides: Partial<ApiCardSummary> = {},
): ApiCardSummary {
    return {
        id,
        note_id: id,
        deck_id: 42,
        deck_name: "Spanish",
        template_idx: 0,
        front_html: front,
        back_html: back,
        tags: ["vocab"],
        state: "new",
        ease_factor: 2500,
        // Phase 17-A: every fixture defaults to flag=0 (no flag) so the
        // editor footer's chip strip starts unhighlighted. Tests that
        // need a non-default flag opt in via `overrides`.
        flag: 0,
        notetype_id: 1,
        notetype_name: "Basic",
        notetype_css: "",
        ...overrides,
    };
}

const liveThree: ApiCardListResponse = {
    total: 3,
    cards: [
        card(101, "<p>hola</p>", "<p>hello</p>"),
        card(102, "<p>gato</p>", "<p>cat</p>"),
        card(103, "<p>perro</p>", "<p>dog</p>"),
    ],
};

async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flushSync();
}

// Mirror of the constant in +page.svelte. Tests depend on knowing how
// long to advance fake timers; bumping the constant in one place
// without touching the other would surface as a spurious timeout
// failure here.
const SEARCH_DEBOUNCE_MS = 200;

function setSearch(root: HTMLElement, value: string): void {
    const input = root.querySelector<HTMLInputElement>(
        '.bx-toolbar input[type="search"]',
    );
    if (!input) throw new Error("search input not found");
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    // Phase A4-ζ: the toolbar buffers `pendingInput` until Enter or an
    // auto-commit boundary (closing quote / trailing space). For test
    // purposes we always commit by simulating Enter so the committed
    // `query` state reflects the typed value verbatim — this matches
    // pre-ζ behavior where a single bound input drove the query.
    input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    flushSync();
}

describe("BrowsePage contract", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.clearAllMocks();
        resetPageStub();
        // Default: fetchDecks fails so liveDecks stays null and the tree
        // falls back to fakeDecks — matches pre-9-S behavior so existing
        // assertions don't have to know about the new fetch. Tree-specific
        // tests override with mockResolvedValueOnce.
        vi.mocked(fetchDecks).mockRejectedValue(new Error("decks unreachable"));
        // Phase 10-A: tags ditto. Default reject preserves fakeTags rendering
        // for tests that don't care about live tags; tag-specific tests
        // override with mockResolvedValueOnce.
        vi.mocked(fetchTags).mockRejectedValue(new Error("tags unreachable"));
        // Phase 11-A: presets ditto. Default reject means the editor shows
        // "Offline — preset locked" placeholder for unrelated tests.
        vi.mocked(fetchDeckConfigs).mockRejectedValue(
            new Error("preset list unreachable"),
        );
        // Phase 16-A: fetchNote default reject so the editor seed effect
        // silently falls back to the snippet draft. Tests that exercise
        // raw-HTML-preservation override with mockResolvedValueOnce.
        vi.mocked(fetchNote).mockRejectedValue(
            new Error("fetchNote default reject"),
        );
        // Phase 18-A: fetchNotetypes default reject so the editor falls
        // back to ["Field 1","Field 2"] generic labels when fetchNote
        // resolves but no notetype list is loaded. Tests that depend
        // on real labels (Basic / Cloze / Image Occlusion) override
        // with mockResolvedValueOnce. 16-A pattern: every fetch fn
        // the page calls must be default-mocked in every beforeEach.
        vi.mocked(fetchNotetypes).mockRejectedValue(
            new Error("fetchNotetypes default reject"),
        );
        // Phase 18-C: saved-search default reject — silent fallback
        // to fakeSavedSearches in the sidebar. Tests that exercise
        // live saved-search CRUD override per-test with
        // mockResolvedValueOnce.
        vi.mocked(fetchSavedSearches).mockRejectedValue(
            new Error("fetchSavedSearches default reject"),
        );
        // Phase 20-D: history default reject — keeps the disclosure
        // closed-by-default + lazy-fetch contract from leaking
        // through into unrelated suites. The page does not call
        // getCardHistory until the user opens the panel, but the
        // $effect that invalidates the cache on selection change
        // would still trigger it if we left the mock unset and a
        // future test opens the panel without explicit mocks.
        vi.mocked(getCardHistory).mockRejectedValue(
            new Error("getCardHistory default reject"),
        );
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("loading: 5 BrowseRowSkeletons render while fetchCards is pending", async () => {
        // Never-resolving promise keeps loading=true.
        vi.mocked(fetchCards).mockImplementationOnce(
            () => new Promise(() => {}),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            flushSync();

            // Skeleton is a <div class="row" aria-hidden="true">.
            // BrowseRow is a <button class="row">. Disjoint selectors.
            const skeletons = container.querySelectorAll(".bx-table-body div.row");
            const rows = container.querySelectorAll(".bx-table-body button.bx-row-btn");
            expect(skeletons.length).toBe(5);
            expect(rows.length).toBe(0);
        } finally {
            unmount(instance);
        }
    });

    test("fetchCards success: rows render from live payload; count-tag reflects page range (Phase 11-C)", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(1);
            // Phase 11-C: PAGE_SIZE=50, initial offset=0.
            expect(vi.mocked(fetchCards)).toHaveBeenCalledWith("", 50, 0);

            expect(container.querySelectorAll(".bx-table-body div.row").length).toBe(0);
            expect(container.querySelectorAll(".bx-table-body button.bx-row-btn").length).toBe(
                3,
            );

            expect(
                container.querySelector(".bx-toolbar-count")?.textContent?.trim(),
            ).toBe("1–3 of 3");
        } finally {
            unmount(instance);
        }
    });

    test("fetchCards rejects: silent fallback to fakeCards, no error banner", async () => {
        vi.mocked(fetchCards).mockRejectedValueOnce(
            new Error("backend unreachable"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(container.querySelector(".error-banner")).toBeNull();

            // fakeCards length is 8 at time of writing — computed, not
            // hardcoded, so fixture edits flow through automatically.
            expect(container.querySelectorAll(".bx-table-body button.bx-row-btn").length).toBe(
                fakeCards.length,
            );
            expect(
                container.querySelector(".bx-toolbar-count")?.textContent?.trim(),
            ).toBe(`${fakeCards.length} of ${fakeCards.length}`);
        } finally {
            unmount(instance);
        }
    });

    test("search filter: typing narrows rows; count-tag flips from page-range to filtered-of-page", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Phase 11-C: empty-query state shows server page range.
            expect(
                container.querySelector(".bx-toolbar-count")?.textContent?.trim(),
            ).toBe("1–3 of 3");

            setSearch(container, "gato");

            expect(container.querySelectorAll(".bx-table-body button.bx-row-btn").length).toBe(
                1,
            );
            // Search-active state shows filtered-of-page so the user sees
            // "how many of THIS page match" — page-range only makes sense
            // when the full page is on display.
            expect(
                container.querySelector(".bx-toolbar-count")?.textContent?.trim(),
            ).toBe("1 of 3");
        } finally {
            unmount(instance);
        }
    });

    test("empty state: no-match query shows empty-title; clicking clear restores rows", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            setSearch(container, "definitely-no-match-xyzzy");

            const emptyTitle = container.querySelector(".bx-empty-title");
            expect(emptyTitle).not.toBeNull();
            expect(emptyTitle?.textContent).toContain("no cards match");
            expect(container.querySelectorAll(".bx-table-body button.bx-row-btn").length).toBe(
                0,
            );

            const clearBtn =
                container.querySelector<HTMLButtonElement>(".bx-empty-action");
            if (!clearBtn) throw new Error(".bx-empty-action button missing");
            clearBtn.click();
            flushSync();

            expect(container.querySelector(".bx-empty-title")).toBeNull();
            expect(container.querySelectorAll(".bx-table-body button.bx-row-btn").length).toBe(
                3,
            );
        } finally {
            unmount(instance);
        }
    });

    test("tree section toggle: clicking 'Decks' section-title collapses then re-expands", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const titles = Array.from(
                container.querySelectorAll<HTMLButtonElement>(
                    ".bx-sidebar .bx-section-title",
                ),
            );
            const decksTitle = titles.find((t) =>
                t.textContent?.includes("decks"),
            );
            if (!decksTitle) throw new Error("Decks section-title not found");

            // 4 .bx-section-body elements visible by default: decks/tags/
            // saved (each gated on its toggle, all open by default) plus
            // state (always rendered, no collapse).
            const baseline = container.querySelectorAll(
                ".bx-sidebar .bx-section-body",
            ).length;
            expect(baseline).toBe(4);

            decksTitle.click();
            flushSync();
            const afterCollapse = container.querySelectorAll(
                ".bx-sidebar .bx-section-body",
            ).length;
            expect(afterCollapse).toBe(baseline - 1);

            decksTitle.click();
            flushSync();
            const afterExpand = container.querySelectorAll(
                ".bx-sidebar .bx-section-body",
            ).length;
            expect(afterExpand).toBe(baseline);
        } finally {
            unmount(instance);
        }
    });

    describe("Phase 9-P editor mutations", () => {
        async function openDeckRename(root: HTMLElement): Promise<HTMLInputElement> {
            const pill = root.querySelector<HTMLButtonElement>(
                ".editor .deck-pill-btn",
            );
            if (!pill) throw new Error(".deck-pill-btn missing");
            pill.click();
            await settle();
            const input = root.querySelector<HTMLInputElement>(
                ".editor .deck-rename",
            );
            if (!input) throw new Error(".deck-rename input missing");
            return input;
        }

        function suspendBtn(root: HTMLElement): HTMLButtonElement {
            const btns = Array.from(
                root.querySelectorAll<HTMLButtonElement>(
                    ".editor .editor-footer .ghost-btn",
                ),
            );
            // Suspend is the middle button (Preview / Suspend|Unsuspend / Delete).
            const btn = btns.find(
                (b) => b.textContent?.trim() === "Suspend"
                    || b.textContent?.trim() === "Unsuspend",
            );
            if (!btn) throw new Error("Suspend button missing");
            return btn;
        }

        test("rename success: PATCH called with selected deck id, all matching rows re-render with new name", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(patchDeckName).mockResolvedValueOnce({
                id: 42,
                name: "Spanish (renamed)",
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const input = await openDeckRename(container);
                input.value = "Spanish (renamed)";
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
                );
                await settle();

                expect(vi.mocked(patchDeckName)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(patchDeckName)).toHaveBeenCalledWith(
                    42,
                    "Spanish (renamed)",
                );

                // Editor pill reflects new name; all 3 rows in this deck do too.
                expect(
                    container
                        .querySelector(".editor .deck-pill-btn")
                        ?.textContent?.trim(),
                ).toContain("Spanish (renamed)");
                expect(container.querySelector(".error-banner")).toBeNull();
            } finally {
                unmount(instance);
            }
        });

        test("rename 400 (empty name): error-banner surfaces server message; pill name unchanged", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(patchDeckName).mockRejectedValueOnce(
                new Error("400 name must not be empty"),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const input = await openDeckRename(container);
                // Non-empty draft so the cancel-fast-path doesn't short-circuit;
                // the 400 here represents the server's view of "empty after
                // server-side trim" (whitespace-only) for fixture purposes.
                input.value = "anything";
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
                );
                await settle();

                expect(vi.mocked(patchDeckName)).toHaveBeenCalledTimes(1);
                expect(
                    container.querySelector(".error-banner")?.textContent,
                ).toContain("name must not be empty");
                // Original name preserved on the editor pill (component falls
                // back to selected.deckName from liveCards which never updated).
            } finally {
                unmount(instance);
            }
        });

        test("suspend success: POST called, footer button flips to Unsuspend, no error banner", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(postCardSuspend).mockResolvedValueOnce({
                id: 101,
                state: "suspended",
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const btn = suspendBtn(container);
                expect(btn.textContent?.trim()).toBe("Suspend");

                btn.click();
                await settle();

                expect(vi.mocked(postCardSuspend)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(postCardSuspend)).toHaveBeenCalledWith(
                    101,
                    true,
                );
                expect(suspendBtn(container).textContent?.trim()).toBe(
                    "Unsuspend",
                );
                expect(container.querySelector(".error-banner")).toBeNull();
            } finally {
                unmount(instance);
            }
        });

        test("suspend 404 (card disappeared): error-banner surfaces server message; button stays in Suspend state", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(postCardSuspend).mockRejectedValueOnce(
                new Error("404 card 101 not found"),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const btn = suspendBtn(container);
                btn.click();
                await settle();

                expect(vi.mocked(postCardSuspend)).toHaveBeenCalledTimes(1);
                expect(
                    container.querySelector(".error-banner")?.textContent,
                ).toContain("card 101 not found");
                expect(suspendBtn(container).textContent?.trim()).toBe(
                    "Suspend",
                );
            } finally {
                unmount(instance);
            }
        });
    });

    // Phase 17-A contract tests for the per-card flag chip strip.
    // Same vi.mocked + settle helpers as 9-P; the chip strip is a 7-button
    // radiogroup so we drive it via DOM click + aria-checked / class assertions.
    describe("Phase 17-A flag chips", () => {
        function flagChips(root: HTMLElement): HTMLButtonElement[] {
            return Array.from(
                root.querySelectorAll<HTMLButtonElement>(".flag-chip"),
            );
        }

        test("snapshot flag=4 (blue) hydrates with that chip active", async () => {
            // Override the default fixture so card 101 lands with flag=4.
            // Order in liveThree means card 101 is the first row, which is
            // also the default selectedIdx=0, so the editor footer renders
            // its chip strip against this card.
            const flaggedCards: ApiCardListResponse = {
                total: 3,
                cards: [
                    card(101, "<p>hola</p>", "<p>hello</p>", { flag: 4 }),
                    card(102, "<p>gato</p>", "<p>cat</p>"),
                    card(103, "<p>perro</p>", "<p>dog</p>"),
                ],
            };
            vi.mocked(fetchCards).mockResolvedValueOnce(flaggedCards);

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const chips = flagChips(container);
                expect(chips.length).toBe(7);
                // Chip 4 (blue, the 4th in the strip — index 3) must be
                // active; all others inactive.
                expect(chips[3]?.classList.contains("active")).toBe(true);
                expect(chips[3]?.getAttribute("aria-checked")).toBe("true");
                for (const i of [0, 1, 2, 4, 5, 6]) {
                    expect(chips[i]?.classList.contains("active")).toBe(false);
                    expect(chips[i]?.getAttribute("aria-checked")).toBe("false");
                }
            } finally {
                unmount(instance);
            }
        });

        test("clicking a chip fires postCardFlag with that value and echoes the server flag", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            // Server echoes back flag=2 (orange).
            vi.mocked(postCardFlag).mockResolvedValueOnce({ id: 101, flag: 2 });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const chips = flagChips(container);
                // Chip 2 = orange (index 1).
                chips[1]?.click();
                await settle();

                expect(vi.mocked(postCardFlag)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(postCardFlag)).toHaveBeenCalledWith(101, 2);

                const after = flagChips(container);
                expect(after[1]?.classList.contains("active")).toBe(true);
                expect(container.querySelector(".error-banner")).toBeNull();
            } finally {
                unmount(instance);
            }
        });

        test("clicking the active chip clears the flag (sends 0); PATCH error surfaces banner", async () => {
            const preFlagged: ApiCardListResponse = {
                total: 3,
                cards: [
                    card(101, "<p>hola</p>", "<p>hello</p>", { flag: 3 }),
                    card(102, "<p>gato</p>", "<p>cat</p>"),
                    card(103, "<p>perro</p>", "<p>dog</p>"),
                ],
            };
            vi.mocked(fetchCards).mockResolvedValueOnce(preFlagged);
            vi.mocked(postCardFlag).mockRejectedValueOnce(
                new Error("400 flag must be between 0 and 7"),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const chips = flagChips(container);
                // Click the active green chip (index 2 = flag value 3) —
                // expected wire request is flag=0 (clear).
                chips[2]?.click();
                await settle();

                expect(vi.mocked(postCardFlag)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(postCardFlag)).toHaveBeenCalledWith(101, 0);
                // PATCH rejected → banner surfaces, persisted flag stays
                // at 3 (no optimistic UI in 17-A on purpose — the chip
                // strip would flicker on rapid double-clicks).
                expect(
                    container.querySelector(".error-banner")?.textContent,
                ).toContain("between 0 and 7");
                const after = flagChips(container);
                expect(after[2]?.classList.contains("active")).toBe(true);
            } finally {
                unmount(instance);
            }
        });
    });

    describe("Phase 9-S tree sidebar", () => {
        function treeDeckButtons(root: HTMLElement): HTMLButtonElement[] {
            const decksTitle = Array.from(
                root.querySelectorAll<HTMLButtonElement>(".bx-sidebar .bx-section-title"),
            ).find((t) => t.textContent?.includes("decks"));
            if (!decksTitle) throw new Error("Decks section-title not found");
            const section = decksTitle.closest(".bx-section");
            if (!section) throw new Error("Decks section container missing");
            return Array.from(
                section.querySelectorAll<HTMLButtonElement>(".bx-section-body .bx-deck-btn"),
            );
        }

        test("fetchDecks success: tree renders live deck names + counts (fakeDecks NOT used)", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce({
                total: 0,
                cards: [],
            });
            vi.mocked(fetchDecks).mockResolvedValueOnce({
                decks: [
                    deck(101, "日本語", { total_in_deck: 137 }),
                    deck(202, "Português", { total_in_deck: 42 }),
                ],
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const items = treeDeckButtons(container);
                expect(items.length).toBe(2);
                expect(items[0]?.textContent).toContain("日本語");
                expect(items[0]?.textContent).toContain("137");
                expect(items[1]?.textContent).toContain("Português");
                expect(items[1]?.textContent).toContain("42");

                // Sanity: a fakeDecks name (e.g. "日文 N2") is NOT in the tree.
                const fakeFirstName = fakeDecks[0]?.name;
                expect(fakeFirstName).toBeTruthy();
                const treeText = items.map((i) => i.textContent ?? "").join(" ");
                expect(treeText).not.toContain(fakeFirstName as string);
            } finally {
                unmount(instance);
            }
        });

        test("tree single-click on deck row writes deck:\"<name>\" into the search input", async () => {
            // RED-first contract: clicking a deck row in the left tree must
            // push `deck:"<name>"` into the search query so the user can
            // narrow the card list with one click. Before this wiring,
            // single-click on the deck row was dead UI (only ondblclick was
            // handled). Mirrors the existing saved-searches pattern at
            // +page.svelte:1573 onclick={() => (query = s.query)}.
            vi.mocked(fetchCards).mockResolvedValueOnce({
                total: 0,
                cards: [],
            });
            vi.mocked(fetchDecks).mockResolvedValueOnce({
                decks: [deck(101, "Sesame Street English", { total_in_deck: 14 })],
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const items = treeDeckButtons(container);
                expect(items.length).toBe(1);

                items[0]!.dispatchEvent(
                    new MouseEvent("click", { bubbles: true }),
                );
                await settle();

                // Phase A4-ζ: committed query renders as parsed chips.
                const chipTexts = Array.from(
                    container.querySelectorAll(
                        '.bx-toolbar [data-testid="browse-toolbar-chip"]',
                    ),
                ).map((c) => (c.textContent ?? "").trim());
                expect(chipTexts).toContain('deck:"Sesame Street English"');
            } finally {
                unmount(instance);
            }
        });

        test("tree rename success: dblclick → input → Enter → PATCH called, row reflects new name", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce({
                total: 0,
                cards: [],
            });
            vi.mocked(fetchDecks).mockResolvedValueOnce({
                decks: [deck(101, "日本語", { total_in_deck: 137 })],
            });
            vi.mocked(patchDeckName).mockResolvedValueOnce({
                id: 101,
                name: "日本語 N2",
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const items = treeDeckButtons(container);
                expect(items.length).toBe(1);
                items[0]!.dispatchEvent(
                    new MouseEvent("dblclick", { bubbles: true }),
                );
                await settle();

                const input = container.querySelector<HTMLInputElement>(
                    ".bx-sidebar .bx-tree-rename",
                );
                if (!input) throw new Error(".tree-rename input missing");
                input.value = "日本語 N2";
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
                );
                await settle();

                expect(vi.mocked(patchDeckName)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(patchDeckName)).toHaveBeenCalledWith(
                    101,
                    "日本語 N2",
                );

                // Tree row reflects new name; input gone (commit closed editor).
                const after = treeDeckButtons(container);
                expect(after.length).toBe(1);
                expect(after[0]?.textContent).toContain("日本語 N2");
                expect(container.querySelector(".bx-sidebar .bx-tree-rename")).toBeNull();
                expect(container.querySelector(".error-banner")).toBeNull();
            } finally {
                unmount(instance);
            }
        });

        test(
            "nested deck tree: the sidebar lists the LEAF decks with full " +
                "Parent::Child::Leaf paths + their own counts (not the bare container)",
            async () => {
                vi.mocked(fetchCards).mockResolvedValueOnce({ total: 0, cards: [] });
                vi.mocked(fetchDecks).mockResolvedValueOnce({
                    decks: [
                        deck(1, "TOEIC", {
                            collapsed: true,
                            total_in_deck: 0,
                            children: [
                                deck(2, "Vocabulary", {
                                    level: 2,
                                    total_in_deck: 0,
                                    children: [
                                        deck(3, "L600", { level: 3, total_in_deck: 200 }),
                                        deck(4, "L700", { level: 3, total_in_deck: 224 }),
                                    ],
                                }),
                            ],
                        }),
                    ],
                });

                const instance = mount(Page, { target: container, props: {} });
                try {
                    await settle();

                    const items = treeDeckButtons(container);
                    // two leaf decks — NOT the single bare "TOEIC 0" container row
                    expect(items.length).toBe(2);
                    expect(items[0]?.textContent).toContain("TOEIC::Vocabulary::L600");
                    expect(items[0]?.textContent).toContain("200");
                    expect(items[1]?.textContent).toContain("TOEIC::Vocabulary::L700");
                    expect(items[1]?.textContent).toContain("224");
                    // the bare leaf segment isn't shown on its own
                    expect(items[0]?.textContent).not.toMatch(/^L600\b/);
                } finally {
                    unmount(instance);
                }
            },
        );

        test("the sidebar has a 'back to decks' link pointing to /", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce({ total: 0, cards: [] });
            // back-to-decks is static chrome — independent of the decks fetch.
            vi.mocked(fetchDecks).mockResolvedValueOnce({
                decks: [deck(101, "日本語", { total_in_deck: 137 })],
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const sidebar = container.querySelector(".bx-sidebar");
                expect(sidebar).toBeTruthy();
                const back = Array.from(
                    sidebar!.querySelectorAll<HTMLAnchorElement>("a"),
                ).find((a) => /back to decks/i.test(a.textContent ?? ""));
                expect(
                    back,
                    "expected a 'back to decks' link in the browse sidebar",
                ).toBeTruthy();
                expect(back?.getAttribute("href")).toBe("/");
            } finally {
                unmount(instance);
            }
        });
    });

    describe("Phase 10-A tags sidebar", () => {
        function tagItems(root: HTMLElement): HTMLButtonElement[] {
            const tagsTitle = Array.from(
                root.querySelectorAll<HTMLButtonElement>(".bx-sidebar .bx-section-title"),
            ).find((t) => t.textContent?.includes("tags"));
            if (!tagsTitle) throw new Error("Tags section-title not found");
            const section = tagsTitle.closest(".bx-section");
            if (!section) throw new Error("Tags section container missing");
            return Array.from(
                section.querySelectorAll<HTMLButtonElement>(".bx-section-body .bx-tag-pill"),
            );
        }

        test("fetchTags success: sidebar renders live tag names (fakeTags NOT used)", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce({
                total: 0,
                cards: [],
            });
            vi.mocked(fetchTags).mockResolvedValueOnce({
                tags: ["aaa-live", "bbb-live", "ccc-live"],
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const items = tagItems(container);
                expect(items.length).toBe(3);
                const text = items.map((i) => i.textContent ?? "").join(" ");
                expect(text).toContain("aaa-live");
                expect(text).toContain("bbb-live");
                expect(text).toContain("ccc-live");
                // Sanity: a fake tag is NOT in the sidebar.
                // (fakeTags from $lib/data has names like "leech", "verb", etc.)
                expect(text).not.toContain("leech");
            } finally {
                unmount(instance);
            }
        });

        test("tag single-click writes tag:<name> into the search input", async () => {
            // RED-first contract: clicking a tag row in the left tree must
            // push `tag:<name>` into the search query so the user can
            // narrow the card list with one click. Mirrors the deck-row
            // fix in c4c39dd14 (which used deck:"<name>" with quotes for
            // multi-word deck names); tags don't get quotes because
            // Anki's tag syntax treats whitespace as a delimiter and
            // tags are conventionally slug-like (placeholder example
            // shows tag:leech with no quotes).
            vi.mocked(fetchCards).mockResolvedValueOnce({
                total: 0,
                cards: [],
            });
            vi.mocked(fetchTags).mockResolvedValueOnce({
                tags: ["leech"],
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const items = tagItems(container);
                expect(items.length).toBe(1);

                items[0]!.dispatchEvent(
                    new MouseEvent("click", { bubbles: true }),
                );
                await settle();

                // Phase A4-ζ: committed query renders as parsed chips.
                const chipTexts = Array.from(
                    container.querySelectorAll(
                        '.bx-toolbar [data-testid="browse-toolbar-chip"]',
                    ),
                ).map((c) => (c.textContent ?? "").trim());
                expect(chipTexts).toContain("tag:leech");
            } finally {
                unmount(instance);
            }
        });

        test("fetchTags rejects: silent fallback to fakeTags, no error banner", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce({
                total: 0,
                cards: [],
            });
            // beforeEach default already rejects fetchTags, so no override needed.

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                expect(container.querySelector(".error-banner")).toBeNull();
                // fakeTags slice(0, 10) renders — at least one item should be present.
                const items = tagItems(container);
                expect(items.length).toBeGreaterThan(0);
                expect(items.length).toBeLessThanOrEqual(10);
            } finally {
                unmount(instance);
            }
        });
    });

    describe("Phase 11-A preset assignment", () => {
        const twoPresets = {
            configs: [
                { id: 1, name: "Default" },
                { id: 555, name: "Aggressive" },
            ],
        };

        test("fetchDeckConfigs success + live deck: editor renders <select> with current preset selected", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchDecks).mockResolvedValueOnce({
                decks: [deck(42, "Spanish", { preset_id: 555 })],
            });
            vi.mocked(fetchDeckConfigs).mockResolvedValueOnce(twoPresets);

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const select =
                    container.querySelector<HTMLSelectElement>(".preset-sel");
                expect(select).not.toBeNull();
                // Both options rendered.
                const options = Array.from(
                    select!.querySelectorAll("option"),
                );
                expect(options.map((o) => o.value)).toEqual(["1", "555"]);
                // Selected value mirrors the deck's current preset_id.
                expect(select!.value).toBe("555");
                // Aria-label scopes the change to the deck name.
                expect(select!.getAttribute("aria-label")).toContain(
                    "Spanish",
                );
            } finally {
                unmount(instance);
            }
        });

        test("onchange success: patchDeckPreset called with deck_id + new preset_id; liveDecks mirror reflects new value", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchDecks).mockResolvedValueOnce({
                decks: [deck(42, "Spanish", { preset_id: 1 })],
            });
            vi.mocked(fetchDeckConfigs).mockResolvedValueOnce(twoPresets);
            vi.mocked(patchDeckPreset).mockResolvedValueOnce({
                id: 42,
                preset_id: 555,
                preset_name: "Aggressive",
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const select =
                    container.querySelector<HTMLSelectElement>(".preset-sel");
                expect(select).not.toBeNull();
                expect(select!.value).toBe("1");

                // Simulate user picking "Aggressive".
                select!.value = "555";
                select!.dispatchEvent(new Event("change", { bubbles: true }));
                await settle();

                expect(vi.mocked(patchDeckPreset)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(patchDeckPreset)).toHaveBeenCalledWith(
                    42,
                    555,
                );

                // After the mirror update, the select should still be on 555
                // (no revert-on-error path).
                expect(select!.value).toBe("555");
                // No error banner on success.
                expect(container.querySelector(".error-banner")).toBeNull();
            } finally {
                unmount(instance);
            }
        });

        test("onchange rejects: errorBanner surfaces server message; patchDeckPreset called once", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchDecks).mockResolvedValueOnce({
                decks: [deck(42, "Spanish", { preset_id: 1 })],
            });
            vi.mocked(fetchDeckConfigs).mockResolvedValueOnce(twoPresets);
            vi.mocked(patchDeckPreset).mockRejectedValueOnce(
                new Error("404 preset 555 not found"),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const select =
                    container.querySelector<HTMLSelectElement>(".preset-sel");
                select!.value = "555";
                select!.dispatchEvent(new Event("change", { bubbles: true }));
                await settle();

                expect(vi.mocked(patchDeckPreset)).toHaveBeenCalledTimes(1);
                const banner = container.querySelector(".error-banner");
                expect(banner).not.toBeNull();
                expect(banner?.textContent).toContain("404 preset 555 not found");
            } finally {
                unmount(instance);
            }
        });

        test("fake-data mode (fetchDecks rejected): editor shows 'Offline — preset locked' placeholder", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            // fetchDecks defaults to reject in beforeEach → liveDecks stays null.
            vi.mocked(fetchDeckConfigs).mockResolvedValueOnce(twoPresets);

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                expect(container.querySelector(".preset-sel")).toBeNull();
                const placeholder = Array.from(
                    container.querySelectorAll(".meta-row"),
                ).find((r) => r.textContent?.includes("Preset"));
                expect(placeholder?.textContent).toContain(
                    "Offline — preset locked",
                );
            } finally {
                unmount(instance);
            }
        });
    });

    describe("Phase 19-D card-level move-to-deck", () => {
        // Each fixture seeds liveDecks with three decks: the card's
        // current deck (id=42), a second normal deck, and a filtered
        // deck. Asserts the dropdown filtering rules: current deck
        // hidden (no-op move), filtered hidden (rslib rejects).
        const threeDecks = {
            decks: [
                deck(42, "Spanish", { preset_id: 1 }),
                deck(99, "French", { preset_id: 1 }),
                deck(7, "FilteredCustom", {
                    filtered: true,
                    preset_id: null as unknown as number,
                }),
            ],
        };

        test("dropdown lists candidate decks; current deck and filtered deck excluded", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchDecks).mockResolvedValueOnce(threeDecks);

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const moveSelect = container.querySelector<HTMLSelectElement>(
                    'select[aria-label="Move card to another deck"]',
                );
                expect(moveSelect).not.toBeNull();
                const optionValues = Array.from(
                    moveSelect!.querySelectorAll("option"),
                ).map((o) => o.value);
                // First option is the empty "Pick a deck…" placeholder;
                // remaining options are the candidate deck ids. Current
                // deck (42) and filtered deck (7) must NOT appear.
                expect(optionValues).toEqual(["", "99"]);
            } finally {
                unmount(instance);
            }
        });

        test("onchange success: postMoveCards called with [card_id], deck_id; row deck_name updates optimistically", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchDecks).mockResolvedValueOnce(threeDecks);
            vi.mocked(postMoveCards).mockResolvedValueOnce({ moved: 1 });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const moveSelect = container.querySelector<HTMLSelectElement>(
                    'select[aria-label="Move card to another deck"]',
                );
                expect(moveSelect).not.toBeNull();

                // Simulate user picking French (id=99) for the first card
                // in liveThree (id=101, deck_id defaults to 42).
                moveSelect!.value = "99";
                moveSelect!.dispatchEvent(
                    new Event("change", { bubbles: true }),
                );
                await settle();

                expect(vi.mocked(postMoveCards)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(postMoveCards)).toHaveBeenCalledWith({
                    card_ids: [101],
                    deck_id: 99,
                });

                // Editor's eyebrow shows the deck name. After the
                // optimistic mirror update, it should reflect "French".
                const eyebrow = container.querySelector(".editor .eyebrow");
                expect(eyebrow?.textContent).toContain("French");
                // No error banner on success.
                expect(container.querySelector(".error-banner")).toBeNull();
                // After the move the select resets to the placeholder
                // (empty value) so the next pick still fires onchange
                // even when targeting the same deck a second time.
                expect(moveSelect!.value).toBe("");
            } finally {
                unmount(instance);
            }
        });

        test("onchange rejects: errorBanner surfaces server message; row deck_name unchanged", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchDecks).mockResolvedValueOnce(threeDecks);
            vi.mocked(postMoveCards).mockRejectedValueOnce(
                new Error("404 deck 99 not found"),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const moveSelect = container.querySelector<HTMLSelectElement>(
                    'select[aria-label="Move card to another deck"]',
                );
                moveSelect!.value = "99";
                moveSelect!.dispatchEvent(
                    new Event("change", { bubbles: true }),
                );
                await settle();

                expect(vi.mocked(postMoveCards)).toHaveBeenCalledTimes(1);
                const banner = container.querySelector(".error-banner");
                expect(banner).not.toBeNull();
                expect(banner?.textContent).toContain(
                    "404 deck 99 not found",
                );
                // Row deck_name must NOT have been mirrored to the target
                // since the server rejected — the eyebrow still shows
                // the original deck name (cards default to "Spanish").
                const eyebrow = container.querySelector(".editor .eyebrow");
                expect(eyebrow?.textContent).toContain("Spanish");
            } finally {
                unmount(instance);
            }
        });
    });

    describe("Phase 11-C pagination", () => {
        const fullPageOf50: ApiCardListResponse = {
            total: 207,
            cards: Array.from({ length: 50 }, (_, i) =>
                card(1000 + i, `<p>front-${i}</p>`, `<p>back-${i}</p>`),
            ),
        };

        const lastPageOf7: ApiCardListResponse = {
            total: 207,
            cards: Array.from({ length: 7 }, (_, i) =>
                card(2000 + i, `<p>front-${i}</p>`, `<p>back-${i}</p>`),
            ),
        };

        test("initial fetch passes (q='', limit=50, offset=0); count-tag shows '1–50 of 207'", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(fullPageOf50);

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(fetchCards)).toHaveBeenCalledWith("", 50, 0);
                expect(
                    container.querySelector(".bx-toolbar-count")?.textContent?.trim(),
                ).toBe("1–50 of 207");
                // Prev disabled at offset 0; Next enabled because there's more.
                const prev = container.querySelector<HTMLButtonElement>(
                    'button[aria-label="Previous page"]',
                );
                const next = container.querySelector<HTMLButtonElement>(
                    'button[aria-label="Next page"]',
                );
                expect(prev?.disabled).toBe(true);
                expect(next?.disabled).toBe(false);
            } finally {
                unmount(instance);
            }
        });

        test("Next click refetches with offset=50; count-tag updates to '51–100 of 207'", async () => {
            const middlePage: ApiCardListResponse = {
                total: 207,
                cards: Array.from({ length: 50 }, (_, i) =>
                    card(2000 + i, `<p>middle-${i}</p>`, `<p>back-${i}</p>`),
                ),
            };
            vi.mocked(fetchCards)
                .mockResolvedValueOnce(fullPageOf50)
                .mockResolvedValueOnce(middlePage);

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const next = container.querySelector<HTMLButtonElement>(
                    'button[aria-label="Next page"]',
                );
                next!.click();
                await settle();

                expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(2);
                expect(vi.mocked(fetchCards)).toHaveBeenLastCalledWith(
                    "",
                    50,
                    50,
                );
                expect(
                    container.querySelector(".bx-toolbar-count")?.textContent?.trim(),
                ).toBe("51–100 of 207");
                // Prev now enabled (we left offset 0); Next still enabled
                // (50+50 < 207).
                const prev = container.querySelector<HTMLButtonElement>(
                    'button[aria-label="Previous page"]',
                );
                expect(prev?.disabled).toBe(false);
            } finally {
                unmount(instance);
            }
        });

        test("Last partial page (7 of 207 starting at offset 200): count-tag '201–207 of 207'; Next disabled", async () => {
            const middle1: ApiCardListResponse = {
                total: 207,
                cards: Array.from({ length: 50 }, (_, i) =>
                    card(3000 + i, `<p>m1-${i}</p>`, `<p>back</p>`),
                ),
            };
            const middle2: ApiCardListResponse = {
                total: 207,
                cards: Array.from({ length: 50 }, (_, i) =>
                    card(4000 + i, `<p>m2-${i}</p>`, `<p>back</p>`),
                ),
            };
            const middle3: ApiCardListResponse = {
                total: 207,
                cards: Array.from({ length: 50 }, (_, i) =>
                    card(5000 + i, `<p>m3-${i}</p>`, `<p>back</p>`),
                ),
            };
            vi.mocked(fetchCards)
                .mockResolvedValueOnce(fullPageOf50)
                .mockResolvedValueOnce(middle1)
                .mockResolvedValueOnce(middle2)
                .mockResolvedValueOnce(middle3)
                .mockResolvedValueOnce(lastPageOf7);

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                // Click Next four times to reach the 7-row tail page (offsets
                // 50, 100, 150, 200).
                for (let i = 0; i < 4; i++) {
                    const next = container.querySelector<HTMLButtonElement>(
                        'button[aria-label="Next page"]',
                    );
                    next!.click();
                    await settle();
                }

                expect(vi.mocked(fetchCards)).toHaveBeenLastCalledWith(
                    "",
                    50,
                    200,
                );
                expect(
                    container.querySelector(".bx-toolbar-count")?.textContent?.trim(),
                ).toBe("201–207 of 207");
                // Tail page reached: Next disabled, Prev still enabled.
                const next = container.querySelector<HTMLButtonElement>(
                    'button[aria-label="Next page"]',
                );
                const prev = container.querySelector<HTMLButtonElement>(
                    'button[aria-label="Previous page"]',
                );
                expect(next?.disabled).toBe(true);
                expect(prev?.disabled).toBe(false);
            } finally {
                unmount(instance);
            }
        });

        test("page fetch reject: errorBanner surfaces server message; offset stays where it was", async () => {
            vi.mocked(fetchCards)
                .mockResolvedValueOnce(fullPageOf50)
                .mockRejectedValueOnce(new Error("503 server overloaded"));

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();
                expect(
                    container.querySelector(".bx-toolbar-count")?.textContent?.trim(),
                ).toBe("1–50 of 207");

                const next = container.querySelector<HTMLButtonElement>(
                    'button[aria-label="Next page"]',
                );
                next!.click();
                await settle();

                const banner = container.querySelector(".error-banner");
                expect(banner).not.toBeNull();
                expect(banner?.textContent).toContain("503 server overloaded");
                // Offset unchanged on failure — count-tag still page 1.
                expect(
                    container.querySelector(".bx-toolbar-count")?.textContent?.trim(),
                ).toBe("1–50 of 207");
            } finally {
                unmount(instance);
            }
        });
    });

    // Phase 14-A: live note editing wires Front/Back textareas + tag
    // chips to PATCH /api/notes/{id}. Each test resets the mocks so
    // unconsumed mockResolvedValueOnce calls don't leak across siblings
    // (Phase 9-T `test_pattern_proven` lesson).
    describe("Phase 14-A note editing", () => {
        beforeEach(() => {
            vi.resetAllMocks();
            vi.mocked(fetchDecks).mockRejectedValue(
                new Error("decks unreachable"),
            );
            vi.mocked(fetchTags).mockRejectedValue(
                new Error("tags unreachable"),
            );
            vi.mocked(fetchDeckConfigs).mockRejectedValue(
                new Error("preset list unreachable"),
            );
            // Phase 16-A: default reject so editor seed effect falls
            // back to snippet draft. 14-A tests pre-date fetchNote and
            // assert against snippet-derived dirty checks; the reject
            // path keeps that exact behaviour.
            vi.mocked(fetchNote).mockRejectedValue(
                new Error("fetchNote default reject"),
            );
            // Phase 18-A: fetchNotetypes default reject — same per-block
            // pattern as the outer describe so 14-A snippet-mode editor
            // contracts keep working with the ["Front","Back"] fallback.
            vi.mocked(fetchNotetypes).mockRejectedValue(
                new Error("fetchNotetypes default reject"),
            );
            vi.mocked(fetchSavedSearches).mockRejectedValue(
                new Error("fetchSavedSearches default reject"),
            );
        });

        test("Front textarea blur with dirty draft fires patchNote with [front, back]; refetches page", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(patchNote).mockResolvedValueOnce({
                note_id: 101,
                fields: ["hola edited", "hello"],
                tags: ["vocab"],
                modified: 1_777_000_000,
            });
            // Refetch after a successful patch — second fetchCards call
            // returns the page with the updated front_html so the row
            // preview matches the new field. Returning the same
            // liveThree shape keeps the assertions on row count stable.
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const front = container.querySelector<HTMLTextAreaElement>(
                    "#field-front",
                );
                expect(front).not.toBeNull();
                front!.value = "hola edited";
                front!.dispatchEvent(new Event("input", { bubbles: true }));
                front!.dispatchEvent(new Event("blur", { bubbles: true }));
                await settle();

                expect(vi.mocked(patchNote)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(patchNote)).toHaveBeenCalledWith(101, {
                    fields: ["hola edited", "hello"],
                });
                // Refetch fired (initial mount + post-patch refresh).
                expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(2);
                expect(container.querySelector(".error-banner")).toBeNull();
            } finally {
                unmount(instance);
            }
        });

        test("Tag chip click (×) fires patchNote with the tag filtered out; mirrors into liveCards", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(patchNote).mockResolvedValueOnce({
                note_id: 101,
                fields: ["hola", "hello"],
                tags: [],
                modified: 1_777_000_000,
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                // Selected card is the first row (101) by default; its
                // single tag is "vocab" per the card() factory.
                const tagBtn = container.querySelector<HTMLButtonElement>(
                    'button.tag-removable[aria-label="Remove tag vocab"]',
                );
                expect(tagBtn).not.toBeNull();
                tagBtn!.click();
                await settle();

                expect(vi.mocked(patchNote)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(patchNote)).toHaveBeenCalledWith(101, {
                    tags: [],
                });
                // No refetch on tag patches — server tags mirror locally.
                expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(1);
                // Removed chip should be gone after the mirror.
                expect(
                    container.querySelector(
                        'button.tag-removable[aria-label="Remove tag vocab"]',
                    ),
                ).toBeNull();
            } finally {
                unmount(instance);
            }
        });

        test("+ Add tag → input → Enter commits patchNote with appended tag", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(patchNote).mockResolvedValueOnce({
                note_id: 101,
                fields: ["hola", "hello"],
                tags: ["vocab", "leech"],
                modified: 1_777_000_000,
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const addBtn = container.querySelector<HTMLButtonElement>(
                    "button.add-tag",
                );
                expect(addBtn).not.toBeNull();
                addBtn!.click();
                await settle();

                const input = container.querySelector<HTMLInputElement>(
                    "input.tag-input",
                );
                expect(input).not.toBeNull();
                input!.value = "leech";
                input!.dispatchEvent(new Event("input", { bubbles: true }));
                input!.dispatchEvent(
                    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
                );
                await settle();

                expect(vi.mocked(patchNote)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(patchNote)).toHaveBeenCalledWith(101, {
                    tags: ["vocab", "leech"],
                });
                // Input collapses back to "+ Add" button after success.
                expect(
                    container.querySelector("input.tag-input"),
                ).toBeNull();
                expect(
                    container.querySelector("button.add-tag"),
                ).not.toBeNull();
            } finally {
                unmount(instance);
            }
        });

        test("Server 400 on field PATCH surfaces error banner; drafts roll back", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(patchNote).mockRejectedValueOnce(
                new Error("400 expected 5 fields for notetype \"Image Occlusion\", got 2"),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const front = container.querySelector<HTMLTextAreaElement>(
                    "#field-front",
                );
                expect(front).not.toBeNull();
                front!.value = "hola edited";
                front!.dispatchEvent(new Event("input", { bubbles: true }));
                front!.dispatchEvent(new Event("blur", { bubbles: true }));
                await settle();

                expect(vi.mocked(patchNote)).toHaveBeenCalledTimes(1);
                const banner = container.querySelector(".error-banner");
                expect(banner).not.toBeNull();
                expect(banner?.textContent).toContain("expected 5 fields");
                // Drafts must roll back so a re-blur won't re-fire.
                expect(front!.value).toBe("hola");
                // No refetch on failure — server's view of the row
                // hasn't changed, so the local rendering must not be
                // clobbered.
                expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(1);
            } finally {
                unmount(instance);
            }
        });
    });

    // Phase 16-A: editor seed effect now goes through fetchNote so
    // raw field values (HTML preserved) drive the textareas instead of
    // the row-preview snippets. Three contract tests: fetchNote called
    // with the right note id, raw HTML survives a PATCH round-trip,
    // and a 404 from the server falls through silently to the snippet
    // draft so the editor remains usable.
    describe("Phase 16-A note GET + HTML preservation", () => {
        beforeEach(() => {
            vi.resetAllMocks();
            // Same defaults as 14-A, but fetchNote is the focus here so
            // we override per-test to verify the call shape.
            vi.mocked(fetchDecks).mockRejectedValue(
                new Error("decks unreachable"),
            );
            vi.mocked(fetchTags).mockRejectedValue(
                new Error("tags unreachable"),
            );
            vi.mocked(fetchDeckConfigs).mockRejectedValue(
                new Error("preset list unreachable"),
            );
            // Phase 18-A: fetchNotetypes default reject — editor's
            // 2-field fallback gives ["Front","Back"] labels so the
            // existing 16-A textarea[aria-label="Front"] queries
            // continue to resolve.
            vi.mocked(fetchNotetypes).mockRejectedValue(
                new Error("fetchNotetypes default reject"),
            );
            vi.mocked(fetchSavedSearches).mockRejectedValue(
                new Error("fetchSavedSearches default reject"),
            );
        });

        test("fetchNote called with selected card's note_id; raw fields seed the editor", async () => {
            // Live cards seed → first card has note_id=101. We expect
            // fetchNote(101) to fire and the front textarea to render
            // the RAW field value (with `<b>` markup intact), not the
            // stripped snippet.
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchNote).mockResolvedValueOnce({
                id: 101,
                notetype_id: 1_776_837_237_908,
                notetype_name: "Basic",
                fields: ["<b>hola raw</b>", "<i>hello raw</i>"],
                tags: ["vocab"],
                modified: 1_777_000_000,
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                expect(vi.mocked(fetchNote)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(fetchNote)).toHaveBeenCalledWith(101);

                const front = container.querySelector(
                    'textarea[aria-label="Front"]',
                ) as HTMLTextAreaElement | null;
                const back = container.querySelector(
                    'textarea[aria-label="Back"]',
                ) as HTMLTextAreaElement | null;
                expect(front).not.toBeNull();
                expect(back).not.toBeNull();
                // Raw HTML reaches the textarea — the v1 plain-text-only
                // limitation from 14-A is closed.
                expect(front?.value).toBe("<b>hola raw</b>");
                expect(back?.value).toBe("<i>hello raw</i>");
            } finally {
                unmount(instance);
            }
        });

        test("blur with no edit (HTML matches seed) does NOT fire patchNote", async () => {
            // Pre-16-A this would have diff'd true on every blur because
            // `<b>hola raw</b>` !== stripped snippet "hola raw". Pin
            // the post-16-A behaviour so a future regression that
            // accidentally seeds from snippet again would surface.
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchNote).mockResolvedValueOnce({
                id: 101,
                notetype_id: 1,
                notetype_name: "Basic",
                fields: ["<b>hola raw</b>", "hello raw"],
                tags: ["vocab"],
                modified: 1_777_000_000,
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const front = container.querySelector(
                    'textarea[aria-label="Front"]',
                ) as HTMLTextAreaElement;
                front.dispatchEvent(new Event("blur", { bubbles: true }));
                await settle();

                expect(vi.mocked(patchNote)).not.toHaveBeenCalled();
            } finally {
                unmount(instance);
            }
        });

        test("fetchNote 404 falls back to snippet draft; editor still usable", async () => {
            // Defensive path — if a card row is selected but the note
            // record was deleted concurrently from another client, the
            // server returns 404. Editor must keep the snippet so the
            // user isn't staring at a blank textarea.
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchNote).mockRejectedValueOnce(
                new Error("404 note 101 not found"),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const front = container.querySelector(
                    'textarea[aria-label="Front"]',
                ) as HTMLTextAreaElement | null;
                // Snippet seed already populated synchronously before
                // the fetchNote attempt; the silent reject leaves it.
                expect(front?.value).toBe("hola");
                // No banner — fetchNote falling back is normal-path,
                // not a user-action failure.
                expect(
                    container.querySelector(".error-banner"),
                ).toBeNull();
            } finally {
                unmount(instance);
            }
        });
    });

    // Phase 18-A: editor renders one textarea per field instead of the
    // hard-coded Front/Back pair. Field labels come from
    // fetchNotetypes (looked up by note's notetype_id). Three contract
    // tests: a Cloze 2-field note shows the actual "Text"/"Back Extra"
    // labels, a 3+ field notetype shows every field, and patchNote on
    // dirty blur sends the full per-field array (server is authoritative
    // on field count, so we don't try to elide unchanged fields).
    describe("Phase 18-A all-fields generic", () => {
        beforeEach(() => {
            vi.resetAllMocks();
            vi.mocked(fetchDecks).mockRejectedValue(
                new Error("decks unreachable"),
            );
            vi.mocked(fetchTags).mockRejectedValue(
                new Error("tags unreachable"),
            );
            vi.mocked(fetchDeckConfigs).mockRejectedValue(
                new Error("preset list unreachable"),
            );
            vi.mocked(fetchSavedSearches).mockRejectedValue(
                new Error("fetchSavedSearches default reject"),
            );
        });

        test("Cloze notetype: editor labels textareas with notetype.fields ('Text', 'Back Extra')", async () => {
            // First card's note (id=101) is set to a Cloze notetype.
            // fetchNotetypes lands first (fired in onMount along with
            // fetchCards), then fetchNote — when the latter resolves
            // we should look up notetype_id=99 in the notetype list
            // and render label="Text", label="Back Extra".
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchNotetypes).mockResolvedValueOnce({
                notetypes: [
                    {
                        id: 99,
                        name: "Cloze",
                        fields: ["Text", "Back Extra"],
                    },
                ],
            });
            vi.mocked(fetchNote).mockResolvedValueOnce({
                id: 101,
                notetype_id: 99,
                notetype_name: "Cloze",
                fields: [
                    "{{c1::cloze}} sample",
                    "extra context here",
                ],
                tags: [],
                modified: 1_777_000_000,
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                // Existing "Front"/"Back" labels must NOT show — those
                // would mean the fallback fired instead of the lookup.
                expect(
                    container.querySelector('textarea[aria-label="Front"]'),
                ).toBeNull();
                expect(
                    container.querySelector('textarea[aria-label="Back"]'),
                ).toBeNull();
                // Cloze labels render and the raw field values reach
                // the textareas (HTML preservation from 16-A still
                // applies — `{{c1::cloze}}` markup is not stripped).
                const text = container.querySelector(
                    'textarea[aria-label="Text"]',
                ) as HTMLTextAreaElement | null;
                const backExtra = container.querySelector(
                    'textarea[aria-label="Back Extra"]',
                ) as HTMLTextAreaElement | null;
                expect(text).not.toBeNull();
                expect(backExtra).not.toBeNull();
                expect(text?.value).toBe("{{c1::cloze}} sample");
                expect(backExtra?.value).toBe("extra context here");
                // Slugged ids derive from labels — `field-back-extra`
                // is the multi-word case ("Back Extra" → kebab-case).
                expect(text?.id).toBe("field-text");
                expect(backExtra?.id).toBe("field-back-extra");
            } finally {
                unmount(instance);
            }
        });

        test("3+ field notetype: editor renders every field; idle blur fires no patch", async () => {
            // Image Occlusion-style 5-field notetype. The editor must
            // render all 5 textareas (no truncation to the legacy
            // 2-field shape) and an idle blur on any of them must NOT
            // round-trip a patch — the dirty check is per-element
            // across the full array, not just the first two.
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchNotetypes).mockResolvedValueOnce({
                notetypes: [
                    {
                        id: 200,
                        name: "Image Occlusion",
                        fields: [
                            "Image",
                            "Header",
                            "Back Extra",
                            "Comments",
                            "Source",
                        ],
                    },
                ],
            });
            vi.mocked(fetchNote).mockResolvedValueOnce({
                id: 101,
                notetype_id: 200,
                notetype_name: "Image Occlusion",
                fields: [
                    '<img src="diagram.png">',
                    "Heart anatomy",
                    "Right ventricle pumps to lungs.",
                    "",
                    "Gray's Anatomy 41st ed.",
                ],
                tags: ["medicine"],
                modified: 1_777_000_000,
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const labels = [
                    "Image",
                    "Header",
                    "Back Extra",
                    "Comments",
                    "Source",
                ];
                for (const label of labels) {
                    const ta = container.querySelector(
                        `textarea[aria-label="${label}"]`,
                    ) as HTMLTextAreaElement | null;
                    expect(ta, `expected textarea for ${label}`).not.toBeNull();
                }
                // 5 textareas rendered, one per field.
                expect(
                    container.querySelectorAll("textarea.field-value").length,
                ).toBe(5);

                // Idle blur on the 4th field (which is empty by design)
                // must not fire patchNote — dirty check correctly sees
                // no diff against the seeds.
                const comments = container.querySelector(
                    'textarea[aria-label="Comments"]',
                ) as HTMLTextAreaElement;
                comments.dispatchEvent(new Event("blur", { bubbles: true }));
                await settle();
                expect(vi.mocked(patchNote)).not.toHaveBeenCalled();
            } finally {
                unmount(instance);
            }
        });

        test("dirty edit on one field of a 5-field note sends full per-field array to patchNote", async () => {
            // The PATCH /api/notes/{id} contract (14-A) takes a full
            // fields array — we assert here that 18-A doesn't try to
            // be clever and elide unchanged fields. Server validates
            // length-equals-notetype-field-count, so a partial array
            // would 400.
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchNotetypes).mockResolvedValueOnce({
                notetypes: [
                    {
                        id: 200,
                        name: "Image Occlusion",
                        fields: [
                            "Image",
                            "Header",
                            "Back Extra",
                            "Comments",
                            "Source",
                        ],
                    },
                ],
            });
            vi.mocked(fetchNote).mockResolvedValueOnce({
                id: 101,
                notetype_id: 200,
                notetype_name: "Image Occlusion",
                fields: ["img-a", "header-a", "back-a", "", "source-a"],
                tags: [],
                modified: 1_777_000_000,
            });
            vi.mocked(patchNote).mockResolvedValueOnce({
                note_id: 101,
                fields: ["img-a", "header-a", "back-a", "added", "source-a"],
                tags: [],
                modified: 1_777_000_500,
            });
            // Refetch on success; reuse liveThree so the row list
            // stays stable across the assertion.
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const comments = container.querySelector(
                    'textarea[aria-label="Comments"]',
                ) as HTMLTextAreaElement;
                comments.value = "added";
                comments.dispatchEvent(
                    new Event("input", { bubbles: true }),
                );
                comments.dispatchEvent(
                    new Event("blur", { bubbles: true }),
                );
                await settle();

                expect(vi.mocked(patchNote)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(patchNote)).toHaveBeenCalledWith(101, {
                    fields: [
                        "img-a",
                        "header-a",
                        "back-a",
                        "added",
                        "source-a",
                    ],
                });
                // Refetch fired (initial liveThree + post-patch refresh).
                expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(2);
            } finally {
                unmount(instance);
            }
        });
    });

    // Phase 18-C: persisted saved-search list. Three contract tests:
    // (a) live fetch landed → live entries render with delete button
    //     and click wires query into the toolbar; the static
    //     fakeSavedSearches fallback is no longer visible.
    // (b) "+ New saved search" inline form posts a {name, query}
    //     and appends the server response to liveSaved.
    // (c) Delete button removes the row optimistically after the
    //     server returns 200; live list shrinks by one.
    describe("Phase 18-C saved searches CRUD", () => {
        beforeEach(() => {
            vi.resetAllMocks();
            vi.mocked(fetchDecks).mockRejectedValue(
                new Error("decks unreachable"),
            );
            vi.mocked(fetchTags).mockRejectedValue(
                new Error("tags unreachable"),
            );
            vi.mocked(fetchDeckConfigs).mockRejectedValue(
                new Error("preset list unreachable"),
            );
            vi.mocked(fetchNote).mockRejectedValue(
                new Error("fetchNote default reject"),
            );
            vi.mocked(fetchNotetypes).mockRejectedValue(
                new Error("fetchNotetypes default reject"),
            );
        });

        test("fetchSavedSearches success: live entries render; click sets toolbar query", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchSavedSearches).mockResolvedValueOnce({
                searches: [
                    {
                        name: "Hard reviews",
                        query: "tag:hard is:due",
                        created_at: 1_777_000_000,
                    },
                    {
                        name: "Newly added",
                        query: "added:1",
                        created_at: 1_777_000_100,
                    },
                ],
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                // Live entries render with their server-canonical names.
                const items = container.querySelectorAll(
                    ".bx-saved-row .bx-saved-name",
                );
                const names = Array.from(items).map((n) =>
                    (n.textContent ?? "").replace(/^·\s*/, "").trim(),
                );
                expect(names).toEqual(["Hard reviews", "Newly added"]);

                // Click "Hard reviews" → query set to its expression
                // (the existing search debounce will pick up the change
                // and refetch /api/cards).
                const hardBtn = Array.from(
                    container.querySelectorAll<HTMLButtonElement>(
                        ".bx-saved-row .bx-saved-btn",
                    ),
                ).find((b) => b.textContent?.includes("Hard reviews"));
                expect(hardBtn).toBeDefined();
                hardBtn!.click();
                await settle();

                // Phase A4-ζ: committed query renders as parsed chips inside
                // the toolbar searchbar, not as the input.value (which is the
                // live `pendingInput` buffer). Assert the chip strip reflects
                // the saved-search expression.
                const chipTexts = Array.from(
                    container.querySelectorAll(
                        '.bx-toolbar [data-testid="browse-toolbar-chip"]',
                    ),
                ).map((c) => (c.textContent ?? "").trim());
                expect(chipTexts).toContain("tag:hard");
                expect(chipTexts).toContain("is:due");
            } finally {
                unmount(instance);
            }
        });

        test("'+ New saved search' inline form posts {name, query} and appends response", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchSavedSearches).mockResolvedValueOnce({
                searches: [],
            });
            vi.mocked(postSavedSearch).mockResolvedValueOnce({
                name: "Cram",
                query: "deck:Spanish is:due",
                created_at: 1_777_222_000,
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const newBtn = container.querySelector<HTMLButtonElement>(
                    'button[aria-label="Add saved search"]',
                );
                expect(newBtn).not.toBeNull();
                newBtn!.click();
                flushSync();

                const nameInput = container.querySelector<HTMLInputElement>(
                    'input[aria-label="New saved search name"]',
                );
                const queryInput = container.querySelector<HTMLInputElement>(
                    'input[aria-label="New saved search query"]',
                );
                expect(nameInput).not.toBeNull();
                expect(queryInput).not.toBeNull();

                nameInput!.value = "Cram";
                nameInput!.dispatchEvent(
                    new Event("input", { bubbles: true }),
                );
                queryInput!.value = "deck:Spanish is:due";
                queryInput!.dispatchEvent(
                    new Event("input", { bubbles: true }),
                );
                queryInput!.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        key: "Enter",
                        bubbles: true,
                    }),
                );
                await settle();

                expect(vi.mocked(postSavedSearch)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(postSavedSearch)).toHaveBeenCalledWith({
                    name: "Cram",
                    query: "deck:Spanish is:due",
                });
                // The new entry appears in the sidebar.
                const names = Array.from(
                    container.querySelectorAll(".bx-saved-row .bx-saved-name"),
                ).map((n) => (n.textContent ?? "").replace(/^·\s*/, "").trim());
                expect(names).toEqual(["Cram"]);
                // Form collapses back to "+ New saved search" button.
                expect(
                    container.querySelector(
                        'input[aria-label="New saved search name"]',
                    ),
                ).toBeNull();
                expect(
                    container.querySelector('button[aria-label="Add saved search"]'),
                ).not.toBeNull();
            } finally {
                unmount(instance);
            }
        });

        test("delete X removes the row after server returns 200", async () => {
            vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
            vi.mocked(fetchSavedSearches).mockResolvedValueOnce({
                searches: [
                    {
                        name: "Hard",
                        query: "tag:hard",
                        created_at: 1_777_000_000,
                    },
                    {
                        name: "Easy",
                        query: "tag:easy",
                        created_at: 1_777_000_100,
                    },
                ],
            });
            vi.mocked(deleteSavedSearch).mockResolvedValueOnce({
                removed_name: "Hard",
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                // Delete the first entry.
                const deleteBtn = container.querySelector<HTMLButtonElement>(
                    'button[aria-label="Delete saved search: Hard"]',
                );
                expect(deleteBtn).not.toBeNull();
                deleteBtn!.click();
                await settle();

                expect(vi.mocked(deleteSavedSearch)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(deleteSavedSearch)).toHaveBeenCalledWith(
                    "Hard",
                );
                // List shrinks; only "Easy" remains.
                const names = Array.from(
                    container.querySelectorAll(".bx-saved-row .bx-saved-name"),
                ).map((n) => (n.textContent ?? "").replace(/^·\s*/, "").trim());
                expect(names).toEqual(["Easy"]);
            } finally {
                unmount(instance);
            }
        });
    });
});

// Phase 12-A: server-side search wiring. The toolbar `query` input now
// drives a debounced fetchCards(q, ...) instead of only a local filter.
// Local filter is preserved as the silent fallback when the server
// search fails — typing should narrow rows even if the backend is down.
// Local filter is preserved as the silent fallback when the server
// search fails — typing should narrow rows even if the backend is down.
describe("BrowsePage server search wiring (Phase 12-A)", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        resetPageStub();
        vi.mocked(fetchDecks).mockRejectedValue(new Error("decks unreachable"));
        vi.mocked(fetchTags).mockRejectedValue(new Error("tags unreachable"));
        vi.mocked(fetchDeckConfigs).mockRejectedValue(
            new Error("preset list unreachable"),
        );
        // Phase 16-A: default reject so the editor seed effect doesn't
        // hold up the search-wire timing assertions.
        vi.mocked(fetchNote).mockRejectedValue(
            new Error("fetchNote default reject"),
        );
        // Phase 18-A: fetchNotetypes default reject so the editor falls
        // back to ["Field 1","Field 2"] generic labels when fetchNote
        // resolves but no notetype list is loaded. Tests that depend
        // on real labels (Basic / Cloze / Image Occlusion) override
        // with mockResolvedValueOnce. 16-A pattern: every fetch fn
        // the page calls must be default-mocked in every beforeEach.
        vi.mocked(fetchNotetypes).mockRejectedValue(
            new Error("fetchNotetypes default reject"),
        );
        // Phase 18-C: saved-search default reject — silent fallback
        // to fakeSavedSearches in the sidebar. Tests that exercise
        // live saved-search CRUD override per-test with
        // mockResolvedValueOnce.
        vi.mocked(fetchSavedSearches).mockRejectedValue(
            new Error("fetchSavedSearches default reject"),
        );
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
        vi.useRealTimers();
    });

    // Fake-timer-aware settle: after a setTimeout fires synchronously
    // via advanceTimersByTime, the inner fetchCards().then() callback is
    // still a microtask away from running, so we drain microtasks too.
    async function settleFake(): Promise<void> {
        for (let i = 0; i < 10; i++) await Promise.resolve();
        flushSync();
    }

    test("typing fires debounced server fetchCards with q after 200ms; resets pageOffset and selectedIdx", async () => {
        const initialPage: ApiCardListResponse = {
            total: 1000,
            cards: [
                card(1, "<p>hola</p>", "<p>hello</p>"),
                card(2, "<p>gato</p>", "<p>cat</p>"),
                card(3, "<p>perro</p>", "<p>dog</p>"),
            ],
        };
        const searchPage: ApiCardListResponse = {
            total: 7,
            cards: [card(42, "<p>gato gato</p>", "<p>cat cat</p>")],
        };
        // Order matters: onMount fires fetchCards("", 50, 0) first; then
        // the debounce $effect fires fetchCards("gato", 50, 0).
        vi.mocked(fetchCards)
            .mockResolvedValueOnce(initialPage)
            .mockResolvedValueOnce(searchPage);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settleFake();
            // Sanity: initial empty-query fetch fired exactly once.
            expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(fetchCards)).toHaveBeenNthCalledWith(1, "", 50, 0);

            setSearch(container, "gato");
            // Debounce hasn't elapsed yet — no extra request.
            expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
            await settleFake();

            expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(2);
            expect(vi.mocked(fetchCards)).toHaveBeenNthCalledWith(
                2,
                "gato",
                50,
                0,
            );
            // Server response replaced the page; count-tag falls into the
            // "X-Y of Z" path because filter narrows nothing further on a
            // single-row server result.
            expect(
                container.querySelector(".bx-toolbar-count")?.textContent?.trim(),
            ).toBe("1 of 1");
        } finally {
            unmount(instance);
        }
    });

    test("rapid typing collapses to a single debounced request with the latest q", async () => {
        const initialPage: ApiCardListResponse = {
            total: 3,
            cards: [
                card(1, "<p>hola</p>", "<p>hello</p>"),
                card(2, "<p>gato</p>", "<p>cat</p>"),
                card(3, "<p>perro</p>", "<p>dog</p>"),
            ],
        };
        const searchFinal: ApiCardListResponse = {
            total: 1,
            cards: [card(99, "<p>gato</p>", "<p>cat</p>")],
        };
        vi.mocked(fetchCards)
            .mockResolvedValueOnce(initialPage)
            .mockResolvedValueOnce(searchFinal);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settleFake();
            expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(1);

            // Phase A4-ζ chip toolbar: type into the pending buffer
            // without committing (no Enter, no trailing space) until
            // the final value lands; only the auto-commit on the last
            // value should hit the debounced fetch path.
            const input = container.querySelector<HTMLInputElement>(
                '.bx-toolbar input[type="search"]',
            );
            if (!input) throw new Error("search input not found");
            const typePending = (v: string) => {
                input.value = v;
                input.dispatchEvent(new Event("input", { bubbles: true }));
                flushSync();
            };
            typePending("g");
            await vi.advanceTimersByTimeAsync(50);
            typePending("ga");
            await vi.advanceTimersByTimeAsync(50);
            // Trailing space triggers maybeAutoCommit → query="gato".
            typePending("gato ");
            await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
            await settleFake();

            // 1 initial + 1 debounced = 2 total. Critically NOT 4 (one per
            // keystroke) — that would shower the server with intermediate
            // queries the user never finished typing.
            expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(2);
            expect(vi.mocked(fetchCards)).toHaveBeenNthCalledWith(
                2,
                "gato",
                50,
                0,
            );
        } finally {
            unmount(instance);
        }
    });

    test("server search rejection: silent fallback (no banner), local filter still narrows existing rows", async () => {
        const initialPage: ApiCardListResponse = {
            total: 3,
            cards: [
                card(1, "<p>hola</p>", "<p>hello</p>"),
                card(2, "<p>gato</p>", "<p>cat</p>"),
                card(3, "<p>perro</p>", "<p>dog</p>"),
            ],
        };
        vi.mocked(fetchCards)
            .mockResolvedValueOnce(initialPage)
            .mockRejectedValueOnce(new Error("503 search unavailable"));

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settleFake();
            expect(
                container.querySelectorAll(".bx-table-body button.bx-row-btn").length,
            ).toBe(3);

            setSearch(container, "gato");
            await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
            await settleFake();

            // Server fetch happened and rejected — but no banner.
            expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(2);
            expect(container.querySelector(".error-banner")).toBeNull();

            // Local fallback: liveCards untouched (still 3 rows server-side),
            // local substring filter narrows display to "gato" only.
            expect(
                container.querySelectorAll(".bx-table-body button.bx-row-btn").length,
            ).toBe(1);
            // Search-active count-tag flips to "F of L" form regardless
            // of whether server returned — driven by query !== "".
            expect(
                container.querySelector(".bx-toolbar-count")?.textContent?.trim(),
            ).toBe("1 of 3");
        } finally {
            unmount(instance);
        }
    });
});

// Phase 13-A: contract tests for the delete-note flow. The Delete button
// in the editor footer was a placeholder pre-13-A; once wired, it goes
// through window.confirm → deleteNote → liveCards filter + liveTotal
// decrement. Failure surfaces in the same .error-banner slot as the
// other editor mutations (rename / suspend / preset).
describe("BrowsePage delete-note flow (Phase 13-A)", () => {
    let container: HTMLDivElement;
    let confirmSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetAllMocks();
        resetPageStub();
        // Same default fallbacks as the outer describe so the editor
        // gets liveCards/liveDecks for the click target.
        vi.mocked(fetchDecks).mockRejectedValue(
            new Error("decks unreachable"),
        );
        vi.mocked(fetchTags).mockRejectedValue(new Error("tags unreachable"));
        vi.mocked(fetchDeckConfigs).mockRejectedValue(
            new Error("preset list unreachable"),
        );
        vi.mocked(fetchNote).mockRejectedValue(
            new Error("fetchNote default reject"),
        );
        vi.mocked(fetchNotetypes).mockRejectedValue(
            new Error("fetchNotetypes default reject"),
        );
        // Phase 18-C: saved-search default reject — silent fallback
        // to fakeSavedSearches in the sidebar. Tests that exercise
        // live saved-search CRUD override per-test with
        // mockResolvedValueOnce.
        vi.mocked(fetchSavedSearches).mockRejectedValue(
            new Error("fetchSavedSearches default reject"),
        );
        // Default to "user clicked OK" so test bodies don't repeat the
        // spy install. Tests that need cancellation override per-call.
        confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        confirmSpy.mockRestore();
        container.remove();
    });

    function clickDeleteButton(root: HTMLElement): void {
        const btn = Array.from(
            root.querySelectorAll<HTMLButtonElement>(".editor-footer .ghost-btn"),
        ).find((b) => b.textContent?.trim().startsWith("Delete"));
        if (!btn) throw new Error("Delete button not found in editor-footer");
        btn.click();
        flushSync();
    }

    test("clicking Delete fires window.confirm + deleteNote with the selected card's note_id", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
        vi.mocked(deleteNote).mockResolvedValueOnce({ removed_card_count: 1 });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // First card in liveThree is id=101, note_id=101.
            clickDeleteButton(container);
            await settle();

            expect(confirmSpy).toHaveBeenCalledTimes(1);
            expect(vi.mocked(deleteNote)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(deleteNote)).toHaveBeenCalledWith(101);

            // Row dropped from list — 3 → 2 visible. count-tag also updates
            // to reflect the new total (3 - 1 = 2).
            expect(
                container.querySelectorAll(".bx-table-body button.bx-row-btn").length,
            ).toBe(2);
            expect(
                container.querySelector(".bx-toolbar-count")?.textContent?.trim(),
            ).toBe("1–2 of 2");
        } finally {
            unmount(instance);
        }
    });

    test("cancelling the confirm prompt does not call deleteNote (rows unchanged)", async () => {
        confirmSpy.mockReturnValue(false);
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            clickDeleteButton(container);
            await settle();

            expect(confirmSpy).toHaveBeenCalledTimes(1);
            expect(vi.mocked(deleteNote)).not.toHaveBeenCalled();
            // List intact at 3 rows.
            expect(
                container.querySelectorAll(".bx-table-body button.bx-row-btn").length,
            ).toBe(3);
        } finally {
            unmount(instance);
        }
    });

    test("server reject (e.g. 404) surfaces inline error-banner; rows untouched", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
        vi.mocked(deleteNote).mockRejectedValueOnce(
            new Error("404 note 101 not found"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            clickDeleteButton(container);
            await settle();

            const banner = container.querySelector(".error-banner");
            expect(banner).not.toBeNull();
            expect(banner?.textContent).toContain("404");
            // No rows removed since the server rejected.
            expect(
                container.querySelectorAll(".bx-table-body button.bx-row-btn").length,
            ).toBe(3);
        } finally {
            unmount(instance);
        }
    });

    test("multi-card note: liveTotal subtracts removed_card_count from the server response", async () => {
        // A Cloze note with 3 generated cards: server returns
        // removed_card_count=3 even though only 2 of those happen to be
        // on the current page. liveTotal must drop by the full 3.
        const totalFiveWithCloze: ApiCardListResponse = {
            total: 5,
            cards: [
                { ...card(201, "<p>{{c1}}</p>", "<p>cloze</p>"), note_id: 999 },
                { ...card(202, "<p>{{c2}}</p>", "<p>cloze</p>"), note_id: 999 },
                card(301, "<p>other</p>", "<p>note</p>"),
            ],
        };
        vi.mocked(fetchCards).mockResolvedValueOnce(totalFiveWithCloze);
        vi.mocked(deleteNote).mockResolvedValueOnce({ removed_card_count: 3 });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Selecting first row picks up note_id=999.
            clickDeleteButton(container);
            await settle();

            expect(vi.mocked(deleteNote)).toHaveBeenCalledWith(999);
            // 2 of 3 cards for note 999 were on this page; 1 unrelated
            // card remains. count-tag reflects total = 5 - 3 = 2.
            expect(
                container.querySelectorAll(".bx-table-body button.bx-row-btn").length,
            ).toBe(1);
            expect(
                container.querySelector(".bx-toolbar-count")?.textContent?.trim(),
            ).toBe("1–1 of 2");
        } finally {
            unmount(instance);
        }
    });
});

// Phase 15-A: tree-sidebar deck delete. Mirrors the deleteNote
// describe — window.confirm gate → deleteDeck → liveDecks filter.
// Server-side guards (Default protected, missing 404) are surfaced
// in the same .error-banner slot as the rename/suspend/preset paths.
describe("BrowsePage delete-deck flow (Phase 15-A)", () => {
    let container: HTMLDivElement;
    let confirmSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetAllMocks();
        resetPageStub();
        // Tree-delete tests need fetchDecks to succeed so liveDecks is
        // populated and the X button renders. Per-test mockResolvedValueOnce
        // overrides happen below.
        vi.mocked(fetchTags).mockRejectedValue(new Error("tags unreachable"));
        vi.mocked(fetchDeckConfigs).mockRejectedValue(
            new Error("preset list unreachable"),
        );
        vi.mocked(fetchNote).mockRejectedValue(
            new Error("fetchNote default reject"),
        );
        vi.mocked(fetchNotetypes).mockRejectedValue(
            new Error("fetchNotetypes default reject"),
        );
        // Phase 18-C: saved-search default reject — silent fallback
        // to fakeSavedSearches in the sidebar. Tests that exercise
        // live saved-search CRUD override per-test with
        // mockResolvedValueOnce.
        vi.mocked(fetchSavedSearches).mockRejectedValue(
            new Error("fetchSavedSearches default reject"),
        );
        confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        confirmSpy.mockRestore();
        container.remove();
    });

    // Scope to the Decks section so .item / .item-wrap selectors don't
    // collide with rows from the Tags / Saved-searches sections, which
    // also use the .section-items / .item class names.
    function decksSection(root: HTMLElement): Element {
        const decksTitle = Array.from(
            root.querySelectorAll<HTMLButtonElement>(".bx-sidebar .bx-section-title"),
        ).find((t) => t.textContent?.includes("decks"));
        if (!decksTitle) throw new Error("Decks section-title not found");
        const section = decksTitle.closest(".bx-section");
        if (!section) throw new Error("Decks section container missing");
        return section;
    }
    function deckRowButtons(root: HTMLElement): HTMLButtonElement[] {
        return Array.from(
            decksSection(root).querySelectorAll<HTMLButtonElement>(
                ".bx-section-body .bx-deck-btn",
            ),
        );
    }
    function deckRowWraps(root: HTMLElement): HTMLElement[] {
        return Array.from(
            decksSection(root).querySelectorAll<HTMLElement>(
                ".bx-section-body .bx-deck-row",
            ),
        );
    }
    function deleteXButton(
        root: HTMLElement,
        deckName: string,
    ): HTMLButtonElement {
        const btn = Array.from(
            decksSection(root).querySelectorAll<HTMLButtonElement>(
                ".bx-section-body .bx-row-x",
            ),
        ).find(
            (b) => b.getAttribute("aria-label") === `Delete deck ${deckName}`,
        );
        if (!btn) throw new Error(`delete-x button for "${deckName}" not found`);
        return btn;
    }

    test("hover-X click → confirm → deleteDeck called with row id; row filtered from tree", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce({ total: 0, cards: [] });
        vi.mocked(fetchDecks).mockResolvedValueOnce({
            decks: [
                deck(101, "日本語", { total_in_deck: 137 }),
                deck(202, "Português", { total_in_deck: 0 }),
            ],
        });
        vi.mocked(deleteDeck).mockResolvedValueOnce({
            removed_deck_id: 202,
            removed_card_count: 0,
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Both rows render with their X buttons.
            expect(deckRowWraps(container).length).toBe(2);

            const xBtn = deleteXButton(container, "Português");
            xBtn.click();
            await settle();

            expect(confirmSpy).toHaveBeenCalledTimes(1);
            expect(vi.mocked(deleteDeck)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(deleteDeck)).toHaveBeenCalledWith(202);

            // Tree shrinks: only the surviving deck remains.
            const remaining = deckRowButtons(container);
            expect(remaining.length).toBe(1);
            expect(remaining[0]?.textContent).toContain("日本語");
            expect(container.querySelector(".error-banner")).toBeNull();
            // No card refetch when removed_card_count=0 (the empty-deck
            // cleanup branch). Mount-time fetchCards counts as 1.
            expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(1);
        } finally {
            unmount(instance);
        }
    });

    test("cancel confirm: deleteDeck NOT called; row remains", async () => {
        confirmSpy.mockReturnValue(false);
        vi.mocked(fetchCards).mockResolvedValueOnce({ total: 0, cards: [] });
        vi.mocked(fetchDecks).mockResolvedValueOnce({
            decks: [deck(101, "日本語", { total_in_deck: 137 })],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const xBtn = deleteXButton(container, "日本語");
            xBtn.click();
            await settle();

            expect(confirmSpy).toHaveBeenCalledTimes(1);
            expect(vi.mocked(deleteDeck)).not.toHaveBeenCalled();
            // Row still there.
            expect(deckRowButtons(container).length).toBe(1);
        } finally {
            unmount(instance);
        }
    });

    test("server 400 (e.g. Default attempt slipping past UI): error-banner surfaces server message; row preserved", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce({ total: 0, cards: [] });
        vi.mocked(fetchDecks).mockResolvedValueOnce({
            decks: [deck(101, "日本語", { total_in_deck: 137 })],
        });
        vi.mocked(deleteDeck).mockRejectedValueOnce(
            new Error("400 Default deck cannot be deleted"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const xBtn = deleteXButton(container, "日本語");
            xBtn.click();
            await settle();

            expect(vi.mocked(deleteDeck)).toHaveBeenCalledTimes(1);
            const banner = container.querySelector(".error-banner");
            expect(banner).not.toBeNull();
            expect(banner?.textContent).toContain("Default deck cannot be deleted");
            // Row preserved on the rejected delete.
            expect(deckRowButtons(container).length).toBe(1);
        } finally {
            unmount(instance);
        }
    });
});

describe("BrowsePage Card Templates panel (Phase 19-A)", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.clearAllMocks();
        resetPageStub();
        // Same default-reject pattern as the main contract suite — every
        // fetch the page calls must be mocked or jsdom warns. Tests that
        // need a real response override per-test with `mockResolvedValueOnce`.
        vi.mocked(fetchDecks).mockRejectedValue(new Error("decks unreachable"));
        vi.mocked(fetchTags).mockRejectedValue(new Error("tags unreachable"));
        vi.mocked(fetchDeckConfigs).mockRejectedValue(
            new Error("preset list unreachable"),
        );
        vi.mocked(fetchNotetypes).mockRejectedValue(
            new Error("fetchNotetypes default reject"),
        );
        vi.mocked(fetchSavedSearches).mockRejectedValue(
            new Error("fetchSavedSearches default reject"),
        );
        // Default fetchNotetype reject — tests that exercise the panel
        // override per-test. Required because the editor's $effect on
        // currentNotetypeId fires loadTemplatesIfNeeded the moment a
        // notetype id lands, even if the panel is closed.
        vi.mocked(fetchNotetype).mockRejectedValue(
            new Error("fetchNotetype default reject"),
        );
        // Phase 20-D: history default reject — same rationale as the
        // main contract suite (closed-by-default panel won't fire,
        // but a defensive mock keeps the suite robust against future
        // tests that exercise the disclosure here).
        vi.mocked(getCardHistory).mockRejectedValue(
            new Error("getCardHistory default reject"),
        );
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    function basicCard(): ApiCardSummary {
        // Notetype id matches the seeded Basic notetype on the dev
        // collection; tests don't actually hit it (fetchNotetype is
        // mocked) but using a realistic value keeps the assertions
        // readable when one greps for the literal id.
        return card(101, "<p>hola</p>", "<p>hello</p>", {
            notetype_id: 1_776_837_237_908,
            notetype_name: "Basic",
        });
    }

    function openTemplatesPanel(root: HTMLElement) {
        const details = root.querySelector<HTMLDetailsElement>(
            ".templates-panel",
        );
        if (!details) throw new Error("templates panel not found");
        // JSDOM doesn't reliably auto-fire `toggle` when summary is
        // clicked, so we drive the disclosure semantics explicitly:
        // flip `open` (Svelte's `bind:open` reads this back) and
        // dispatch the matching `toggle` event so the ontoggle handler
        // fires the lazy load — same behavior real browsers provide
        // automatically on a summary click.
        details.open = true;
        details.dispatchEvent(new Event("toggle"));
    }

    test("opening the panel calls fetchNotetype with the selected note's notetype_id and renders one row per template", async () => {
        // Mount with one card live so currentNotetypeId is populated by
        // fetchNote, then open the disclosure to fire the lazy load.
        // Two-template notetype (Basic-and-reverse-style) so the
        // length assertion can't pass by accident on a Basic singleton.
        vi.mocked(fetchCards).mockResolvedValueOnce({
            total: 1,
            cards: [basicCard()],
        });
        vi.mocked(fetchNote).mockResolvedValueOnce({
            id: 101,
            notetype_id: 1_776_837_237_908,
            notetype_name: "Basic",
            fields: ["hola", "hello"],
            tags: ["vocab"],
            modified: 1_777_000_000,
        });
        vi.mocked(fetchNotetype).mockResolvedValueOnce({
            id: 1_776_837_237_908,
            name: "Basic",
            fields: ["Front", "Back"],
            templates: [
                { ord: 0, name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}" },
                {
                    ord: 1,
                    name: "Card 2",
                    qfmt: "{{Back}}",
                    afmt: "{{Front}}",
                },
            ],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Panel collapsed → no fetchNotetype yet (the lazy-load
            // pattern keeps the network quiet for users who never
            // expand the disclosure).
            expect(vi.mocked(fetchNotetype)).not.toHaveBeenCalled();

            openTemplatesPanel(container);
            await settle();

            expect(vi.mocked(fetchNotetype)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(fetchNotetype)).toHaveBeenCalledWith(
                1_776_837_237_908,
            );

            const rows = container.querySelectorAll(".template-row");
            expect(rows.length).toBe(2);
            // Each row gets a Question + Answer textarea seeded with
            // the server-canonical qfmt/afmt strings.
            const qfmt0 = container.querySelector<HTMLTextAreaElement>(
                "#qfmt-0",
            );
            const afmt0 = container.querySelector<HTMLTextAreaElement>(
                "#afmt-0",
            );
            const qfmt1 = container.querySelector<HTMLTextAreaElement>(
                "#qfmt-1",
            );
            expect(qfmt0?.value).toBe("{{Front}}");
            expect(afmt0?.value).toBe("{{Back}}");
            expect(qfmt1?.value).toBe("{{Back}}");
        } finally {
            unmount(instance);
        }
    });

    test("editing qfmt + clicking Save fires patchNotetype with that ord only; siblings untouched", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce({
            total: 1,
            cards: [basicCard()],
        });
        vi.mocked(fetchNote).mockResolvedValueOnce({
            id: 101,
            notetype_id: 1_776_837_237_908,
            notetype_name: "Basic",
            fields: ["hola", "hello"],
            tags: [],
            modified: 1_777_000_000,
        });
        const baseline = {
            id: 1_776_837_237_908,
            name: "Basic",
            fields: ["Front", "Back"],
            templates: [
                { ord: 0, name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}" },
                {
                    ord: 1,
                    name: "Card 2",
                    qfmt: "{{Back}}",
                    afmt: "{{Front}}",
                },
            ],
        };
        vi.mocked(fetchNotetype).mockResolvedValueOnce(baseline);
        // Server returns the updated state — qfmt for ord 0 has the
        // new value, ord 1 stays the same. Page should re-seed both
        // drafts from this canonical response.
        vi.mocked(patchNotetype).mockResolvedValueOnce({
            ...baseline,
            templates: [
                {
                    ord: 0,
                    name: "Card 1",
                    qfmt: "{{Front}}<hr>",
                    afmt: "{{Back}}",
                },
                baseline.templates[1]!,
            ],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            openTemplatesPanel(container);
            await settle();

            // Edit qfmt for ord 0, then click that row's Save button.
            const qfmt0 = container.querySelector<HTMLTextAreaElement>(
                "#qfmt-0",
            );
            if (!qfmt0) throw new Error("qfmt-0 not found");
            qfmt0.value = "{{Front}}<hr>";
            qfmt0.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            const saveButtons = container.querySelectorAll<HTMLButtonElement>(
                ".template-save",
            );
            expect(saveButtons.length).toBe(2);
            // Sibling row's Save stays disabled because its drafts
            // still match the seed; the edited row's Save lights up.
            expect(saveButtons[0]?.disabled).toBe(false);
            expect(saveButtons[1]?.disabled).toBe(true);

            saveButtons[0]?.click();
            await settle();

            expect(vi.mocked(patchNotetype)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(patchNotetype)).toHaveBeenCalledWith(
                1_776_837_237_908,
                {
                    templates: [
                        { ord: 0, qfmt: "{{Front}}<hr>", afmt: "{{Back}}" },
                    ],
                },
            );
            // After server response the row's Save button goes back to
            // disabled because draft now matches the canonical value.
            const saveAfter = container.querySelectorAll<HTMLButtonElement>(
                ".template-save",
            );
            expect(saveAfter[0]?.disabled).toBe(true);
        } finally {
            unmount(instance);
        }
    });

    test("server 400 on save surfaces in templates-error (panel-scoped); main error-banner stays clean", async () => {
        // Defensive: a user could PATCH with content that rslib rejects
        // (e.g. an unbalanced `{{Field}}` tag) — that error must surface
        // inside the panel so the user can retry without losing the
        // editor's main flow / global error state. Mirrors the 18-C
        // panel-scoped error pattern for saved searches.
        vi.mocked(fetchCards).mockResolvedValueOnce({
            total: 1,
            cards: [basicCard()],
        });
        vi.mocked(fetchNote).mockResolvedValueOnce({
            id: 101,
            notetype_id: 1_776_837_237_908,
            notetype_name: "Basic",
            fields: ["hola", "hello"],
            tags: [],
            modified: 1_777_000_000,
        });
        vi.mocked(fetchNotetype).mockResolvedValueOnce({
            id: 1_776_837_237_908,
            name: "Basic",
            fields: ["Front", "Back"],
            templates: [
                { ord: 0, name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}" },
            ],
        });
        vi.mocked(patchNotetype).mockRejectedValueOnce(
            new Error("400 qfmt must not be empty"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            openTemplatesPanel(container);
            await settle();

            const qfmt0 = container.querySelector<HTMLTextAreaElement>(
                "#qfmt-0",
            );
            if (!qfmt0) throw new Error("qfmt-0 not found");
            qfmt0.value = "  ";
            qfmt0.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            const saveBtn = container.querySelector<HTMLButtonElement>(
                ".template-save",
            );
            saveBtn?.click();
            await settle();

            // Panel-scoped error renders.
            const panelErr = container.querySelector(".templates-error");
            expect(panelErr).not.toBeNull();
            expect(panelErr?.textContent).toContain("qfmt must not be empty");
            // Main editor banner stays untouched — important because
            // the templates panel is opt-in surface; corrupting the
            // global banner would surprise users who didn't open it.
            expect(container.querySelector(".error-banner")).toBeNull();
        } finally {
            unmount(instance);
        }
    });
});

describe("BrowsePage Review History panel (Phase 20-D)", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.clearAllMocks();
        resetPageStub();
        // Same default-reject pattern as the other browse suites — every
        // fetch the page calls must be mocked or jsdom warns. Tests that
        // need a real response override per-test with `mockResolvedValueOnce`.
        vi.mocked(fetchDecks).mockRejectedValue(new Error("decks unreachable"));
        vi.mocked(fetchTags).mockRejectedValue(new Error("tags unreachable"));
        vi.mocked(fetchDeckConfigs).mockRejectedValue(
            new Error("preset list unreachable"),
        );
        vi.mocked(fetchNote).mockRejectedValue(
            new Error("fetchNote default reject"),
        );
        vi.mocked(fetchNotetype).mockRejectedValue(
            new Error("fetchNotetype default reject"),
        );
        vi.mocked(fetchNotetypes).mockRejectedValue(
            new Error("fetchNotetypes default reject"),
        );
        vi.mocked(fetchSavedSearches).mockRejectedValue(
            new Error("fetchSavedSearches default reject"),
        );
        // History default reject — overridden per-test with
        // mockResolvedValueOnce. Tests rely on getCardHistory only
        // firing after the disclosure opens (lazy contract).
        vi.mocked(getCardHistory).mockRejectedValue(
            new Error("getCardHistory default reject"),
        );
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    function openHistoryPanel(root: HTMLElement) {
        const details = root.querySelector<HTMLDetailsElement>(
            ".history-panel",
        );
        if (!details) throw new Error("history panel not found");
        // Same JSDOM gotcha as the templates panel: setting
        // `details.open = true` does NOT auto-fire `toggle`. We must
        // dispatch the matching event explicitly so the ontoggle
        // handler fires the lazy load — real browsers do this
        // automatically on a summary click.
        details.open = true;
        details.dispatchEvent(new Event("toggle"));
    }

    test("opening the panel calls getCardHistory once with the selected card id and renders one row per entry", async () => {
        // Two-card live list so the second test (card switch) has a
        // sibling to pick. First test only opens the disclosure on
        // card 101 so it asserts a single fetch with that id.
        vi.mocked(fetchCards).mockResolvedValueOnce({
            total: 2,
            cards: [
                card(101, "<p>hola</p>", "<p>hello</p>"),
                card(202, "<p>gato</p>", "<p>cat</p>"),
            ],
        });
        vi.mocked(getCardHistory).mockResolvedValueOnce({
            card_id: 101,
            total: 2,
            entries: [
                {
                    id: 1_777_000_000_000,
                    button: 3,
                    button_label: "good",
                    interval_days: 4,
                    last_interval_days: 1,
                    ease_percent: 250,
                    taken_ms: 4200,
                    review_kind: "review",
                },
                {
                    id: 1_776_900_000_000,
                    button: 2,
                    button_label: "hard",
                    interval_days: 1,
                    last_interval_days: 1,
                    ease_percent: 240,
                    taken_ms: 6700,
                    review_kind: "review",
                },
            ],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Panel collapsed → no getCardHistory call yet (lazy
            // contract: the disclosure must not burn requests for
            // users who never expand it).
            expect(vi.mocked(getCardHistory)).not.toHaveBeenCalled();

            openHistoryPanel(container);
            await settle();

            expect(vi.mocked(getCardHistory)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(getCardHistory)).toHaveBeenCalledWith(101);

            const rows = container.querySelectorAll(".history-row");
            expect(rows.length).toBe(2);
            // Spot-check first row carries the button label so the
            // wire→display mapping is exercised end to end.
            expect(rows[0]?.textContent).toContain("Good");
        } finally {
            unmount(instance);
        }
    });

    test("switching between two cards refetches history with the new id", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce({
            total: 2,
            cards: [
                card(101, "<p>hola</p>", "<p>hello</p>"),
                card(202, "<p>gato</p>", "<p>cat</p>"),
            ],
        });
        // First open targets card 101, then we click row for 202 and
        // re-open; mockResolvedValueOnce queues two distinct
        // responses so a stale-cache hit on the second fetch would
        // fail loud.
        vi.mocked(getCardHistory).mockResolvedValueOnce({
            card_id: 101,
            total: 1,
            entries: [
                {
                    id: 1_777_000_000_000,
                    button: 3,
                    button_label: "good",
                    interval_days: 4,
                    last_interval_days: 1,
                    ease_percent: 250,
                    taken_ms: 4200,
                    review_kind: "review",
                },
            ],
        });
        vi.mocked(getCardHistory).mockResolvedValueOnce({
            card_id: 202,
            total: 0,
            entries: [],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            openHistoryPanel(container);
            await settle();
            expect(vi.mocked(getCardHistory)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(getCardHistory)).toHaveBeenLastCalledWith(101);

            // Switch to the second card. Browse rows are clickable
            // buttons inside the .row-list region; matching the
            // BrowseRow surface by its rendered front snippet keeps
            // the assertion robust against unrelated layout tweaks.
            const rowButtons = Array.from(
                container.querySelectorAll<HTMLButtonElement>("button"),
            ).filter((b) => b.textContent?.includes("gato"));
            expect(rowButtons.length).toBeGreaterThan(0);
            rowButtons[0]?.click();
            await settle();

            // The panel stayed open across the switch (bind:open is
            // independent of selection), so the card-id $effect
            // re-fires loadHistoryIfNeeded with the new id.
            expect(vi.mocked(getCardHistory)).toHaveBeenCalledTimes(2);
            expect(vi.mocked(getCardHistory)).toHaveBeenLastCalledWith(202);

            // Card 202 had no reviews — empty-state copy renders.
            const empty = container.querySelector(".history-empty");
            expect(empty).not.toBeNull();
            expect(empty?.textContent).toContain("No reviews yet");
        } finally {
            unmount(instance);
        }
    });
});

// Phase 20-B: bulk multi-select + bulk_suspend / bulk_flag toolbar.
// Selection state is the single Set<number> in +page.svelte; the
// toolbar mirrors it visually, the bulk endpoints take it as the
// payload, and the "Clear selection" button collapses it back to
// empty. Re-using the same liveThree fixture (cards 101/102/103)
// the rest of the suite seeds with so the row identities are stable
// across this block.
describe("BrowsePage bulk multi-select (Phase 20-B)", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.clearAllMocks();
        resetPageStub();
        vi.mocked(fetchDecks).mockRejectedValue(new Error("decks unreachable"));
        vi.mocked(fetchTags).mockRejectedValue(new Error("tags unreachable"));
        vi.mocked(fetchDeckConfigs).mockRejectedValue(
            new Error("preset list unreachable"),
        );
        vi.mocked(fetchNote).mockRejectedValue(
            new Error("fetchNote default reject"),
        );
        vi.mocked(fetchNotetypes).mockRejectedValue(
            new Error("fetchNotetypes default reject"),
        );
        vi.mocked(fetchSavedSearches).mockRejectedValue(
            new Error("fetchSavedSearches default reject"),
        );
        vi.mocked(getCardHistory).mockRejectedValue(
            new Error("getCardHistory default reject"),
        );
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    function rowCheckboxes(root: HTMLElement): HTMLInputElement[] {
        return Array.from(
            root.querySelectorAll<HTMLInputElement>(".bx-table-body .row-check"),
        );
    }

    function selectAllCheckbox(root: HTMLElement): HTMLInputElement | null {
        return root.querySelector<HTMLInputElement>(".select-all");
    }

    function bulkToolbar(root: HTMLElement): HTMLElement | null {
        return root.querySelector<HTMLElement>(".bulk-toolbar");
    }

    function bulkButtonByText(
        root: HTMLElement,
        label: string,
    ): HTMLButtonElement | null {
        const btns = Array.from(
            root.querySelectorAll<HTMLButtonElement>(".bulk-toolbar .bulk-btn"),
        );
        return btns.find((b) => b.textContent?.trim() === label) ?? null;
    }

    test("bulk toolbar is hidden when selection is empty; appears when at least one row is checked", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Header strip is always present (master checkbox), but
            // the action toolbar shows up only when there's a
            // selection.
            expect(selectAllCheckbox(container)).not.toBeNull();
            expect(bulkToolbar(container)).toBeNull();

            const checks = rowCheckboxes(container);
            expect(checks.length).toBe(3);
            checks[0]!.click();
            await settle();

            expect(bulkToolbar(container)).not.toBeNull();
            // "X selected" copy in the strip echoes Set size.
            const text = container.querySelector(".select-all-text")
                ?.textContent;
            expect(text).toContain("1 selected");
        } finally {
            unmount(instance);
        }
    });

    test("toggling a row checkbox adds and removes its id from the selection", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const checks = rowCheckboxes(container);
            // Tick rows 0 and 2 (ids 101, 103).
            checks[0]!.click();
            checks[2]!.click();
            await settle();
            expect(
                container.querySelector(".select-all-text")?.textContent,
            ).toContain("2 selected");

            // Untick row 0 — strip count drops to 1.
            checks[0]!.click();
            await settle();
            expect(
                container.querySelector(".select-all-text")?.textContent,
            ).toContain("1 selected");
        } finally {
            unmount(instance);
        }
    });

    test("master checkbox selects every visible row; clicking again clears them", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const master = selectAllCheckbox(container);
            expect(master).not.toBeNull();
            master!.click();
            await settle();
            expect(
                container.querySelector(".select-all-text")?.textContent,
            ).toContain("3 selected");
            // Per-row checkboxes reflect the master tick.
            const checked = rowCheckboxes(container).filter((c) => c.checked);
            expect(checked.length).toBe(3);

            // Click again — the master collapses to clear.
            master!.click();
            await settle();
            expect(
                container.querySelector(".select-all-text")?.textContent,
            ).toContain("Select all");
        } finally {
            unmount(instance);
        }
    });

    test("Suspend toolbar action posts bulkSuspend with the selection and refetches the page", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
        vi.mocked(bulkSuspend).mockResolvedValueOnce({
            count: 2,
            suspended: true,
        });
        // The handler refetches after the mutation lands; second
        // call returns a fresh page with the two cards now suspended.
        vi.mocked(fetchCards).mockResolvedValueOnce({
            total: 3,
            cards: [
                card(101, "<p>hola</p>", "<p>hello</p>", { state: "suspended" }),
                card(102, "<p>gato</p>", "<p>cat</p>", { state: "suspended" }),
                card(103, "<p>perro</p>", "<p>dog</p>"),
            ],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const checks = rowCheckboxes(container);
            checks[0]!.click(); // 101
            checks[1]!.click(); // 102
            await settle();

            const suspendBtn = bulkButtonByText(container, "Suspend");
            expect(suspendBtn).not.toBeNull();
            suspendBtn!.click();
            await settle();

            expect(vi.mocked(bulkSuspend)).toHaveBeenCalledTimes(1);
            // Set iteration order is insertion order for numeric keys,
            // so the wire payload is [101, 102].
            expect(vi.mocked(bulkSuspend)).toHaveBeenCalledWith([101, 102], true);
            // Refetch fired so the row state reflects the persisted
            // change (server-canonical, not optimistic).
            expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(2);
            expect(container.querySelector(".error-banner")).toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("Unsuspend toolbar action posts bulkSuspend(ids, false)", async () => {
        const suspendedThree: ApiCardListResponse = {
            total: 3,
            cards: [
                card(101, "<p>hola</p>", "<p>hello</p>", { state: "suspended" }),
                card(102, "<p>gato</p>", "<p>cat</p>", { state: "suspended" }),
                card(103, "<p>perro</p>", "<p>dog</p>"),
            ],
        };
        vi.mocked(fetchCards).mockResolvedValueOnce(suspendedThree);
        vi.mocked(bulkSuspend).mockResolvedValueOnce({
            count: 2,
            suspended: false,
        });
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const checks = rowCheckboxes(container);
            checks[0]!.click();
            checks[1]!.click();
            await settle();

            const unsuspendBtn = bulkButtonByText(container, "Unsuspend");
            expect(unsuspendBtn).not.toBeNull();
            unsuspendBtn!.click();
            await settle();

            expect(vi.mocked(bulkSuspend)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(bulkSuspend)).toHaveBeenCalledWith(
                [101, 102],
                false,
            );
        } finally {
            unmount(instance);
        }
    });

    test("flag chip in toolbar posts bulkFlag with the chip's value", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
        vi.mocked(bulkFlag).mockResolvedValueOnce({ count: 2, flag: 3 });
        vi.mocked(fetchCards).mockResolvedValueOnce({
            total: 3,
            cards: [
                card(101, "<p>hola</p>", "<p>hello</p>", { flag: 3 }),
                card(102, "<p>gato</p>", "<p>cat</p>", { flag: 3 }),
                card(103, "<p>perro</p>", "<p>dog</p>"),
            ],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const checks = rowCheckboxes(container);
            checks[0]!.click();
            checks[1]!.click();
            await settle();

            // Flag chips inside the bulk toolbar — the clear button is
            // first (∅), then the seven colour chips. Index 3 = green
            // (flag value 3).
            const chips = Array.from(
                container.querySelectorAll<HTMLButtonElement>(
                    ".bulk-toolbar .bulk-flag-chip",
                ),
            );
            // 1 (clear) + 7 colours = 8.
            expect(chips.length).toBe(8);
            chips[3]!.click(); // green, value 3
            await settle();

            expect(vi.mocked(bulkFlag)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(bulkFlag)).toHaveBeenCalledWith([101, 102], 3);
            expect(container.querySelector(".error-banner")).toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("clear-selection button empties the selection Set without calling any bulk endpoint", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const checks = rowCheckboxes(container);
            checks[0]!.click();
            checks[1]!.click();
            checks[2]!.click();
            await settle();
            expect(
                container.querySelector(".select-all-text")?.textContent,
            ).toContain("3 selected");

            const clearBtn = bulkButtonByText(container, "Clear selection");
            expect(clearBtn).not.toBeNull();
            clearBtn!.click();
            await settle();

            // Toolbar is hidden again after clear.
            expect(bulkToolbar(container)).toBeNull();
            expect(
                container.querySelector(".select-all-text")?.textContent,
            ).toContain("Select all");
            // No mutation endpoints were touched.
            expect(vi.mocked(bulkSuspend)).not.toHaveBeenCalled();
            expect(vi.mocked(bulkFlag)).not.toHaveBeenCalled();
        } finally {
            unmount(instance);
        }
    });

    test("bulkSuspend rejection surfaces error banner; selection is preserved", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);
        vi.mocked(bulkSuspend).mockRejectedValueOnce(
            new Error("400 card_ids must not be empty"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const checks = rowCheckboxes(container);
            checks[0]!.click();
            await settle();

            const suspendBtn = bulkButtonByText(container, "Suspend");
            suspendBtn!.click();
            await settle();

            const banner = container.querySelector(".error-banner");
            expect(banner).not.toBeNull();
            expect(banner?.textContent).toContain("must not be empty");
            // Selection survives the failure so the user can retry.
            expect(
                container.querySelector(".select-all-text")?.textContent,
            ).toContain("1 selected");
        } finally {
            unmount(instance);
        }
    });
});
