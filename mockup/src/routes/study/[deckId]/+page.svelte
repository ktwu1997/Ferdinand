<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/stores";
    import { decks, cards as fakeCards } from "$lib/data";
    import { fetchDecks, fetchCards, type ApiCardSummary } from "$lib/api";
    import Kbd from "$lib/components/Kbd.svelte";

    let deckIdParam = $derived($page.params.deckId);
    let deckName = $state("…");
    let deckEmoji = $state("📚");
    let liveCards = $state<ApiCardSummary[] | null>(null);
    let idx = $state(0);
    let showAnswer = $state(false);

    onMount(async () => {
        try {
            const list = await fetchDecks();
            const flat = flattenTree(list.decks);
            const hit =
                flat.find((d) => String(d.id) === deckIdParam) ??
                flat.find((d) => slug(d.name) === deckIdParam) ??
                flat.find((d) => d.name.toLowerCase().includes(deckIdParam.toLowerCase())) ??
                flat[0];
            if (hit) {
                deckName = hit.name;
                deckEmoji = "📚";
                const res = await fetchCards(`deck:"${hit.name.replace(/"/g, "\\\"")}"`, 50);
                liveCards = res.cards;
            }
        } catch {
            // fallback path: find fake deck
            const fd = decks.find((d) => d.id === deckIdParam) ?? decks[0];
            deckName = fd.name;
            deckEmoji = fd.emoji;
        }
    });

    function flattenTree(tree: { id: number; name: string; level: number; children: any[] }[]): Array<{ id: number; name: string }> {
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

    let fallbackCards = $derived(fakeCards.filter((c) => c.deckId === deckIdParam));
    let deckCards = $derived(
        liveCards
            ? liveCards.map((c) => ({ front: stripHtml(c.front_html), back: stripHtml(c.back_html) }))
            : fallbackCards.map((c) => ({ front: c.front, back: c.back })),
    );
    let card = $derived(deckCards[idx] ?? { front: "—", back: "" });
    let progressPct = $derived(
        deckCards.length > 0 ? ((idx + (showAnswer ? 0.5 : 0)) / deckCards.length) * 100 : 0,
    );

    function stripHtml(html: string): string {
        // Simple, safe-for-prototype: strip tags, trim, collapse whitespace.
        // Real reviewer will render HTML with the notetype's CSS.
        return html
            .replace(/<hr[^>]*>/gi, "\n\n")
            .replace(/<br\s*\/?>(\r?\n)?/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    function reveal() {
        showAnswer = true;
    }
    function answer(_grade: 1 | 2 | 3 | 4) {
        showAnswer = false;
        idx = Math.min(idx + 1, deckCards.length - 1);
    }
    function onKey(e: KeyboardEvent) {
        if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
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
        <div class="counter">
            <span class="i">{idx + 1}</span>
            <span class="slash">/</span>
            <span class="total">{deckCards.length}</span>
        </div>
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

    <div class="content">
        <div class="card-stack">
            <article class="card-face front">
                <div class="front-text">{card.front}</div>
            </article>
            {#if showAnswer}
                <div class="divider"><span>ANSWER</span></div>
                <article class="card-face back">
                    <div class="back-text">{card.back}</div>
                </article>
            {/if}
        </div>
    </div>

    <footer>
        {#if !showAnswer}
            <div class="reveal">
                <button class="reveal-btn" onclick={reveal}>
                    Show answer
                    <Kbd>Space</Kbd>
                </button>
            </div>
        {:else}
            <div class="answers">
                <button class="ans ans-again" onclick={() => answer(1)}>
                    <span class="ans-label">Again</span>
                    <span class="ans-hint">&lt; 1 min</span>
                    <span class="ans-key"><Kbd>1</Kbd></span>
                </button>
                <button class="ans ans-hard" onclick={() => answer(2)}>
                    <span class="ans-label">Hard</span>
                    <span class="ans-hint">6 min</span>
                    <span class="ans-key"><Kbd>2</Kbd></span>
                </button>
                <button class="ans ans-good" onclick={() => answer(3)}>
                    <span class="ans-label">Good</span>
                    <span class="ans-hint">10 min</span>
                    <span class="ans-key"><Kbd>3</Kbd></span>
                </button>
                <button class="ans ans-easy" onclick={() => answer(4)}>
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
        display: flex;
        flex-direction: column;
        background: var(--bg);
    }

    header {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        padding: var(--space-5) var(--space-8);
        gap: var(--space-4);
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
        max-width: 760px;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--space-8);
    }
    .card-face {
        text-align: center;
    }
    .front-text {
        font-family: var(--font-serif);
        font-size: var(--text-hero);
        line-height: 1.15;
        letter-spacing: -0.02em;
        color: var(--text);
        white-space: pre-wrap;
    }
    .back-text {
        font-family: var(--font-serif);
        font-size: var(--text-2xl);
        line-height: 1.4;
        color: var(--text);
        max-width: 640px;
        margin: 0 auto;
        white-space: pre-wrap;
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
        padding: 0 var(--space-4);
        font-size: 0.65rem;
        letter-spacing: 0.2em;
        color: var(--text-subtle);
        font-weight: 500;
    }

    footer {
        padding: var(--space-6) var(--space-8) var(--space-10);
        display: flex;
        justify-content: center;
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
        font-size: var(--text-base);
        font-weight: 500;
        color: var(--text);
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        transition: border-color var(--duration-fast) var(--ease), background var(--duration-fast) var(--ease);
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
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        color: var(--text);
        position: relative;
        transition: border-color var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease),
            transform var(--duration-fast) var(--ease);
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
</style>
