<!--
  / dashboard — rev 2 design ("the deck ledger").

  Visual reference: design_handoff_ferdinand/screenshots/02-dashboard.png is
  THE authority (the rev-1 React source dashboard.jsx is stale on captions
  and structure). The screenshot shows the ledger / list composition:

    1. THE.DECK.LEDGER caption + a big mono "decks" title with a hand-drawn
       underline squiggle, and a "another round" hand-font aside.
    2. A TODAY row banded by 1.5px ink rules: date + "good morning, …"
       subtitle on the left, then three stat cells — DUE NOW / REVIEWED /
       STREAK — laid out as a grid.
    3. An IDX · DECK table. Each row: zero-padded index · a small bordered
       glyph square (JP / RS / …) · deck name + meta sub-line · the
       NEW / LEARN / REVIEW counts right-aligned · a stacked queue bar.
       A dashed "+ new deck" row closes the table.
    4. (below the screenshot crop) the 7-day forecast bar chart and the
       last-30-days reviews panel are kept for product completeness.

  The sketch / kraft-paper skin (.sketch-skin .grain, paper texture, hand
  comments) is unchanged — this is layout work, not a re-skin.

  Test contract notes:
   * data-testid="dash-root" / "dash-hero" / "dash-greeting" stay.
   * the ledger ROWS carry data-testid="deck-card" + data-deck-id +
     data-deck-name (the deck-grid contract — e2e a4/a5 + vitest depend
     on it); .deck-card-name / .deck-card-sub are still the per-row name +
     "<n> cards" sub-line.
   * the resume-hero accent CTA is gone in rev 2 (the screenshot has no
     room for it between TODAY and the table) — "continue where you left
     off" is now just clicking the first ledger row.
-->
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
        SketchPlant,
        SketchPlus,
        SketchSearch,
        SketchFlame,
        SketchClock,
        SketchLeaf,
        SketchUser,
        SketchUnderline,
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
        type ApiDeckSummary,
        type ApiForecastDay,
    } from "$lib/api";
    import { flattenLeafDecks, leafSegment } from "$lib/decks";
    import { computeStreak } from "$lib/study";

    // The ledger lists the *studiable leaf decks*, not the nested tree
    // `GET /api/decks` returns. `flattenLeafDecks` ($lib/decks) walks the
    // tree, keeps the leaves (a pure-container parent like `TOEIC` holds
    // no cards directly — only its children do), and rewrites each
    // `.name` to the full `Foo::Bar::Baz` path so the rows are
    // unambiguous (`TOEIC::Cloze::L600` vs `TOEIC::Vocabulary::L600`).
    // Counts stay as-is — leaf counts are the deck's own, never roll-ups
    // — so DUE NOW is the non-double-counted sum across rows and every
    // row maps to a `/study/<id>` target.
    function mapApiDecks(decks: ApiDeckSummary[]): Deck[] {
        return flattenLeafDecks(decks)
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
    }

    let liveDecks: Deck[] | null = $state(null);
    let decksReady = $state(false);
    let historyReady = $state(false);
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

    onMount(() => {
        fetchDecks()
            .then((res) => {
                liveDecks = mapApiDecks(res.decks);
            })
            .catch((e: unknown) => {
                loadError = e instanceof Error ? e.message : "Couldn't load decks";
            })
            .finally(() => {
                decksReady = true;
            });

        fetchStatsRecent(30)
            .then((stats) => {
                liveHistory = stats.history;
            })
            .catch((e: unknown) => {
                statsError = e instanceof Error ? e.message : "Couldn't load stats";
            })
            .finally(() => {
                historyReady = true;
            });

        fetchForecast(7)
            .then((fc) => {
                forecast = fc.history;
            })
            .catch((e: unknown) => {
                forecastError = e instanceof Error ? e.message : "Couldn't load forecast";
            });
    });

    // Gate: skeleton while pending; empty list on error (never show fakeDecks to real users — close #4).
    let decks = $derived(decksReady ? (liveDecks ?? []) : []);
    let resume = $derived(decks[0]);

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
            liveDecks = mapApiDecks(res.decks);
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
            liveDecks = mapApiDecks(res.decks);
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

    // Same gate: empty while pending AND on error so no fake totals leak (close #4).
    let history = $derived(historyReady ? (liveHistory ?? []) : []);
    let streakDays = $derived(historyReady ? computeStreak(liveHistory ?? []) : null);
    let totalReviews = $derived(history.reduce((a, d) => a + d.reviews, 0));
    let totalDueAll = $derived(decks.reduce((a, d) => a + totalDue(d), 0));
    let activeDeckCount = $derived(
        decks.filter((d) => totalDue(d) > 0).length,
    );
    // "REVIEWED" stat = today's review count. The recent-history series is
    // chronological, so the last entry is today; fall back to 0 if empty.
    let reviewedToday = $derived(history[history.length - 1]?.reviews ?? 0);

    // Derive a 2-char glyph from the deck name for the bordered tag square.
    // Strips spaces + dots so "日文 N2" → "日文" and "Rust ownership" → "RU".
    // Unicode-aware via Array.from so multi-byte CJK chars aren't split
    // mid-codepoint.
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

    // Stacked queue-bar segments — proportional widths of new / learn /
    // review against the larger of (sum of those counts) or totalCards so a
    // deck with mostly-mature cards doesn't render a full bar.
    function queueSegments(deck: Deck): {
        new: number;
        learn: number;
        review: number;
    } {
        const due = deck.new + deck.learning + deck.review;
        const denom = Math.max(due, deck.totalCards, 1);
        return {
            new: (deck.new / denom) * 100,
            learn: (deck.learning / denom) * 100,
            review: (deck.review / denom) * 100,
        };
    }

    // Date label for the // caption. Locale matches the design exemplar
    // (2026·05·08 thursday) — middle-dot separators + lowercase weekday read
    // as a deliberate aesthetic choice rather than "May 8, 2026" prose.
    const today = (() => {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const weekday = d
            .toLocaleDateString("en-US", { weekday: "long" })
            .toLowerCase();
        return `${y}·${m}·${day} ${weekday}`;
    })();

    let greetingName = $derived(auth.user?.username ?? "friend");
    let resumeGlyph = $derived(deriveGlyph(leafSegment(resume.name)));
    let resumeDue = $derived(totalDue(resume));
