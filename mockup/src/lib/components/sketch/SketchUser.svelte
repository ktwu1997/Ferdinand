<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 18 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 18 18">
    {#snippet children()}
        <circle cx="9" cy="6.5" r="3" />
        <path d="M2.5 16 C 3 12, 5.5 10, 9 10 C 12.5 10, 15 12, 15.5 16" />
    {/snippet}
</Mark>
