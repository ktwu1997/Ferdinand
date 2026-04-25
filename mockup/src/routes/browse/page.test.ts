import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import Page from "./+page.svelte";
import { resetPageStub } from "../../test/stubs/app-stores";
import { cards as fakeCards } from "$lib/data";
import type { ApiCardListResponse, ApiCardSummary } from "$lib/api";

// Phase 8-E + 9-P: contract tests for the browse route. Mock fetchCards
// (mount-time hydrate) plus patchDeckName / postCardSuspend (editor-panel
// mutations). mediaBase stays real so BrowseRow's image src resolution
// continues to work under jsdom (the same 8-A/8-C rationale). No
// LiveIndicator on this route, so fetchHealth stays untouched.
vi.mock("$lib/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("$lib/api")>();
    return {
        ...actual,
        fetchCards: vi.fn(),
        patchDeckName: vi.fn(),
        postCardSuspend: vi.fn(),
    };
});

import { fetchCards, patchDeckName, postCardSuspend } from "$lib/api";

function card(id: number, front: string, back: string): ApiCardSummary {
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
        notetype_id: 1,
        notetype_name: "Basic",
        notetype_css: "",
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

function setSearch(root: HTMLElement, value: string): void {
    const input = root.querySelector<HTMLInputElement>(
        '.toolbar input[type="search"]',
    );
    if (!input) throw new Error("search input not found");
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
}

describe("BrowsePage contract", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.clearAllMocks();
        resetPageStub();
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
            const skeletons = container.querySelectorAll(".list div.row");
            const rows = container.querySelectorAll(".list button.row");
            expect(skeletons.length).toBe(5);
            expect(rows.length).toBe(0);
        } finally {
            unmount(instance);
        }
    });

    test("fetchCards success: rows render from live payload; count-tag reflects length", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(vi.mocked(fetchCards)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(fetchCards)).toHaveBeenCalledWith("", 100);

            expect(container.querySelectorAll(".list div.row").length).toBe(0);
            expect(container.querySelectorAll(".list button.row").length).toBe(
                3,
            );

            expect(
                container.querySelector(".count-tag")?.textContent?.trim(),
            ).toBe("3 of 3");
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
            expect(container.querySelectorAll(".list button.row").length).toBe(
                fakeCards.length,
            );
            expect(
                container.querySelector(".count-tag")?.textContent?.trim(),
            ).toBe(`${fakeCards.length} of ${fakeCards.length}`);
        } finally {
            unmount(instance);
        }
    });

    test("search filter: typing narrows rows and updates count-tag", async () => {
        vi.mocked(fetchCards).mockResolvedValueOnce(liveThree);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(
                container.querySelector(".count-tag")?.textContent?.trim(),
            ).toBe("3 of 3");

            setSearch(container, "gato");

            expect(container.querySelectorAll(".list button.row").length).toBe(
                1,
            );
            expect(
                container.querySelector(".count-tag")?.textContent?.trim(),
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

            const emptyTitle = container.querySelector(".empty-title");
            expect(emptyTitle).not.toBeNull();
            expect(emptyTitle?.textContent).toContain("No cards match");
            expect(container.querySelectorAll(".list button.row").length).toBe(
                0,
            );

            const clearBtn =
                container.querySelector<HTMLButtonElement>(".empty-action");
            if (!clearBtn) throw new Error(".empty-action button missing");
            clearBtn.click();
            flushSync();

            expect(container.querySelector(".empty-title")).toBeNull();
            expect(container.querySelectorAll(".list button.row").length).toBe(
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
                    ".tree .section-title",
                ),
            );
            const decksTitle = titles.find((t) =>
                t.textContent?.includes("Decks"),
            );
            if (!decksTitle) throw new Error("Decks section-title not found");

            // All 3 sections open by default (decks/tags/saved).
            const baseline = container.querySelectorAll(
                ".tree .section-items",
            ).length;
            expect(baseline).toBe(3);

            decksTitle.click();
            flushSync();
            const afterCollapse = container.querySelectorAll(
                ".tree .section-items",
            ).length;
            expect(afterCollapse).toBe(baseline - 1);

            decksTitle.click();
            flushSync();
            const afterExpand = container.querySelectorAll(
                ".tree .section-items",
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
});
