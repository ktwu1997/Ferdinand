<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 18 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 18 18">
    {#snippet children()}
        <path d="M9 3 L 9 15 M3 9 L 15 9" />
    {/snippet}
</Mark>
