<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 18 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 18 18">
    {#snippet children()}
        <circle cx="9" cy="9" r="7" />
        <path d="M9 4.5 L 9 9 L 12.5 11" />
    {/snippet}
</Mark>
