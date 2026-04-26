import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import Page from "./+page.svelte";
import { resetPageStub } from "../../../test/stubs/app-stores";
import type { ApiDeckListResponse, ApiDeckSummary } from "$lib/api";

// Phase 12-C: contract tests for the Add Note flow. The page calls
// fetchDecks on mount to populate the deck dropdown, then postNote on
// submit. goto is stubbed so we can assert the redirect-to-home
// behaviour without touching SvelteKit's actual navigation machinery.
vi.mock("$lib/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("$lib/api")>();
    return {
        ...actual,
        fetchDecks: vi.fn(),
        postNote: vi.fn(),
    };
});

const gotoMock = vi.fn();
vi.mock("$app/navigation", () => ({
    goto: (path: string) => gotoMock(path),
}));

import { fetchDecks, postNote } from "$lib/api";

function deck(id: number, name: string, overrides: Partial<ApiDeckSummary> = {}): ApiDeckSummary {
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

const twoDecks: ApiDeckListResponse = {
    decks: [
        deck(101, "Spanish"),
        deck(202, "Japanese"),
        // Filtered deck — must be excluded from the dropdown so users
        // can't pick something the server would reject with 400.
        deck(303, "Cram queue", { filtered: true }),
    ],
};

async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flushSync();
}

describe("AddNote page contract (Phase 12-C)", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.resetAllMocks();
        resetPageStub();
        // Default: fetchDecks resolves so the form is interactive on
        // mount. Tests that need the load-error branch override.
        vi.mocked(fetchDecks).mockResolvedValue(twoDecks);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("decks dropdown excludes filtered decks; first non-filtered deck is preselected", async () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const select = container.querySelector(
                "#deck-select",
            ) as HTMLSelectElement | null;
            expect(select).not.toBeNull();
            const options = Array.from(
                select?.querySelectorAll("option") ?? [],
            );
            // Two real decks; "Cram queue" must NOT appear.
            expect(options.length).toBe(2);
            const labels = options.map((o) => o.textContent?.trim());
            expect(labels).toEqual(["Spanish", "Japanese"]);
            // Preselected = first non-filtered deck.
            expect(select?.value).toBe("101");
        } finally {
            unmount(instance);
        }
    });

    test("Save submits trimmed-tag postNote and redirects to /", async () => {
        vi.mocked(postNote).mockResolvedValueOnce({
            note_id: 1777215902150,
            card_count: 1,
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const front = container.querySelector(
                "#front-input",
            ) as HTMLTextAreaElement;
            front.value = "森林";
            front.dispatchEvent(new Event("input", { bubbles: true }));
            const back = container.querySelector(
                "#back-input",
            ) as HTMLTextAreaElement;
            back.value = "shinrin — forest";
            back.dispatchEvent(new Event("input", { bubbles: true }));
            const tags = container.querySelector(
                "#tags-input",
            ) as HTMLInputElement;
            // Mixed comma + whitespace separators — server-side trim/drop
            // should give us [vocab, nature], not [vocab, "", nature].
            tags.value = "vocab,  nature";
            tags.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            const form = container.querySelector(
                "form",
            ) as HTMLFormElement;
            form.dispatchEvent(
                new Event("submit", { bubbles: true, cancelable: true }),
            );
            await settle();

            expect(vi.mocked(postNote)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(postNote)).toHaveBeenCalledWith({
                deck_id: 101,
                fields: ["森林", "shinrin — forest"],
                tags: ["vocab", "nature"],
            });
            expect(gotoMock).toHaveBeenCalledTimes(1);
            expect(gotoMock).toHaveBeenCalledWith("/");
        } finally {
            unmount(instance);
        }
    });

    test("server 400 keeps the form mounted and surfaces the error inline (no redirect)", async () => {
        vi.mocked(postNote).mockRejectedValueOnce(
            new Error("400 first field must not be empty"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Whitespace-only front should already make canSubmit=false,
            // but the server-side guard is the source of truth — we
            // still want to verify what happens when the request lands.
            const front = container.querySelector(
                "#front-input",
            ) as HTMLTextAreaElement;
            front.value = "x"; // bypass client guard so we hit postNote
            front.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            const form = container.querySelector(
                "form",
            ) as HTMLFormElement;
            form.dispatchEvent(
                new Event("submit", { bubbles: true, cancelable: true }),
            );
            await settle();

            expect(vi.mocked(postNote)).toHaveBeenCalledTimes(1);
            // No redirect — user stays on the form to fix and retry.
            expect(gotoMock).not.toHaveBeenCalled();
            // Error rendered inline.
            const errBox = container.querySelector(".field-error");
            expect(errBox).not.toBeNull();
            expect(errBox?.textContent).toContain(
                "first field must not be empty",
            );
        } finally {
            unmount(instance);
        }
    });

    test("fetchDecks failure surfaces banner; deck select hidden until decks load", async () => {
        vi.mocked(fetchDecks).mockRejectedValueOnce(
            new Error("decks unreachable"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const banner = container.querySelector(".error-banner");
            expect(banner).not.toBeNull();
            expect(banner?.textContent).toContain("decks unreachable");
            // No deck select rendered (decks=null after rejection).
            expect(container.querySelector("#deck-select")).toBeNull();
        } finally {
            unmount(instance);
        }
    });
});
