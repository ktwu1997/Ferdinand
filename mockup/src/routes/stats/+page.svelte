<script lang="ts">
    import { onMount } from "svelte";
    import { Caption } from "$lib/components/ui";
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
    const RANGE_LABEL: Record<Range, string> = {
        "1M": "past 30 days",
        "3M": "past 90 days",
        "1Y": "past 365 days",
        ALL: "all time",
    };

    let range = $state<Range>("1M");

    let history = $state<ApiDayCount[] | null>(null);
    let answerButtons = $state<ApiAnswerButtons | null>(null);
    let loadError = $state<string | null>(null);
    let loaded = $state(false);

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
        } finally {
            loaded = true;
        }
    }

    onMount(() => load(RANGE_DAYS[range]));

    function setRange(r: Range) {
        range = r;
        loaded = false;
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

    let activeDays = $derived(values.filter((v) => v > 0).length);
    let avgPerActiveDay = $derived(
        activeDays === 0 ? 0 : Math.round(totalReviews / activeDays),
    );
    let bestDay = $derived(values.length === 0 ? 0 : Math.max(...values));

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

    // Bar chart geometry — recomputed from the live history so the SVG
    // stays viewBox-correct across range changes. We render the chart at
    // a logical 520×140 viewBox and let CSS scale it; mobile shrinks the
    // visible width via aspect-ratio so the bars never run off screen.
    const CHART_W = 520;
    const CHART_H = 140;
    let barCount = $derived(Math.max(1, values.length));
    let barUnit = $derived((CHART_W - 14) / barCount);
    let bars = $derived(
        values.map((v, i) => {
            const x = i * barUnit + 4;
            const h = (v / maxBar) * (CHART_H - 8);
            return { x, h, w: Math.max(1, barUnit - 5), v };
        }),
    );
</script>

<svelte:head><title>Stats — Anki</title></svelte:head>

<div class="sketch-skin grain page sx-page" data-testid="stats-root">
    <header class="sx-head" data-testid="stats-head">
        <div class="sx-head-left">
            <Caption>the.ledger</Caption>
            <h1 class="sx-title mono" data-testid="stats-title">
                statistics
                <span class="sx-title-hand hand" aria-hidden="true">{RANGE_LABEL[range]}</span>
            </h1>
            <p class="sx-subtitle mono">all decks · snapshot of your review behavior</p>
        </div>
        <div class="sx-range" role="tablist" aria-label="time range" data-testid="stats-range">
            {#each ["1M", "3M", "1Y", "ALL"] as r (r)}
                <button
                    type="button"
                    role="tab"
                    aria-selected={range === r}
                    class="sx-range-pill mono"
                    class:active={range === r}
                    data-testid="stats-range-{r}"
                    onclick={() => setRange(r as Range)}
                >{r === "ALL" ? "all" : r}</button>
            {/each}
        </div>
    </header>

    {#if loadError}
        <div class="sx-error mono" role="alert" data-testid="stats-error">
            // couldn't reach server — {loadError}
        </div>
    {/if}

    <section class="sx-kpi-grid" data-testid="stats-kpi-grid">
        <article class="sx-tile" data-testid="stats-tile-reviews">
            <Caption>reviews</Caption>
            <div class="sx-tile-value mono">
                {totalReviews.toLocaleString()}<span class="sx-tile-unit">in {RANGE_DAYS[range]}d</span>
            </div>
        </article>
        <article class="sx-tile sx-tile-accent" data-testid="stats-tile-streak">
            <Caption>streak</Caption>
            <div class="sx-tile-value mono">
                {streak}<span class="sx-tile-unit">days</span>
            </div>
        </article>
        <article class="sx-tile" data-testid="stats-tile-avg">
            <Caption>avg / active day</Caption>
            <div class="sx-tile-value mono">
                {avgPerActiveDay.toLocaleString()}<span class="sx-tile-unit">cards</span>
            </div>
        </article>
        <article class="sx-tile" data-testid="stats-tile-best">
            <Caption>best day</Caption>
            <div class="sx-tile-value mono">
                {bestDay.toLocaleString()}<span class="sx-tile-unit">cards</span>
            </div>
        </article>
    </section>

    <section class="sx-charts" data-testid="stats-charts">
        <article class="sx-panel" data-testid="stats-bars-panel">
            <header class="sx-panel-head">
                <Caption>reviews per day</Caption>
                <span class="sx-panel-meta mono">last {RANGE_DAYS[range]}d</span>
            </header>
            {#if loaded && values.length === 0}
                <div class="sx-empty mono" data-testid="stats-bars-empty">
                    no reviews in this window.
                </div>
            {:else}
                <svg
                    class="sx-bars"
                    data-testid="stats-bars-svg"
                    viewBox="0 0 {CHART_W} {CHART_H + 26}"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label="reviews per day"
                >
                    <line
                        x1="0"
                        y1={CHART_H}
                        x2={CHART_W}
                        y2={CHART_H}
                        stroke="var(--ink)"
                        stroke-width="1.4"
                    />
                    {#each [0.25, 0.5, 0.75] as p, i (i)}
                        <line
                            x1="0"
                            y1={CHART_H - CHART_H * p}
                            x2={CHART_W}
                            y2={CHART_H - CHART_H * p}
                            stroke="var(--rule)"
                            stroke-width="1"
                            stroke-dasharray="2 4"
                        />
                    {/each}
                    {#each bars as b, i (i)}
                        <rect
                            x={b.x}
                            y={CHART_H - b.h}
                            width={b.w}
                            height={b.h}
                            rx="1"
                            fill="var(--accent-soft)"
                            stroke="var(--ink)"
                            stroke-width="1"
                            data-testid="stats-bar-{i}"
                        />
                    {/each}
                    <text x="0" y={CHART_H + 18} class="sx-axis mono">{RANGE_DAYS[range]}d ago</text>
                    <text x={CHART_W - 36} y={CHART_H + 18} class="sx-axis mono">today</text>
                </svg>
            {/if}
        </article>

        <article class="sx-panel" data-testid="stats-answer-panel">
            <header class="sx-panel-head">
                <Caption>answer mix</Caption>
                <span class="sx-panel-meta mono">{totalAns} total</span>
            </header>
            {#if totalAns === 0}
                <div class="sx-empty mono" data-testid="stats-answer-empty">
                    no answers in this window.
                </div>
            {:else}
                <div class="sx-answer-list" data-testid="stats-answer-list">
                    {#each answerEntries as [k, v] (k)}
                        {@const pct = (v / totalAns) * 100}
                        <div class="sx-answer-row" data-testid="stats-answer-{k}">
                            <div class="sx-answer-head">
                                <span class="sx-answer-key sx-answer-key-{k} mono">{k}</span>
                                <span class="sx-answer-meta mono">{v} · {pct.toFixed(0)}%</span>
                            </div>
                            <div class="sx-answer-bar">
                                <div
                                    class="sx-answer-fill sx-answer-fill-{k}"
                                    style:width="{pct}%"
                                ></div>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </article>
    </section>
</div>

<style>
    .sx-page {
        max-width: 1100px;
        margin: 0 auto;
        padding: var(--space-8) var(--space-6) var(--space-12);
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
    }

    /* ============== HEADER ============== */
    .sx-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        flex-wrap: wrap;
        gap: var(--space-4);
    }
    .sx-head-left {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .sx-title {
        font-size: 28px;
        font-weight: 600;
        letter-spacing: -0.02em;
        margin: 4px 0 0;
        color: var(--ink);
        line-height: 1.05;
    }
    .sx-title-hand {
        font-family: var(--font-hand);
        color: var(--accent);
        font-size: 22px;
        margin-left: 12px;
        letter-spacing: 0;
        text-transform: lowercase;
    }
    .sx-subtitle {
        font-size: 12px;
        color: var(--ink-mute);
        margin: 4px 0 0;
        letter-spacing: 0.04em;
    }

    /* Range selector — paper pills, ink-bg + bg-fg when active. Matches
       design_handoff_ferdinand/source/stats.jsx range strip (l. 162-171). */
    .sx-range {
        display: inline-flex;
        gap: 6px;
        padding: 0;
    }
    .sx-range-pill {
        font-size: 11px;
        padding: 6px 12px;
        border: 1.2px solid var(--ink);
        border-radius: 4px;
        background: var(--paper);
        color: var(--ink-soft);
        letter-spacing: 0.06em;
        text-transform: lowercase;
        cursor: pointer;
        transition: background-color 100ms ease, color 100ms ease;
    }
    .sx-range-pill:hover {
        background: var(--bg-soft);
    }
    .sx-range-pill.active {
        background: var(--ink);
        color: var(--bg);
    }
    .sx-range-pill:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }

    /* ============== ERROR BANNER ============== */
    .sx-error {
        padding: 10px 14px;
        border: 1.5px solid var(--due);
        background: color-mix(in oklch, var(--due) 10%, var(--paper));
        color: var(--due);
        border-radius: var(--radius-md);
        font-size: 12px;
    }

    /* ============== KPI TILES ============== */
    .sx-kpi-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 14px;
    }
    .sx-tile {
        background: var(--paper);
        border: 1.5px solid var(--ink);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-stamp-md);
        padding: 18px 20px;
    }
    .sx-tile-value {
        font-weight: 600;
        font-size: 36px;
        line-height: 1;
        letter-spacing: -0.02em;
        margin-top: 8px;
        color: var(--ink);
        font-variant-numeric: tabular-nums;
    }
    .sx-tile-accent .sx-tile-value {
        color: var(--accent);
    }
    .sx-tile-unit {
        font-size: 12px;
        font-weight: 400;
        color: var(--ink-mute);
        margin-left: 8px;
        letter-spacing: 0.02em;
    }

    /* ============== CHARTS ============== */
    .sx-charts {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
    }
    .sx-panel {
        background: var(--paper);
        border: 1.5px solid var(--ink);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-stamp-md);
        padding: 18px 22px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .sx-panel-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
    }
    .sx-panel-meta {
        font-size: 11px;
        color: var(--ink-mute);
        letter-spacing: 0.04em;
    }
    .sx-empty {
        padding: 24px 0;
        text-align: center;
        font-size: 12px;
        color: var(--ink-mute);
        letter-spacing: 0.04em;
    }

    /* Bar chart — SVG fills container width; aspect-ratio keeps the
       138-unit drawing area visible while the 26-unit axis row is drawn
       below it. Mobile shrinks the chart height, never the bar count. */
    .sx-bars {
        width: 100%;
        height: auto;
        display: block;
        aspect-ratio: 520 / 166;
    }
    .sx-axis {
        font-family: var(--font-mono);
        font-size: 10px;
        fill: var(--ink-mute);
    }

    /* ============== ANSWER MIX ============== */
    .sx-answer-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .sx-answer-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 4px;
    }
    .sx-answer-key {
        font-size: 12px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }
    .sx-answer-key-again {
        color: var(--due);
    }
    .sx-answer-key-hard {
        color: var(--warn);
    }
    .sx-answer-key-good {
        color: var(--accent);
    }
    .sx-answer-key-easy {
        color: var(--easy, #4a6c8e);
    }
    .sx-answer-meta {
        font-size: 11px;
        color: var(--ink-mute);
    }
    .sx-answer-bar {
        height: 10px;
        background: var(--bg-soft);
        border: 1px solid var(--ink);
        border-radius: 999px;
        overflow: hidden;
    }
    .sx-answer-fill {
        height: 100%;
        border-radius: 999px;
    }
    .sx-answer-fill-again {
        background: var(--due);
    }
    .sx-answer-fill-hard {
        background: var(--warn);
    }
    .sx-answer-fill-good {
        background: var(--accent);
    }
    .sx-answer-fill-easy {
        background: var(--easy, #4a6c8e);
    }

    /* ============== MOBILE (≤768px) ============== */
    @media (max-width: 768px) {
        .sx-page {
            padding: var(--space-5) var(--space-4) var(--space-10);
            gap: var(--space-5);
        }
        .sx-head {
            align-items: flex-start;
        }
        .sx-title {
            font-size: 22px;
        }
        .sx-title-hand {
            font-size: 18px;
            margin-left: 8px;
        }
        .sx-kpi-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
        }
        .sx-tile {
            padding: 12px 14px;
        }
        .sx-tile-value {
            font-size: 26px;
            margin-top: 4px;
        }
        .sx-tile-unit {
            font-size: 10px;
            margin-left: 4px;
        }
        .sx-charts {
            grid-template-columns: 1fr;
            gap: 12px;
        }
        .sx-panel {
            padding: 14px 16px;
        }
        .sx-bars {
            aspect-ratio: 520 / 200;
        }
    }
</style>
