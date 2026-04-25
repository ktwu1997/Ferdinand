import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

// Phase 8-K bootstrap: 6 nav tests with no network deps.
// Phase 9-N3 conversion: settings now calls fetchDeckConfigDefault +
// fetchFsrsEnabled in onMount and patch/put on user interaction. We mock
// only those four — getJson, apiBase, mediaBase, etc. stay real via
// importOriginal, matching the 8-D / 8-E pattern.
vi.mock("$lib/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("$lib/api")>();
    return {
        ...actual,
        fetchDeckConfigDefault: vi.fn(),
        fetchFsrsEnabled: vi.fn(),
        patchDeckConfigDefault: vi.fn(),
        putFsrsEnabled: vi.fn(),
        postFsrsOptimize: vi.fn(),
    };
});

import Page from "./+page.svelte";
import {
    fetchDeckConfigDefault,
    fetchFsrsEnabled,
    patchDeckConfigDefault,
    postFsrsOptimize,
    putFsrsEnabled,
    type ApiDeckConfigDefault,
    type ApiFsrsEnabled,
} from "$lib/api";

const defaultConf: ApiDeckConfigDefault = {
    id: 1,
    name: "Default",
    desired_retention: 0.9,
    maximum_review_interval: 36500,
};

const fsrsOff: ApiFsrsEnabled = { enabled: false };

// onMount runs Promise.all over two fetches; persist handlers add another
// microtask-only chain. 10 turns + flushSync covers both.
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flushSync();
}

