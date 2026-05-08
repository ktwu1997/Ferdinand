<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 22 }: Props = $props();
</script>

<Mark w={size} h={Math.round((size * 14) / 22)} vb="0 0 22 14">
    {#snippet children()}
        <path d="M2 7 L 19 7 M14 2 L 19 7 L 14 12" />
    {/snippet}
</Mark>
