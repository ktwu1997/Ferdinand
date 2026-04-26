import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import Page from "./+page.svelte";
import { resetPageStub } from "../../../test/stubs/app-stores";
import type {
    ApiDeckListResponse,
    ApiDeckSummary,
    ApiNotetypeListResponse,
} from "$lib/api";

// Phase 12-C: contract tests for the Add Note flow. The page calls
// fetchDecks on mount to populate the deck dropdown, then postNote on
// submit. goto is stubbed so we can assert the redirect-to-home
// behaviour without touching SvelteKit's actual navigation machinery.
// Phase 13-C: fetchNotetypes joins the parallel mount load; the form
// now renders one textarea per notetype field instead of a fixed
// Front/Back pair.
vi.mock("$lib/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("$lib/api")>();
    return {
        ...actual,
        fetchDecks: vi.fn(),
        fetchNotetypes: vi.fn(),
        postNote: vi.fn(),
        postMedia: vi.fn(),
    };
});

const gotoMock = vi.fn();
vi.mock("$app/navigation", () => ({
    goto: (path: string) => gotoMock(path),
}));

import { fetchDecks, fetchNotetypes, postMedia, postNote } from "$lib/api";

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

// Phase 13-C: real-collection notetype ids are epoch-ms — the test
// fixture mirrors that so we'd catch a 32-bit overflow / hardcoded-id
// regression in either direction.
const BASIC_ID = 1776837237908;
const REVERSE_ID = 1776837237909;
const CLOZE_ID = 1776837237910;

const threeNotetypes: ApiNotetypeListResponse = {
    notetypes: [
        { id: BASIC_ID, name: "Basic", fields: ["Front", "Back"] },
        {
            id: REVERSE_ID,
            name: "Basic (and reversed card)",
            fields: ["Front", "Back"],
        },
        // Cloze field names differ from Basic — labels must reflect
        // what the picker selected, not a hardcoded Front/Back pair.
        { id: CLOZE_ID, name: "Cloze", fields: ["Text", "Back Extra"] },
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
        vi.mocked(fetchNotetypes).mockResolvedValue(threeNotetypes);
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

    test("Save submits trimmed-tag postNote with notetype_id and redirects to /", async () => {
        vi.mocked(postNote).mockResolvedValueOnce({
            note_id: 1777215902150,
            card_count: 1,
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const f0 = container.querySelector(
                "#field-input-0",
            ) as HTMLTextAreaElement;
            f0.value = "森林";
            f0.dispatchEvent(new Event("input", { bubbles: true }));
            const f1 = container.querySelector(
                "#field-input-1",
            ) as HTMLTextAreaElement;
            f1.value = "shinrin — forest";
            f1.dispatchEvent(new Event("input", { bubbles: true }));
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
                notetype_id: BASIC_ID,
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
            const f0 = container.querySelector(
                "#field-input-0",
            ) as HTMLTextAreaElement;
            f0.value = "x"; // bypass client guard so we hit postNote
            f0.dispatchEvent(new Event("input", { bubbles: true }));
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

describe("AddNote notetype picker (Phase 13-C)", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.resetAllMocks();
        resetPageStub();
        vi.mocked(fetchDecks).mockResolvedValue(twoDecks);
        vi.mocked(fetchNotetypes).mockResolvedValue(threeNotetypes);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("notetype picker renders all three options; Basic preselected by name", async () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const select = container.querySelector(
                "#notetype-select",
            ) as HTMLSelectElement | null;
            expect(select).not.toBeNull();
            const options = Array.from(
                select?.querySelectorAll("option") ?? [],
            );
            // 3 options, all in server-returned order (Basic / Reverse / Cloze).
            expect(options.length).toBe(3);
            const labels = options.map((o) => o.textContent?.trim());
            expect(labels).toEqual([
                "Basic (2 fields)",
                "Basic (and reversed card) (2 fields)",
                "Cloze (2 fields)",
            ]);
            // "Basic" preselected by name (server-side fallback parity).
            expect(select?.value).toBe(String(BASIC_ID));

            // Default field labels reflect Basic's "Front" / "Back".
            const labels0 = container.querySelector(
                'label[for="field-input-0"]',
            )?.textContent?.trim();
            const labels1 = container.querySelector(
                'label[for="field-input-1"]',
            )?.textContent?.trim();
            expect(labels0).toBe("Front");
            expect(labels1).toBe("Back");
        } finally {
            unmount(instance);
        }
    });

    test("switching to Cloze relabels fields to Text/Back Extra and resets values", async () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Type something into Basic's Front so we can verify the
            // reset on notetype switch.
            const f0 = container.querySelector(
                "#field-input-0",
            ) as HTMLTextAreaElement;
            f0.value = "森林";
            f0.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            // Flip to Cloze.
            const select = container.querySelector(
                "#notetype-select",
            ) as HTMLSelectElement;
            select.value = String(CLOZE_ID);
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            // Labels updated.
            expect(
                container
                    .querySelector('label[for="field-input-0"]')
                    ?.textContent?.trim(),
            ).toBe("Text");
            expect(
                container
                    .querySelector('label[for="field-input-1"]')
                    ?.textContent?.trim(),
            ).toBe("Back Extra");

            // Field 0 cleared — desktop Add-Card parity (no carry-over).
            const reset0 = container.querySelector(
                "#field-input-0",
            ) as HTMLTextAreaElement;
            expect(reset0.value).toBe("");
        } finally {
            unmount(instance);
        }
    });

    test("save after switching notetype submits the new notetype_id and the new field values", async () => {
        vi.mocked(postNote).mockResolvedValueOnce({
            note_id: 1777300000000,
            card_count: 3,
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Switch to Cloze first.
            const select = container.querySelector(
                "#notetype-select",
            ) as HTMLSelectElement;
            select.value = String(CLOZE_ID);
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            // Fill the Cloze fields.
            const f0 = container.querySelector(
                "#field-input-0",
            ) as HTMLTextAreaElement;
            f0.value = "The capital of {{c1::France}} is {{c2::Paris}}.";
            f0.dispatchEvent(new Event("input", { bubbles: true }));
            const f1 = container.querySelector(
                "#field-input-1",
            ) as HTMLTextAreaElement;
            f1.value = "Geography fact.";
            f1.dispatchEvent(new Event("input", { bubbles: true }));
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
                fields: [
                    "The capital of {{c1::France}} is {{c2::Paris}}.",
                    "Geography fact.",
                ],
                tags: [],
                notetype_id: CLOZE_ID,
            });
            expect(gotoMock).toHaveBeenCalledWith("/");
        } finally {
            unmount(instance);
        }
    });
});

