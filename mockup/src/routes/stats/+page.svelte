<script lang="ts">
    import Card from "$lib/components/Card.svelte";
    import Sparkline from "$lib/components/Sparkline.svelte";
    import { history, answerDistribution } from "$lib/data";

    let range = $state<"1M" | "3M" | "1Y" | "ALL">("1M");

    const values = history.map((d) => d.reviews);
    const retentions = history.map((d) => Math.round(d.retention * 100));
    const totalReviews = values.reduce((a, v) => a + v, 0);
    const avgRetention = Math.round(
        (history.reduce((a, d) => a + d.retention, 0) / history.length) * 100,
    );
    const streak = 12;
    const maturityPct = 68;

    const maxBar = Math.max(...values);
    const totalAns = Object.values(answerDistribution).reduce((a, b) => a + b, 0);
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
                    onclick={() => (range = r as typeof range)}>{r}</button
                >
            {/each}
        </div>
    </header>

    <div class="kpi-grid">
        <Card padding="md">
            <div class="kpi-label">Reviews</div>
            <div class="kpi-value">{totalReviews.toLocaleString()}</div>
            <div class="kpi-delta up">+14% vs previous</div>
        </Card>
        <Card padding="md">
            <div class="kpi-label">Retention</div>
            <div class="kpi-value">{avgRetention}<span class="unit">%</span></div>
            <div class="kpi-delta down">−1.2% vs target</div>
        </Card>
        <Card padding="md">
            <div class="kpi-label">Streak</div>
            <div class="kpi-value">{streak}<span class="unit">days</span></div>
            <div class="kpi-delta up">Longest: 34</div>
        </Card>
        <Card padding="md">
            <div class="kpi-label">Mature</div>
            <div class="kpi-value">{maturityPct}<span class="unit">%</span></div>
            <div class="kpi-delta">of 5,412 cards</div>
        </Card>
    </div>

    <div class="charts-grid">
        <Card padding="lg">
            <div class="card-head">
                <h3>Daily reviews</h3>
                <span class="subtle">last 30 days</span>
            </div>
            <div class="bars">
                {#each values as v, i (i)}
                    <div class="bar-col">
                        <div class="bar" style:height="{(v / maxBar) * 100}%"></div>
                    </div>
                {/each}
            </div>
            <div class="x-axis">
                <span>30d ago</span>
                <span>today</span>
            </div>
        </Card>

        <Card padding="lg">
            <div class="card-head">
                <h3>Retention</h3>
                <span class="subtle">rolling 7-day</span>
            </div>
            <Sparkline values={retentions} height={180} color="var(--success)" />
            <div class="x-axis">
                <span>80%</span>
                <span>100%</span>
            </div>
        </Card>

        <Card padding="lg">
            <div class="card-head">
                <h3>Answer buttons</h3>
                <span class="subtle">{totalAns} total</span>
            </div>
            <div class="ans-chart">
                {#each Object.entries(answerDistribution) as [k, v] (k)}
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
        </Card>

        <Card padding="lg">
            <div class="card-head">
                <h3>Heatmap</h3>
                <span class="subtle">past 365 days</span>
            </div>
            <div class="heatmap">
                {#each Array(52 * 7) as _, i (i)}
                    {@const intensity = ((i * 7) % 9) / 8}
                    <div
                        class="cell"
                        style:opacity={0.1 + intensity * 0.9}
                    ></div>
                {/each}
            </div>
            <div class="legend">
                <span>Less</span>
                <div class="legend-swatches">
                    <div class="cell" style:opacity="0.15"></div>
                    <div class="cell" style:opacity="0.4"></div>
                    <div class="cell" style:opacity="0.65"></div>
                    <div class="cell" style:opacity="0.9"></div>
                </div>
                <span>More</span>
            </div>
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

    .heatmap {
        display: grid;
        grid-template-columns: repeat(52, 1fr);
        grid-auto-flow: column;
        grid-template-rows: repeat(7, 1fr);
        gap: 2px;
    }
    .cell {
        aspect-ratio: 1;
        background: var(--accent);
        border-radius: 2px;
    }
    .legend {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        margin-top: var(--space-3);
        font-size: var(--text-xs);
        color: var(--text-subtle);
    }
    .legend-swatches {
        display: flex;
        gap: 2px;
    }
    .legend-swatches .cell {
        width: 10px;
        height: 10px;
    }
</style>
