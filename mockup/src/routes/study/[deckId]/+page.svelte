<script lang="ts">
    import { onMount, tick } from "svelte";
    import { page } from "$app/stores";
    import { decks, cards as fakeCards } from "$lib/data";
    import {
        fetchDecks,
        fetchQueue,
        patchNote,
        postAnswer,
        type ApiCardSummary,
        type AnswerRating,
    } from "$lib/api";
    import Kbd from "$lib/components/Kbd.svelte";
    import CardFace from "$lib/components/CardFace.svelte";

    const OFFLINE_CARD_CSS = `.card{font-family:var(--font-serif,serif);font-size:3rem;text-align:center;line-height:1.15;letter-spacing:-0.02em;}`;

    let deckIdParam = $derived($page.params.deckId ?? "");
    let deckName = $state("…");
    let deckEmoji = $state("📚");

    // Live (backend-driven) state.
    let mode = $state<"loading" | "live" | "offline">("loading");
    let deckNumericId = $state<number | null>(null);
    let currentCard = $state<ApiCardSummary | null>(null);
    let counts = $state<{ new: number; learning: number; review: number } | null>(null);
    let sessionStartedWith = $state(0);
    let answeredCount = $state(0);
    let cardStartedAt = $state(0);
    let sending = $state(false);
    let lastError = $state<string | null>(null);

    // Offline fallback when backend is unreachable.
    let offlineIdx = $state(0);
    let offlineCards = $derived(
        mode === "offline" ? fakeCards.filter((c) => c.deckId === deckIdParam) : [],
    );

    let showAnswer = $state(false);

    // Phase 20-A: per-card tag override. Tags belong to the underlying
    // note (so all sibling cards inherit them); we mirror server-canonical
    // tags onto `currentCard` after each PATCH so the chip strip rerenders
    // without a refetch. `tagInput` is bound for focus, `isAddingTag`
    // toggles the inline input, `isMutatingTags` disables the controls
    // while a PATCH is in flight, and `tagError` surfaces a per-tag
    // failure message above the chip strip (kept distinct from the
    // queue-level `lastError` so a tag-edit failure doesn't look like
    // an answer-post failure).
    let tagInput = $state<HTMLInputElement | null>(null);
    let isAddingTag = $state(false);
    let newTagDraft = $state("");
    let isMutatingTags = $state(false);
    let tagError = $state<string | null>(null);

    onMount(async () => {
        try {
            const list = await fetchDecks();
            const flat = flattenTree(list.decks);
            const hit =
                flat.find((d) => String(d.id) === deckIdParam) ??
                flat.find((d) => slug(d.name) === deckIdParam) ??
                flat.find((d) => d.name.toLowerCase().includes(deckIdParam.toLowerCase())) ??
                flat[0];
            if (!hit) throw new Error("no deck matched");
            deckName = hit.name;
            deckEmoji = "📚";
            deckNumericId = hit.id;
            const res = await fetchQueue(hit.id, 1);
            counts = { new: res.new, learning: res.learning, review: res.review };
            sessionStartedWith = res.new + res.learning + res.review;
            currentCard = res.cards[0] ?? null;
            cardStartedAt = Date.now();
            mode = "live";
        } catch {
            // Backend unreachable — degrade to the fake-data preview.
            const fd = decks.find((d) => d.id === deckIdParam) ?? decks[0];
            deckName = fd.name;
            deckEmoji = fd.emoji;
            mode = "offline";
        }
    });

    function flattenTree(
        tree: { id: number; name: string; level: number; children: any[] }[],
    ): Array<{ id: number; name: string }> {
        const out: Array<{ id: number; name: string }> = [];
        const walk = (nodes: any[]) => {
            for (const n of nodes) {
                if (n.level >= 1) out.push({ id: n.id, name: n.name });
                if (n.children?.length) walk(n.children);
            }
        };
        walk(tree);
        return out;
    }

    function slug(name: string): string {
        return name.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    }

    let frontHtml = $derived<string>(
        mode === "live"
            ? (currentCard?.front_html ?? "—")
            : (offlineCards[offlineIdx]?.front ?? "—"),
    );
    let backHtml = $derived<string>(
        mode === "live"
            ? (currentCard?.back_html ?? "")
            : (offlineCards[offlineIdx]?.back ?? ""),
    );
    let cardCss = $derived<string>(
        mode === "live" ? (currentCard?.notetype_css ?? "") : OFFLINE_CARD_CSS,
    );

    let total = $derived<number>(
        mode === "live"
            ? Math.max(sessionStartedWith, 1)
            : Math.max(offlineCards.length, 1),
    );
    let position = $derived<number>(
        mode === "live"
            ? Math.min(answeredCount + (currentCard ? 1 : 0), total)
            : Math.min(offlineIdx + 1, total),
    );
    let progressPct = $derived<number>(
        mode === "live"
            ? Math.min(((answeredCount + (showAnswer ? 0.5 : 0)) / total) * 100, 100)
            : Math.min(((offlineIdx + (showAnswer ? 0.5 : 0)) / total) * 100, 100),
    );

    let done = $derived(mode === "live" && currentCard === null && sessionStartedWith > 0);

    const GRADE_TO_RATING: Record<1 | 2 | 3 | 4, AnswerRating> = {
        1: "again",
        2: "hard",
        3: "good",
        4: "easy",
    };

    function reveal() {
        if (mode === "live" && !currentCard) return;
        showAnswer = true;
    }

    async function answer(grade: 1 | 2 | 3 | 4) {
        if (mode === "offline") {
            showAnswer = false;
            offlineIdx = Math.min(offlineIdx + 1, Math.max(offlineCards.length - 1, 0));
            return;
        }
        if (sending || !currentCard || deckNumericId === null) return;
        sending = true;
        lastError = null;
        // Clamp ms_taken: backend caps via deck preset; keep it within u32 sanity.
        const msTaken = Math.min(Math.max(Date.now() - cardStartedAt, 0), 60_000);
        try {
            const res = await postAnswer({
                card_id: currentCard.id,
                deck_id: deckNumericId,
                rating: GRADE_TO_RATING[grade],
                milliseconds_taken: msTaken,
            });
            counts = { new: res.new, learning: res.learning, review: res.review };
            answeredCount += 1;
            currentCard = res.cards[0] ?? null;
            showAnswer = false;
            cardStartedAt = Date.now();
        } catch (err) {
            lastError = err instanceof Error ? err.message : "Failed to record answer";
        } finally {
            sending = false;
        }
    }

    // Phase 20-A: optimistic tag remove. Mirrors the browse-page contract
    // (filter → patch → mirror server-canonical tags back). On error the
    // optimistic state is reverted so the chip reappears with its prior
    // value.
    async function removeTag(tag: string): Promise<void> {
        if (mode !== "live" || !currentCard) return;
        const prevTags = currentCard.tags;
        const optimistic = prevTags.filter((t) => t !== tag);
        currentCard = { ...currentCard, tags: optimistic };
        const noteId = currentCard.note_id;
        isMutatingTags = true;
        tagError = null;
        try {
            const res = await patchNote(noteId, { tags: optimistic });
            // Only mirror if we're still on the same note — moving to the
            // next card mid-flight should not stomp the new card's tags.
            if (currentCard && currentCard.note_id === noteId) {
                currentCard = { ...currentCard, tags: res.tags };
            }
        } catch (err) {
            if (currentCard && currentCard.note_id === noteId) {
                currentCard = { ...currentCard, tags: prevTags };
            }
            tagError = err instanceof Error ? err.message : "Tag remove failed";
        } finally {
            isMutatingTags = false;
        }
    }

    async function startAddTag(): Promise<void> {
        if (mode !== "live" || !currentCard) return;
        isAddingTag = true;
        newTagDraft = "";
        tagError = null;
        await tick();
        tagInput?.focus();
    }

    function cancelAddTag(): void {
        isAddingTag = false;
        newTagDraft = "";
    }

    // Phase 20-A: optimistic tag add. Empty/dup short-circuit (no patch
    // fired) — matching the browse-page editor so a stray Enter on a
    // duplicate doesn't churn the server. Trim only; the server is the
    // authority on further normalization.
    async function commitAddTag(): Promise<void> {
        if (mode !== "live" || !currentCard) {
            cancelAddTag();
            return;
        }
        const trimmed = newTagDraft.trim();
        if (trimmed === "") {
            cancelAddTag();
            return;
        }
        if (currentCard.tags.includes(trimmed)) {
            cancelAddTag();
            return;
        }
        const prevTags = currentCard.tags;
        const optimistic = [...prevTags, trimmed];
        currentCard = { ...currentCard, tags: optimistic };
        const noteId = currentCard.note_id;
        isAddingTag = false;
        newTagDraft = "";
        isMutatingTags = true;
        tagError = null;
        try {
            const res = await patchNote(noteId, { tags: optimistic });
            if (currentCard && currentCard.note_id === noteId) {
                currentCard = { ...currentCard, tags: res.tags };
            }
        } catch (err) {
            if (currentCard && currentCard.note_id === noteId) {
                currentCard = { ...currentCard, tags: prevTags };
            }
            tagError = err instanceof Error ? err.message : "Tag add failed";
        } finally {
            isMutatingTags = false;
        }
    }

    function onKey(e: KeyboardEvent) {
        if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
        if (done) return;
        if (!showAnswer && (e.key === " " || e.key === "Enter")) {
            e.preventDefault();
            reveal();
            return;
        }
        if (showAnswer) {
            if (e.key === "1") answer(1);
            if (e.key === "2") answer(2);
            if (e.key === "3" || e.key === " " || e.key === "Enter") answer(3);
            if (e.key === "4") answer(4);
        }
    }
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>Studying {deckName} — Anki</title></svelte:head>

