import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import Page from "./+page.svelte";
import { resetPageStub, setPageParams } from "../../../test/stubs/app-stores";
import type {
    ApiCardSummary,
    ApiDeckListResponse,
    ApiQueueResponse,
} from "$lib/api";

// Phase 8-C: contract tests for the study route's core flow. Mock only
// the network surface (fetchDecks / fetchQueue / postAnswer) — mediaBase
// and other pure helpers are left real so CardFace's media resolution
// continues to work under jsdom. Using `importOriginal` preserves every
// type + non-network export the module exposes today.
vi.mock("$lib/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("$lib/api")>();
    return {
        ...actual,
        fetchDecks: vi.fn(),
        fetchQueue: vi.fn(),
        postAnswer: vi.fn(),
        patchNote: vi.fn(),
    };
});

import { fetchDecks, fetchQueue, patchNote, postAnswer } from "$lib/api";

function card(
    id: number,
    front: string,
    back: string,
    tags: string[] = [],
): ApiCardSummary {
    return {
        id,
        note_id: id,
        deck_id: 42,
        deck_name: "Spanish",
        template_idx: 0,
        front_html: front,
        back_html: back,
        tags,
        state: "new",
        ease_factor: 2500,
        // Phase 17-A: flag=0 (no flag) is the default for fixtures that
        // don't exercise the chip strip. ApiCardSummary requires the field
        // post-17-A so omitting it would be a type error (8-E lesson).
        flag: 0,
        notetype_id: 1,
        notetype_name: "Basic",
        notetype_css: "",
    };
}

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

const initialQueue: ApiQueueResponse = {
    new: 5,
    learning: 2,
    review: 3,
    cards: [card(101, "<p>Front 101</p>", "<p>Back 101</p>")],
};

const secondQueue: ApiQueueResponse = {
    new: 4,
    learning: 2,
    review: 3,
    cards: [card(102, "<p>Front 102</p>", "<p>Back 102</p>")],
};

const exhaustedQueue: ApiQueueResponse = {
    new: 0,
    learning: 0,
    review: 0,
    cards: [],
};

// Async onMount does `await fetchDecks(); ... await fetchQueue(...)`, and
// each await requeues on the microtask queue. 10 turns is generous — the
// real chain is ~4–6 — and flushSync() flushes any reactive effects that
// those assignments scheduled.
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flushSync();
}

function pressKey(key: string): void {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    flushSync();
}

