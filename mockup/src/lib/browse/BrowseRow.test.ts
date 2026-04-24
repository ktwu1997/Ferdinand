import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import BrowseRow from "./BrowseRow.svelte";
import BrowseRowHarness from "./BrowseRowHarness.svelte";

// Phase 8-B: contract tests for BrowseRow using the harness pattern that
// CardFace pioneered. BrowseRow is a pure presentation component (no
// fetch, no onMount), so most assertions only need a single mount with
// final props. The harness covers the reactive surfaces that users
// actually exercise: selecting a row (list selection state) and tag
// mutation (when the tag set behind a card changes).

interface RowPropsBase {
    id: string;
    frontHtml: string;
    backHtml: string;
    deckName: string;
    deckEmoji: string;
    tags: string[];
    due: string;
    state: string;
    selected: boolean;
    onSelect: () => void;
}

function baseProps(overrides: Partial<RowPropsBase> = {}): RowPropsBase {
    return {
        id: "card-1",
        frontHtml: "<p>Front text</p>",
        backHtml: "<p>Back text</p>",
        deckName: "Spanish",
        deckEmoji: "🇪🇸",
        tags: [],
        due: "today",
        state: "new",
        selected: false,
        onSelect: () => {},
        ...overrides,
    };
}

function rowButton(container: HTMLElement): HTMLButtonElement {
    const el = container.querySelector("button.row");
    if (!el) throw new Error("no .row button in container");
    return el as HTMLButtonElement;
}

