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
        fetchNotetypes: vi.fn(),
        getCard: vi.fn(),
        patchDeckConfigById: vi.fn(),
        patchNotetypeName: vi.fn(),
        postDeckConfig: vi.fn(),
        postNotetypeField: vi.fn(),
        deleteDeckConfig: vi.fn(),
        deleteNotetypeField: vi.fn(),
        putFsrsEnabled: vi.fn(),
        putFsrsHealthCheck: vi.fn(),
        postFsrsOptimize: vi.fn(),
        resetCardToNew: vi.fn(),
        // WS2: admin user-list fetch + create-user. The other admin shims
        // (reset/disable) aren't exercised by these tests, so leave them
        // real via the spread above.
        fetchAdminUsers: vi.fn(),
        postAdminCreateUser: vi.fn(),
    };
});

import Page from "./+page.svelte";
import { auth } from "$lib/auth.svelte";
import {
    deleteDeckConfig,
    deleteNotetypeField,
    fetchAdminUsers,
    fetchDeckConfigById,
    fetchDeckConfigs,
    fetchFsrsEnabled,
    fetchFsrsHealthCheck,
    fetchNotetypes,
    getCard,
    patchDeckConfigById,
    patchNotetypeName,
    postAdminCreateUser,
    postDeckConfig,
    postFsrsOptimize,
    postNotetypeField,
    putFsrsEnabled,
    putFsrsHealthCheck,
    resetCardToNew,
    type ApiAdminUser,
    type ApiAdminUserList,
    type ApiCardSummary,
    type ApiDeckConfigDefault,
    type ApiDeckConfigListResponse,
    type ApiFsrsEnabled,
    type ApiFsrsHealthCheck,
    type ApiNotetypeListResponse,
} from "$lib/api";

