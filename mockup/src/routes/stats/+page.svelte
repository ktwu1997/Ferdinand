<script lang="ts">
    import { onMount } from "svelte";
    import Card from "$lib/components/Card.svelte";
    import {
        fetchStatsRecent,
        fetchAnswerButtons,
        type ApiDayCount,
        type ApiAnswerButtons,
    } from "$lib/api";

    type Range = "1M" | "3M" | "1Y" | "ALL";
    const RANGE_DAYS: Record<Range, number> = {
        "1M": 30,
        "3M": 90,
        "1Y": 365,
        ALL: 365,
    };

    let range = $state<Range>("1M");

    let history = $state<ApiDayCount[] | null>(null);
    let answerButtons = $state<ApiAnswerButtons | null>(null);
    let loadError = $state<string | null>(null);

    async function load(days: number) {
        loadError = null;
        try {
            const [h, ab] = await Promise.all([
                fetchStatsRecent(days),
                fetchAnswerButtons(days),
            ]);
            history = h.history;
            answerButtons = ab;
        } catch (e) {
            history = [];
            answerButtons = { days, again: 0, hard: 0, good: 0, easy: 0 };
            loadError = e instanceof Error ? e.message : "Couldn't load stats";
        }
    }

    onMount(() => load(RANGE_DAYS[range]));

    function setRange(r: Range) {
        range = r;
        load(RANGE_DAYS[r]);
    }

    let values = $derived((history ?? []).map((d) => d.reviews));
    let totalReviews = $derived(values.reduce((a, v) => a + v, 0));
    let maxBar = $derived(Math.max(1, ...values));

    // Streak = consecutive non-zero days counted backwards from today.
    let streak = $derived.by(() => {
        let n = 0;
        for (let i = values.length - 1; i >= 0; i--) {
            if (values[i] > 0) n++;
            else break;
        }
        return n;
    });

    let answerEntries = $derived(
        answerButtons
            ? ([
                  ["again", answerButtons.again],
                  ["hard", answerButtons.hard],
                  ["good", answerButtons.good],
                  ["easy", answerButtons.easy],
              ] as const)
            : [],
    );
    let totalAns = $derived(answerEntries.reduce((a, [, v]) => a + v, 0));
</script>

<svelte:head><title>Stats — Anki</title></svelte:head>

