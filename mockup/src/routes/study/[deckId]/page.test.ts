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
    };
});

import { fetchDecks, fetchQueue, postAnswer } from "$lib/api";

function card(id: number, front: string, back: string): ApiCardSummary {
    return {
        id,
        note_id: id,
        deck_id: 42,
        deck_name: "Spanish",
        template_idx: 0,
        front_html: front,
        back_html: back,
        tags: [],
        state: "new",
        ease_factor: 2500,
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
                container.querySelector(".count-new")?.textContent?.trim(),
            ).toBe("5");
            expect(
                container.querySelector(".count-learn")?.textContent?.trim(),
            ).toBe("2");
            expect(
                container.querySelector(".count-review")?.textContent?.trim(),
            ).toBe("3");
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
                container.querySelector(".count-new")?.textContent?.trim(),
            ).toBe("4");
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
            expect(title?.textContent).toContain("All caught up");
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
});
