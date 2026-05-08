<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 36 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 40 40" class="thick">
    {#snippet children()}
        <path d="M10.5 5.4 C 10.2 14, 10.4 24, 10.7 33.6" />
        <path d="M10.7 5.6 C 17, 5.2, 23.5, 5.1, 28.6 5.5" />
        <path d="M10.7 19.2 C 15.4, 18.9, 19.6, 18.8, 23.2 19.1" />
        <path
            d="M28.8 5.5 C 32.5, 4, 34.6, 6.4, 33.4 9.8 C 32.2, 13, 28.6, 12.5, 27.4 9.2 Z"
            class="fill-accent-soft"
            style="stroke: var(--accent)"
        />
        <path d="M30 8.4 L 32 6.8" style="stroke: var(--accent)" />
    {/snippet}
</Mark>
