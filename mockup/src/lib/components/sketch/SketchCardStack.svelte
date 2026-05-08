<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 160 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 160 160">
    {#snippet children()}
        <path d="M28 38 C 27.6 36, 28.8 34.4, 30.6 34.2 L 116 30.4 C 118 30.2, 119.4 31.6, 119.6 33.4 L 124.4 100 C 124.6 101.8, 123.2 103.2, 121.4 103.4 L 36 107.2 C 34.2 107.4, 32.6 106, 32.4 104 Z" class="fill-paper" />
        <path d="M22 56 C 21.6 54, 22.8 52.4, 24.6 52.2 L 110 48.4 C 112 48.2, 113.4 49.6, 113.6 51.4 L 118.4 118 C 118.6 119.8, 117.2 121.2, 115.4 121.4 L 30 125.2 C 28.2 125.4, 26.6 124, 26.4 122 Z" class="fill-paper" />
        <path d="M16 76 C 15.6 74, 16.8 72.4, 18.6 72.2 L 104 68.4 C 106 68.2, 107.4 69.6, 107.6 71.4 L 112.4 138 C 112.6 139.8, 111.2 141.2, 109.4 141.4 L 24 145.2 C 22.2 145.4, 20.6 144, 20.4 142 Z" class="fill-paper" />
        <path d="M30 92 L 92 89.5" class="thin" />
        <path d="M30 102 L 80 100" class="thin" />
        <path d="M30 112 L 86 110" class="thin" />
        <path d="M30 122 L 70 120.5" class="thin" />
        <path d="M132 28 L 132 38 M127 33 L 137 33" style="stroke: var(--accent)" />
    {/snippet}
</Mark>
