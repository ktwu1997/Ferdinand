import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import Sidebar from "./Sidebar.svelte";
import { resetPageStub } from "../../test/stubs/app-stores";

// Mock auth so we can control auth.user without a real server.
vi.mock("$lib/auth.svelte", () => ({
    auth: {
        user: null,
        status: "unknown",
    },
}));

// Mock fetchDecks — Sidebar calls it in onMount for the due badge.
vi.mock("$lib/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("$lib/api")>();
    return { ...actual, fetchDecks: vi.fn().mockResolvedValue({ decks: [] }) };
});

describe("Sidebar M1 — username fallback", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        resetPageStub();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
        vi.clearAllMocks();
    });

    test("renders '—' (not 'ktwu') when auth.user is null", async () => {
        // auth.user is null (the default set in the mock above).
        const instance = mount(Sidebar, { target: container, props: {} });
        try {
            flushSync();
            const nameEl = container.querySelector(".who-name");
            expect(nameEl).not.toBeNull();
            expect(nameEl!.textContent).toBe("—");
            expect(nameEl!.textContent).not.toBe("ktwu");
        } finally {
            unmount(instance);
        }
    });
});
