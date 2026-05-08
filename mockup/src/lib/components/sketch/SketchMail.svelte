<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 18 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 18 18">
    {#snippet children()}
        <path d="M2.5 5 L 15.5 5 C 16 5, 16.2 5.3, 16.2 5.7 L 16.2 13 C 16.2 13.5, 15.8 13.7, 15.5 13.7 L 2.5 13.7 C 2.1 13.7, 1.8 13.4, 1.8 13 L 1.8 5.7 C 1.8 5.3, 2 5, 2.5 5 Z" />
        <path d="M2 5.5 L 9 10 L 16 5.5" />
    {/snippet}
</Mark>
