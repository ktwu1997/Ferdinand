<!--
  Phase A4-δ — /study/[deckId] sketch-skin port. The data layer
  (fetchQueue → postAnswer → patchNote, offline fallback, keyboard
  hotkeys, optimistic tag edit) is preserved verbatim; only the visual
  shell is rebuilt against the kraft-paper design system shared with
  /login (β) and / (γ).

  Critical contract: CardFace stays untouched — the shadow-DOM card
  renderer is anki's real notetype pipeline (front_html + back_html +
  notetype_css) and breaking that means breaking every card in every
  deck on every install.

  Mirrors design_handoff_ferdinand/source/study.jsx structure:
    header  : glyph + session caption + counts breakdown + queue bar
              + edit/suspend ghosts + back arrow
    content : single index-card panel (offset stack shadow) with tag
              edit row, front face, dashed divider, back face
    footer  : reveal CTA (block primary lg with SPACE stamp) OR 4-up
              answer grid coloured per rating semantic

  Glyph derivation: ASCII initials from the deck name (≤2 chars), fall
  back to two CJK chars when the name is non-Latin. The 36×36 mono box
  matches the design canvas without depending on a deck emoji that
  the backend doesn't ship.
-->
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
    import CardFace from "$lib/components/CardFace.svelte";
    import { Btn, Caption } from "$lib/components/ui";
    import {
        SketchArrow,
        SketchOwl,
        SketchPlus,
    } from "$lib/components/sketch";

    const OFFLINE_CARD_CSS = `.card{font-family:var(--font-cjk,"Klee One","LXGW WenKai TC",serif);font-size:3rem;text-align:center;line-height:1.15;letter-spacing:-0.02em;color:var(--ink,inherit);}`;

    let deckIdParam = $derived($page.params.deckId ?? "");
    let deckName = $state("…");

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

    // Phase 20-A: per-card tag override — see git history for full design.
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

    // Two-character mono glyph for the header. Take ASCII initials when
    // the deck name has them ("Japanese N2" → "JN"), otherwise fall back
    // to the first two characters of the raw name so CJK / emoji decks
    // still get a stamped marker.
    let glyph = $derived<string>(
        (() => {
            const name = (deckName ?? "").trim();
            if (!name) return "··";
            const asciiInitials = name
                .split(/[^A-Za-z0-9]+/)
                .filter(Boolean)
                .map((tok) => tok[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();
            if (asciiInitials.length >= 1) return asciiInitials;
            return name.slice(0, 2);
        })(),
    );

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
<svelte:head><title>Studying {deckName} — Ferdinand</title></svelte:head>

<div class="sketch-skin grain stage" data-testid="study-root">
    <header class="study-head">
        <div class="head-deck">
            <a href="/" class="back-arrow" aria-label="Back to decks" data-testid="study-back">
                <span class="back-arrow-flip" aria-hidden="true"><SketchArrow size={20} /></span>
            </a>
            <div class="glyph mono" aria-hidden="true">{glyph}</div>
            <div class="deck-meta">
                <Caption>session · <span data-testid="study-deck-name">{deckName}</span></Caption>
                <div class="card-count mono">card {position} of {total}</div>
            </div>
        </div>

        <div class="head-progress">
            <div class="progress-meta">
                <Caption>progress</Caption>
                {#if mode === "live" && counts}
                    <span class="counts mono" data-testid="study-counts">
                        <span class="c-new" class:zero={counts.new === 0}>{counts.new} new</span>
                        <span class="dot">·</span>
                        <span class="c-learn" class:zero={counts.learning === 0}>{counts.learning} learn</span>
                        <span class="dot">·</span>
                        <span class="c-review" class:zero={counts.review === 0}>{counts.review} review</span>
                    </span>
                {:else if mode === "offline"}
                    <span class="counts mono">offline · cached preview</span>
                {/if}
            </div>
            <div class="qbar" aria-hidden="true">
                <div class="qbar-fill" style:width="{progressPct}%"></div>
            </div>
        </div>

        <div class="head-actions">
            <button class="icon-btn" type="button" aria-label="Edit current card" title="Edit · E">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
            </button>
            <button class="icon-btn" type="button" aria-label="Suspend" title="Suspend · !">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
            </button>
        </div>
    </header>

    {#if lastError}
        <div class="error-banner mono" role="alert" data-testid="study-error">
            // error · {lastError}
        </div>
    {/if}

    <main class="content">
        {#if done}
            <div class="empty" data-testid="study-empty">
                <div class="empty-owl"><SketchOwl size={88} /></div>
                <h2 class="empty-title hand">all caught up.</h2>
                <p class="empty-sub mono">no more cards in <span data-testid="study-empty-deck">{deckName}</span> today</p>
                <Btn href="/" kind="outline" size="md">back to decks</Btn>
            </div>
        {:else}
            <article class="card-shell">
                <div class="card-stack-shadow" aria-hidden="true"></div>
                <div class="card-paper">
                    {#if mode === "live" && currentCard}
                        {#key currentCard.note_id}
                            <section class="tag-pane" aria-label="Edit tags">
                                <div class="tag-edit" data-testid="tag-edit">
                                    {#each currentCard.tags as t (t)}
                                        <button
                                            type="button"
                                            class="tag-chip"
                                            disabled={isMutatingTags}
                                            onclick={() => removeTag(t)}
                                            aria-label="Remove tag {t}"
                                        >#{t}<span class="x" aria-hidden="true">×</span></button>
                                    {/each}
                                    {#if isAddingTag}
                                        <input
                                            bind:this={tagInput}
                                            bind:value={newTagDraft}
                                            class="tag-input mono"
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
                                            class="tag-add"
                                            disabled={isMutatingTags}
                                            onclick={startAddTag}
                                            data-testid="tag-add-btn"
                                        ><SketchPlus size={10} /> add tag</button>
                                    {/if}
                                </div>
                                {#if tagError}
                                    <div class="tag-error mono" role="alert" data-testid="tag-error">
                                        // error · {tagError}
                                    </div>
                                {/if}
                            </section>
                        {/key}
                    {/if}

                    <div class="card-front" data-testid="card-front-wrap">
                        <CardFace html={frontHtml} css={cardCss} testid="card-face-front" />
                    </div>

                    {#if showAnswer}
                        <div class="dashed-divider" aria-hidden="true">
                            <span class="divider-stamp mono">answer</span>
                        </div>
                        <div class="card-back" data-testid="card-back-wrap">
                            <CardFace html={backHtml} css={cardCss} testid="card-face-back" />
                        </div>
                    {:else}
                        <div class="flip-hint mono">press space · click to flip</div>
                    {/if}
                </div>
            </article>
        {/if}
    </main>

    <footer class="study-foot">
        {#if done}
            <!-- empty state owns its own back btn -->
        {:else if !showAnswer}
            <div class="reveal-row">
                <Btn
                    block
                    size="lg"
                    kind="primary"
                    onclick={reveal}
                    disabled={mode === "live" && !currentCard}
                    data-testid="reveal-btn"
                >
                    show answer
                    {#snippet trailing()}<span class="hotkey-stamp">SPACE</span>{/snippet}
                </Btn>
            </div>
        {:else}
            <div class="answers" data-testid="answers">
                <button class="ans ans-again" type="button" onclick={() => answer(1)} disabled={sending} data-testid="ans-again">
                    <span class="ans-row">
                        <span class="ans-label">again</span>
                        <span class="ans-key mono">1</span>
                    </span>
                    <span class="ans-hint mono">&lt; 1 min</span>
                </button>
                <button class="ans ans-hard" type="button" onclick={() => answer(2)} disabled={sending} data-testid="ans-hard">
                    <span class="ans-row">
                        <span class="ans-label">hard</span>
                        <span class="ans-key mono">2</span>
                    </span>
                    <span class="ans-hint mono">6 min</span>
                </button>
                <button class="ans ans-good" type="button" onclick={() => answer(3)} disabled={sending} data-testid="ans-good">
                    <span class="ans-row">
                        <span class="ans-label">good</span>
                        <span class="ans-key mono">3</span>
                    </span>
                    <span class="ans-hint mono">10 min</span>
                </button>
                <button class="ans ans-easy" type="button" onclick={() => answer(4)} disabled={sending} data-testid="ans-easy">
                    <span class="ans-row">
                        <span class="ans-label">easy</span>
                        <span class="ans-key mono">4</span>
                    </span>
                    <span class="ans-hint mono">4 d</span>
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
        color: var(--ink);
        font-family: var(--font-sans);
        overscroll-behavior-y: none;
    }

    /* ============ HEADER ============ */
    .study-head {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto;
        align-items: center;
        gap: var(--space-9);
        padding: var(--space-8) var(--space-10) var(--space-7);
        border-bottom: var(--border-w) solid var(--ink);
    }

    .head-deck {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        min-width: 0;
    }
    .back-arrow {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        color: var(--ink-soft);
        border-radius: var(--radius);
        transition: background 120ms ease, color 120ms ease;
    }
    .back-arrow:hover {
        background: var(--bg-soft);
        color: var(--ink);
    }
    .back-arrow-flip {
        display: inline-flex;
        transform: scaleX(-1);
    }
    .glyph {
        flex: 0 0 36px;
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        border: var(--border-w-thin) solid var(--ink);
        border-radius: var(--radius);
        background: var(--paper);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        line-height: 1;
        color: var(--ink);
    }
    .deck-meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .card-count {
        font-size: 13px;
        font-weight: 500;
        color: var(--ink);
    }

    .head-progress {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        min-width: 0;
    }
    .progress-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--space-4);
    }
    .counts {
        font-size: 11px;
        color: var(--ink-mute);
        white-space: nowrap;
    }
    .counts .dot {
        margin: 0 4px;
        color: var(--rule);
    }
    .counts .c-new {
        color: var(--due);
    }
    .counts .c-learn {
        color: var(--warn);
    }
    .counts .c-review {
        color: var(--accent);
    }
    .counts .zero {
        opacity: 0.4;
    }
    .qbar {
        position: relative;
        height: 6px;
        background: var(--bg-soft);
        border: var(--border-w-thin) solid var(--ink);
        border-radius: 999px;
        overflow: hidden;
    }
    .qbar-fill {
        position: absolute;
        inset: 0 auto 0 0;
        background: var(--accent);
        transition: width 320ms ease;
    }

    .head-actions {
        display: inline-flex;
        gap: var(--space-1);
    }
    .icon-btn {
        width: 32px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        color: var(--ink-soft);
        border: none;
        border-radius: var(--radius);
        cursor: pointer;
        transition: background 120ms ease, color 120ms ease;
    }
    .icon-btn:hover {
        background: var(--bg-soft);
        color: var(--ink);
    }

    /* ============ ERROR BANNER ============ */
    .error-banner {
        margin: var(--space-3) var(--space-10) 0;
        padding: var(--space-2) var(--space-4);
        border: 1px dashed var(--due);
        border-radius: var(--radius);
        color: var(--due);
        font-size: 11px;
        letter-spacing: 0.06em;
        text-align: center;
    }

    /* ============ CONTENT / CARD ============ */
    .content {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--space-10) var(--space-10);
    }
    .card-shell {
        position: relative;
        width: 100%;
        max-width: 720px;
    }
    .card-stack-shadow {
        position: absolute;
        inset: 0;
        transform: translate(8px, 8px) rotate(-0.4deg);
        background: var(--bg-soft);
        border: var(--border-w) solid var(--ink);
        border-radius: var(--radius-md);
    }
    .card-paper {
        position: relative;
        background: var(--paper);
        border: var(--border-w) solid var(--ink);
        border-radius: var(--radius-md);
        padding: var(--space-12) var(--space-12) var(--space-10);
        min-height: 380px;
        display: flex;
        flex-direction: column;
        gap: var(--space-8);
    }

    .card-front {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 160px;
    }
    .card-back {
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--font-mono);
    }

    .dashed-divider {
        position: relative;
        height: 1px;
        margin: var(--space-2) auto;
        width: 60%;
        border-top: 1px dashed var(--rule);
        text-align: center;
    }
    .divider-stamp {
        position: absolute;
        top: -8px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--paper);
        padding: 0 var(--space-3);
        font-size: 10px;
        letter-spacing: 0.16em;
        color: var(--ink-mute);
        text-transform: uppercase;
    }

    .flip-hint {
        text-align: center;
        font-size: 11px;
        letter-spacing: 0.16em;
        color: var(--ink-mute);
        text-transform: uppercase;
    }

    /* ============ TAG PANE ============ */
    .tag-pane {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }
    .tag-edit {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        align-items: center;
        justify-content: flex-start;
    }
    .tag-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.04em;
        padding: 3px 9px;
        border: var(--border-w-thin) solid var(--ink-soft);
        border-radius: var(--radius-pill);
        color: var(--ink-soft);
        background: var(--bg-soft);
        cursor: pointer;
        transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
    }
    .tag-chip:hover {
        color: var(--due);
        border-color: var(--due);
    }
    .tag-chip:disabled {
        opacity: 0.5;
        cursor: progress;
    }
    .tag-chip .x {
        font-size: 13px;
        line-height: 1;
        opacity: 0.7;
    }
    .tag-input {
        font-family: var(--font-mono);
        font-size: 11px;
        padding: 3px 9px;
        border: var(--border-w-thin) solid var(--accent);
        border-radius: var(--radius-pill);
        background: transparent;
        color: var(--ink);
        outline: none;
        min-width: 96px;
    }
    .tag-add {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.04em;
        text-transform: lowercase;
        padding: 3px 9px;
        border: 1px dashed var(--rule);
        border-radius: var(--radius-pill);
        color: var(--ink-mute);
        background: transparent;
        cursor: pointer;
        transition: color 120ms ease, border-color 120ms ease;
    }
    .tag-add:hover {
        color: var(--accent);
        border-color: var(--accent);
    }
    .tag-add:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .tag-error {
        font-size: 11px;
        color: var(--due);
    }

    /* ============ EMPTY STATE ============ */
    .empty {
        max-width: 480px;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-5);
    }
    .empty-owl {
        color: var(--ink-soft);
    }
    .empty-title {
        font-size: 44px;
        line-height: 1;
        color: var(--ink);
        margin: 0;
    }
    .empty-sub {
        font-size: 12px;
        letter-spacing: 0.06em;
        color: var(--ink-mute);
        text-transform: lowercase;
        margin: 0;
    }

    /* ============ FOOTER (REVEAL + ANSWERS) ============ */
    .study-foot {
        padding: var(--space-7) var(--space-10) var(--space-10);
        border-top: 1px dashed var(--rule);
    }
    .reveal-row {
        display: flex;
        justify-content: center;
        max-width: 720px;
        margin: 0 auto;
    }
    .hotkey-stamp {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        opacity: 0.78;
        margin-left: 6px;
    }

    .answers {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--space-6);
        max-width: 720px;
        margin: 0 auto;
    }
    .ans {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: var(--space-7) var(--space-6);
        border: var(--border-w) solid var(--ink);
        border-radius: var(--radius-md);
        background: var(--paper);
        color: var(--ink);
        box-shadow: var(--shadow-stamp-md);
        cursor: pointer;
        text-align: left;
        font-family: var(--font-mono);
        transition: transform 100ms ease, box-shadow 100ms ease;
    }
    .ans:hover {
        transform: translate(-1px, -1px);
        box-shadow: 4px 4px 0 var(--ink);
    }
    .ans:active {
        transform: translate(2px, 2px);
        box-shadow: none;
    }
    .ans:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 3px;
    }
    .ans:disabled {
        opacity: 0.55;
        cursor: not-allowed;
        transform: none;
        box-shadow: var(--shadow-stamp-sm);
    }
    .ans-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--space-3);
    }
    .ans-label {
        font-size: 14px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }
    .ans-key {
        font-size: 10px;
        padding: 2px 7px;
        border: 1px solid var(--rule);
        border-radius: var(--radius);
        color: var(--ink-mute);
        line-height: 1;
    }
    .ans-hint {
        font-size: 11px;
        letter-spacing: 0.04em;
        color: var(--ink-soft);
    }
    .ans-again .ans-label { color: var(--due); }
    .ans-hard  .ans-label { color: var(--warn); }
    .ans-good  .ans-label { color: var(--accent); }
    .ans-easy  .ans-label { color: var(--ink-soft); }

    /* ============ MOBILE (≤640px) ============ */
    @media (max-width: 640px) {
        .study-head {
            grid-template-columns: auto 1fr auto;
            grid-template-rows: auto auto;
            gap: var(--space-3) var(--space-4);
            padding: var(--space-6) var(--space-5) var(--space-4);
        }
        .head-deck {
            grid-column: 1 / 3;
            gap: var(--space-3);
        }
        .head-actions {
            grid-column: 3 / 4;
            grid-row: 1 / 2;
        }
        .head-progress {
            grid-column: 1 / 4;
        }
        .glyph {
            flex: 0 0 32px;
            width: 32px;
            height: 32px;
            font-size: 10px;
        }
        .card-count {
            font-size: 12px;
        }
        .counts {
            font-size: 10px;
        }
        .qbar {
            height: 5px;
        }

        .content {
            padding: var(--space-7) var(--space-5);
        }
        .card-paper {
            padding: var(--space-9) var(--space-7) var(--space-7);
            min-height: 280px;
            gap: var(--space-6);
        }
        .card-stack-shadow {
            transform: translate(5px, 5px) rotate(-0.5deg);
        }
        .empty-title {
            font-size: 36px;
        }

        .study-foot {
            padding: var(--space-5) var(--space-5) max(var(--space-7), var(--safe-bottom, 0px));
        }
        .answers {
            grid-template-columns: repeat(2, 1fr);
            gap: var(--space-3);
        }
        .ans {
            padding: var(--space-5) var(--space-4);
        }
    }

    /* Touch (no hover) — hide hotkey hints since there's no keyboard. */
    @media (hover: none) {
        .ans-key {
            display: none;
        }
        .hotkey-stamp {
            display: none;
        }
        .ans:hover {
            transform: none;
            box-shadow: var(--shadow-stamp-md);
        }
    }
</style>
