<!--
  Pill-shaped accent label. README §Chips/tags: accent border + accent-soft
  bg + accent text + 999px radius.
-->
<script lang="ts">
    import type { Snippet } from "svelte";
    interface Props {
        children?: Snippet;
        color?: string;
        bg?: string;
    }
    let { children, color, bg }: Props = $props();
</script>

<span
    class="chip mono"
    style="
        --chip-color: {color ?? 'var(--accent)'};
        --chip-bg: {bg ?? 'var(--accent-soft)'};
    "
>
    {@render children?.()}
</span>

<style>
    .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        letter-spacing: 0.06em;
        padding: 3px 10px;
        border: 1.2px solid var(--chip-color);
        border-radius: var(--radius-pill);
        color: var(--chip-color);
        background: var(--chip-bg);
        text-transform: uppercase;
    }
</style>
