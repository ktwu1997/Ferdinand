import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import Page from "./+page.svelte";

// Phase 8-K: contract tests for the settings route. No network deps —
// this page only imports Card and keeps its state local. That lets the
// tests skip vi.mock + settle() entirely and lean on a single
// flushSync() after each interaction.
describe("SettingsPage contract", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    function clickNav(label: string): void {
        const btn = Array.from(
            container.querySelectorAll<HTMLButtonElement>(".nav-item"),
        ).find((b) => b.textContent?.trim() === label);
        if (!btn) throw new Error(`nav-item "${label}" not found`);
        btn.click();
        flushSync();
    }

    test("initial render: active=fsrs — h1, subtitle, 19 weights, active nav", () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            flushSync();

            expect(container.querySelector("h1")?.textContent?.trim()).toBe(
                "FSRS",
            );
            expect(
                container.querySelector(".subtitle")?.textContent,
            ).toContain("FSRS v5");

            expect(container.querySelectorAll(".w-cell").length).toBe(19);

            expect(
                container
                    .querySelector(".nav-item.active")
                    ?.textContent?.trim(),
            ).toBe("FSRS");
        } finally {
            unmount(instance);
        }
    });

    test("click 'Appearance' nav switches content to 3 theme-opt radio choices", () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            flushSync();

            clickNav("Appearance");

            expect(container.querySelector("h1")?.textContent?.trim()).toBe(
                "Appearance",
            );
            expect(container.querySelectorAll(".theme-opt").length).toBe(3);
            expect(
                container.querySelectorAll(
                    ".theme-opt input[type='radio']",
                ).length,
            ).toBe(3);
        } finally {
            unmount(instance);
        }
    });

    test("click 'Sync' nav shows sync-status with 'Synced with your Anki server'", () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            flushSync();

            clickNav("Sync");

            expect(container.querySelector("h1")?.textContent?.trim()).toBe(
                "Sync",
            );
            expect(
                container.querySelector(".sync-label")?.textContent,
            ).toContain("Synced with your Anki server");
        } finally {
            unmount(instance);
        }
    });

    test("click 'Profile' nav shows generic placeholder copy", () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            flushSync();

            clickNav("Profile");

            expect(container.querySelector("h1")?.textContent?.trim()).toBe(
                "Profile",
            );
            const placeholder = container.querySelector(".placeholder");
            expect(placeholder).not.toBeNull();
            expect(placeholder?.textContent).toContain("profile");
        } finally {
            unmount(instance);
        }
    });

    test("nav renders all 6 sections in declared order", () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            flushSync();

            const labels = Array.from(
                container.querySelectorAll<HTMLButtonElement>(".nav-item"),
            ).map((b) => b.textContent?.trim());
            expect(labels).toEqual([
                "Profile",
                "Scheduling",
                "FSRS",
                "Sync",
                "Appearance",
                "Advanced",
            ]);
        } finally {
            unmount(instance);
        }
    });

    test("exactly one .nav-item.active at a time; label tracks the active section", () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            flushSync();

            expect(
                container.querySelectorAll(".nav-item.active").length,
            ).toBe(1);

            clickNav("Advanced");
            expect(
                container.querySelectorAll(".nav-item.active").length,
            ).toBe(1);
            expect(
                container
                    .querySelector(".nav-item.active")
                    ?.textContent?.trim(),
            ).toBe("Advanced");

            clickNav("Profile");
            expect(
                container.querySelectorAll(".nav-item.active").length,
            ).toBe(1);
            expect(
                container
                    .querySelector(".nav-item.active")
                    ?.textContent?.trim(),
            ).toBe("Profile");
        } finally {
            unmount(instance);
        }
    });
});
