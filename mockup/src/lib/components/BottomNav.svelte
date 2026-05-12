<!--
  Mobile bottom nav (≤640px) — the kraft-paper tab bar from
  design_handoff_ferdinand/source/dashboard.jsx (DashboardMobile bottom nav):
  hand-drawn sketch icons, mono uppercase labels, a 1.5px ink top border on a
  --bg-soft ground, active tab in --accent and the rest in --ink-mute.

  The design draws four tabs (decks · browse · add · stats); we keep the impl's
  fifth "Settings" tab so settings stays reachable on small screens. Carries
  `class="sketch-skin"` so the kraft tokens resolve.
-->
<script lang="ts">
    import type { Component } from "svelte";
    import { page } from "$app/stores";
    import {
        SketchBook,
        SketchCardStack,
        SketchPlus,
        SketchCalendar,
        SketchGear,
    } from "$lib/components/sketch";

    type IconCmp = Component<{ size?: number }>;

    interface TabItem {
        href: string;
        label: string;
        icon: IconCmp;
    }

    // Mirrors the desktop rail (Sidebar.svelte) plus a Settings tab. "New" is
    // the short label for the New-note route so the 5-tab row stays legible.
    const items: TabItem[] = [
        { href: "/", label: "Decks", icon: SketchBook },
        { href: "/browse", label: "Browse", icon: SketchCardStack },
        { href: "/notes/new", label: "New", icon: SketchPlus },
        { href: "/stats", label: "Stats", icon: SketchCalendar },
        { href: "/settings", label: "Settings", icon: SketchGear },
    ];

    function isActive(href: string, current: string): boolean {
        if (href === "/") return current === "/";
        return current.startsWith(href);
    }

    let currentPath = $derived($page.url.pathname);
</script>

<nav class="bottom-nav sketch-skin" aria-label="Primary">
    {#each items as item (item.href)}
        {@const Icon = item.icon}
        {@const active = isActive(item.href, currentPath)}
        <a
            href={item.href}
            class="tab"
            class:active
            aria-current={active ? "page" : undefined}
        >
            <span class="icon"><Icon size={22} /></span>
            <span class="label mono">{item.label}</span>
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
        grid-template-columns: repeat(5, 1fr);
        background: var(--bg-soft);
        border-top: 1.5px solid var(--ink);
        padding: 8px 0 calc(var(--safe-bottom) + 14px);
    }
    .bottom-nav > .tab {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-height: var(--touch-min);
        padding: 6px 4px;
        text-decoration: none;
        color: var(--ink-mute);
        transition: color 120ms ease;
    }
    .bottom-nav > .tab .icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 24px;
    }
    .bottom-nav > .tab .label {
        font-size: 9px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        line-height: 1;
    }
    .bottom-nav > .tab.active {
        color: var(--accent);
    }
    .bottom-nav > .tab:not(.active):active {
        color: var(--ink);
    }
    .bottom-nav > .tab:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: -2px;
    }

    @media (max-width: 640px) {
        .bottom-nav {
            display: grid;
        }
    }
</style>