// Phase 15-C: drag-drop image upload into a notetype field. Mocks
// postMedia and dispatches a synthetic DragEvent with a fake DataTransfer
// payload — jsdom doesn't construct DataTransfer natively so the test
// builds a minimal object literal that the handler reads (`types` array
// + `files` indexed access).
describe("AddNote drag-drop image upload (Phase 15-C)", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.resetAllMocks();
        resetPageStub();
        gotoMock.mockReset();
        vi.mocked(fetchDecks).mockResolvedValue(twoDecks);
        vi.mocked(fetchNotetypes).mockResolvedValue(threeNotetypes);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    function dispatchDrop(target: Element, file: File): void {
        // Minimal DataTransfer-shaped object — the handler reads only
        // `.types` and `.files` so we don't need to implement the full
        // DOM API. jsdom does not expose a DragEvent constructor (it's
        // a HTML5 spec quirk that some environments skip), so we
        // dispatch generic Events of type "dragover" / "drop" instead;
        // the @ondragover / @ondrop directives Svelte compiles still
        // fire on these because they listen by name, not subclass.
        const dataTransfer = {
            types: ["Files"],
            files: [file],
        } as unknown as DataTransfer;
        const dragover = new Event("dragover", {
            bubbles: true,
            cancelable: true,
        });
        Object.defineProperty(dragover, "dataTransfer", { value: dataTransfer });
        target.dispatchEvent(dragover);
        const drop = new Event("drop", { bubbles: true, cancelable: true });
        Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
        target.dispatchEvent(drop);
    }

    test("drop image on first field: postMedia called; <img src> token appended to that field", async () => {
        vi.mocked(postMedia).mockResolvedValueOnce({
            filename: "screenshot.png",
            size_bytes: 1234,
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const file = new File([new Uint8Array([1, 2, 3])], "shot.png", {
                type: "image/png",
            });
            const fields = container.querySelectorAll(".field-droppable");
            expect(fields.length).toBeGreaterThanOrEqual(2);
            dispatchDrop(fields[0]!, file);
            await settle();

            expect(vi.mocked(postMedia)).toHaveBeenCalledTimes(1);
            const [arg] = vi.mocked(postMedia).mock.calls[0]!;
            expect(arg).toBeInstanceOf(File);
            expect((arg as File).name).toBe("shot.png");

            // Field value gets the server-canonical filename appended,
            // NOT the upload-side `shot.png`. Critical: the dedupe
            // suffix would otherwise be lost.
            const ta = container.querySelector<HTMLTextAreaElement>(
                "#field-input-0",
            );
            expect(ta?.value).toBe('<img src="/media/screenshot.png">');
        } finally {
            unmount(instance);
        }
    });

    test("non-image drop: no network call; inline error surfaces; field value unchanged", async () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const file = new File(["some text"], "notes.txt", {
                type: "text/plain",
            });
            const fields = container.querySelectorAll(".field-droppable");
            dispatchDrop(fields[0]!, file);
            await settle();

            expect(vi.mocked(postMedia)).not.toHaveBeenCalled();
            const errors = Array.from(
                container.querySelectorAll(".field-error"),
            ).map((e) => e.textContent ?? "");
            expect(errors.some((t) => t.includes("Only image files"))).toBe(true);
            const ta = container.querySelector<HTMLTextAreaElement>(
                "#field-input-0",
            );
            expect(ta?.value ?? "").toBe("");
        } finally {
            unmount(instance);
        }
    });

    test("server reject (e.g. 400 too large): error surfaces; field value unchanged", async () => {
        vi.mocked(postMedia).mockRejectedValueOnce(
            new Error("400 file too large (10485761 bytes); max is 10485760 bytes"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "big.jpg", {
                type: "image/jpeg",
            });
            const fields = container.querySelectorAll(".field-droppable");
            dispatchDrop(fields[0]!, file);
            await settle();

            expect(vi.mocked(postMedia)).toHaveBeenCalledTimes(1);
            const errors = Array.from(
                container.querySelectorAll(".field-error"),
            ).map((e) => e.textContent ?? "");
            expect(errors.some((t) => t.includes("file too large"))).toBe(true);
            const ta = container.querySelector<HTMLTextAreaElement>(
                "#field-input-0",
            );
            expect(ta?.value ?? "").toBe("");
        } finally {
            unmount(instance);
        }
    });
});
