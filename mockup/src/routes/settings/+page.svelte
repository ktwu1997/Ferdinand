<script lang="ts">
    import { onMount } from "svelte";
    import Card from "$lib/components/Card.svelte";
    import {
        fetchDeckConfigById,
        fetchDeckConfigs,
        fetchFsrsEnabled,
        patchDeckConfigById,
        postDeckConfig,
        postFsrsOptimize,
        putFsrsEnabled,
        type ApiDeckConfigListItem,
    } from "$lib/api";

    let sections = [
        { id: "profile", label: "Profile" },
        { id: "scheduling", label: "Scheduling" },
        { id: "fsrs", label: "FSRS" },
        { id: "sync", label: "Sync" },
        { id: "appearance", label: "Appearance" },
        { id: "advanced", label: "Advanced" },
    ];

    let active = $state("fsrs");

    // FSRS settings wired to anki_server (Phase 9-N2; optimize/reschedule 9-O2;
    // multi-preset selector 9-O''). Server stores desired_retention as a
    // 0.70..=0.97 float; UI works in integer percent and converts at the
    // boundary. Persistence fires on change/blur (not input/keystroke) so a
    // slider drag is one PATCH.
    let loading = $state(true);
    let loadError: string | null = $state(null);
    let presets: ApiDeckConfigListItem[] = $state([]);
    let selectedPresetId = $state<number | null>(null);
    let switchingPreset = $state(false);
    let retentionPct = $state(90);
    let maxInterval = $state(36500);
    let fsrsEnabled = $state(false);
    let savingRetention = $state(false);
    let savingMaxInterval = $state(false);
    let savingFsrs = $state(false);
    let errorRetention: string | null = $state(null);
    let errorMaxInterval: string | null = $state(null);
    let errorFsrs: string | null = $state(null);

    // Phase 10-C: per-preset scheduling caps. Same onblur+PATCH pattern as
    // maxInterval — drag/keystroke does not persist, only blur or change.
    let newPerDay = $state(20);
    let reviewsPerDay = $state(200);
    let capAnswerTimeSecs = $state(60);
    let savingNewPerDay = $state(false);
    let savingReviewsPerDay = $state(false);
    let savingCapAnswerTime = $state(false);
    let errorNewPerDay: string | null = $state(null);
    let errorReviewsPerDay: string | null = $state(null);
    let errorCapAnswerTime: string | null = $state(null);

    // Optimize state. Phase 9-O' hydrates params from GET response so the
    // weights grid survives page reload. paramsSource distinguishes "loaded
    // from disk" hint copy from "trained this run" — the two share UI but
    // mean different things to the user. Re-evaluated on every preset switch
    // so the hint never lies about the active preset's training history.
    let optimizing = $state(false);
    let errorOptimize: string | null = $state(null);
    let optimizeFsrsItems: number | null = $state(null);
    let optimizedParams: number[] = $state([]);
    let paramsSource: "disk" | "fresh" | null = $state(null);

    // Phase 12-B: create-new-preset inline form. Hidden until user opts in
    // so the default settings layout stays the same; cancel restores it.
    let creatingPreset = $state(false);
    let newPresetName = $state("");
    let savingCreatePreset = $state(false);
    let errorCreatePreset: string | null = $state(null);

    function applyPresetSnapshot(
        conf: {
            desired_retention: number;
            maximum_review_interval: number;
            new_per_day: number;
            reviews_per_day: number;
            cap_answer_time_secs: number;
            fsrs_params: number[];
        },
    ): void {
        retentionPct = Math.round(conf.desired_retention * 100);
        maxInterval = conf.maximum_review_interval;
        newPerDay = conf.new_per_day;
        reviewsPerDay = conf.reviews_per_day;
        capAnswerTimeSecs = conf.cap_answer_time_secs;
        // Copy the array — assigning the incoming reference can leave Svelte's
        // $state proxy referencing a non-tracked array if the caller mutates
        // the source later. Snapshot semantics are what the UI wants here.
        if (conf.fsrs_params.length > 0) {
            optimizedParams = [...conf.fsrs_params];
            paramsSource = "disk";
        } else {
            optimizedParams = [];
            paramsSource = null;
        }
        // Drop any "fresh" optimize-result hint left over from a prior preset.
        optimizeFsrsItems = null;
    }

    onMount(async () => {
        try {
            const [list, fsrs] = await Promise.all([
                fetchDeckConfigs(),
                fetchFsrsEnabled(),
            ]);
            presets = list.configs;
            fsrsEnabled = fsrs.enabled;
            // Default preset id=1 always exists on a fresh collection; fall
            // back to the first listed preset only when the seeded row is
            // absent (corrupt/stripped collection).
            const initial = presets.find((p) => p.id === 1) ?? presets[0];
            if (!initial) {
                throw new Error("No deck config presets available");
            }
            selectedPresetId = initial.id;
            const conf = await fetchDeckConfigById(initial.id);
            applyPresetSnapshot(conf);
        } catch (e) {
            loadError = e instanceof Error ? e.message : "Failed to load settings";
        } finally {
            loading = false;
        }
    });

    function disabledControls(): boolean {
        return loading || loadError !== null || selectedPresetId === null;
    }

    async function createPreset(): Promise<void> {
        // Defensive trim+blank-check matches the server's first 400 path —
        // surface inline before the request, but keep the server-side
        // duplicate / 500 handling generic via the catch below.
        const name = newPresetName.trim();
        if (name === "") {
            errorCreatePreset = "name must not be empty";
            return;
        }
        savingCreatePreset = true;
        errorCreatePreset = null;
        try {
            const created = await postDeckConfig({ name });
            // Append the new preset and switch to it so the editor below
            // shows its (default) state immediately. We don't refetch the
            // whole list — server returns the canonical row, and the
            // duplicate-name guard means the local append can't drift.
            presets = [...presets, { id: created.id, name: created.name }];
            // switchPreset short-circuits if nextId === selectedPresetId,
            // so freshly-created presets — whose ids never collide with
            // the current selection (epoch-ms vs default=1) — always
            // hydrate via fetchDeckConfigById here.
            await switchPreset(created.id);
            creatingPreset = false;
            newPresetName = "";
        } catch (e) {
            errorCreatePreset =
                e instanceof Error ? e.message : "Failed to create preset";
        } finally {
            savingCreatePreset = false;
        }
    }

    function cancelCreatePreset(): void {
        creatingPreset = false;
        newPresetName = "";
        errorCreatePreset = null;
    }

    async function switchPreset(nextId: number): Promise<void> {
        if (nextId === selectedPresetId) return;
        switchingPreset = true;
        errorRetention = null;
        errorMaxInterval = null;
        errorOptimize = null;
        try {
            const conf = await fetchDeckConfigById(nextId);
            selectedPresetId = nextId;
            applyPresetSnapshot(conf);
        } catch (e) {
            // Stay on the previous preset; surface the failure inline so the
            // user knows the dropdown's apparent state did not take effect.
            errorOptimize =
                e instanceof Error ? e.message : "Failed to load preset";
        } finally {
            switchingPreset = false;
        }
    }

    async function persistRetention(): Promise<void> {
        if (disabledControls() || selectedPresetId === null) return;
        savingRetention = true;
        errorRetention = null;
        try {
            const next = await patchDeckConfigById(selectedPresetId, {
                desired_retention: retentionPct / 100,
            });
            retentionPct = Math.round(next.desired_retention * 100);
        } catch (e) {
            errorRetention =
                e instanceof Error ? e.message : "Failed to save retention";
        } finally {
            savingRetention = false;
        }
    }

    async function persistMaxInterval(): Promise<void> {
        if (disabledControls() || selectedPresetId === null) return;
        savingMaxInterval = true;
        errorMaxInterval = null;
        try {
            const next = await patchDeckConfigById(selectedPresetId, {
                maximum_review_interval: maxInterval,
            });
            maxInterval = next.maximum_review_interval;
        } catch (e) {
            errorMaxInterval =
                e instanceof Error ? e.message : "Failed to save interval";
        } finally {
            savingMaxInterval = false;
        }
    }

    async function persistNewPerDay(): Promise<void> {
        if (disabledControls() || selectedPresetId === null) return;
        savingNewPerDay = true;
        errorNewPerDay = null;
        try {
            const next = await patchDeckConfigById(selectedPresetId, {
                new_per_day: newPerDay,
            });
            newPerDay = next.new_per_day;
        } catch (e) {
            errorNewPerDay =
                e instanceof Error ? e.message : "Failed to save new-per-day";
        } finally {
            savingNewPerDay = false;
        }
    }

    async function persistReviewsPerDay(): Promise<void> {
        if (disabledControls() || selectedPresetId === null) return;
        savingReviewsPerDay = true;
        errorReviewsPerDay = null;
        try {
            const next = await patchDeckConfigById(selectedPresetId, {
                reviews_per_day: reviewsPerDay,
            });
            reviewsPerDay = next.reviews_per_day;
        } catch (e) {
            errorReviewsPerDay =
                e instanceof Error ? e.message : "Failed to save reviews-per-day";
        } finally {
            savingReviewsPerDay = false;
        }
    }

    async function persistCapAnswerTime(): Promise<void> {
        if (disabledControls() || selectedPresetId === null) return;
        savingCapAnswerTime = true;
        errorCapAnswerTime = null;
        try {
            const next = await patchDeckConfigById(selectedPresetId, {
                cap_answer_time_secs: capAnswerTimeSecs,
            });
            capAnswerTimeSecs = next.cap_answer_time_secs;
        } catch (e) {
            errorCapAnswerTime =
                e instanceof Error ? e.message : "Failed to save answer-time cap";
        } finally {
            savingCapAnswerTime = false;
        }
    }

    async function persistFsrs(): Promise<void> {
        if (disabledControls()) return;
        savingFsrs = true;
        errorFsrs = null;
        try {
            const next = await putFsrsEnabled({ enabled: fsrsEnabled });
            fsrsEnabled = next.enabled;
        } catch (e) {
            errorFsrs = e instanceof Error ? e.message : "Failed to save FSRS toggle";
        } finally {
            savingFsrs = false;
        }
    }

    async function runOptimize(): Promise<void> {
        if (disabledControls() || optimizing) return;
        optimizing = true;
        errorOptimize = null;
        try {
            const res = await postFsrsOptimize();
            optimizeFsrsItems = res.fsrs_items;
            optimizedParams = res.params;
            paramsSource = "fresh";
        } catch (e) {
            errorOptimize =
                e instanceof Error ? e.message : "Failed to optimize FSRS params";
        } finally {
            optimizing = false;
        }
    }
