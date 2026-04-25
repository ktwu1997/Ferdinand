<script lang="ts">
    import { onMount } from "svelte";
    import Card from "$lib/components/Card.svelte";
    import {
        fetchDeckConfigDefault,
        fetchFsrsEnabled,
        patchDeckConfigDefault,
        postFsrsOptimize,
        putFsrsEnabled,
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

    // FSRS settings wired to anki_server (Phase 9-N2; optimize/reschedule 9-O2).
    // Server stores desired_retention as a 0.70..=0.97 float; UI works in
    // integer percent and converts at the boundary. Persistence fires on
    // change/blur (not input/keystroke) so a slider drag is one PATCH.
    let loading = $state(true);
    let loadError: string | null = $state(null);
    let retentionPct = $state(90);
    let maxInterval = $state(36500);
    let fsrsEnabled = $state(false);
    let savingRetention = $state(false);
    let savingMaxInterval = $state(false);
    let savingFsrs = $state(false);
    let errorRetention: string | null = $state(null);
    let errorMaxInterval: string | null = $state(null);
    let errorFsrs: string | null = $state(null);

    // Optimize state. Params are not loaded on mount — there's no GET
    // endpoint for them yet, so the grid stays empty until the user clicks
    // Re-optimize at least once this session.
    let optimizing = $state(false);
    let errorOptimize: string | null = $state(null);
    let optimizeFsrsItems: number | null = $state(null);
    let optimizedParams: number[] = $state([]);

    onMount(async () => {
        try {
            const [conf, fsrs] = await Promise.all([
                fetchDeckConfigDefault(),
                fetchFsrsEnabled(),
            ]);
            retentionPct = Math.round(conf.desired_retention * 100);
            maxInterval = conf.maximum_review_interval;
            fsrsEnabled = fsrs.enabled;
        } catch (e) {
            loadError = e instanceof Error ? e.message : "Failed to load settings";
        } finally {
            loading = false;
        }
    });

    function disabledControls(): boolean {
        return loading || loadError !== null;
    }

    async function persistRetention(): Promise<void> {
        if (disabledControls()) return;
        savingRetention = true;
        errorRetention = null;
        try {
            const next = await patchDeckConfigDefault({
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
        if (disabledControls()) return;
        savingMaxInterval = true;
        errorMaxInterval = null;
        try {
            const next = await patchDeckConfigDefault({
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
                Editing the Default preset. Per-deck overrides come in a later release.
            </p>
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
                    {#if optimizeFsrsItems === null}
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
