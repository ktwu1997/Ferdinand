import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

// Phase 8-K bootstrap: 6 nav tests with no network deps.
// Phase 9-N3 conversion: settings calls FSRS endpoints in onMount and
// patch/put on user interaction. Phase 9-O'' adds preset selector — onMount
// now resolves a list (fetchDeckConfigs) + a per-id detail
// (fetchDeckConfigById) instead of the single /default fetch. We mock only
// those network shims; getJson, apiBase, mediaBase, etc. stay real via
// importOriginal (8-D / 8-E pattern).
vi.mock("$lib/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("$lib/api")>();
    return {
        ...actual,
        fetchDeckConfigs: vi.fn(),
        fetchDeckConfigById: vi.fn(),
        fetchFsrsEnabled: vi.fn(),
        fetchFsrsHealthCheck: vi.fn(),
        patchDeckConfigById: vi.fn(),
        postDeckConfig: vi.fn(),
        deleteDeckConfig: vi.fn(),
        putFsrsEnabled: vi.fn(),
        putFsrsHealthCheck: vi.fn(),
        postFsrsOptimize: vi.fn(),
    };
});

import Page from "./+page.svelte";
import {
    deleteDeckConfig,
    fetchDeckConfigById,
    fetchDeckConfigs,
    fetchFsrsEnabled,
    fetchFsrsHealthCheck,
    patchDeckConfigById,
    postDeckConfig,
    postFsrsOptimize,
    putFsrsEnabled,
    putFsrsHealthCheck,
    type ApiDeckConfigDefault,
    type ApiDeckConfigListResponse,
    type ApiFsrsEnabled,
    type ApiFsrsHealthCheck,
} from "$lib/api";

// Phase 10-C: factory keeps existing tests cheap as DeckConfig grows.
// new_per_day / reviews_per_day / cap_answer_time_secs were added in 10-C
// and must be present on every ApiDeckConfigDefault fixture.
function makeConf(overrides: Partial<ApiDeckConfigDefault> = {}): ApiDeckConfigDefault {
    return {
        id: 1,
        name: "Default",
        desired_retention: 0.9,
        maximum_review_interval: 36500,
        new_per_day: 20,
        reviews_per_day: 200,
        cap_answer_time_secs: 60,
        fsrs_params: [],
        ...overrides,
    };
}

const defaultConf: ApiDeckConfigDefault = makeConf();

const onlyDefaultList: ApiDeckConfigListResponse = {
    configs: [{ id: 1, name: "Default" }],
};

const fsrsOff: ApiFsrsEnabled = { enabled: false };
const healthCheckOff: ApiFsrsHealthCheck = { enabled: false };

// onMount runs fetchDeckConfigs + fetchFsrsEnabled in parallel, then
// fetchDeckConfigById sequentially with the chosen preset id; persist
// handlers add another microtask-only chain. 10 turns + flushSync covers it.
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flushSync();
}