describe("StudyPage contract", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.clearAllMocks();
        resetPageStub();
        setPageParams({ deckId: "42" });
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("onMount fetches decks, fetches queue for matched id, renders front + counts", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchQueue).mockResolvedValueOnce(initialQueue);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(vi.mocked(fetchDecks)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(fetchQueue)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(fetchQueue)).toHaveBeenCalledWith(42, 1);

            expect(
                container.querySelector('[data-testid="card-face-front"]'),
            ).not.toBeNull();

            expect(
                container.querySelector(".c-new")?.textContent?.trim(),
            ).toBe("5 new");
            expect(
                container.querySelector(".c-learn")?.textContent?.trim(),
            ).toBe("2 learn");
            expect(
                container.querySelector(".c-review")?.textContent?.trim(),
            ).toBe("3 review");
        } finally {
            unmount(instance);
        }
    });

    test("Space reveals the back face; non-answer key does not call postAnswer", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchQueue).mockResolvedValueOnce(initialQueue);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(
                container.querySelector('[data-testid="card-face-back"]'),
            ).toBeNull();

            pressKey(" ");
            await settle();

            expect(
                container.querySelector('[data-testid="card-face-back"]'),
            ).not.toBeNull();

            // Non-answer key while showAnswer=true must not fire postAnswer.
            pressKey("x");
            await settle();
            expect(vi.mocked(postAnswer)).not.toHaveBeenCalled();
        } finally {
            unmount(instance);
        }
    });

    test("answer key '3' (good) posts rating=good with valid payload and advances", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchQueue).mockResolvedValueOnce(initialQueue);
        vi.mocked(postAnswer).mockResolvedValueOnce(secondQueue);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            pressKey(" ");
            await settle();
            pressKey("3");
            await settle();

            expect(vi.mocked(postAnswer)).toHaveBeenCalledTimes(1);
            const payload = vi.mocked(postAnswer).mock.calls[0][0];
            expect(payload.card_id).toBe(101);
            expect(payload.deck_id).toBe(42);
            expect(payload.rating).toBe("good");
            expect(payload.milliseconds_taken).toBeGreaterThanOrEqual(0);
            expect(payload.milliseconds_taken).toBeLessThanOrEqual(60_000);

            // Counts reflect the next response.
            expect(
                container.querySelector(".c-new")?.textContent?.trim(),
            ).toBe("4 new");
            // Back face resets because showAnswer flips to false.
            expect(
                container.querySelector('[data-testid="card-face-back"]'),
            ).toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("answer key '1' (again) posts rating=again", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchQueue).mockResolvedValueOnce(initialQueue);
        vi.mocked(postAnswer).mockResolvedValueOnce(secondQueue);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            pressKey(" ");
            await settle();
            pressKey("1");
            await settle();

            expect(vi.mocked(postAnswer)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(postAnswer).mock.calls[0][0].rating).toBe("again");
        } finally {
            unmount(instance);
        }
    });

    test("queue exhaustion: postAnswer returns empty cards, shows 'All caught up'", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchQueue).mockResolvedValueOnce(initialQueue);
        vi.mocked(postAnswer).mockResolvedValueOnce(exhaustedQueue);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            pressKey(" ");
            await settle();
            pressKey("3");
            await settle();

            const title = container.querySelector(".empty-title");
            expect(title).not.toBeNull();
            expect(title?.textContent).toContain("all caught up");
        } finally {
            unmount(instance);
        }
    });

    test("fetchDecks rejects: falls back to offline mode, no error banner", async () => {
        vi.mocked(fetchDecks).mockRejectedValueOnce(
            new Error("backend unreachable"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Offline fallback is a silent degrade — no banner.
            expect(container.querySelector(".error-banner")).toBeNull();
            // Front card host still renders (offline preview).
            expect(
                container.querySelector('[data-testid="card-face-front"]'),
            ).not.toBeNull();
            // fetchQueue was never reached.
            expect(vi.mocked(fetchQueue)).not.toHaveBeenCalled();
        } finally {
            unmount(instance);
        }
    });

    test("postAnswer rejects: error banner surfaces the message", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchQueue).mockResolvedValueOnce(initialQueue);
        vi.mocked(postAnswer).mockRejectedValueOnce(
            new Error("500 server error"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            pressKey(" ");
            await settle();
            pressKey("3");
            await settle();

            const banner = container.querySelector(
                '.error-banner[role="alert"]',
            );
            expect(banner).not.toBeNull();
            expect(banner?.textContent).toContain("500 server error");
        } finally {
            unmount(instance);
        }
    });

    // Phase 20-A: per-card tag override on the study review pane. Tags
    // belong to the underlying note (so all sibling cards inherit them);
    // the editor mirrors server-canonical tags onto `currentCard` after
    // each PATCH and reverts the optimistic state on failure.
    describe("tag override (Phase 20-A)", () => {
        const queueWithTags: ApiQueueResponse = {
            new: 5,
            learning: 2,
            review: 3,
            cards: [
                card(101, "<p>Front 101</p>", "<p>Back 101</p>", [
                    "alpha",
                    "beta",
                ]),
            ],
        };

        test("renders existing tags as removable chips", async () => {
            vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
            vi.mocked(fetchQueue).mockResolvedValueOnce(queueWithTags);

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const chips = container.querySelectorAll(
                    '[data-testid="tag-edit"] .tag-chip',
                );
                expect(chips.length).toBe(2);
                expect(chips[0].textContent).toContain("alpha");
                expect(chips[1].textContent).toContain("beta");
            } finally {
                unmount(instance);
            }
        });

        test("adding a tag fires patchNote with merged list and shows the new chip", async () => {
            vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
            vi.mocked(fetchQueue).mockResolvedValueOnce(queueWithTags);
            vi.mocked(patchNote).mockResolvedValueOnce({
                note_id: 101,
                fields: ["x", "y"],
                tags: ["alpha", "beta", "gamma"],
                modified: 1,
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const addBtn = container.querySelector<HTMLButtonElement>(
                    '[data-testid="tag-add-btn"]',
                );
                expect(addBtn).not.toBeNull();
                addBtn!.click();
                await settle();

                const input = container.querySelector<HTMLInputElement>(
                    '[data-testid="tag-input"]',
                );
                expect(input).not.toBeNull();
                input!.value = "gamma";
                input!.dispatchEvent(new Event("input", { bubbles: true }));
                flushSync();
                input!.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        key: "Enter",
                        bubbles: true,
                    }),
                );
                await settle();

                expect(vi.mocked(patchNote)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(patchNote)).toHaveBeenCalledWith(101, {
                    tags: ["alpha", "beta", "gamma"],
                });

                const chips = container.querySelectorAll(
                    '[data-testid="tag-edit"] .tag-chip',
                );
                expect(chips.length).toBe(3);
                expect(chips[2].textContent).toContain("gamma");
            } finally {
                unmount(instance);
            }
        });

        test("removing a tag fires patchNote with the filtered list and drops the chip", async () => {
            vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
            vi.mocked(fetchQueue).mockResolvedValueOnce(queueWithTags);
            vi.mocked(patchNote).mockResolvedValueOnce({
                note_id: 101,
                fields: ["x", "y"],
                tags: ["beta"],
                modified: 1,
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const removeAlpha = container.querySelector<HTMLButtonElement>(
                    '[aria-label="Remove tag alpha"]',
                );
                expect(removeAlpha).not.toBeNull();
                removeAlpha!.click();
                await settle();

                expect(vi.mocked(patchNote)).toHaveBeenCalledTimes(1);
                expect(vi.mocked(patchNote)).toHaveBeenCalledWith(101, {
                    tags: ["beta"],
                });

                const chips = container.querySelectorAll(
                    '[data-testid="tag-edit"] .tag-chip',
                );
                expect(chips.length).toBe(1);
                expect(chips[0].textContent).toContain("beta");
            } finally {
                unmount(instance);
            }
        });

        test("duplicate add is a no-op (no patchNote call)", async () => {
            vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
            vi.mocked(fetchQueue).mockResolvedValueOnce(queueWithTags);

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                container
                    .querySelector<HTMLButtonElement>(
                        '[data-testid="tag-add-btn"]',
                    )!
                    .click();
                await settle();

                const input = container.querySelector<HTMLInputElement>(
                    '[data-testid="tag-input"]',
                );
                input!.value = "alpha"; // already on the card
                input!.dispatchEvent(new Event("input", { bubbles: true }));
                flushSync();
                input!.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        key: "Enter",
                        bubbles: true,
                    }),
                );
                await settle();

                expect(vi.mocked(patchNote)).not.toHaveBeenCalled();

                const chips = container.querySelectorAll(
                    '[data-testid="tag-edit"] .tag-chip',
                );
                expect(chips.length).toBe(2);
            } finally {
                unmount(instance);
            }
        });

        test("patchNote rejection reverts the optimistic state and surfaces tag-error", async () => {
            vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
            vi.mocked(fetchQueue).mockResolvedValueOnce(queueWithTags);
            vi.mocked(patchNote).mockRejectedValueOnce(
                new Error("400 invalid tag"),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                container
                    .querySelector<HTMLButtonElement>(
                        '[aria-label="Remove tag alpha"]',
                    )!
                    .click();
                await settle();

                expect(vi.mocked(patchNote)).toHaveBeenCalledTimes(1);

                // Optimistic remove was reverted → both chips back.
                const chips = container.querySelectorAll(
                    '[data-testid="tag-edit"] .tag-chip',
                );
                expect(chips.length).toBe(2);

                const errEl = container.querySelector('[data-testid="tag-error"]');
                expect(errEl).not.toBeNull();
                expect(errEl?.textContent).toContain("400 invalid tag");
            } finally {
                unmount(instance);
            }
        });

        test("answering advances to next card and shows that note's tags", async () => {
            vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
            vi.mocked(fetchQueue).mockResolvedValueOnce(queueWithTags);
            vi.mocked(postAnswer).mockResolvedValueOnce({
                new: 4,
                learning: 2,
                review: 3,
                cards: [
                    card(102, "<p>Front 102</p>", "<p>Back 102</p>", [
                        "delta",
                    ]),
                ],
            });

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                pressKey(" ");
                await settle();
                pressKey("3");
                await settle();

                const chips = container.querySelectorAll(
                    '[data-testid="tag-edit"] .tag-chip',
                );
                expect(chips.length).toBe(1);
                expect(chips[0].textContent).toContain("delta");
            } finally {
                unmount(instance);
            }
        });
    });
});
