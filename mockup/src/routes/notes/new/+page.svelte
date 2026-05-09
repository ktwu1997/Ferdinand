<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import { Caption, Chip } from "$lib/components/ui";
    import { SketchPlus } from "$lib/components/sketch";
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
    // Phase A4-ε₂.b: sketch-skin port. Markup + CSS swapped for kraft
    // paper aesthetic with side-by-side form/preview; data layer
    // (decks/notetypes load, dynamic fields, drag-drop media, tag
    // parsing, save-redirect) preserved verbatim.

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
        // Phase 16-C: image OR audio. Server's authoritative allow-list
        // covers MP3/M4A/OGG/WAV/WEBM; the prefix check here is just a
        // fast-fail before the network round-trip.
        const isImage = file.type.startsWith("image/");
        const isAudio = file.type.startsWith("audio/");
        if (!isImage && !isAudio) {
            mediaError =
                "Only image (PNG / JPEG / WEBP / GIF) or audio (MP3 / M4A / OGG / WAV / WEBM) files can be dropped";
            return;
        }
        uploadingFieldIdx = idx;
        mediaError = null;
        try {
            const res = await postMedia(file);
            // Append at end of the field. Newline before so the token
            // sits on its own line for readable plain-text editing —
            // the rendered card flattens whitespace anyway. Audio uses
            // Anki's [sound:...] syntax (handled by the shadow-DOM
            // player wired up in Phase 7-C); images use a plain <img>.
            const current = fieldValues[idx] ?? "";
            const sep = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
            const token = isAudio
                ? `[sound:${res.filename}]`
                : `<img src="/media/${res.filename}">`;
            fieldValues[idx] = `${current}${sep}${token}`;
        } catch (err) {
            mediaError =
                err instanceof Error ? err.message : "Failed to upload media";
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

    // Selected deck for preview header.
    let selectedDeck = $derived.by(() => {
        if (!decks || deckId === null) return null;
        return decks.find((d) => d.id === deckId) ?? null;
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

<svelte:head><title>New note — Anki</title></svelte:head>

<div class="sketch-skin grain page nx-page" data-testid="notes-new-root">
    <header class="nx-head" data-testid="notes-new-hero">
        <div class="nx-head-left">
            <Caption>the.workshop</Caption>
            <h1 class="nx-title mono" data-testid="notes-new-title">
                new note
                <span class="nx-title-hand hand" aria-hidden="true">add to library</span>
            </h1>
            <p class="nx-subtitle mono">
                create a card in any deck
                <span class="nx-subtitle-kbd mono">⌘↵ to save</span>
            </p>
        </div>
        <div class="nx-actions" data-testid="notes-new-actions">
            <a class="nx-btn nx-btn-ghost mono" href="/" data-testid="notes-new-cancel">cancel</a>
            <button
                type="submit"
                form="nx-note-form"
                class="nx-btn nx-btn-primary mono"
                disabled={!canSubmit}
                data-testid="notes-new-save"
            >
                <SketchPlus size={11} />
                <span>{saving ? "saving…" : "save"}</span>
            </button>
        </div>
    </header>

    {#if loadError}
        <div class="nx-error mono" role="alert" data-testid="notes-new-error">
            // couldn't load form data — {loadError}
        </div>
    {/if}

    <!-- Top tri-strip: deck + notetype + status. Mirrors design
         deck/type/tools row but with real data-driven dropdowns and
         a live status pill replacing the formatting toolbar (which
         has no data-layer hook in this build). -->
    <section class="nx-toolbar" data-testid="notes-new-toolbar">
        <div class="nx-toolbar-col" data-testid="notes-new-deck-col">
            <Caption>deck</Caption>
            {#if loadError}
                <div class="nx-toolbar-hint mono">unavailable</div>
            {:else if decks === null}
                <div class="nx-toolbar-hint mono">loading…</div>
            {:else if decks.length === 0}
                <div class="nx-toolbar-hint mono">none — make one in browse first</div>
            {:else}
                <div class="nx-select-wrap">
                    <select
                        id="nx-deck-select"
                        class="nx-select mono"
                        bind:value={deckId}
                        disabled={saving}
                        data-testid="notes-new-deck-select"
                    >
                        {#each decks as d (d.id)}
                            <option value={d.id}>{d.name}</option>
                        {/each}
                    </select>
                    <span class="nx-select-caret mono" aria-hidden="true">▾</span>
                </div>
            {/if}
        </div>

        <div class="nx-toolbar-col" data-testid="notes-new-notetype-col">
            <Caption>notetype</Caption>
            {#if loadError}
                <div class="nx-toolbar-hint mono">unavailable</div>
            {:else if notetypes === null}
                <div class="nx-toolbar-hint mono">loading…</div>
            {:else if notetypes.length === 0}
                <div class="nx-toolbar-hint mono">none on this collection</div>
            {:else}
                <div class="nx-select-wrap">
                    <select
                        id="nx-notetype-select"
                        class="nx-select mono"
                        value={notetypeId}
                        onchange={onNotetypeChange}
                        disabled={saving}
                        data-testid="notes-new-notetype-select"
                    >
                        {#each notetypes as n (n.id)}
                            <option value={n.id}
                                >{n.name} · {n.fields.length} field{n.fields
                                    .length === 1
                                    ? ""
                                    : "s"}</option
                            >
                        {/each}
                    </select>
                    <span class="nx-select-caret mono" aria-hidden="true">▾</span>
                </div>
            {/if}
        </div>

        <div class="nx-toolbar-col nx-toolbar-status" data-testid="notes-new-status-col">
            <Caption>status</Caption>
            <div class="nx-toolbar-status-row mono">
                <span class="nx-status-dot" class:nx-status-dot-on={canSubmit} aria-hidden="true"></span>
                <span>{canSubmit ? "ready to save" : saving ? "saving…" : "fill the first field"}</span>
            </div>
        </div>
    </section>

    <!-- Two-pane: form on the left, live preview on the right. -->
    <form
        id="nx-note-form"
        class="nx-grid"
        onsubmit={(e) => { e.preventDefault(); save(); }}
        data-testid="notes-new-form"
    >
        <div class="nx-form-col" data-testid="notes-new-form-col">
            {#if selectedNotetype}
                {#each selectedNotetype.fields as fieldName, i (i)}
                    <div
                        class="nx-field"
                        class:nx-field-dragging={dragOverFieldIdx === i}
                        ondragover={(e) => handleFieldDragOver(e, i)}
                        ondragleave={() => handleFieldDragLeave(i)}
                        ondrop={(e) => handleFieldDrop(e, i)}
                        role="presentation"
                        data-testid="notes-new-field-{i}"
                    >
                        <div class="nx-field-label">
                            <Caption>{fieldName}</Caption>
                            {#if i === 0}
                                <span class="nx-field-hint mono">required</span>
                            {:else if uploadingFieldIdx === i}
                                <span class="nx-field-hint mono">uploading…</span>
                            {:else}
                                <span class="nx-field-hint mono">drop image / audio</span>
                            {/if}
                        </div>
                        <textarea
                            id="nx-field-{i}"
                            class="nx-textarea mono"
                            class:nx-textarea-primary={i === 0}
                            bind:value={fieldValues[i]}
                            disabled={saving || uploadingFieldIdx === i}
                            rows={i === 0 ? 3 : 4}
                            required={i === 0}
                            placeholder={i === 0 ? "森林" : ""}
                        ></textarea>
                    </div>
                {/each}
                {#if mediaError}
                    <div class="nx-field-error mono" role="alert" data-testid="notes-new-media-error">
                        {mediaError}
                    </div>
                {/if}
            {:else if !loadError}
                <div class="nx-form-loading mono" data-testid="notes-new-form-loading">
                    loading fields…
                </div>
            {/if}

            <div class="nx-field" data-testid="notes-new-tags-field">
                <div class="nx-field-label">
                    <Caption>tags</Caption>
                    <span class="nx-field-hint mono">
                        space- or comma-separated{#if parsedTags.length > 0} · {parsedTags.length} tag{parsedTags.length === 1 ? "" : "s"}{/if}
                    </span>
                </div>
                <input
                    id="nx-tags-input"
                    type="text"
                    class="nx-input mono"
                    bind:value={tagsRaw}
                    disabled={saving}
                    placeholder="vocab nature"
                    data-testid="notes-new-tags-input"
                />
            </div>

            {#if error}
                <div class="nx-field-error mono" role="alert" data-testid="notes-new-error-inline">
                    {error}
                </div>
            {/if}
        </div>

        <aside class="nx-preview-col" data-testid="notes-new-preview">
            <div class="nx-preview-head">
                <Caption>preview · live</Caption>
                {#if selectedDeck}
                    <span class="nx-preview-deck mono">→ {selectedDeck.name}</span>
                {/if}
            </div>

            <div class="nx-preview-stack">
                <div class="nx-preview-back" aria-hidden="true"></div>
                <article class="nx-preview-card" data-testid="notes-new-preview-card">
                    {#if parsedTags.length > 0}
                        <div class="nx-preview-tags" data-testid="notes-new-preview-tags">
                            {#each parsedTags as t (t)}
                                <Chip>{t}</Chip>
                            {/each}
                        </div>
                    {/if}

                    {#if fieldValues[0]?.trim()}
                        <div class="nx-preview-primary" data-testid="notes-new-preview-primary">
                            {fieldValues[0]}
                        </div>
                    {:else}
                        <div class="nx-preview-empty mono" data-testid="notes-new-preview-empty">
                            type the first field to see it here
                        </div>
                    {/if}

                    {#if fieldValues[1]?.trim()}
                        <div class="nx-preview-rule" aria-hidden="true"></div>
                        <div class="nx-preview-secondary mono" data-testid="notes-new-preview-secondary">
                            {fieldValues[1]}
                        </div>
                    {/if}

                    {#if fieldValues.slice(2).some((v) => v?.trim())}
                        <div class="nx-preview-rule" aria-hidden="true"></div>
                        <div class="nx-preview-extras">
                            {#each fieldValues.slice(2) as v, i (i)}
                                {#if v?.trim()}
                                    <div class="nx-preview-extra" data-testid="notes-new-preview-extra-{i}">
                                        <span class="nx-preview-extra-label mono">{selectedNotetype?.fields[i + 2] ?? ""}</span>
                                        <span class="nx-preview-extra-text">{v}</span>
                                    </div>
                                {/if}
                            {/each}
                        </div>
                    {/if}

                    <div class="nx-preview-footer mono" aria-hidden="true">
                        <span>· will be queued as new</span>
                        <span>· first review: today</span>
                    </div>
                </article>
            </div>
        </aside>
    </form>
</div>

<style>
    .nx-page {
        max-width: 1180px;
        margin: 0 auto;
        padding: var(--space-8) var(--space-6) var(--space-12);
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
    }

    /* ============== HEADER ============== */
    .nx-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        flex-wrap: wrap;
        gap: var(--space-4);
    }
    .nx-head-left {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .nx-title {
        font-size: 28px;
        font-weight: 600;
        letter-spacing: -0.02em;
        margin: 4px 0 0;
        color: var(--ink);
        line-height: 1.05;
    }
    .nx-title-hand {
        font-family: var(--font-hand);
        color: var(--accent);
        font-size: 22px;
        margin-left: 12px;
        letter-spacing: 0;
        text-transform: lowercase;
    }
    .nx-subtitle {
        font-size: 12px;
        color: var(--ink-mute);
        margin: 4px 0 0;
        letter-spacing: 0.04em;
        display: flex;
        gap: 10px;
        align-items: baseline;
        flex-wrap: wrap;
    }
    .nx-subtitle-kbd {
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.1em;
        padding: 2px 8px;
        border: 1px dashed var(--rule);
        border-radius: 999px;
    }

    /* Header action buttons. Inline-styled paper pills, ghost = paper bg
       + ink border, primary = ink bg + bg fg with stamp shadow. */
    .nx-actions {
        display: flex;
        gap: 8px;
        align-items: center;
    }
    .nx-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        letter-spacing: 0.04em;
        padding: 8px 14px;
        border: 1.5px solid var(--ink);
        border-radius: var(--radius-md);
        background: var(--paper);
        color: var(--ink);
        cursor: pointer;
        text-decoration: none;
        line-height: 1;
        transition: transform 80ms ease, box-shadow 80ms ease,
            background-color 100ms ease;
    }
    .nx-btn:hover {
        background: var(--bg-soft);
    }
    .nx-btn:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    .nx-btn-ghost {
        background: transparent;
        color: var(--ink-soft);
    }
    .nx-btn-ghost:hover {
        background: var(--bg-soft);
        color: var(--ink);
    }
    .nx-btn-primary {
        background: var(--ink);
        color: var(--bg);
        box-shadow: var(--shadow-stamp-sm);
    }
    .nx-btn-primary:hover {
        background: var(--ink);
        transform: translate(-1px, -1px);
        box-shadow: var(--shadow-stamp-md);
    }
    .nx-btn-primary:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        transform: none;
        box-shadow: var(--shadow-stamp-sm);
    }

    /* ============== ERROR BANNER ============== */
    .nx-error {
        padding: 10px 14px;
        border: 1.5px solid var(--due);
        background: color-mix(in oklch, var(--due) 10%, var(--paper));
        color: var(--due);
        border-radius: var(--radius-md);
        font-size: 12px;
    }

    /* ============== TOP TOOLBAR (deck / notetype / status) ============== */
    .nx-toolbar {
        display: grid;
        grid-template-columns: 1fr 1fr auto;
        gap: 14px;
        padding: 14px 16px;
        background: var(--bg-soft);
        border: 1.5px solid var(--ink);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-stamp-sm);
    }
    .nx-toolbar-col {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .nx-toolbar-status {
        min-width: 180px;
    }
    .nx-toolbar-hint {
        margin-top: 4px;
        font-size: 12px;
        color: var(--ink-mute);
        padding: 8px 12px;
        background: var(--paper);
        border: 1.2px solid var(--rule);
        border-radius: 4px;
    }
    .nx-toolbar-status-row {
        margin-top: 4px;
        font-size: 12px;
        color: var(--ink-soft);
        padding: 8px 12px;
        background: var(--paper);
        border: 1.2px solid var(--ink);
        border-radius: 4px;
        display: flex;
        align-items: center;
        gap: 10px;
        letter-spacing: 0.04em;
    }
    .nx-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--ink-mute);
        border: 1px solid var(--ink);
        flex: 0 0 auto;
    }
    .nx-status-dot-on {
        background: var(--accent);
    }

    /* Sketch-pill <select> trigger. Native-rendered options drop into the
       browser's chrome; only the trigger is styled. */
    .nx-select-wrap {
        position: relative;
        margin-top: 4px;
    }
    .nx-select {
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        font-size: 13px;
        font-family: var(--font-mono);
        padding: 8px 28px 8px 12px;
        background: var(--paper);
        color: var(--ink);
        border: 1.2px solid var(--ink);
        border-radius: 4px;
        cursor: pointer;
        line-height: 1.4;
    }
    .nx-select:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    .nx-select:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .nx-select-caret {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        color: var(--ink-mute);
        font-size: 12px;
        pointer-events: none;
    }

    /* ============== TWO-PANE GRID ============== */
    .nx-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 28px;
        align-items: start;
    }

    /* ============== FORM ============== */
    .nx-form-col {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .nx-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .nx-field-label {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
    }
    .nx-field-hint {
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.04em;
    }
    .nx-textarea,
    .nx-input {
        font-family: var(--font-mono);
        font-size: 13px;
        line-height: 1.5;
        color: var(--ink);
        padding: 12px 14px;
        background: var(--paper);
        border: 1.5px solid var(--ink);
        border-radius: 4px;
        box-shadow: var(--shadow-stamp-sm);
        resize: vertical;
        min-height: 4.5rem;
        transition: box-shadow 100ms ease, transform 100ms ease;
    }
    .nx-input {
        min-height: 0;
        resize: none;
    }
    .nx-textarea:focus,
    .nx-input:focus {
        outline: none;
        box-shadow: var(--shadow-stamp-md);
        transform: translate(-1px, -1px);
    }
    .nx-textarea:disabled,
    .nx-input:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .nx-textarea-primary {
        font-family: var(--font-cjk);
        font-size: 22px;
        font-weight: 500;
        line-height: 1.3;
        min-height: 92px;
    }
    .nx-field-dragging .nx-textarea {
        outline: 2px dashed var(--accent);
        outline-offset: 3px;
        background: color-mix(in oklch, var(--accent) 6%, var(--paper));
    }
    .nx-form-loading {
        font-size: 12px;
        color: var(--ink-mute);
        padding: 24px 0;
        text-align: center;
        letter-spacing: 0.04em;
    }
    .nx-field-error {
        padding: 10px 12px;
        border: 1.5px solid var(--due);
        background: color-mix(in oklch, var(--due) 10%, var(--paper));
        color: var(--due);
        border-radius: var(--radius-md);
        font-size: 12px;
    }

    /* ============== PREVIEW ============== */
    .nx-preview-col {
        display: flex;
        flex-direction: column;
        gap: 12px;
        position: sticky;
        top: var(--space-6);
    }
    .nx-preview-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
    }
    .nx-preview-deck {
        font-size: 11px;
        color: var(--ink-mute);
        letter-spacing: 0.04em;
    }
    .nx-preview-stack {
        position: relative;
    }
    .nx-preview-back {
        position: absolute;
        inset: 0;
        transform: translate(6px, 6px) rotate(-0.4deg);
        background: var(--bg-soft);
        border: 1.5px solid var(--ink);
        border-radius: var(--radius-md);
        z-index: 0;
    }
    .nx-preview-card {
        position: relative;
        background: var(--paper);
        border: 1.5px solid var(--ink);
        border-radius: var(--radius-md);
        padding: 28px 32px;
        min-height: 320px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        z-index: 1;
        box-shadow: var(--shadow-stamp-sm);
    }
    .nx-preview-tags {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
    }
    .nx-preview-primary {
        font-family: var(--font-cjk);
        font-size: 44px;
        font-weight: 500;
        line-height: 1.15;
        text-align: center;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--ink);
    }
    .nx-preview-empty {
        text-align: center;
        color: var(--ink-mute);
        font-size: 12px;
        padding: 28px 0;
        letter-spacing: 0.04em;
    }
    .nx-preview-rule {
        width: 55%;
        margin: 4px auto;
        border-top: 1px dashed var(--rule);
    }
    .nx-preview-secondary {
        font-size: 14px;
        text-align: center;
        color: var(--accent);
        white-space: pre-wrap;
        word-break: break-word;
    }
    .nx-preview-extras {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .nx-preview-extra {
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    .nx-preview-extra-label {
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }
    .nx-preview-extra-text {
        font-family: var(--font-cjk);
        font-size: 14px;
        line-height: 1.5;
        color: var(--ink);
        white-space: pre-wrap;
        word-break: break-word;
    }
    .nx-preview-footer {
        margin-top: auto;
        padding-top: 14px;
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.08em;
        border-top: 1px dashed var(--rule);
    }

    /* ============== MOBILE (≤768px) ============== */
    @media (max-width: 768px) {
        .nx-page {
            padding: var(--space-5) var(--space-4) var(--space-10);
            gap: var(--space-5);
        }
        .nx-head {
            align-items: flex-start;
        }
        .nx-title {
            font-size: 22px;
        }
        .nx-title-hand {
            font-size: 18px;
            margin-left: 8px;
        }
        .nx-subtitle-kbd {
            display: none;
        }
        .nx-actions {
            width: 100%;
            justify-content: flex-end;
        }
        .nx-toolbar {
            grid-template-columns: 1fr;
            gap: 10px;
            padding: 12px 14px;
        }
        .nx-toolbar-status {
            min-width: 0;
        }
        .nx-grid {
            grid-template-columns: 1fr;
            gap: 18px;
        }
        .nx-preview-col {
            position: static;
        }
        .nx-preview-card {
            padding: 20px 22px;
            min-height: 240px;
        }
        .nx-preview-primary {
            font-size: 32px;
        }
        .nx-textarea-primary {
            font-size: 18px;
            min-height: 76px;
        }
    }
</style>
