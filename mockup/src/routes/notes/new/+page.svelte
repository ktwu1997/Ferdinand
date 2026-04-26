<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import Card from "$lib/components/Card.svelte";
    import Button from "$lib/components/Button.svelte";
    import {
        fetchDecks,
        postNote,
        type ApiDeckSummary,
    } from "$lib/api";

    // Phase 12-C: minimal Add-Note flow. Wires the home page's existing
    // "Add note" button to a real server endpoint via /api/notes. v1
    // assumes the server-side default notetype ("Basic") so the form
    // is just deck + Front + Back + tags. Future: notetype picker for
    // Cloze and custom notetypes.

    let decks = $state<ApiDeckSummary[] | null>(null);
    let deckId = $state<number | null>(null);
    let front = $state("");
    let back = $state("");
    let tagsRaw = $state("");
    let saving = $state(false);
    let error: string | null = $state(null);
    let loadError: string | null = $state(null);

    onMount(async () => {
        try {
            const res = await fetchDecks();
            // Filter out the implicit root and skip filtered decks
            // (server rejects them anyway; making the option un-selectable
            // here saves the user from a 400 round-trip).
            decks = res.decks.filter(
                (d) => d.id !== 0 && d.level >= 1 && !d.filtered,
            );
            if (decks.length > 0) {
                // Default to the first non-filtered deck so the form is
                // immediately submittable on a fresh load.
                deckId = decks[0].id;
            }
        } catch (e) {
            loadError =
                e instanceof Error ? e.message : "Couldn't load decks";
        }
    });

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
        deckId !== null && front.trim() !== "" && !saving,
    );

    async function save(): Promise<void> {
        if (!canSubmit || deckId === null) return;
        saving = true;
        error = null;
        try {
            await postNote({
                deck_id: deckId,
                fields: [front, back],
                tags: parsedTags,
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
            <strong>Couldn't load decks.</strong>
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
                <label for="front-input">Front</label>
                <textarea
                    id="front-input"
                    class="text-input"
                    bind:value={front}
                    disabled={saving}
                    rows="3"
                    required
                    placeholder="森林"
                ></textarea>
            </div>

            <div class="field">
                <label for="back-input">Back</label>
                <textarea
                    id="back-input"
                    class="text-input"
                    bind:value={back}
                    disabled={saving}
                    rows="4"
                    placeholder="しんりん — forest, woods"
                ></textarea>
            </div>

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
