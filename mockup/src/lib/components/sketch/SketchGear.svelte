<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 18 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 18 18">
    {#snippet children()}
        <circle cx="9" cy="9" r="3" />
        <path d="M9 1.5 L 9 4 M9 14 L 9 16.5 M1.5 9 L 4 9 M14 9 L 16.5 9 M3.5 3.5 L 5 5 M13 13 L 14.5 14.5 M3.5 14.5 L 5 13 M13 5 L 14.5 3.5" class="thin" />
    {/snippet}
</Mark>
