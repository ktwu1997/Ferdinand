import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mount, unmount } from "svelte";

import CardFace from "./CardFace.svelte";

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
});
