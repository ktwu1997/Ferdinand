<script lang="ts">
    import Mark from "./Mark.svelte";
    interface Props { size?: number; }
    let { size = 140 }: Props = $props();
</script>

<Mark w={size} h={size} vb="0 0 140 140">
    {#snippet children()}
        <path d="M14 40 C 30 36, 50 36, 70 44 C 90 36, 110 36, 126 40 L 126 110 C 110 106, 90 106, 70 114 C 50 106, 30 106, 14 110 Z" class="fill-paper" />
        <path d="M70 44 L 70 114" />
        <path d="M22 50 C 36 48, 50 48, 64 54" class="thin" />
        <path d="M22 60 C 36 58, 50 58, 64 64" class="thin" />
        <path d="M22 70 C 36 68, 50 68, 64 74" class="thin" />
        <path d="M76 54 C 90 48, 104 48, 118 50" class="thin" />
        <path d="M76 64 C 90 58, 104 58, 118 60" class="thin" />
        <path d="M76 74 C 90 68, 104 68, 118 70" class="thin" />
        <path d="M76 84 C 90 78, 104 78, 118 80" class="thin" />
    {/snippet}
</Mark>
