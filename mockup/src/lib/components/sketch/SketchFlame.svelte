<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 18 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 18 18">
    {#snippet children()}
        <path d="M9 1.5 C 7 5, 4 6.5, 4 10.5 C 4 13.8, 6 16, 9 16 C 12 16, 14 13.8, 14 10.5 C 14 8, 12.5 7, 11 5 C 11 7, 10 8, 9 7.5 C 9 5, 9 3, 9 1.5 Z" />
    {/snippet}
</Mark>
