import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import CardFace from "./CardFace.svelte";
import CardFaceHarness from "./CardFaceHarness.svelte";

// Grab the open shadow root of the host associated with a testid. The helper
// throws eagerly so a missing host or a missing shadowRoot surfaces as a test
// failure with a clear message instead of a generic null-deref.
function shadowFor(container: HTMLElement, testid: string): ShadowRoot {
    const host = container.querySelector(`[data-testid="${testid}"]`);
    if (!host) throw new Error(`no host for testid=${testid}`);
    if (!host.shadowRoot) throw new Error(`host for testid=${testid} has no shadow root`);
    return host.shadowRoot;
}

describe("CardFace mount contract", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("renders host wrapper with the provided testid", () => {
        const instance = mount(CardFace, {
            target: container,
            props: {
                html: "<p>front</p>",
                css: ".card { color: red; }",
                testid: "card-face-front",
            },
        });

        try {
            const host = container.querySelector(
                '[data-testid="card-face-front"]',
            );
            expect(host).not.toBeNull();
            expect(host?.classList.contains("card-face-host")).toBe(true);
        } finally {
            unmount(instance);
        }
    });

    test("attaches an open shadow root to the host", () => {
        const instance = mount(CardFace, {
            target: container,
            props: {
                html: "<p>front</p>",
                css: "",
                testid: "shadow-open",
            },
        });
        flushSync();

        try {
            const host = container.querySelector(
                '[data-testid="shadow-open"]',
            ) as HTMLElement | null;
            expect(host).not.toBeNull();
            expect(host!.shadowRoot).not.toBeNull();
            expect(host!.shadowRoot!.mode).toBe("open");
        } finally {
            unmount(instance);
        }
    });

    test("shadow root contains base href, style block, and .card wrapper", () => {
        const instance = mount(CardFace, {
            target: container,
            props: {
                html: "<p>front</p>",
                css: ".card { color: red; }",
                testid: "shadow-structure",
            },
        });
        flushSync();

        try {
            const shadow = shadowFor(container, "shadow-structure");
            const base = shadow.querySelector("base");
            const style = shadow.querySelector("style");
            const cardWrapper = shadow.querySelector("div.card");
            expect(base).not.toBeNull();
            // mediaBase() falls through to DEFAULT_BASE in jsdom — no `api` query
            // param and no VITE_ANKI_API env. If the default ever changes, update
            // both the component contract and this assertion together.
            expect(base!.getAttribute("href")).toBe(
                "http://localhost:40001/media/",
            );
            expect(style).not.toBeNull();
            expect(style!.textContent).toBe(".card { color: red; }");
            expect(cardWrapper).not.toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("sanitizes inline <script> out of rendered card html", () => {
        const instance = mount(CardFace, {
            target: container,
            props: {
                html: "<p>hello</p><script>window.__pwn__=1</script>",
                css: "",
                testid: "sanitize-script",
            },
        });
        flushSync();

        try {
            const shadow = shadowFor(container, "sanitize-script");
            expect(shadow.querySelector("script")).toBeNull();
            const cardWrapper = shadow.querySelector("div.card");
            expect(cardWrapper).not.toBeNull();
            expect(cardWrapper!.innerHTML).toContain("<p>hello</p>");
        } finally {
            unmount(instance);
        }
    });

    test("transforms [sound:X] tokens into <audio> elements with src", () => {
        const instance = mount(CardFace, {
            target: container,
            props: {
                html: "before [sound:foo.mp3] after",
                css: "",
                testid: "sound-transform",
            },
        });
        flushSync();

        try {
            const shadow = shadowFor(container, "sound-transform");
            const audio = shadow.querySelector("audio");
            expect(audio).not.toBeNull();
            expect(audio!.getAttribute("src")).toBe("foo.mp3");
            expect(audio!.hasAttribute("controls")).toBe(true);
            expect(audio!.getAttribute("preload")).toBe("none");
        } finally {
            unmount(instance);
        }
    });

    test("re-renders shadow root when html prop changes", () => {
        const h = mount(CardFaceHarness, {
            target: container,
            props: {
                initialHtml: "<p>first</p>",
                initialCss: "",
                initialTestid: "reactive-host",
            },
        });
        flushSync();

        try {
            const firstShadow = shadowFor(container, "reactive-host");
            expect(firstShadow.querySelector("div.card")!.innerHTML).toContain(
                "<p>first</p>",
            );

            h.setHtml("<p>second</p>");
            flushSync();

            const secondShadow = shadowFor(container, "reactive-host");
            const wrapper = secondShadow.querySelector("div.card");
            expect(wrapper).not.toBeNull();
            expect(wrapper!.innerHTML).toContain("<p>second</p>");
            expect(wrapper!.innerHTML).not.toContain("<p>first</p>");
        } finally {
            unmount(h);
        }
    });
});
