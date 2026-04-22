<script lang="ts">
    import "../app.css";
    import { page } from "$app/stores";
    import Sidebar from "$lib/components/Sidebar.svelte";

    interface Props {
        children?: any;
    }

    let { children }: Props = $props();

    // Full-screen routes (no sidebar)
    const fullscreenRoutes = ["/study"];

    let isFullscreen = $derived(
        fullscreenRoutes.some((r) => $page.url.pathname.startsWith(r)),
    );
</script>

<div class="shell" class:fullscreen={isFullscreen}>
    {#if !isFullscreen}
        <Sidebar />
    {/if}
    <main class:fullscreen={isFullscreen}>
        {@render children?.()}
    </main>
</div>

<style>
    .shell {
        display: flex;
        min-height: 100vh;
    }
    .shell.fullscreen {
        display: block;
    }
    main {
        flex: 1;
        min-width: 0;
    }
</style>
