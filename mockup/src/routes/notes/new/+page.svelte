<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import Card from "$lib/components/Card.svelte";
    import Button from "$lib/components/Button.svelte";
    import {
        fetchDecks,
        fetchNotetypes,
        postMedia,
        postNote,
        type ApiDeckSummary,
        type ApiNotetypeSummary,
    } from "$lib/api";

    // Phase 12-C: minimal Add-Note flow. Wires the home page's existing
    // "Add note" button to a real server endpoint via /api/notes.
    // Phase 13-C: notetype picker + dynamic fields. The server returns
    // every notetype's field names so the form labels each input row
    // by name (Cloze "Text", Basic "Front" etc.) instead of generic
    // Front/Back. Switching notetype resets every field — matching the
    // desktop Add-Card screen, where field content doesn't carry over
    // between notetypes either.

    let decks = $state<ApiDeckSummary[] | null>(null);
    let deckId = $state<number | null>(null);
    let notetypes = $state<ApiNotetypeSummary[] | null>(null);
    let notetypeId = $state<number | null>(null);
    // Field values, indexed by template order. Always sized to match
    // the selected notetype's `fields.length`. Reset on notetype change.
    let fieldValues = $state<string[]>([]);
    let tagsRaw = $state("");
    let saving = $state(false);
    let error: string | null = $state(null);
    let loadError: string | null = $state(null);

    // Phase 15-C: per-field drag-drop state for image upload. Tracks the
    // index of the field currently being hovered with a drag (so only that
    // field shows the highlight) and the index of the field currently
    // uploading (so only its textarea is disabled, not the whole form).
    let dragOverFieldIdx = $state<number | null>(null);
    let uploadingFieldIdx = $state<number | null>(null);
    let mediaError: string | null = $state(null);

    function handleFieldDragOver(e: DragEvent, idx: number): void {
        // Must call preventDefault on dragover for the browser to fire
        // the drop event later. Showing the highlight only when the
        // payload includes a file means a stray text-drag (selection
        // drag from another input) doesn't trigger the visual.
        if (e.dataTransfer?.types?.includes("Files")) {
            e.preventDefault();
            dragOverFieldIdx = idx;
        }
    }

    function handleFieldDragLeave(idx: number): void {
        if (dragOverFieldIdx === idx) dragOverFieldIdx = null;
    }

    async function handleFieldDrop(e: DragEvent, idx: number): Promise<void> {
        e.preventDefault();
        dragOverFieldIdx = null;
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        if (uploadingFieldIdx !== null) return;
        // Quick client-side guard so a wrong-file drop fails fast
        // without a network round-trip. Server still has the
        // authoritative allow-list.
        if (!file.type.startsWith("image/")) {
            mediaError = "Only image files (PNG / JPEG / WEBP / GIF) can be dropped";
            return;
        }
        uploadingFieldIdx = idx;
        mediaError = null;
        try {
            const res = await postMedia(file);
            // Append at end of the field. Newline before so the token
            // sits on its own line for readable plain-text editing —
            // the rendered card flattens whitespace anyway.
            const current = fieldValues[idx] ?? "";
            const sep = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
            fieldValues[idx] = `${current}${sep}<img src="/media/${res.filename}">`;
        } catch (err) {
            mediaError =
                err instanceof Error ? err.message : "Failed to upload image";
        } finally {
            uploadingFieldIdx = null;
        }
    }

    onMount(async () => {
        try {
            // Decks + notetypes load in parallel — neither depends on
            // the other. If one fails we surface the same generic
            // banner; per-source granularity isn't useful since the
            // form is unsubmittable in either failure mode.
            const [decksRes, ntRes] = await Promise.all([
                fetchDecks(),
                fetchNotetypes(),
            ]);
            // Filter out the implicit root and skip filtered decks
            // (server rejects them anyway; making the option un-selectable
            // here saves the user from a 400 round-trip).
            decks = decksRes.decks.filter(
                (d) => d.id !== 0 && d.level >= 1 && !d.filtered,
            );
            if (decks.length > 0) {
                deckId = decks[0].id;
            }
            notetypes = ntRes.notetypes;
            if (notetypes.length > 0) {
                // Default to "Basic" by name if present (server seeds it
                // on every fresh collection); else fall back to the first
                // listed notetype. Matches the Phase 12-C server-side
                // "Basic" fallback so default form submissions are
                // round-trip stable.
                const basic = notetypes.find((n) => n.name === "Basic");
                const initial = basic ?? notetypes[0];
                notetypeId = initial.id;
                fieldValues = new Array(initial.fields.length).fill("");
            }
        } catch (e) {
            loadError =
                e instanceof Error ? e.message : "Couldn't load form data";
        }
    });

    // Currently-selected notetype, derived from the dropdown value. Drives
    // the dynamic field rendering below.
    let selectedNotetype = $derived.by(() => {
        if (!notetypes || notetypeId === null) return null;
        return notetypes.find((n) => n.id === notetypeId) ?? null;
    });

    function onNotetypeChange(e: Event): void {
        const target = e.target as HTMLSelectElement;
        const next = Number(target.value);
        if (Number.isNaN(next) || !notetypes) return;
        const nt = notetypes.find((n) => n.id === next);
        if (!nt) return;
        notetypeId = next;
        // Reset fields — the previous notetype's content has no
        // semantic mapping to this one's templates. Matches desktop
        // Add-Card behaviour.
        fieldValues = new Array(nt.fields.length).fill("");
        error = null;
    }

    function parseTags(raw: string): string[] {
        // Accept comma-or-whitespace-separated tags, drop blanks.
        // Mirrors the server's own trim+drop-blank step so the local
        // count we display matches what gets persisted.
        return raw
            .split(/[\s,]+/)
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
    }

    let parsedTags = $derived(parseTags(tagsRaw));
    let canSubmit = $derived(
        deckId !== null &&
            notetypeId !== null &&
            fieldValues.length > 0 &&
            (fieldValues[0] ?? "").trim() !== "" &&
            !saving,
    );

    async function save(): Promise<void> {
        if (!canSubmit || deckId === null || notetypeId === null) return;
        saving = true;
        error = null;
        try {
            await postNote({
                deck_id: deckId,
                fields: fieldValues,
                tags: parsedTags,
                notetype_id: notetypeId,
            });
            // Land back on home; the live counts there will pick up the
            // new card on next mount via fetchDecks.
            await goto("/");
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to add note";
        } finally {
            saving = false;
        }
    }
