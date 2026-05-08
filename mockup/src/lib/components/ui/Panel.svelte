<!--
  Index-card panel — README §Card/Note. Paper bg, ink border, stamp
  shadow, plus an optional `<-0.4deg>`-rotated sibling pseudo-element to
  suggest a stack of paper underneath. Set `stack` to render the
  rotated sibling; `offset` controls the stamp shadow distance.
-->
<script lang="ts">
    import type { Snippet } from "svelte";
    interface Props {
        children?: Snippet;
        offset?: number;
        stack?: boolean;
        padding?: string;
    }
    let {
        children,
        offset = 6,
        stack = false,
        padding = "24px",
    }: Props = $props();
</script>

<div class="panel" class:stack style="--offset: {offset}px;">
    {#if stack}<div class="panel-stack" aria-hidden="true"></div>{/if}
    <div class="panel-body" style="padding: {padding};">
        {@render children?.()}
    </div>
</div>

<style>
    .panel {
        position: relative;
        display: block;
    }
    .panel-stack {
        position: absolute;
        inset: 0;
        transform: translate(var(--offset), var(--offset)) rotate(-0.4deg);
        background: var(--bg-soft);
        border: var(--border-w) solid var(--ink);
        border-radius: var(--radius-md);
    }
    .panel-body {
        position: relative;
        background: var(--paper);
        border: var(--border-w) solid var(--ink);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-stamp-md);
    }
    .panel.stack .panel-body {
        box-shadow: none; /* the rotated sibling provides the depth */
    }
</style>
