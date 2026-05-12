<!--
  Global navigation rail — the kraft-paper "NAV" sidebar from
  design_handoff_ferdinand/source/dashboard.jsx (NavRail/NavLink), rendered on
  every chrome route (/, /stats, /settings, /notes/new) via +layout.svelte.

  Layout per the design:
    • brand row  — FerdinandMark + "Ferdinand" (mono), links home
    • NAV        — Decks (active, with a due-count badge) · Browse · New note · Stats
    • PINNED     — a small static set of saved-search shortcuts → /browse?q=…
    • footer     — avatar + username + host, a `settings` ghost button, ThemeToggle

  The whole rail carries `class="sketch-skin"` so --ink/--paper/--bg-soft/--rule/
  --accent/--shadow-stamp-* resolve from src/styles/tokens.css (the chrome itself
  isn't wrapped in a sketch-skin'd page like the route content is). Active links
  use the bordered-paper-box + stamp-shadow treatment that matches the Settings
  sub-rail's active rows, so all the rails read as siblings.
-->
<script lang="ts">
    import { onMount } from "svelte";
    import type { Component } from "svelte";
    import { page } from "$app/stores";
    import ThemeToggle from "./ThemeToggle.svelte";
    import { Btn, Caption } from "$lib/components/ui";
    import {
        FerdinandMark,
        SketchBook,
        SketchCardStack,
        SketchPlus,
        SketchCalendar,
        SketchGear,
    } from "$lib/components/sketch";
    import { auth } from "$lib/auth.svelte";
    import { fetchDecks } from "$lib/api";
    import { flattenLeafDecks } from "$lib/decks";

    type IconCmp = Component<{ size?: number }>;

    interface NavItem {
        href: string;
        label: string;
        icon: IconCmp;
        /** Show the total-due badge on this row (the "Decks" home link). */
        showBadge?: boolean;
    }

    // Design 02/05/06/07: the rail's primary destinations. Settings is
    // reached from the footer ghost button (matching the design), not the
    // nav list. "Decks" is the home/dashboard link (the dashboard is titled
    // "decks").
    const nav: NavItem[] = [
        { href: "/", label: "Decks", icon: SketchBook, showBadge: true },
        { href: "/browse", label: "Browse", icon: SketchCardStack },
        { href: "/notes/new", label: "New note", icon: SketchPlus },
        { href: "/stats", label: "Stats", icon: SketchCalendar },
    ];

    // PINNED — a small static set of saved-search shortcuts. Each links to
    // /browse?q=<query>; the browse page seeds its search box from `?q=`. A
    // real pinned-searches store can come later.
    const pinned: { label: string; q: string }[] = [
        { label: "leeches", q: "tag:leech" },
        { label: "added today", q: "added:1" },
        { label: "hard rust", q: "rated:1:1" },
    ];

    function isActive(href: string, current: string): boolean {
        if (href === "/") return current === "/";
        return current.startsWith(href);
    }

    let currentPath = $derived($page.url.pathname);
    let host = $derived($page.url.host);
    let username = $derived(auth.user?.username ?? "ktwu");
    let initials = $derived(username.slice(0, 2).toLowerCase());

    // Total cards due across all leaf decks — drives the "Decks" badge.
    // `null` while loading or after a fetch error (no badge then), so an
    // outage hides the count rather than masking it with fake data.
    let dueCount: number | null = $state(null);

    onMount(async () => {
        try {
            const res = await fetchDecks();
            dueCount = flattenLeafDecks(res.decks)
                .filter((d) => d.id !== 0 && d.level >= 1)
                .reduce(
                    (sum, d) =>
                        sum + d.new_count + d.learn_count + d.review_count,
                    0,
                );
        } catch {
            dueCount = null;
        }
    });
</script>

