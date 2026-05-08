<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props {
        size?: number;
        gazeX?: number;
        gazeY?: number;
        closed?: boolean;
    }
    let { size = 160, gazeX = 0, gazeY = 0, closed = false }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 160 160">
    {#snippet children()}
        <!-- body -->
        <path d="M48 60 C 44 86, 52 124, 80 130 C 108 124, 116 86, 112 60 C 110 38, 96 24, 80 24 C 64 24, 50 38, 48 60 Z" class="fill-paper" />
        {#if closed}
            <g style="transition: opacity 200ms ease">
                <path d="M65 58 C 69 64, 75 64, 79 58" class="thick" />
                <path d="M87 58 C 91 64, 97 64, 101 58" class="thick" />
                <path d="M67 62 L 66 65 M72 64 L 72 67 M93 64 L 93 67 M99 62 L 100 65" class="thin" />
            </g>
        {:else}
            <g>
                <path d="M62 60 C 62 50, 70 46, 76 50 C 80 54, 80 64, 74 68 C 66 70, 60 66, 62 60 Z" />
                <path d="M84 60 C 84 50, 92 46, 98 50 C 102 54, 102 64, 96 68 C 88 70, 82 66, 84 60 Z" />
                <g style="transition: transform 220ms cubic-bezier(0.16,1,0.3,1); transform: translate({gazeX}px, {gazeY}px)">
                    <circle cx="72" cy="58" r="2.5" fill="currentColor" style="fill: currentColor" />
                    <circle cx="94" cy="58" r="2.5" fill="currentColor" style="fill: currentColor" />
                </g>
            </g>
        {/if}
        <!-- beak -->
        <path d="M78 68 L 80 76 L 82 68" />
        <!-- belly tufts -->
        <path d="M64 88 C 70 92, 76 92, 80 88" class="thin" />
        <path d="M80 88 C 84 92, 90 92, 96 88" class="thin" />
        <path d="M60 102 C 68 106, 74 106, 80 102" class="thin" />
        <path d="M80 102 C 86 106, 92 106, 100 102" class="thin" />
        <!-- feet -->
        <path d="M68 130 L 68 138 M64 138 L 72 138" class="thin" />
        <path d="M92 130 L 92 138 M88 138 L 96 138" class="thin" />
        <!-- floating leaf -->
        <path d="M126 36 C 130 30, 138 30, 140 38 C 134 42, 128 40, 126 36 Z" class="fill-accent-soft" style="stroke: var(--accent)" />
    {/snippet}
</Mark>
