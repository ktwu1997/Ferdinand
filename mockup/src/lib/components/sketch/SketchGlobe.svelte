<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 18 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 18 18">
    {#snippet children()}
        <circle cx="9" cy="9" r="7" />
        <path d="M2 9 L 16 9" />
        <path d="M9 2 C 5 6, 5 12, 9 16" />
        <path d="M9 2 C 13 6, 13 12, 9 16" />
    {/snippet}
</Mark>
