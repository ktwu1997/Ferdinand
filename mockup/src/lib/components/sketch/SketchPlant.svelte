<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 140 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 140 140">
    {#snippet children()}
        <path d="M44 96 L 52 130 C 52.4 132, 54 133.2, 56 133.2 L 84 133 C 86 133, 87.6 131.8, 88 130 L 96 96 Z" class="fill-paper" />
        <path d="M40 96 L 100 96" class="thick" />
        <path d="M70 96 C 70 80, 70 60, 70 38" />
        <path d="M70 80 C 60 76, 48 70, 40 60 C 50 56, 64 64, 70 76" class="fill-accent-soft" style="stroke: var(--accent)" />
        <path d="M70 64 C 80 60, 92 54, 100 44 C 96 56, 84 66, 72 70" class="fill-accent-soft" style="stroke: var(--accent)" />
        <path d="M70 50 C 64 42, 60 32, 62 22 C 70 26, 74 38, 72 48" class="fill-accent-soft" style="stroke: var(--accent)" />
        <path d="M48 110 L 50 113 M60 110 L 60 114 M80 110 L 80 113 M92 110 L 90 113" class="thin" />
    {/snippet}
</Mark>
