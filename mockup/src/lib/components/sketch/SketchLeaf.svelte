<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 36 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 36 36">
    {#snippet children()}
        <path d="M6 30 C 6 18, 14 8, 30 6 C 28 22, 18 30, 6 30 Z" class="fill-accent-soft" style="stroke: var(--accent)" />
        <path d="M6 30 C 14 22, 22 14, 30 6" style="stroke: var(--accent)" />
    {/snippet}
</Mark>
