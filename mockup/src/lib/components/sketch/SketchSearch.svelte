<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 18 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 18 18">
    {#snippet children()}
        <circle cx="8" cy="8" r="5" />
        <path d="M11.5 11.5 L 16 16" />
    {/snippet}
</Mark>
