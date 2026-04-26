<script lang="ts">
    import { onMount, tick } from "svelte";
    import { cards as fakeCards, decks as fakeDecks, savedSearches, tags as fakeTags } from "$lib/data";
    import Kbd from "$lib/components/Kbd.svelte";
    import {
        fetchCards,
        fetchDecks,
        fetchDeckConfigs,
        fetchTags,
        patchDeckName,
        patchDeckPreset,
        postCardSuspend,
        type ApiCardSummary,
        type ApiDeckConfigListItem,
        type ApiDeckSummary,
    } from "$lib/api";
    import BrowseRow from "$lib/browse/BrowseRow.svelte";
    import BrowseRowSkeleton from "$lib/browse/BrowseRowSkeleton.svelte";
    import { stripHtmlToSnippet } from "$lib/browse/media";

    let liveCards = $state<ApiCardSummary[] | null>(null);
    let liveDecks = $state<ApiDeckSummary[] | null>(null);
    let liveTags = $state<string[] | null>(null);
    let loading = $state(true);
    let query = $state("");
    let openSection = $state<Record<string, boolean>>({ decks: true, tags: true, saved: true });
    let selectedIdx = $state(0);

    // Phase 11-C: server pagination. PAGE_SIZE chosen to match the existing
    // "100 rows in" feel without being wasteful on a phone-width screen;
    // `liveTotal` is the unfiltered match count from /api/cards so the
    // toolbar can render "X-Y of Z" without an extra request.
    const PAGE_SIZE = 50;
    let pageOffset = $state(0);
    let liveTotal = $state<number | null>(null);

    // Phase 12-A: server-side search wiring. Typing in the toolbar input
    // updates `query` synchronously so the local-filter $derived narrows
    // immediately (zero-latency UX), and a debounced effect fires a
    // server fetch shortly after the user stops typing. The 200 ms window
    // is short enough that finishing a word feels live, long enough that
    // mashing keys doesn't shower the server with requests. Server
    // failures fall back silently — local `filtered` continues to
    // substring-match on whatever liveCards contains.
    const SEARCH_DEBOUNCE_MS = 200;
    let initialLoadDone = $state(false);
    // Plain JS — bookkeeping for stale-response discard and dedup. Not
    // $state because nothing reactive needs to read these.
    let searchSeq = 0;
    let lastFetchedQ = "";

    // Phase 9-P: editor-panel mutations against anki_server. Stateful page,
    // so errors surface as an explicit banner (per 9-N3 design_pattern_proven)
    // — silent fallback would drop the user's edit without acknowledgement.
    let errorBanner = $state<string | null>(null);
    let isEditingDeck = $state(false);
    let deckNameDraft = $state("");
    let isMutatingDeck = $state(false);
    let isMutatingSuspend = $state(false);
    let deckInput = $state<HTMLInputElement | null>(null);

    // Phase 9-S: tree-sidebar inline rename. Per-row edit state (only one row
    // at a time). Available only when liveDecks is loaded — fake-data mode
    // refuses rename so we never lie to the user about a successful edit.
    let treeEditingDeckId = $state<number | null>(null);
    let treeDeckDraft = $state("");
    let isMutatingTreeDeck = $state(false);
    let treeDeckInput = $state<HTMLInputElement | null>(null);

    // Phase 11-A: per-deck preset assignment. Presets list is loaded once
    // on mount; the dropdown reflects the selected card's deck preset_id
    // via a $derived lookup against liveDecks. Live mode only — fake-data
    // mode shows an "offline" placeholder so we never lie about persisting.
    let presets = $state<ApiDeckConfigListItem[] | null>(null);
    let isMutatingPreset = $state(false);

    onMount(() => {
        // Cards drive the main `loading` flag (skeleton rows). Decks are
        // supplementary navigation — fire-and-forget so the row list never
        // waits on tree data. Both fall back silently to fake data on
        // failure; editor mutations are gated by liveDecks/liveCards being
        // non-null at call time.
        fetchCards("", PAGE_SIZE, 0)
            .then(
                (res) => {
                    liveCards = res.cards;
                    liveTotal = res.total;
                },
                () => undefined,
            )
            .finally(() => {
                loading = false;
                // Gate the search-wire $effect: it must not re-fire the
                // initial empty-query fetch, and it must not run before
                // the first paint of skeleton/empty rows is committed.
                initialLoadDone = true;
            });
        fetchDecks().then(
            (res) => {
                liveDecks = res.decks.filter((d) => d.id !== 0 && d.level >= 1);
            },
            () => undefined,
        );
        fetchTags().then(
            (res) => {
                liveTags = res.tags;
            },
            () => undefined,
        );
        fetchDeckConfigs().then(
            (res) => {
                presets = res.configs;
            },
            () => undefined,
        );
    });

    // Tree sidebar tags. Live when present, fake otherwise — supplementary
    // nav, so silent-degrade matches 9-S decks-tree pattern (read-only,
    // no edits to lose).
    let sidebarTags = $derived<string[]>(liveTags ?? fakeTags);

    type Row = {
        id: string;
        frontHtml: string;
        backHtml: string;
        frontSnippet: string;
        backSnippet: string;
        tags: string[];
        due: string;
        state: "new" | "learning" | "review" | "suspended" | string;
        deckName: string;
        deckEmoji: string;
        // Phase 11-A: numeric deck id (live mode only). Null in fake-data
        // mode so the preset-change handler can refuse to mutate against
        // synthetic ids.
        deckId: number | null;
    };

    let rows: Row[] = $derived(
        liveCards
            ? liveCards.map((c) => ({
                  id: String(c.id),
                  frontHtml: c.front_html,
                  backHtml: c.back_html,
                  frontSnippet: stripHtmlToSnippet(c.front_html, 140),
                  backSnippet: stripHtmlToSnippet(c.back_html, 280),
                  tags: c.tags,
                  due: "—",
                  state: c.state,
                  deckName: c.deck_name,
                  deckEmoji: "📚",
                  deckId: c.deck_id,
              }))
            : fakeCards.map((c) => ({
                  id: c.id,
                  frontHtml: c.front,
                  backHtml: c.back,
                  frontSnippet: c.front.split("\n")[0],
                  backSnippet: c.back,
                  tags: c.tags,
                  due: c.due,
                  state: c.state,
                  deckName: fakeDecks.find((d) => d.id === c.deckId)?.name ?? "",
                  deckEmoji: fakeDecks.find((d) => d.id === c.deckId)?.emoji ?? "📚",
                  deckId: null,
              })),
    );

    let filtered = $derived(
        rows.filter(
            (r) =>
                query === "" ||
                r.frontSnippet.toLowerCase().includes(query.toLowerCase()) ||
                r.backSnippet.toLowerCase().includes(query.toLowerCase()),
        ),
    );
    let selected = $derived(filtered[selectedIdx] ?? filtered[0] ?? rows[0]);

    // Phase 11-A: derive the selected card's current preset_id from the
    // live deck list. Null when offline / fake-data / deck not yet loaded
    // — drives the editor's "preset locked" placeholder.
    let currentPresetId = $derived.by(() => {
        if (!selected || !liveDecks || selected.deckId === null) return null;
        const deck = liveDecks.find((d) => d.id === selected.deckId);
        return deck?.preset_id ?? null;
    });

    function toggle(section: string) {
        openSection[section] = !openSection[section];
    }
    function selectRow(i: number) {
        selectedIdx = i;
        // Cancel any in-flight rename mode when switching cards — the
        // draft was for the previous selection's deck.
        isEditingDeck = false;
        errorBanner = null;
    }
    function clearQuery() {
        query = "";
    }

    async function startEditDeck() {
        if (!selected || !liveCards) return;
        deckNameDraft = selected.deckName;
        isEditingDeck = true;
        errorBanner = null;
        await tick();
        deckInput?.focus();
        deckInput?.select();
    }

    function cancelEditDeck() {
        isEditingDeck = false;
        deckNameDraft = "";
        errorBanner = null;
    }

    async function commitEditDeck() {
        if (!selected || !liveCards) return;
        const trimmed = deckNameDraft.trim();
        if (trimmed === "" || trimmed === selected.deckName) {
            cancelEditDeck();
            return;
        }
        const targetDeckId = liveCards.find(
            (c) => String(c.id) === selected.id,
        )?.deck_id;
        if (targetDeckId === undefined) {
            errorBanner = "Deck rename unavailable on fake data";
            return;
        }
        isMutatingDeck = true;
        errorBanner = null;
        try {
            const res = await patchDeckName(targetDeckId, trimmed);
            // Propagate new name to every card in this deck — mockup state
            // is the only canonical UI store right now.
            liveCards = liveCards.map((c) =>
                c.deck_id === res.id ? { ...c, deck_name: res.name } : c,
            );
            isEditingDeck = false;
        } catch (e) {
            errorBanner = e instanceof Error ? e.message : "Rename failed";
        } finally {
            isMutatingDeck = false;
        }
    }

    // Tree rows normalized to a common shape so the each-block does not
    // branch on data source. `id` stays `number | string` because fake decks
    // use string ids; rename gates on numeric ids (live only).
    type TreeRow = {
        id: number | string;
        name: string;
        emoji: string;
        totalCards: number;
    };
    let treeRows: TreeRow[] = $derived(
        liveDecks
            ? liveDecks.map((d) => ({
                  id: d.id,
                  name: d.name,
                  emoji: "📚",
                  totalCards: d.total_in_deck,
              }))
            : fakeDecks.map((d) => ({
                  id: d.id,
                  name: d.name,
                  emoji: d.emoji,
                  totalCards: d.totalCards,
              })),
    );

    async function startEditTreeDeck(deckId: number | string, name: string) {
        if (typeof deckId !== "number") {
            errorBanner = "Deck rename unavailable on fake data";
            return;
        }
        treeEditingDeckId = deckId;
        treeDeckDraft = name;
        errorBanner = null;
        await tick();
        treeDeckInput?.focus();
        treeDeckInput?.select();
    }

    function cancelEditTreeDeck() {
        treeEditingDeckId = null;
        treeDeckDraft = "";
    }

    async function commitEditTreeDeck() {
        if (treeEditingDeckId === null || !liveDecks) return;
        const targetId = treeEditingDeckId;
        const original = liveDecks.find((d) => d.id === targetId);
        const trimmed = treeDeckDraft.trim();
        if (!original || trimmed === "" || trimmed === original.name) {
            cancelEditTreeDeck();
            return;
        }
        isMutatingTreeDeck = true;
        errorBanner = null;
        try {
            const res = await patchDeckName(targetId, trimmed);
            liveDecks = liveDecks.map((d) =>
                d.id === res.id ? { ...d, name: res.name } : d,
            );
            // Propagate to liveCards too so the editor pill + row deckName
            // stay consistent with the tree (single canonical UI store).
            if (liveCards) {
                liveCards = liveCards.map((c) =>
                    c.deck_id === res.id ? { ...c, deck_name: res.name } : c,
                );
            }
            treeEditingDeckId = null;
            treeDeckDraft = "";
        } catch (e) {
            errorBanner = e instanceof Error ? e.message : "Rename failed";
        } finally {
            isMutatingTreeDeck = false;
        }
    }

    // Phase 11-C: jump to a server page. Clamps to [0, total) and skips
    // network calls for unchanged offsets so rapid Prev/Next mashing
    // doesn't pile up duplicate requests. Phase 12-A: pagination respects
    // the active server-side query so Next/Prev pages through search
    // results, not the unfiltered collection.
    async function goPage(newOffset: number): Promise<void> {
        const clamped = Math.max(0, newOffset);
        if (clamped === pageOffset && liveCards !== null) return;
        loading = true;
        errorBanner = null;
        try {
            const res = await fetchCards(query, PAGE_SIZE, clamped);
            liveCards = res.cards;
            liveTotal = res.total;
            pageOffset = clamped;
            selectedIdx = 0;
            lastFetchedQ = query;
        } catch (e) {
            errorBanner = e instanceof Error ? e.message : "Couldn't load page";
        } finally {
            loading = false;
        }
    }

    // Phase 12-A: debounced server-side search. Re-fires whenever `query`
    // changes (after onMount has resolved the initial empty-query fetch)
    // and discards stale responses via a monotonic seq counter so
    // out-of-order completions can't clobber a more recent result. Server
    // failures intentionally do NOT raise the error banner — the local
    // `filtered` substring fallback keeps narrowing useful even if the
    // backend hiccups, and a banner per keystroke would be noisy.
    $effect(() => {
        if (!initialLoadDone) return;
        const currentQuery = query;
        if (currentQuery === lastFetchedQ) return;
        const id = setTimeout(() => {
            const seq = ++searchSeq;
            fetchCards(currentQuery, PAGE_SIZE, 0).then(
                (res) => {
                    if (seq !== searchSeq) return;
                    liveCards = res.cards;
                    liveTotal = res.total;
                    pageOffset = 0;
                    selectedIdx = 0;
                    lastFetchedQ = currentQuery;
                },
                () => undefined,
            );
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(id);
    });

    // 1-indexed range "X-Y of Z" for the toolbar. When liveTotal is null
    // (still loading or fake-data mode), the indicator falls back to the
    // local rows count so the UI still shows something honest.
    let pageStart = $derived(
        liveCards && liveCards.length > 0 ? pageOffset + 1 : 0,
    );
    let pageEnd = $derived(
        liveCards ? pageOffset + liveCards.length : rows.length,
    );
    let canPrev = $derived(pageOffset > 0 && !loading && liveCards !== null);
    let canNext = $derived(
        liveCards !== null &&
            !loading &&
            liveTotal !== null &&
            pageOffset + PAGE_SIZE < liveTotal,
    );
    // When search narrows the visible rows, switch the indicator to
    // "F of L" (filtered-of-page); when search is empty, show the
    // server page range "X–Y of Z". Fake-data path still falls through
    // to the local rows count so we never emit a misleading total.
    let countTagText = $derived.by(() => {
        if (query !== "" && liveCards) {
            return `${filtered.length} of ${liveCards.length}`;
        }
        if (liveTotal !== null && liveCards) {
            return `${pageStart}–${pageEnd} of ${liveTotal}`;
        }
        return `${filtered.length} of ${rows.length}`;
    });

    async function applyPreset(e: Event) {
        const target = e.target as HTMLSelectElement;
        const newPresetId = Number(target.value);
        if (!selected || !liveDecks || selected.deckId === null) {
            errorBanner = "Preset change unavailable on fake data";
            target.value = String(currentPresetId ?? "");
            return;
        }
        if (newPresetId === currentPresetId) return;
        const deckId = selected.deckId;
        isMutatingPreset = true;
        errorBanner = null;
        try {
            const res = await patchDeckPreset(deckId, newPresetId);
            // Mirror into liveDecks so currentPresetId picks up the new
            // value across card switches without a full refetch.
            liveDecks = liveDecks.map((d) =>
                d.id === deckId ? { ...d, preset_id: res.preset_id } : d,
            );
        } catch (err) {
            errorBanner =
                err instanceof Error ? err.message : "Couldn't change preset";
            // Revert the visible select to the previous value on failure
            // so the UI never lies about persistence.
            target.value = String(currentPresetId ?? "");
        } finally {
            isMutatingPreset = false;
        }
    }

    async function toggleSuspend() {
        if (!selected || !liveCards) return;
        const targetCard = liveCards.find((c) => String(c.id) === selected.id);
        if (!targetCard) {
            errorBanner = "Suspend unavailable on fake data";
            return;
        }
        const nextSuspended = targetCard.state !== "suspended";
        isMutatingSuspend = true;
        errorBanner = null;
        try {
            const res = await postCardSuspend(targetCard.id, nextSuspended);
            liveCards = liveCards.map((c) =>
                c.id === res.id ? { ...c, state: res.state } : c,
            );
        } catch (e) {
            errorBanner = e instanceof Error ? e.message : "Suspend failed";
        } finally {
            isMutatingSuspend = false;
        }
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
                    {#each treeRows as d (d.id)}
                        {#if treeEditingDeckId === d.id}
                            <div class="item item-edit">
                                <span class="emoji">{d.emoji}</span>
                                <input
                                    bind:this={treeDeckInput}
                                    bind:value={treeDeckDraft}
                                    class="tree-rename"
                                    aria-label="Rename deck"
                                    disabled={isMutatingTreeDeck}
                                    onkeydown={(e) => {
                                        if (e.key === "Enter") commitEditTreeDeck();
                                        else if (e.key === "Escape") cancelEditTreeDeck();
                                    }}
                                    onblur={commitEditTreeDeck}
                                />
                                <span class="count">{d.totalCards}</span>
                            </div>
                        {:else}
                            <button
                                class="item"
                                ondblclick={() => startEditTreeDeck(d.id, d.name)}
                            >
                                <span class="emoji">{d.emoji}</span>
                                <span>{d.name}</span>
                                <span class="count">{d.totalCards}</span>
                            </button>
                        {/if}
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
                    {#each sidebarTags.slice(0, 8) as t (t)}
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

    <!-- results list -->
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
                <button class="pill pill-new">New</button>
                <button class="pill pill-learning">Learning</button>
                <button class="pill pill-review">Review</button>
                <button class="pill pill-suspended">Suspended</button>
            </div>
            <div class="pagination" role="group" aria-label="Pagination">
                <button
                    class="pill page-btn"
                    onclick={() => goPage(pageOffset - PAGE_SIZE)}
                    disabled={!canPrev}
                    aria-label="Previous page"
                >‹ Prev</button>
                <span class="count-tag" aria-live="polite">{countTagText}</span>
                <button
                    class="pill page-btn"
                    onclick={() => goPage(pageOffset + PAGE_SIZE)}
                    disabled={!canNext}
                    aria-label="Next page"
                >Next ›</button>
            </div>
        </div>

        <div class="list" role="list">
            {#if loading}
                {#each [0, 1, 2, 3, 4] as i (i)}
                    <BrowseRowSkeleton />
                {/each}
            {:else if filtered.length === 0}
                <div class="empty" role="status" aria-live="polite">
                    <div class="empty-title">No cards match</div>
                    <div class="empty-hint">
                        Try a broader query, or
                        <button class="empty-action" onclick={clearQuery}>clear the search</button>.
                    </div>
                </div>
            {:else}
                {#each filtered as r, i (r.id)}
                    <BrowseRow
                        id={r.id}
                        frontHtml={r.frontHtml}
                        backHtml={r.backHtml}
                        deckName={r.deckName}
                        deckEmoji={r.deckEmoji}
                        tags={r.tags}
                        due={r.due}
                        state={r.state}
                        selected={selected?.id === r.id}
                        onSelect={() => selectRow(i)}
                    />
                {/each}
            {/if}
        </div>
    </div>

    <!-- editor panel -->
    <aside class="editor">
        {#if errorBanner}
            <div class="error-banner" role="alert">{errorBanner}</div>
        {/if}
        <div class="editor-head">
            <div class="eyebrow">Note · {selected?.deckEmoji} {selected?.deckName}</div>
            <div class="head-actions">
                <button class="icon-btn" aria-label="Close"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
            </div>
        </div>

        <div class="field">
            <label for="field-front">Front</label>
            <div id="field-front" class="field-value" contenteditable="true" role="textbox" tabindex="0" aria-label="Front">{selected?.frontSnippet ?? ""}</div>
        </div>
        <div class="field">
            <label for="field-back">Back</label>
            <div id="field-back" class="field-value" contenteditable="true" role="textbox" tabindex="0" aria-label="Back">{selected?.backSnippet ?? ""}</div>
        </div>

        <div class="meta">
            <div class="meta-row">
                <span class="meta-key">Deck</span>
                {#if isEditingDeck}
                    <input
                        bind:this={deckInput}
                        class="deck-rename"
                        type="text"
                        bind:value={deckNameDraft}
                        disabled={isMutatingDeck}
                        aria-label="Rename deck"
                        onkeydown={(e) => {
                            if (e.key === "Enter") commitEditDeck();
                            else if (e.key === "Escape") cancelEditDeck();
                        }}
                        onblur={commitEditDeck}
                    />
                {:else}
                    <button
                        class="pill-sel deck-pill-btn"
                        onclick={startEditDeck}
                        aria-label="Edit deck name"
                    >{selected?.deckEmoji} {selected?.deckName}</button>
                {/if}
            </div>
            <div class="meta-row">
                <span class="meta-key">Preset</span>
                {#if presets === null || liveDecks === null || selected?.deckId == null}
                    <span class="meta-val subtle">Offline — preset locked</span>
                {:else}
                    <select
                        class="preset-sel"
                        value={currentPresetId ?? presets[0]?.id ?? 1}
                        disabled={isMutatingPreset}
                        onchange={applyPreset}
                        aria-label="Change preset for {selected?.deckName}"
                    >
                        {#each presets as p (p.id)}
                            <option value={p.id}>{p.name}</option>
                        {/each}
                    </select>
                {/if}
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
            <button
                class="ghost-btn"
                class:active={selected?.state === "suspended"}
                disabled={isMutatingSuspend}
                onclick={toggleSuspend}
            >
                {selected?.state === "suspended" ? "Unsuspend" : "Suspend"}
            </button>
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
        transition:
            color var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease);
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
        transition: color var(--duration-fast) var(--ease);
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
        transition:
            color var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease);
    }
    .item:hover {
        background: var(--bg-hover);
        color: var(--text);
    }
    .item-edit {
        background: var(--bg-hover);
    }
    .tree-rename {
        flex: 1;
        min-width: 0;
        background: var(--bg);
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        padding: 0 var(--space-1);
        font: inherit;
    }
    .tree-rename:focus {
        outline: none;
        border-color: var(--text-muted);
    }
    .emoji {
        font-size: 0.9rem;
    }
    .count {
        margin-left: auto;
        color: var(--text-subtle);
        font-size: 0.7rem;
        font-family: var(--font-mono);
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
        padding: 0.55rem 0.85rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: #ffffff;
        color: var(--text-subtle);
        max-width: 480px;
        transition:
            border-color var(--duration-fast) var(--ease),
            box-shadow var(--duration-fast) var(--ease);
    }
    :global([data-theme="dark"]) .search {
        background: var(--bg-elevated);
    }
    .search:hover {
        border-color: var(--border-strong);
    }
    .search:focus-within {
        border-color: var(--accent);
        box-shadow: var(--shadow-sm);
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
        padding: 3px;
        background: var(--bg-subtle);
        border-radius: var(--radius-md);
    }
    .pill {
        padding: 0.35rem 0.8rem;
        font-size: var(--text-xs);
        color: var(--text-muted);
        border-radius: var(--radius-sm);
        font-weight: 500;
        transition:
            color var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease),
            box-shadow var(--duration-fast) var(--ease);
    }
    .pill:hover:not(.active) {
        color: var(--text);
        background: var(--bg-hover);
    }
    .pill.active {
        background: var(--bg-elevated);
        color: var(--text);
        box-shadow: var(--shadow-sm);
    }

    /* Hover tints echo row state chip palette for semantic hinting */
    .pill.pill-new:hover:not(.active) {
        background: color-mix(in oklch, var(--info) 10%, transparent);
        color: var(--info);
    }
    .pill.pill-learning:hover:not(.active) {
        background: color-mix(in oklch, var(--warning) 14%, transparent);
        color: var(--warning);
    }
    .pill.pill-review:hover:not(.active) {
        background: color-mix(in oklch, var(--success) 12%, transparent);
        color: var(--success);
    }
    .pill.pill-suspended:hover:not(.active) {
        background: var(--bg-inset);
        color: var(--text-muted);
    }
    .count-tag {
        font-size: var(--text-xs);
        color: var(--text-subtle);
        font-variant-numeric: tabular-nums;
        font-family: var(--font-mono);
        margin-left: auto;
        padding: 3px 8px;
        background: var(--bg-subtle);
        border-radius: var(--radius-sm);
    }

    .list {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        padding: var(--space-4) var(--space-6);
    }

    .empty {
        margin: var(--space-8) auto;
        padding: var(--space-6);
        max-width: 320px;
        text-align: center;
        border: 1px dashed var(--border);
        border-radius: var(--radius-md);
        background: #ffffff;
    }
    :global([data-theme="dark"]) .empty {
        background: var(--bg-elevated);
    }
    .empty-title {
        font-family: var(--font-serif);
        font-size: var(--text-lg);
        color: var(--text);
        margin-bottom: var(--space-2);
    }
    .empty-hint {
        font-size: var(--text-sm);
        color: var(--text-muted);
    }
    .empty-action {
        color: var(--accent);
        text-decoration: underline;
        text-underline-offset: 2px;
    }
    .empty-action:hover {
        color: var(--accent-hover);
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
        transition:
            color var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease);
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
        background: #ffffff;
        font-family: var(--font-serif);
        font-size: var(--text-base);
        color: var(--text);
        white-space: pre-wrap;
        outline: none;
        transition:
            border-color var(--duration-fast) var(--ease),
            box-shadow var(--duration-fast) var(--ease);
    }
    :global([data-theme="dark"]) .field-value {
        background: var(--bg-elevated);
    }
    .field-value:focus {
        border-color: var(--accent);
        box-shadow: var(--shadow-sm);
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
        transition:
            background var(--duration-fast) var(--ease),
            border-color var(--duration-fast) var(--ease);
    }
    .pill-sel:hover {
        background: var(--bg-hover);
        border-color: var(--border-strong);
    }
    /* Phase 11-A: native <select> styled to match the deck-pill so the
       editor row reads as one consistent meta column. */
    .preset-sel {
        padding: 3px 8px;
        border: 1px solid var(--border);
        border-radius: var(--radius-full);
        font-size: var(--text-xs);
        color: var(--text);
        background: transparent;
        cursor: pointer;
        transition:
            background var(--duration-fast) var(--ease),
            border-color var(--duration-fast) var(--ease),
            opacity var(--duration-fast) var(--ease);
    }
    .preset-sel:hover {
        background: var(--bg-hover);
        border-color: var(--border-strong);
    }
    .preset-sel:disabled {
        opacity: 0.55;
        cursor: progress;
    }
    /* Phase 11-C: pagination cluster lives in the toolbar. Prev/Next pills
       reuse .pill styling but stay disabled with reduced opacity so the
       page-boundary state is unmistakable. */
    .pagination {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
    }
    .page-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    .tag-edit {
        display: flex;
        flex-wrap: wrap;
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
        transition:
            color var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease),
            border-color var(--duration-fast) var(--ease);
    }
    .ghost-btn:hover {
        color: var(--text);
        background: var(--bg-hover);
    }
    .ghost-btn.danger:hover {
        color: var(--danger);
        border-color: var(--danger);
    }
    .ghost-btn.active {
        color: var(--text);
        background: var(--bg-hover);
        border-color: var(--border-strong);
    }
    .ghost-btn:disabled {
        opacity: 0.55;
        cursor: progress;
    }

    /* Phase 9-P: deck rename + suspend mutations have explicit error
       feedback because dropping a user edit silently is the worst
       possible behavior for a stateful page (per 9-N3). */
    .error-banner {
        font-size: var(--text-xs);
        color: var(--danger);
        background: color-mix(in oklch, var(--danger) 10%, transparent);
        border: 1px solid color-mix(in oklch, var(--danger) 30%, transparent);
        border-radius: var(--radius-sm);
        padding: 0.4rem 0.6rem;
        margin-bottom: var(--space-3);
    }
    .deck-pill-btn {
        cursor: pointer;
        font-family: inherit;
    }
    .deck-rename {
        font-size: var(--text-xs);
        font-family: inherit;
        color: var(--text);
        padding: 3px 10px;
        border: 1px solid var(--accent);
        border-radius: var(--radius-full);
        outline: none;
        background: #ffffff;
        width: fit-content;
        max-width: 220px;
    }
    :global([data-theme="dark"]) .deck-rename {
        background: var(--bg-elevated);
    }
    .deck-rename:disabled {
        opacity: 0.6;
        cursor: progress;
    }
</style>
