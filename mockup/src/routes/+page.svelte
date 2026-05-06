<script lang="ts">
    import { onMount, tick } from "svelte";
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
    import {
        fetchDecks,
        fetchForecast,
        fetchStatsRecent,
        postDeck,
        postFilteredDeck,
        type ApiDayCount,
        type ApiForecastDay,
    } from "$lib/api";

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

    // Phase 17-B: per-day forecast of review-due cards for the next 7
    // days. Default 7-day window matches the desktop graphs page; the
    // bar chart degrades silently to a hidden section when forecast
    // load fails (no fake fallback — a synthetic forecast would
    // mislead the user about real review load).
    let forecast: ApiForecastDay[] | null = $state(null);
    let forecastError: string | null = $state(null);

    // Bars scale to the peak day in the window, not to the seven-day
    // sum — same convention desktop graphs use. Floor of 1 keeps the
    // CSS `height: ...%` calculation safe when the forecast is all
    // zeros (no future reviews → no bars, but no NaN either).
    let forecastPeak: number = $derived(
        Math.max(
            1,
            ...((forecast ?? []) as ApiForecastDay[]).map((d) => d.reviews),
        ),
    );
    let forecastTotal: number = $derived(
        ((forecast ?? []) as ApiForecastDay[]).reduce(
            (s, d) => s + d.reviews,
            0,
        ),
    );

    // Phase 14-C: inline "+ New deck" form. Mirrors the settings-page
    // "+ New preset" pattern (Phase 12-B): button reveals input, Enter
    // commits, Escape cancels. liveDecks must be non-null to commit so
    // we never lie about persisting against fake data — server-side
    // 400s surface inline rather than as a global error banner so the
    // create form keeps focus and the user can fix-and-retry without
    // scrolling.
    let isCreatingDeck = $state(false);
    let newDeckName = $state("");
    let isMutatingNewDeck = $state(false);
    let newDeckError = $state<string | null>(null);
    let newDeckInput = $state<HTMLInputElement | null>(null);

    // Phase 18-B: parallel "+ Filtered deck" form. Same start/cancel/
    // commit lifecycle as "+ New deck" so users get one consistent
    // affordance pattern, but accepts a name + search expression
    // (Anki search syntax, e.g. `deck:Spanish is:due`). Limit and
    // order use server defaults (100 / "due"); the v1 surface keeps
    // the form to two inputs so it doesn't outgrow the section header.
    let isCreatingFilteredDeck = $state(false);
    let newFilteredName = $state("");
    let newFilteredSearch = $state("");
    let isMutatingNewFilteredDeck = $state(false);
    let newFilteredError = $state<string | null>(null);
    let newFilteredNameInput = $state<HTMLInputElement | null>(null);

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

        try {
            const fc = await fetchForecast(7);
            forecast = fc.history;
        } catch (e) {
            forecastError = e instanceof Error ? e.message : "Couldn't load forecast";
        }
    });

    let decks = $derived(liveDecks ?? fakeDecks);
    let resume = $derived(decks[0] ?? fakeDecks[0]);

    async function startCreateDeck(): Promise<void> {
        if (liveDecks === null) {
            newDeckError = "Create unavailable — backend offline";
            return;
        }
        isCreatingDeck = true;
        newDeckName = "";
        newDeckError = null;
        await tick();
        newDeckInput?.focus();
    }

    function cancelCreateDeck(): void {
        isCreatingDeck = false;
        newDeckName = "";
        newDeckError = null;
    }

    // Commit a new deck. Empty inputs short-circuit to cancel so a
    // mash-Enter on a fresh form doesn't pile up no-op POSTs. On
    // success the deck list refetches because Anki may have created
    // missing parents (e.g. "Spanish::Verbs::Irregular" auto-creates
    // "Spanish" + "Spanish::Verbs") and the canonical sort comes from
    // the server.
    async function commitCreateDeck(): Promise<void> {
        const trimmed = newDeckName.trim();
        if (trimmed === "") {
            cancelCreateDeck();
            return;
        }
        if (liveDecks === null) {
            newDeckError = "Create unavailable — backend offline";
            return;
        }
        isMutatingNewDeck = true;
        newDeckError = null;
        try {
            await postDeck(trimmed);
            const res = await fetchDecks();
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
            cancelCreateDeck();
        } catch (e) {
            newDeckError =
                e instanceof Error ? e.message : "Couldn't create deck";
        } finally {
            isMutatingNewDeck = false;
        }
    }

    async function startCreateFilteredDeck(): Promise<void> {
        if (liveDecks === null) {
            newFilteredError = "Create unavailable — backend offline";
            return;
        }
        isCreatingFilteredDeck = true;
        newFilteredName = "";
        newFilteredSearch = "";
        newFilteredError = null;
        await tick();
        newFilteredNameInput?.focus();
    }

    function cancelCreateFilteredDeck(): void {
        isCreatingFilteredDeck = false;
        newFilteredName = "";
        newFilteredSearch = "";
        newFilteredError = null;
    }

    // Filtered-deck commit. Two required fields (name + search): both
    // empty → cancel (mash-Enter no-op); only one filled → server-side
    // 400 surfaces inline. On success the deck list refetches because
    // a brand-new filtered deck appears at top level and we want it in
    // the visible grid without a hard reload.
    async function commitCreateFilteredDeck(): Promise<void> {
        const trimmedName = newFilteredName.trim();
        const trimmedSearch = newFilteredSearch.trim();
        if (trimmedName === "" && trimmedSearch === "") {
            cancelCreateFilteredDeck();
            return;
        }
        if (liveDecks === null) {
            newFilteredError = "Create unavailable — backend offline";
            return;
        }
        isMutatingNewFilteredDeck = true;
        newFilteredError = null;
        try {
            await postFilteredDeck({
                name: trimmedName,
                search: trimmedSearch,
            });
            const res = await fetchDecks();
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
            cancelCreateFilteredDeck();
        } catch (e) {
            newFilteredError =
                e instanceof Error ? e.message : "Couldn't create filtered deck";
        } finally {
            isMutatingNewFilteredDeck = false;
        }
    }
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
            <div class="head-actions">
                {#if isCreatingDeck}
                    <input
                        bind:this={newDeckInput}
                        bind:value={newDeckName}
                        class="new-deck-input"
                        type="text"
                        placeholder="Spanish::Verbs::Irregular"
                        disabled={isMutatingNewDeck}
                        aria-label="New deck name"
                        onkeydown={(e) => {
                            if (e.key === "Enter") commitCreateDeck();
                            else if (e.key === "Escape") cancelCreateDeck();
                        }}
                    />
                    <button
                        type="button"
                        class="ghost-link"
                        disabled={isMutatingNewDeck}
                        onclick={commitCreateDeck}
                    >Save</button>
                    <button
                        type="button"
                        class="ghost-link subtle-link"
                        disabled={isMutatingNewDeck}
                        onclick={cancelCreateDeck}
                    >Cancel</button>
                {:else if isCreatingFilteredDeck}
                    <input
                        bind:this={newFilteredNameInput}
                        bind:value={newFilteredName}
                        class="new-deck-input"
                        type="text"
                        placeholder="Cram session"
                        disabled={isMutatingNewFilteredDeck}
                        aria-label="New filtered deck name"
                        onkeydown={(e) => {
                            if (e.key === "Enter") commitCreateFilteredDeck();
                            else if (e.key === "Escape") cancelCreateFilteredDeck();
                        }}
                    />
                    <input
                        bind:value={newFilteredSearch}
                        class="new-filtered-search-input"
                        type="text"
                        placeholder="deck:Spanish is:due"
                        disabled={isMutatingNewFilteredDeck}
                        aria-label="Filtered deck search expression"
                        onkeydown={(e) => {
                            if (e.key === "Enter") commitCreateFilteredDeck();
                            else if (e.key === "Escape") cancelCreateFilteredDeck();
                        }}
                    />
                    <button
                        type="button"
                        class="ghost-link"
                        disabled={isMutatingNewFilteredDeck}
                        onclick={commitCreateFilteredDeck}
                    >Save</button>
                    <button
                        type="button"
                        class="ghost-link subtle-link"
                        disabled={isMutatingNewFilteredDeck}
                        onclick={cancelCreateFilteredDeck}
                    >Cancel</button>
                {:else}
                    <button
                        type="button"
                        class="ghost-link new-deck-btn"
                        disabled={liveDecks === null}
                        onclick={startCreateDeck}
                        aria-label="Create new deck"
                    >+ New deck</button>
                    <button
                        type="button"
                        class="ghost-link new-filtered-deck-btn"
                        disabled={liveDecks === null}
                        onclick={startCreateFilteredDeck}
                        aria-label="Create new filtered deck"
                    >+ Filtered</button>
                {/if}
                <a class="ghost-link" href="/browse">Browse all →</a>
            </div>
        </div>
        {#if newDeckError}
            <div class="error-banner" role="alert">{newDeckError}</div>
        {/if}
        {#if newFilteredError}
            <div class="error-banner" role="alert">{newFilteredError}</div>
        {/if}
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

    {#if forecast}
        <section class="section forecast-section" aria-labelledby="forecast-heading">
            <div class="section-head">
                <h3 id="forecast-heading">Next 7 days</h3>
                <span class="ghost-link" aria-hidden="true">forecast</span>
            </div>
            {#if forecastError}
                <div class="stats-error-banner" role="alert">
                    Couldn't load forecast — chart hidden. ({forecastError})
                </div>
            {/if}
            <Card padding="lg">
                <div class="forecast-head">
                    <div>
                        <div class="forecast-total">{forecastTotal.toLocaleString()}</div>
                        <div class="stat-label">cards due</div>
                    </div>
                    <div class="forecast-meta">
                        Bars scale to peak day in window.
                    </div>
                </div>
                <div class="forecast-grid" role="img" aria-label="Per-day review forecast">
                    {#each forecast as day (day.offset)}
                        <div class="forecast-col">
                            <div class="forecast-bar-track">
                                <div
                                    class="forecast-bar"
                                    class:zero={day.reviews === 0}
                                    style="height: {(day.reviews / forecastPeak) * 100}%"
                                    title={day.offset === 0
                                        ? `Today: ${day.reviews} due`
                                        : `+${day.offset}d: ${day.reviews} due`}
                                ></div>
                            </div>
                            <div class="forecast-count">{day.reviews}</div>
                            <div class="forecast-label">
                                {day.offset === 0 ? "Today" : `+${day.offset}d`}
                            </div>
                        </div>
                    {/each}
                </div>
            </Card>
        </section>
    {:else if forecastError}
        <section class="section forecast-section">
            <div class="section-head">
                <h3>Next 7 days</h3>
            </div>
            <div class="stats-error-banner" role="alert">
                Couldn't load forecast. ({forecastError})
            </div>
        </section>
    {/if}

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
    @media (max-width: 640px) {
        .page {
            padding: var(--space-6) var(--space-4) var(--space-8);
            gap: var(--space-6);
        }
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
    .ghost-link:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    /* Phase 14-C: + New deck button + inline form share the section
       header row so the action lives next to "Browse all →". The form
       uses the same ghost-link tokens for visual continuity. */
    .head-actions {
        display: inline-flex;
        align-items: center;
        gap: var(--space-3);
    }
    .new-deck-btn {
        font-size: var(--text-sm);
        color: var(--text-muted);
        padding: 2px 8px;
        border: 1px dashed var(--border);
        border-radius: var(--radius-sm);
        transition:
            color var(--duration-fast) var(--ease),
            border-color var(--duration-fast) var(--ease);
    }
    .new-deck-btn:hover {
        color: var(--accent);
        border-color: var(--accent);
    }
    .new-deck-input {
        font-size: var(--text-sm);
        padding: 2px 8px;
        border: 1px solid var(--accent);
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text);
        outline: none;
        min-width: 220px;
    }
    .new-filtered-search-input {
        font-size: var(--text-sm);
        padding: 2px 8px;
        border: 1px solid var(--accent);
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text);
        outline: none;
        min-width: 200px;
        font-family: var(--font-mono, monospace);
    }
    .new-filtered-deck-btn {
        font-size: var(--text-sm);
        color: var(--text-muted);
        padding: 2px 8px;
        border: 1px dashed var(--border);
        border-radius: var(--radius-sm);
        transition:
            color var(--duration-fast) var(--ease),
            border-color var(--duration-fast) var(--ease);
    }
    .new-filtered-deck-btn:hover {
        color: var(--accent);
        border-color: var(--accent);
    }
    .subtle-link {
        opacity: 0.7;
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

    /* Phase 17-B forecast bar chart. 7-column grid with absolute-
       positioned bars inside a fixed-height track. Uses the same
       --accent gradient as the rest of the home page so the chart
       reads as one piece with the deck cards. .forecast-total is
       deliberately distinct from .stat-value so the existing
       Last-30-days assertions on .stat-value stay scoped. */
    .forecast-total {
        font-size: var(--text-display);
        line-height: 1;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
    }
    .forecast-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        margin-bottom: var(--space-4);
    }
    .forecast-meta {
        font-size: var(--text-xs);
        color: var(--text-subtle);
    }
    .forecast-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: var(--space-2);
        align-items: end;
    }
    .forecast-col {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.35rem;
    }
    .forecast-bar-track {
        width: 100%;
        height: 6rem;
        display: flex;
        align-items: flex-end;
        background: color-mix(in oklch, var(--accent) 8%, transparent);
        border-radius: var(--radius-sm);
        overflow: hidden;
    }
    .forecast-bar {
        width: 100%;
        background: linear-gradient(
            to top,
            var(--accent),
            color-mix(in oklch, var(--accent) 70%, white)
        );
        border-radius: var(--radius-sm) var(--radius-sm) 0 0;
        min-height: 2px;
        transition: height var(--duration-normal) var(--ease);
    }
    .forecast-bar.zero {
        background: transparent;
        min-height: 0;
    }
    .forecast-count {
        font-size: var(--text-xs);
        color: var(--text);
        font-variant-numeric: tabular-nums;
    }
    .forecast-label {
        font-size: var(--text-xs);
        color: var(--text-subtle);
    }
</style>
