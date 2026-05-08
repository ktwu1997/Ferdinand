<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 18 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 18 18">
    {#snippet children()}
        <path d="M3.5 8 L 14.5 8 C 15.2 8, 15.5 8.4, 15.5 9 L 15.5 15 C 15.5 15.6, 15.2 16, 14.5 16 L 3.5 16 C 2.8 16, 2.5 15.6, 2.5 15 L 2.5 9 C 2.5 8.4, 2.8 8, 3.5 8 Z" />
        <path d="M5.5 8 L 5.5 5.5 C 5.5 3, 7 2, 9 2 C 11 2, 12.5 3, 12.5 5.5 L 12.5 8" />
    {/snippet}
</Mark>