<aside class="sketch-skin" aria-label="Navigation sidebar">
    <a class="brand" href="/" aria-label="Home — dashboard">
        <FerdinandMark size={28} />
        <span class="brand-name mono">Ferdinand</span>
    </a>

    <nav class="nav-group" aria-label="Primary">
        <Caption>nav</Caption>
        {#each nav as item (item.href)}
            {@const Icon = item.icon}
            {@const active = isActive(item.href, currentPath)}
            <a
                href={item.href}
                class="nav-link"
                class:active
                aria-current={active ? "page" : undefined}
            >
                <span class="nav-link-main">
                    <span class="nav-icon"><Icon size={24} /></span>
                    <span class="nav-label mono">{item.label}</span>
                </span>
                {#if item.showBadge && dueCount !== null && dueCount > 0}
                    <span class="nav-badge mono">{dueCount}</span>
                {/if}
            </a>
        {/each}
    </nav>

    <nav class="nav-group pinned" aria-label="Pinned searches">
        <Caption>pinned</Caption>
        {#each pinned as p (p.q)}
            <a
                class="nav-link small"
                href="/browse?q={encodeURIComponent(p.q)}"
            >
                <span class="nav-link-main">
                    <span class="nav-bullet" aria-hidden="true">·</span>
                    <span class="nav-label mono">{p.label}</span>
                </span>
                <span class="nav-hint mono">{p.q}</span>
            </a>
        {/each}
    </nav>

    <div class="footer">
        <div class="who">
            <span class="avatar mono" aria-hidden="true">{initials}</span>
            <span class="who-text">
                <span class="who-name mono">{username}</span>
                <span class="who-host mono">{host}</span>
            </span>
        </div>
        <div class="footer-actions">
            <Btn kind="ghost" size="sm" href="/settings">
                {#snippet leading()}<SketchGear size={14} />{/snippet}
                settings
            </Btn>
            <ThemeToggle />
        </div>
    </div>
</aside>

<style>
    aside {
        grid-area: sidebar;
        width: 220px;
        height: 100vh;
        height: 100dvh;
        padding: 28px 22px;
        border-right: 1.5px solid var(--ink);
        background: var(--bg-soft);
        display: flex;
        flex-direction: column;
        gap: 4px;
        position: sticky;
        top: 0;
        flex-shrink: 0;
        overflow-y: auto;
    }

    /* Phone: the global rail steps aside for MobileTopBar + BottomNav. */
    @media (max-width: 640px) {
        aside {
            display: none;
        }
    }

    .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 28px;
        text-decoration: none;
        color: var(--ink);
        border-radius: var(--radius);
    }
    .brand:hover .brand-name {
        color: var(--accent);
    }
    .brand:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    .brand-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--ink);
        letter-spacing: 0.01em;
        transition: color 120ms ease;
    }

    .nav-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .nav-group > :global(.caption) {
        margin-bottom: 8px;
    }
    .nav-group.pinned {
        margin-top: 18px;
    }

    .nav-link {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 10px;
        border-radius: var(--radius);
        border: 1.2px solid transparent;
        text-decoration: none;
        color: var(--ink-soft);
        background: transparent;
        font-family: var(--font-mono);
        font-size: 13px;
        letter-spacing: 0.02em;
        transition:
            background-color 120ms ease,
            color 120ms ease,
            border-color 120ms ease;
    }
    .nav-link.small {
        padding: 5px 10px;
        font-size: 11px;
    }
    .nav-link:hover {
        background: var(--bg-deep);
        color: var(--ink);
    }
    .nav-link.active {
        color: var(--ink);
        background: var(--paper);
        border-color: var(--ink);
        box-shadow: 2px 2px 0 var(--ink);
    }
    .nav-link:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    .nav-link-main {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }
    .nav-icon {
        display: inline-flex;
        align-items: center;
        color: var(--ink-soft);
        flex: 0 0 auto;
    }
    .nav-link.active .nav-icon {
        color: var(--ink);
    }
    .nav-bullet {
        color: var(--ink-mute);
        margin-right: 2px;
        flex: 0 0 auto;
    }
    .nav-label {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .nav-badge {
        font-size: 10px;
        color: var(--accent);
        font-weight: 600;
        flex: 0 0 auto;
        font-variant-numeric: tabular-nums;
    }
    .nav-hint {
        font-size: 10px;
        color: var(--ink-mute);
        flex: 0 0 auto;
        white-space: nowrap;
    }

    .footer {
        margin-top: auto;
        border-top: 1px dashed var(--rule);
        padding-top: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .who {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
    }
    .avatar {
        width: 32px;
        height: 32px;
        flex: 0 0 32px;
        border-radius: var(--radius);
        background: var(--accent);
        color: var(--bg);
        display: grid;
        place-items: center;
        font-size: 13px;
        font-weight: 600;
        text-transform: lowercase;
        line-height: 1;
    }
    .who-text {
        display: flex;
        flex-direction: column;
        line-height: 1.2;
        min-width: 0;
    }
    .who-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--ink);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .who-host {
        font-size: 10px;
        color: var(--ink-mute);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .footer-actions {
        display: flex;
        align-items: center;
        gap: 6px;
    }
</style>