describe("BrowseRow mount contract", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("renders <button class='row'> with deck name, emoji, due, and state chip", () => {
        const instance = mount(BrowseRow, {
            target: container,
            props: baseProps({
                deckName: "Japanese Kanji",
                deckEmoji: "🇯🇵",
                due: "tomorrow",
                state: "learning",
            }),
        });
        flushSync();

        try {
            const btn = rowButton(container);
            expect(btn.classList.contains("row")).toBe(true);
            expect(btn.textContent).toContain("🇯🇵");
            expect(btn.textContent).toContain("Japanese Kanji");
            expect(btn.textContent).toContain("tomorrow");
            const chip = btn.querySelector(".state-chip");
            expect(chip).not.toBeNull();
            expect(chip!.classList.contains("state-learning")).toBe(true);
            expect(chip!.textContent?.trim()).toBe("learning");
        } finally {
            unmount(instance);
        }
    });

    test("renders plain-text snippet extracted from frontHtml", () => {
        const instance = mount(BrowseRow, {
            target: container,
            props: baseProps({
                frontHtml: "<p>hello<br>world</p>",
            }),
        });
        flushSync();

        try {
            const snippet = container.querySelector(".snippet");
            expect(snippet).not.toBeNull();
            expect(snippet!.textContent).toBe("hello world");
        } finally {
            unmount(instance);
        }
    });

    test('falls back to "(empty front)" when frontHtml strips to empty', () => {
        const instance = mount(BrowseRow, {
            target: container,
            props: baseProps({ frontHtml: "<p></p>" }),
        });
        flushSync();

        try {
            const snippet = container.querySelector(".snippet");
            expect(snippet!.textContent).toBe("(empty front)");
        } finally {
            unmount(instance);
        }
    });

    test("renders <img> with mediaBase-prefixed src when frontHtml has an image", () => {
        const instance = mount(BrowseRow, {
            target: container,
            props: baseProps({
                frontHtml: '<p>see <img src="diagram.png" alt="schema"></p>',
            }),
        });
        flushSync();

        try {
            const img = container.querySelector(".thumb img") as HTMLImageElement | null;
            expect(img).not.toBeNull();
            // mediaBase() in jsdom resolves via DEFAULT_BASE (no VITE_ANKI_API,
            // no ?api= query), matching the CardFace test expectation. If the
            // default ever changes, update CardFace + BrowseRow tests together.
            expect(img!.getAttribute("src")).toBe(
                "http://localhost:40001/media/diagram.png",
            );
            expect(img!.getAttribute("alt")).toBe("schema");
            expect(img!.getAttribute("loading")).toBe("lazy");
        } finally {
            unmount(instance);
        }
    });

    test("renders placeholder div when neither front nor back has an image", () => {
        const instance = mount(BrowseRow, {
            target: container,
            props: baseProps({
                frontHtml: "<p>no image</p>",
                backHtml: "<p>still no image</p>",
            }),
        });
        flushSync();

        try {
            expect(container.querySelector(".thumb img")).toBeNull();
            expect(container.querySelector(".thumb-placeholder")).not.toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("shows audio badge when frontHtml contains [sound:X]", () => {
        const instance = mount(BrowseRow, {
            target: container,
            props: baseProps({
                frontHtml: "<p>listen [sound:clip.mp3]</p>",
            }),
        });
        flushSync();

        try {
            expect(container.querySelector(".audio-badge")).not.toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("shows audio badge when backHtml contains [sound:X] and front does not", () => {
        const instance = mount(BrowseRow, {
            target: container,
            props: baseProps({
                frontHtml: "<p>silent front</p>",
                backHtml: "<p>answer [sound:answer.mp3]</p>",
            }),
        });
        flushSync();

        try {
            expect(container.querySelector(".audio-badge")).not.toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("omits audio badge when neither side has [sound:X]", () => {
        const instance = mount(BrowseRow, {
            target: container,
            props: baseProps({
                frontHtml: "<p>nothing</p>",
                backHtml: "<p>nothing</p>",
            }),
        });
        flushSync();

        try {
            expect(container.querySelector(".audio-badge")).toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("renders first 2 tags and +N more indicator when tags.length > 2", () => {
        const instance = mount(BrowseRow, {
            target: container,
            props: baseProps({
                tags: ["alpha", "beta", "gamma", "delta", "epsilon"],
            }),
        });
        flushSync();

        try {
            const tags = container.querySelectorAll(".tag:not(.more)");
            expect(tags.length).toBe(2);
            expect(tags[0].textContent).toBe("#alpha");
            expect(tags[1].textContent).toBe("#beta");
            const more = container.querySelector(".tag.more");
            expect(more).not.toBeNull();
            expect(more!.textContent).toBe("+3");
        } finally {
            unmount(instance);
        }
    });

    test("renders no tag markup when tags is empty", () => {
        const instance = mount(BrowseRow, {
            target: container,
            props: baseProps({ tags: [] }),
        });
        flushSync();

        try {
            expect(container.querySelectorAll(".tag").length).toBe(0);
            expect(container.querySelector(".tag-sep")).toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("applies .selected class only when selected=true", () => {
        const unselected = mount(BrowseRow, {
            target: container,
            props: baseProps({ selected: false }),
        });
        flushSync();
        try {
            expect(rowButton(container).classList.contains("selected")).toBe(false);
        } finally {
            unmount(unselected);
        }

        const selected = mount(BrowseRow, {
            target: container,
            props: baseProps({ selected: true }),
        });
        flushSync();
        try {
            expect(rowButton(container).classList.contains("selected")).toBe(true);
        } finally {
            unmount(selected);
        }
    });

    test("invokes onSelect callback when the row button is clicked", () => {
        const calls: number[] = [];
        const instance = mount(BrowseRow, {
            target: container,
            props: baseProps({
                onSelect: () => calls.push(calls.length + 1),
            }),
        });
        flushSync();

        try {
            rowButton(container).click();
            rowButton(container).click();
            expect(calls).toEqual([1, 2]);
        } finally {
            unmount(instance);
        }
    });

    test("toggles .selected class when selected prop flips after mount", () => {
        const h = mount(BrowseRowHarness, {
            target: container,
            props: {
                id: "card-reactive",
                initialFrontHtml: "<p>reactive front</p>",
                initialBackHtml: "",
                deckName: "Deck",
                deckEmoji: "📘",
                initialTags: [],
                due: "today",
                cardState: "new",
                initialSelected: false,
                onSelect: () => {},
            },
        });
        flushSync();

        try {
            const btn = rowButton(container);
            expect(btn.classList.contains("selected")).toBe(false);

            h.setSelected(true);
            flushSync();
            expect(btn.classList.contains("selected")).toBe(true);

            h.setSelected(false);
            flushSync();
            expect(btn.classList.contains("selected")).toBe(false);
        } finally {
            unmount(h);
        }
    });

    test("re-renders visible tags + overflow counter when tags prop changes", () => {
        const h = mount(BrowseRowHarness, {
            target: container,
            props: {
                id: "card-tags",
                initialFrontHtml: "<p>tagged</p>",
                initialBackHtml: "",
                deckName: "Deck",
                deckEmoji: "📘",
                initialTags: ["alpha"],
                due: "today",
                cardState: "new",
                initialSelected: false,
                onSelect: () => {},
            },
        });
        flushSync();

        try {
            // 1 tag, no overflow
            expect(
                container.querySelectorAll(".tag:not(.more)").length,
            ).toBe(1);
            expect(container.querySelector(".tag.more")).toBeNull();

            h.setTags(["alpha", "beta", "gamma", "delta"]);
            flushSync();

            const visible = container.querySelectorAll(".tag:not(.more)");
            expect(visible.length).toBe(2);
            expect(visible[0].textContent).toBe("#alpha");
            expect(visible[1].textContent).toBe("#beta");
            const more = container.querySelector(".tag.more");
            expect(more).not.toBeNull();
            expect(more!.textContent).toBe("+2");
        } finally {
            unmount(h);
        }
    });
});
