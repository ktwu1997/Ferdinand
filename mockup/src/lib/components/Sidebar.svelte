<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/stores";
    import ThemeToggle from "./ThemeToggle.svelte";
    import Kbd from "./Kbd.svelte";
    import { FerdinandMark } from "$lib/components/sketch";
    import { fetchDecks } from "$lib/api";
    import { flattenLeafDecks } from "$lib/decks";

    // Design 02/05/06/07: app-nav rail is Decks · Browse · New note · Stats.
    // We keep Settings (a real page now). "Decks" is the home/dashboard link
    // (the dashboard page is titled "decks").
    const nav = [
        { href: "/", label: "Decks", hint: "H", icon: "home" },
        { href: "/browse", label: "Browse", hint: "B", icon: "search" },
        { href: "/notes/new", label: "New note", hint: "N", icon: "new-note" },
        { href: "/stats", label: "Stats", hint: "S", icon: "chart" },
        { href: "/settings", label: "Settings", hint: ",", icon: "settings" },
    ];

    function isActive(href: string, current: string): boolean {
        if (href === "/") return current === "/";
        return current.startsWith(href);
    }

    let currentPath = $derived($page.url.pathname);

    interface SidebarDeck {
        id: number;
        name: string;
        due: number;
    }

    // Live decks from /api/decks. `null` while loading or after a fetch
    // error — the sidebar simply hides the deck section in that case
    // rather than leaking fake fixtures (which would mask outages).
    // Like the dashboard ledger, this lists the studiable *leaf* decks
    // (flattenLeafDecks rewrites each name to the full `Foo::Bar::Baz`
    // path) so a container parent like `TOEIC` isn't shown as the only
    // entry and the two surfaces stay consistent. The narrow rail
    // ellipsises long names — the full path is on the row's `title`.
    let liveDecks: SidebarDeck[] | null = $state(null);

    onMount(async () => {
        try {
            const res = await fetchDecks();
            liveDecks = flattenLeafDecks(res.decks)
                .filter((d) => d.id !== 0 && d.level >= 1)
                .map((d) => ({
                    id: d.id,
                    name: d.name,
                    due: d.new_count + d.learn_count + d.review_count,
                }));
        } catch {
            liveDecks = [];
        }
    });
</script>

<aside>
    <div class="brand">
        <span class="mark"><FerdinandMark size={22} /></span>
        <span class="name mono">Ferdinand</span>
    </div>

    <button class="palette-trigger" type="button">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <span>Jump or search…</span>
        <span class="kbd-wrap"><Kbd>⌘ K</Kbd></span>
    </button>

    <nav>
        {#each nav as item (item.href)}
            <a href={item.href} class="nav-item" class:active={isActive(item.href, currentPath)}>
                <span class="icon">
                    {#if item.icon === "home"}
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z" /></svg>
                    {:else if item.icon === "search"}
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                    {:else if item.icon === "new-note"}
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
                    {:else if item.icon === "chart"}
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18" /><path d="M7 16l4-4 4 3 5-7" /></svg>
                    {:else}
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09c0 .67.39 1.26 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82c.25.61.84 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.67 0-1.26.39-1.51 1z" /></svg>
                    {/if}
                </span>
                <span class="label">{item.label}</span>
                <span class="hint"><Kbd>{item.hint}</Kbd></span>
            </a>
        {/each}
    </nav>

    {#if liveDecks && liveDecks.length > 0}
        <div class="section-label">Decks</div>
        <nav class="deck-list">
            {#each liveDecks as deck (deck.id)}
                <a href="/study/{deck.id}" class="deck-item" title={deck.name}>
                    <span class="emoji">📚</span>
                    <span class="deck-name">{deck.name}</span>
                    {#if deck.due > 0}
                        <span class="badge">{deck.due}</span>
                    {/if}
                </a>
            {/each}
        </nav>
    {/if}

    <div class="spacer"></div>

    <div class="footer">
        <div class="sync">
            <span class="sync-dot"></span>
            <span>Synced · 2m ago</span>
        </div>
        <ThemeToggle />
    </div>
</aside>

<style>
    aside {
        grid-area: sidebar;
        width: var(--sidebar-w);
        min-height: 100vh;
        min-height: 100dvh;
        padding: var(--space-5) var(--space-4) var(--space-4);
        border-right: 1px solid var(--border);
        background: var(--bg-subtle);
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        position: sticky;
        top: 0;
        flex-shrink: 0;
    }

    /* Phone: hide sidebar entirely; BottomNav + MobileTopBar take over. */
    @media (max-width: 640px) {
        aside {
            display: none;
        }
    }

    .brand {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 0 var(--space-2);
    }
    .brand .mark {
        display: inline-flex;
        align-items: center;
        color: var(--text);
        flex: 0 0 auto;
    }
    .brand .name {
        font-weight: 600;
        font-size: var(--text-base);
        letter-spacing: 0.01em;
    }

    .palette-trigger {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 0.5rem 0.6rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        color: var(--text-subtle);
        font-size: var(--text-sm);
        text-align: left;
        transition: border-color var(--duration-fast) var(--ease),
            background var(--duration-fast) var(--ease);
    }
    .palette-trigger:hover {
        border-color: var(--border-strong);
        background: var(--bg-hover);
        color: var(--text-muted);
    }
    .palette-trigger span:nth-child(2) {
        flex: 1;
    }
    .kbd-wrap :global(kbd) {
        font-size: 0.65rem;
    }

    nav {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .nav-item {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: 0.45rem 0.6rem;
        border-radius: var(--radius-sm);
        color: var(--text-muted);
        font-size: var(--text-sm);
        transition: background-color var(--duration-fast) var(--ease),
            color var(--duration-fast) var(--ease);
    }
    .nav-item:hover {
        background: var(--bg-hover);
        color: var(--text);
    }
    .nav-item.active {
        background: var(--bg-hover);
        color: var(--text);
        font-weight: 500;
    }
    .nav-item .icon {
        display: inline-flex;
        color: var(--text-subtle);
    }
    .nav-item.active .icon {
        color: var(--accent);
    }
    .nav-item .label {
        flex: 1;
    }
    .nav-item .hint {
        opacity: 0;
        transition: opacity var(--duration-fast) var(--ease);
    }
    .nav-item:hover .hint,
    .nav-item.active .hint {
        opacity: 1;
    }

    .section-label {
        font-size: 0.65rem;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--text-subtle);
        padding: 0 var(--space-2);
        margin-top: var(--space-2);
    }

    .deck-list {
        gap: 1px;
    }
    .deck-item {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: 0.4rem 0.6rem;
        border-radius: var(--radius-sm);
        color: var(--text-muted);
        font-size: var(--text-sm);
    }
    .deck-item:hover {
        background: var(--bg-hover);
        color: var(--text);
    }
    .deck-item .emoji {
        font-size: 0.95rem;
        width: 18px;
        text-align: center;
    }
    .deck-item .deck-name {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .deck-item .badge {
        font-variant-numeric: tabular-nums;
        color: var(--text-subtle);
        font-size: 0.75rem;
    }

    .spacer {
        flex: 1;
    }

    .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-2);
        border-top: 1px solid var(--border);
        padding-top: var(--space-3);
    }
    .sync {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-xs);
        color: var(--text-subtle);
    }
    .sync-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--success);
    }
</style>
