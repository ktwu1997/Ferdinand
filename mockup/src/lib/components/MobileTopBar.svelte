<!--
  Mobile top bar (≤640px) — the kraft-paper header from
  design_handoff_ferdinand/source/dashboard.jsx (DashboardMobile header):
  FerdinandMark + "Ferdinand" on the left, search + user icons on the right,
  a dashed bottom rule. We keep a compact ThemeToggle alongside the icons
  (the only theme control reachable on small screens). The search glyph links
  to /browse and the user glyph to /settings so the decoration in the mockup
  becomes a real affordance.

  Carries `class="sketch-skin"` so the kraft tokens resolve (the chrome isn't
  inside a sketch-skin'd page wrapper the way the route content is).
-->
<script lang="ts">
    import ThemeToggle from "./ThemeToggle.svelte";
    import Brand from "$lib/components/Brand.svelte";
    import { SketchSearch, SketchUser } from "$lib/components/sketch";
</script>

<header class="topbar sketch-skin" aria-label="Top bar">
    <Brand size={24} />
    <div class="spacer"></div>
    <a class="icon-link" href="/browse" aria-label="Browse" title="Browse">
        <SketchSearch size={18} />
    </a>
    <ThemeToggle />
    <a class="icon-link" href="/settings" aria-label="Settings" title="Settings">
        <SketchUser size={18} />
    </a>
</header>

<style>
    .topbar {
        position: sticky;
        top: 0;
        z-index: 40;
        display: none;
        align-items: center;
        gap: 12px;
        padding: calc(var(--safe-top) + 14px) 22px 14px;
        background: var(--bg);
        border-bottom: 1px dashed var(--rule);
    }
    .spacer {
        flex: 1;
    }
    .icon-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: var(--radius);
        color: var(--ink-soft);
        text-decoration: none;
        transition:
            background-color 120ms ease,
            color 120ms ease;
    }
    .icon-link:hover,
    .icon-link:active {
        background: var(--bg-deep);
        color: var(--ink);
    }
    .icon-link:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }

    @media (max-width: 640px) {
        .topbar {
            display: flex;
        }
    }
</style>
