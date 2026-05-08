<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; color?: string; }
    let { size = 24, color = "var(--accent)" }: Props = $props();
</script>

<span style="color: {color}; display: inline-flex">
    <Mark w={size} h={size} vb="0 0 24 24">
        {#snippet children()}
            <path d="M12 2 L 12 22 M2 12 L 22 12" />
            <path d="M5 5 L 19 19 M19 5 L 5 19" class="thin" />
        {/snippet}
    </Mark>
</span>
