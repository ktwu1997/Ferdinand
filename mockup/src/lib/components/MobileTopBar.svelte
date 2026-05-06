<script lang="ts">
    import ThemeToggle from "./ThemeToggle.svelte";
</script>

<header class="topbar" aria-label="Top bar">
    <a class="brand" href="/" aria-label="Home">
        <span class="dot" aria-hidden="true"></span>
        <span class="name">Anki</span>
    </a>
    <div class="spacer"></div>
    <button class="icon-btn" type="button" aria-label="Search" title="Search">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
    </button>
    <ThemeToggle />
</header>

<style>
    .topbar {
        position: sticky;
        top: 0;
        z-index: 40;
        display: none;
        align-items: center;
        gap: var(--space-2);
        height: calc(var(--topbar-h) + var(--safe-top));
        padding: var(--safe-top) var(--space-4) 0;
        background: color-mix(in oklch, var(--bg) 88%, transparent);
        backdrop-filter: saturate(140%) blur(10px);
        -webkit-backdrop-filter: saturate(140%) blur(10px);
        border-bottom: 1px solid var(--border);
    }
    .brand {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--text);
    }
    .brand .dot {
        width: 10px;
        height: 10px;
        background: var(--accent);
        border-radius: 50%;
    }
    .brand .name {
        font-weight: 600;
        font-size: var(--text-base);
        letter-spacing: -0.01em;
    }
    .spacer {
        flex: 1;
    }
    .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-min);
        height: var(--touch-min);
        margin: 0 -8px;
        border-radius: var(--radius-sm);
        color: var(--text-muted);
    }
    .icon-btn:active {
        background: var(--bg-hover);
        color: var(--text);
    }

    @media (max-width: 640px) {
        .topbar {
            display: flex;
        }
    }
</style>
