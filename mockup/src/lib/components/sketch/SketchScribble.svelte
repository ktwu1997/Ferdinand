<script lang="ts">
    interface Props { width?: number; color?: string; }
    let { width = 60, color = "currentColor" }: Props = $props();
    let d = $derived(
        `M2 6 C 8 1, 14 11, 20 6 S 32 1, 38 6 S 50 11, ${width - 2} 6`
    );
</script>

<svg
    viewBox="0 0 {width} 12"
    {width}
    height="12"
    class="sketch"
    style="color: {color}; display: block"
    aria-hidden="true"
>
    <path d={d} class="thin" />
</svg>