describe("SettingsPage contract", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.clearAllMocks();
        // Default mocks keep the FSRS card render path happy for the
        // 8-K-era nav tests (they don't query FSRS values, but we must
        // not leak unhandled rejections from onMount).
        vi.mocked(fetchDeckConfigDefault).mockResolvedValue(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValue(fsrsOff);
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

    test("initial render: active=fsrs — h1, subtitle, active nav (weights empty until optimize)", () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            flushSync();

            expect(container.querySelector("h1")?.textContent?.trim()).toBe(
                "FSRS",
            );
            expect(
                container.querySelector(".subtitle")?.textContent,
            ).toContain("FSRS v5");

            // Phase 9-O2 removed the 19 fake placeholder weights. Real
            // params arrive only after a successful optimize call —
            // covered in the 9-O3 wiring tests below.
            expect(container.querySelectorAll(".w-cell").length).toBe(0);

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

// Phase 9-N3: contract tests for the FSRS settings ↔ anki_server wiring.
// These exercise the four 9-N2 hooks (load, retention patch, max-interval
// patch, FSRS toggle put) plus the load-error and patch-error UI surfaces.
describe("SettingsPage FSRS wiring contract (Phase 9-N3)", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("onMount fires fetchDeckConfigDefault + fetchFsrsEnabled exactly once each", async () => {
        vi.mocked(fetchDeckConfigDefault).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(vi.mocked(fetchDeckConfigDefault)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(fetchFsrsEnabled)).toHaveBeenCalledTimes(1);
        } finally {
            unmount(instance);
        }
    });

    test("loaded values populate slider, pill, number input, and checkbox", async () => {
        vi.mocked(fetchDeckConfigDefault).mockResolvedValueOnce({
            id: 1,
            name: "Default",
            desired_retention: 0.85,
            maximum_review_interval: 365,
        });
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce({ enabled: true });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const slider = container.querySelector(
                "#desired-retention",
            ) as HTMLInputElement;
            expect(slider.value).toBe("85");

            expect(
                container.querySelector(".value-pill")?.textContent?.trim(),
            ).toBe("85%");

            const numInput = container.querySelector(
                "#max-interval",
            ) as HTMLInputElement;
            expect(numInput.valueAsNumber).toBe(365);

            const cb = container.querySelector(
                "#fsrs-enabled",
            ) as HTMLInputElement;
            expect(cb.checked).toBe(true);
        } finally {
            unmount(instance);
        }
    });

    test("disclaimer copy 'Editing the Default preset' renders in FSRS panel", async () => {
        vi.mocked(fetchDeckConfigDefault).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const disclaimer = container.querySelector(".disclaimer");
            expect(disclaimer).not.toBeNull();
            expect(disclaimer?.textContent).toContain(
                "Editing the Default preset",
            );
        } finally {
            unmount(instance);
        }
    });

    test("retention slider change persists desired_retention as float (pct/100)", async () => {
        vi.mocked(fetchDeckConfigDefault).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);
        vi.mocked(patchDeckConfigDefault).mockResolvedValueOnce({
            ...defaultConf,
            desired_retention: 0.92,
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const slider = container.querySelector(
                "#desired-retention",
            ) as HTMLInputElement;
            slider.value = "92";
            slider.dispatchEvent(new Event("input", { bubbles: true }));
            slider.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            expect(vi.mocked(patchDeckConfigDefault)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(patchDeckConfigDefault)).toHaveBeenCalledWith({
                desired_retention: 0.92,
            });
        } finally {
            unmount(instance);
        }
    });

    test("max-interval blur persists maximum_review_interval (no retention field)", async () => {
        vi.mocked(fetchDeckConfigDefault).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);
        vi.mocked(patchDeckConfigDefault).mockResolvedValueOnce({
            ...defaultConf,
            maximum_review_interval: 365,
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const numInput = container.querySelector(
                "#max-interval",
            ) as HTMLInputElement;
            numInput.value = "365";
            numInput.dispatchEvent(new Event("input", { bubbles: true }));
            numInput.dispatchEvent(new Event("blur", { bubbles: true }));
            await settle();

            expect(vi.mocked(patchDeckConfigDefault)).toHaveBeenCalledTimes(1);
            const call = vi.mocked(patchDeckConfigDefault).mock.calls[0]?.[0];
            expect(call).toEqual({ maximum_review_interval: 365 });
            expect(call?.desired_retention).toBeUndefined();
        } finally {
            unmount(instance);
        }
    });

    test("FSRS checkbox click puts {enabled: true}", async () => {
        vi.mocked(fetchDeckConfigDefault).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);
        vi.mocked(putFsrsEnabled).mockResolvedValueOnce({ enabled: true });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const cb = container.querySelector(
                "#fsrs-enabled",
            ) as HTMLInputElement;
            cb.click();
            await settle();

            expect(vi.mocked(putFsrsEnabled)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(putFsrsEnabled)).toHaveBeenCalledWith({
                enabled: true,
            });
        } finally {
            unmount(instance);
        }
    });

    test("FSRS toggle response value overrides optimistic local state", async () => {
        vi.mocked(fetchDeckConfigDefault).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);
        // Server clamps the request — UI must reflect the server's truth.
        vi.mocked(putFsrsEnabled).mockResolvedValueOnce({ enabled: false });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const cb = container.querySelector(
                "#fsrs-enabled",
            ) as HTMLInputElement;
            cb.click();
            await settle();

            expect(cb.checked).toBe(false);
        } finally {
            unmount(instance);
        }
    });

    test("load reject shows .error-banner and disables every FSRS control", async () => {
        vi.mocked(fetchDeckConfigDefault).mockRejectedValueOnce(
            new Error("backend unreachable"),
        );
        vi.mocked(fetchFsrsEnabled).mockRejectedValueOnce(
            new Error("backend unreachable"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(container.querySelector(".error-banner")).not.toBeNull();
            expect(
                (
                    container.querySelector(
                        "#desired-retention",
                    ) as HTMLInputElement
                ).disabled,
            ).toBe(true);
            expect(
                (
                    container.querySelector(
                        "#max-interval",
                    ) as HTMLInputElement
                ).disabled,
            ).toBe(true);
            expect(
                (
                    container.querySelector(
                        "#fsrs-enabled",
                    ) as HTMLInputElement
                ).disabled,
            ).toBe(true);
        } finally {
            unmount(instance);
        }
    });

    test("patch reject surfaces inline .field-error with server message", async () => {
        vi.mocked(fetchDeckConfigDefault).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);
        vi.mocked(patchDeckConfigDefault).mockRejectedValueOnce(
            new Error("400 desired_retention must be between 0.70 and 0.97"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const slider = container.querySelector(
                "#desired-retention",
            ) as HTMLInputElement;
            slider.value = "92";
            slider.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            const err = container.querySelector(".field-error");
            expect(err).not.toBeNull();
            expect(err?.textContent).toContain(
                "desired_retention must be between 0.70 and 0.97",
            );
        } finally {
            unmount(instance);
        }
    });
});