describe("SettingsPage contract", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        // resetAllMocks clears mock.calls AND implementations (including any
        // leftover mockResolvedValueOnce queue entries from prior tests that
        // a handler did not happen to consume). Phase 9-O'' added a third
        // network call (fetchDeckConfigs) to the onMount chain, which
        // exposed leftover-once leaking between tests under clearAllMocks.
        vi.resetAllMocks();
        // Default mocks keep the FSRS card render path happy for the
        // 8-K-era nav tests (they don't query FSRS values, but we must
        // not leak unhandled rejections from onMount).
        vi.mocked(fetchDeckConfigs).mockResolvedValue(onlyDefaultList);
        vi.mocked(fetchDeckConfigById).mockResolvedValue(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValue(fsrsOff);
        vi.mocked(fetchFsrsHealthCheck).mockResolvedValue(healthCheckOff);
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
        // 9-O'' parity with the outer beforeEach: resetAllMocks clears the
        // mockResolvedValueOnce queue (clearAllMocks alone leaves it intact),
        // then we set defaults so onMount's three network calls always have
        // a fallback shape even when a test forgot one.
        vi.resetAllMocks();
        vi.mocked(fetchDeckConfigs).mockResolvedValue(onlyDefaultList);
        vi.mocked(fetchDeckConfigById).mockResolvedValue(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValue(fsrsOff);
        vi.mocked(fetchFsrsHealthCheck).mockResolvedValue(healthCheckOff);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("onMount fires fetchDeckConfigById + fetchFsrsEnabled exactly once each", async () => {
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(vi.mocked(fetchDeckConfigById)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(fetchFsrsEnabled)).toHaveBeenCalledTimes(1);
        } finally {
            unmount(instance);
        }
    });

    test("loaded values populate slider, pill, number input, and checkbox", async () => {
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(
            makeConf({ desired_retention: 0.85, maximum_review_interval: 365 }),
        );
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

    test("disclaimer copy 'Editing presets directly' renders in FSRS panel (Phase 9-O'')", async () => {
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const disclaimer = container.querySelector(".disclaimer");
            expect(disclaimer).not.toBeNull();
            expect(disclaimer?.textContent).toContain(
                "Editing presets directly",
            );
            expect(disclaimer?.textContent).toContain(
                "Per-deck assignment",
            );
        } finally {
            unmount(instance);
        }
    });

    test("retention slider change persists desired_retention as float (pct/100)", async () => {
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);
        vi.mocked(patchDeckConfigById).mockResolvedValueOnce({
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

            expect(vi.mocked(patchDeckConfigById)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(patchDeckConfigById)).toHaveBeenCalledWith(1, {
                desired_retention: 0.92,
            });
        } finally {
            unmount(instance);
        }
    });

    test("max-interval blur persists maximum_review_interval (no retention field)", async () => {
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);
        vi.mocked(patchDeckConfigById).mockResolvedValueOnce({
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

            expect(vi.mocked(patchDeckConfigById)).toHaveBeenCalledTimes(1);
            const call = vi.mocked(patchDeckConfigById).mock.calls[0];
            expect(call?.[0]).toBe(1);
            expect(call?.[1]).toEqual({ maximum_review_interval: 365 });
            expect(call?.[1]?.desired_retention).toBeUndefined();
        } finally {
            unmount(instance);
        }
    });

    test("FSRS checkbox click puts {enabled: true}", async () => {
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
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
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
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
        vi.mocked(fetchDeckConfigById).mockRejectedValueOnce(
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
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);
        vi.mocked(patchDeckConfigById).mockRejectedValueOnce(
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
        // 9-O'' parity with the outer beforeEach: resetAllMocks clears the
        // mockResolvedValueOnce queue (clearAllMocks alone leaves it intact),
        // then we set defaults so onMount's three network calls always have
        // a fallback shape even when a test forgot one.
        vi.resetAllMocks();
        vi.mocked(fetchDeckConfigs).mockResolvedValue(onlyDefaultList);
        vi.mocked(fetchDeckConfigById).mockResolvedValue(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValue(fsrsOff);
        vi.mocked(fetchFsrsHealthCheck).mockResolvedValue(healthCheckOff);
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
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
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
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
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
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
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
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
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

    // Phase 14-B: per-preset optimize routes the selected preset id to
    // the server. The default-preset path now POSTs ?preset_id=1
    // explicitly (not the v1 omitted-preset behavior) so the
    // per-preset code path is exercised uniformly across presets.
    test("Phase 14-B: clicking Re-optimize passes selectedPresetId to postFsrsOptimize", async () => {
        // Multi-preset list so we can verify the *selected* (not just the
        // default) id reaches the server. preset_id=2 is "Spanish".
        vi.mocked(fetchDeckConfigs).mockResolvedValueOnce({
            configs: [
                { id: 1, name: "Default" },
                { id: 2, name: "Spanish" },
            ],
        });
        // First mount load: Default conf (auto-selected as preset id=1).
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
        // Switch-preset reload: Spanish conf with id=2.
        const spanishConf: ApiDeckConfigDefault = {
            ...defaultConf,
            id: 2,
            name: "Spanish",
        };
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(spanishConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce({ enabled: true });
        vi.mocked(postFsrsOptimize).mockResolvedValueOnce({
            fsrs_items: 7,
            params: [0.4],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Switch the preset selector to Spanish (id=2).
            const select = container.querySelector<HTMLSelectElement>(
                "#preset-select",
            );
            if (!select) throw new Error("preset-select not found");
            select.value = "2";
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            clickReoptimize();
            await settle();

            expect(vi.mocked(postFsrsOptimize)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(postFsrsOptimize)).toHaveBeenCalledWith(2);
            // Hint copy should mention the preset name.
            const hint = container.querySelector(".card-head + .hint");
            expect(hint?.textContent).toMatch(/Trained on\s+7 reviews\s+on Spanish/);
        } finally {
            unmount(instance);
        }
    });

    test("Phase 14-B: server 400 (preset has no decks) surfaces field-error", async () => {
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce({ enabled: true });
        vi.mocked(postFsrsOptimize).mockRejectedValueOnce(
            new Error(
                "400 no decks use preset 1777200000000; assign it to at least one deck before optimizing",
            ),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            clickReoptimize();
            await settle();

            const err = container.querySelector(".field-error");
            expect(err).not.toBeNull();
            expect(err?.textContent).toContain("no decks use preset");
            // No params updated on failure — weights grid stays empty
            // (defaultConf has fsrs_params=[]).
            expect(container.querySelectorAll(".w-cell").length).toBe(0);
        } finally {
            unmount(instance);
        }
    });

    test("button shows 'Optimizing…' and is disabled while the request is in flight", async () => {
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
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

// Phase 9-O': contract tests for hydrating optimizedParams from the new
// fsrs_params field on GET /api/deck_config/default. Closes the 9-O2 tail
// where the weights grid disappeared on every reload.
describe("SettingsPage FSRS params hydration contract (Phase 9-O')", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        // 9-O'' parity with the outer beforeEach: resetAllMocks clears the
        // mockResolvedValueOnce queue (clearAllMocks alone leaves it intact),
        // then we set defaults so onMount's three network calls always have
        // a fallback shape even when a test forgot one.
        vi.resetAllMocks();
        vi.mocked(fetchDeckConfigs).mockResolvedValue(onlyDefaultList);
        vi.mocked(fetchDeckConfigById).mockResolvedValue(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValue(fsrsOff);
        vi.mocked(fetchFsrsHealthCheck).mockResolvedValue(healthCheckOff);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("non-empty fsrs_params on mount renders one .w-cell per param", async () => {
        const params = Array.from({ length: 19 }, (_, i) => 0.2 + i * 0.03);
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce({
            ...defaultConf,
            fsrs_params: params,
        });
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce({ enabled: true });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // No optimize click yet — weights come purely from the GET response.
            expect(vi.mocked(postFsrsOptimize)).not.toHaveBeenCalled();
            expect(container.querySelectorAll(".w-cell").length).toBe(19);
        } finally {
            unmount(instance);
        }
    });

    test("non-empty fsrs_params on mount shows 'Loaded · N params' hint (distinct from post-optimize)", async () => {
        const params = Array.from({ length: 19 }, () => 0.5);
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce({
            ...defaultConf,
            fsrs_params: params,
        });
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce({ enabled: true });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const hint = container.querySelector(".card-head + .hint");
            expect(hint?.textContent).toMatch(/Loaded.*19\s+params/);
            // Must not lie that we just trained — that copy belongs to runOptimize.
            expect(hint?.textContent).not.toContain("Trained on");
        } finally {
            unmount(instance);
        }
    });

    test("preset selector mounts with all configs from fetchDeckConfigs; Default selected", async () => {
        vi.mocked(fetchDeckConfigs).mockResolvedValueOnce({
            configs: [
                { id: 1, name: "Default" },
                { id: 88, name: "Spanish heavy" },
                { id: 99, name: "Sparse Japanese" },
            ],
        });
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const select = container.querySelector<HTMLSelectElement>(
                "#preset-select",
            );
            expect(select).not.toBeNull();
            const options = Array.from(
                select?.querySelectorAll<HTMLOptionElement>("option") ?? [],
            );
            expect(options.map((o) => o.textContent?.trim())).toEqual([
                "Default",
                "Spanish heavy",
                "Sparse Japanese",
            ]);
            // Default (id=1) auto-selected on mount.
            expect(select?.value).toBe("1");
            expect(vi.mocked(fetchDeckConfigById)).toHaveBeenCalledWith(1);
        } finally {
            unmount(instance);
        }
    });

    test("changing the preset selector fires fetchDeckConfigById with the new id and reloads fields", async () => {
        vi.mocked(fetchDeckConfigs).mockResolvedValueOnce({
            configs: [
                { id: 1, name: "Default" },
                { id: 88, name: "Spanish heavy" },
            ],
        });
        // First call: id=1 (mount). Second call: id=88 (switch).
        vi.mocked(fetchDeckConfigById)
            .mockResolvedValueOnce(makeConf())
            .mockResolvedValueOnce(
                makeConf({
                    id: 88,
                    name: "Spanish heavy",
                    desired_retention: 0.95,
                    maximum_review_interval: 180,
                }),
            );
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const select = container.querySelector<HTMLSelectElement>(
                "#preset-select",
            );
            if (!select) throw new Error("#preset-select missing");
            select.value = "88";
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            expect(vi.mocked(fetchDeckConfigById)).toHaveBeenCalledTimes(2);
            expect(vi.mocked(fetchDeckConfigById).mock.calls[1]?.[0]).toBe(88);

            // Slider + max-interval reflect the switched preset's values.
            expect(
                container.querySelector(".value-pill")?.textContent?.trim(),
            ).toBe("95%");
            const numInput = container.querySelector<HTMLInputElement>(
                "#max-interval",
            );
            expect(numInput?.valueAsNumber).toBe(180);
        } finally {
            unmount(instance);
        }
    });

    test("switching preset routes the persist call to the new selected id (not Default)", async () => {
        vi.mocked(fetchDeckConfigs).mockResolvedValueOnce({
            configs: [
                { id: 1, name: "Default" },
                { id: 88, name: "Spanish heavy" },
            ],
        });
        vi.mocked(fetchDeckConfigById)
            .mockResolvedValueOnce(defaultConf)
            .mockResolvedValueOnce(
                makeConf({ id: 88, name: "Spanish heavy" }),
            );
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce(fsrsOff);
        vi.mocked(patchDeckConfigById).mockResolvedValueOnce(
            makeConf({
                id: 88,
                name: "Spanish heavy",
                desired_retention: 0.92,
            }),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const select = container.querySelector<HTMLSelectElement>(
                "#preset-select",
            );
            if (!select) throw new Error("#preset-select missing");
            select.value = "88";
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            const slider = container.querySelector<HTMLInputElement>(
                "#desired-retention",
            );
            if (!slider) throw new Error("slider missing");
            slider.value = "92";
            slider.dispatchEvent(new Event("input", { bubbles: true }));
            slider.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            expect(vi.mocked(patchDeckConfigById)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(patchDeckConfigById)).toHaveBeenCalledWith(88, {
                desired_retention: 0.92,
            });
        } finally {
            unmount(instance);
        }
    });

    test("empty fsrs_params on mount keeps 'Click Re-optimize' placeholder hint and no weights", async () => {
        vi.mocked(fetchDeckConfigById).mockResolvedValueOnce({
            ...defaultConf,
            fsrs_params: [],
        });
        vi.mocked(fetchFsrsEnabled).mockResolvedValueOnce({ enabled: false });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const hint = container.querySelector(".card-head + .hint");
            expect(hint?.textContent).toContain("Click Re-optimize");
            expect(container.querySelectorAll(".w-cell").length).toBe(0);
        } finally {
            unmount(instance);
        }
    });

    describe("Phase 10-C scheduling knobs", () => {
        async function blurNumInput(
            root: HTMLElement,
            id: string,
            value: number,
        ): Promise<HTMLInputElement> {
            const input = root.querySelector<HTMLInputElement>(`#${id}`);
            if (!input) throw new Error(`#${id} input missing`);
            input.value = String(value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("blur", { bubbles: true }));
            await settle();
            return input;
        }

        test("loaded values populate all 3 new num-inputs from preset snapshot", async () => {
            vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(
                makeConf({
                    new_per_day: 30,
                    reviews_per_day: 250,
                    cap_answer_time_secs: 90,
                }),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                expect(
                    container.querySelector<HTMLInputElement>("#new-per-day")
                        ?.valueAsNumber,
                ).toBe(30);
                expect(
                    container.querySelector<HTMLInputElement>(
                        "#reviews-per-day",
                    )?.valueAsNumber,
                ).toBe(250);
                expect(
                    container.querySelector<HTMLInputElement>(
                        "#cap-answer-time",
                    )?.valueAsNumber,
                ).toBe(90);
            } finally {
                unmount(instance);
            }
        });

        test("blur on each new num-input persists the right field via PATCH and echoes server value", async () => {
            vi.mocked(patchDeckConfigById)
                .mockResolvedValueOnce(makeConf({ new_per_day: 12 }))
                .mockResolvedValueOnce(makeConf({ reviews_per_day: 175 }))
                .mockResolvedValueOnce(makeConf({ cap_answer_time_secs: 50 }));

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                await blurNumInput(container, "new-per-day", 12);
                await blurNumInput(container, "reviews-per-day", 175);
                await blurNumInput(container, "cap-answer-time", 50);

                expect(
                    vi.mocked(patchDeckConfigById),
                ).toHaveBeenCalledTimes(3);
                expect(
                    vi.mocked(patchDeckConfigById).mock.calls[0],
                ).toEqual([1, { new_per_day: 12 }]);
                expect(
                    vi.mocked(patchDeckConfigById).mock.calls[1],
                ).toEqual([1, { reviews_per_day: 175 }]);
                expect(
                    vi.mocked(patchDeckConfigById).mock.calls[2],
                ).toEqual([1, { cap_answer_time_secs: 50 }]);

                // Each field's input echoes the server response, not the
                // raw blur value (server is source of truth).
                expect(
                    container.querySelector<HTMLInputElement>("#new-per-day")
                        ?.valueAsNumber,
                ).toBe(12);
                expect(
                    container.querySelector<HTMLInputElement>(
                        "#reviews-per-day",
                    )?.valueAsNumber,
                ).toBe(175);
                expect(
                    container.querySelector<HTMLInputElement>(
                        "#cap-answer-time",
                    )?.valueAsNumber,
                ).toBe(50);
            } finally {
                unmount(instance);
            }
        });

        test("PATCH 400 surfaces inline field-error scoped to the offending knob, others stay clean", async () => {
            vi.mocked(patchDeckConfigById).mockRejectedValueOnce(
                new Error("400 cap_answer_time_secs must be between 1 and 600"),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                await blurNumInput(container, "cap-answer-time", 999);

                // cap-answer-time field should now have a field-error sibling
                // containing the server message; no other field should.
                const allErrors = Array.from(
                    container.querySelectorAll(".field-error"),
                );
                const capErrors = allErrors.filter((e) =>
                    (e.textContent ?? "").includes("cap_answer_time_secs"),
                );
                expect(capErrors.length).toBe(1);
                expect(capErrors[0]?.textContent).toContain("between 1 and 600");

                // No spillover into the other two new fields.
                const text = allErrors.map((e) => e.textContent ?? "").join(" ");
                expect(text).not.toMatch(/new_per_day|reviews_per_day/);
            } finally {
                unmount(instance);
            }
        });
    });
});

// Phase 12-B: contract tests for "+ New preset" inline create flow.
// Default state (creatingPreset=false) hides the input row; clicking the
// new-preset button reveals it; saving fires postDeckConfig + appends the
// returned row + auto-switches to it via fetchDeckConfigById; server
// failure surfaces inline without dropping the user out of the form.
describe("SettingsPage create-preset flow (Phase 12-B)", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(fetchDeckConfigs).mockResolvedValue(onlyDefaultList);
        vi.mocked(fetchDeckConfigById).mockResolvedValue(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValue(fsrsOff);
        vi.mocked(fetchFsrsHealthCheck).mockResolvedValue(healthCheckOff);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    test("clicking '+ New preset' reveals inline name input + Save/Cancel", async () => {
        // The button only appears once onMount has resolved presets, so
        // we wait for the initial settle before exercising it.
        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Pre-state: input must not exist before opt-in.
            expect(container.querySelector("#new-preset-name")).toBeNull();

            const newBtn = container.querySelector(
                ".new-preset-button",
            ) as HTMLButtonElement | null;
            expect(newBtn).not.toBeNull();
            newBtn?.click();
            flushSync();

            // Post-state: input + Save + Cancel + (no error yet).
            const input = container.querySelector(
                "#new-preset-name",
            ) as HTMLInputElement | null;
            expect(input).not.toBeNull();
            const save = container.querySelector(
                ".save-preset-button",
            ) as HTMLButtonElement | null;
            const cancel = container.querySelector(
                ".cancel-preset-button",
            ) as HTMLButtonElement | null;
            expect(save).not.toBeNull();
            expect(cancel).not.toBeNull();
            // Save is disabled until the user types something.
            expect(save?.disabled).toBe(true);
        } finally {
            unmount(instance);
        }
    });

    test("save button calls postDeckConfig with trimmed name and switches to new preset", async () => {
        vi.mocked(postDeckConfig).mockResolvedValueOnce({
            id: 1777214900905,
            name: "Languages",
        });
        // Second fetchDeckConfigById fires from switchPreset(newId) right
        // after a successful create — return distinguishable values so we
        // can assert which preset the editor is showing.
        vi.mocked(fetchDeckConfigById)
            .mockResolvedValueOnce(defaultConf)
            .mockResolvedValueOnce(
                makeConf({
                    id: 1777214900905,
                    name: "Languages",
                    desired_retention: 0.85,
                }),
            );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            (
                container.querySelector(
                    ".new-preset-button",
                ) as HTMLButtonElement
            ).click();
            flushSync();

            const input = container.querySelector(
                "#new-preset-name",
            ) as HTMLInputElement;
            // Whitespace padding to confirm the trimmed name reaches the
            // server (matches the server's own trim+blank-check guard).
            input.value = "  Languages  ";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            (
                container.querySelector(
                    ".save-preset-button",
                ) as HTMLButtonElement
            ).click();
            await settle();

            expect(vi.mocked(postDeckConfig)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(postDeckConfig)).toHaveBeenCalledWith({
                name: "Languages",
            });
            // After create, the page hydrates the editor for the new preset
            // (second fetchDeckConfigById call) — verify the slider picked
            // up the new preset's retention.
            expect(vi.mocked(fetchDeckConfigById)).toHaveBeenCalledTimes(2);
            expect(vi.mocked(fetchDeckConfigById)).toHaveBeenLastCalledWith(
                1777214900905,
            );
            const slider = container.querySelector(
                "#desired-retention",
            ) as HTMLInputElement;
            expect(slider.value).toBe("85");

            // Form collapses back to button-only state.
            expect(container.querySelector("#new-preset-name")).toBeNull();
            expect(
                container.querySelector(".new-preset-button"),
            ).not.toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("server 400 (duplicate name) surfaces inline without leaving the form", async () => {
        vi.mocked(postDeckConfig).mockRejectedValueOnce(
            new Error("400 preset name already exists"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            (
                container.querySelector(
                    ".new-preset-button",
                ) as HTMLButtonElement
            ).click();
            flushSync();

            const input = container.querySelector(
                "#new-preset-name",
            ) as HTMLInputElement;
            input.value = "Default";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            (
                container.querySelector(
                    ".save-preset-button",
                ) as HTMLButtonElement
            ).click();
            await settle();

            // Form stays open; error surfaces in field-error.
            expect(container.querySelector("#new-preset-name")).not.toBeNull();
            const errors = Array.from(
                container.querySelectorAll(".field-error"),
            ).map((e) => e.textContent ?? "");
            expect(
                errors.some((t) => t.includes("preset name already exists")),
            ).toBe(true);
            // No phantom switch to a preset id we never received.
            expect(vi.mocked(fetchDeckConfigById)).toHaveBeenCalledTimes(1);
        } finally {
            unmount(instance);
        }
    });
});

// Phase 13-B: contract tests for the delete-preset flow. Default preset
// (id=1) must never expose a Delete button; user presets do, gated
// behind a window.confirm() so a stray click can't drop a preset. On
// success the page falls back to the first remaining preset (Default
// when present) and the editor hydrates from the successor.
describe("SettingsPage delete-preset flow (Phase 13-B)", () => {
    let container: HTMLDivElement;
    let confirmSpy: ReturnType<typeof vi.spyOn>;

    const twoPresetList: ApiDeckConfigListResponse = {
        configs: [
            { id: 1, name: "Default" },
            { id: 1777214900905, name: "Languages" },
        ],
    };

    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(fetchDeckConfigs).mockResolvedValue(twoPresetList);
        vi.mocked(fetchDeckConfigById).mockResolvedValue(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValue(fsrsOff);
        vi.mocked(fetchFsrsHealthCheck).mockResolvedValue(healthCheckOff);
        // Default to "user clicked OK" so test bodies don't all repeat
        // the spy install. Tests that need cancellation override per-call.
        confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        confirmSpy.mockRestore();
        container.remove();
    });

    test("Delete button is hidden when Default preset is selected", async () => {
        // Mount loads Default (id=1) by default; Delete must NOT render.
        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(
                container.querySelector(".delete-preset-button"),
            ).toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("Delete button appears when a non-Default preset is selected, and clicking it calls deleteDeckConfig + window.confirm", async () => {
        // First call: id=1 mount. Second call: id=1777... after switch.
        // Third call: Default after delete (successor hydrate).
        vi.mocked(fetchDeckConfigById)
            .mockResolvedValueOnce(defaultConf)
            .mockResolvedValueOnce(
                makeConf({ id: 1777214900905, name: "Languages" }),
            )
            .mockResolvedValueOnce(defaultConf);
        vi.mocked(deleteDeckConfig).mockResolvedValueOnce({
            removed_config_id: 1777214900905,
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            // Switch to Languages so the Delete button materialises.
            const select = container.querySelector<HTMLSelectElement>(
                "#preset-select",
            );
            if (!select) throw new Error("#preset-select missing");
            select.value = "1777214900905";
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            const delBtn = container.querySelector(
                ".delete-preset-button",
            ) as HTMLButtonElement | null;
            expect(delBtn).not.toBeNull();
            delBtn?.click();
            await settle();

            // Confirm prompt fired and request went out exactly once.
            expect(confirmSpy).toHaveBeenCalledTimes(1);
            const confirmMsg = String(confirmSpy.mock.calls[0]?.[0] ?? "");
            expect(confirmMsg).toContain("Languages");
            expect(vi.mocked(deleteDeckConfig)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(deleteDeckConfig)).toHaveBeenCalledWith(
                1777214900905,
            );
            // Successor hydrate fires via switchPreset → fetchDeckConfigById.
            // Mount=1, switch-to-Languages=2, delete-fallback-to-Default=3.
            expect(vi.mocked(fetchDeckConfigById)).toHaveBeenCalledTimes(3);
            expect(vi.mocked(fetchDeckConfigById)).toHaveBeenLastCalledWith(1);
        } finally {
            unmount(instance);
        }
    });

    test("cancelling the confirm prompt does not call deleteDeckConfig", async () => {
        confirmSpy.mockReturnValue(false);
        vi.mocked(fetchDeckConfigById)
            .mockResolvedValueOnce(defaultConf)
            .mockResolvedValueOnce(
                makeConf({ id: 1777214900905, name: "Languages" }),
            );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const select = container.querySelector<HTMLSelectElement>(
                "#preset-select",
            );
            if (!select) throw new Error("#preset-select missing");
            select.value = "1777214900905";
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            (
                container.querySelector(
                    ".delete-preset-button",
                ) as HTMLButtonElement
            ).click();
            await settle();

            expect(confirmSpy).toHaveBeenCalledTimes(1);
            expect(vi.mocked(deleteDeckConfig)).not.toHaveBeenCalled();
            // Languages still selected — fetchDeckConfigById called for
            // mount + switch only (2x), no successor hydrate.
            expect(vi.mocked(fetchDeckConfigById)).toHaveBeenCalledTimes(2);
            // Preset selector still shows Languages.
            const stillSelected = container.querySelector<HTMLSelectElement>(
                "#preset-select",
            );
            expect(stillSelected?.value).toBe("1777214900905");
        } finally {
            unmount(instance);
        }
    });

    test("server reject (e.g. 404) surfaces inline; selection unchanged", async () => {
        vi.mocked(fetchDeckConfigById)
            .mockResolvedValueOnce(defaultConf)
            .mockResolvedValueOnce(
                makeConf({ id: 1777214900905, name: "Languages" }),
            );
        vi.mocked(deleteDeckConfig).mockRejectedValueOnce(
            new Error("404 deck_config 1777214900905 not found"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            const select = container.querySelector<HTMLSelectElement>(
                "#preset-select",
            );
            if (!select) throw new Error("#preset-select missing");
            select.value = "1777214900905";
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            (
                container.querySelector(
                    ".delete-preset-button",
                ) as HTMLButtonElement
            ).click();
            await settle();

            // Error surfaces in field-error inside .preset-row; selection
            // stays on Languages so the user can retry.
            const errors = Array.from(
                container.querySelectorAll(".field-error"),
            ).map((e) => e.textContent ?? "");
            expect(
                errors.some((t) => t.includes("404")),
            ).toBe(true);
            const stillSelected = container.querySelector<HTMLSelectElement>(
                "#preset-select",
            );
            expect(stillSelected?.value).toBe("1777214900905");
            // No successor hydrate fired since delete failed.
            expect(vi.mocked(fetchDeckConfigById)).toHaveBeenCalledTimes(2);
        } finally {
            unmount(instance);
        }
    });
});

// Phase 15-B: FSRS health-check toggle. Mount-time hydration must
// resolve fetchFsrsHealthCheck so the checkbox reflects the persisted
// state; toggling fires putFsrsHealthCheck and rolls back on error.
// Same vi.resetAllMocks + describe-local default-mock pattern as the
// 9-N3 / 9-O'' blocks above.
describe("SettingsPage FSRS health-check toggle (Phase 15-B)", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(fetchDeckConfigs).mockResolvedValue(onlyDefaultList);
        vi.mocked(fetchDeckConfigById).mockResolvedValue(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValue(fsrsOff);
        vi.mocked(fetchFsrsHealthCheck).mockResolvedValue(healthCheckOff);
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    function healthCheckBox(): HTMLInputElement {
        const input = container.querySelector<HTMLInputElement>(
            ".health-toggle input[type='checkbox']",
        );
        if (!input) throw new Error("health-toggle checkbox not found");
        return input;
    }

    test("mount: fetchFsrsHealthCheck called once; checkbox reflects persisted true state", async () => {
        vi.mocked(fetchFsrsHealthCheck).mockResolvedValueOnce({ enabled: true });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();

            expect(vi.mocked(fetchFsrsHealthCheck)).toHaveBeenCalledTimes(1);
            expect(healthCheckBox().checked).toBe(true);
        } finally {
            unmount(instance);
        }
    });

    test("toggle on → putFsrsHealthCheck fires with {enabled: true}; checkbox stays checked on success", async () => {
        // Mount in OFF state (default mock), then click to flip ON.
        vi.mocked(putFsrsHealthCheck).mockResolvedValueOnce({ enabled: true });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            expect(healthCheckBox().checked).toBe(false);

            const cb = healthCheckBox();
            cb.checked = true;
            cb.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            expect(vi.mocked(putFsrsHealthCheck)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(putFsrsHealthCheck)).toHaveBeenCalledWith({
                enabled: true,
            });
            expect(healthCheckBox().checked).toBe(true);
            // No error banner on the happy path.
            expect(
                Array.from(container.querySelectorAll(".field-error")).some(
                    (e) => e.textContent?.includes("health-check"),
                ),
            ).toBe(false);
        } finally {
            unmount(instance);
        }
    });

    test("toggle on → server rejects: checkbox rolls back to OFF, error-banner surfaces server message", async () => {
        vi.mocked(putFsrsHealthCheck).mockRejectedValueOnce(
            new Error("500 collection locked"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            expect(healthCheckBox().checked).toBe(false);

            const cb = healthCheckBox();
            cb.checked = true;
            cb.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();

            expect(vi.mocked(putFsrsHealthCheck)).toHaveBeenCalledTimes(1);
            // Optimistic flip rolled back so the UI reflects what the
            // server still has — the user retries with eyes open.
            expect(healthCheckBox().checked).toBe(false);
            const errors = Array.from(
                container.querySelectorAll(".field-error"),
            ).map((e) => e.textContent ?? "");
            expect(errors.some((t) => t.includes("collection locked"))).toBe(true);
        } finally {
            unmount(instance);
        }
    });
});