</script>

<svelte:head><title>Today — Ferdinand</title></svelte:head>

<div class="sketch-skin grain page" data-testid="dash-root">
    <!-- ============== DESKTOP V2 (the deck ledger) ============== -->
    <div class="dash-desktop">
        <header class="dash-head" data-testid="dash-hero">
            <div class="dash-head-left">
                <Caption>the.deck.ledger</Caption>
                <h1 class="page-title dash-title">
                    decks
                    <span class="page-title-hand dash-title-hand hand">another round</span>
                </h1>
                <div class="dash-title-rule" aria-hidden="true">
                    <SketchUnderline width={96} />
                </div>
            </div>
            <div class="dash-head-right">
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

        <!-- TODAY band: date + greeting subtitle, then three stat cells -->
        <section class="today-row" data-testid="dash-today">
            <div class="today-meta">
                <Caption>today</Caption>
                <div class="today-date mono">{today}</div>
                <p class="dash-subtitle mono" data-testid="dash-greeting">
                    good morning, {greetingName} —
                    <strong>{totalDueAll} cards</strong>
                    waiting across {activeDeckCount} active deck{activeDeckCount === 1 ? "" : "s"}.
                </p>
            </div>
            <div class="today-stat">
                <Caption>due now</Caption>
                <div class="today-value mono" style="--stat-color: var(--due)">
                    {totalDueAll}
                </div>
            </div>
            <div class="today-stat">
                <Caption>reviewed</Caption>
                <div class="today-value mono" style="--stat-color: var(--accent)">
                    {reviewedToday}
                </div>
            </div>
            <div class="today-stat">
                <Caption>streak</Caption>
                <div class="today-value mono" style="--stat-color: var(--warn)">
                    {streakDays !== null ? `${streakDays}d` : '—'} <SketchFlame size={16} />
                </div>
            </div>
        </section>

        <!-- all decks — the ledger table -->
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

            {#if !decksReady}
                <ul
                    class="deck-ledger-skel"
                    data-testid="dashboard-deck-skeleton"
                    aria-hidden="true"
                >
                    <li class="ledger-skel-row"><span class="skel-bar"></span></li>
                    <li class="ledger-skel-row"><span class="skel-bar skel-bar-sm" style="width:55%"></span></li>
                    <li class="ledger-skel-row"><span class="skel-bar" style="width:64%"></span></li>
                </ul>
            {:else}
            <div class="deck-ledger" data-testid="deck-grid">
                <div class="ledger-head mono" role="presentation">
                    <span class="lh-idx">idx</span>
                    <span class="lh-deck">deck</span>
                    <span class="lh-num">new</span>
                    <span class="lh-num">learn</span>
                    <span class="lh-num">review</span>
                    <span class="lh-queue">queue</span>
                </div>

                {#each decks as deck, i (deck.id)}
                    {@const due = totalDue(deck)}
                    {@const glyph = deriveGlyph(leafSegment(deck.name))}
                    {@const seg = queueSegments(deck)}
                    <a
                        class="deck-row"
                        class:resting={due === 0}
                        data-testid="deck-card"
                        data-deck-id={deck.id}
                        data-deck-name={deck.name}
                        href="/study/{deck.id}"
                    >
                        <span class="deck-row-idx mono">
                            {String(i + 1).padStart(2, "0")}
                        </span>

                        <div class="deck-row-id">
                            <span class="deck-row-glyph mono" aria-hidden="true">{glyph}</span>
                            <div class="deck-row-text">
                                <div class="deck-card-name mono">{deck.name}</div>
                                <div class="deck-card-sub mono">
                                    <SketchClock size={11} />
                                    {deck.totalCards.toLocaleString()} cards
                                    {#if due > 0}
                                        <span class="deck-row-tag">{due} due</span>
                                    {:else}
                                        <span class="deck-row-tag resting">resting</span>
                                    {/if}
                                </div>
                            </div>
                        </div>

                        <span
                            class="deck-row-num mono"
                            class:has={deck.new > 0}
                            style="--num-color: var(--due)"
                        >{deck.new}</span>
                        <span
                            class="deck-row-num mono"
                            class:has={deck.learning > 0}
                            style="--num-color: var(--warn)"
                        >{deck.learning}</span>
                        <span
                            class="deck-row-num mono"
                            class:has={deck.review > 0}
                            style="--num-color: var(--accent)"
                        >{deck.review}</span>

                        <span class="deck-row-queue" aria-hidden="true">
                            <span class="qbar">
                                <span class="qseg qnew" style="width: {seg.new}%"></span>
                                <span class="qseg qlearn" style="width: {seg.learn}%"></span>
                                <span class="qseg qreview" style="width: {seg.review}%"></span>
                            </span>
                            <span class="deck-row-cta mono" class:has-due={due > 0}>
                                {due > 0 ? "study" : "review"}
                                <SketchArrow size={12} />
                            </span>
                        </span>
                    </a>
                {/each}

                <button
                    type="button"
                    class="deck-card-new"
                    onclick={startCreateDeck}
                    disabled={liveDecks === null}
                    aria-label="Create new deck"
                >
                    <SketchPlus size={20} />
                    <span class="mono">new deck</span>
                    <span class="hand new-deck-prompt">
                        what do you want to remember?
                    </span>
                </button>
            </div>
            {/if}

            <div class="deck-foot">
                <Caption>
                    {decks.length} deck{decks.length === 1 ? "" : "s"} · {decks.reduce((a, d) => a + d.totalCards, 0).toLocaleString()} cards
                </Caption>
                <span class="deck-foot-hand">
                    <SketchLeaf size={18} />
                    <span class="hand">steady wins.</span>
                </span>
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
    <!-- the global MobileTopBar already carries the FerdinandMark + brand + search/user
         icons on every non-fullscreen route; logout lives under the user icon → /settings.
         So the mobile dashboard content starts straight at the ledger header (matches the
         design's DashboardMobile, which has no in-content brand row). -->
    <div class="dash-mobile">
        <Caption>the.deck.ledger</Caption>
        <h1 class="page-title m-title">decks</h1>
        <p class="m-sub mono">
            good morning, {greetingName} ·
            <strong>{totalDueAll}</strong> due · {streakDays !== null ? `${streakDays}d` : '—'} streak
            <SketchFlame size={11} />
        </p>

        {#if loadError}
            <div class="error-banner mono" role="alert">
                couldn't reach server. ({loadError})
            </div>
        {/if}

        <div class="m-today" data-testid="m-today">
            <div class="m-today-cell">
                <Caption>due now</Caption>
                <div class="m-today-value mono" style="--stat-color: var(--due)">{totalDueAll}</div>
            </div>
            <div class="m-today-cell">
                <Caption>reviewed</Caption>
                <div class="m-today-value mono" style="--stat-color: var(--accent)">{reviewedToday}</div>
            </div>
            <div class="m-today-cell">
                <Caption>streak</Caption>
                <div class="m-today-value mono" style="--stat-color: var(--warn)">{streakDays !== null ? `${streakDays}d` : '—'}</div>
            </div>
        </div>

        <Caption>decks</Caption>

        <div class="m-deck-list">
            {#each decks as deck, i (deck.id)}
                {@const due = totalDue(deck)}
                {@const glyph = deriveGlyph(leafSegment(deck.name))}
                <a class="m-deck-row" href="/study/{deck.id}">
                    <div class="m-deck-head">
                        <div class="m-deck-id">
                            <span class="m-deck-glyph mono" aria-hidden="true">{glyph}</span>
                            <div>
                                <div class="mono m-deck-eye">
                                    {String(i + 1).padStart(2, "0")}
                                </div>
                                <div class="mono m-deck-name">{deck.name}</div>
                            </div>
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
            overflow-x: clip;
        }
        .dash-desktop {
            display: none;
        }
        .dash-mobile {
            display: block;
        }
    }

    /* — desktop header / title ————————————————— */
    .dash-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 24px;
        margin-bottom: 26px;
    }
    .dash-head-left {
        flex: 1;
        min-width: 0;
    }
    .dash-title {
        font-size: 38px;
        display: flex;
        align-items: baseline;
        gap: 16px;
        flex-wrap: wrap;
        margin: 8px 0 0;
    }
    .dash-title-hand {
        font-size: 24px;
        margin-left: 0; /* hero uses the flex `gap` for spacing, not the shared margin */
    }
    .dash-title-rule {
        margin-top: 6px;
        color: var(--accent);
    }
    .dash-subtitle {
        font-size: 13px;
        color: var(--ink-soft);
        margin: 6px 0 0;
        line-height: 1.5;
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

    /* — TODAY band ————————————————————————— */
    .today-row {
        display: grid;
        grid-template-columns: 1.7fr 1fr 1fr 1.1fr;
        gap: 24px;
        align-items: center;
        padding: 22px 0;
        border-top: var(--border-w) solid var(--ink);
        border-bottom: var(--border-w) solid var(--ink);
        margin-bottom: 28px;
    }
    .today-meta {
        min-width: 0;
    }
    .today-date {
        font-size: 18px;
        font-weight: 500;
        margin-top: 6px;
        letter-spacing: -0.01em;
    }
    .today-stat {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .today-value {
        font-size: 32px;
        font-weight: 500;
        letter-spacing: -0.02em;
        color: var(--stat-color, var(--ink));
        font-variant-numeric: tabular-nums;
        display: inline-flex;
        align-items: baseline;
        gap: 6px;
    }
    @media (max-width: 1024px) {
        .today-row {
            grid-template-columns: 1fr 1fr 1fr;
        }
        .today-meta {
            grid-column: 1 / -1;
            margin-bottom: 8px;
        }
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
        margin-bottom: 12px;
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
        margin-bottom: 12px;
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

    /* — ledger skeleton (pending state) — */
    .deck-ledger-skel {
        list-style: none;
        margin: 0;
        padding: 0;
        pointer-events: none;
    }
    .ledger-skel-row {
        padding: 10px 8px;
        border-bottom: 1px solid var(--rule-soft);
    }

    /* — ledger table ————————————————————————— */
    .deck-ledger {
        display: flex;
        flex-direction: column;
    }
    /* Shared column template — keep .ledger-head + .deck-row in lockstep. */
    .ledger-head,
    .deck-row {
        display: grid;
        grid-template-columns: 38px minmax(0, 1fr) 64px 64px 64px minmax(140px, 1.3fr);
        gap: 16px;
        align-items: center;
    }
    .ledger-head {
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ink-mute);
        padding: 10px 8px;
        border-bottom: 1px dashed var(--rule);
    }
    .ledger-head .lh-num {
        text-align: right;
    }

    .deck-row {
        padding: 16px 8px;
        border-bottom: 1px solid var(--rule-soft);
        text-decoration: none;
        color: var(--ink);
        position: relative;
        transition: background-color 120ms ease;
    }
    .deck-row:hover {
        background: color-mix(in oklch, var(--accent) 7%, transparent);
    }
    .deck-row:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: -2px;
        border-radius: var(--radius);
    }
    .deck-row.resting {
        opacity: 0.72;
    }
    .deck-row-idx {
        font-size: 11px;
        color: var(--ink-mute);
        font-variant-numeric: tabular-nums;
    }
    .deck-row-id {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
    }
    .deck-row-glyph {
        flex: 0 0 40px;
        width: 40px;
        height: 40px;
        display: grid;
        place-items: center;
        border: 1.4px solid var(--ink);
        border-radius: var(--radius);
        background: var(--paper);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        line-height: 1;
        text-align: center;
    }
    .deck-row-text {
        min-width: 0;
    }
    .deck-card-name {
        font-size: 16px;
        font-weight: 600;
        word-break: break-word;
    }
    .deck-card-sub {
        margin-top: 3px;
        font-size: 11px;
        color: var(--ink-mute);
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
    }
    .deck-row-tag {
        border: 1px solid color-mix(in oklch, var(--due) 45%, transparent);
        color: var(--due);
        border-radius: var(--radius-pill);
        padding: 1px 8px;
        font-size: 9px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }
    .deck-row-tag.resting {
        border-color: var(--rule);
        color: var(--ink-mute);
    }

    .deck-row-num {
        text-align: right;
        font-size: 16px;
        font-weight: 400;
        color: var(--ink-mute);
        font-variant-numeric: tabular-nums;
    }
    .deck-row-num.has {
        color: var(--num-color);
        font-weight: 600;
    }

    .deck-row-queue {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
    }
    .qbar {
        flex: 1;
        min-width: 0;
        height: 8px;
        display: flex;
        background: color-mix(in oklch, var(--ink) 8%, transparent);
        border: 1px solid var(--rule);
        border-radius: var(--radius-pill);
        overflow: hidden;
    }
    .qseg {
        height: 100%;
    }
    .qseg.qnew {
        background: var(--due);
    }
    .qseg.qlearn {
        background: var(--warn);
    }
    .qseg.qreview {
        background: var(--accent);
    }
    .deck-row-cta {
        flex-shrink: 0;
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    .deck-row-cta.has-due {
        color: var(--accent);
    }

    .deck-card-new {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 16px 8px;
        margin-top: 4px;
        background: transparent;
        border: 1.5px dashed var(--rule);
        border-radius: var(--radius);
        color: var(--ink-soft);
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        letter-spacing: 0.08em;
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
        font-size: 17px;
        letter-spacing: 0;
        text-transform: none;
    }

    .deck-foot {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 18px;
        padding-top: 14px;
        border-top: 1px dashed var(--rule);
    }
    .deck-foot-hand {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--accent);
    }
    .deck-foot-hand .hand {
        font-size: 18px;
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
    .m-title {
        font-size: 26px;
        margin: 6px 0 0;
    }
    .m-sub {
        font-size: 12px;
        color: var(--ink-soft);
        margin: 6px 0 16px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
    }
    .m-sub strong {
        color: var(--due);
        font-weight: 600;
    }

    .m-today {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
        padding: 14px 0;
        border-top: 1.2px solid var(--ink);
        border-bottom: 1.2px solid var(--ink);
        margin-bottom: 18px;
    }
    .m-today-cell {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
    }
    .m-today-value {
        font-size: 22px;
        font-weight: 500;
        letter-spacing: -0.02em;
        color: var(--stat-color, var(--ink));
        font-variant-numeric: tabular-nums;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
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
    .m-deck-id {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
    }
    .m-deck-glyph {
        flex: 0 0 32px;
        width: 32px;
        height: 32px;
        display: grid;
        place-items: center;
        border: 1.2px solid var(--ink);
        border-radius: var(--radius);
        background: var(--bg-soft);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.04em;
        line-height: 1;
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