// Phase 9-O3: contract tests for the FSRS optimize wiring. These exercise
// the postFsrsOptimize hook (button click), the success/empty/error UI
// paths, and the in-flight disabled state. The reschedule-on-toggle path
// is already covered by the 9-N3 putFsrsEnabled tests above (the
// reschedule happens server-side; the contract from the page is
// unchanged: PUT /api/fsrs/enabled).
describe("SettingsPage FSRS optimize wiring contract (Phase 9-O3)", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    function clickReoptimize(): void {
        const btn = container.querySelector(
            ".re-optimize",
        ) as HTMLButtonElement | null;
        if (!btn) throw new Error("re-optimize button not found");
        btn.click();
        flushSync();
    }

    test("clicking Re-optimize calls postFsrsOptimize exactly once", async () => {
        vi.mocked(fetchDeckConfigDefault).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce({ enabled: true });
        vi.mocked(postFsrsOptimize).mockResolvedValueOnce({
            fsrs_items: 0,
            params: [],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            clickReoptimize();
            await settle();

            expect(vi.mocked(postFsrsOptimize)).toHaveBeenCalledTimes(1);
        } finally {
            unmount(instance);
        }
    });

    test("successful optimize renders one .w-cell per param and 'Trained on N reviews'", async () => {
        vi.mocked(fetchDeckConfigDefault).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce({ enabled: true });
        const params = Array.from({ length: 19 }, (_, i) => 0.1 + i * 0.05);
        vi.mocked(postFsrsOptimize).mockResolvedValueOnce({
            fsrs_items: 1234,
            params,
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            clickReoptimize();
            await settle();

            expect(container.querySelectorAll(".w-cell").length).toBe(19);
            const hint = container.querySelector(".card-head + .hint");
            expect(hint?.textContent).toMatch(/Trained on\s+1,234 reviews/);
        } finally {
            unmount(instance);
        }
    });

    test("optimize with fsrs_items=0 shows 'No reviews available yet' and renders no weights", async () => {
        vi.mocked(fetchDeckConfigDefault).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce({ enabled: true });
        vi.mocked(postFsrsOptimize).mockResolvedValueOnce({
            fsrs_items: 0,
            params: [],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            clickReoptimize();
            await settle();

            const hint = container.querySelector(".card-head + .hint");
            expect(hint?.textContent).toContain(
                "No reviews available yet",
            );
            expect(container.querySelectorAll(".w-cell").length).toBe(0);
        } finally {
            unmount(instance);
        }
    });

    test("optimize 400 reject surfaces server message into .field-error", async () => {
        vi.mocked(fetchDeckConfigDefault).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);
        vi.mocked(postFsrsOptimize).mockRejectedValueOnce(
            new Error("400 FSRS must be enabled before optimizing"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            clickReoptimize();
            await settle();

            const err = container.querySelector(".field-error");
            expect(err).not.toBeNull();
            expect(err?.textContent).toContain(
                "FSRS must be enabled before optimizing",
            );
        } finally {
            unmount(instance);
        }
    });

    test("button shows 'Optimizing…' and is disabled while the request is in flight", async () => {
        vi.mocked(fetchDeckConfigDefault).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce({ enabled: true });

        // Manual deferred so we can observe the in-flight UI before the
        // promise resolves.
        let resolveOptimize: (v: { fsrs_items: number; params: number[] }) => void;
        const pending = new Promise<{ fsrs_items: number; params: number[] }>(
            (r) => {
                resolveOptimize = r;
            },
        );
        vi.mocked(postFsrsOptimize).mockReturnValueOnce(pending);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const btn = container.querySelector(
                ".re-optimize",
            ) as HTMLButtonElement;
            btn.click();
            flushSync();

            expect(btn.textContent?.trim()).toBe("Optimizing…");
            expect(btn.disabled).toBe(true);

            resolveOptimize!({ fsrs_items: 1, params: [0.5] });
            await settle();

            expect(btn.textContent?.trim()).toBe("Re-optimize");
            expect(btn.disabled).toBe(false);
        } finally {
            unmount(instance);
        }
    });
});
