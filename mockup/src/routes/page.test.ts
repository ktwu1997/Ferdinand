import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import Page from "./+page.svelte";
import { resetPageStub } from "../test/stubs/app-stores";
import { decks as fakeDecks, history, totalDue } from "$lib/data";
import type { ApiDeckListResponse, ApiHealth } from "$lib/api";

// Phase 8-D: contract tests for the home route. Mock only the network
// surface (fetchDecks + fetchHealth) — LiveIndicator calls fetchHealth
// on its own onMount, so we must control both to exercise the live /
// offline branches. `importOriginal` keeps mediaBase, apiBase, and the
// rest of $lib/api real, matching the 8-C pattern.
vi.mock("$lib/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("$lib/api")>();
    return {
        ...actual,
        fetchDecks: vi.fn(),
        fetchHealth: vi.fn(),
    };
});

import { fetchDecks, fetchHealth } from "$lib/api";

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

const healthLive: ApiHealth = { ok: true, version: "0.1.0" };

// Two concurrent async onMount chains run under one mount(): the page's
// fetchDecks and LiveIndicator's fetchHealth. 10 microtask turns is
// generous for both to resolve before the assertions.
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flushSync();
}

describe("HomePage contract", () => {
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

    test("fetchDecks success: backend decks drive h1 total and rendered rows", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(vi.mocked(fetchDecks)).toHaveBeenCalledTimes(1);

            // h1 reflects backend totals: 5 new + 2 learn + 3 review = 10.
            expect(container.querySelector("h1")?.textContent).toContain("10");

            // level>=1 filter leaves exactly one live row.
            const rows = container.querySelectorAll(".deck-grid .deck-row");
            expect(rows.length).toBe(1);

            expect(
                container
                    .querySelector(".deck-grid .deck-name")
                    ?.textContent?.trim(),
            ).toBe("Spanish");

            expect(
                container.querySelector(".deck-grid .deck-sub")?.textContent,
            ).toContain("10 cards");

            expect(
                container
                    .querySelector(".deck-grid .deck-due.has-due .due-count")
                    ?.textContent?.trim(),
            ).toBe("10");

            // Resume picks decks[0] → Spanish after mapping.
            expect(
                container.querySelector(".resume h2")?.textContent,
            ).toContain("Spanish");
        } finally {
            unmount(instance);
        }
    });

    test("fetchDecks rejects: explicit banner surfaces server message; fakeDecks still rendered (Phase 10-B)", async () => {
        vi.mocked(fetchDecks).mockRejectedValueOnce(
            new Error("backend unreachable"),
        );
        vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(vi.mocked(fetchDecks)).toHaveBeenCalledTimes(1);

            // Phase 10-B: banner appears with the server's error string so
            // users know counts are stale (vs. 9-S browse-tree silent
            // fallback — home page is the entry point, surfacing the
            // outage here is more valuable than dead silence).
            const banner = container.querySelector(".error-banner");
            expect(banner).not.toBeNull();
            expect(banner?.textContent).toContain("backend unreachable");
            expect(banner?.textContent).toContain("cached counts");

            // Fake fallback still renders so the page isn't blank.
            const rows = container.querySelectorAll(".deck-grid .deck-row");
            expect(rows.length).toBe(fakeDecks.length);

            // h1 sums totalDue over every fakeDeck (96 at time of writing —
            // computed rather than hardcoded so fixture updates flow through).
            const expectedTotalDue = fakeDecks.reduce(
                (a, d) => a + totalDue(d),
                0,
            );
            expect(container.querySelector("h1")?.textContent).toContain(
                String(expectedTotalDue),
            );

            expect(
                container.querySelector(".resume h2")?.textContent,
            ).toContain(fakeDecks[0].name);
        } finally {
            unmount(instance);
        }
    });

    test("fetchDecks success: no error banner on the page (Phase 10-B)", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Banner is reserved for fetch failure — happy path stays clean.
            expect(container.querySelector(".error-banner")).toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("LiveIndicator: fetchHealth ok renders .tag.live with version", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockResolvedValueOnce({
            ok: true,
            version: "0.1.0",
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const tag = container.querySelector(".tag.live");
            expect(tag).not.toBeNull();
            expect(tag?.textContent).toContain("Live");
            expect(tag?.textContent).toContain("0.1.0");
        } finally {
            unmount(instance);
        }
    });

    test("LiveIndicator: fetchHealth rejects renders .tag.offline with 'Demo data'", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockRejectedValueOnce(
            new Error("health check failed"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const tag = container.querySelector(".tag.offline");
            expect(tag).not.toBeNull();
            expect(tag?.textContent).toContain("Demo data");
        } finally {
            unmount(instance);
        }
    });

    test("Resume CTA links to first deck's study route with 'Start studying'", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Live deck id 42 is mapped to string in +page.svelte.
            const cta = container.querySelector(
                '.resume-cta a[href="/study/42"]',
            );
            expect(cta).not.toBeNull();
            expect(cta?.textContent).toContain("Start studying");
        } finally {
            unmount(instance);
        }
    });

    test("Stats section: .stat-value equals totalReviews.toLocaleString()", async () => {
        vi.mocked(fetchDecks).mockResolvedValueOnce(decksOk);
        vi.mocked(fetchHealth).mockResolvedValueOnce(healthLive);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const totalReviews = history.reduce((a, d) => a + d.reviews, 0);
            expect(
                container.querySelector(".stat-value")?.textContent?.trim(),
            ).toBe(totalReviews.toLocaleString());

            const headings = Array.from(
                container.querySelectorAll(".section-head h3"),
            ).map((h) => h.textContent?.trim());
            expect(headings).toEqual(
                expect.arrayContaining(["All decks", "Last 30 days"]),
            );
        } finally {
            unmount(instance);
        }
    });
});