</script>

<svelte:head><title>Settings — Anki</title></svelte:head>

<div class="wrap">
    <nav class="settings-nav">
        {#each sections as s (s.id)}
            <button
                class="nav-item"
                class:active={active === s.id}
                onclick={() => (active = s.id)}
            >
                {s.label}
            </button>
        {/each}
    </nav>

    <div class="content">
        <header>
            <h1>{sections.find((s) => s.id === active)?.label}</h1>
            <p class="subtitle">
                {#if active === "fsrs"}
                    Tune the FSRS v5 scheduler to match your memory.
                {:else}
                    Configure how this collection behaves.
                {/if}
            </p>
        </header>

        {#if active === "fsrs"}
            {#if loadError}
                <div class="error-banner" role="alert">
                    <strong>Couldn't reach Anki server.</strong>
                    Settings shown are unsaved defaults — changes won't persist
                    until reconnected.
                </div>
            {/if}
            <p class="disclaimer">
                Editing presets directly. Per-deck assignment (which deck uses
                which preset) comes in a later release.
            </p>
            {#if presets.length > 0}
                <div class="preset-row">
                    <label for="preset-select">Preset</label>
                    <select
                        id="preset-select"
                        class="preset-select"
                        value={selectedPresetId}
                        onchange={(e) => {
                            const next = Number((e.target as HTMLSelectElement).value);
                            if (!Number.isNaN(next)) switchPreset(next);
                        }}
                        disabled={loading || loadError !== null || switchingPreset}
                    >
                        {#each presets as p (p.id)}
                            <option value={p.id}>{p.name}</option>
                        {/each}
                    </select>
                    {#if switchingPreset}
                        <span class="saving">Loading…</span>
                    {/if}
                    {#if !creatingPreset}
                        <button
                            type="button"
                            class="new-preset-button"
                            onclick={() => {
                                creatingPreset = true;
                                newPresetName = "";
                                errorCreatePreset = null;
                            }}
                            disabled={disabledControls() || switchingPreset}
                        >
                            + New preset
                        </button>
                    {/if}
                </div>
                {#if creatingPreset}
                    <div class="create-preset-row">
                        <label for="new-preset-name">New preset name</label>
                        <input
                            id="new-preset-name"
                            type="text"
                            class="new-preset-input"
                            bind:value={newPresetName}
                            disabled={savingCreatePreset}
                            maxlength="100"
                            placeholder="e.g. Languages"
                        />
                        <button
                            type="button"
                            class="save-preset-button"
                            onclick={createPreset}
                            disabled={savingCreatePreset ||
                                newPresetName.trim() === ""}
                        >
                            Save
                        </button>
                        <button
                            type="button"
                            class="cancel-preset-button"
                            onclick={cancelCreatePreset}
                            disabled={savingCreatePreset}
                        >
                            Cancel
                        </button>
                        {#if savingCreatePreset}
                            <span class="saving">Creating…</span>
                        {/if}
                        {#if errorCreatePreset}
                            <span class="field-error" role="alert"
                                >{errorCreatePreset}</span
                            >
                        {/if}
                    </div>
                {/if}
            {/if}
            <Card padding="lg">
                <div class="field">
                    <div class="field-head">
                        <div>
                            <label for="fsrs-enabled">Enable FSRS</label>
                            <p class="hint">
                                Use the FSRS v5 scheduler. Toggling reschedules
                                existing cards under current params — this may
                                take a few seconds on large collections.
                            </p>
                        </div>
                        <div class="toggle-cell">
                            {#if savingFsrs}
                                <span class="saving">Rescheduling…</span>
                            {/if}
                            <input
                                id="fsrs-enabled"
                                type="checkbox"
                                bind:checked={fsrsEnabled}
                                onchange={() => persistFsrs()}
                                disabled={disabledControls()}
                            />
                        </div>
                    </div>
                    {#if errorFsrs}
                        <p class="field-error">{errorFsrs}</p>
                    {/if}
                </div>

                <div class="field">
                    <div class="field-head">
                        <div>
                            <label for="desired-retention">Desired retention</label>
                            <p class="hint">Target probability of recalling a card when due.</p>
                        </div>
                        <div class="value-pill">{retentionPct}%</div>
                    </div>
                    <input
                        id="desired-retention"
                        type="range"
                        min="70"
                        max="97"
                        bind:value={retentionPct}
                        onchange={() => persistRetention()}
                        disabled={disabledControls()}
                    />
                    <div class="scale">
                        <span>70%</span>
                        <span>85%</span>
                        <span>97%</span>
                    </div>
                    {#if savingRetention}
                        <span class="saving">Saving…</span>
                    {/if}
                    {#if errorRetention}
                        <p class="field-error">{errorRetention}</p>
                    {/if}
                </div>

                <div class="field">
                    <div class="field-head">
                        <div>
                            <label for="max-interval">Maximum interval</label>
                            <p class="hint">Cap in days. Longer = fewer reviews but slower learning.</p>
                        </div>
                        <input
                            id="max-interval"
                            class="num-input"
                            type="number"
                            min="1"
                            max="36500"
                            bind:value={maxInterval}
                            onblur={() => persistMaxInterval()}
                            disabled={disabledControls()}
                        />
                    </div>
                    {#if savingMaxInterval}
                        <span class="saving">Saving…</span>
                    {/if}
                    {#if errorMaxInterval}
                        <p class="field-error">{errorMaxInterval}</p>
                    {/if}
                </div>

                <div class="field">
                    <div class="field-head">
                        <div>
                            <label for="new-per-day">New cards per day</label>
                            <p class="hint">Daily cap on newly-introduced cards. 0 pauses new cards.</p>
                        </div>
                        <input
                            id="new-per-day"
                            class="num-input"
                            type="number"
                            min="0"
                            max="9999"
                            bind:value={newPerDay}
                            onblur={() => persistNewPerDay()}
                            disabled={disabledControls()}
                        />
                    </div>
                    {#if savingNewPerDay}
                        <span class="saving">Saving…</span>
                    {/if}
                    {#if errorNewPerDay}
                        <p class="field-error">{errorNewPerDay}</p>
                    {/if}
                </div>

                <div class="field">
                    <div class="field-head">
                        <div>
                            <label for="reviews-per-day">Reviews per day</label>
                            <p class="hint">Daily cap on review cards. 0 pauses reviews.</p>
                        </div>
                        <input
                            id="reviews-per-day"
                            class="num-input"
                            type="number"
                            min="0"
                            max="9999"
                            bind:value={reviewsPerDay}
                            onblur={() => persistReviewsPerDay()}
                            disabled={disabledControls()}
                        />
                    </div>
                    {#if savingReviewsPerDay}
                        <span class="saving">Saving…</span>
                    {/if}
                    {#if errorReviewsPerDay}
                        <p class="field-error">{errorReviewsPerDay}</p>
                    {/if}
                </div>

                <div class="field">
                    <div class="field-head">
                        <div>
                            <label for="cap-answer-time">Answer-time cap</label>
                            <p class="hint">Soft per-card timer in seconds. Slower than this counts as a hard answer.</p>
                        </div>
                        <input
                            id="cap-answer-time"
                            class="num-input"
                            type="number"
                            min="1"
                            max="600"
                            bind:value={capAnswerTimeSecs}
                            onblur={() => persistCapAnswerTime()}
                            disabled={disabledControls()}
                        />
                    </div>
                    {#if savingCapAnswerTime}
                        <span class="saving">Saving…</span>
                    {/if}
                    {#if errorCapAnswerTime}
                        <p class="field-error">{errorCapAnswerTime}</p>
                    {/if}
                </div>
            </Card>

            <Card padding="lg">
                <div class="card-head">
                    <h3>Optimized weights</h3>
                    <button
                        class="re-optimize"
                        onclick={() => runOptimize()}
                        disabled={disabledControls() || optimizing}
                    >
                        {optimizing ? "Optimizing…" : "Re-optimize"}
                    </button>
                </div>
                <p class="hint">
                    {#if paramsSource === "disk"}
                        Loaded {optimizedParams.length} params from disk · click
                        Re-optimize to retrain on the latest review history.
                    {:else if optimizeFsrsItems === null}
                        Click Re-optimize to fit FSRS parameters from your
                        review history.
                    {:else if optimizeFsrsItems === 0}
                        No reviews available yet — log some reviews first, then
                        re-optimize.
                    {:else}
                        Trained on {optimizeFsrsItems.toLocaleString()} reviews
                        · params updated.
                    {/if}
                </p>
                {#if errorOptimize}
                    <p class="field-error">{errorOptimize}</p>
                {/if}
                {#if optimizedParams.length > 0}
                    <div class="weights">
                        {#each optimizedParams as w, i (i)}
                            <div class="w-cell">
                                <div class="w-i">w<sub>{i}</sub></div>
                                <div class="w-v">{w.toFixed(3)}</div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </Card>
        {:else if active === "appearance"}
            <Card padding="lg">
                <div class="field">
                    <div class="field-head">
                        <div>
                            <span class="field-label">Theme</span>
                            <p class="hint">Light uses a warm cream base; dark is a deep warm gray.</p>
                        </div>
                    </div>
                    <div class="theme-grid">
                        <label class="theme-opt">
                            <input type="radio" name="theme" checked />
                            <div class="swatch light"></div>
                            <span>Light</span>
                        </label>
                        <label class="theme-opt">
                            <input type="radio" name="theme" />
                            <div class="swatch dark"></div>
                            <span>Dark</span>
                        </label>
                        <label class="theme-opt">
                            <input type="radio" name="theme" />
                            <div class="swatch auto"></div>
                            <span>System</span>
                        </label>
                    </div>
                </div>
            </Card>
        {:else if active === "sync"}
            <Card padding="lg">
                <div class="sync-status">
                    <div class="sync-dot"></div>
                    <div>
                        <div class="sync-label">Synced with your Anki server</div>
                        <div class="hint">Last sync: 2m ago · 8,412 cards · 124 MB media</div>
                    </div>
                </div>
                <div class="row">
                    <div class="meta-key">Server</div>
                    <div>https://anki.yourdomain.dev</div>
                </div>
                <div class="row">
                    <div class="meta-key">Devices</div>
                    <div>MacBook Pro · iPhone 17 · this browser</div>
                </div>
            </Card>
        {:else}
            <Card padding="lg">
                <p class="placeholder">Content for <strong>{active}</strong> will live here. Placeholder for prototype.</p>
            </Card>
        {/if}
    </div>
</div>

<style>
    .wrap {
        display: grid;
        grid-template-columns: 200px 1fr;
        gap: var(--space-10);
        max-width: var(--content-max-wide);
        margin: 0 auto;
        padding: var(--space-10) var(--space-8) var(--space-16);
    }

    .settings-nav {
        display: flex;
        flex-direction: column;
        gap: 2px;
        position: sticky;
        top: var(--space-10);
        align-self: start;
    }
    .nav-item {
        padding: 0.45rem 0.75rem;
        border-radius: var(--radius-sm);
        font-size: var(--text-sm);
        color: var(--text-muted);
        text-align: left;
    }
    .nav-item:hover {
        background: var(--bg-hover);
        color: var(--text);
    }
    .nav-item.active {
        background: var(--bg-hover);
        color: var(--text);
        font-weight: 500;
    }

    .content {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
        min-width: 0;
    }
    header h1 {
        font-size: var(--text-2xl);
        font-weight: 600;
        letter-spacing: -0.015em;
    }
    .subtitle {
        color: var(--text-muted);
        font-size: var(--text-sm);
        margin-top: var(--space-1);
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        padding: var(--space-4) 0;
        border-bottom: 1px solid var(--border);
    }
    .field:last-child {
        border-bottom: 0;
    }
    .field-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--space-4);
    }
    label,
    .field-label {
        font-size: var(--text-sm);
        font-weight: 500;
    }
    .hint {
        font-size: var(--text-xs);
        color: var(--text-subtle);
        margin-top: 2px;
    }
    .value-pill {
        font-variant-numeric: tabular-nums;
        font-weight: 500;
        padding: 0.25rem 0.75rem;
        background: var(--accent-bg);
        color: var(--accent);
        border: 1px solid var(--accent-border);
        border-radius: var(--radius-full);
        font-size: var(--text-sm);
    }

    .disclaimer {
        font-size: var(--text-xs);
        color: var(--text-subtle);
        font-style: italic;
        margin-bottom: calc(var(--space-2) * -1);
    }

    .preset-row {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        margin: var(--space-3) 0;
    }
    .preset-row label {
        font-size: var(--text-sm);
        color: var(--text-muted);
    }
    .preset-select {
        background: var(--bg);
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        padding: var(--space-1) var(--space-2);
        font: inherit;
        min-width: 14rem;
    }
    .preset-select:focus {
        outline: none;
        border-color: var(--text-muted);
    }
    .new-preset-button,
    .save-preset-button,
    .cancel-preset-button {
        background: var(--bg);
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        padding: var(--space-1) var(--space-3);
        font-size: var(--text-sm);
        cursor: pointer;
    }
    .new-preset-button:hover:not(:disabled),
    .save-preset-button:hover:not(:disabled),
    .cancel-preset-button:hover:not(:disabled) {
        border-color: var(--text-muted);
    }
    .new-preset-button:disabled,
    .save-preset-button:disabled,
    .cancel-preset-button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .save-preset-button {
        background: var(--accent, #c0c);
        color: var(--bg);
        border-color: transparent;
    }
    .create-preset-row {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        flex-wrap: wrap;
        margin: 0 0 var(--space-3) 0;
    }
    .create-preset-row label {
        font-size: var(--text-sm);
        color: var(--text-muted);
    }
    .new-preset-input {
        flex: 1 1 16rem;
        min-width: 12rem;
        padding: 0.3rem 0.5rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--bg);
        color: var(--text);
        font: inherit;
    }
    .new-preset-input:focus {
        outline: none;
        border-color: var(--accent);
    }
    .new-preset-input:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }

    .error-banner {
        padding: var(--space-3) var(--space-4);
        border: 1px solid var(--danger, #c44);
        border-radius: var(--radius-sm);
        background: color-mix(in oklch, var(--danger, #c44) 8%, transparent);
        color: var(--text);
        font-size: var(--text-sm);
        line-height: 1.45;
    }
    .error-banner strong {
        font-weight: 600;
        margin-right: 0.25rem;
    }

    .toggle-cell {
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }

    .num-input {
        width: 7rem;
        padding: 0.3rem 0.5rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--bg);
        color: var(--text);
        font-size: var(--text-sm);
        font-variant-numeric: tabular-nums;
        text-align: right;
    }
    .num-input:focus {
        outline: none;
        border-color: var(--accent);
    }
    .num-input:disabled,
    input[type="range"]:disabled,
    input[type="checkbox"]:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }

    .saving {
        font-size: var(--text-xs);
        color: var(--text-subtle);
        font-style: italic;
    }

    .field-error {
        font-size: var(--text-xs);
        color: var(--danger, #c44);
        margin-top: var(--space-1);
    }

    input[type="range"] {
        width: 100%;
        accent-color: var(--accent);
    }
    .scale {
        display: flex;
        justify-content: space-between;
        font-size: var(--text-xs);
        color: var(--text-subtle);
    }

    .card-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .card-head h3 {
        font-size: var(--text-base);
        font-weight: 600;
    }
    .re-optimize {
        padding: 0.3rem 0.75rem;
        font-size: var(--text-xs);
        border-radius: var(--radius-sm);
        background: var(--bg-subtle);
        color: var(--text-muted);
        border: 1px solid var(--border);
    }
    .re-optimize:hover:not(:disabled) {
        color: var(--accent);
        border-color: var(--accent);
    }
    .re-optimize:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }

    .weights {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(70px, 1fr));
        gap: var(--space-2);
        margin-top: var(--space-4);
    }
    .w-cell {
        padding: var(--space-2);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--bg-subtle);
    }
    .w-i {
        font-family: var(--font-mono);
        font-size: 0.65rem;
        color: var(--text-subtle);
    }
    .w-v {
        font-family: var(--font-mono);
        font-size: var(--text-xs);
        font-variant-numeric: tabular-nums;
        color: var(--text);
    }

    .theme-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--space-3);
    }
    .theme-opt {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        padding: var(--space-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        cursor: pointer;
    }
    .theme-opt:has(input:checked) {
        border-color: var(--accent);
        background: var(--accent-bg);
    }
    .theme-opt input {
        position: absolute;
        opacity: 0;
    }
    .swatch {
        aspect-ratio: 16 / 10;
        border-radius: var(--radius-sm);
        border: 1px solid var(--border);
    }
    .swatch.light {
        background: linear-gradient(135deg, oklch(98% 0.012 85) 50%, oklch(94% 0.015 85) 50%);
    }
    .swatch.dark {
        background: linear-gradient(135deg, oklch(17% 0.008 75) 50%, oklch(24% 0.012 75) 50%);
    }
    .swatch.auto {
        background: linear-gradient(135deg, oklch(98% 0.012 85) 50%, oklch(17% 0.008 75) 50%);
    }

    .sync-status {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        padding-bottom: var(--space-4);
        margin-bottom: var(--space-4);
        border-bottom: 1px solid var(--border);
    }
    .sync-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--success);
        box-shadow: 0 0 0 4px color-mix(in oklch, var(--success) 20%, transparent);
    }
    .sync-label {
        font-weight: 500;
    }
    .row {
        display: grid;
        grid-template-columns: 120px 1fr;
        padding: var(--space-3) 0;
        border-top: 1px solid var(--border);
        font-size: var(--text-sm);
    }
    .row:first-of-type {
        border-top: 0;
    }
    .meta-key {
        color: var(--text-subtle);
    }
    .placeholder {
        color: var(--text-muted);
        font-size: var(--text-sm);
    }
</style>