<div class="stage">
    <header>
        <a href="/" class="back">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            <span class="emoji">{deckEmoji}</span>
            <span>{deckName}</span>
        </a>
        {#if mode === "live" && counts}
            <div class="counts" aria-label="Remaining cards by kind">
                <span class="count count-new" class:zero={counts.new === 0} title="New cards remaining">{counts.new}</span>
                <span class="count count-learn" class:zero={counts.learning === 0} title="Learning cards remaining">{counts.learning}</span>
                <span class="count count-review" class:zero={counts.review === 0} title="Review cards remaining">{counts.review}</span>
            </div>
        {:else}
            <div class="counter">
                <span class="i">{position}</span>
                <span class="slash">/</span>
                <span class="total">{total}</span>
            </div>
        {/if}
        <div class="spacer">
            <button class="icon-btn" aria-label="Edit current card" title="Edit · E">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
            </button>
            <button class="icon-btn" aria-label="Suspend" title="Suspend · !">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
            </button>
        </div>
    </header>

    <div class="progress"><div class="progress-fill" style:width="{progressPct}%"></div></div>

    {#if lastError}
        <div class="error-banner" role="alert">{lastError}</div>
    {/if}

    <div class="content">
        {#if done}
            <div class="empty-state">
                <div class="empty-title">All caught up</div>
                <div class="empty-sub">No more cards scheduled in {deckName} today.</div>
                <a href="/" class="empty-back">Back to decks</a>
            </div>
        {:else}
            <div class="card-stack">
                <article class="card-face front">
                    <CardFace html={frontHtml} css={cardCss} testid="card-face-front" />
                </article>
                {#if showAnswer}
                    <div class="divider"><span>ANSWER</span></div>
                    <article class="card-face back">
                        <CardFace html={backHtml} css={cardCss} testid="card-face-back" />
                    </article>
                {/if}
                {#if mode === "live" && currentCard}
                    <!-- Phase 20-A: per-card tag override. Edits apply to
                         the underlying note, so sibling cards (same
                         note_id) inherit the change. Keyed on note_id so
                         the chip strip resets when the queue advances. -->
                    {#key currentCard.note_id}
                        <section class="tag-pane" aria-label="Edit tags">
                            {#if tagError}
                                <div class="tag-error" role="alert" data-testid="tag-error">{tagError}</div>
                            {/if}
                            <div class="tag-edit" data-testid="tag-edit">
                                {#each currentCard.tags as t (t)}
                                    <button
                                        type="button"
                                        class="tag tag-removable"
                                        disabled={isMutatingTags}
                                        onclick={() => removeTag(t)}
                                        aria-label="Remove tag {t}"
                                    >#{t}<span class="x" aria-hidden="true">×</span></button>
                                {/each}
                                {#if isAddingTag}
                                    <input
                                        bind:this={tagInput}
                                        bind:value={newTagDraft}
                                        class="tag-input"
                                        disabled={isMutatingTags}
                                        aria-label="New tag"
                                        data-testid="tag-input"
                                        onkeydown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                commitAddTag();
                                            } else if (e.key === "Escape") {
                                                e.preventDefault();
                                                cancelAddTag();
                                            }
                                        }}
                                        onblur={cancelAddTag}
                                    />
                                {:else}
                                    <button
                                        type="button"
                                        class="add-tag"
                                        disabled={isMutatingTags}
                                        onclick={startAddTag}
                                        data-testid="tag-add-btn"
                                    >+ Add tag</button>
                                {/if}
                            </div>
                        </section>
                    {/key}
                {/if}
            </div>
        {/if}
    </div>

    <footer>
        {#if done}
            <!-- no footer controls when the deck is finished -->
        {:else if !showAnswer}
            <div class="reveal">
                <button class="reveal-btn" onclick={reveal} disabled={mode === "live" && !currentCard}>
                    Show answer
                    <Kbd>Space</Kbd>
                </button>
            </div>
        {:else}
            <div class="answers">
                <button class="ans ans-again" onclick={() => answer(1)} disabled={sending}>
                    <span class="ans-label">Again</span>
                    <span class="ans-hint">&lt; 1 min</span>
                    <span class="ans-key"><Kbd>1</Kbd></span>
                </button>
                <button class="ans ans-hard" onclick={() => answer(2)} disabled={sending}>
                    <span class="ans-label">Hard</span>
                    <span class="ans-hint">6 min</span>
                    <span class="ans-key"><Kbd>2</Kbd></span>
                </button>
                <button class="ans ans-good" onclick={() => answer(3)} disabled={sending}>
                    <span class="ans-label">Good</span>
                    <span class="ans-hint">10 min</span>
                    <span class="ans-key"><Kbd>3</Kbd></span>
                </button>
                <button class="ans ans-easy" onclick={() => answer(4)} disabled={sending}>
                    <span class="ans-label">Easy</span>
                    <span class="ans-hint">4 d</span>
                    <span class="ans-key"><Kbd>4</Kbd></span>
                </button>
            </div>
        {/if}
    </footer>
</div>

<style>
    .stage {
        min-height: 100vh;
        min-height: 100dvh;
        display: flex;
        flex-direction: column;
        background: var(--bg);
        padding-top: var(--safe-top);
        padding-bottom: var(--safe-bottom);
        overscroll-behavior-y: none;
    }

    header {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        padding: var(--space-5) var(--space-8);
        gap: var(--space-4);
    }
    @media (max-width: 640px) {
        header {
            padding: var(--space-3) var(--space-4);
            gap: var(--space-2);
        }
    }
    .back {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--text-muted);
        font-size: var(--text-sm);
        padding: 0.35rem 0.6rem;
        border-radius: var(--radius-sm);
        width: fit-content;
    }
    .back:hover {
        background: var(--bg-hover);
        color: var(--text);
    }
    .back .emoji {
        font-size: 1rem;
    }
    .counter {
        text-align: center;
        font-variant-numeric: tabular-nums;
        font-size: var(--text-sm);
        color: var(--text-muted);
    }
    .counter .i {
        color: var(--text);
        font-weight: 500;
    }
    .counter .slash {
        margin: 0 4px;
        color: var(--text-subtle);
    }
    .counts {
        display: inline-flex;
        align-items: center;
        gap: var(--space-4);
        font-size: var(--text-sm);
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        justify-self: center;
    }
    .count {
        min-width: 1.5rem;
        text-align: center;
        transition: color var(--duration-fast) var(--ease), opacity var(--duration-fast) var(--ease);
    }
    .count.zero {
        opacity: 0.35;
    }
    .count-new {
        color: var(--count-new);
    }
    .count-learn {
        color: var(--count-learn);
    }
    .count-review {
        color: var(--count-review);
    }
    .spacer {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-1);
    }
    .icon-btn {
        width: 32px;
        height: 32px;
        border-radius: var(--radius-sm);
        color: var(--text-muted);
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }
    .icon-btn:hover {
        background: var(--bg-hover);
        color: var(--text);
    }

    .progress {
        height: 2px;
        background: var(--bg-subtle);
        position: relative;
        overflow: hidden;
    }
    .progress-fill {
        position: absolute;
        inset: 0 auto 0 0;
        background: var(--accent);
        transition: width var(--duration-slow) var(--ease);
    }

    .content {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--space-8);
    }
    .card-stack {
        max-width: 640px;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--space-8);
    }
    .card-face {
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        width: 100%;
        transition:
            box-shadow var(--duration-base) var(--ease),
            background var(--duration-base) var(--ease);
        /* background, padding, shadow, min-height are face-specific below. */
    }
    .card-face.front {
        background: var(--bg-card-front);
        box-shadow: var(--shadow-md);
        padding: clamp(2.5rem, 7vw, 4.5rem) clamp(1.75rem, 5vw, 3.5rem);
        min-height: clamp(280px, 38vh, 420px);
    }
    .card-face.back {
        /* Warmer surface + tighter frame: a notetype's 20px sans body text
           looks thin on stark white, but holds its weight on cream (light)
           or the themed elevated surface (dark). The back face is a
           continuation of the prompt, not a peer — so shadow and vertical
           presence are softened. */
        background: var(--bg-card-back);
        box-shadow: var(--shadow-sm);
        padding: clamp(2rem, 5vw, 3.5rem) clamp(1.5rem, 4vw, 3rem);
        min-height: clamp(200px, 28vh, 320px);
    }
    .divider {
        position: relative;
        text-align: center;
    }
    .divider::before {
        content: "";
        position: absolute;
        inset: 50% 0 auto 0;
        height: 1px;
        background: var(--border);
    }
    .divider span {
        position: relative;
        background: var(--bg);
        padding: 0 var(--space-3);
        font-size: 0.7rem;
        letter-spacing: 0.22em;
        color: var(--text-muted);
        font-weight: 600;
    }

    footer {
        padding: var(--space-6) var(--space-8) var(--space-10);
        display: flex;
        justify-content: center;
    }
    @media (max-width: 640px) {
        footer {
            padding: var(--space-4) var(--space-3) max(var(--space-6), var(--safe-bottom));
        }
    }

    .reveal {
        display: flex;
        justify-content: center;
        width: 100%;
    }
    .reveal-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--space-3);
        padding: 0.85rem 1.5rem;
        min-height: var(--touch-min);
        font-size: var(--text-base);
        font-weight: 500;
        color: var(--text);
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        transition: border-color var(--duration-fast) var(--ease), background var(--duration-fast) var(--ease);
    }
    @media (max-width: 640px) {
        .reveal-btn {
            width: 100%;
            justify-content: center;
            padding: 1rem 1.25rem;
        }
    }
    .reveal-btn:hover {
        border-color: var(--accent);
        background: var(--bg-hover);
    }

    .answers {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--space-3);
        max-width: 760px;
        width: 100%;
    }
    .ans {
        display: grid;
        grid-template-rows: auto auto;
        gap: 2px;
        padding: var(--space-4) var(--space-3);
        min-height: var(--touch-min);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        color: var(--text);
        position: relative;
        transition: border-color var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease),
            transform var(--duration-fast) var(--ease);
    }
    @media (max-width: 640px) {
        .answers {
            gap: var(--space-2);
        }
        .ans {
            min-height: 56px;
            padding: var(--space-3) var(--space-2);
        }
        .ans-label {
            font-size: 0.95rem;
        }
        .ans-hint {
            font-size: 0.65rem;
        }
    }
    /* Touch (no hover) — hide keyboard hints, swap hover states for :active. */
    @media (hover: none) {
        .ans-key {
            display: none;
        }
        .ans:hover {
            transform: none;
        }
        .ans:active {
            background: var(--bg-hover);
        }
    }
    .ans:hover {
        transform: translateY(-1px);
    }
    .ans-label {
        font-size: var(--text-base);
        font-weight: 600;
    }
    .ans-hint {
        font-size: var(--text-xs);
        color: var(--text-subtle);
        font-variant-numeric: tabular-nums;
    }
    .ans-key {
        position: absolute;
        top: var(--space-2);
        right: var(--space-2);
        opacity: 0.6;
    }
    .ans-again:hover {
        border-color: var(--again);
    }
    .ans-hard:hover {
        border-color: var(--hard);
    }
    .ans-good:hover {
        border-color: var(--good);
    }
    .ans-easy:hover {
        border-color: var(--easy);
    }

    .ans-again .ans-label {
        color: var(--again);
    }
    .ans-hard .ans-label {
        color: var(--hard);
    }
    .ans-good .ans-label {
        color: var(--good);
    }
    .ans-easy .ans-label {
        color: var(--easy);
    }
    .ans:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
    }
    .reveal-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .error-banner {
        margin: var(--space-2) var(--space-8) 0;
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--again);
        border-radius: var(--radius-sm);
        color: var(--again);
        font-size: var(--text-sm);
        text-align: center;
    }

    .empty-state {
        max-width: 420px;
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        align-items: center;
    }
    .empty-title {
        font-family: var(--font-serif);
        font-size: var(--text-2xl);
        color: var(--text);
    }
    .empty-sub {
        font-size: var(--text-sm);
        color: var(--text-muted);
    }
    .empty-back {
        margin-top: var(--space-2);
        padding: 0.6rem 1.1rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        color: var(--text);
        font-size: var(--text-sm);
    }
    .empty-back:hover {
        border-color: var(--accent);
        background: var(--bg-hover);
    }

    /* Phase 20-A: tag pane below the card stack. Mirrors the browse-page
       chip strip (font-mono / subtle background) so the editor reads as
       part of the same vocabulary. Centered to align with the card. */
    .tag-pane {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        align-items: center;
        margin-top: var(--space-2);
    }
    .tag-edit {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        justify-content: center;
        max-width: 640px;
    }
    .tag {
        font-family: var(--font-mono);
        font-size: 0.7rem;
        color: var(--text-subtle);
        background: var(--bg-subtle);
        padding: 1px 6px;
        border-radius: var(--radius-sm);
    }
    .tag-removable {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        transition:
            color var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease);
    }
    .tag-removable:hover {
        color: var(--accent);
        background: var(--bg-hover);
    }
    .tag-removable:disabled {
        opacity: 0.55;
        cursor: progress;
    }
    .tag-removable .x {
        font-size: 0.85rem;
        line-height: 1;
        opacity: 0.7;
    }
    .tag-input {
        font-family: var(--font-mono);
        font-size: 0.7rem;
        padding: 1px 6px;
        border: 1px solid var(--accent);
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text);
        outline: none;
        min-width: 80px;
    }
    .add-tag {
        font-size: var(--text-xs);
        color: var(--text-subtle);
        padding: 1px 6px;
        border: 1px dashed var(--border);
        border-radius: var(--radius-sm);
        transition:
            color var(--duration-fast) var(--ease),
            border-color var(--duration-fast) var(--ease);
    }
    .add-tag:hover {
        color: var(--accent);
        border-color: var(--accent);
    }
    .tag-error {
        font-size: var(--text-xs);
        color: var(--again);
        text-align: center;
    }
</style>
