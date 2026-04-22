<script lang="ts">
    interface Props {
        values: number[];
        height?: number;
        color?: string;
        fill?: boolean;
    }

    let { values, height = 32, color = "var(--accent)", fill = true }: Props = $props();

    let path = $derived.by(() => {
        if (values.length === 0) return { line: "", area: "" };
        const max = Math.max(...values, 1);
        const step = 100 / Math.max(values.length - 1, 1);
        const pts = values.map((v, i) => [i * step, 100 - (v / max) * 100] as const);
        const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
        const area = `${line} L100,100 L0,100 Z`;
        return { line, area };
    });
</script>

<svg viewBox="0 0 100 100" preserveAspectRatio="none" style:height="{height}px" aria-hidden="true">
    {#if fill}
        <path d={path.area} fill={color} fill-opacity="0.12" />
    {/if}
    <path
        d={path.line}
        fill="none"
        stroke={color}
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
    />
</svg>

<style>
    svg {
        width: 100%;
        display: block;
    }
</style>
