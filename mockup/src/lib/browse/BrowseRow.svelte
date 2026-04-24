<script lang="ts">
    import { mediaBase } from "$lib/api";
    import { extractFirstImage, hasAudio, stripHtmlToSnippet } from "./media";

    interface BrowseRowProps {
        id: string;
        frontHtml: string;
        backHtml: string;
        deckName: string;
        deckEmoji: string;
        tags: string[];
        due: string;
        state: "new" | "learning" | "review" | "suspended" | string;
        selected: boolean;
        onSelect: () => void;
    }

    let {
        frontHtml,
        backHtml,
        deckName,
        deckEmoji,
        tags,
        due,
        state,
        selected,
        onSelect,
    }: BrowseRowProps = $props();

    const snippet = $derived(stripHtmlToSnippet(frontHtml, 140));
    const image = $derived(
        extractFirstImage(frontHtml) ?? extractFirstImage(backHtml),
    );
    const audioPresent = $derived(hasAudio(frontHtml) || hasAudio(backHtml));
    const visibleTags = $derived(tags.slice(0, 2));
    const hiddenTagCount = $derived(Math.max(0, tags.length - 2));
</script>

<button class="row" class:selected onclick={onSelect}>
    <div class="thumb">
        {#if image}
            <img
                src="{mediaBase()}{image.src}"
                alt={image.alt}
                loading="lazy"
                decoding="async"
                width="64"
                height="64"
            />
        {:else}
            <div class="thumb-placeholder" aria-hidden="true"></div>
        {/if}
    </div>

    <div class="body">
        <div class="primary">
            <span class="snippet">{snippet || "(empty front)"}</span>
            {#if audioPresent}
                <span class="audio-badge" aria-label="Has audio" title="Has audio">
                    <svg
                        viewBox="0 0 24 24"
                        width="12"
                        height="12"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.75"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path d="M11 5 6 9H2v6h4l5 4z" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                </span>
            {/if}
        </div>
        <div class="secondary">
            <span class="deck">
                <span class="deck-emoji">{deckEmoji}</span>
                <span>{deckName}</span>
            </span>
            {#if visibleTags.length > 0}
                <span class="tag-sep">·</span>
                {#each visibleTags as t (t)}
                    <span class="tag">#{t}</span>
                {/each}
                {#if hiddenTagCount > 0}
                    <span class="tag more">+{hiddenTagCount}</span>
                {/if}
            {/if}
        </div>
    </div>

    <div class="due">{due}</div>
    <div class="state"><span class="state-chip state-{state}">{state}</span></div>
</button>

<style>
    .row {
        display: grid;
        grid-template-columns: 64px minmax(0, 1fr) auto auto;
        align-items: center;
        gap: var(--space-4);
        padding: var(--space-3) var(--space-4);
        background: #ffffff;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        text-align: left;
        cursor: pointer;
        transition:
            border-color var(--duration-fast) var(--ease),
            box-shadow var(--duration-fast) var(--ease),
            transform var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease);
    }
    :global([data-theme="dark"]) .row {
        background: var(--bg-elevated);
    }
    .row:hover {
        border-color: var(--border-strong);
        box-shadow: var(--shadow-sm);
    }
    @media (prefers-reduced-motion: no-preference) {
        .row:hover {
            transform: translateY(-1px);
        }
    }
    .row.selected {
        border-color: var(--accent-border);
        box-shadow: inset 3px 0 0 var(--accent);
    }

    .thumb {
        width: 64px;
        height: 64px;
        flex-shrink: 0;
        overflow: hidden;
        border-radius: var(--radius-sm);
        background: var(--bg-subtle);
    }
    .thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .thumb-placeholder {
        width: 100%;
        height: 100%;
        background: var(--bg-subtle);
    }

    .body {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }
    .primary {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
    }
    .snippet {
        font-family: var(--font-serif);
        font-size: 0.95rem;
        color: var(--text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }
    .audio-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--text-subtle);
        flex-shrink: 0;
    }
    .secondary {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-xs);
        color: var(--text-muted);
        overflow: hidden;
        white-space: nowrap;
    }
    .deck {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
    }
    .deck-emoji {
        font-size: 0.85rem;
    }
    .tag-sep {
        color: var(--text-subtle);
    }
    .tag {
        font-family: var(--font-mono);
        font-size: 0.7rem;
        color: var(--text-subtle);
        background: var(--bg-subtle);
        padding: 1px 6px;
        border-radius: var(--radius-sm);
    }
    .tag.more {
        font-family: var(--font-sans);
    }

    .due,
    .state {
        text-align: right;
        font-variant-numeric: tabular-nums;
        font-size: var(--text-xs);
        color: var(--text-muted);
    }
    .state-chip {
        font-size: 0.7rem;
        padding: 2px 8px;
        border-radius: var(--radius-full);
        text-transform: capitalize;
        font-weight: 500;
        display: inline-block;
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
</style>
