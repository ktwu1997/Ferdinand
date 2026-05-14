<script lang="ts">
    import { onMount, tick } from "svelte";
    import { cards as fakeCards, decks as fakeDecks, savedSearches, tags as fakeTags } from "$lib/data";
    import {
        bulkFlag,
        bulkSuspend,
        deleteDeck,
        deleteNote,
        deleteSavedSearch,
        fetchCards,
        fetchDecks,
        fetchDeckConfigs,
        fetchNote,
        fetchNotetype,
        fetchNotetypes,
        fetchSavedSearches,
        fetchTags,
        getCardHistory,
        patchDeckName,
        patchDeckPreset,
        patchNote,
        patchNotetype,
        postCardFlag,
        postCardSuspend,
        postMoveCards,
        postSavedSearch,
        type ApiCardHistoryEntry,
        type ApiCardSummary,
        type ApiDeckConfigListItem,
        type ApiDeckSummary,
        type ApiNotetypeDetail,
        type ApiNotetypeSummary,
        type ApiNotetypeTemplate,
        type ApiSavedSearch,
    } from "$lib/api";
    import BrowseRowSkeleton from "$lib/browse/BrowseRowSkeleton.svelte";
    import { stripHtmlToSnippet } from "$lib/browse/media";
    import { flattenLeafDecks } from "$lib/decks";
    import { Btn, Caption } from "$lib/components/ui";
    import Brand from "$lib/components/Brand.svelte";
    import {
        SketchBook,
        SketchPlus,
        SketchSearch,
    } from "$lib/components/sketch";

    type StateFilter = {
        key: "new" | "learning" | "review" | "suspended";
        label: string;
        color: string;
    };
    const STATE_FILTERS: StateFilter[] = [
        { key: "new", label: "new", color: "var(--due)" },
        { key: "learning", label: "learning", color: "var(--warn)" },
        { key: "review", label: "review", color: "var(--accent)" },
        { key: "suspended", label: "suspended", color: "var(--ink-mute)" },
    ];

    function glyphFor(deckName: string): string {
        if (/N\d|JP|日文|日本語/.test(deckName)) return "JP";
        if (/^Rust/i.test(deckName)) return "RS";
        if (/History|HX/i.test(deckName)) return "HX";
        if (/Anatomy/i.test(deckName)) return "AN";
        if (/TOEIC/i.test(deckName)) return "TC";
        if (/Sesame/i.test(deckName)) return "SS";
        if (/Cloze/i.test(deckName)) return "CZ";
        const leaf = deckName.split(/::|>|\//).pop() ?? deckName;
        const ascii = leaf.replace(/[^A-Za-z]/g, "").toUpperCase();
        if (ascii.length >= 2) return ascii.slice(0, 2);
        return "··";
    }

    let liveCards = $state<ApiCardSummary[] | null>(null);
    let liveDecks = $state<ApiDeckSummary[] | null>(null);
    let liveTags = $state<string[] | null>(null);
    // True once the supplementary fetchDecks / fetchTags calls have
    // *settled* (success or failure). The sidebar's DECKS / TAGS sections
    // render a skeleton until then — they must never paint the bundled
    // demo fixtures (fakeDecks / fakeTags) while a live fetch is in
    // flight, or a logged-in user sees a flash of someone else's data on
    // every navigation into /browse. The fake-data fallback is reserved
    // for the *failed* fetch case (offline / no-backend preview).
    let decksReady = $state(false);
    let tagsReady = $state(false);
    // Phase 18-C: persisted saved-search list. Same fetch-on-mount +
    // silent-fallback shape as liveDecks / liveTags. Empty array is
    // a valid live state (fresh collection, no entries yet) — only
    // null means "fetch hasn't returned" / "fake-data mode" so the
    // mutation handlers can refuse to write against fake data.
    let liveSaved = $state<ApiSavedSearch[] | null>(null);
    let isCreatingSaved = $state(false);
    let newSavedName = $state("");
    let newSavedQuery = $state("");
    let isMutatingSaved = $state(false);
    let savedError = $state<string | null>(null);
    let newSavedNameInput = $state<HTMLInputElement | null>(null);
    let savedDeletingName = $state<string | null>(null);
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

    // Phase A4-ζ: chip-token toolbar state. `query` stays the committed
    // search string (drives debounced fetch + chip rendering); `pendingInput`
    // is the live in-flight typing buffer that flushes into `query` on
    // Enter / closing-quote / a trailing space after a complete token.
    // This dual-state split keeps the cursor and chip rendering visually
    // disjoint — without it, the bound input value would echo the same
    // text the chips already display.
    let pendingInput = $state("");
    let toolbarSearchInput = $state<HTMLInputElement | null>(null);
    let filterSheetOpen = $state(false);
    type FilterStateKey = "new" | "learning" | "review" | "suspended";
    let filterDraftStates = $state<FilterStateKey[]>([]);
    let filterDraftTags = $state<string[]>([]);

    // Phase 9-P: editor-panel mutations against anki_server. Stateful page,
    // so errors surface as an explicit banner (per 9-N3 design_pattern_proven)
    // — silent fallback would drop the user's edit without acknowledgement.
    let errorBanner = $state<string | null>(null);
    let isEditingDeck = $state(false);
    let deckNameDraft = $state("");
    let isMutatingDeck = $state(false);
    let isMutatingSuspend = $state(false);
    let isMutatingDelete = $state(false);
    // Phase 17-A: per-card flag-chip mutation. The 7-color chip strip
    // in the editor footer disables itself while a flag PATCH is in
    // flight so a rapid double-click can't race the server response.
    let isMutatingFlag = $state(false);
    // Phase 19-D: card-level move-to-deck. The "Move to" select in the
    // editor footer disables itself while a move is in flight so the
    // user can't fire a second move at a stale row mid-update.
    let isMutatingMove = $state(false);
    // Phase 20-B: bulk multi-select on the result list. The Set holds
    // numeric card ids (the wire-level int matches the bulk endpoints'
    // payload shape). A Svelte reactive Set is reassigned wholesale on
    // mutation to trigger reruns — `selectedIds = new Set(selectedIds)`
    // — rather than mutating in place. `isMutatingBulk` gates the
    // toolbar so a rapid double-click can't race a refetch in flight.
    let selectedIds = $state<Set<number>>(new Set());
    let isMutatingBulk = $state(false);
    let deckInput = $state<HTMLInputElement | null>(null);

    // Phase 9-S: tree-sidebar inline rename. Per-row edit state (only one row
    // at a time). Available only when liveDecks is loaded — fake-data mode
    // refuses rename so we never lie to the user about a successful edit.
    let treeEditingDeckId = $state<number | null>(null);
    let treeDeckDraft = $state("");
    let isMutatingTreeDeck = $state(false);
    let treeDeckInput = $state<HTMLInputElement | null>(null);

    // Phase 15-A: tree-sidebar delete. Default deck (id=1) is rejected
    // server-side, so the X glyph hides for that row defensively. Only
    // one delete in flight at a time so a confirm-then-double-click
    // can't race.
    let treeDeletingDeckId = $state<number | null>(null);

    // Phase 11-A: per-deck preset assignment. Presets list is loaded once
    // on mount; the dropdown reflects the selected card's deck preset_id
    // via a $derived lookup against liveDecks. Live mode only — fake-data
    // mode shows an "offline" placeholder so we never lie about persisting.
    let presets = $state<ApiDeckConfigListItem[] | null>(null);
    let isMutatingPreset = $state(false);

    // Phase 14-A: live note editing. Front/Back drafts are seeded from
    // the selected card's note (preferring raw fields via fetchNote in
    // live mode, falling back to stripped snippets in fake-data mode so
    // the surface still works offline). PATCH /api/notes/{id} on blur
    // if the draft differs from the seed; on success the row list
    // refetches so template-rendered front_html/back_html stays
    // canonical. Tag chips are clickable to remove; "+ Add" reveals an
    // inline input that commits on Enter.
    // Phase 16-A: drafts now seed from raw fields via fetchNote, so
    // existing HTML markup (e.g. `<b>` tags, `<img>` references) round-
    // trips through the edit cycle without being stripped to plain
    // text. Closes the v1 plain-text-only limitation from 14-A.
    // Phase 18-A: drafts are now per-field arrays so notetypes with
    // more than two fields (Cloze: "Text" + "Back Extra"; Image
    // Occlusion: "Image" + "Header" + "Back Extra" + ...) can be
    // edited fully. Field labels come from fetchNotetypes (looked up
    // by note's notetype_id); field count and order come from
    // res.fields directly (server-canonical). Fake-data and pre-load
    // fall back to ["Front", "Back"] labels.
    let fieldDrafts = $state<string[]>(["", ""]);
    // Raw seed values — what the editor most recently fetched/persisted.
    // Used to compute "is the draft dirty?" so commitFields can no-op
    // on accidental blur and so the rollback branch knows what to
    // restore.
    let fieldSeeds = $state<string[]>(["", ""]);
    // Current note's notetype id — set by fetchNote response, used to
    // look up field labels in liveNotetypes. Null in fake-data mode
    // and during the seed-from-snippet pre-load window.
    let currentNotetypeId = $state<number | null>(null);
    let liveNotetypes = $state<ApiNotetypeSummary[] | null>(null);

    // Phase 19-A: Card Templates editor state. Templates are
    // notetype-level (changing one affects every card sharing that
    // notetype) so the panel sits in a closed disclosure by default —
    // a misclick on the Q/A textareas shouldn't be possible while the
    // user is just browsing notes. Drafts are parallel arrays indexed
    // by ord so a partial save (only one template button clicked) can
    // diff against the server-canonical state without re-walking
    // `liveTemplates`. Lazy-load on first open: `templatesLoadedFor`
    // tracks the notetype id we last hydrated for so switching notes
    // (and therefore notetypes) silently invalidates the cache without
    // a wasted fetch when the panel is closed.
    let liveTemplates = $state<ApiNotetypeTemplate[] | null>(null);
    let qfmtDrafts = $state<string[]>([]);
    let afmtDrafts = $state<string[]>([]);
    let templatesPanelOpen = $state(false);
    let templatesLoadedFor = $state<number | null>(null);
    let isMutatingTemplate = $state(false);
    let templatesError = $state<string | null>(null);
    let templateSavingOrd = $state<number | null>(null);

    // Phase 20-D: per-card review history viewer. Read-only — closed by
    // default disclosure that lazy-fetches /api/cards/{id}/history on
    // first open. `historyLoadedFor` tracks the card id we last
    // hydrated for so switching to a different card silently
    // invalidates the cache without burning a request when the panel
    // is closed. `historyLoading` and `historyError` are panel-local
    // so a flaky history fetch never poisons the editor's main banner.
    let historyEntries = $state<ApiCardHistoryEntry[] | null>(null);
    let historyPanelOpen = $state(false);
    let historyLoadedFor = $state<number | null>(null);
    let historyLoading = $state(false);
    let historyError = $state<string | null>(null);
    let isAddingTag = $state(false);
    let newTagDraft = $state("");
    let isMutatingNote = $state(false);
    let tagInput = $state<HTMLInputElement | null>(null);
    // Tracks the currently-seeded card so the reset $effect only fires
    // when selection actually changes — not on every reactive recompute.
    let lastSelectedCardId: string | null = null;

    onMount(() => {
        // Seed the search box from `?q=` — the global nav rail's pinned
        // saved-searches link here as `/browse?q=tag:leech` etc. `query`
        // and `lastFetchedQ` are primed together so the debounced
        // search-wire $effect below sees `query === lastFetchedQ` and
        // doesn't immediately re-issue the same fetch.
        const initialQ = new URLSearchParams(window.location.search).get("q") ?? "";
        if (initialQ) {
            query = initialQ;
            lastFetchedQ = initialQ;
        }
        // Cards drive the main `loading` flag (skeleton rows). Decks are
        // supplementary navigation — fire-and-forget so the row list never
        // waits on tree data. Both fall back silently to fake data on
        // failure; editor mutations are gated by liveDecks/liveCards being
        // non-null at call time.
        fetchCards(initialQ, PAGE_SIZE, 0)
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
                // initial query fetch, and it must not run before the
                // first paint of skeleton/empty rows is committed.
                initialLoadDone = true;
            });
        fetchDecks()
            .then(
                (res) => {
                    liveDecks = res.decks.filter((d) => d.id !== 0 && d.level >= 1);
                },
                () => undefined,
            )
            .finally(() => {
                decksReady = true;
            });
        fetchTags()
            .then(
                (res) => {
                    liveTags = res.tags;
                },
                () => undefined,
            )
            .finally(() => {
                tagsReady = true;
            });
        fetchDeckConfigs().then(
            (res) => {
                presets = res.configs;
            },
            () => undefined,
        );
        // Phase 18-A: notetype list drives the editor's per-field
        // labels. Silent fallback so a fetchNotetypes failure leaves
        // the editor with generic "Field 1"/"Field 2" labels rather
        // than blocking the page; live edits still go through because
        // the server is the source of truth on field count.
        fetchNotetypes().then(
            (res) => {
                liveNotetypes = res.notetypes;
            },
            () => undefined,
        );
        // Phase 18-C: saved-search list. Silent fallback to fake
        // data on failure preserves the sidebar visually for offline
        // / fake-data mode; mutations are gated by liveSaved being
        // non-null so we never lie about persisting against fakes.
        fetchSavedSearches().then(
            (res) => {
                liveSaved = res.searches;
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
        // Phase 17-A: user-visible flag colour (0 = none, 1..=7 the
        // seven supported colours). Fake-data rows default to 0 so the
        // chip strip is unhighlighted when previewing the static UI.
        flag: number;
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
                  flag: c.flag,
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
                  flag: 0,
              })),
    );

    // Phase A4-ε₁: state-bucket counts for the // state sidebar block.
    // Counts are derived against `rows` (not `filtered`) so the state
    // chips show the unfiltered library shape — clicking one then
    // narrows `query` and `filtered` collapses.
    let stateCounts = $derived.by(() => {
        const c: Record<string, number> = {
            new: 0,
            learning: 0,
            review: 0,
            suspended: 0,
        };
        // Count the live card page only — never the fakeCards fallback in
        // `rows`, so the STATE filter counts don't briefly reflect the
        // demo data before the first fetch lands.
        for (const card of liveCards ?? []) {
            if (card.state in c) c[card.state]++;
        }
        return c;
    });

    let filtered = $derived(
        rows.filter(
            (r) =>
                query === "" ||
                r.frontSnippet.toLowerCase().includes(query.toLowerCase()) ||
                r.backSnippet.toLowerCase().includes(query.toLowerCase()),
        ),
    );
    let selected = $derived(filtered[selectedIdx] ?? filtered[0] ?? rows[0]);

    // Phase 20-B: master-checkbox state. `allVisibleSelected` is true
    // only when every visible row is in the selection Set; the
    // "indeterminate" middle ground (`someVisibleSelected` && not all)
    // drives the header checkbox's indeterminate flag so the user can
    // tell at a glance whether they're selecting the page or just a
    // subset. Numeric ids — fake-data rows carry a non-numeric id so
    // they're filtered out (bulk endpoints only run against live
    // rows).
    let visibleNumericIds = $derived(
        filtered
            .map((r) => Number(r.id))
            .filter((id) => Number.isFinite(id) && id > 0),
    );
    let allVisibleSelected = $derived(
        visibleNumericIds.length > 0 &&
            visibleNumericIds.every((id) => selectedIds.has(id)),
    );
    let someVisibleSelected = $derived(
        !allVisibleSelected &&
            visibleNumericIds.some((id) => selectedIds.has(id)),
    );

    // Phase 14-A / 16-A: seed Front/Back drafts when the user picks a
    // different card. Comparing the card id (rather than re-running on
    // every selected-derived recompute) keeps mid-edit drafts intact
    // when an unrelated reactive update fires.
    //
    // Live mode: fire fetchNote(note_id) to get the raw note fields
    // (preserving HTML) so the editor stays loss-less across save
    // cycles. Fake-data mode falls back to the stripped snippets the
    // row preview already carries.
    $effect(() => {
        const cardId = selected?.id ?? null;
        if (cardId === lastSelectedCardId) return;
        lastSelectedCardId = cardId;
        isAddingTag = false;
        newTagDraft = "";

        const targetCard = liveCards?.find(
            (c) => String(c.id) === selected?.id,
        );
        if (!targetCard) {
            // Fake-data mode (or selection cleared) — seed from snippets
            // into a 2-field shape so the Front/Back textareas still
            // have something to edit. Notetype id stays null so the
            // label-lookup falls back to ["Front","Back"].
            const seeded = [
                selected?.frontSnippet ?? "",
                selected?.backSnippet ?? "",
            ];
            fieldDrafts = seeded;
            fieldSeeds = [...seeded];
            currentNotetypeId = null;
            return;
        }
        // Optimistic 2-field snippet seed so the editor isn't blank
        // during the fetchNote round-trip. Replaced once raw fields
        // (and the actual field count) land.
        const optimisticSeed = [
            selected?.frontSnippet ?? "",
            selected?.backSnippet ?? "",
        ];
        fieldDrafts = optimisticSeed;
        fieldSeeds = [...optimisticSeed];
        currentNotetypeId = null;
        const requestedNoteId = targetCard.note_id;
        fetchNote(requestedNoteId).then(
            (res) => {
                // Discard if the user moved on to a different card while
                // the request was in flight — comparing against the
                // current `selected.id`'s mapped note_id would be racy
                // because that mapping can change on liveCards mutation,
                // so we reach back through the same lookup here.
                const stillSelected = liveCards?.find(
                    (c) => String(c.id) === selected?.id,
                );
                if (!stillSelected || stillSelected.note_id !== requestedNoteId) {
                    return;
                }
                // Phase 18-A: replace the optimistic 2-field seed with
                // the real per-field array. res.fields.length is the
                // server-canonical field count for this note's notetype
                // (Basic=2, Cloze=2, Image Occlusion=5+, custom=N).
                fieldDrafts = [...res.fields];
                fieldSeeds = [...res.fields];
                currentNotetypeId = res.notetype_id;
            },
            () => {
                // Silent fallback — the snippet seed already applied
                // above is good enough to type into. errorBanner stays
                // clear because no user action has failed yet; if the
                // user blurs and a save fails, _that_ surfaces a
                // banner via commitFields' catch arm.
            },
        );
    });

    // Phase 18-A: derive the visible field labels from the loaded
    // notetype list. Falls back gracefully:
    //   1. fetchNote landed + notetype found → use notetype.fields
    //      (e.g. Cloze: ["Text","Back Extra"]).
    //   2. fetchNote landed but notetypes still loading / not found
    //      → generic "Field 1", "Field 2", … so the editor renders.
    //   3. Pre-fetchNote / fake-data mode → ["Front","Back"] for the
    //      classic Basic-notetype look.
    let currentFieldLabels = $derived.by<string[]>(() => {
        if (currentNotetypeId !== null && liveNotetypes) {
            const nt = liveNotetypes.find((n) => n.id === currentNotetypeId);
            if (nt && nt.fields.length === fieldDrafts.length) {
                return nt.fields;
            }
        }
        // Fallback chain when label lookup fails (notetypes not yet
        // loaded, fetchNotetypes rejected, notetype_id not in list,
        // or fake-data mode):
        //   - 2-field notes → classic ["Front","Back"]. Covers Basic
        //     directly and Cloze in degraded form (we'd rather show
        //     a slightly-wrong label than a generic "Field N").
        //   - 3+ field notes → generic "Field N" labels because
        //     guessing Image Occlusion's varying field names without
        //     the notetype record would mislead more than it helps.
        if (fieldDrafts.length === 2) {
            return ["Front", "Back"];
        }
        return fieldDrafts.map((_, i) => `Field ${i + 1}`);
    });

    // Slug the label to a stable id-friendly string ("Back Extra" →
    // "back-extra"). Keeps `#field-front` / `#field-back` working for
    // existing 14-A / 16-A contract tests on Basic notetype while
    // generalising for Cloze / Image Occlusion.
    function fieldSlug(label: string): string {
        return label.toLowerCase().replace(/\s+/g, "-");
    }

    // Phase 18-C: saved-search lifecycle. Same start/cancel/commit
    // shape as Phase 14-C "+ New deck" — button reveals two inputs
    // (name + query), Enter commits, Escape cancels. Mutations are
    // gated by liveSaved being non-null so fake-data mode refuses
    // create/delete cleanly. On success the local liveSaved array
    // is mutated in place from the server response (single source of
    // truth — no optimistic state to roll back).
    async function startCreateSaved(): Promise<void> {
        if (liveSaved === null) {
            savedError = "Saved searches unavailable — backend offline";
            return;
        }
        isCreatingSaved = true;
        newSavedName = "";
        newSavedQuery = "";
        savedError = null;
        await tick();
        newSavedNameInput?.focus();
    }

    function cancelCreateSaved(): void {
        isCreatingSaved = false;
        newSavedName = "";
        newSavedQuery = "";
        savedError = null;
    }

    async function commitCreateSaved(): Promise<void> {
        const trimmedName = newSavedName.trim();
        const trimmedQuery = newSavedQuery.trim();
        if (trimmedName === "" && trimmedQuery === "") {
            cancelCreateSaved();
            return;
        }
        if (liveSaved === null) {
            savedError = "Saved searches unavailable — backend offline";
            return;
        }
        isMutatingSaved = true;
        savedError = null;
        try {
            const created = await postSavedSearch({
                name: trimmedName,
                query: trimmedQuery,
            });
            liveSaved = [...liveSaved, created];
            cancelCreateSaved();
        } catch (e) {
            savedError =
                e instanceof Error ? e.message : "Couldn't save search";
        } finally {
            isMutatingSaved = false;
        }
    }

    async function deleteSavedByName(name: string): Promise<void> {
        if (liveSaved === null) {
            savedError = "Saved searches unavailable — backend offline";
            return;
        }
        if (savedDeletingName !== null) return; // single delete in flight
        savedDeletingName = name;
        savedError = null;
        try {
            await deleteSavedSearch(name);
            liveSaved = liveSaved.filter((s) => s.name !== name);
        } catch (e) {
            savedError =
                e instanceof Error ? e.message : "Couldn't delete saved search";
        } finally {
            savedDeletingName = null;
        }
    }

    // Phase A4-ζ: chip-token toolbar parser. Splits the committed `query`
    // string into structured tokens for the toolbar to render. The kinds
    // map to deck:"…" / tag:… / is:… / bare-text and drive chip colour.
    // Bare commit strings are preserved verbatim (e.g. `deck:"Sesame…"`)
    // so chip-text === query-substring round-trips losslessly when a chip
    // is removed.
    type ChipToken = {
        kind: "deck" | "tag" | "is" | "text";
        raw: string;
    };
    function parseQueryChips(q: string): ChipToken[] {
        const tokens: ChipToken[] = [];
        if (!q.trim()) return tokens;
        // Match: prefix:"quoted value"  |  prefix:bareword  |  bareword
        const re =
            /(deck|tag|is):"([^"]+)"|(deck|tag|is):(\S+)|("([^"]+)")|(\S+)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(q)) !== null) {
            if (m[1]) {
                tokens.push({
                    kind: m[1] as ChipToken["kind"],
                    raw: `${m[1]}:"${m[2]}"`,
                });
            } else if (m[3]) {
                tokens.push({
                    kind: m[3] as ChipToken["kind"],
                    raw: `${m[3]}:${m[4]}`,
                });
            } else if (m[5]) {
                tokens.push({ kind: "text", raw: m[5] });
            } else if (m[7]) {
                tokens.push({ kind: "text", raw: m[7] });
            }
        }
        return tokens;
    }

    function commitPendingInput(): void {
        const t = pendingInput.trim();
        if (t === "") return;
        query = query.trim() === "" ? t : `${query.trim()} ${t}`;
        pendingInput = "";
    }

    // Auto-commit watcher — fires on every keystroke. Closing-quote
    // commits a `deck:"…"` token; trailing space commits a complete
    // `tag:foo` / `is:foo` / bare token. Editing mid-token (no trailing
    // space, no closing quote) keeps the buffer pending so backspace
    // still works on the partial.
    function maybeAutoCommit(): void {
        const v = pendingInput;
        if (v === "") return;
        // Complete deck:"…" — closing quote present, no trailing chars
        if (/^(deck|tag|is):"[^"]+"$/.test(v.trim())) {
            commitPendingInput();
            return;
        }
        // tag:foo / is:foo / bare followed by trailing space
        if (
            /^(tag|is):\S+\s+$/.test(v) ||
            (/^\S+\s+$/.test(v) && !/^(deck|tag|is):"/.test(v))
        ) {
            commitPendingInput();
            return;
        }
    }

    function removeChipAt(idx: number): void {
        const chips = parseQueryChips(query);
        if (idx < 0 || idx >= chips.length) return;
        chips.splice(idx, 1);
        query = chips.map((c) => c.raw).join(" ");
        // Refocus the toolbar input so the cursor returns to a sensible
        // position (right after the last chip) — without this the chip
        // click steals focus and the user has to click the input again.
        toolbarSearchInput?.focus();
    }

    function onToolbarKeydown(e: KeyboardEvent): void {
        if (e.key === "Enter") {
            e.preventDefault();
            commitPendingInput();
            return;
        }
        if (e.key === "Backspace" && pendingInput === "") {
            // Empty buffer + backspace = pop the last chip. Quiet UX
            // (no confirm) because the chip is one click away from
            // being put back via the inline input.
            const chips = parseQueryChips(query);
            if (chips.length > 0) {
                chips.pop();
                query = chips.map((c) => c.raw).join(" ");
            }
        }
    }

    // — ζ filter sheet handlers —
    function openFilterSheet(): void {
        // Seed the draft selections from whatever `is:`/`tag:` chips
        // are already in the query so opening the sheet on top of an
        // active filter doesn't blow the user's selection away on apply.
        const chips = parseQueryChips(query);
        filterDraftStates = chips
            .filter((c) => c.kind === "is")
            .map((c) => c.raw.replace(/^is:/, "") as FilterStateKey)
            .filter((k) =>
                ["new", "learning", "review", "suspended"].includes(k),
            );
        filterDraftTags = chips
            .filter((c) => c.kind === "tag")
            .map((c) => c.raw.replace(/^tag:"?/, "").replace(/"$/, ""));
        filterSheetOpen = true;
    }

    function closeFilterSheet(): void {
        filterSheetOpen = false;
    }

    function toggleDraftState(s: FilterStateKey): void {
        filterDraftStates = filterDraftStates.includes(s)
            ? filterDraftStates.filter((x) => x !== s)
            : [...filterDraftStates, s];
    }

    function toggleDraftTag(t: string): void {
        filterDraftTags = filterDraftTags.includes(t)
            ? filterDraftTags.filter((x) => x !== t)
            : [...filterDraftTags, t];
    }

    function resetFilterSheet(): void {
        filterDraftStates = [];
        filterDraftTags = [];
    }

    function applyFilterSheet(): void {
        // Strip is:/tag: chips from the current query, then re-append
        // the draft selections. Keeps deck:/text chips intact so the
        // sheet behaves additively over a deck-scoped search.
        const remaining = parseQueryChips(query)
            .filter((c) => c.kind !== "is" && c.kind !== "tag")
            .map((c) => c.raw);
        const stateChips = filterDraftStates.map((s) => `is:${s}`);
        const tagChips = filterDraftTags.map((t) =>
            t.includes(" ") ? `tag:"${t}"` : `tag:${t}`,
        );
        query = [...remaining, ...stateChips, ...tagChips].join(" ").trim();
        filterSheetOpen = false;
    }

    async function startCreateSavedFromToolbar(): Promise<void> {
        // Hook the toolbar's "save search" button into the existing
        // sidebar inline form (Phase 18-C). Pre-fills the query input
        // with the current toolbar query so a one-click save commits
        // the right thing; user just types a name. ScrollIntoView
        // makes sure the form is visible even on a long sidebar.
        await startCreateSaved();
        if (isCreatingSaved) {
            newSavedQuery = query;
            await tick();
            newSavedNameInput?.scrollIntoView({
                behavior: "smooth",
                block: "center",
            });
        }
    }

    // Phase A4-ζ: window-level keydown for the toolbar shortcut. ⌘K /
    // Ctrl+K focuses the chip-token searchbar from anywhere on the
    // page; ESC closes the filter sheet. We bail out if focus is in
    // a different input so typing the literal "k" inside an editor
    // textarea doesn't yank focus out from under the user.
    $effect(() => {
        function onKey(e: KeyboardEvent): void {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                const t = e.target as HTMLElement | null;
                const inOtherInput =
                    t &&
                    (t.tagName === "INPUT" || t.tagName === "TEXTAREA") &&
                    t !== toolbarSearchInput;
                if (inOtherInput) return;
                e.preventDefault();
                toolbarSearchInput?.focus();
                toolbarSearchInput?.select();
                return;
            }
            if (e.key === "Escape" && filterSheetOpen) {
                e.preventDefault();
                closeFilterSheet();
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    // Phase 11-A: derive the selected card's current preset_id from the
    // live deck list. Null when offline / fake-data / deck not yet loaded
    // — drives the editor's "preset locked" placeholder.
    let currentPresetId = $derived.by(() => {
        if (!selected || !liveDecks || selected.deckId === null) return null;
        const deck = liveDecks.find((d) => d.id === selected.deckId);
        return deck?.preset_id ?? null;
    });

    // Phase 19-D: candidate decks for the move-to-deck dropdown. The
    // server endpoint accepts any non-filtered deck id; the UI hides
    // the current deck (no-op move) and any filtered deck (rejected at
    // rslib layer with FilteredDeckError::CanNotMoveCardsInto). liveDecks
    // is the top-level array; flatten() walks the nested `children` so a
    // user can move into a sub-deck like "Spanish::Verbs::Irregular".
    function flattenDecks(decks: ApiDeckSummary[]): ApiDeckSummary[] {
        const out: ApiDeckSummary[] = [];
        for (const d of decks) {
            out.push(d);
            out.push(...flattenDecks(d.children));
        }
        return out;
    }
    let moveCandidates = $derived.by<ApiDeckSummary[]>(() => {
        if (!liveDecks || !selected || selected.deckId === null) return [];
        return flattenDecks(liveDecks).filter(
            (d) => !d.filtered && d.id !== selected.deckId,
        );
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
    // The sidebar DECKS list shows the *leaf* decks — the ones that
    // actually hold cards — with the full `Parent::Child::Leaf` path as
    // the label (a pure-container parent like `TOEIC` holds no cards
    // directly, so listing it bare would just read "TOEIC 0"). Mirrors
    // the dashboard ledger, which already uses `flattenLeafDecks`.
    //
    // Empty until `fetchDecks` has settled — the markup shows a skeleton
    // in that window rather than the `fakeDecks` fallback (see decksReady).
    let treeRows: TreeRow[] = $derived(
        !decksReady
            ? []
            : liveDecks
              ? flattenLeafDecks(liveDecks).map((d) => ({
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
            // Propagate to liveCards: optimistic inline update then server refetch
            // so the row list reflects the authoritative server state (close #10).
            if (liveCards) {
                liveCards = liveCards.map((c) =>
                    c.deck_id === res.id ? { ...c, deck_name: res.name } : c,
                );
            }
            // Refetch from server — ensures any filtered/sorted view is accurate.
            const refreshed = await fetchCards(query, PAGE_SIZE, pageOffset);
            liveCards = refreshed.cards;
            liveTotal = refreshed.total;
            treeEditingDeckId = null;
            treeDeckDraft = "";
        } catch (e) {
            errorBanner = e instanceof Error ? e.message : "Rename failed";
        } finally {
            isMutatingTreeDeck = false;
        }
    }

    // Phase 15-A: delete a tree-sidebar deck (cascades server-side
    // through children + their cards + orphan notes). Pre-confirms via
    // window.confirm so a misclicked × never silently destroys data.
    // Refetches `liveCards` only when the server reports cards were
    // removed — empty deck cleanup (the common 14-C residual case)
    // costs zero extra round-trips.
    async function deleteTreeDeck(deckId: number, name: string) {
        if (!liveDecks) {
            errorBanner = "Deck delete unavailable on fake data";
            return;
        }
        // Default deck guard. Server returns 400 for id=1 too, but
        // surfacing the warning client-side dodges the network round-trip
        // and matches the hidden-X behaviour in the row template.
        if (deckId === 1) {
            errorBanner = "Default deck cannot be deleted";
            return;
        }
        if (treeDeletingDeckId !== null) return;
        const ok = window.confirm(
            `Delete "${name}" and all its cards? This cannot be undone.`,
        );
        if (!ok) return;
        treeDeletingDeckId = deckId;
        errorBanner = null;
        try {
            const res = await deleteDeck(deckId);
            // Filter the deleted deck out of liveDecks. Cascaded children
            // weren't in the flat top-level liveDecks anyway (they live
            // inside ApiDeckSummary.children), so a single .filter()
            // suffices for the visible rows.
            liveDecks = liveDecks.filter((d) => d.id !== deckId);
            // Refetch the current card page only when the cascade actually
            // removed cards — for the empty-deck cleanup case (e.g. the
            // Phase 14-C residual decks) no cards changed and we save the
            // round-trip.
            if (res.removed_card_count > 0) {
                const refreshed = await fetchCards(query, PAGE_SIZE, pageOffset);
                liveCards = refreshed.cards;
                liveTotal = refreshed.total;
                // If the current page is now past the end (we deleted
                // enough cards to shrink past `pageOffset`), step back.
                if (pageOffset > 0 && liveCards.length === 0 && liveTotal > 0) {
                    pageOffset = Math.max(0, liveTotal - PAGE_SIZE);
                    const reclamped = await fetchCards(query, PAGE_SIZE, pageOffset);
                    liveCards = reclamped.cards;
                    liveTotal = reclamped.total;
                }
                if (selectedIdx >= (liveCards?.length ?? 0)) {
                    selectedIdx = Math.max(0, (liveCards?.length ?? 1) - 1);
                }
            }
        } catch (e) {
            errorBanner = e instanceof Error ? e.message : "Delete failed";
        } finally {
            treeDeletingDeckId = null;
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

    async function deleteSelectedNote() {
        if (!selected || !liveCards) return;
        const targetCard = liveCards.find((c) => String(c.id) === selected.id);
        if (!targetCard) {
            errorBanner = "Delete unavailable on fake data";
            return;
        }
        // Two-step delete via native confirm() — keeps the dependency
        // surface minimal and matches the settings-page Delete preset
        // pattern (Phase 13-B). Copy includes the card's first-field
        // snippet so a slip on the row list can't take out the wrong
        // note.
        const snippet = (selected.frontSnippet || "(empty)").slice(0, 60);
        if (
            typeof window !== "undefined" &&
            !window.confirm(
                `Delete this note? "${snippet}" — its ${targetCard.template_idx + 1} or more cards will be removed too.`,
            )
        ) {
            return;
        }
        isMutatingDelete = true;
        errorBanner = null;
        try {
            const res = await deleteNote(targetCard.note_id);
            // Drop every card belonging to the deleted note from the
            // local list — server returns a card count but not the ids,
            // so we filter by note_id (cheaper than refetching the page).
            const removedNoteId = targetCard.note_id;
            liveCards = liveCards.filter((c) => c.note_id !== removedNoteId);
            if (liveTotal !== null) {
                // Server's removed_card_count is the truth across the
                // whole match set; subtract it directly so "X-Y of Z"
                // stays accurate even if some siblings were paginated
                // off the current page.
                liveTotal = Math.max(0, liveTotal - res.removed_card_count);
            }
            // Clamp selection — if we just deleted the bottom row, slide
            // up; otherwise the next card naturally takes the slot.
            if (selectedIdx >= liveCards.length && selectedIdx > 0) {
                selectedIdx = Math.max(0, liveCards.length - 1);
            }
        } catch (e) {
            errorBanner = e instanceof Error ? e.message : "Delete failed";
        } finally {
            isMutatingDelete = false;
        }
    }

    // Phase 14-A: commit the current Front/Back drafts as a fields
    // PATCH. Skips the network call when neither draft is dirty so the
    // textarea blur-on-Tab doesn't pile up no-op writes. On success the
    // page refetches because front_html/back_html are template-rendered
    // server-side — only a refetch guarantees the row preview matches
    // what the new fields render to. On failure the drafts roll back to
    // the seed snippets so a re-blur won't re-trigger the same call.
    async function commitFields(): Promise<void> {
        if (!selected || !liveCards) return;
        const targetCard = liveCards.find((c) => String(c.id) === selected.id);
        if (!targetCard) {
            errorBanner = "Edit unavailable on fake data";
            return;
        }
        // Phase 16-A / 18-A: compare each draft array element against
        // its raw seed. Same dirty-check intent as 16-A but generalised
        // across all fields — an unchanged Image Occlusion note with
        // 5 fields no-ops on every blur instead of round-tripping a
        // 5-field PATCH for nothing. Length mismatch is treated as
        // "dirty" defensively (shouldn't happen post-fetchNote).
        const isDirty =
            fieldDrafts.length !== fieldSeeds.length ||
            fieldDrafts.some((v, i) => v !== fieldSeeds[i]);
        if (!isDirty) return;
        isMutatingNote = true;
        errorBanner = null;
        // Snapshot the drafts so the optimistic-seed update below
        // isn't trampled if the user keeps typing during the await.
        const submitted = [...fieldDrafts];
        try {
            await patchNote(targetCard.note_id, {
                fields: submitted,
            });
            // Refresh seeds first so a follow-up blur sees a clean state
            // even if the row-list refetch below fails. Use the
            // submitted snapshot, not fieldDrafts (mid-flight typing
            // shouldn't be considered "saved").
            fieldSeeds = submitted;
            // Refetch the current page so row previews reflect the new
            // template render. Tags-only mirroring would be enough for
            // tag patches, but front/back go through {{Field}} on the
            // server — there's no client-safe way to reproduce that.
            const res = await fetchCards(query, PAGE_SIZE, pageOffset);
            liveCards = res.cards;
            liveTotal = res.total;
        } catch (e) {
            errorBanner = e instanceof Error ? e.message : "Edit failed";
            fieldDrafts = [...fieldSeeds];
        } finally {
            isMutatingNote = false;
        }
    }

    // Phase 14-A: remove a single tag chip via PATCH. Server returns
    // the canonical (trimmed/blank-dropped) tags; mirror that into
    // every card with the same note_id so sibling cards in the row
    // list stay consistent.
    async function removeTag(tag: string): Promise<void> {
        if (!selected || !liveCards) return;
        const targetCard = liveCards.find((c) => String(c.id) === selected.id);
        if (!targetCard) {
            errorBanner = "Tag edit unavailable on fake data";
            return;
        }
        const newTags = targetCard.tags.filter((t) => t !== tag);
        isMutatingNote = true;
        errorBanner = null;
        try {
            const res = await patchNote(targetCard.note_id, { tags: newTags });
            const noteId = targetCard.note_id;
            liveCards = liveCards.map((c) =>
                c.note_id === noteId ? { ...c, tags: res.tags } : c,
            );
        } catch (e) {
            errorBanner = e instanceof Error ? e.message : "Tag edit failed";
        } finally {
            isMutatingNote = false;
        }
    }

    async function startAddTag(): Promise<void> {
        if (!selected || !liveCards) return;
        isAddingTag = true;
        newTagDraft = "";
        errorBanner = null;
        await tick();
        tagInput?.focus();
    }

    function cancelAddTag(): void {
        isAddingTag = false;
        newTagDraft = "";
    }

    // Commit a new tag. Empty/dup inputs short-circuit to cancel so
    // clicking + Add and immediately blurring doesn't fire a no-op
    // patch. On success, mirror server tags into liveCards keyed by
    // note_id so the chip rerenders without a refetch.
    async function commitAddTag(): Promise<void> {
        if (!selected || !liveCards) {
            cancelAddTag();
            return;
        }
        const trimmed = newTagDraft.trim();
        if (trimmed === "") {
            cancelAddTag();
            return;
        }
        const targetCard = liveCards.find((c) => String(c.id) === selected.id);
        if (!targetCard) {
            errorBanner = "Tag edit unavailable on fake data";
            cancelAddTag();
            return;
        }
        if (targetCard.tags.includes(trimmed)) {
            cancelAddTag();
            return;
        }
        const newTags = [...targetCard.tags, trimmed];
        isMutatingNote = true;
        errorBanner = null;
        try {
            const res = await patchNote(targetCard.note_id, { tags: newTags });
            const noteId = targetCard.note_id;
            liveCards = liveCards.map((c) =>
                c.note_id === noteId ? { ...c, tags: res.tags } : c,
            );
            cancelAddTag();
        } catch (e) {
            errorBanner = e instanceof Error ? e.message : "Tag add failed";
        } finally {
            isMutatingNote = false;
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

    /**
     * Phase 17-A: set the selected card's flag colour. Click the active
     * chip again to clear (server rounds to flag=0). Optimistic UI is
     * NOT used here — the chip strip is small enough that the round-
     * trip latency is acceptable, and we'd rather be honest about the
     * persisted state than flicker on PATCH failure.
     */
    async function setSelectedCardFlag(flag: number) {
        if (!selected || !liveCards) return;
        const targetCard = liveCards.find((c) => String(c.id) === selected.id);
        if (!targetCard) {
            errorBanner = "Flag unavailable on fake data";
            return;
        }
        // Clicking the active chip clears the flag (matches the desktop
        // browse pane's right-click contextmenu behaviour where "no flag"
        // is itself a menu entry).
        const next = targetCard.flag === flag ? 0 : flag;
        if (next === targetCard.flag) return;
        isMutatingFlag = true;
        errorBanner = null;
        try {
            const res = await postCardFlag(targetCard.id, next);
            liveCards = liveCards.map((c) =>
                c.id === res.id ? { ...c, flag: res.flag } : c,
            );
        } catch (e) {
            errorBanner = e instanceof Error ? e.message : "Flag update failed";
        } finally {
            isMutatingFlag = false;
        }
    }

    /**
     * Phase 19-D: move the selected card into a different deck. Posts
     * a one-element list to the bulk endpoint (forward-compat with
     * Phase 20 multi-select). Mirrors the deck change into liveCards
     * so the row's deck-name and the editor's deck pill update without
     * a refetch. Server's `moved=0` means the card was already in the
     * target deck (or it didn't exist) — treat as no-op rather than
     * surfacing an error, since the dropdown filter already excludes
     * the current deck.
     */
    async function moveSelectedToDeck(targetDeckId: number) {
        if (!selected || !liveCards || !liveDecks) return;
        const targetCard = liveCards.find((c) => String(c.id) === selected.id);
        if (!targetCard) {
            errorBanner = "Move unavailable on fake data";
            return;
        }
        const targetDeck = flattenDecks(liveDecks).find(
            (d) => d.id === targetDeckId,
        );
        if (!targetDeck) {
            errorBanner = "Target deck not found";
            return;
        }
        if (targetDeck.id === targetCard.deck_id) return;
        isMutatingMove = true;
        errorBanner = null;
        try {
            const res = await postMoveCards({
                card_ids: [targetCard.id],
                deck_id: targetDeckId,
            });
            if (res.moved > 0) {
                liveCards = liveCards.map((c) =>
                    c.id === targetCard.id
                        ? { ...c, deck_id: targetDeckId, deck_name: targetDeck.name }
                        : c,
                );
            }
        } catch (e) {
            errorBanner = e instanceof Error ? e.message : "Move failed";
        } finally {
            isMutatingMove = false;
        }
    }

    /**
     * Phase 20-B: bulk multi-select helpers. `toggleRowSelected` flips
     * a single row's membership in the selection Set; `toggleSelectAll`
     * adds or removes every currently-visible (i.e. filtered) card id
     * at once. Both reassign the Set wholesale so Svelte's reactivity
     * picks up the change. `clearSelection` collapses the selection
     * back to empty — surfaced as a toolbar button so the user can
     * exit bulk mode without unticking each row.
     */
    function toggleRowSelected(cardId: number) {
        const next = new Set(selectedIds);
        if (next.has(cardId)) {
            next.delete(cardId);
        } else {
            next.add(cardId);
        }
        selectedIds = next;
    }

    function toggleSelectAll() {
        const visibleIds = filtered
            .map((r) => Number(r.id))
            .filter((id) => Number.isFinite(id) && id > 0);
        if (visibleIds.length === 0) return;
        const allSelected = visibleIds.every((id) => selectedIds.has(id));
        const next = new Set(selectedIds);
        if (allSelected) {
            for (const id of visibleIds) next.delete(id);
        } else {
            for (const id of visibleIds) next.add(id);
        }
        selectedIds = next;
    }

    function clearSelection() {
        if (selectedIds.size === 0) return;
        selectedIds = new Set();
    }

    /**
     * Phase 20-B: bulk suspend / unsuspend. Posts the current
     * selection to /api/cards/bulk_suspend, then re-fetches the
     * current page so row state labels reflect the persisted
     * change. Re-fetch (rather than optimistic mirror) keeps the
     * server-canonical state authoritative — the cheaper mirror
     * we use for single-card flips is fine for one row but would
     * skew if a partial-hit bulk skipped some unknown ids.
     */
    async function bulkSuspendSelected(suspended: boolean) {
        if (selectedIds.size === 0 || isMutatingBulk) return;
        const ids = Array.from(selectedIds);
        isMutatingBulk = true;
        errorBanner = null;
        try {
            await bulkSuspend(ids, suspended);
            const res = await fetchCards(query, PAGE_SIZE, pageOffset);
            liveCards = res.cards;
            liveTotal = res.total;
            // Drop ids that no longer match the current page from the
            // selection set — server-canonical row list is the source
            // of truth, so a row that scrolled off the page should
            // exit the selection too.
            const visibleIds = new Set(res.cards.map((c) => c.id));
            selectedIds = new Set(
                Array.from(selectedIds).filter((id) => visibleIds.has(id)),
            );
        } catch (e) {
            errorBanner = e instanceof Error ? e.message : "Bulk suspend failed";
        } finally {
            isMutatingBulk = false;
        }
    }

    /**
     * Phase 20-B: bulk flag set/clear. Posts the current selection
     * plus a 0..=7 flag value to /api/cards/bulk_flag, then re-fetches
     * the current page so row-flag rendering stays canonical. Same
     * re-fetch rationale as `bulkSuspendSelected`.
     */
    async function bulkFlagSelected(flag: number) {
        if (selectedIds.size === 0 || isMutatingBulk) return;
        const ids = Array.from(selectedIds);
        isMutatingBulk = true;
        errorBanner = null;
        try {
            await bulkFlag(ids, flag);
            const res = await fetchCards(query, PAGE_SIZE, pageOffset);
            liveCards = res.cards;
            liveTotal = res.total;
            const visibleIds = new Set(res.cards.map((c) => c.id));
            selectedIds = new Set(
                Array.from(selectedIds).filter((id) => visibleIds.has(id)),
            );
        } catch (e) {
            errorBanner = e instanceof Error ? e.message : "Bulk flag failed";
        } finally {
            isMutatingBulk = false;
        }
    }

    /**
     * Phase 19-A: hydrate the Card Templates panel for the currently
     * selected note's notetype. Lazy — only fires when the panel is
     * actually open or the user explicitly opens it for a notetype
     * we haven't loaded yet. Re-fires when the user clicks a row with
     * a different notetype while the panel is open. Failures surface
     * via `templatesError` (panel-local) so a flaky notetype fetch
     * doesn't poison the editor's main `errorBanner`.
     */
    async function loadTemplatesIfNeeded() {
        if (!templatesPanelOpen) return;
        if (currentNotetypeId === null) {
            liveTemplates = null;
            qfmtDrafts = [];
            afmtDrafts = [];
            templatesLoadedFor = null;
            return;
        }
        if (templatesLoadedFor === currentNotetypeId && liveTemplates) return;
        const targetId = currentNotetypeId;
        templatesError = null;
        try {
            const detail: ApiNotetypeDetail = await fetchNotetype(targetId);
            // Drop the response if the user navigated to a different
            // note (with a different notetype) before the fetch
            // resolved — same stale-response discard pattern as the
            // 12-A search debouncer.
            if (currentNotetypeId !== targetId) return;
            liveTemplates = detail.templates;
            qfmtDrafts = detail.templates.map((t) => t.qfmt);
            afmtDrafts = detail.templates.map((t) => t.afmt);
            templatesLoadedFor = targetId;
        } catch (e) {
            templatesError =
                e instanceof Error ? e.message : "Failed to load templates";
        }
    }

    /**
     * Phase 19-A: persist a single template's qfmt/afmt to the server.
     * Server's PATCH accepts a sparse list, so saving "just this row"
     * leaves siblings untouched — useful when a user is iterating on
     * one card layout without wanting to commit unfinished edits to
     * the other. Server returns the canonical post-write state for
     * every template; we re-seed all drafts so a concurrent edit
     * against the same notetype (in another tab) surfaces immediately
     * rather than getting silently overwritten on the next save.
     */
    async function saveTemplate(ord: number) {
        if (!liveTemplates || currentNotetypeId === null) return;
        const target = liveTemplates.find((t) => t.ord === ord);
        if (!target) return;
        const newQ = qfmtDrafts[ord] ?? "";
        const newA = afmtDrafts[ord] ?? "";
        if (newQ === target.qfmt && newA === target.afmt) return;
        isMutatingTemplate = true;
        templateSavingOrd = ord;
        templatesError = null;
        try {
            const detail = await patchNotetype(currentNotetypeId, {
                templates: [{ ord, qfmt: newQ, afmt: newA }],
            });
            liveTemplates = detail.templates;
            qfmtDrafts = detail.templates.map((t) => t.qfmt);
            afmtDrafts = detail.templates.map((t) => t.afmt);
            templatesLoadedFor = currentNotetypeId;
        } catch (e) {
            templatesError =
                e instanceof Error ? e.message : "Save template failed";
        } finally {
            isMutatingTemplate = false;
            templateSavingOrd = null;
        }
    }

    // Re-hydrate when the selected note's notetype changes while the
    // panel is open. Closed-panel transitions just invalidate the
    // cache — `loadTemplatesIfNeeded` is a no-op until the user opens
    // the disclosure.
    $effect(() => {
        if (currentNotetypeId !== templatesLoadedFor) {
            liveTemplates = null;
            qfmtDrafts = [];
            afmtDrafts = [];
            templatesLoadedFor = null;
            void loadTemplatesIfNeeded();
        }
    });

    // Phase 20-D: in-flight tracker for the history fetch. Plain JS
    // (not $state) because nothing reactive needs to read it — its
    // sole job is to prevent the card-switch $effect from firing a
    // duplicate request while the previous fetch is still pending.
    // Using $state here would re-trigger the effect on assignment
    // and defeat the purpose.
    let historyInFlightFor: number | null = null;

    /**
     * Phase 20-D: hydrate the Review History panel for the currently
     * selected card. Lazy — only fires when the disclosure is open
     * AND we don't already have a fresh snapshot (or a pending
     * request) for this card. Live mode only: in fake-data mode
     * there's no numeric card id so the disclosure is hidden via
     * the markup-level `Number.isFinite` guard. Mirrors the Phase
     * 19-A loadTemplatesIfNeeded shape so the lazy + stale-discard
     * logic stays consistent across both panels.
     */
    async function loadHistoryIfNeeded() {
        if (!historyPanelOpen) return;
        const cardIdStr = selected?.id ?? null;
        const cardIdNum = cardIdStr === null ? null : Number(cardIdStr);
        if (cardIdNum === null || !Number.isFinite(cardIdNum)) {
            historyEntries = null;
            historyLoadedFor = null;
            return;
        }
        if (historyLoadedFor === cardIdNum && historyEntries) return;
        // Dedup: if the same card already has a request in flight,
        // skip the duplicate. This guards the card-switch $effect
        // from firing twice when it re-runs after `historyLoadedFor`
        // is reset to null (the reset itself is a tracked write).
        if (historyInFlightFor === cardIdNum) return;
        const targetId = cardIdNum;
        historyInFlightFor = targetId;
        historyError = null;
        historyLoading = true;
        try {
            const res = await getCardHistory(targetId);
            // Drop the response if the user navigated to a different
            // card before the fetch resolved — same stale-response
            // discard pattern as the templates panel and the 12-A
            // search debouncer.
            const stillCardIdStr = selected?.id ?? null;
            const stillCardIdNum =
                stillCardIdStr === null ? null : Number(stillCardIdStr);
            if (stillCardIdNum !== targetId) return;
            historyEntries = res.entries;
            historyLoadedFor = targetId;
        } catch (e) {
            historyError =
                e instanceof Error ? e.message : "Failed to load history";
        } finally {
            historyLoading = false;
            if (historyInFlightFor === targetId) historyInFlightFor = null;
        }
    }

    // Invalidate the history cache when the selected card changes.
    // Closed-panel transitions just clear the snapshot —
    // `loadHistoryIfNeeded` is a no-op until the disclosure opens.
    $effect(() => {
        const cardIdStr = selected?.id ?? null;
        const cardIdNum = cardIdStr === null ? null : Number(cardIdStr);
        if (cardIdNum !== historyLoadedFor) {
            historyEntries = null;
            historyLoadedFor = null;
            void loadHistoryIfNeeded();
        }
    });

    /**
     * Phase 20-D format helpers — kept inline (not in $lib) because
     * they're tied to this disclosure's column layout. Tests cover
     * the disclosure's open/fetch behaviour, not these formatters
     * directly (the assertion grain is row count + fetch arg).
     */
    function formatHistoryTimestamp(idMs: number): string {
        // Tight YYYY-MM-DD HH:MM. Date is ms-epoch from rslib's
        // RevlogId. toLocaleString is locale-specific and noisier;
        // a fixed format keeps the column width stable across rows.
        const d = new Date(idMs);
        const pad = (n: number) => String(n).padStart(2, "0");
        return (
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
            `${pad(d.getHours())}:${pad(d.getMinutes())}`
        );
    }

    function formatHistoryInterval(days: number): string {
        // rslib sign convention: positive = days, negative = seconds
        // (sub-day reviews stored as negated seconds). Strip the sign
        // before printing so the unit suffix carries the meaning.
        if (days === 0) return "—";
        if (days > 0) return `${days}d`;
        return `${-days}s`;
    }

    function formatHistoryEase(percent: number): string {
        // 0 means the row never carried an ease (manual reschedule,
        // historical data); print an em-dash instead of "0%" so the
        // empty case reads as absence rather than a real zero.
        if (percent === 0) return "—";
        return `${percent}%`;
    }

    function formatHistoryTaken(ms: number): string {
        if (ms <= 0) return "—";
        if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
        return `${ms}ms`;
    }

    // Capitalize wire labels for display in the chip column. The
    // server ships lowercase (stable enum values); the UI presents
    // them with first-letter capitalization for readability without
    // forcing the server to ship two parallel string sets.
    function formatButtonLabel(label: string): string {
        if (label.length === 0) return label;
        return label[0]!.toUpperCase() + label.slice(1);
    }
</script>

<svelte:head><title>Browse — Ferdinand</title></svelte:head>

<div class="sketch-skin grain page bx-page" data-testid="browse-root">
    <!-- inner sidebar (tree) — Phase A4-ε₁ sketch-skin port -->
    <aside class="bx-sidebar" data-testid="browse-sidebar">
        <Brand testid="browse-brand" />

        <div class="bx-section">
            <button
                type="button"
                class="bx-section-title"
                onclick={() => toggle("decks")}
                aria-expanded={openSection.decks}
            >
                <Caption>decks</Caption>
            </button>
            {#if openSection.decks}
                {#if !decksReady}
                    <div
                        class="bx-section-body bx-skel-list"
                        data-testid="browse-deck-skeleton"
                        aria-hidden="true"
                    >
                        <div class="bx-deck-row bx-deck-skel"><span class="bx-skel-bar"></span></div>
                        <div class="bx-deck-row bx-deck-skel"><span class="bx-skel-bar bx-skel-bar-2"></span></div>
                        <div class="bx-deck-row bx-deck-skel"><span class="bx-skel-bar bx-skel-bar-3"></span></div>
                    </div>
                {:else}
                <div class="bx-section-body" data-testid="browse-deck-list">
                    {#each treeRows as d (d.id)}
                        {#if treeEditingDeckId === d.id}
                            <div class="bx-deck-row bx-deck-edit">
                                <input
                                    bind:this={treeDeckInput}
                                    bind:value={treeDeckDraft}
                                    class="bx-tree-rename mono"
                                    aria-label="Rename deck"
                                    disabled={isMutatingTreeDeck}
                                    onkeydown={(e) => {
                                        if (e.key === "Enter") commitEditTreeDeck();
                                        else if (e.key === "Escape") cancelEditTreeDeck();
                                    }}
                                    onblur={commitEditTreeDeck}
                                />
                                <span class="bx-deck-count mono">{d.totalCards}</span>
                            </div>
                        {:else}
                            <div class="bx-deck-row">
                                <button
                                    type="button"
                                    class="bx-deck-btn mono"
                                    data-testid="sidebar-deck"
                                    onclick={() => (query = `deck:"${d.name}"`)}
                                    ondblclick={() => startEditTreeDeck(d.id, d.name)}
                                >
                                    <span class="bx-deck-name" title={d.name}>{d.name}</span>
                                    <span class="bx-deck-count">{d.totalCards}</span>
                                </button>
                                {#if liveDecks && typeof d.id === "number" && d.id !== 1}
                                    <button
                                        type="button"
                                        class="bx-row-x"
                                        disabled={treeDeletingDeckId !== null}
                                        onclick={() =>
                                            deleteTreeDeck(d.id as number, d.name)}
                                        aria-label="Delete deck {d.name}"
                                    >×</button>
                                {/if}
                            </div>
                        {/if}
                    {/each}
                </div>
                {/if}
            {/if}
        </div>

        <div class="bx-section">
            <div class="bx-section-title">
                <Caption>state</Caption>
            </div>
            <div class="bx-section-body" data-testid="browse-state-filters">
                {#each STATE_FILTERS as s (s.key)}
                    <button
                        type="button"
                        class="bx-state-row mono"
                        data-testid="sidebar-state-{s.key}"
                        onclick={() => (query = `is:${s.key}`)}
                    >
                        <span
                            class="bx-state-dot"
                            style:background={s.color}
                            aria-hidden="true"
                        ></span>
                        <span class="bx-state-label">{s.label}</span>
                        <span class="bx-state-count">{stateCounts[s.key] ?? 0}</span>
                    </button>
                {/each}
            </div>
        </div>

        <div class="bx-section">
            <button
                type="button"
                class="bx-section-title"
                onclick={() => toggle("tags")}
                aria-expanded={openSection.tags}
            >
                <Caption>tags</Caption>
            </button>
            {#if openSection.tags}
                <div class="bx-section-body bx-tag-cloud">
                    {#if !tagsReady}
                        <span class="bx-tag-pill bx-tag-skel" aria-hidden="true"></span>
                        <span class="bx-tag-pill bx-tag-skel bx-tag-skel-2" aria-hidden="true"></span>
                        <span class="bx-tag-pill bx-tag-skel" aria-hidden="true"></span>
                        <span class="bx-tag-pill bx-tag-skel bx-tag-skel-3" aria-hidden="true"></span>
                    {:else}
                        {#each sidebarTags.slice(0, 10) as t (t)}
                            <button
                                type="button"
                                class="bx-tag-pill mono"
                                data-testid="sidebar-tag"
                                onclick={() => (query = `tag:${t}`)}
                            >{t}</button>
                        {/each}
                    {/if}
                </div>
            {/if}
        </div>

        <div class="bx-section">
            <div class="bx-section-title bx-section-title-row">
                <button
                    type="button"
                    class="bx-section-toggle"
                    onclick={() => toggle("saved")}
                    aria-expanded={openSection.saved}
                >
                    <Caption>pinned searches</Caption>
                </button>
                {#if liveSaved !== null && !isCreatingSaved && openSection.saved}
                    <button
                        type="button"
                        class="bx-section-add"
                        onclick={startCreateSaved}
                        aria-label="Add saved search"
                    ><SketchPlus size={12} /></button>
                {/if}
            </div>
            {#if openSection.saved}
                <div class="bx-section-body">
                    {#if liveSaved !== null}
                        {#each liveSaved as s (s.name)}
                            <div class="bx-saved-row">
                                <button
                                    type="button"
                                    class="bx-saved-btn"
                                    onclick={() => (query = s.query)}
                                    aria-label="Run saved search: {s.name}"
                                >
                                    <span class="bx-saved-name mono">· {s.name}</span>
                                    <span class="bx-saved-q mono">{s.query}</span>
                                </button>
                                <button
                                    type="button"
                                    class="bx-row-x"
                                    disabled={savedDeletingName !== null}
                                    onclick={(e) => {
                                        e.stopPropagation();
                                        deleteSavedByName(s.name);
                                    }}
                                    aria-label="Delete saved search: {s.name}"
                                >×</button>
                            </div>
                        {/each}
                    {:else}
                        {#each savedSearches as s (s.id)}
                            <button type="button" class="bx-saved-btn">
                                <span class="bx-saved-name mono">· {s.name}</span>
                            </button>
                        {/each}
                    {/if}

                    {#if isCreatingSaved}
                        <div class="bx-saved-form" data-testid="sidebar-saved-form">
                            <input
                                bind:this={newSavedNameInput}
                                bind:value={newSavedName}
                                class="bx-saved-input mono"
                                type="text"
                                placeholder="Name"
                                disabled={isMutatingSaved}
                                aria-label="New saved search name"
                                onkeydown={(e) => {
                                    if (e.key === "Enter") commitCreateSaved();
                                    else if (e.key === "Escape") cancelCreateSaved();
                                }}
                            />
                            <input
                                bind:value={newSavedQuery}
                                class="bx-saved-input mono"
                                type="text"
                                placeholder="deck:N2 is:due"
                                disabled={isMutatingSaved}
                                aria-label="New saved search query"
                                onkeydown={(e) => {
                                    if (e.key === "Enter") commitCreateSaved();
                                    else if (e.key === "Escape") cancelCreateSaved();
                                }}
                            />
                            <div class="bx-saved-actions">
                                <Btn
                                    kind="primary"
                                    size="sm"
                                    disabled={isMutatingSaved}
                                    onclick={commitCreateSaved}
                                >save</Btn>
                                <Btn
                                    kind="ghost"
                                    size="sm"
                                    disabled={isMutatingSaved}
                                    onclick={cancelCreateSaved}
                                >cancel</Btn>
                            </div>
                        </div>
                    {/if}

                    {#if savedError}
                        <div class="bx-saved-error mono" role="alert">{savedError}</div>
                    {/if}
                </div>
            {/if}
        </div>

        <!-- Pinned to the bottom — mirrors browse.jsx's BrowseSidebar
             "back to decks" affordance so the filter pane reads as a
             sibling of the global nav rail (which carries its own footer). -->
        <div class="bx-sidebar-foot">
            <Btn kind="ghost" size="sm" href="/" data-testid="browse-back-to-decks">
                {#snippet leading()}<SketchBook size={14} />{/snippet}
                back to decks
            </Btn>
        </div>
    </aside>

    <!-- results pane -->
    <main class="bx-main">
        <header class="bx-hero" data-testid="browse-hero">
            <div class="bx-hero-left">
                <Caption>the.card.archive</Caption>
                <h1 class="page-title" data-testid="browse-title">
                    browse
                    <span class="page-title-hand hand" aria-hidden="true">everything</span>
                </h1>
                <p class="page-subtitle">
                    {liveTotal ?? "—"} cards across {decksReady ? treeRows.length : "—"} deck{decksReady && treeRows.length === 1 ? "" : "s"}
                </p>
            </div>
            <div class="bx-hero-right">
                <Btn kind="outline" size="sm" disabled aria-label="Import (coming soon)">
                    {#snippet leading()}<SketchPlus size={12} />{/snippet}
                    import
                </Btn>
                <Btn kind="primary" size="sm" href="/notes/new">
                    {#snippet leading()}<SketchPlus size={12} />{/snippet}
                    new note
                </Btn>
            </div>
        </header>

        <!--
            Phase A4-ζ — sketch-skin chip-token toolbar. Renders parsed
            chips for committed `query` tokens; live `pendingInput`
            buffer auto-commits on Enter / closing-quote / trailing
            space after a complete token. Filter / save-search / count
            sit to the right; pagination tucked below on mobile.
        -->
        <div class="bx-toolbar" data-testid="browse-toolbar">
            <div
                class="bx-searchbar"
                data-testid="browse-toolbar-search"
                role="search"
            >
                <SketchSearch size={14} />
                {#each parseQueryChips(query) as chip, i (i + ":" + chip.raw)}
                    <button
                        type="button"
                        class="bx-chip bx-chip-{chip.kind} mono"
                        onclick={(e) => {
                            e.stopPropagation();
                            removeChipAt(i);
                        }}
                        aria-label="Remove {chip.raw}"
                        data-testid="browse-toolbar-chip"
                    >{chip.raw}</button>
                {/each}
                <input
                    bind:this={toolbarSearchInput}
                    bind:value={pendingInput}
                    oninput={maybeAutoCommit}
                    onkeydown={onToolbarKeydown}
                    type="search"
                    class="bx-search-input mono"
                    placeholder={parseQueryChips(query).length === 0
                        ? "deck:N2  tag:leech  added:1 …"
                        : ""}
                    aria-label="Search cards"
                    data-testid="browse-toolbar-input"
                />
                <span class="bx-cursor" aria-hidden="true"></span>
                <span class="bx-kbd-hint mono" aria-hidden="true">⌘K</span>
            </div>
            <Btn
                kind="outline"
                size="sm"
                onclick={openFilterSheet}
                data-testid="browse-toolbar-filter"
            >
                {#snippet leading()}<SketchPlus size={12} />{/snippet}
                filter
            </Btn>
            <Btn
                kind="paper"
                size="sm"
                onclick={startCreateSavedFromToolbar}
                data-testid="browse-toolbar-save-search"
            >save search</Btn>
            <div
                class="bx-toolbar-paginate"
                role="group"
                aria-label="Pagination"
                data-testid="browse-toolbar-paginate"
            >
                <Btn
                    kind="ghost"
                    size="sm"
                    disabled={!canPrev}
                    onclick={() => goPage(pageOffset - PAGE_SIZE)}
                    aria-label="Previous page"
                >‹ prev</Btn>
                <span
                    class="bx-toolbar-count mono"
                    aria-live="polite"
                    data-testid="browse-toolbar-count"
                >{countTagText}</span>
                <Btn
                    kind="ghost"
                    size="sm"
                    disabled={!canNext}
                    onclick={() => goPage(pageOffset + PAGE_SIZE)}
                    aria-label="Next page"
                >next ›</Btn>
            </div>
        </div>

        <!--
            ζ filter sheet — modal dialog with state chip toggles + tag
            multi-select. Seeds draft from current query so reopening
            doesn't blow selections away; apply rebuilds is:/tag: chips
            without touching deck:/text chips.
        -->
        {#if filterSheetOpen}
            <div
                class="bx-filter-backdrop"
                role="presentation"
                onclick={closeFilterSheet}
            ></div>
            <div
                class="bx-filter-sheet"
                data-testid="browse-filter-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="bx-filter-title"
            >
                <header class="bx-filter-header">
                    <Caption
                        ><span id="bx-filter-title">filters</span></Caption
                    >
                    <Btn
                        kind="ghost"
                        size="sm"
                        onclick={closeFilterSheet}
                        aria-label="Close filters"
                        data-testid="browse-filter-close"
                    >×</Btn>
                </header>
                <div class="bx-filter-body">
                    <section class="bx-filter-row">
                        <Caption>state</Caption>
                        <div class="bx-filter-chips">
                            {#each STATE_FILTERS as s}
                                <button
                                    type="button"
                                    class="bx-filter-chip mono"
                                    class:active={filterDraftStates.includes(
                                        s.key,
                                    )}
                                    style="--chip-color: {s.color}"
                                    onclick={() => toggleDraftState(s.key)}
                                    data-testid="browse-filter-state-{s.key}"
                                >
                                    <span
                                        class="bx-filter-chip-dot"
                                        aria-hidden="true"
                                    ></span>
                                    {s.label}
                                </button>
                            {/each}
                        </div>
                    </section>
                    {#if (liveTags ?? []).length > 0}
                        <section class="bx-filter-row">
                            <Caption>tags</Caption>
                            <div class="bx-filter-chips">
                                {#each liveTags ?? [] as t}
                                    <button
                                        type="button"
                                        class="bx-filter-chip mono"
                                        class:active={filterDraftTags.includes(
                                            t,
                                        )}
                                        onclick={() => toggleDraftTag(t)}
                                        data-testid="browse-filter-tag"
                                    >· {t}</button>
                                {/each}
                            </div>
                        </section>
                    {/if}
                </div>
                <footer class="bx-filter-footer">
                    <Btn
                        kind="ghost"
                        size="sm"
                        onclick={resetFilterSheet}
                        data-testid="browse-filter-reset"
                    >reset</Btn>
                    <Btn
                        kind="primary"
                        size="sm"
                        onclick={applyFilterSheet}
                        data-testid="browse-filter-apply"
                    >apply</Btn>
                </footer>
            </div>
        {/if}

        <!--
            Phase 20-B: select-all + bulk toolbar. The header strip is
            always rendered (so the master checkbox sits in a stable
            slot above the rows), but the action toolbar only appears
            when the selection is non-empty — keeps the chrome quiet
            during single-card editing.
        -->
        <div class="select-strip">
            <label class="select-all-label">
                <input
                    type="checkbox"
                    class="select-all"
                    aria-label="Select all visible cards"
                    checked={allVisibleSelected}
                    indeterminate={someVisibleSelected}
                    disabled={visibleNumericIds.length === 0 || isMutatingBulk}
                    onchange={toggleSelectAll}
                />
                <span class="select-all-text">
                    {#if selectedIds.size === 0}
                        Select all
                    {:else}
                        {selectedIds.size} selected
                    {/if}
                </span>
            </label>
            {#if selectedIds.size > 0}
                <div class="bulk-toolbar" role="toolbar" aria-label="Bulk actions">
                    <button
                        class="bulk-btn"
                        type="button"
                        disabled={isMutatingBulk}
                        onclick={() => bulkSuspendSelected(true)}
                    >Suspend</button>
                    <button
                        class="bulk-btn"
                        type="button"
                        disabled={isMutatingBulk}
                        onclick={() => bulkSuspendSelected(false)}
                    >Unsuspend</button>
                    <div class="bulk-flag-strip" role="radiogroup" aria-label="Bulk flag">
                        <button
                            type="button"
                            class="bulk-flag-chip clear"
                            aria-label="Clear flag"
                            title="Clear flag"
                            disabled={isMutatingBulk}
                            onclick={() => bulkFlagSelected(0)}
                        >∅</button>
                        {#each [
                            { value: 1, label: "Red", color: "var(--flag-1)" },
                            { value: 2, label: "Orange", color: "var(--flag-2)" },
                            { value: 3, label: "Green", color: "var(--flag-3)" },
                            { value: 4, label: "Blue", color: "var(--flag-4)" },
                            { value: 5, label: "Pink", color: "var(--flag-5)" },
                            { value: 6, label: "Turquoise", color: "var(--flag-6)" },
                            { value: 7, label: "Purple", color: "var(--flag-7)" },
                        ] as chip (chip.value)}
                            <button
                                type="button"
                                class="bulk-flag-chip"
                                aria-label="Flag {chip.label}"
                                title="Flag {chip.label}"
                                style="--flag-color: {chip.color}"
                                disabled={isMutatingBulk}
                                onclick={() => bulkFlagSelected(chip.value)}
                            ></button>
                        {/each}
                    </div>
                    <button
                        class="bulk-btn bulk-btn-clear"
                        type="button"
                        onclick={clearSelection}
                    >Clear selection</button>
                </div>
            {/if}
        </div>

        <!-- 7-column sketch-skin table — Phase A4-ε₁ -->
        <div class="bx-table" role="table" aria-label="Cards" data-testid="browse-table">
            <div class="bx-table-head mono" role="row">
                <span class="bx-col-check" role="columnheader" aria-hidden="true"></span>
                <span class="bx-col-num" role="columnheader">#</span>
                <span class="bx-col-glyph" role="columnheader" aria-label="type"></span>
                <span class="bx-col-front" role="columnheader">front</span>
                <span class="bx-col-back" role="columnheader">back</span>
                <span class="bx-col-deck" role="columnheader">deck</span>
                <span class="bx-col-tags" role="columnheader">tags</span>
                <span class="bx-col-due" role="columnheader">due</span>
            </div>

            <div class="bx-table-body" role="rowgroup">
                {#if loading}
                    {#each [0, 1, 2, 3, 4] as i (i)}
                        <BrowseRowSkeleton />
                    {/each}
                {:else if filtered.length === 0}
                    <div
                        class="bx-empty mono"
                        role="status"
                        aria-live="polite"
                        data-testid="browse-empty"
                    >
                        <div class="bx-empty-title">no cards match</div>
                        <div class="bx-empty-hint">
                            try a broader query, or
                            <button
                                type="button"
                                class="bx-empty-action"
                                onclick={clearQuery}
                            >clear the search</button>.
                        </div>
                    </div>
                {:else}
                    {#each filtered as r, i (r.id)}
                        {@const numericId = Number(r.id)}
                        {@const idValid = Number.isFinite(numericId) && numericId > 0}
                        {@const isSelected = selected?.id === r.id}
                        {@const isChecked = idValid && selectedIds.has(numericId)}
                        <div
                            class="bx-row"
                            class:selected={isSelected}
                            class:checked={isChecked}
                            role="row"
                            data-testid="browse-row"
                            data-card-id={r.id}
                        >
                            <span class="bx-col-check" role="cell">
                                <input
                                    type="checkbox"
                                    class="row-check bx-row-check"
                                    aria-label="Select card {r.id}"
                                    checked={isChecked}
                                    disabled={!idValid || isMutatingBulk}
                                    onchange={() =>
                                        idValid && toggleRowSelected(numericId)}
                                />
                            </span>
                            <button
                                type="button"
                                class="bx-row-btn"
                                aria-label="Open card {r.id}"
                                data-testid="browse-row-btn"
                                onclick={() => selectRow(i)}
                            >
                                <span class="bx-col-num mono">
                                    {String(i + 1 + pageOffset).padStart(3, "0")}
                                </span>
                                <span class="bx-col-glyph mono">
                                    {glyphFor(r.deckName)}
                                </span>
                                <span class="bx-col-front">
                                    <span class="bx-front-text">
                                        {r.frontSnippet || "(empty front)"}
                                    </span>
                                </span>
                                <span class="bx-col-back mono">
                                    {r.backSnippet || ""}
                                </span>
                                <span class="bx-col-deck mono">{r.deckName}</span>
                                <span class="bx-col-tags">
                                    {#each r.tags.slice(0, 2) as t (t)}
                                        <span class="bx-tag-chip mono">{t}</span>
                                    {/each}
                                    {#if r.tags.length > 2}
                                        <span class="bx-tag-chip bx-tag-chip-more mono"
                                            >+{r.tags.length - 2}</span
                                        >
                                    {/if}
                                </span>
                                <span
                                    class="bx-col-due mono"
                                    class:bx-due-now={r.due === "now"}
                                >{r.due}</span>
                            </button>
                        </div>
                    {/each}
                {/if}
            </div>

            <div class="bx-table-foot mono">
                <Caption>{filtered.length} of {liveTotal ?? rows.length} · sorted by due asc</Caption>
                <div class="bx-table-keys">
                    <span>↑↓ navigate</span>
                    <span>↵ open</span>
                    <span>e edit</span>
                    <span>⌫ delete</span>
                </div>
            </div>
        </div>
    </main>

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

        {#each currentFieldLabels as label, i (i)}
            {@const slug = fieldSlug(label)}
            <div class="field">
                <label for="field-{slug}">{label}</label>
                <textarea
                    id="field-{slug}"
                    class="field-value"
                    bind:value={fieldDrafts[i]}
                    disabled={isMutatingNote || !liveCards}
                    aria-label={label}
                    onblur={commitFields}
                ></textarea>
            </div>
        {/each}

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
                <span class="meta-key">Move to</span>
                {#if liveDecks === null || selected?.deckId == null}
                    <span class="meta-val subtle">Offline — move locked</span>
                {:else if moveCandidates.length === 0}
                    <span class="meta-val subtle">No other decks</span>
                {:else}
                    <select
                        class="preset-sel"
                        value=""
                        disabled={isMutatingMove}
                        onchange={(e) => {
                            const target = e.currentTarget;
                            const id = Number(target.value);
                            if (Number.isFinite(id) && id > 0) {
                                moveSelectedToDeck(id);
                            }
                            target.value = "";
                        }}
                        aria-label="Move card to another deck"
                    >
                        <option value="" disabled>Pick a deck…</option>
                        {#each moveCandidates as d (d.id)}
                            <option value={d.id}>{d.name}</option>
                        {/each}
                    </select>
                {/if}
            </div>
            <div class="meta-row">
                <span class="meta-key">Tags</span>
                <div class="tag-edit">
                    {#each selected?.tags ?? [] as t (t)}
                        <button
                            type="button"
                            class="tag tag-removable"
                            disabled={isMutatingNote || !liveCards}
                            onclick={() => removeTag(t)}
                            aria-label="Remove tag {t}"
                        >#{t}<span class="x" aria-hidden="true">×</span></button>
                    {/each}
                    {#if isAddingTag}
                        <input
                            bind:this={tagInput}
                            bind:value={newTagDraft}
                            class="tag-input"
                            disabled={isMutatingNote}
                            aria-label="New tag"
                            onkeydown={(e) => {
                                if (e.key === "Enter") commitAddTag();
                                else if (e.key === "Escape") cancelAddTag();
                            }}
                            onblur={cancelAddTag}
                        />
                    {:else}
                        <button
                            type="button"
                            class="add-tag"
                            disabled={isMutatingNote || !liveCards}
                            onclick={startAddTag}
                        >+ Add</button>
                    {/if}
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

        <div class="flag-strip" role="radiogroup" aria-label="Card flag">
            {#each [
                { value: 1, label: "Red", color: "var(--flag-1)" },
                { value: 2, label: "Orange", color: "var(--flag-2)" },
                { value: 3, label: "Green", color: "var(--flag-3)" },
                { value: 4, label: "Blue", color: "var(--flag-4)" },
                { value: 5, label: "Pink", color: "var(--flag-5)" },
                { value: 6, label: "Turquoise", color: "var(--flag-6)" },
                { value: 7, label: "Purple", color: "var(--flag-7)" },
            ] as chip (chip.value)}
                <button
                    type="button"
                    role="radio"
                    aria-checked={selected?.flag === chip.value}
                    aria-label={chip.label}
                    title={selected?.flag === chip.value ? `${chip.label} (click to clear)` : chip.label}
                    class="flag-chip"
                    class:active={selected?.flag === chip.value}
                    style="--flag-color: {chip.color}"
                    disabled={isMutatingFlag}
                    onclick={() => setSelectedCardFlag(chip.value)}
                ></button>
            {/each}
        </div>

        <!--
            Phase 19-A: Card Templates panel. Closed by default — a
            note edit and a notetype edit have very different blast
            radius (the latter affects every card sharing the
            notetype), so the disclosure is opt-in. Hidden entirely
            when there's no live notetype id (fake-data mode or
            offline) so we don't show editable surfaces backed by no
            persistence path.
        -->
        {#if currentNotetypeId !== null}
            <details
                class="templates-panel"
                bind:open={templatesPanelOpen}
                ontoggle={() => {
                    // Native <details> flips `open` BEFORE firing
                    // `toggle`, so by the time this handler runs the
                    // bound `templatesPanelOpen` already reflects the
                    // new state. Lazy-load on first open (or on a
                    // re-open after the user picked a different
                    // notetype-bearing note in the row list).
                    if (templatesPanelOpen) void loadTemplatesIfNeeded();
                }}
            >
                <summary class="templates-summary">
                    <span>Card Templates</span>
                    {#if liveTemplates}
                        <span class="templates-count">· {liveTemplates.length}</span>
                    {/if}
                </summary>
                <p class="templates-hint">
                    Edits affect every card on this notetype.
                </p>
                {#if templatesError}
                    <div class="templates-error" role="alert">{templatesError}</div>
                {/if}
                {#if liveTemplates === null && templatesError === null}
                    <div class="templates-loading">Loading templates…</div>
                {:else if liveTemplates}
                    {#each liveTemplates as tpl, i (tpl.ord)}
                        <div class="template-row">
                            <div class="template-name">
                                {tpl.name || `Card ${tpl.ord + 1}`}
                            </div>
                            <label class="template-label" for="qfmt-{tpl.ord}">
                                Question
                            </label>
                            <textarea
                                id="qfmt-{tpl.ord}"
                                class="template-textarea"
                                bind:value={qfmtDrafts[i]}
                                disabled={isMutatingTemplate}
                                aria-label="Question template for {tpl.name ||
                                    `Card ${tpl.ord + 1}`}"
                            ></textarea>
                            <label class="template-label" for="afmt-{tpl.ord}">
                                Answer
                            </label>
                            <textarea
                                id="afmt-{tpl.ord}"
                                class="template-textarea"
                                bind:value={afmtDrafts[i]}
                                disabled={isMutatingTemplate}
                                aria-label="Answer template for {tpl.name ||
                                    `Card ${tpl.ord + 1}`}"
                            ></textarea>
                            <button
                                class="ghost-btn template-save"
                                disabled={isMutatingTemplate ||
                                    (qfmtDrafts[i] === tpl.qfmt &&
                                        afmtDrafts[i] === tpl.afmt)}
                                onclick={() => saveTemplate(tpl.ord)}
                            >
                                {templateSavingOrd === tpl.ord
                                    ? "Saving…"
                                    : "Save template"}
                            </button>
                        </div>
                    {/each}
                {/if}
            </details>
        {/if}

        <!--
            Phase 20-D: Review History panel. Closed by default — the
            payload is potentially long and is only useful for the
            user who explicitly wants to inspect a card's revlog. Shown
            only in live mode (selected card has a numeric id from the
            server); fake-data rows have string-prefixed ids so the
            disclosure stays hidden when there's no real backing card.
        -->
        {#if liveCards !== null && selected && Number.isFinite(Number(selected.id))}
            <details
                class="history-panel"
                bind:open={historyPanelOpen}
                ontoggle={() => {
                    // Lazy-load on first open. Native <details> flips
                    // `open` BEFORE firing toggle, so by the time this
                    // handler runs `historyPanelOpen` already reflects
                    // the new state — same pattern as the templates
                    // disclosure above.
                    if (historyPanelOpen) void loadHistoryIfNeeded();
                }}
            >
                <summary class="history-summary">
                    <span>Review History</span>
                    {#if historyEntries}
                        <span class="history-count">· {historyEntries.length}</span>
                    {/if}
                </summary>
                {#if historyError}
                    <div class="history-error" role="alert">{historyError}</div>
                {:else if historyLoading && historyEntries === null}
                    <div class="history-loading">Loading…</div>
                {:else if historyEntries === null}
                    <!-- Panel just opened; load is pending. Render
                         nothing rather than a flash of "No reviews"
                         that would be wrong for a card with revlog. -->
                    <div class="history-loading">Loading…</div>
                {:else if historyEntries.length === 0}
                    <div class="history-empty">No reviews yet</div>
                {:else}
                    <ul class="history-list">
                        {#each historyEntries as entry (entry.id)}
                            <li class="history-row">
                                <span class="history-time">
                                    {formatHistoryTimestamp(entry.id)}
                                </span>
                                <span
                                    class="history-button"
                                    data-button={entry.button_label}
                                >
                                    {formatButtonLabel(entry.button_label)} ({entry.button})
                                </span>
                                <span class="history-arrow">→</span>
                                <span class="history-interval">
                                    {formatHistoryInterval(entry.interval_days)}
                                </span>
                                <span class="history-ease">
                                    ease {formatHistoryEase(entry.ease_percent)}
                                </span>
                                <span class="history-taken">
                                    {formatHistoryTaken(entry.taken_ms)}
                                </span>
                                <span class="history-kind">{entry.review_kind}</span>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </details>
        {/if}

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
            <button
                class="ghost-btn danger"
                disabled={isMutatingDelete}
                onclick={deleteSelectedNote}
            >
                {isMutatingDelete ? "Deleting…" : "Delete"}
            </button>
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
    .item-wrap {
        position: relative;
        display: flex;
        align-items: center;
    }
    .delete-x {
        position: absolute;
        right: var(--space-1);
        top: 50%;
        transform: translateY(-50%);
        width: 1.1rem;
        height: 1.1rem;
        line-height: 1;
        font-size: 0.95rem;
        color: var(--text-subtle);
        background: transparent;
        border-radius: var(--radius-sm);
        opacity: 0;
        transition:
            opacity var(--duration-fast) var(--ease),
            color var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease);
    }
    .delete-x:hover {
        color: #c0392b;
        background: var(--bg-hover);
    }
    .delete-x:disabled {
        opacity: 0;
        cursor: not-allowed;
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

    /* Results */
    .results {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        border-right: 1px solid var(--rule);
    }
    /* Phase A4-ζ: legacy .toolbar/.search/.filters/.pill/.count-tag
       chrome was here — replaced by .bx-toolbar / .bx-searchbar /
       .bx-chip / .bx-toolbar-count further down the stylesheet. */

    /* Phase 20-B: bulk-select strip + toolbar. The strip is sticky
       below the search/pagination toolbar so the master checkbox and
       per-row counts stay reachable while the row list scrolls. */
    .select-strip {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-2) var(--space-6);
        border-bottom: 1px solid var(--rule);
        background: var(--bg-soft);
        flex-wrap: wrap;
        position: sticky;
        top: 0;
        z-index: 2;
    }
    .select-all-label {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-xs);
        color: var(--ink-soft);
        cursor: pointer;
    }
    .select-all-label input[type="checkbox"] {
        cursor: pointer;
    }
    .select-all-label input[type="checkbox"]:disabled {
        cursor: not-allowed;
    }
    .select-all-text {
        font-variant-numeric: tabular-nums;
    }
    .bulk-toolbar {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
        margin-left: auto;
    }
    .bulk-btn {
        padding: 0.3rem 0.7rem;
        font-size: var(--text-xs);
        font-weight: 500;
        background: var(--paper);
        border: 1px solid var(--rule);
        border-radius: var(--radius);
        color: var(--ink);
        cursor: pointer;
        transition:
            border-color var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease);
    }
    .bulk-btn:hover:not(:disabled) {
        border-color: var(--ink);
        background: var(--bg-deep);
    }
    .bulk-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .bulk-btn-clear {
        color: var(--ink-mute);
    }
    .bulk-flag-strip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 6px;
        background: var(--paper);
        border: 1px solid var(--rule);
        border-radius: var(--radius);
    }
    .bulk-flag-chip {
        width: 18px;
        height: 18px;
        border-radius: var(--radius-pill);
        background: var(--flag-color, var(--bg-soft));
        border: 1px solid color-mix(in oklch, var(--flag-color, var(--rule)) 70%, transparent);
        cursor: pointer;
        padding: 0;
        transition:
            transform var(--duration-fast) var(--ease),
            box-shadow var(--duration-fast) var(--ease);
    }
    .bulk-flag-chip:hover:not(:disabled) {
        transform: scale(1.1);
        box-shadow: var(--shadow-stamp-sm);
    }
    .bulk-flag-chip:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .bulk-flag-chip.clear {
        background: var(--bg-soft);
        border: 1px dashed var(--ink);
        color: var(--ink-mute);
        font-size: 0.75rem;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    /* Phase A4-ε₁/ζ: legacy .row-wrap / .row-check / .list lived here —
       superseded by .bx-row* / .bx-table chrome in the ε₁ section. */

    .empty {
        margin: var(--space-8) auto;
        padding: var(--space-6);
        max-width: 320px;
        text-align: center;
        border: 1px dashed var(--rule);
        border-radius: var(--radius-md);
        background: var(--paper);
    }
    .empty-title {
        font-family: var(--font-mono);
        font-size: var(--text-lg);
        color: var(--ink);
        margin-bottom: var(--space-2);
    }
    .empty-hint {
        font-size: var(--text-sm);
        color: var(--ink-soft);
    }
    .empty-action {
        color: var(--accent);
        text-decoration: underline;
        text-underline-offset: 2px;
    }
    .empty-action:hover {
        color: var(--accent);
    }

    /* Editor */
    .editor {
        padding: var(--space-5) var(--space-6);
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
        background: var(--bg-soft);
        border-left: var(--border-w, 1.5px) solid var(--ink);
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
        color: var(--ink-mute);
        font-weight: 500;
    }
    .icon-btn {
        width: 26px;
        height: 26px;
        color: var(--ink-mute);
        border-radius: var(--radius);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition:
            color var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease);
    }
    .icon-btn:hover {
        background: var(--bg-deep);
        color: var(--ink);
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }
    .field label {
        font-size: 0.7rem;
        letter-spacing: 0.08em;
        color: var(--ink-mute);
        text-transform: uppercase;
        font-weight: 500;
    }
    .field-value {
        min-height: 44px;
        padding: var(--space-3);
        border: 1.2px solid var(--rule);
        border-radius: var(--radius-md);
        background: var(--paper);
        font-family: var(--font-cjk);
        font-size: var(--text-base);
        color: var(--ink);
        white-space: pre-wrap;
        outline: none;
        /* Phase 14-A: textarea-specific tweaks so the editing affordance
           still reads as a single-line-ish field at rest but expands as
           the user types. resize:vertical lets long fields breathe; the
           default `none` would make a back-of-paragraph note painful. */
        width: 100%;
        box-sizing: border-box;
        resize: vertical;
        transition:
            border-color var(--duration-fast) var(--ease),
            box-shadow var(--duration-fast) var(--ease);
    }
    .field-value:focus {
        border-color: var(--ink);
        box-shadow: var(--shadow-stamp-sm);
    }
    .field-value:disabled {
        opacity: 0.65;
        cursor: progress;
    }

    .meta {
        padding-top: var(--space-3);
        border-top: 1px solid var(--rule);
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
        color: var(--ink-mute);
        font-size: var(--text-xs);
    }
    .meta-val {
        color: var(--ink);
        font-variant-numeric: tabular-nums;
    }
    .pill-sel {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        padding: 3px 10px;
        border: 1px solid var(--rule);
        border-radius: var(--radius-pill);
        width: fit-content;
        font-size: var(--text-xs);
        color: var(--ink);
        transition:
            background var(--duration-fast) var(--ease),
            border-color var(--duration-fast) var(--ease);
    }
    .pill-sel:hover {
        background: var(--bg-deep);
        border-color: var(--ink);
    }
    /* Phase 11-A: native <select> styled to match the deck-pill so the
       editor row reads as one consistent meta column. */
    .preset-sel {
        padding: 3px 8px;
        border: 1px solid var(--rule);
        border-radius: var(--radius-pill);
        font-size: var(--text-xs);
        color: var(--ink);
        background: transparent;
        cursor: pointer;
        transition:
            background var(--duration-fast) var(--ease),
            border-color var(--duration-fast) var(--ease),
            opacity var(--duration-fast) var(--ease);
    }
    .preset-sel:hover {
        background: var(--bg-deep);
        border-color: var(--ink);
    }
    .preset-sel:disabled {
        opacity: 0.55;
        cursor: progress;
    }
    /* Phase A4-ζ: legacy .pagination / .page-btn:disabled lived here —
       replaced by .bx-toolbar-paginate (Btn ghost prev/next).        */

    .tag-edit {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
    }
    .tag {
        font-family: var(--font-mono);
        font-size: 0.7rem;
        color: var(--ink-mute);
        background: var(--bg-soft);
        padding: 1px 6px;
        border-radius: var(--radius);
    }
    /* Phase 14-A: tag chips render as <button> when removable so a
       click commits a remove-tag PATCH. The × glyph is visual-only —
       aria-label on the button carries the actionable text. */
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
        background: var(--bg-deep);
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
        border-radius: var(--radius);
        background: transparent;
        color: var(--ink);
        outline: none;
        min-width: 80px;
    }
    .add-tag {
        font-size: var(--text-xs);
        color: var(--ink-mute);
        padding: 1px 6px;
        border: 1px dashed var(--rule);
        border-radius: var(--radius);
        transition:
            color var(--duration-fast) var(--ease),
            border-color var(--duration-fast) var(--ease);
    }
    .add-tag:hover {
        color: var(--accent);
        border-color: var(--accent);
    }

    .flag-strip {
        display: flex;
        gap: 0.4rem;
        padding-top: var(--space-3);
        border-top: 1px solid var(--rule);
        align-items: center;
    }
    .flag-chip {
        width: 1.2rem;
        height: 1.2rem;
        border-radius: 50%;
        border: 1px solid var(--rule);
        background: transparent;
        cursor: pointer;
        padding: 0;
        transition:
            background var(--duration-fast) var(--ease),
            transform var(--duration-fast) var(--ease),
            border-color var(--duration-fast) var(--ease);
    }
    .flag-chip:hover:not(:disabled):not(.active) {
        background: color-mix(in oklch, var(--flag-color) 25%, transparent);
        border-color: var(--flag-color);
    }
    .flag-chip.active {
        background: var(--flag-color);
        border-color: var(--flag-color);
        transform: scale(1.1);
    }
    .flag-chip:disabled {
        opacity: 0.55;
        cursor: progress;
    }

    /* Phase 19-A: Card Templates disclosure. Less prominent than the
       per-field textareas — `templates` is a notetype-level edit so
       the visual weight steers users away from accidental mutation. */
    .templates-panel {
        margin-top: var(--space-3);
        padding: var(--space-3) 0;
        border-top: 1px solid var(--rule);
    }
    .templates-summary {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        font-size: var(--text-sm);
        color: var(--ink-soft);
        cursor: pointer;
        list-style: none;
    }
    .templates-summary::-webkit-details-marker {
        display: none;
    }
    .templates-summary::before {
        content: "›";
        display: inline-block;
        margin-right: var(--space-1);
        transition: transform var(--duration-fast) var(--ease);
    }
    .templates-panel[open] > .templates-summary::before {
        transform: rotate(90deg);
    }
    .templates-count {
        color: var(--ink-mute);
    }
    .templates-hint {
        margin: var(--space-2) 0 var(--space-3);
        font-size: var(--text-xs);
        color: var(--ink-mute);
    }
    .templates-error {
        margin-bottom: var(--space-2);
        padding: var(--space-2);
        font-size: var(--text-xs);
        color: var(--due);
        background: var(--bg-deep);
        border-radius: var(--radius);
    }
    .templates-loading {
        font-size: var(--text-xs);
        color: var(--ink-mute);
    }
    .template-row {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        padding: var(--space-2) 0;
        border-bottom: 1px dashed var(--rule);
    }
    .template-row:last-child {
        border-bottom: none;
    }
    .template-name {
        font-size: var(--text-sm);
        font-weight: 500;
        color: var(--ink);
        margin-bottom: var(--space-1);
    }
    .template-label {
        font-size: var(--text-xs);
        color: var(--ink-mute);
        margin-top: var(--space-1);
    }
    .template-textarea {
        min-height: 4rem;
        padding: var(--space-2);
        font-family: var(--font-mono, monospace);
        font-size: var(--text-xs);
        color: var(--ink);
        background: var(--bg-soft);
        border: 1px solid var(--rule);
        border-radius: var(--radius);
        resize: vertical;
    }
    .template-textarea:focus {
        outline: none;
        border-color: var(--ink);
    }
    .template-save {
        align-self: flex-end;
        margin-top: var(--space-2);
    }

    /* Phase 20-D: Review History disclosure. Same visual rhythm as the
       templates panel — closed-by-default, low-prominence summary so a
       casual user isn't drawn into a long log they don't need. The row
       layout is a single-line grid so a card with hundreds of reviews
       stays readable without runaway height. */
    .history-panel {
        margin-top: var(--space-3);
        padding: var(--space-3) 0;
        border-top: 1px solid var(--rule);
    }
    .history-summary {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        font-size: var(--text-sm);
        color: var(--ink-soft);
        cursor: pointer;
        list-style: none;
    }
    .history-summary::-webkit-details-marker {
        display: none;
    }
    .history-summary::before {
        content: "›";
        display: inline-block;
        margin-right: var(--space-1);
        transition: transform var(--duration-fast) var(--ease);
    }
    .history-panel[open] > .history-summary::before {
        transform: rotate(90deg);
    }
    .history-count {
        color: var(--ink-mute);
    }
    .history-error {
        margin-top: var(--space-2);
        padding: var(--space-2);
        font-size: var(--text-xs);
        color: var(--due);
        background: var(--bg-deep);
        border-radius: var(--radius);
    }
    .history-loading,
    .history-empty {
        margin-top: var(--space-2);
        font-size: var(--text-xs);
        color: var(--ink-mute);
    }
    .history-list {
        list-style: none;
        padding: 0;
        margin: var(--space-2) 0 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 18rem;
        overflow-y: auto;
    }
    .history-row {
        display: grid;
        grid-template-columns: auto auto auto auto auto auto 1fr;
        gap: var(--space-2);
        align-items: baseline;
        padding: 2px var(--space-2);
        font-size: var(--text-xs);
        color: var(--ink-soft);
        font-family: var(--font-mono, monospace);
        border-radius: var(--radius);
    }
    .history-row:hover {
        background: var(--bg-deep);
        color: var(--ink);
    }
    .history-time {
        color: var(--ink-mute);
    }
    .history-button {
        font-weight: 500;
    }
    .history-button[data-button="again"] {
        color: var(--due, #c0392b);
    }
    .history-button[data-button="hard"] {
        color: #c87f3a;
    }
    .history-button[data-button="good"] {
        color: #2e7d32;
    }
    .history-button[data-button="easy"] {
        color: var(--easy);
    }
    .history-button[data-button="manual"] {
        color: var(--ink-mute);
    }
    .history-arrow,
    .history-ease,
    .history-taken,
    .history-kind {
        color: var(--ink-mute);
    }
    .history-kind {
        text-align: right;
    }

    .editor-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
        padding-top: var(--space-3);
        border-top: 1px solid var(--rule);
    }
    .ghost-btn {
        padding: 0.4rem 0.75rem;
        font-size: var(--text-sm);
        color: var(--ink-soft);
        border: 1.2px solid var(--ink);
        border-radius: var(--radius);
        background: transparent;
        transition:
            color var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease),
            border-color var(--duration-fast) var(--ease),
            box-shadow var(--duration-fast) var(--ease);
    }
    .ghost-btn:hover {
        color: var(--ink);
        background: var(--paper);
        box-shadow: var(--shadow-stamp-sm);
    }
    .ghost-btn.danger {
        color: var(--due);
    }
    .ghost-btn.danger:hover {
        color: var(--due);
        border-color: var(--due);
    }
    .ghost-btn.active {
        color: var(--ink);
        background: var(--paper);
        border-color: var(--ink);
        box-shadow: var(--shadow-stamp-sm);
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
        color: var(--due);
        background: color-mix(in oklch, var(--due) 10%, transparent);
        border: 1px solid color-mix(in oklch, var(--due) 30%, transparent);
        border-radius: var(--radius);
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
        color: var(--ink);
        padding: 3px 10px;
        border: 1px solid var(--accent);
        border-radius: var(--radius-pill);
        outline: none;
        background: var(--paper);
        width: fit-content;
        max-width: 220px;
    }
    .deck-rename:disabled {
        opacity: 0.6;
        cursor: progress;
    }

    /* Phase 18-C: saved-search section. Same visual rhythm as the
       decks tree (.item / .item-wrap / .delete-x), with an inline
       create form below the list. */
    .saved-row {
        position: relative;
    }
    .saved-delete-btn {
        position: absolute;
        right: var(--space-1);
        top: 50%;
        transform: translateY(-50%);
        width: 1.1rem;
        height: 1.1rem;
        line-height: 1;
        font-size: 0.95rem;
        color: var(--text-subtle);
        background: transparent;
        border-radius: var(--radius-sm);
        opacity: 0;
        transition:
            opacity var(--duration-fast) var(--ease),
            color var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease);
    }
    .saved-delete-btn:hover {
        color: #c0392b;
        background: var(--bg-hover);
    }
    .saved-delete-btn:disabled {
        opacity: 0;
        cursor: not-allowed;
    }
    .saved-create-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        padding: var(--space-1) var(--space-2);
    }
    .saved-input {
        font-size: var(--text-sm);
        padding: 2px 6px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--bg);
        color: var(--text);
        outline: none;
    }
    .saved-input:focus {
        border-color: var(--accent);
    }
    .saved-query-input {
        font-family: var(--font-mono, monospace);
    }
    .saved-create-actions {
        display: flex;
        gap: var(--space-2);
    }
    .saved-save-btn,
    .saved-cancel-btn,
    .saved-new-btn {
        font-size: var(--text-xs);
        padding: 2px 8px;
        background: transparent;
        color: var(--text-muted);
        border: 1px dashed var(--border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition:
            color var(--duration-fast) var(--ease),
            border-color var(--duration-fast) var(--ease);
    }
    .saved-save-btn:hover,
    .saved-cancel-btn:hover,
    .saved-new-btn:hover {
        color: var(--accent);
        border-color: var(--accent);
    }
    .saved-new-btn {
        margin-left: var(--space-2);
        margin-top: var(--space-1);
        align-self: flex-start;
    }
    .saved-error {
        margin-left: var(--space-2);
        margin-top: var(--space-1);
        padding: 2px 6px;
        font-size: var(--text-xs);
        color: #c0392b;
        background: rgba(192, 57, 43, 0.08);
        border-radius: var(--radius-sm);
    }

    /* === Tablet (641-1024px): collapse the right-hand editor panel ===
       The 3-col grid (tree 220px | list | editor 360px) is too cramped under
       1024px once a sidebar (or rail) eats more horizontal space. Drop the
       editor on tablet — selecting a row still works, the editor is reachable
       via dedicated route patterns later. */
    @media (max-width: 1024px) {
        .browse {
            grid-template-columns: 220px minmax(0, 1fr);
        }
        .editor {
            display: none;
        }
    }

    /* === Phone (≤640px): stack to a single scrollable list ===
       Hide tree + editor side panels entirely. Toolbar wraps. Bulk actions
       still work; filtering by deck/tag falls back to the Today page entry
       points which already route into /study/<deckId>. The editor is too
       dense to be useful on a 320-414px viewport, and the tree's 200+ items
       crowd out the list — phone Browse focuses on the read scroll. */
    @media (max-width: 640px) {
        .browse {
            grid-template-columns: 1fr;
            height: auto;
            min-height: calc(100dvh - var(--bottom-nav-h) - var(--topbar-h));
            overflow: visible;
        }
        .tree,
        .editor {
            display: none;
        }
        .bulk-toolbar {
            flex-wrap: wrap;
        }
    }

    /* ────────────────────────────────────────────────────────────
       Phase A4-ε₁ — sketch-skin chrome for /browse
       Sidebar + hero + 7-col table; toolbar/select-strip/editor
       remain on legacy classes (rework lands in ζ).
       ──────────────────────────────────────────────────────────── */

    .bx-page {
        display: grid;
        grid-template-columns: 220px minmax(0, 1fr) 360px;
        height: 100dvh;
        overflow: hidden;
        background: var(--bg);
        color: var(--ink);
    }

    /* — Sidebar ————————————————————————— */
    .bx-sidebar {
        display: flex;
        flex-direction: column;
        gap: 22px;
        /* Same frame as the shared nav rail ($lib/components/Sidebar.svelte:
           220px wide, 28px/22px padding, 28px brand mark) so navigating in
           and out of /browse never resizes the left edge or the wordmark. */
        padding: 28px 22px;
        background: var(--bg-soft);
        border-right: 1.5px solid var(--ink);
        overflow-y: auto;
    }
    .bx-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .bx-section-title {
        background: transparent;
        border: 0;
        padding: 0;
        text-align: left;
        cursor: pointer;
        color: var(--ink-mute);
    }
    .bx-section-title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .bx-section-toggle {
        background: transparent;
        border: 0;
        padding: 0;
        text-align: left;
        cursor: pointer;
    }
    .bx-section-add {
        background: transparent;
        border: 0;
        padding: 2px 4px;
        cursor: pointer;
        color: var(--ink-mute);
        display: inline-flex;
        align-items: center;
    }
    .bx-section-add:hover {
        color: var(--accent);
    }
    .bx-section-body {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .bx-sidebar-foot {
        margin-top: auto;
        border-top: 1px dashed var(--rule);
        padding-top: 12px;
    }

    /* Loading skeletons for the DECKS / TAGS sections — shown until the
       supplementary fetchDecks / fetchTags calls settle so the bundled
       demo data never paints on navigation into /browse. Static muted
       bars (the window is ~100ms; an animation would be more distracting
       than the placeholder it replaces). */
    .bx-skel-list {
        pointer-events: none;
    }
    .bx-deck-skel {
        padding: 5px 8px;
    }
    .bx-skel-bar {
        display: block;
        height: 12px;
        width: 70%;
        border-radius: 4px;
        background: var(--rule-soft);
    }
    .bx-skel-bar-2 {
        width: 55%;
    }
    .bx-skel-bar-3 {
        width: 64%;
    }
    .bx-tag-skel {
        pointer-events: none;
        padding: 0;
        width: 46px;
        height: 18px;
        border-radius: 999px;
        background: var(--rule-soft);
        border-color: transparent;
    }
    .bx-tag-skel-2 {
        width: 62px;
    }
    .bx-tag-skel-3 {
        width: 38px;
    }

    .bx-deck-row {
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .bx-deck-btn {
        flex: 1;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 5px 8px;
        background: transparent;
        border: 1.2px solid transparent;
        border-radius: 4px;
        font-size: 12px;
        color: var(--ink-soft);
        cursor: pointer;
        text-align: left;
    }
    .bx-deck-btn:hover {
        background: var(--paper);
        color: var(--ink);
        border-color: var(--rule);
    }
    .bx-deck-btn:focus-visible {
        outline: 1.5px solid var(--ink);
        outline-offset: 2px;
    }
    .bx-deck-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .bx-deck-count {
        font-size: 10px;
        color: var(--ink-mute);
        font-variant-numeric: tabular-nums;
        flex-shrink: 0;
        margin-left: 8px;
    }
    .bx-deck-edit {
        padding: 5px 8px;
        background: var(--paper);
        border: 1.2px solid var(--ink);
        border-radius: 4px;
    }
    .bx-tree-rename {
        flex: 1;
        font-size: 12px;
        background: transparent;
        border: 0;
        outline: none;
        color: var(--ink);
    }

    .bx-row-x {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
        background: transparent;
        border: 0;
        padding: 0;
        font-size: 14px;
        line-height: 1;
        color: var(--ink-mute);
        cursor: pointer;
        opacity: 0;
        transition: opacity 120ms;
    }
    .bx-deck-row:hover .bx-row-x,
    .bx-saved-row:hover .bx-row-x {
        opacity: 1;
    }
    .bx-row-x:hover {
        color: var(--due);
    }
    .bx-row-x:focus-visible {
        opacity: 1;
        outline: 1.5px solid var(--ink);
        outline-offset: 1px;
    }

    .bx-state-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
        background: transparent;
        border: 0;
        font-size: 12px;
        color: var(--ink-soft);
        cursor: pointer;
        text-align: left;
    }
    .bx-state-row:hover {
        color: var(--ink);
    }
    .bx-state-dot {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        border: 1px solid var(--ink);
        flex-shrink: 0;
    }
    .bx-state-label {
        flex: 1;
    }
    .bx-state-count {
        font-size: 10px;
        color: var(--ink-mute);
        font-variant-numeric: tabular-nums;
    }

    .bx-tag-cloud {
        flex-direction: row;
        flex-wrap: wrap;
        gap: 4px;
    }
    .bx-tag-pill {
        font-size: 10px;
        padding: 2px 8px;
        border: 1px solid var(--rule-soft);
        border-radius: 999px;
        background: var(--paper);
        color: var(--ink-soft);
        cursor: pointer;
    }
    .bx-tag-pill:hover {
        border-color: var(--ink);
        color: var(--ink);
    }

    .bx-saved-row {
        display: flex;
        align-items: flex-start;
        gap: 4px;
    }
    .bx-saved-btn {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 5px 8px;
        background: transparent;
        border: 0;
        border-radius: 4px;
        cursor: pointer;
        text-align: left;
    }
    .bx-saved-btn:hover {
        background: var(--paper);
    }
    .bx-saved-name {
        font-size: 12px;
        color: var(--ink-soft);
    }
    .bx-saved-q {
        font-size: 10px;
        color: var(--ink-mute);
        margin-left: 10px;
    }
    .bx-saved-form {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
        background: var(--paper);
        border: 1.2px solid var(--ink);
        border-radius: 4px;
    }
    .bx-saved-input {
        font-size: 12px;
        padding: 4px 6px;
        background: var(--bg);
        border: 1px solid var(--rule);
        border-radius: 2px;
        color: var(--ink);
    }
    .bx-saved-input:focus {
        outline: none;
        border-color: var(--ink);
    }
    .bx-saved-actions {
        display: flex;
        gap: 6px;
    }
    .bx-saved-error {
        font-size: 11px;
        color: var(--due);
        padding: 4px 0;
    }

    /* — Main pane ————————————————————————— */
    .bx-main {
        display: flex;
        flex-direction: column;
        padding: 24px 32px 16px;
        overflow: hidden;
        min-width: 0;
    }
    .bx-hero {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 16px;
        margin-bottom: 16px;
    }
    .bx-hero-left {
        min-width: 0;
    }
    .bx-hero-right {
        display: flex;
        gap: 8px;
        flex-shrink: 0;
    }

    /* — Table ————————————————————————— */
    .bx-table {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        margin-top: 8px;
    }
    .bx-table-head,
    .bx-row-btn {
        display: grid;
        grid-template-columns:
            32px /* check */
            32px /* num */
            36px /* glyph */
            minmax(120px, 1.6fr) /* front */
            minmax(120px, 1.4fr) /* back */
            90px /* deck */
            120px /* tags */
            56px; /* due */
        gap: 14px;
        align-items: center;
    }
    .bx-table-head {
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ink-mute);
        padding: 10px 12px;
        border-bottom: 1px dashed var(--rule);
    }
    .bx-table-head .bx-col-num {
        text-align: right;
    }
    .bx-table-head .bx-col-due {
        text-align: right;
    }

    .bx-table-body {
        flex: 1;
        overflow-y: auto;
        padding-bottom: 8px;
    }

    .bx-row {
        position: relative;
        display: grid;
        grid-template-columns: 32px 1fr;
        align-items: stretch;
        border-bottom: 1px solid var(--rule-soft);
        transition: transform 120ms, box-shadow 120ms;
    }
    .bx-row:hover {
        transform: translate(-0.5px, -0.5px);
        box-shadow: 4px 4px 0 var(--rule);
        z-index: 1;
    }
    .bx-row.selected {
        background: var(--accent-soft);
        border-left: 1.5px solid var(--accent);
        border-bottom-color: var(--accent);
    }
    .bx-row.checked .bx-col-front {
        color: var(--ink-soft);
    }

    .bx-col-check {
        display: flex;
        align-items: center;
        justify-content: center;
        padding-left: 8px;
    }
    .bx-row-check {
        width: 14px;
        height: 14px;
        cursor: pointer;
    }

    .bx-row-btn {
        background: transparent;
        border: 0;
        padding: 10px 12px;
        text-align: left;
        cursor: pointer;
        font-size: 13px;
        color: inherit;
        width: 100%;
    }
    .bx-row-btn:focus-visible {
        outline: 1.5px solid var(--ink);
        outline-offset: -2px;
    }

    .bx-col-num {
        font-size: 11px;
        color: var(--ink-mute);
        text-align: right;
        font-variant-numeric: tabular-nums;
    }
    .bx-col-glyph {
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        border: 1.2px solid var(--ink);
        border-radius: 3px;
        background: var(--bg);
        font-size: 9px;
        font-weight: 600;
        line-height: 1;
        color: var(--ink);
    }
    .bx-col-front {
        font-size: 14px;
        font-weight: 500;
        color: var(--ink);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }
    .bx-front-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
    }
    .bx-col-back {
        font-size: 12px;
        color: var(--ink-soft);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }
    .bx-col-deck {
        font-size: 10px;
        color: var(--ink-mute);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .bx-col-tags {
        display: flex;
        gap: 4px;
        flex-wrap: nowrap;
        overflow: hidden;
    }
    .bx-tag-chip {
        font-size: 9px;
        padding: 1px 6px;
        border: 1px solid var(--rule-soft);
        border-radius: 999px;
        color: var(--ink-soft);
        white-space: nowrap;
    }
    .bx-tag-chip-more {
        color: var(--ink-mute);
    }
    .bx-col-due {
        font-size: 11px;
        color: var(--ink-mute);
        text-align: right;
        font-variant-numeric: tabular-nums;
    }
    .bx-due-now {
        color: var(--due);
        font-weight: 600;
    }

    .bx-empty {
        padding: 36px 12px;
        text-align: center;
        color: var(--ink-mute);
    }
    .bx-empty-title {
        font-size: 13px;
        color: var(--ink-soft);
        margin-bottom: 6px;
    }
    .bx-empty-hint {
        font-size: 11px;
    }
    .bx-empty-action {
        background: transparent;
        border: 0;
        padding: 0;
        color: var(--accent);
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
        font: inherit;
    }

    .bx-table-foot {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        border-top: 1px dashed var(--rule);
        padding-top: 12px;
        margin-top: 4px;
        font-size: 11px;
        color: var(--ink-mute);
    }
    .bx-table-keys {
        display: flex;
        gap: 14px;
    }

    /* — Mobile — ε₁ scope: collapse sidebar + editor, stack rows —— */
    @media (max-width: 768px) {
        .bx-page {
            display: block;
            height: auto;
            min-height: 100dvh;
            overflow: visible;
        }
        .bx-sidebar {
            display: none;
        }
        :global(.bx-page > aside.editor) {
            display: none;
        }
        .bx-main {
            padding: 18px 18px 24px;
            overflow: visible;
        }
        .bx-hero {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
        }
        .bx-hero .page-title {
            font-size: 24px;
        }
        .bx-hero .page-title-hand {
            font-size: 18px;
        }
        .bx-table-head {
            display: none;
        }
        .bx-table-body {
            overflow: visible;
        }
        .bx-row {
            display: block;
            border: 1.2px solid var(--ink);
            border-radius: 4px;
            background: var(--paper);
            box-shadow: 2px 2px 0 var(--ink);
            margin-bottom: 10px;
            padding: 10px 14px;
        }
        .bx-row:hover {
            transform: none;
            box-shadow: 2px 2px 0 var(--ink);
        }
        .bx-row.selected {
            border-color: var(--accent);
            box-shadow: 2px 2px 0 var(--accent);
        }
        .bx-col-check {
            position: absolute;
            top: 10px;
            right: 10px;
            padding: 0;
        }
        .bx-row-btn {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 0;
        }
        .bx-col-num,
        .bx-col-glyph {
            display: inline-block;
            margin-right: 8px;
        }
        .bx-col-glyph {
            width: 28px;
            height: 28px;
            font-size: 8px;
        }
        .bx-col-front {
            font-size: 15px;
            white-space: normal;
        }
        .bx-col-back {
            white-space: normal;
        }
        .bx-col-due {
            text-align: left;
        }
        .bx-table-foot {
            flex-direction: column;
            align-items: flex-start;
            gap: 6px;
        }
    }

    /* ────────────────────────────────────────────────────────────
       Phase A4-ζ — chip-token toolbar + filter sheet
       Replaces legacy .toolbar / .search / .filters / .pill /
       .pagination / .count-tag chrome. Toolbar lives below the
       hero, sheet floats centred on desktop / bottom-anchored
       on mobile.
       ──────────────────────────────────────────────────────────── */

    .bx-toolbar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px 32px;
        border-bottom: 1.5px solid var(--ink);
        flex-wrap: wrap;
    }

    .bx-searchbar {
        flex: 1 1 280px;
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        padding: 8px 14px;
        min-height: 38px;
        border: 1.5px solid var(--ink);
        border-radius: var(--radius);
        background: var(--paper);
        color: var(--ink);
        box-shadow: 2px 2px 0 var(--ink);
        cursor: text;
        transition:
            transform 100ms ease,
            box-shadow 100ms ease;
    }

    .bx-searchbar:focus-within {
        transform: translate(-0.5px, -0.5px);
        box-shadow: 3px 3px 0 var(--ink);
    }

    .bx-chip {
        display: inline-flex;
        align-items: center;
        padding: 1px 6px;
        font-size: 12px;
        line-height: 1.4;
        border: 1px dashed var(--rule);
        border-radius: 3px;
        background: transparent;
        color: var(--ink);
        cursor: pointer;
        transition:
            background-color 100ms ease,
            border-color 100ms ease;
    }

    .bx-chip:hover {
        background: color-mix(in oklch, var(--ink) 8%, transparent);
        border-style: solid;
    }

    .bx-chip-deck {
        color: var(--accent);
        border-color: color-mix(in oklch, var(--accent) 35%, transparent);
    }

    .bx-chip-tag {
        color: var(--ink);
        border-color: color-mix(in oklch, var(--ink) 30%, transparent);
    }

    .bx-chip-is {
        color: var(--ink-soft, var(--ink));
        border-color: color-mix(in oklch, var(--ink) 24%, transparent);
        font-style: italic;
    }

    .bx-chip-text {
        color: var(--ink);
        border-color: color-mix(in oklch, var(--ink) 20%, transparent);
    }

    .bx-search-input {
        flex: 1 1 60px;
        min-width: 60px;
        background: transparent;
        border: 0;
        outline: 0;
        color: var(--ink);
        font-family: var(--font-mono);
        font-size: 12px;
        padding: 2px 0;
    }

    .bx-search-input::placeholder {
        color: var(--ink-mute);
        font-family: var(--font-mono);
    }

    .bx-cursor {
        width: 1px;
        height: 14px;
        background: var(--ink-mute);
        animation: bx-blink 1s step-end infinite;
    }

    .bx-searchbar:focus-within .bx-cursor {
        display: none;
    }

    @keyframes bx-blink {
        0%,
        50% {
            opacity: 1;
        }
        51%,
        100% {
            opacity: 0;
        }
    }

    .bx-kbd-hint {
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        margin-left: auto;
        padding-left: 8px;
    }

    .bx-toolbar-paginate {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
    }

    .bx-toolbar-count {
        font-size: 11px;
        color: var(--ink-mute);
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.04em;
        padding: 0 6px;
        white-space: nowrap;
    }

    /* — ζ Filter sheet — */
    .bx-filter-backdrop {
        position: fixed;
        inset: 0;
        background: color-mix(in oklch, var(--ink) 18%, transparent);
        z-index: 40;
        animation: bx-fade-in 140ms ease-out;
    }

    .bx-filter-sheet {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(560px, calc(100vw - 32px));
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        background: var(--paper);
        border: 1.5px solid var(--ink);
        border-radius: 6px;
        box-shadow: 4px 4px 0 var(--ink);
        z-index: 41;
        animation: bx-sheet-in 160ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes bx-fade-in {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    @keyframes bx-sheet-in {
        from {
            opacity: 0;
            transform: translate(-50%, calc(-50% + 8px));
        }
        to {
            opacity: 1;
            transform: translate(-50%, -50%);
        }
    }

    .bx-filter-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 18px;
        border-bottom: 1px dashed var(--rule);
    }

    .bx-filter-body {
        padding: 14px 18px 18px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 18px;
    }

    .bx-filter-row {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .bx-filter-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .bx-filter-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border: 1px solid var(--rule);
        border-radius: 3px;
        background: var(--paper);
        color: var(--ink);
        font-size: 11px;
        text-transform: lowercase;
        cursor: pointer;
        transition:
            background-color 100ms ease,
            border-color 100ms ease,
            box-shadow 100ms ease;
    }

    .bx-filter-chip-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--chip-color, var(--ink-mute));
        border: 1px solid var(--ink);
    }

    .bx-filter-chip:hover {
        background: var(--bg-soft);
        border-color: var(--ink);
    }

    .bx-filter-chip.active {
        background: color-mix(in oklch, var(--ink) 8%, var(--paper));
        border-color: var(--ink);
        box-shadow: 1px 1px 0 var(--ink);
    }

    .bx-filter-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 18px;
        border-top: 1px dashed var(--rule);
    }

    @media (max-width: 768px) {
        .bx-toolbar {
            padding: 12px 14px;
            gap: 8px;
        }
        .bx-toolbar-paginate {
            flex: 1 0 100%;
            justify-content: space-between;
            margin-left: 0;
        }
        .bx-filter-sheet {
            top: auto;
            left: 0;
            bottom: 0;
            transform: translate(0, 0);
            width: 100%;
            max-height: 80vh;
            border-radius: 6px 6px 0 0;
            animation: bx-sheet-mobile-in 200ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes bx-sheet-mobile-in {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    }
</style>
