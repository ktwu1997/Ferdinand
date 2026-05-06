<script lang="ts">
    import { page } from "$app/stores";

    const items = [
        { href: "/", label: "Today", icon: "home" },
        { href: "/browse", label: "Browse", icon: "search" },
        { href: "/stats", label: "Stats", icon: "chart" },
        { href: "/settings", label: "Settings", icon: "settings" },
    ];

    function isActive(href: string, current: string): boolean {
        if (href === "/") return current === "/";
        return current.startsWith(href);
    }

    let currentPath = $derived($page.url.pathname);
</script>

<nav class="bottom-nav" aria-label="Primary">
    {#each items as item (item.href)}
        <a
            href={item.href}
            class="tab"
            class:active={isActive(item.href, currentPath)}
            aria-current={isActive(item.href, currentPath) ? "page" : undefined}
        >
            <span class="icon" aria-hidden="true">
                {#if item.icon === "home"}
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z"/></svg>
                {:else if item.icon === "search"}
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                {:else if item.icon === "chart"}
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16l4-4 4 3 5-7"/></svg>
                {:else}
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09c0 .67.39 1.26 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82c.25.61.84 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.67 0-1.26.39-1.51 1z"/></svg>
                {/if}
            </span>
            <span class="label">{item.label}</span>
        </a>
    {/each}
</nav>

<style>
    .bottom-nav {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 50;
        display: none;
        background: var(--bg-elevated);
        border-top: 1px solid var(--border);
        padding-bottom: var(--safe-bottom);
    }
    .bottom-nav > .tab {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        min-height: var(--touch-min);
        padding: 6px 4px 8px;
        color: var(--text-subtle);
        font-size: 0.7rem;
        line-height: 1;
        transition: color var(--duration-fast) var(--ease);
    }
    .bottom-nav > .tab .icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 24px;
    }
    .bottom-nav > .tab.active {
        color: var(--accent);
    }
    .bottom-nav > .tab:not(.active):active {
        color: var(--text);
    }
    .bottom-nav > .tab .label {
        font-weight: 500;
        letter-spacing: 0.01em;
    }

    @media (max-width: 640px) {
        .bottom-nav {
            display: flex;
        }
    }
</style>
