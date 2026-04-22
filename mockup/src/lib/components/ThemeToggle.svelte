<script lang="ts">
    import { onMount } from "svelte";
    import { toggleTheme, getTheme, type Theme } from "$lib/theme";

    let current: Theme = $state("light");

    onMount(() => {
        current = getTheme();
    });

    function handleClick() {
        current = toggleTheme();
    }
</script>

<button
    type="button"
    class="toggle"
    onclick={handleClick}
    aria-label={current === "dark" ? "切換為淺色模式" : "切換為深色模式"}
    title="⌘ + J"
>
    {#if current === "dark"}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
    {:else}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
    {/if}
</button>

<style>
    .toggle {
        width: 34px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-md);
        color: var(--text-muted);
        border: 1px solid transparent;
        transition: background-color var(--duration-fast) var(--ease),
            color var(--duration-fast) var(--ease);
    }
    .toggle:hover {
        background: var(--bg-hover);
        color: var(--text);
    }
</style>
