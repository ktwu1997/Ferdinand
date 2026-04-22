<script lang="ts">
    import Card from "$lib/components/Card.svelte";

    let sections = [
        { id: "profile", label: "Profile" },
        { id: "scheduling", label: "Scheduling" },
        { id: "fsrs", label: "FSRS" },
        { id: "sync", label: "Sync" },
        { id: "appearance", label: "Appearance" },
        { id: "advanced", label: "Advanced" },
    ];

    let active = $state("fsrs");

    let fsrsWeights = Array.from({ length: 19 }, (_, i) => (0.2 + i * 0.15).toFixed(3));
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
            <Card padding="lg">
                <div class="field">
                    <div class="field-head">
                        <div>
                            <label>Desired retention</label>
                            <p class="hint">Target probability of recalling a card when due.</p>
                        </div>
                        <div class="value-pill">90%</div>
                    </div>
                    <input type="range" min="70" max="97" value="90" />
                    <div class="scale">
                        <span>70%</span>
                        <span>85%</span>
                        <span>97%</span>
                    </div>
                </div>

                <div class="field">
                    <div class="field-head">
                        <div>
                            <label>Maximum interval</label>
                            <p class="hint">Cap in days. Longer = fewer reviews but slower learning.</p>
                        </div>
                        <div class="value-pill">36,500 d</div>
                    </div>
                </div>
            </Card>

            <Card padding="lg">
                <div class="card-head">
                    <h3>Optimized weights</h3>
                    <button class="re-optimize">Re-optimize</button>
                </div>
                <p class="hint">
                    Last optimized on 2026-04-14 · log loss 0.187 · RMSE(bins) 0.043
                </p>
                <div class="weights">
                    {#each fsrsWeights as w, i (i)}
                        <div class="w-cell">
                            <div class="w-i">w<sub>{i}</sub></div>
                            <div class="w-v">{w}</div>
                        </div>
                    {/each}
                </div>
            </Card>
        {:else if active === "appearance"}
            <Card padding="lg">
                <div class="field">
                    <div class="field-head">
                        <div>
                            <label>Theme</label>
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
    label {
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
    .re-optimize:hover {
        color: var(--accent);
        border-color: var(--accent);
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
