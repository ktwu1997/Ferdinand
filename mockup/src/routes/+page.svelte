<script lang="ts">
    import { onMount } from "svelte";
    import Card from "$lib/components/Card.svelte";
    import Button from "$lib/components/Button.svelte";
    import Sparkline from "$lib/components/Sparkline.svelte";
    import Kbd from "$lib/components/Kbd.svelte";
    import LiveIndicator from "$lib/components/LiveIndicator.svelte";
    import {
        decks as fakeDecks,
        history as fakeHistory,
        totalDue,
        type Deck,
    } from "$lib/data";
    import { fetchDecks, fetchStatsRecent, type ApiDayCount } from "$lib/api";

    let liveDecks: Deck[] | null = $state(null);
    // Phase 10-B: explicit error banner on fetch failure. Read-only page,
    // so fake fallback is preserved (silent-degrade on the data) — but the
    // banner tells the user their counts are stale, which a fully-silent
    // path would hide. Distinct from 9-N3 stateful pages: those would
    // also reject the user's edits; here, no edits to reject, just stale
    // counts to acknowledge.
    let loadError = $state<string | null>(null);

    // Phase 11-B: live last-30-days history from /api/stats/recent. Same
    // banner-plus-fake fallback shape as the deck fetch — the page never
    // blanks, but the user is told their counts are stale.
    let liveHistory: ApiDayCount[] | null = $state(null);
    let statsError = $state<string | null>(null);

    onMount(async () => {
        try {
            const res = await fetchDecks();
            // Flatten top-level only for the landing view; keep nested for later.
            liveDecks = res.decks
                .filter((d) => d.id !== 0 && d.level >= 1)
                .map((d) => ({
                    id: String(d.id),
                    name: d.name,
                    emoji: "📚",
                    new: d.new_count,
                    learning: d.learn_count,
                    review: d.review_count,
                    totalCards: d.total_in_deck,
                    lastStudied: new Date().toISOString(),
                }));
        } catch (e) {
            loadError = e instanceof Error ? e.message : "Couldn't load decks";
        }

        try {
            const stats = await fetchStatsRecent(30);
            liveHistory = stats.history;
        } catch (e) {
            statsError = e instanceof Error ? e.message : "Couldn't load stats";
        }
    });

    let decks = $derived(liveDecks ?? fakeDecks);
    let resume = $derived(decks[0] ?? fakeDecks[0]);
    let history = $derived(liveHistory ?? fakeHistory);
    let totalReviews = $derived(history.reduce((a, d) => a + d.reviews, 0));
    let totalDueAll = $derived(decks.reduce((a, d) => a + totalDue(d), 0));
    let last7 = $derived(history.slice(-7).map((d) => d.reviews));

    const today = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
    });
</script>

<svelte:head><title>Today — Anki</title></svelte:head>