<div class="page">
    <header>
        <div>
            <h1>Statistics</h1>
            <p class="subtitle">All decks · snapshot of your review behavior</p>
        </div>
        <div class="range">
            {#each ["1M", "3M", "1Y", "ALL"] as r (r)}
                <button
                    class="range-opt"
                    class:active={range === r}
                    onclick={() => setRange(r as Range)}>{r}</button
                >
            {/each}
        </div>
    </header>

    {#if loadError}
        <div class="error-banner">Couldn't load stats: {loadError}</div>
    {/if}

    <div class="kpi-grid">
        <Card padding="md">
            <div class="kpi-label">Reviews</div>
            <div class="kpi-value">{totalReviews.toLocaleString()}</div>
            <div class="kpi-delta">last {RANGE_DAYS[range]} days</div>
        </Card>
        <Card padding="md">
            <div class="kpi-label">Streak</div>
            <div class="kpi-value">{streak}<span class="unit">days</span></div>
            <div class="kpi-delta">consecutive non-zero days</div>
        </Card>
    </div>

    <div class="charts-grid">
        <Card padding="lg">
            <div class="card-head">
                <h3>Daily reviews</h3>
                <span class="subtle">last {RANGE_DAYS[range]} days</span>
            </div>
            <div class="bars" style:grid-template-columns="repeat({Math.max(1, values.length)}, 1fr)">
                {#each values as v, i (i)}
                    <div class="bar-col">
                        <div class="bar" style:height="{(v / maxBar) * 100}%"></div>
                    </div>
                {/each}
            </div>
            <div class="x-axis">
                <span>{RANGE_DAYS[range]}d ago</span>
                <span>today</span>
            </div>
        </Card>

        <Card padding="lg">
            <div class="card-head">
                <h3>Answer buttons</h3>
                <span class="subtle">{totalAns} total</span>
            </div>
            {#if totalAns === 0}
                <div class="empty">No reviews in this window.</div>
            {:else}
                <div class="ans-chart">
                    {#each answerEntries as [k, v] (k)}
                        {@const pct = (v / totalAns) * 100}
                        <div class="ans-row">
                            <span class="ans-k ans-k-{k}">{k}</span>
                            <div class="ans-bar">
                                <div class="ans-fill ans-fill-{k}" style:width="{pct}%"></div>
                            </div>
                            <span class="ans-v">{v}</span>
                            <span class="ans-pct">{pct.toFixed(0)}%</span>
                        </div>
                    {/each}
                </div>
            {/if}
        </Card>
    </div>
</div>

<style>
    .page {
        max-width: var(--content-max-wide);
        margin: 0 auto;
        padding: var(--space-10) var(--space-8) var(--space-16);
        display: flex;
        flex-direction: column;
        gap: var(--space-8);
    }

    header {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        flex-wrap: wrap;
        gap: var(--space-4);
    }
    h1 {
        font-size: var(--text-3xl);
        font-weight: 600;
        letter-spacing: -0.02em;
    }
    .subtitle {
        color: var(--text-muted);
        font-size: var(--text-sm);
        margin-top: var(--space-1);
    }

    .range {
        display: flex;
        padding: 2px;
        gap: 2px;
        background: var(--bg-subtle);
        border-radius: var(--radius-md);
        border: 1px solid var(--border);
    }
    .range-opt {
        padding: 0.35rem 0.75rem;
        font-size: var(--text-xs);
        font-weight: 500;
        color: var(--text-muted);
        border-radius: var(--radius-sm);
    }
    .range-opt.active {
        background: var(--bg-elevated);
        color: var(--text);
        box-shadow: var(--shadow-sm);
    }

    .kpi-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: var(--space-4);
    }
    .kpi-label {
        font-size: 0.7rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-subtle);
        font-weight: 500;
    }
    .kpi-value {
        font-size: var(--text-3xl);
        font-weight: 600;
        letter-spacing: -0.02em;
        margin-top: var(--space-2);
        font-variant-numeric: tabular-nums;
    }
    .kpi-value .unit {
        font-size: var(--text-base);
        color: var(--text-subtle);
        font-weight: 400;
        margin-left: 2px;
    }
    .kpi-delta {
        font-size: var(--text-xs);
        color: var(--text-subtle);
        margin-top: var(--space-1);
    }
    .kpi-delta.up {
        color: var(--success);
    }
    .kpi-delta.down {
        color: var(--danger);
    }

    .error-banner {
        padding: var(--space-3) var(--space-4);
        border: 1px solid var(--border);
        background: var(--bg-subtle);
        border-radius: var(--radius-md);
        font-size: var(--text-sm);
        color: var(--danger);
    }

    .empty {
        padding: var(--space-6) 0;
        text-align: center;
        color: var(--text-subtle);
        font-size: var(--text-sm);
    }

    .charts-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--space-4);
    }
    .card-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: var(--space-4);
    }
    .card-head h3 {
        font-size: var(--text-base);
        font-weight: 600;
    }
    .subtle {
        color: var(--text-subtle);
        font-size: var(--text-xs);
    }

    .bars {
        display: grid;
        grid-template-columns: repeat(30, 1fr);
        gap: 2px;
        align-items: end;
        height: 180px;
    }
    .bar-col {
        height: 100%;
        display: flex;
        align-items: end;
    }
    .bar {
        width: 100%;
        background: var(--accent);
        border-radius: 2px;
        opacity: 0.85;
        min-height: 2px;
    }
    .x-axis {
        display: flex;
        justify-content: space-between;
        margin-top: var(--space-3);
        font-size: var(--text-xs);
        color: var(--text-subtle);
    }

    .ans-chart {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        padding: var(--space-3) 0;
    }
    .ans-row {
        display: grid;
        grid-template-columns: 60px 1fr 48px 40px;
        align-items: center;
        gap: var(--space-3);
        font-size: var(--text-sm);
    }
    .ans-k {
        text-transform: capitalize;
        font-weight: 500;
    }
    .ans-k-again {
        color: var(--again);
    }
    .ans-k-hard {
        color: var(--hard);
    }
    .ans-k-good {
        color: var(--good);
    }
    .ans-k-easy {
        color: var(--easy);
    }
    .ans-bar {
        background: var(--bg-subtle);
        border-radius: 999px;
        height: 8px;
        overflow: hidden;
    }
    .ans-fill {
        height: 100%;
        border-radius: 999px;
    }
    .ans-fill-again {
        background: var(--again);
    }
    .ans-fill-hard {
        background: var(--hard);
    }
    .ans-fill-good {
        background: var(--good);
    }
    .ans-fill-easy {
        background: var(--easy);
    }
    .ans-v {
        font-variant-numeric: tabular-nums;
        text-align: right;
        color: var(--text);
    }
    .ans-pct {
        font-size: var(--text-xs);
        color: var(--text-subtle);
        text-align: right;
    }

</style>
