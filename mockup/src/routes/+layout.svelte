<script lang="ts">
    import "../app.css";
    import { page } from "$app/stores";
    import Sidebar from "$lib/components/Sidebar.svelte";
    import BottomNav from "$lib/components/BottomNav.svelte";
    import MobileTopBar from "$lib/components/MobileTopBar.svelte";

    interface Props {
        children?: any;
    }

    let { children }: Props = $props();

    // Full-screen routes (no chrome — sidebar, topbar, or bottom nav)
    const fullscreenRoutes = ["/study"];

    let isFullscreen = $derived(
        fullscreenRoutes.some((r) => $page.url.pathname.startsWith(r)),
    );
</script>

<div class="shell" class:fullscreen={isFullscreen}>
    {#if !isFullscreen}
        <MobileTopBar />
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
