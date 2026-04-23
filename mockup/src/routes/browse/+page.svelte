<script lang="ts">
    import { onMount } from "svelte";
    import { cards as fakeCards, decks, savedSearches, tags } from "$lib/data";
    import Kbd from "$lib/components/Kbd.svelte";
    import { fetchCards, type ApiCardSummary } from "$lib/api";

    let liveCards = $state<ApiCardSummary[] | null>(null);
    let query = $state("");
    let openSection = $state<Record<string, boolean>>({ decks: true, tags: true, saved: true });
    let selectedIdx = $state(0);

    onMount(async () => {
        try {
            const res = await fetchCards("", 100);
            liveCards = res.cards;
        } catch {}
    });

    // Normalized shape used by the table + editor, either from live or fake data.
    type Row = {
        id: string;
        front: string;
        back: string;
        tags: string[];
        due: string;
        state: string;
        deckName: string;
        deckEmoji: string;
    };

    function stripHtml(html: string): string {
        return html
            .replace(/<hr[^>]*>/gi, "  ·  ")
            .replace(/<br\s*\/?>(\r?\n)?/gi, " ")
            .replace(/<[^>]+>/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    let rows: Row[] = $derived(
        liveCards
            ? liveCards.map((c) => ({
                  id: String(c.id),
                  front: stripHtml(c.front_html),
                  back: stripHtml(c.back_html),
                  tags: c.tags,
                  due: "—",
                  state: c.state,
                  deckName: c.deck_name,
                  deckEmoji: "📚",
              }))
            : fakeCards.map((c) => ({
                  id: c.id,
                  front: c.front.split("\n")[0],
                  back: c.back,
                  tags: c.tags,
                  due: c.due,
                  state: c.state,
                  deckName: decks.find((d) => d.id === c.deckId)?.name ?? "",
                  deckEmoji: decks.find((d) => d.id === c.deckId)?.emoji ?? "📚",
              })),
    );

    let filtered = $derived(
        rows.filter(
            (r) =>
                query === "" ||
                r.front.toLowerCase().includes(query.toLowerCase()) ||
                r.back.toLowerCase().includes(query.toLowerCase()),
        ),
    );
    let selected = $derived(filtered[selectedIdx] ?? filtered[0] ?? rows[0]);

    function toggle(section: string) {
        openSection[section] = !openSection[section];
    }
    function selectRow(i: number) {
        selectedIdx = i;
    }
</script>

<svelte:head><title>Browse — Anki</title></svelte:head>

<div class="browse">
    <!-- inner sidebar (tree) -->
    <div class="tree">
        <div class="tree-head">
            <span class="label">Library</span>
            <button class="plus" aria-label="New"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg></button>
        </div>

        <div class="section">
            <button class="section-title" onclick={() => toggle("decks")}>
                <svg class="chev" class:open={openSection.decks} viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6" /></svg>
                Decks
            </button>
            {#if openSection.decks}
                <div class="section-items">
                    {#each decks as d (d.id)}
                        <button class="item">
                            <span class="emoji">{d.emoji}</span>
                            <span>{d.name}</span>
                            <span class="count">{d.totalCards}</span>
                        </button>
                    {/each}
                </div>
            {/if}
        </div>

        <div class="section">
            <button class="section-title" onclick={() => toggle("tags")}>
                <svg class="chev" class:open={openSection.tags} viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6" /></svg>
                Tags
            </button>
            {#if openSection.tags}
                <div class="section-items">
                    {#each tags.slice(0, 8) as t (t)}
                        <button class="item tag-item">
                            <span class="hash">#</span>
                            <span>{t}</span>
                        </button>
                    {/each}
                </div>
            {/if}
        </div>

        <div class="section">
            <button class="section-title" onclick={() => toggle("saved")}>
                <svg class="chev" class:open={openSection.saved} viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6" /></svg>
                Saved searches
            </button>
            {#if openSection.saved}
                <div class="section-items">
                    {#each savedSearches as s (s.id)}
                        <button class="item saved">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                            <span>{s.name}</span>
                        </button>
                    {/each}
                </div>
            {/if}
        </div>
    </div>

    <!-- results table -->
    <div class="results">
        <div class="toolbar">
            <div class="search">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                <input
                    type="search"
                    bind:value={query}
                    placeholder="deck:N2  tag:leech  added:1 …"
                />
                <Kbd>/</Kbd>
            </div>
            <div class="filters">
                <button class="pill active">All</button>
                <button class="pill">New</button>
                <button class="pill">Learning</button>
                <button class="pill">Review</button>
                <button class="pill">Suspended</button>
            </div>
            <div class="count-tag">{filtered.length} of {rows.length}</div>
        </div>

        <div class="table">
            <div class="thead">
                <div class="th front">Front</div>
                <div class="th deck">Deck</div>
                <div class="th tags-col">Tags</div>
                <div class="th due">Due</div>
                <div class="th state">State</div>
            </div>
            <div class="tbody">
                {#each filtered as r, i (r.id)}
                    <button
                        class="tr"
                        class:selected={selected?.id === r.id}
                        onclick={() => selectRow(i)}
                    >
                        <div class="td front">
                            <div class="front-line">{r.front}</div>
                        </div>
                        <div class="td deck">
                            <span class="deck-emoji">{r.deckEmoji}</span>
                            <span>{r.deckName}</span>
                        </div>
                        <div class="td tags-col">
                            {#each r.tags as t (t)}
                                <span class="tag">#{t}</span>
                            {/each}
                        </div>
                        <div class="td due">{r.due}</div>
                        <div class="td state">
                            <span class="state-chip state-{r.state}">{r.state}</span>
                        </div>
                    </button>
                {/each}
            </div>
        </div>
    </div>

    <!-- editor panel -->
    <aside class="editor">
        <div class="editor-head">
            <div class="eyebrow">Note · {selected?.deckEmoji} {selected?.deckName}</div>
            <div class="head-actions">
                <button class="icon-btn" aria-label="Close"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
            </div>
        </div>

        <div class="field">
            <label>Front</label>
            <div class="field-value" contenteditable="true">{selected?.front ?? ""}</div>
        </div>
        <div class="field">
            <label>Back</label>
            <div class="field-value" contenteditable="true">{selected?.back ?? ""}</div>
        </div>

        <div class="meta">
            <div class="meta-row">
                <span class="meta-key">Deck</span>
                <span class="pill-sel">{selected?.deckEmoji} {selected?.deckName}</span>
            </div>
            <div class="meta-row">
                <span class="meta-key">Tags</span>
                <div class="tag-edit">
                    {#each selected?.tags ?? [] as t (t)}
                        <span class="tag">#{t}</span>
                    {/each}
                    <button class="add-tag">+ Add</button>
                </div>
            </div>
            <div class="meta-row">
                <span class="meta-key">State</span>
                <span class="meta-val">{selected?.state ?? "—"}</span>
            </div>
            <div class="meta-row">
                <span class="meta-key">Due</span>
                <span class="meta-val">{selected?.due ?? "—"}</span>
            </div>
        </div>

        <div class="editor-footer">
            <button class="ghost-btn">Preview</button>
            <button class="ghost-btn danger">Delete</button>
        </div>
    </aside>
</div>

<style>
    .browse {
        display: grid;
        grid-template-columns: 220px minmax(0, 1fr) 360px;
        height: 100vh;
        overflow: hidden;
    }

    /* Tree */
    .tree {
        border-right: 1px solid var(--border);
        padding: var(--space-5) var(--space-3);
        overflow-y: auto;
        background: var(--bg-subtle);
    }
    .tree-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 var(--space-2);
        margin-bottom: var(--space-3);
    }
    .tree-head .label {
        font-size: 0.65rem;
        font-weight: 500;
        color: var(--text-subtle);
        letter-spacing: 0.1em;
        text-transform: uppercase;
    }
    .plus {
        width: 20px;
        height: 20px;
        color: var(--text-subtle);
        border-radius: var(--radius-sm);
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }
    .plus:hover {
        background: var(--bg-hover);
        color: var(--text);
    }

    .section {
        margin-bottom: var(--space-3);
    }
    .section-title {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        padding: 0.3rem var(--space-2);
        font-size: var(--text-sm);
        font-weight: 500;
        color: var(--text-muted);
        width: 100%;
        text-align: left;
    }
    .section-title:hover {
        color: var(--text);
    }
    .chev {
        transition: transform var(--duration-fast) var(--ease);
    }
    .chev.open {
        transform: rotate(90deg);
    }

    .section-items {
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding-left: var(--space-4);
    }

    .item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 0.3rem var(--space-2);
        font-size: var(--text-sm);
        color: var(--text-muted);
        border-radius: var(--radius-sm);
        text-align: left;
        width: 100%;
    }
    .item:hover {
        background: var(--bg-hover);
        color: var(--text);
    }
    .emoji {
        font-size: 0.9rem;
    }
    .count {
        margin-left: auto;
        color: var(--text-subtle);
        font-size: 0.7rem;
        font-variant-numeric: tabular-nums;
    }
    .tag-item .hash {
        color: var(--text-subtle);
        font-family: var(--font-mono);
    }
    .saved svg {
        color: var(--text-subtle);
    }

    /* Results */
    .results {
        display: flex;
        flex-direction: column;
        min-width: 0;
        border-right: 1px solid var(--border);
    }
    .toolbar {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-4) var(--space-6);
        border-bottom: 1px solid var(--border);
    }
    .search {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex: 1;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        color: var(--text-subtle);
        max-width: 480px;
    }
    .search:focus-within {
        border-color: var(--accent);
    }
    .search input {
        background: none;
        border: 0;
        outline: 0;
        flex: 1;
        font-size: var(--text-sm);
        color: var(--text);
        font-family: var(--font-mono);
    }
    .search input::placeholder {
        color: var(--text-subtle);
        font-family: var(--font-mono);
    }

    .filters {
        display: flex;
        gap: 2px;
        padding: 2px;
        background: var(--bg-subtle);
        border-radius: var(--radius-md);
    }
    .pill {
        padding: 0.3rem 0.75rem;
        font-size: var(--text-xs);
        color: var(--text-muted);
        border-radius: var(--radius-sm);
        font-weight: 500;
    }
    .pill.active {
        background: var(--bg-elevated);
        color: var(--text);
        box-shadow: var(--shadow-sm);
    }
    .pill:hover:not(.active) {
        color: var(--text);
    }
    .count-tag {
        font-size: var(--text-xs);
        color: var(--text-subtle);
        font-variant-numeric: tabular-nums;
        margin-left: auto;
    }

    .table {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
    }
    .thead,
    .tr {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1.4fr) 70px 90px;
        align-items: center;
        gap: var(--space-3);
        padding: 0 var(--space-6);
    }
    .thead {
        height: 32px;
        font-size: 0.65rem;
        font-weight: 500;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--text-subtle);
        border-bottom: 1px solid var(--border);
        position: sticky;
        top: 0;
        background: var(--bg);
        z-index: 1;
    }
    .th {
        text-align: left;
    }
    .th.due,
    .th.state {
        text-align: right;
    }
    .tbody {
        display: flex;
        flex-direction: column;
    }
    .tr {
        height: 46px;
        border-bottom: 1px solid var(--border);
        font-size: var(--text-sm);
        color: var(--text);
        text-align: left;
        background: transparent;
        cursor: pointer;
        transition: background var(--duration-fast) var(--ease);
    }
    .tr:hover {
        background: var(--bg-hover);
    }
    .tr.selected {
        background: var(--accent-bg);
    }
    .td {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }
    .front-line {
        font-family: var(--font-serif);
        font-size: 0.95rem;
    }
    .td.deck {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--text-muted);
    }
    .deck-emoji {
        font-size: 0.9rem;
    }
    .td.tags-col {
        color: var(--text-muted);
        display: flex;
        gap: var(--space-2);
    }
    .tag {
        font-family: var(--font-mono);
        font-size: 0.7rem;
        color: var(--text-subtle);
        background: var(--bg-subtle);
        padding: 1px 6px;
        border-radius: var(--radius-sm);
    }
    .td.due,
    .td.state {
        text-align: right;
        font-variant-numeric: tabular-nums;
        color: var(--text-muted);
    }
    .state-chip {
        font-size: 0.7rem;
        padding: 2px 8px;
        border-radius: 999px;
        text-transform: capitalize;
        font-weight: 500;
    }
    .state-new {
        background: color-mix(in oklch, var(--info) 12%, transparent);
        color: var(--info);
    }
    .state-learning {
        background: color-mix(in oklch, var(--warning) 18%, transparent);
        color: var(--warning);
    }
    .state-review {
        background: color-mix(in oklch, var(--success) 15%, transparent);
        color: var(--success);
    }
    .state-suspended {
        background: var(--bg-subtle);
        color: var(--text-subtle);
    }

    /* Editor */
    .editor {
        padding: var(--space-5) var(--space-6);
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
        background: var(--bg);
    }
    .editor-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .eyebrow {
        font-size: 0.65rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--text-subtle);
        font-weight: 500;
    }
    .icon-btn {
        width: 26px;
        height: 26px;
        color: var(--text-subtle);
        border-radius: var(--radius-sm);
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }
    .icon-btn:hover {
        background: var(--bg-hover);
        color: var(--text);
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }
    .field label {
        font-size: 0.7rem;
        letter-spacing: 0.08em;
        color: var(--text-subtle);
        text-transform: uppercase;
        font-weight: 500;
    }
    .field-value {
        min-height: 44px;
        padding: var(--space-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        font-family: var(--font-serif);
        font-size: var(--text-base);
        color: var(--text);
        white-space: pre-wrap;
        outline: none;
    }
    .field-value:focus {
        border-color: var(--accent);
    }

    .meta {
        padding-top: var(--space-3);
        border-top: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }
    .meta-row {
        display: grid;
        grid-template-columns: 80px 1fr;
        align-items: center;
        gap: var(--space-3);
        font-size: var(--text-sm);
    }
    .meta-key {
        color: var(--text-subtle);
        font-size: var(--text-xs);
    }
    .meta-val {
        color: var(--text);
        font-variant-numeric: tabular-nums;
    }
    .pill-sel {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        padding: 3px 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-full);
        width: fit-content;
        font-size: var(--text-xs);
        color: var(--text);
    }
    .tag-edit {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }
    .add-tag {
        font-size: var(--text-xs);
        color: var(--text-subtle);
        padding: 1px 6px;
        border: 1px dashed var(--border);
        border-radius: var(--radius-sm);
    }
    .add-tag:hover {
        color: var(--accent);
        border-color: var(--accent);
    }

    .editor-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
        padding-top: var(--space-3);
        border-top: 1px solid var(--border);
    }
    .ghost-btn {
        padding: 0.4rem 0.75rem;
        font-size: var(--text-sm);
        color: var(--text-muted);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
    }
    .ghost-btn:hover {
        color: var(--text);
        background: var(--bg-hover);
    }
    .ghost-btn.danger:hover {
        color: var(--danger);
        border-color: var(--danger);
    }
</style>
