<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 18 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 18 18">
    {#snippet children()}
        <path d="M2.5 4 C 2.4 3, 3 2.4, 4 2.5 L 14 2.5 C 15 2.5, 15.6 3.1, 15.5 4 L 15.5 14 C 15.5 15, 15 15.6, 14 15.5 L 4 15.5 C 3 15.5, 2.4 15, 2.5 14 Z" />
        <path d="M5 9 L 8 12 L 14 5" class="thick" style="stroke: var(--accent)" />
    {/snippet}
</Mark>
