<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 100 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 100 100">
    {#snippet children()}
        <path d="M10 22 C 10 19, 12 17, 15 17 L 85 17 C 88 17, 90 19, 90 22 L 90 86 C 90 89, 88 91, 85 91 L 15 91 C 12 91, 10 89, 10 86 Z" class="fill-paper" />
        <path d="M10 32 L 90 32" />
        <path d="M22 12 L 22 22 M40 12 L 40 22 M58 12 L 58 22 M76 12 L 76 22" />
        <circle cx="22" cy="44" r="2.4" fill="currentColor" style="fill: currentColor; stroke: none" />
        <circle cx="34" cy="44" r="2.4" fill="currentColor" style="fill: currentColor; stroke: none" />
        <circle cx="46" cy="44" r="2.4" fill="currentColor" style="fill: currentColor; stroke: none" />
        <circle cx="58" cy="44" r="2.4" fill="currentColor" style="fill: currentColor; stroke: none" />
        <circle cx="22" cy="56" r="2.4" fill="currentColor" style="fill: currentColor; stroke: none" />
        <circle cx="34" cy="56" r="2.4" fill="currentColor" style="fill: currentColor; stroke: none" />
        <circle cx="46" cy="56" r="2.4" fill="currentColor" style="fill: currentColor; stroke: none" />
        <path d="M58 53 L 58 59 M55 56 L 61 56" class="thin" style="stroke: var(--ink-mute)" />
        <circle cx="22" cy="68" r="2.4" style="fill: var(--accent); stroke: none" />
        <circle cx="34" cy="68" r="2.4" style="fill: var(--accent); stroke: none" />
    {/snippet}
</Mark>