</script>

<div class="page">
    <header>
        <h1>Add note</h1>
        <p class="subtitle">Create a new card in any deck.</p>
    </header>

    {#if loadError}
        <div class="error-banner" role="alert">
            <strong>Couldn't load form data.</strong>
            {loadError}
        </div>
    {/if}

    <Card padding="lg">
        <form class="form" onsubmit={(e) => { e.preventDefault(); save(); }}>
            <div class="field">
                <label for="deck-select">Deck</label>
                {#if loadError}
                    <!-- Banner above already surfaces the failure; suppressing
                         the select keeps the form un-submittable on its own
                         (canSubmit gates on deckId !== null). -->
                {:else if decks === null}
                    <span class="hint">Loading decks…</span>
                {:else if decks.length === 0}
                    <span class="hint"
                        >No decks available — create one in Browse first.</span
                    >
                {:else}
                    <select
                        id="deck-select"
                        class="text-input"
                        bind:value={deckId}
                        disabled={saving}
                    >
                        {#each decks as d (d.id)}
                            <option value={d.id}>{d.name}</option>
                        {/each}
                    </select>
                {/if}
            </div>

            <div class="field">
                <label for="notetype-select">Notetype</label>
                {#if loadError}
                    <!-- Suppressed when decks/notetypes load failed. -->
                {:else if notetypes === null}
                    <span class="hint">Loading notetypes…</span>
                {:else if notetypes.length === 0}
                    <span class="hint"
                        >No notetypes available on this collection.</span
                    >
                {:else}
                    <select
                        id="notetype-select"
                        class="text-input"
                        value={notetypeId}
                        onchange={onNotetypeChange}
                        disabled={saving}
                    >
                        {#each notetypes as n (n.id)}
                            <option value={n.id}
                                >{n.name} ({n.fields.length} field{n.fields
                                    .length === 1
                                    ? ""
                                    : "s"})</option
                            >
                        {/each}
                    </select>
                {/if}
            </div>

            {#if selectedNotetype}
                {#each selectedNotetype.fields as fieldName, i (i)}
                    <div
                        class="field field-droppable"
                        class:dragging={dragOverFieldIdx === i}
                        ondragover={(e) => handleFieldDragOver(e, i)}
                        ondragleave={() => handleFieldDragLeave(i)}
                        ondrop={(e) => handleFieldDrop(e, i)}
                        role="presentation"
                    >
                        <label for="field-input-{i}">{fieldName}</label>
                        <textarea
                            id="field-input-{i}"
                            class="text-input"
                            bind:value={fieldValues[i]}
                            disabled={saving || uploadingFieldIdx === i}
                            rows={i === 0 ? 3 : 4}
                            required={i === 0}
                            placeholder={i === 0 ? "森林" : ""}
                        ></textarea>
                        {#if uploadingFieldIdx === i}
                            <span class="hint">Uploading image…</span>
                        {/if}
                    </div>
                {/each}
                {#if mediaError}
                    <div class="field-error" role="alert">{mediaError}</div>
                {/if}
            {/if}

            <div class="field">
                <label for="tags-input">Tags</label>
                <input
                    id="tags-input"
                    type="text"
                    class="text-input"
                    bind:value={tagsRaw}
                    disabled={saving}
                    placeholder="vocab nature"
                />
                <span class="hint">
                    Space- or comma-separated.
                    {#if parsedTags.length > 0}
                        {parsedTags.length} tag{parsedTags.length === 1 ? "" : "s"}.
                    {/if}
                </span>
            </div>

            {#if error}
                <div class="field-error" role="alert">{error}</div>
            {/if}

            <div class="actions">
                <Button variant="ghost" href="/">Cancel</Button>
                <Button
                    variant="primary"
                    type="submit"
                    disabled={!canSubmit}
                >
                    {saving ? "Saving…" : "Save"}
                </Button>
            </div>
        </form>
    </Card>
</div>

<style>
    .page {
        max-width: 640px;
        margin: 0 auto;
        padding: var(--space-6) var(--space-4);
    }
    header {
        margin-bottom: var(--space-5);
    }
    h1 {
        font-size: var(--text-3xl);
        margin: 0 0 var(--space-2);
    }
    .subtitle {
        color: var(--text-muted);
        margin: 0;
    }
    .form {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
    }
    .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }
    .field label {
        font-size: var(--text-sm);
        font-weight: 500;
        color: var(--text);
    }
    .text-input {
        padding: 0.5rem 0.65rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--bg);
        color: var(--text);
        font: inherit;
        line-height: 1.5;
    }
    .text-input:focus {
        outline: none;
        border-color: var(--accent);
    }
    .text-input:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    textarea.text-input {
        resize: vertical;
        min-height: 4.5rem;
    }
    /* Phase 15-C: drop-target highlight. Using a subtle accent ring
       instead of an aggressive overlay so a stray drag past the form
       isn't visually disruptive. */
    .field-droppable {
        position: relative;
        transition: background var(--duration-fast) var(--ease);
    }
    .field-droppable.dragging {
        background: color-mix(in oklch, var(--accent) 5%, transparent);
        border-radius: var(--radius-sm);
        outline: 2px dashed var(--accent);
        outline-offset: 2px;
    }
    .hint {
        font-size: var(--text-xs);
        color: var(--text-subtle);
    }
    .field-error {
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--danger, #c44);
        border-radius: var(--radius-sm);
        background: color-mix(in oklch, var(--danger, #c44) 8%, transparent);
        color: var(--text);
        font-size: var(--text-sm);
    }
    .error-banner {
        padding: var(--space-3) var(--space-4);
        border: 1px solid var(--danger, #c44);
        border-radius: var(--radius-sm);
        background: color-mix(in oklch, var(--danger, #c44) 8%, transparent);
        color: var(--text);
        font-size: var(--text-sm);
        margin-bottom: var(--space-4);
    }
    .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-3);
    }
</style>
