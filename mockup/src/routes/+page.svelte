<script lang="ts">
    import { onMount, tick } from "svelte";
    import {
        Btn,
        Caption,
        Chip,
        Panel,
    } from "$lib/components/ui";
    import {
        SketchArrow,
        SketchCardStack,
        SketchPlant,
        SketchPlus,
        SketchSearch,
        SketchFlame,
        SketchClock,
        SketchLeaf,
        SketchUser,
        FerdinandMark,
    } from "$lib/components/sketch";
    import { auth } from "$lib/auth.svelte";
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
    let loadError = $state<string | null>(null);
    let liveHistory: ApiDayCount[] | null = $state(null);
    let statsError = $state<string | null>(null);
    let forecast: ApiForecastDay[] | null = $state(null);
    let forecastError: string | null = $state(null);

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

    let isCreatingDeck = $state(false);
    let newDeckName = $state("");
    let isMutatingNewDeck = $state(false);
    let newDeckError = $state<string | null>(null);
    let newDeckInput = $state<HTMLInputElement | null>(null);

    let isCreatingFilteredDeck = $state(false);
    let newFilteredName = $state("");
    let newFilteredSearch = $state("");
    let isMutatingNewFilteredDeck = $state(false);
    let newFilteredError = $state<string | null>(null);
    let newFilteredNameInput = $state<HTMLInputElement | null>(null);

    onMount(async () => {
        try {
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

    async function handleLogout(): Promise<void> {
        await auth.logout();
    }

    let history = $derived(liveHistory ?? fakeHistory);
    let totalReviews = $derived(history.reduce((a, d) => a + d.reviews, 0));
    let totalDueAll = $derived(decks.reduce((a, d) => a + totalDue(d), 0));
    let activeDeckCount = $derived(
        decks.filter((d) => totalDue(d) > 0).length,
    );

    // Derive 2-char glyph from deck name. Strips spaces + dots so "日文 N2"
    // → "日文" and "Rust ownership" → "RU". Unicode-aware via Array.from
    // so multi-byte CJK chars don't get split mid-codepoint.
    function deriveGlyph(name: string): string {
        const chars = Array.from(name.trim()).filter(
            (c) => c !== " " && c !== "·" && c !== "_",
        );
        if (chars.length === 0) return "··";
        const first = chars[0];
        const second = chars[1] ?? first;
        // Latin uppercase; CJK left as-is (toUpperCase is a no-op for them).
        return (first + second).toUpperCase();
    }

    // Date label for the // caption. Locale matches the design exemplar
    // (2026·05·08) — middle-dot separators read as a deliberate aesthetic
    // choice rather than the default "May 8, 2026" prose.
    const today = (() => {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}·${m}·${day}`;
    })();

    let greetingName = $derived(auth.user?.username ?? "friend");
    let resumeGlyph = $derived(deriveGlyph(resume.name));
    let resumeDue = $derived(totalDue(resume));
</script>

<svelte:head><title>Today — Anki</title></svelte:head>

<div class="sketch-skin grain page" data-testid="dash-root">
    <!-- ============== DESKTOP V2 (today-focused) ============== -->
    <div class="dash-desktop">
        <header class="dash-head">
            <div class="dash-head-left">
                <Caption>{today}</Caption>
                <h1 class="greeting" data-testid="dash-greeting">
                    morning, {greetingName}.
                    <span class="hand sun" aria-hidden="true">☉</span>
                </h1>
                <p class="dash-subtitle">
                    you have <strong>{totalDueAll} cards</strong> due across {activeDeckCount} active deck{activeDeckCount === 1 ? "" : "s"}.
                </p>
            </div>
            <div class="dash-head-right">
                <div class="streak">
                    <Caption>streak</Caption>
                    <div class="streak-value mono">
                        14d <SketchFlame size={14} />
                    </div>
                </div>
                <div class="vrule" role="presentation"></div>
                <SketchPlant size={56} />
                {#if auth.user}
                    <Btn kind="ghost" size="sm" onclick={handleLogout}>
                        {#snippet leading()}<SketchUser size={12} />{/snippet}
                        logout
                    </Btn>
                {/if}
            </div>
        </header>

        {#if loadError}
            <div class="error-banner mono" role="alert">
                couldn't reach server — showing cached counts. ({loadError})
            </div>
        {/if}

        <!-- big "continue" CTA card (accent ground) -->
        <a class="hero-cta" href="/study/{resume.id}" data-testid="dash-hero-cta">
            <div class="hero-text">
                <div class="hero-eye mono">// start where you left off</div>
                <div class="hero-title mono">
                    <span class="hero-glyph">{resumeGlyph}</span>
                    <span class="hero-name">{resume.name}</span>
                </div>
                <div class="hero-stats mono">
                    {resume.new} new · {resume.learning} learning · {resume.review} review{resumeDue > 0 ? ` · ~${Math.max(1, Math.round(resumeDue * 0.45))} min` : " · all clear"}
                </div>
            </div>
            <div class="hero-arrow" aria-hidden="true">
                <SketchArrow size={28} />
            </div>
            <div class="hero-deco" aria-hidden="true">
                <SketchCardStack size={140} />
            </div>
        </a>

        <!-- all decks -->
        <section class="deck-section">
            <div class="section-head">
                <Caption>all decks</Caption>
                <div class="section-actions">
                    {#if !isCreatingDeck && !isCreatingFilteredDeck}
                        <Btn
                            kind="ghost"
                            size="sm"
                            onclick={startCreateDeck}
                            disabled={liveDecks === null}
                            aria-label="Create new deck"
                        >
                            {#snippet leading()}<SketchPlus size={12} />{/snippet}
                            new deck
                        </Btn>
                        <Btn
                            kind="paper"
                            size="sm"
                            onclick={startCreateFilteredDeck}
                            disabled={liveDecks === null}
                            aria-label="Create new filtered deck"
                        >
                            {#snippet leading()}<SketchSearch size={12} />{/snippet}
                            filtered
                        </Btn>
                        <a class="ghost-link mono" href="/browse">browse all →</a>
                    {/if}
                </div>
            </div>

            {#if isCreatingDeck}
                <Panel padding="16px 18px">
                    <div class="inline-form">
                        <input
                            bind:this={newDeckInput}
                            bind:value={newDeckName}
                            class="inline-input"
                            type="text"
                            placeholder="Spanish::Verbs::Irregular"
                            disabled={isMutatingNewDeck}
                            aria-label="New deck name"
                            onkeydown={(e) => {
                                if (e.key === "Enter") commitCreateDeck();
                                else if (e.key === "Escape")
                                    cancelCreateDeck();
                            }}
                        />
                        <Btn
                            kind="primary"
                            size="sm"
                            onclick={commitCreateDeck}
                            disabled={isMutatingNewDeck}
                        >
                            save
                        </Btn>
                        <Btn
                            kind="ghost"
                            size="sm"
                            onclick={cancelCreateDeck}
                            disabled={isMutatingNewDeck}
                        >
                            cancel
                        </Btn>
                    </div>
                </Panel>
            {/if}

            {#if isCreatingFilteredDeck}
                <Panel padding="16px 18px">
                    <div class="inline-form inline-form-2col">
                        <input
                            bind:this={newFilteredNameInput}
                            bind:value={newFilteredName}
                            class="inline-input"
                            type="text"
                            placeholder="cram session"
                            disabled={isMutatingNewFilteredDeck}
                            aria-label="New filtered deck name"
                            onkeydown={(e) => {
                                if (e.key === "Enter")
                                    commitCreateFilteredDeck();
                                else if (e.key === "Escape")
                                    cancelCreateFilteredDeck();
                            }}
                        />
                        <input
                            bind:value={newFilteredSearch}
                            class="inline-input mono"
                            type="text"
                            placeholder="deck:Spanish is:due"
                            disabled={isMutatingNewFilteredDeck}
                            aria-label="Filtered deck search expression"
                            onkeydown={(e) => {
                                if (e.key === "Enter")
                                    commitCreateFilteredDeck();
                                else if (e.key === "Escape")
                                    cancelCreateFilteredDeck();
                            }}
                        />
                        <Btn
                            kind="primary"
                            size="sm"
                            onclick={commitCreateFilteredDeck}
                            disabled={isMutatingNewFilteredDeck}
                        >
                            save
                        </Btn>
                        <Btn
                            kind="ghost"
                            size="sm"
                            onclick={cancelCreateFilteredDeck}
                            disabled={isMutatingNewFilteredDeck}
                        >
                            cancel
                        </Btn>
                    </div>
                </Panel>
            {/if}

            {#if newDeckError}
                <div class="error-banner mono" role="alert">{newDeckError}</div>
            {/if}
            {#if newFilteredError}
                <div class="error-banner mono" role="alert">{newFilteredError}</div>
            {/if}

            <div class="deck-grid" data-testid="deck-grid">
                {#each decks as deck, i (deck.id)}
                    {@const due = totalDue(deck)}
                    {@const glyph = deriveGlyph(deck.name)}
                    <a
                        class="deck-card"
                        data-tilt={i % 3}
                        data-testid="deck-card"
                        data-deck-id={deck.id}
                        data-deck-name={deck.name}
                        href="/study/{deck.id}"
                    >
                        <div class="deck-card-head">
                            <span class="deck-card-eye mono">
                                {String(i + 1).padStart(2, "0")} · {glyph}
                            </span>
                            {#if due > 0}
                                <Chip color="var(--due)" bg="color-mix(in oklch, var(--due) 12%, transparent)">{due} due</Chip>
                            {:else}
                                <Chip color="var(--ink-mute)" bg="transparent">resting</Chip>
                            {/if}
                        </div>

                        <div class="deck-card-body">
                            <div class="deck-card-name mono">{deck.name}</div>
                            <div class="deck-card-sub mono">
                                {deck.totalCards.toLocaleString()} cards
                            </div>
                        </div>

                        <div class="deck-card-counters">
                            <div class="counter">
                                <div class="mono counter-label">new</div>
                                <div
                                    class="mono counter-value"
                                    class:has={deck.new > 0}
                                    style="--counter-color: var(--due)"
                                >{deck.new}</div>
                            </div>
                            <div class="counter">
                                <div class="mono counter-label">learn</div>
                                <div
                                    class="mono counter-value"
                                    class:has={deck.learning > 0}
                                    style="--counter-color: var(--warn)"
                                >{deck.learning}</div>
                            </div>
                            <div class="counter">
                                <div class="mono counter-label">review</div>
                                <div
                                    class="mono counter-value"
                                    class:has={deck.review > 0}
                                    style="--counter-color: var(--accent)"
                                >{deck.review}</div>
                            </div>
                        </div>

                        <div class="deck-card-foot">
                            <span class="mono deck-card-meta">
                                <SketchClock size={11} />
                                {deck.totalCards.toLocaleString()}
                            </span>
                            <span
                                class="mono deck-card-cta"
                                class:has-due={due > 0}
                            >
                                {due > 0 ? "study" : "review"}
                                <SketchArrow size={12} />
                            </span>
                        </div>
                    </a>
                {/each}

                <button
                    type="button"
                    class="deck-card-new"
                    onclick={startCreateDeck}
                    disabled={liveDecks === null}
                    aria-label="Create new deck"
                >
                    <SketchPlus size={28} />
                    <div class="mono">new deck</div>
                    <div class="hand new-deck-prompt">
                        what do you want to remember?
                    </div>
                </button>
            </div>
        </section>

        <!-- forecast: real data, design didn't show it but kept for product completeness -->
        {#if forecast}
            <section class="forecast-section">
                <div class="section-head">
                    <Caption>next 7 days</Caption>
                    <span class="ghost-link mono" aria-hidden="true">forecast</span>
                </div>
                {#if forecastError}
                    <div class="error-banner mono" role="alert">
                        couldn't load forecast — chart hidden. ({forecastError})
                    </div>
                {/if}
                <Panel padding="22px 24px">
                    <div class="forecast-head">
                        <div>
                            <div class="forecast-total mono">
                                {forecastTotal.toLocaleString()}
                            </div>
                            <div class="mono forecast-label">cards due</div>
                        </div>
                        <div class="mono forecast-meta">
                            bars scale to peak day in window.
                        </div>
                    </div>
                    <div class="forecast-grid" data-testid="forecast-grid" role="img" aria-label="Per-day review forecast">
                        {#each forecast as day (day.offset)}
                            <div class="forecast-col">
                                <div class="forecast-track">
                                    <div
                                        class="forecast-bar"
                                        class:zero={day.reviews === 0}
                                        style="height: {(day.reviews / forecastPeak) * 100}%"
                                        title={day.offset === 0
                                            ? `Today: ${day.reviews} due`
                                            : `+${day.offset}d: ${day.reviews} due`}
                                    ></div>
                                </div>
                                <div class="mono forecast-count">{day.reviews}</div>
                                <div class="mono forecast-day">
                                    {day.offset === 0 ? "today" : `+${day.offset}d`}
                                </div>
                            </div>
                        {/each}
                    </div>
                </Panel>
            </section>
        {:else if forecastError}
            <section class="forecast-section">
                <div class="section-head">
                    <Caption>next 7 days</Caption>
                </div>
                <div class="error-banner mono" role="alert">
                    couldn't load forecast. ({forecastError})
                </div>
            </section>
        {/if}

        <!-- last 30 days -->
        <section class="recent-section">
            <div class="section-head">
                <Caption>last 30 days</Caption>
                <a class="ghost-link mono" href="/stats">see full stats →</a>
            </div>
            {#if statsError}
                <div class="error-banner mono" role="alert">
                    couldn't load review history — showing cached values. ({statsError})
                </div>
            {/if}
            <Panel padding="22px 24px">
                <div class="recent-row">
                    <div>
                        <div class="recent-total mono">
                            {totalReviews.toLocaleString()}
                        </div>
                        <div class="mono recent-label">reviews</div>
                    </div>
                    <div class="recent-foot mono">
                        <SketchLeaf size={20} />
                        <span class="hand">steady wins.</span>
                    </div>
                </div>
            </Panel>
        </section>
    </div>

    <!-- ============== MOBILE (≤640px) ============== -->
    <div class="dash-mobile">
        <header class="m-head">
            <div class="m-head-brand">
                <FerdinandMark size={22} />
                <span class="mono m-brand-label">ferdinand</span>
            </div>
            {#if auth.user}
                <Btn kind="ghost" size="sm" onclick={handleLogout}>
                    {#snippet leading()}<SketchUser size={12} />{/snippet}
                    logout
                </Btn>
            {/if}
        </header>

        <Caption>{today}</Caption>
        <h1 class="m-greeting">morning, {greetingName}.</h1>
        <p class="m-sub mono">
            <strong>{totalDueAll}</strong> due · 14d streak
            <SketchFlame size={11} />
        </p>

        {#if loadError}
            <div class="error-banner mono" role="alert">
                couldn't reach server. ({loadError})
            </div>
        {/if}

        <a class="m-hero" href="/study/{resume.id}">
            <div>
                <div class="mono m-hero-eye">// continue</div>
                <div class="mono m-hero-title">{resume.name}</div>
                <div class="mono m-hero-meta">
                    {resumeDue} due · ~{Math.max(1, Math.round(resumeDue * 0.45))} min
                </div>
            </div>
            <SketchArrow size={20} />
        </a>

        <Caption>decks</Caption>

        <div class="m-deck-list">
            {#each decks as deck, i (deck.id)}
                {@const due = totalDue(deck)}
                {@const glyph = deriveGlyph(deck.name)}
                <a class="m-deck-row" href="/study/{deck.id}">
                    <div class="m-deck-head">
                        <div>
                            <div class="mono m-deck-eye">
                                {String(i + 1).padStart(2, "0")} · {glyph}
                            </div>
                            <div class="mono m-deck-name">{deck.name}</div>
                        </div>
                        {#if due > 0}
                            <Chip color="var(--due)" bg="color-mix(in oklch, var(--due) 12%, transparent)">{due} due</Chip>
                        {:else}
                            <Chip color="var(--ink-mute)" bg="transparent">rest</Chip>
                        {/if}
                    </div>
                    <div class="mono m-deck-meta">
                        <span>{deck.new} new · {deck.learning} learn · {deck.review} rev</span>
                        <span>{deck.totalCards.toLocaleString()}</span>
                    </div>
                </a>
            {/each}

            <button
                type="button"
                class="m-deck-new"
                onclick={startCreateDeck}
                disabled={liveDecks === null}
            >
                <SketchPlus size={20} />
                <span class="mono">new deck</span>
            </button>
        </div>

        {#if isCreatingDeck}
            <Panel padding="14px 16px">
                <div class="inline-form-mobile">
                    <input
                        bind:value={newDeckName}
                        class="inline-input"
                        type="text"
                        placeholder="Spanish::Verbs"
                        disabled={isMutatingNewDeck}
                        onkeydown={(e) => {
                            if (e.key === "Enter") commitCreateDeck();
                            else if (e.key === "Escape") cancelCreateDeck();
                        }}
                    />
                    <div class="inline-form-mobile-row">
                        <Btn
                            kind="primary"
                            size="sm"
                            onclick={commitCreateDeck}
                            disabled={isMutatingNewDeck}
                            block
                        >
                            save
                        </Btn>
                        <Btn
                            kind="ghost"
                            size="sm"
                            onclick={cancelCreateDeck}
                            disabled={isMutatingNewDeck}
                            block
                        >
                            cancel
                        </Btn>
                    </div>
                </div>
            </Panel>
        {/if}
        {#if newDeckError}
            <div class="error-banner mono" role="alert">{newDeckError}</div>
        {/if}

        {#if forecast}
            <Caption>next 7 days</Caption>
            <Panel padding="16px 18px">
                <div class="m-forecast-grid">
                    {#each forecast as day (day.offset)}
                        <div class="forecast-col">
                            <div class="forecast-track m-forecast-track">
                                <div
                                    class="forecast-bar"
                                    class:zero={day.reviews === 0}
                                    style="height: {(day.reviews / forecastPeak) * 100}%"
                                ></div>
                            </div>
                            <div class="mono forecast-count">{day.reviews}</div>
                            <div class="mono forecast-day">
                                {day.offset === 0 ? "tdy" : `+${day.offset}`}
                            </div>
                        </div>
                    {/each}
                </div>
            </Panel>
        {/if}

        <div class="m-foot">
            <SketchLeaf size={18} />
        </div>
    </div>
</div>

<style>
    .page {
        max-width: 1200px;
        margin: 0 auto;
        padding: 40px 48px 56px;
    }

    /* — desktop / mobile gate ————————————————— */
    .dash-desktop {
        display: block;
    }
    .dash-mobile {
        display: none;
    }
    @media (max-width: 640px) {
        .page {
            padding: 16px 18px 24px;
        }
        .dash-desktop {
            display: none;
        }
        .dash-mobile {
            display: block;
        }
    }

    /* — desktop header ————————————————————— */
    .dash-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 24px;
        margin-bottom: 28px;
    }
    .dash-head-left {
        flex: 1;
        min-width: 0;
    }
    .greeting {
        font-family: var(--font-mono);
        font-size: 32px;
        font-weight: 500;
        letter-spacing: -0.01em;
        margin: 6px 0 0;
        line-height: 1.15;
    }
    .greeting .sun {
        color: var(--accent);
        font-size: 24px;
        margin-left: 12px;
    }
    .dash-subtitle {
        font-size: 14px;
        color: var(--ink-soft);
        margin: 8px 0 0;
    }
    .dash-subtitle strong {
        color: var(--due);
        font-weight: 600;
    }

    .dash-head-right {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-shrink: 0;
    }
    .streak {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .streak-value {
        font-size: 22px;
        font-weight: 500;
        color: var(--warn);
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    .vrule {
        width: 1px;
        height: 40px;
        background: var(--rule);
    }

    /* — hero CTA card ————————————————————— */
    .hero-cta {
        position: relative;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 24px;
        margin: 0 0 32px;
        padding: 26px 32px;
        background: var(--accent);
        color: var(--bg);
        border: var(--border-w) solid var(--ink);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-stamp-lg);
        text-decoration: none;
        overflow: hidden;
        transition:
            transform 120ms ease,
            box-shadow 120ms ease;
    }
    .hero-cta:hover {
        transform: translate(-1px, -1px);
        box-shadow: 6px 6px 0 var(--ink);
    }
    .hero-cta:active {
        transform: translate(2px, 2px);
        box-shadow: 3px 3px 0 var(--ink);
    }
    .hero-cta:focus-visible {
        outline: 2px solid var(--bg);
        outline-offset: 4px;
    }
    .hero-text {
        position: relative;
        z-index: 1;
        min-width: 0;
    }
    .hero-eye {
        font-size: 11px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        opacity: 0.85;
    }
    .hero-title {
        font-size: 26px;
        font-weight: 600;
        margin: 6px 0 4px;
        display: inline-flex;
        align-items: baseline;
        gap: 12px;
    }
    .hero-glyph {
        font-size: 15px;
        font-weight: 500;
        opacity: 0.85;
        letter-spacing: 0.06em;
    }
    .hero-stats {
        font-size: 12px;
        opacity: 0.9;
    }
    .hero-arrow {
        position: relative;
        z-index: 1;
        flex-shrink: 0;
        color: var(--bg);
    }
    .hero-deco {
        position: absolute;
        right: -12px;
        top: -16px;
        opacity: 0.18;
        z-index: 0;
        color: var(--bg);
        pointer-events: none;
    }

    /* — sections ————————————————————————— */
    .deck-section,
    .forecast-section,
    .recent-section {
        margin-bottom: 32px;
    }
    .section-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 14px;
    }
    .section-actions {
        display: inline-flex;
        align-items: center;
        gap: 8px;
    }
    .ghost-link {
        font-size: 12px;
        color: var(--ink-mute);
        text-decoration: none;
        letter-spacing: 0.04em;
    }
    .ghost-link:hover {
        color: var(--accent);
    }

    /* — inline create form ———————————————— */
    .inline-form {
        display: flex;
        gap: 12px;
        align-items: center;
    }
    .inline-form-2col .inline-input:nth-of-type(2) {
        flex: 1.4;
    }
    .inline-input {
        flex: 1;
        background: transparent;
        border: 0;
        border-bottom: 1.5px solid var(--ink);
        padding: 6px 4px;
        font-family: var(--font-sans);
        font-size: 14px;
        color: var(--ink);
        outline: none;
        min-width: 0;
    }
    .inline-input.mono {
        font-family: var(--font-mono);
    }
    .inline-input::placeholder {
        color: var(--ink-mute);
    }
    .inline-input:focus {
        border-bottom-color: var(--accent);
    }

    /* — deck grid ————————————————————————— */
    .deck-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 18px;
    }
    @media (max-width: 1024px) {
        .deck-grid {
            grid-template-columns: repeat(2, 1fr);
        }
    }

    .deck-card {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px 22px 18px;
        background: var(--paper);
        border: var(--border-w) solid var(--ink);
        border-radius: var(--radius);
        box-shadow: var(--shadow-stamp-md);
        text-decoration: none;
        color: var(--ink);
        min-height: 200px;
        transition:
            transform 120ms ease,
            box-shadow 120ms ease;
    }
    .deck-card[data-tilt="0"] { transform: rotate(-0.2deg); }
    .deck-card[data-tilt="1"] { transform: rotate(0.4deg); }
    .deck-card[data-tilt="2"] { transform: rotate(-0.6deg); }
    .deck-card:hover {
        transform: rotate(0deg) translate(-1px, -1px);
        box-shadow: 5px 5px 0 var(--ink);
    }
    .deck-card:active {
        transform: rotate(0deg) translate(2px, 2px);
        box-shadow: 1px 1px 0 var(--ink);
    }
    .deck-card:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 3px;
    }

    .deck-card-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
    }
    .deck-card-eye {
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.16em;
        text-transform: uppercase;
    }
    .deck-card-name {
        font-size: 19px;
        font-weight: 600;
        word-break: break-word;
    }
    .deck-card-sub {
        font-size: 11px;
        color: var(--ink-mute);
        margin-top: 2px;
    }

    .deck-card-counters {
        display: flex;
        gap: 18px;
        margin-top: 4px;
    }
    .counter-label {
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.1em;
        text-transform: uppercase;
    }
    .counter-value {
        font-size: 18px;
        color: var(--ink-mute);
        font-weight: 400;
        font-variant-numeric: tabular-nums;
    }
    .counter-value.has {
        color: var(--counter-color);
        font-weight: 600;
    }

    .deck-card-foot {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: auto;
        padding-top: 10px;
        border-top: 1px dashed var(--rule);
    }
    .deck-card-meta {
        font-size: 10px;
        color: var(--ink-mute);
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    .deck-card-cta {
        font-size: 11px;
        color: var(--ink-mute);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    .deck-card-cta.has-due {
        color: var(--accent);
    }

    .deck-card-new {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 22px;
        background: transparent;
        border: 1.5px dashed var(--rule);
        border-radius: var(--radius);
        color: var(--ink-soft);
        cursor: pointer;
        min-height: 200px;
        font-family: inherit;
        transition:
            border-color 120ms ease,
            color 120ms ease;
    }
    .deck-card-new:hover:not(:disabled) {
        border-color: var(--accent);
        color: var(--accent);
    }
    .deck-card-new:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
    .new-deck-prompt {
        color: var(--accent);
        font-size: 18px;
        margin-top: 4px;
    }

    /* — forecast bar chart ————————————————— */
    .forecast-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        margin-bottom: 16px;
    }
    .forecast-total {
        font-size: 38px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: -0.02em;
        color: var(--ink);
        font-variant-numeric: tabular-nums;
    }
    .forecast-label,
    .recent-label {
        font-size: 11px;
        color: var(--ink-mute);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        margin-top: 4px;
    }
    .forecast-meta {
        font-size: 11px;
        color: var(--ink-mute);
    }
    .forecast-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 10px;
        align-items: end;
    }
    .forecast-col {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
    }
    .forecast-track {
        width: 100%;
        height: 96px;
        display: flex;
        align-items: flex-end;
        background: color-mix(in oklch, var(--accent) 8%, transparent);
        border: 1px dashed var(--rule);
        border-radius: var(--radius);
        overflow: hidden;
    }
    .forecast-bar {
        width: 100%;
        background: var(--accent);
        border-radius: var(--radius) var(--radius) 0 0;
        min-height: 2px;
        transition: height 240ms ease;
    }
    .forecast-bar.zero {
        background: transparent;
        min-height: 0;
    }
    .forecast-count {
        font-size: 11px;
        color: var(--ink);
        font-variant-numeric: tabular-nums;
    }
    .forecast-day {
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.04em;
    }

    /* — last 30 days panel ———————————————— */
    .recent-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 24px;
    }
    .recent-total {
        font-size: 38px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
    }
    .recent-foot {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--accent);
    }
    .recent-foot .hand {
        font-size: 18px;
    }

    /* — error banner ————————————————————— */
    .error-banner {
        font-size: 12px;
        color: var(--due);
        background: color-mix(in oklch, var(--due) 10%, transparent);
        border: 1px solid color-mix(in oklch, var(--due) 30%, transparent);
        border-radius: var(--radius);
        padding: 8px 12px;
        margin: 0 0 14px;
    }

    /* ============== MOBILE ============== */
    .m-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 14px;
        border-bottom: 1px dashed var(--rule);
        margin-bottom: 14px;
    }
    .m-head-brand {
        display: inline-flex;
        align-items: center;
        gap: 8px;
    }
    .m-brand-label {
        font-size: 12px;
        font-weight: 600;
    }
    .m-greeting {
        font-family: var(--font-mono);
        font-size: 22px;
        font-weight: 500;
        margin: 6px 0 0;
        letter-spacing: -0.01em;
    }
    .m-sub {
        font-size: 12px;
        color: var(--ink-soft);
        margin: 6px 0 18px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    .m-sub strong {
        color: var(--due);
        font-weight: 600;
    }

    .m-hero {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 16px;
        background: var(--accent);
        color: var(--bg);
        border: 1.4px solid var(--ink);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-stamp-md);
        text-decoration: none;
        margin-bottom: 22px;
    }
    .m-hero-eye {
        font-size: 9px;
        letter-spacing: 0.18em;
        opacity: 0.85;
    }
    .m-hero-title {
        font-size: 16px;
        font-weight: 600;
        margin-top: 4px;
    }
    .m-hero-meta {
        font-size: 10px;
        opacity: 0.85;
    }

    .m-deck-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin: 8px 0 22px;
    }
    .m-deck-row {
        display: block;
        padding: 12px 14px;
        border: 1.2px solid var(--ink);
        border-radius: var(--radius);
        background: var(--paper);
        box-shadow: var(--shadow-stamp-sm);
        text-decoration: none;
        color: var(--ink);
    }
    .m-deck-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 10px;
    }
    .m-deck-eye {
        font-size: 9px;
        color: var(--ink-mute);
        letter-spacing: 0.16em;
        text-transform: uppercase;
    }
    .m-deck-name {
        font-size: 14px;
        font-weight: 600;
        margin-top: 2px;
    }
    .m-deck-meta {
        margin-top: 8px;
        font-size: 10px;
        color: var(--ink-mute);
        display: flex;
        justify-content: space-between;
    }

    .m-deck-new {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px;
        background: transparent;
        border: 1.2px dashed var(--rule);
        border-radius: var(--radius);
        color: var(--ink-soft);
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
    }
    .m-deck-new:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    .inline-form-mobile {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .inline-form-mobile-row {
        display: flex;
        gap: 8px;
    }

    .m-forecast-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 6px;
        align-items: end;
    }
    .m-forecast-track {
        height: 56px;
    }

    .m-foot {
        display: flex;
        justify-content: center;
        margin: 16px 0 8px;
        color: var(--accent);
    }
</style>
