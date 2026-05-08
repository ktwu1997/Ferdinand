<script lang="ts">
    interface Props { width?: number; color?: string; }
    let { width = 120, color = "var(--accent)" }: Props = $props();
    let d = $derived(
        `M2 6 C ${width * 0.2} 1, ${width * 0.4} 9, ${width * 0.5} 5 ` +
            `S ${width * 0.8} 1, ${width - 2} 6`
    );
</script>

<svg
    viewBox="0 0 {width} 10"
    {width}
    height="10"
    class="sketch"
    style="color: {color}; display: block"
    aria-hidden="true"
>
    <path d={d} />
</svg>