// Phase 10-C: factory keeps existing tests cheap as DeckConfig grows.
// new_per_day / reviews_per_day / cap_answer_time_secs were added in 10-C
// and must be present on every ApiDeckConfigDefault fixture.
// Phase 17-C: new_card_order added (default "due", matching the proto
// enum's NewCardInsertOrder::Due=0). Existing fixtures inherit this so
// the segmented control hydrates to the documented default.
function makeConf(overrides: Partial<ApiDeckConfigDefault> = {}): ApiDeckConfigDefault {
    return {
        id: 1,
        name: "Default",
        desired_retention: 0.9,
        maximum_review_interval: 36500,
        new_per_day: 20,
        reviews_per_day: 200,
        cap_answer_time_secs: 60,
        new_card_order: "due",
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

    // Phase B-test-fix-2b: nav buttons now expose `[data-testid=settings-nav-{id}]`
    // (sketch-skin port A4-ε₂.c) — switch off textContent matching so the helper
    // is independent of icon/svg textContent + the lowercase label render.
    function clickNav(id: string): void {
        const btn = container.querySelector<HTMLButtonElement>(
            `[data-testid="settings-nav-${id}"]`,
        );
        if (!btn) throw new Error(`nav id "${id}" not found`);
        btn.click();
        flushSync();
    }

    test("initial render: active=fsrs — panel title, subtitle, active nav (weights empty until optimize)", () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            flushSync();

            // Phase B-test-fix-2b: per-section title moved from <h1> to
            // `[data-testid=settings-panel-title]` (an h2 inside .tx-panel)
            // when sketch-skin landed; the page-level h1 is now "preferences".
            // The panel title carries an inline ".tx-panel-hand" sub-span
            // ("tune the scheduler"), so assert via toContain on the lowercase
            // section label.
            const panelTitle = container.querySelector(
                '[data-testid="settings-panel-title"]',
            );
            expect(panelTitle?.textContent?.toLowerCase()).toContain("fsrs");

            // Subtitle (panel-sub) copy is now lowercase: "tune fsrs v5 to
            // match your memory" — assert on the substring.
            expect(
                container.querySelector(".tx-panel-sub")?.textContent,
            ).toContain("fsrs v5");

            // Phase 9-O2 removed the 19 fake placeholder weights. Real
            // params arrive only after a successful optimize call —
            // covered in the 9-O3 wiring tests below.
            expect(container.querySelectorAll(".tx-w-cell").length).toBe(0);

            // Active nav reflects "fsrs" — read .tx-nav-label so the icon's
            // svg textContent doesn't leak into the assertion.
            const activeLabel = container.querySelector(
                ".tx-nav-item-active .tx-nav-label",
            );
            expect(activeLabel?.textContent?.trim()).toBe("fsrs");
        } finally {
            unmount(instance);
        }
    });

    test("click 'Appearance' nav switches content to 3 theme-opt radio choices", () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            flushSync();

            clickNav("appearance");

            const panelTitle = container.querySelector(
                '[data-testid="settings-panel-title"]',
            );
            expect(panelTitle?.textContent?.toLowerCase()).toContain("appearance");
            expect(container.querySelectorAll(".tx-theme-opt").length).toBe(3);
            expect(
                container.querySelectorAll(
                    ".tx-theme-opt input[type='radio']",
                ).length,
            ).toBe(3);
        } finally {
            unmount(instance);
        }
    });

    test("click 'Sync' nav shows sync-status with 'connected'", () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            flushSync();

            clickNav("sync");

            const panelTitle = container.querySelector(
                '[data-testid="settings-panel-title"]',
            );
            expect(panelTitle?.textContent?.toLowerCase()).toContain("sync");
            // Phase B-test-fix-2b: sketch-skin renamed the sync status copy
            // from "Synced with your Anki server" to "connected" (the m4
            // self-hosted server preview lives below in .tx-hint, but the
            // status pill itself is the one-word label tested here).
            expect(
                container.querySelector(".tx-sync-label")?.textContent,
            ).toContain("connected");
        } finally {
            unmount(instance);
        }
    });

    test("click 'Profile' nav shows generic placeholder copy", () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            flushSync();

            clickNav("profile");

            const panelTitle = container.querySelector(
                '[data-testid="settings-panel-title"]',
            );
            expect(panelTitle?.textContent?.toLowerCase()).toContain("profile");
            const placeholder = container.querySelector('[data-testid="settings-placeholder-card"]');
            expect(placeholder).not.toBeNull();
            expect(placeholder?.textContent).toContain("profile");
        } finally {
            unmount(instance);
        }
    });

    test("nav renders all sections in declared order", () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            flushSync();

            // Phase B-test-fix-2b: read .tx-nav-label rather than the whole
            // button so we don't pick up the icon's svg textContent. Sketch-
            // skin renders the section labels lowercase via {s.label.toLowerCase()}.
            // (Admin row only renders when auth.user.is_admin — auth state is
            // not stubbed here, so the 8-base-section list applies.)
            const labels = Array.from(
                container.querySelectorAll<HTMLSpanElement>(".tx-nav-label"),
            ).map((el) => el.textContent?.trim());
            expect(labels).toEqual([
                "profile",
                "scheduling",
                "fsrs",
                "notetypes",
                "recovery",
                "sync",
                "appearance",
                "advanced",
            ]);
        } finally {
            unmount(instance);
        }
    });

    test("exactly one .tx-nav-item-active at a time; label tracks the active section", () => {
        const instance = mount(Page, { target: container, props: {} });
        try {
            flushSync();

            expect(
                container.querySelectorAll(".tx-nav-item-active").length,
            ).toBe(1);

            clickNav("advanced");
            expect(
                container.querySelectorAll(".tx-nav-item-active").length,
            ).toBe(1);
            expect(
                container
                    .querySelector(".tx-nav-item-active .tx-nav-label")
                    ?.textContent?.trim(),
            ).toBe("advanced");

            clickNav("profile");
            expect(
                container.querySelectorAll(".tx-nav-item-active").length,
            ).toBe(1);
            expect(
                container
                    .querySelector(".tx-nav-item-active .tx-nav-label")
                    ?.textContent?.trim(),
            ).toBe("profile");
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
                container.querySelector(".tx-value-pill")?.textContent?.trim(),
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

            // Phase B-test-fix-2b: sketch-skin lowercased disclaimer copy.
            // Lives at .tx-disclaimer, prefixed with "// ". Body now reads
            // "// editing presets directly. per-deck assignment lands in a later release."
            const disclaimer = container.querySelector(".tx-disclaimer");
            expect(disclaimer).not.toBeNull();
            expect(disclaimer?.textContent).toContain(
                "editing presets directly",
            );
            expect(disclaimer?.textContent).toContain(
                "per-deck assignment",
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

            expect(container.querySelector('[data-testid="settings-load-error"]')).not.toBeNull();
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

            const err = container.querySelector(".tx-error");
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
            '[data-testid="settings-reoptimize-btn"]',
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

            expect(container.querySelectorAll(".tx-w-cell").length).toBe(19);
            const hint = container.querySelector('[data-testid="settings-optimize-card"] .tx-hint');
            // Phase B-test-fix-2b: optimize hint copy is lowercase
            // ("trained on N reviews on Default · params updated.").
            expect(hint?.textContent).toMatch(/trained on\s+1,234 reviews/);
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

            const hint = container.querySelector('[data-testid="settings-optimize-card"] .tx-hint');
            // Phase B-test-fix-2b: lowercase "no reviews available yet — log…"
            expect(hint?.textContent).toContain(
                "no reviews available yet",
            );
            expect(container.querySelectorAll(".tx-w-cell").length).toBe(0);
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

            const err = container.querySelector(".tx-error");
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
            const hint = container.querySelector('[data-testid="settings-optimize-card"] .tx-hint');
            // Phase B-test-fix-2b: optimize hint lowercase
            // ("trained on 7 reviews on Spanish · params updated.").
            expect(hint?.textContent).toMatch(/trained on\s+7 reviews\s+on Spanish/);
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

            const err = container.querySelector(".tx-error");
            expect(err).not.toBeNull();
            expect(err?.textContent).toContain("no decks use preset");
            // No params updated on failure — weights grid stays empty
            // (defaultConf has fsrs_params=[]).
            expect(container.querySelectorAll(".tx-w-cell").length).toBe(0);
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
                '[data-testid="settings-reoptimize-btn"]',
            ) as HTMLButtonElement;
            btn.click();
            flushSync();

            // Phase B-test-fix-2b: button copy is lowercase ("optimizing…" / "re-optimize").
            expect(btn.textContent?.trim()).toBe("optimizing…");
            expect(btn.disabled).toBe(true);

            resolveOptimize!({ fsrs_items: 1, params: [0.5] });
            await settle();

            expect(btn.textContent?.trim()).toBe("re-optimize");
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
            expect(container.querySelectorAll(".tx-w-cell").length).toBe(19);
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

            const hint = container.querySelector('[data-testid="settings-optimize-card"] .tx-hint');
            // Phase B-test-fix-2b: hint copy lowercase
            // ("loaded N params from disk · click re-optimize to retrain…").
            // We assert on "loaded.*19.*params" so we tolerate the new "from disk"
            // suffix without being brittle about its exact wording.
            expect(hint?.textContent).toMatch(/loaded\s+19\s+params/);
            // Must not lie that we just trained — that copy belongs to runOptimize.
            expect(hint?.textContent).not.toContain("trained on");
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
                container.querySelector(".tx-value-pill")?.textContent?.trim(),
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

            const hint = container.querySelector('[data-testid="settings-optimize-card"] .tx-hint');
            // Phase B-test-fix-2b: lowercase "click re-optimize to fit fsrs…"
            expect(hint?.textContent).toContain("click re-optimize");
            expect(container.querySelectorAll(".tx-w-cell").length).toBe(0);
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
                    container.querySelectorAll(".tx-error"),
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

    // Phase 17-C contract tests for the new-card insert order toggle.
    // The segmented control is a button group, not a num-input, so it
    // gets its own block — same vi.mocked + settle helpers, different
    // dispatch surface.
    describe("Phase 17-C new-card order toggle", () => {
        // Phase B-test-fix-2b: sketch-skin renamed `.segmented`/`.segment`
        // → `.tx-segmented`/`.tx-segment`, lowercased the labels ("due"/"random"),
        // and replaced the active modifier `.active` with `.tx-segment-active`.
        function getSegments(root: HTMLElement): {
            due: HTMLButtonElement;
            random: HTMLButtonElement;
        } {
            const segs = Array.from(
                root.querySelectorAll<HTMLButtonElement>(".tx-segmented .tx-segment"),
            );
            const due = segs.find((s) =>
                (s.textContent ?? "").trim() === "due",
            );
            const random = segs.find((s) =>
                (s.textContent ?? "").trim() === "random",
            );
            if (!due || !random) {
                throw new Error("segmented control buttons missing");
            }
            return { due, random };
        }

        test("snapshot 'random' hydrates segmented control with Random active", async () => {
            vi.mocked(fetchDeckConfigById).mockResolvedValueOnce(
                makeConf({ new_card_order: "random" }),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const { due, random } = getSegments(container);
                expect(random.classList.contains("tx-segment-active")).toBe(true);
                expect(random.getAttribute("aria-checked")).toBe("true");
                expect(due.classList.contains("tx-segment-active")).toBe(false);
                expect(due.getAttribute("aria-checked")).toBe("false");
            } finally {
                unmount(instance);
            }
        });

        test("clicking the inactive segment fires PATCH new_card_order and echoes server value", async () => {
            vi.mocked(patchDeckConfigById).mockResolvedValueOnce(
                makeConf({ new_card_order: "random" }),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const { due, random } = getSegments(container);
                // Default snapshot has Due active; clicking Random switches it.
                expect(due.classList.contains("tx-segment-active")).toBe(true);
                random.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                await settle();

                expect(vi.mocked(patchDeckConfigById)).toHaveBeenCalledTimes(1);
                expect(
                    vi.mocked(patchDeckConfigById).mock.calls[0],
                ).toEqual([1, { new_card_order: "random" }]);

                // Server-echoed value drives the visible state.
                const after = getSegments(container);
                expect(after.random.classList.contains("tx-segment-active")).toBe(true);
                expect(after.due.classList.contains("tx-segment-active")).toBe(false);
            } finally {
                unmount(instance);
            }
        });

        test("PATCH failure rolls back the optimistic toggle and surfaces inline error", async () => {
            vi.mocked(patchDeckConfigById).mockRejectedValueOnce(
                new Error("400 new_card_order must be \"due\" or \"random\""),
            );

            const instance = mount(Page, { target: container, props: {} });
            try {
                await settle();

                const { random } = getSegments(container);
                random.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                await settle();

                // After failure the active segment must roll back to Due
                // (the previous state) — Random clicked but not committed.
                const after = getSegments(container);
                expect(after.due.classList.contains("tx-segment-active")).toBe(true);
                expect(after.random.classList.contains("tx-segment-active")).toBe(false);

                // Inline error surfaces the server message.
                const errors = Array.from(
                    container.querySelectorAll(".tx-error"),
                );
                const orderErrors = errors.filter((e) =>
                    (e.textContent ?? "").includes("new_card_order"),
                );
                expect(orderErrors.length).toBe(1);
                expect(orderErrors[0]?.textContent).toContain(
                    "must be \"due\" or \"random\"",
                );
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
                '[data-testid="settings-new-preset-btn"]',
            ) as HTMLButtonElement | null;
            expect(newBtn).not.toBeNull();
            newBtn?.click();
            flushSync();

            // Post-state: input + Save + Cancel + (no error yet).
            const input = container.querySelector(
                "#new-preset-name",
            ) as HTMLInputElement | null;
            expect(input).not.toBeNull();
            // Phase B-test-fix-2b: sketch-skin replaced .save-preset-button /
            // .cancel-preset-button with text-driven buttons inside
            // .tx-create-preset-row. Search inside that scope by lowercase
            // textContent (icon + span text trims to e.g. "save").
            const createRowBtns = Array.from(
                container.querySelectorAll<HTMLButtonElement>(
                    ".tx-create-preset-row .tx-btn",
                ),
            );
            const save = createRowBtns.find(
                (b) => b.textContent?.trim() === "save",
            ) as HTMLButtonElement | undefined;
            const cancel = createRowBtns.find(
                (b) => b.textContent?.trim() === "cancel",
            ) as HTMLButtonElement | undefined;
            expect(save).toBeDefined();
            expect(cancel).toBeDefined();
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
                    '[data-testid="settings-new-preset-btn"]',
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

            // Phase B-test-fix-2b: locate the save button by lowercase text
            // inside the inline create row (sketch-skin removed the
            // .save-preset-button class).
            (Array.from(
                container.querySelectorAll<HTMLButtonElement>(
                    ".tx-create-preset-row .tx-btn",
                ),
            ).find(
                (b) => b.textContent?.trim() === "save",
            ) as HTMLButtonElement).click();
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
                container.querySelector('[data-testid="settings-new-preset-btn"]'),
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
                    '[data-testid="settings-new-preset-btn"]',
                ) as HTMLButtonElement
            ).click();
            flushSync();

            const input = container.querySelector(
                "#new-preset-name",
            ) as HTMLInputElement;
            input.value = "Default";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            // Phase B-test-fix-2b: locate the save button by lowercase text
            // inside the inline create row (sketch-skin removed the
            // .save-preset-button class).
            (Array.from(
                container.querySelectorAll<HTMLButtonElement>(
                    ".tx-create-preset-row .tx-btn",
                ),
            ).find(
                (b) => b.textContent?.trim() === "save",
            ) as HTMLButtonElement).click();
            await settle();

            // Form stays open; error surfaces in field-error.
            expect(container.querySelector("#new-preset-name")).not.toBeNull();
            const errors = Array.from(
                container.querySelectorAll(".tx-error"),
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
                container.querySelector('[data-testid="settings-delete-preset-btn"]'),
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
                '[data-testid="settings-delete-preset-btn"]',
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
                    '[data-testid="settings-delete-preset-btn"]',
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
                    '[data-testid="settings-delete-preset-btn"]',
                ) as HTMLButtonElement
            ).click();
            await settle();

            // Error surfaces in field-error inside .preset-row; selection
            // stays on Languages so the user can retry.
            const errors = Array.from(
                container.querySelectorAll(".tx-error"),
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
            ".tx-health-toggle input[type='checkbox']",
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
                Array.from(container.querySelectorAll(".tx-error")).some(
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
                container.querySelectorAll(".tx-error"),
            ).map((e) => e.textContent ?? "");
            expect(errors.some((t) => t.includes("collection locked"))).toBe(true);
        } finally {
            unmount(instance);
        }
    });
});