<div class="page">
    <header>
        <div class="date-row">
            <span class="date">{today}</span>
            <LiveIndicator />
        </div>
        <div class="actions">
            <Button variant="ghost" size="sm" href="/notes/new">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                Add note
                <Kbd>A</Kbd>
            </Button>
        </div>
    </header>

    {#if loadError}
        <div class="error-banner" role="alert">
            Couldn't reach server — showing cached counts. ({loadError})
        </div>
    {/if}

    <h1>{totalDueAll} cards to review</h1>
    <p class="subtitle">
        Across {decks.filter((d) => totalDue(d) > 0).length} active decks ·
        <span class="subtle">estimated 18 minutes</span>
    </p>

    <Card variant="primary" padding="lg">
        <div class="resume">
            <div class="resume-meta">
                <span class="eyebrow">Resume where you left off</span>
                <h2>{resume.emoji} {resume.name}</h2>
                <p class="resume-stats">
                    <span><strong>{resume.new}</strong> new</span>
                    <span class="dot">·</span>
                    <span><strong>{resume.learning}</strong> learning</span>
                    <span class="dot">·</span>
                    <span><strong>{resume.review}</strong> to review</span>
                </p>
            </div>
            <div class="resume-cta">
                <Button variant="primary" size="lg" href="/study/{resume.id}">
                    Start studying
                    <Kbd>↵</Kbd>
                </Button>
            </div>
        </div>
    </Card>

    <section class="section">
        <div class="section-head">
            <h3>All decks</h3>
            <a class="ghost-link" href="/browse">Browse all →</a>
        </div>
        <div class="deck-grid">
            {#each decks as deck (deck.id)}
                {@const due = totalDue(deck)}
                <Card as="a" href="/study/{deck.id}" interactive padding="md">
                    <div class="deck-row">
                        <span class="deck-emoji">{deck.emoji}</span>
                        <div class="deck-body">
                            <div class="deck-name">{deck.name}</div>
                            <div class="deck-sub">
                                {deck.totalCards.toLocaleString()} cards
                            </div>
                        </div>
                        <div class="deck-due" class:has-due={due > 0}>
                            {#if due > 0}
                                <span class="due-count">{due}</span>
                                <span class="due-label">due</span>
                            {:else}
                                <span class="subtle">—</span>
                            {/if}
                        </div>
                    </div>
                </Card>
            {/each}
        </div>
    </section>

    <section class="section">
        <div class="section-head">
            <h3>Last 30 days</h3>
            <a class="ghost-link" href="/stats">See full stats →</a>
        </div>
        {#if statsError}
            <div class="stats-error-banner" role="alert">
                Couldn't load review history — showing cached values. ({statsError})
            </div>
        {/if}
        <Card padding="lg">
            <div class="stat-head">
                <div>
                    <div class="stat-value">{totalReviews.toLocaleString()}</div>
                    <div class="stat-label">reviews</div>
                </div>
                <div class="week">
                    <div class="week-label">Past week</div>
                    <Sparkline values={last7} height={36} />
                </div>
            </div>
        </Card>
    </section>
</div>

<style>
    .page {
        max-width: var(--content-max);
        margin: 0 auto;
        padding: var(--space-12) var(--space-8) var(--space-16);
        display: flex;
        flex-direction: column;
        gap: var(--space-8);
    }

    header {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .date-row {
        display: flex;
        align-items: center;
        gap: var(--space-3);
    }
    .date {
        font-size: var(--text-sm);
        color: var(--text-muted);
        font-variant-numeric: tabular-nums;
    }
    .actions :global(kbd) {
        margin-left: 2px;
    }

    h1 {
        font-size: var(--text-display);
        font-weight: 600;
        line-height: 1.05;
        letter-spacing: -0.025em;
        color: var(--text);
    }
    .subtitle {
        color: var(--text-muted);
        margin-top: calc(var(--space-4) * -1);
        font-size: var(--text-lg);
    }
    .subtitle .subtle {
        color: var(--text-subtle);
    }

    .resume {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-8);
        flex-wrap: wrap;
        padding: var(--space-4);
        background: #ffffff;
        border-radius: var(--radius-md);
        transition:
            background var(--duration-fast) var(--ease),
            box-shadow var(--duration-fast) var(--ease);
    }
    :global([data-theme="dark"]) .resume {
        background: var(--bg-elevated);
    }
    .resume:hover {
        box-shadow: var(--shadow-sm);
    }
    .resume:focus-within {
        box-shadow: var(--shadow-sm);
    }
    .resume-meta {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }
    .eyebrow {
        font-size: var(--text-xs);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--accent);
        font-weight: 500;
    }
    .resume h2 {
        font-size: var(--text-2xl);
        font-weight: 600;
        letter-spacing: -0.015em;
    }
    .resume-stats {
        color: var(--text-muted);
        font-size: var(--text-sm);
        display: flex;
        gap: var(--space-3);
        align-items: center;
        flex-wrap: wrap;
    }
    .resume-stats strong {
        color: var(--text);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
    }
    .resume-stats .dot {
        color: var(--text-subtle);
    }

    .section {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }
    .section-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
    }
    .section-head h3 {
        font-size: var(--text-lg);
        font-weight: 600;
        letter-spacing: -0.01em;
    }
    .ghost-link {
        color: var(--text-muted);
        font-size: var(--text-sm);
    }
    .ghost-link:hover {
        color: var(--accent);
    }

    .deck-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--space-3);
    }

    .deck-row {
        display: flex;
        align-items: center;
        gap: var(--space-4);
    }
    .deck-emoji {
        font-size: 1.5rem;
        width: 36px;
        height: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-subtle);
        border-radius: var(--radius-sm);
        flex-shrink: 0;
        transition:
            background var(--duration-fast) var(--ease),
            color var(--duration-fast) var(--ease);
    }
    .deck-row:hover .deck-emoji {
        background: var(--bg-hover);
    }
    .deck-body {
        flex: 1;
        min-width: 0;
    }
    .deck-name {
        font-size: var(--text-base);
        font-weight: 500;
        color: var(--text);
        transition: color var(--duration-fast) var(--ease);
    }
    .deck-row:hover .deck-name {
        color: var(--accent);
    }
    .deck-sub {
        font-size: var(--text-xs);
        color: var(--text-subtle);
        margin-top: 2px;
    }
    .deck-due {
        text-align: right;
        font-variant-numeric: tabular-nums;
    }
    .deck-due.has-due .due-count {
        font-size: var(--text-lg);
        font-weight: 600;
        color: var(--text);
        transition: color var(--duration-fast) var(--ease);
    }
    .deck-row:hover .deck-due.has-due .due-count {
        color: var(--accent);
    }
    .deck-due.has-due .due-label {
        display: block;
        font-size: var(--text-xs);
        color: var(--text-subtle);
    }
    .subtle {
        color: var(--text-subtle);
    }

    .stat-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: var(--space-6);
    }
    .stat-value {
        font-size: var(--text-3xl);
        font-weight: 600;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
    }
    .stat-label {
        color: var(--text-subtle);
        font-size: var(--text-sm);
        margin-top: 2px;
    }
    .week {
        flex: 1;
        max-width: 260px;
    }
    .week-label {
        font-size: var(--text-xs);
        color: var(--text-subtle);
        text-align: right;
        margin-bottom: var(--space-2);
    }

    /* Phase 10-B: cached-counts banner. Same token vocabulary as the
       browse page banner so disabled/danger UI feels consistent. */
    .error-banner,
    .stats-error-banner {
        font-size: var(--text-xs);
        color: var(--danger);
        background: color-mix(in oklch, var(--danger) 10%, transparent);
        border: 1px solid color-mix(in oklch, var(--danger) 30%, transparent);
        border-radius: var(--radius-sm);
        padding: 0.4rem 0.6rem;
        margin-bottom: var(--space-3);
    }
</style>
