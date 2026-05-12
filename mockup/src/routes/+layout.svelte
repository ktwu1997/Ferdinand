<script lang="ts">
    import "../app.css";
    import { onMount } from "svelte";
    import { browser } from "$app/environment";
    import { goto } from "$app/navigation";
    import { page } from "$app/stores";
    import Sidebar from "$lib/components/Sidebar.svelte";
    import BottomNav from "$lib/components/BottomNav.svelte";
    import MobileTopBar from "$lib/components/MobileTopBar.svelte";
    import { setOnUnauthorized } from "$lib/api";
    import { auth } from "$lib/auth.svelte";

    interface Props {
        children?: any;
    }

    let { children }: Props = $props();

    // Full-screen routes (no chrome — sidebar, topbar, or bottom nav).
    // /login lives here so the sketch-skin login page renders edge-to-edge
    // without the legacy cream chrome around it.
    const fullscreenRoutes = ["/study", "/login"];

    let isFullscreen = $derived(
        fullscreenRoutes.some((r) => $page.url.pathname.startsWith(r)),
    );

    // Routes that render their OWN left-rail chrome and therefore must not
    // get the global nav sidebar on top of it. /browse has the browse-tree
    // (.bx-sidebar — DECKS / STATE / TAGS / SAVED, with the "Ferdinand"
    // brand at the top doubling as the home link) which IS the desktop
    // chrome there. We still keep MobileTopBar + BottomNav: at ≤640px the
    // .bx-sidebar collapses, so mobile needs the bottom nav.
    const noGlobalSidebarRoutes = ["/browse"];

    let hideGlobalSidebar = $derived(
        noGlobalSidebarRoutes.some((r) => $page.url.pathname.startsWith(r)),
    );

    // Phase A4-β: wire the 401-redirect hook on app mount, then bootstrap
    // the auth store so we know `authed`/`anon` before the route guard
    // runs. Both happen inside `onMount` so SvelteKit's SSR pass doesn't
    // try to use $app/navigation. Bootstrap is fire-and-forget — the
    // guard's $effect re-runs once status flips off "checking", so we
    // don't need to await here.
    onMount(() => {
        setOnUnauthorized(() => auth.handleUnauthorized());
        void auth.bootstrap();
        return () => setOnUnauthorized(null);
    });

    // Phase A4-β route guard. Whenever auth resolves to "anon" and the
    // user is anywhere other than /login, bounce them to /login with the
    // attempted path in `?next=` so the post-login redirect lands them
    // back where they started. The guard sits inside `$effect` so it
    // observes both `auth.status` and the active pathname; "unknown" /
    // "checking" leave the user where they are (the layout shell stays
    // up — pages can show their own loading affordance off
    // `auth.status === "checking"` if they want).
    $effect(() => {
        if (!browser) return;
        if (auth.status !== "anon") return;
        const path = $page.url.pathname;
        if (path === "/login") return;
        const next = path + $page.url.search;
        void goto(`/login?next=${encodeURIComponent(next)}`);
    });
</script>

<div class="shell" class:fullscreen={isFullscreen}>
    {#if !isFullscreen}
        <MobileTopBar />
    {/if}
    {#if !isFullscreen && !hideGlobalSidebar}
        <Sidebar />
    {/if}
    <main class:fullscreen={isFullscreen}>
        {@render children?.()}
    </main>
    {#if !isFullscreen}
        <BottomNav />
    {/if}
</div>

<style>
    /* Desktop default — sidebar to the left, content to the right.
       On phone the sidebar self-hides via its own @media (max-width: 640px),
       and the MobileTopBar + BottomNav take over (they self-hide ≥641px). */
    .shell {
        display: grid;
        grid-template-columns: auto 1fr;
        grid-template-rows: auto 1fr auto;
        grid-template-areas:
            "sidebar topbar"
            "sidebar main"
            "sidebar bottom";
        min-height: 100vh;
        min-height: 100dvh;
    }
    .shell.fullscreen {
        display: block;
    }
    main {
        grid-area: main;
        min-width: 0;
    }

    /* Below tablet, sidebar is hidden and the bottom nav sits below main —
       keep main from being covered by the fixed BottomNav by reserving space. */
    @media (max-width: 640px) {
        .shell {
            grid-template-columns: 1fr;
            grid-template-areas:
                "topbar"
                "main"
                "bottom";
        }
        main {
            padding-bottom: calc(var(--bottom-nav-h) + var(--safe-bottom));
        }
    }
</style>