// Phase 16-B: notetype rename in the new "Notetypes" section. The tab
// is lazy-loaded — fetchNotetypes only fires after the user clicks the
// nav button. Each test resets mocks so unconsumed `mockResolvedValueOnce`
// queue entries don't leak across siblings (Phase 9-T `test_pattern_proven`).
describe("SettingsPage notetypes rename (Phase 16-B)", () => {
    let container: HTMLDivElement;

    const threeNotetypes: ApiNotetypeListResponse = {
        notetypes: [
            { id: 1_776_837_237_908, name: "Basic", fields: ["Front", "Back"] },
            {
                id: 1_776_837_237_909,
                name: "Basic (and reversed card)",
                fields: ["Front", "Back"],
            },
            {
                id: 1_776_837_237_910,
                name: "Cloze",
                fields: ["Text", "Back Extra"],
            },
        ],
    };

    beforeEach(() => {
        vi.resetAllMocks();
        // Same FSRS-card defaults as the outer describe — the
        // notetypes tab is opt-in but the page still mounts the FSRS
        // section by default, so its onMount load chain has to settle
        // cleanly.
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

    function clickNotetypesTab(): void {
        // Phase B-test-fix-2b: switch to the testid surface so we don't
        // depend on icon textContent or the lowercase label render.
        const tab = container.querySelector<HTMLButtonElement>(
            '[data-testid="settings-nav-notetypes"]',
        );
        expect(tab, "Notetypes nav button must render").not.toBeNull();
        tab!.click();
    }

    test("clicking the Notetypes tab triggers fetchNotetypes once; rows render with field counts", async () => {
        vi.mocked(fetchNotetypes).mockResolvedValueOnce(threeNotetypes);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            // Tab not yet clicked — fetchNotetypes must NOT have fired
            // (lazy-load contract; we don't pay the round-trip on every
            // settings open).
            expect(vi.mocked(fetchNotetypes)).not.toHaveBeenCalled();

            clickNotetypesTab();
            await settle();

            expect(vi.mocked(fetchNotetypes)).toHaveBeenCalledTimes(1);
            const rows = container.querySelectorAll(".tx-nt-row");
            expect(rows.length).toBe(3);
            // Names rendered in server-returned order (server already
            // sorts by lower(name) ascending).
            const names = Array.from(rows).map(
                (r) => r.querySelector(".tx-nt-name")?.textContent?.trim(),
            );
            expect(names).toEqual([
                "Basic",
                "Basic (and reversed card)",
                "Cloze",
            ]);
            // Field count meta line: "2 fields".
            const metas = Array.from(rows).map(
                (r) => r.querySelector(".tx-nt-meta")?.textContent?.trim(),
            );
            expect(metas[0]).toBe("2 fields");
            // Idempotent re-click does NOT refetch.
            clickNotetypesTab();
            await settle();
            expect(vi.mocked(fetchNotetypes)).toHaveBeenCalledTimes(1);
        } finally {
            unmount(instance);
        }
    });

    test("Rename → Save fires patchNotetypeName with trimmed name; row reflects server-canonical name", async () => {
        vi.mocked(fetchNotetypes).mockResolvedValueOnce(threeNotetypes);
        vi.mocked(patchNotetypeName).mockResolvedValueOnce({
            id: 1_776_837_237_908,
            name: "Basic Renamed",
            // Phase 19-A: patchNotetypeName now returns ApiNotetypeDetail
            // (the unified shape shared with patchNotetype). Empty fields
            // / templates here is fine — the rename UI under test only
            // reads `name`.
            fields: [],
            templates: [],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            clickNotetypesTab();
            await settle();

            // Click first row's "Rename" button.
            const firstRow = container.querySelector(".tx-nt-row")!;
            const renameBtn = Array.from(
                firstRow.querySelectorAll<HTMLButtonElement>(".tx-btn"),
            ).find((b) => b.textContent?.trim() === "rename");
            expect(renameBtn).toBeDefined();
            renameBtn!.click();
            await settle();

            // Inline input rendered, seeded with current name.
            const input = firstRow.querySelector<HTMLInputElement>(".tx-nt-input");
            expect(input).not.toBeNull();
            // Type new name with surrounding whitespace — server-side
            // trim is the source of truth so commit must pass through
            // verbatim and let the server normalise.
            input!.value = "  Basic Renamed  ";
            input!.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            // Click Save.
            const saveBtn = Array.from(
                firstRow.querySelectorAll<HTMLButtonElement>(".tx-btn"),
            ).find((b) => b.textContent?.trim() === "save");
            expect(saveBtn).toBeDefined();
            saveBtn!.click();
            await settle();

            expect(vi.mocked(patchNotetypeName)).toHaveBeenCalledTimes(1);
            // Client trims before sending — the server expects a clean
            // string and doesn't have a "raw" path, so we mirror its
            // contract (matches the deck-rename behaviour).
            expect(vi.mocked(patchNotetypeName)).toHaveBeenCalledWith(
                1_776_837_237_908,
                "Basic Renamed",
            );

            // Row reflects the server-canonical name (NOT the request
            // input — could differ if server normalisation added a
            // suffix in the future).
            const updatedRow = container.querySelector(".tx-nt-row")!;
            expect(
                updatedRow.querySelector(".tx-nt-name")?.textContent?.trim(),
            ).toBe("Basic Renamed");
            // Edit mode dismissed.
            expect(updatedRow.querySelector(".tx-nt-input")).toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("Server 400 surfaces inline; row stays in edit mode for retry", async () => {
        vi.mocked(fetchNotetypes).mockResolvedValueOnce(threeNotetypes);
        vi.mocked(patchNotetypeName).mockRejectedValueOnce(
            new Error("400 name must be at most 100 characters"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            clickNotetypesTab();
            await settle();

            const firstRow = container.querySelector(".tx-nt-row")!;
            (
                Array.from(
                    firstRow.querySelectorAll<HTMLButtonElement>(".tx-btn"),
                ).find((b) => b.textContent?.trim() === "rename")!
            ).click();
            await settle();

            const input = firstRow.querySelector<HTMLInputElement>(".tx-nt-input")!;
            input.value = "x".repeat(101);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            (
                Array.from(
                    firstRow.querySelectorAll<HTMLButtonElement>(".tx-btn"),
                ).find((b) => b.textContent?.trim() === "save")!
            ).click();
            await settle();

            expect(vi.mocked(patchNotetypeName)).toHaveBeenCalledTimes(1);
            // Inline error surfaces (NOT the global page banner — this is
            // a per-row mutation, not a load-time failure).
            const errors = Array.from(
                container.querySelectorAll(".tx-error"),
            ).map((e) => e.textContent ?? "");
            expect(
                errors.some((t) => t.includes("at most 100 characters")),
            ).toBe(true);
            // Still in edit mode so the user can shorten the name and
            // retry without re-clicking Rename.
            expect(firstRow.querySelector(".tx-nt-input")).not.toBeNull();
        } finally {
            unmount(instance);
        }
    });
});

// Phase 19-B: per-notetype add field. Uses the same Notetypes tab as
// the rename suite — the header row stays the same shape, but expanding
// a row reveals the fields list and a "+ New field" inline form.
describe("SettingsPage notetypes add field (Phase 19-B)", () => {
    let container: HTMLDivElement;

    const threeNotetypes: ApiNotetypeListResponse = {
        notetypes: [
            { id: 1_776_837_237_908, name: "Basic", fields: ["Front", "Back"] },
            {
                id: 1_776_837_237_909,
                name: "Basic (and reversed card)",
                fields: ["Front", "Back"],
            },
            {
                id: 1_776_837_237_910,
                name: "Cloze",
                fields: ["Text", "Back Extra"],
            },
        ],
    };

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

    function clickNotetypesTab(): void {
        const tab = container.querySelector<HTMLButtonElement>(
            '[data-testid="settings-nav-notetypes"]',
        );
        expect(tab).not.toBeNull();
        tab!.click();
    }

    function firstNotetypeRow(): HTMLLIElement {
        const row = container.querySelector<HTMLLIElement>(".tx-nt-row");
        if (!row) throw new Error(".nt-row not found — load fetchNotetypes?");
        return row;
    }

    function expandFirstRow(): void {
        const disclose = firstNotetypeRow().querySelector<HTMLButtonElement>(
            ".tx-nt-disclose",
        );
        if (!disclose) throw new Error(".nt-disclose missing");
        disclose.click();
    }

    test("expanding a notetype row reveals the fields list and a + New field button; collapsed rows show no list", async () => {
        // Lazy-render contract: the fields-list <ul> only renders when
        // the row is expanded. Mount with three notetypes, expand only
        // the first, assert the second row has neither the fields list
        // nor the add button — same scoping rule the rename UI uses.
        vi.mocked(fetchNotetypes).mockResolvedValueOnce(threeNotetypes);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            clickNotetypesTab();
            await settle();

            // Pre-expansion: no fields lists rendered.
            expect(
                container.querySelectorAll(".tx-nt-fields-list").length,
            ).toBe(0);

            expandFirstRow();
            flushSync();

            // Only the first row's fields list shows.
            const lists = container.querySelectorAll(".tx-nt-fields-list");
            expect(lists.length).toBe(1);
            const items = lists[0]!.querySelectorAll(".tx-nt-field-row");
            expect(items.length).toBe(2);
            const fieldNames = Array.from(items).map(
                (li) => li.querySelector(".tx-nt-field-name")?.textContent?.trim(),
            );
            expect(fieldNames).toEqual(["Front", "Back"]);
            // The "+ New field" button shows on the expanded row only.
            const addBtns = container.querySelectorAll(".tx-nt-add-btn");
            expect(addBtns.length).toBe(1);
        } finally {
            unmount(instance);
        }
    });

    test("typing a field name and clicking Add fires postNotetypeField; row reflects the new field count and name", async () => {
        vi.mocked(fetchNotetypes).mockResolvedValueOnce(threeNotetypes);
        // Server returns the full updated notetype detail — settings
        // mirrors only the `fields` array into local state to keep the
        // ApiNotetypeSummary picker shape slim.
        vi.mocked(postNotetypeField).mockResolvedValueOnce({
            id: 1_776_837_237_908,
            name: "Basic",
            fields: ["Front", "Back", "Phase19BTest"],
            templates: [],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            clickNotetypesTab();
            await settle();
            expandFirstRow();
            flushSync();

            // Open the inline + New field form.
            const addBtn = container.querySelector<HTMLButtonElement>(
                ".tx-nt-add-btn",
            );
            addBtn!.click();
            flushSync();

            const firstRow = firstNotetypeRow();
            // Two `.nt-input` candidates exist while the rename UI is
            // off and the field-add UI is on; the field-add input is
            // the one inside `.nt-field-add`.
            const input = firstRow.querySelector<HTMLInputElement>(
                ".tx-nt-field-add .tx-nt-input",
            );
            expect(input, "nt-field-add input must render").not.toBeNull();
            input!.value = "  Phase19BTest  ";
            input!.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            // Click Add (the button inside .nt-field-add — Cancel is
            // the second button, Add is the first).
            const addCommit = firstRow.querySelector<HTMLButtonElement>(
                ".tx-nt-field-add .tx-btn-ghost",
            );
            addCommit!.click();
            await settle();

            expect(vi.mocked(postNotetypeField)).toHaveBeenCalledTimes(1);
            // Trim happens at the boundary so the server gets the
            // canonical name without surrounding whitespace.
            expect(vi.mocked(postNotetypeField)).toHaveBeenCalledWith(
                1_776_837_237_908,
                "Phase19BTest",
            );

            // Field count meta updated to "3 fields" without a
            // refetch.
            const meta = firstRow.querySelector(".tx-nt-meta")?.textContent?.trim();
            expect(meta).toBe("3 fields");
            // Re-expand should still be open; new field appears in the
            // list (post-mutation re-render kept the disclosure open).
            const listItems = firstRow.querySelectorAll(".tx-nt-field-row");
            expect(listItems.length).toBe(3);
            expect(
                listItems[2]?.querySelector(".tx-nt-field-name")?.textContent
                    ?.trim(),
            ).toBe("Phase19BTest");
        } finally {
            unmount(instance);
        }
    });

    test("server 400 (e.g. duplicate name) surfaces inline on the row; row stays expanded so the user can correct and retry", async () => {
        vi.mocked(fetchNotetypes).mockResolvedValueOnce(threeNotetypes);
        vi.mocked(postNotetypeField).mockRejectedValueOnce(
            new Error("400 field name \"Front\" already exists on this notetype"),
        );

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            clickNotetypesTab();
            await settle();
            expandFirstRow();
            flushSync();
            container
                .querySelector<HTMLButtonElement>(".tx-nt-add-btn")!
                .click();
            flushSync();

            const firstRow = firstNotetypeRow();
            const input = firstRow.querySelector<HTMLInputElement>(
                ".tx-nt-field-add .tx-nt-input",
            );
            input!.value = "Front";
            input!.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            firstRow
                .querySelector<HTMLButtonElement>(".tx-nt-field-add .tx-btn-ghost")!
                .click();
            await settle();

            // Inline error scoped to the row — assertion is on the row's
            // `.field-error`, NOT a global banner.
            const rowErrors = Array.from(
                firstRow.querySelectorAll(".tx-error"),
            ).map((e) => e.textContent ?? "");
            expect(rowErrors.some((t) => t.includes("already exists"))).toBe(
                true,
            );
            // Field-add input still rendered so the user can fix the
            // name and retry. Pin: we don't auto-clear the draft on
            // error (would lose the user's typed content for a server
            // hiccup that may be transient).
            expect(
                firstRow.querySelector(".tx-nt-field-add .tx-nt-input"),
            ).not.toBeNull();
            // Row's persisted field count unchanged on the rejected add.
            const meta = firstRow
                .querySelector(".tx-nt-meta")
                ?.textContent?.trim();
            expect(meta).toBe("2 fields");
        } finally {
            unmount(instance);
        }
    });
});

// Phase 19-C: per-field destructive delete with two-step confirm.
// Same scaffold as the 19-B add-field suite — every test expands the
// first row, then exercises the ✕ glyph + Confirm/Cancel inline UI.
describe("SettingsPage notetypes delete field (Phase 19-C)", () => {
    let container: HTMLDivElement;

    const threeFieldsNotetype: ApiNotetypeListResponse = {
        notetypes: [
            {
                id: 1_776_837_237_908,
                name: "Basic",
                fields: ["Front", "Back", "Phase19CTest"],
            },
        ],
    };

    const oneFieldNotetype: ApiNotetypeListResponse = {
        notetypes: [
            {
                id: 1_776_837_237_915,
                name: "Skinny",
                fields: ["OnlyField"],
            },
        ],
    };

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

    function clickNotetypesTab(): void {
        const tab = container.querySelector<HTMLButtonElement>(
            '[data-testid="settings-nav-notetypes"]',
        );
        expect(tab).not.toBeNull();
        tab!.click();
    }

    function expandFirstRow(): void {
        const disclose = container.querySelector<HTMLButtonElement>(
            ".tx-nt-disclose",
        );
        if (!disclose) throw new Error(".nt-disclose missing");
        disclose.click();
    }

    test("clicking ✕ on a field arms the inline Confirm/Cancel pair; clicking Confirm fires deleteNotetypeField with the right ord", async () => {
        // Three-field notetype lets us delete the throwaway last field
        // without the last-field guard kicking in. Server returns the
        // canonical post-write detail; settings mirrors only `fields`.
        vi.mocked(fetchNotetypes).mockResolvedValueOnce(threeFieldsNotetype);
        vi.mocked(deleteNotetypeField).mockResolvedValueOnce({
            id: 1_776_837_237_908,
            name: "Basic",
            fields: ["Front", "Back"],
            templates: [],
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            clickNotetypesTab();
            await settle();
            expandFirstRow();
            flushSync();

            // Three field rows render, each with a ✕ button enabled
            // (count > 1 so the last-field guard doesn't disable any).
            const xButtons = container.querySelectorAll<HTMLButtonElement>(
                ".tx-nt-field-x",
            );
            expect(xButtons.length).toBe(3);
            expect(xButtons[2]?.disabled).toBe(false);

            // Click the third row's ✕ — Confirm/Cancel pair replaces
            // the ✕ inline (the ✕ on that row goes away).
            xButtons[2]!.click();
            flushSync();

            const fieldRows = container.querySelectorAll(".tx-nt-field-row");
            const targetRow = fieldRows[2]!;
            // Row now shows a "delete field?" prompt + confirm + cancel.
            // Phase B-test-fix-2b: sketch-skin lowercased the prompt copy.
            expect(
                targetRow
                    .querySelector(".tx-nt-field-confirm")
                    ?.textContent?.trim(),
            ).toBe("delete field?");
            const confirmBtn = Array.from(
                targetRow.querySelectorAll<HTMLButtonElement>(".tx-btn"),
            ).find((b) => b.textContent?.trim().startsWith("confirm"));
            expect(confirmBtn).toBeDefined();

            confirmBtn!.click();
            await settle();

            expect(vi.mocked(deleteNotetypeField)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(deleteNotetypeField)).toHaveBeenCalledWith(
                1_776_837_237_908,
                2,
            );
            // Field count meta updates to "2 fields" without a refetch
            // and the Confirm/Cancel pair clears (pendingDelete reset).
            expect(
                container.querySelector(".tx-nt-meta")?.textContent?.trim(),
            ).toBe("2 fields");
            expect(container.querySelector(".tx-nt-field-confirm")).toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("✕ stays disabled when a notetype has only one field; the last-field guard message reads from the title attribute", async () => {
        // The boundary refuses to delete the last field (server returns
        // 400) — UI mirrors that by disabling the ✕ glyph entirely so
        // the user never even reaches the Confirm step. Pin: a future
        // refactor that drops the disable would let the user click,
        // surface a 400, and lose the field name visibility while the
        // server roundtrip is in flight.
        vi.mocked(fetchNotetypes).mockResolvedValueOnce(oneFieldNotetype);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            clickNotetypesTab();
            await settle();
            expandFirstRow();
            flushSync();

            const xButtons = container.querySelectorAll<HTMLButtonElement>(
                ".tx-nt-field-x",
            );
            expect(xButtons.length).toBe(1);
            expect(xButtons[0]?.disabled).toBe(true);
            // Tooltip explains the disable so a user inspecting the
            // affordance gets the "why" without firing a request.
            expect(xButtons[0]?.title).toContain("at least one field");
            // No deletion ever fires.
            expect(vi.mocked(deleteNotetypeField)).not.toHaveBeenCalled();
        } finally {
            unmount(instance);
        }
    });

    test("Cancel on the inline confirm rolls back without firing deleteNotetypeField; field stays in the list", async () => {
        // Defensive UX: a misclicked ✕ followed by a Cancel must leave
        // the row exactly as it was — no stale request, no field
        // disappearing optimistically.
        vi.mocked(fetchNotetypes).mockResolvedValueOnce(threeFieldsNotetype);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            clickNotetypesTab();
            await settle();
            expandFirstRow();
            flushSync();

            container
                .querySelectorAll<HTMLButtonElement>(".tx-nt-field-x")[2]!
                .click();
            flushSync();

            // Click Cancel (second .ghost-btn inside the confirm row —
            // the first is "Confirm").
            const fieldRows = container.querySelectorAll(".tx-nt-field-row");
            const cancelBtn = Array.from(
                fieldRows[2]!.querySelectorAll<HTMLButtonElement>(".tx-btn"),
            ).find((b) => b.textContent?.trim() === "cancel");
            expect(cancelBtn).toBeDefined();
            cancelBtn!.click();
            flushSync();

            expect(vi.mocked(deleteNotetypeField)).not.toHaveBeenCalled();
            // Confirm UI gone, ✕ back, field count unchanged.
            expect(container.querySelector(".tx-nt-field-confirm")).toBeNull();
            const xs = container.querySelectorAll(".tx-nt-field-x");
            expect(xs.length).toBe(3);
            expect(
                container.querySelector(".tx-nt-meta")?.textContent?.trim(),
            ).toBe("3 fields");
        } finally {
            unmount(instance);
        }
    });
});

// Phase 20-C: burn-recovery — per-card reset to new with two-step
// destructive confirm. Same describe-local-default-mock + clickNav
// scaffold as the 19-C suite. Mocks getCard for the lookup populate
// case and resetCardToNew for the destructive call assertions.
describe("SettingsPage burn-recovery (Phase 20-C)", () => {
    let container: HTMLDivElement;

    function makeCard(overrides: Partial<ApiCardSummary> = {}): ApiCardSummary {
        return {
            id: 1714234567890,
            note_id: 1614234567890,
            deck_id: 1,
            deck_name: "Default",
            template_idx: 0,
            front_html: "<p>What is the capital of France?</p>",
            back_html: "<p>Paris</p>",
            tags: ["geography", "europe"],
            state: "review",
            ease_factor: 2.5,
            flag: 0,
            notetype_id: 1776837237908,
            notetype_name: "Basic",
            notetype_css: "",
            ...overrides,
        };
    }

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

    function clickRecoveryTab(): void {
        // Phase B-test-fix-2b: testid surface, same reason as Notetypes tab.
        const tab = container.querySelector<HTMLButtonElement>(
            '[data-testid="settings-nav-recovery"]',
        );
        if (!tab) throw new Error("Recovery nav-item not found");
        tab.click();
        flushSync();
    }

    async function lookupCard(idText: string): Promise<void> {
        const input = container.querySelector<HTMLInputElement>(
            "#recovery-card-id",
        );
        if (!input) throw new Error("recovery card id input missing");
        input.value = idText;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        flushSync();
        const lookupBtn = Array.from(
            container.querySelectorAll<HTMLButtonElement>(".tx-btn"),
        ).find((b) => b.textContent?.trim().startsWith("look up"));
        if (!lookupBtn) throw new Error("Look up button missing");
        lookupBtn.click();
        await settle();
    }

    test("look up populates card detail panel from getCard mock", async () => {
        // Verifies the getCard wiring: a successful lookup renders the
        // card preview block (deck/notetype/state/ease/tags) without
        // arming the destructive confirm — the user must explicitly
        // click Reset before any Confirm/Cancel UI shows.
        const card = makeCard({
            deck_name: "Geography",
            notetype_name: "Cloze",
            state: "review",
            ease_factor: 2.36,
            tags: ["capitals"],
        });
        vi.mocked(getCard).mockResolvedValueOnce(card);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            clickRecoveryTab();

            await lookupCard("1714234567890");

            expect(vi.mocked(getCard)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(getCard)).toHaveBeenCalledWith(1714234567890);

            // Card detail rows render with the mocked values — these
            // data-test selectors keep the assertions robust against
            // future style/layout edits to the recovery panel.
            expect(
                container
                    .querySelector('[data-test="recovery-card-deck"]')
                    ?.textContent?.trim(),
            ).toBe("Geography");
            expect(
                container
                    .querySelector('[data-test="recovery-card-notetype"]')
                    ?.textContent?.trim(),
            ).toBe("Cloze");
            expect(
                container
                    .querySelector('[data-test="recovery-card-state"]')
                    ?.textContent?.trim(),
            ).toBe("review");
            expect(
                container
                    .querySelector('[data-test="recovery-card-ease"]')
                    ?.textContent?.trim(),
            ).toBe("2.36");
            expect(
                container
                    .querySelector('[data-test="recovery-card-tags"]')
                    ?.textContent?.trim(),
            ).toBe("capitals");

            // Reset button visible, Confirm/Cancel pair NOT yet shown —
            // a successful lookup must not auto-arm the destructive
            // confirm. resetCardToNew also must not have fired.
            expect(
                container.querySelector('[data-test="recovery-reset-btn"]'),
            ).not.toBeNull();
            expect(
                container.querySelector('[data-test="recovery-confirm-btn"]'),
            ).toBeNull();
            expect(vi.mocked(resetCardToNew)).not.toHaveBeenCalled();
        } finally {
            unmount(instance);
        }
    });

    test("two-step confirm fires resetCardToNew exactly once on Confirm, not on Reset", async () => {
        // Destructive-discipline: clicking Reset must only arm the
        // Confirm/Cancel pair — never call resetCardToNew. Only the
        // second click (Confirm) hits the API. Mirrors the 19-C
        // notetype-delete-field two-step gate.
        const card = makeCard();
        vi.mocked(getCard).mockResolvedValueOnce(card);
        vi.mocked(resetCardToNew).mockResolvedValueOnce({
            id: card.id,
            state: "new",
            revlog_preserved: 7,
        });

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            clickRecoveryTab();
            await lookupCard(String(card.id));

            // First click — Reset to new — only arms the confirm pair.
            const resetBtn = container.querySelector<HTMLButtonElement>(
                '[data-test="recovery-reset-btn"]',
            );
            expect(resetBtn).not.toBeNull();
            resetBtn!.click();
            flushSync();

            expect(vi.mocked(resetCardToNew)).not.toHaveBeenCalled();
            expect(
                container.querySelector('[data-test="recovery-confirm-btn"]'),
            ).not.toBeNull();
            expect(
                container.querySelector('[data-test="recovery-cancel-btn"]'),
            ).not.toBeNull();
            // The "reset to new?" inline prompt must be visible while
            // the confirm is armed — keeps the destructive intent
            // explicit instead of relying on color alone.
            // Phase B-test-fix-2b: sketch-skin lowercased the prompt copy.
            expect(
                container
                    .querySelector('[data-test="recovery-confirm-prompt"]')
                    ?.textContent?.trim(),
            ).toBe("reset to new?");

            // Second click — Confirm — fires the destructive call.
            const confirmBtn = container.querySelector<HTMLButtonElement>(
                '[data-test="recovery-confirm-btn"]',
            );
            confirmBtn!.click();
            await settle();

            expect(vi.mocked(resetCardToNew)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(resetCardToNew)).toHaveBeenCalledWith(card.id);

            // Success copy mirrors the response — both state and
            // revlog count surface so the user has explicit evidence
            // history wasn't dropped. Form clears (preview gone, id
            // input emptied) so the next recovery starts fresh.
            const success = container.querySelector(
                '[data-test="recovery-success"]',
            );
            expect(success).not.toBeNull();
            expect(success?.textContent).toContain("State now: new");
            expect(success?.textContent).toContain(
                "7 revlog entries preserved",
            );
            expect(
                container.querySelector('[data-test="recovery-card-deck"]'),
            ).toBeNull();
            expect(
                container.querySelector<HTMLInputElement>(
                    "#recovery-card-id",
                )?.value,
            ).toBe("");
        } finally {
            unmount(instance);
        }
    });

    test("Cancel mid-confirm rolls back to button state without firing resetCardToNew", async () => {
        // Defensive UX: a misclicked Reset followed by Cancel must
        // leave the panel exactly as it was — card preview intact,
        // Reset button restored, no stale destructive request.
        const card = makeCard();
        vi.mocked(getCard).mockResolvedValueOnce(card);

        const instance = mount(Page, { target: container, props: {} });
        try {
            await settle();
            clickRecoveryTab();
            await lookupCard(String(card.id));

            container
                .querySelector<HTMLButtonElement>(
                    '[data-test="recovery-reset-btn"]',
                )!
                .click();
            flushSync();

            // Confirm pair armed.
            expect(
                container.querySelector('[data-test="recovery-confirm-btn"]'),
            ).not.toBeNull();

            // Click Cancel — state rolls back.
            const cancelBtn = container.querySelector<HTMLButtonElement>(
                '[data-test="recovery-cancel-btn"]',
            );
            expect(cancelBtn).not.toBeNull();
            cancelBtn!.click();
            flushSync();

            expect(vi.mocked(resetCardToNew)).not.toHaveBeenCalled();
            // Reset button back, Confirm/Cancel gone, card preview
            // still showing (so the user can retry without re-typing
            // the id and waiting for a second lookup roundtrip).
            expect(
                container.querySelector('[data-test="recovery-reset-btn"]'),
            ).not.toBeNull();
            expect(
                container.querySelector('[data-test="recovery-confirm-btn"]'),
            ).toBeNull();
            expect(
                container.querySelector('[data-test="recovery-card-deck"]'),
            ).not.toBeNull();
        } finally {
            unmount(instance);
        }
    });
});

// WS2: admin "Add User" inline form. Mirrors the burn-recovery / add-field
// describe blocks — mount the page with auth stubbed to an admin user,
// navigate to the admin tab, drive the form, assert the wrapper call +
// list refetch + form reset / inline-error behaviour.
describe("SettingsPage admin add-user flow (WS2)", () => {
    let container: HTMLDivElement;
    let savedUser: typeof auth.user;
    let savedStatus: typeof auth.status;

    const adminUser: ApiAdminUser = {
        id: 1,
        username: "ktwu",
        created_at: 1_700_000_000,
        disabled_at: null,
    };
    const graceUser: ApiAdminUser = {
        id: 2,
        username: "grace",
        created_at: 1_700_000_500,
        disabled_at: null,
    };
    const listBefore: ApiAdminUserList = { users: [adminUser] };
    const listAfter: ApiAdminUserList = { users: [adminUser, graceUser] };

    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(fetchDeckConfigs).mockResolvedValue(onlyDefaultList);
        vi.mocked(fetchDeckConfigById).mockResolvedValue(defaultConf);
        vi.mocked(fetchFsrsEnabled).mockResolvedValue(fsrsOff);
        vi.mocked(fetchFsrsHealthCheck).mockResolvedValue(healthCheckOff);
        // Auth: pretend the env-configured admin is logged in so the
        // "admin" nav row + panel render. Save/restore the singleton so
        // we don't leak state into other files' tests.
        savedUser = auth.user;
        savedStatus = auth.status;
        auth.user = { username: "ktwu", is_admin: true };
        auth.status = "authed";
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        auth.user = savedUser;
        auth.status = savedStatus;
        container.remove();
    });

    function clickNav(id: string): void {
        const btn = container.querySelector<HTMLButtonElement>(
            `[data-testid="settings-nav-${id}"]`,
        );
        if (!btn) throw new Error(`nav id "${id}" not found`);
        btn.click();
        flushSync();
    }

    async function openAdminPanel(): Promise<void> {
        flushSync();
        clickNav("admin");
        // $effect-driven first-load fetch resolves on a microtask.
        for (let i = 0; i < 6; i++) await Promise.resolve();
        flushSync();
    }

    test("the admin panel renders the add-user form for an admin user", async () => {
        vi.mocked(fetchAdminUsers).mockResolvedValue(listBefore);
        const instance = mount(Page, { target: container, props: {} });
        try {
            await openAdminPanel();
            expect(
                container.querySelector('[data-testid="settings-admin-create-form"]'),
            ).not.toBeNull();
            expect(
                container.querySelector('[data-testid="settings-admin-create-username"]'),
            ).not.toBeNull();
            const pw = container.querySelector<HTMLInputElement>(
                '[data-testid="settings-admin-create-password"]',
            );
            expect(pw).not.toBeNull();
            expect(pw?.type).toBe("password");
        } finally {
            unmount(instance);
        }
    });

    test("submitting the form calls postAdminCreateUser, refetches the list, and clears the inputs", async () => {
        vi.mocked(fetchAdminUsers)
            .mockResolvedValueOnce(listBefore)
            .mockResolvedValueOnce(listAfter);
        vi.mocked(postAdminCreateUser).mockResolvedValue(graceUser);
        const instance = mount(Page, { target: container, props: {} });
        try {
            await openAdminPanel();

            const usernameInput = container.querySelector<HTMLInputElement>(
                '[data-testid="settings-admin-create-username"]',
            )!;
            const passwordInput = container.querySelector<HTMLInputElement>(
                '[data-testid="settings-admin-create-password"]',
            )!;
            usernameInput.value = "grace";
            usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
            passwordInput.value = "s3kret-pw";
            passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            const form = container.querySelector<HTMLFormElement>(
                '[data-testid="settings-admin-create-form"]',
            )!;
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            for (let i = 0; i < 6; i++) await Promise.resolve();
            flushSync();

            expect(vi.mocked(postAdminCreateUser)).toHaveBeenCalledWith("grace", "s3kret-pw");
            // List was refetched (1 initial + 1 after create).
            expect(vi.mocked(fetchAdminUsers)).toHaveBeenCalledTimes(2);
            // New row is rendered.
            expect(
                container.querySelector('[data-testid="settings-admin-row-grace"]'),
            ).not.toBeNull();
            // Inputs cleared.
            expect(usernameInput.value).toBe("");
            expect(passwordInput.value).toBe("");
            // No inline error.
            expect(
                container.querySelector('[data-testid="settings-admin-create-error"]'),
            ).toBeNull();
        } finally {
            unmount(instance);
        }
    });

    test("a server error surfaces inline and the list is NOT refetched", async () => {
        vi.mocked(fetchAdminUsers).mockResolvedValue(listBefore);
        vi.mocked(postAdminCreateUser).mockRejectedValue(
            new Error("409 user 'grace' already exists"),
        );
        const instance = mount(Page, { target: container, props: {} });
        try {
            await openAdminPanel();

            const usernameInput = container.querySelector<HTMLInputElement>(
                '[data-testid="settings-admin-create-username"]',
            )!;
            const passwordInput = container.querySelector<HTMLInputElement>(
                '[data-testid="settings-admin-create-password"]',
            )!;
            usernameInput.value = "grace";
            usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
            passwordInput.value = "whatever";
            passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            const form = container.querySelector<HTMLFormElement>(
                '[data-testid="settings-admin-create-form"]',
            )!;
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            for (let i = 0; i < 6; i++) await Promise.resolve();
            flushSync();

            const err = container.querySelector(
                '[data-testid="settings-admin-create-error"]',
            );
            expect(err).not.toBeNull();
            expect(err?.textContent).toContain("already exists");
            // Only the initial list fetch; no refetch on failure.
            expect(vi.mocked(fetchAdminUsers)).toHaveBeenCalledTimes(1);
            // Inputs preserved so the admin can fix the name without retyping.
            expect(usernameInput.value).toBe("grace");
        } finally {
            unmount(instance);
        }
    });

    test("empty username is rejected client-side without hitting the API", async () => {
        vi.mocked(fetchAdminUsers).mockResolvedValue(listBefore);
        const instance = mount(Page, { target: container, props: {} });
        try {
            await openAdminPanel();

            const passwordInput = container.querySelector<HTMLInputElement>(
                '[data-testid="settings-admin-create-password"]',
            )!;
            passwordInput.value = "s3kret-pw";
            passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();

            const form = container.querySelector<HTMLFormElement>(
                '[data-testid="settings-admin-create-form"]',
            )!;
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            for (let i = 0; i < 6; i++) await Promise.resolve();
            flushSync();

            expect(vi.mocked(postAdminCreateUser)).not.toHaveBeenCalled();
            const err = container.querySelector(
                '[data-testid="settings-admin-create-error"]',
            );
            expect(err?.textContent?.toLowerCase()).toContain("username");
        } finally {
            unmount(instance);
        }
    });
});
