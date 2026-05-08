<!--
  Mono uppercase caption. README §Captions: text is prefixed with "// "
  in source code (intentional aesthetic choice). We auto-prefix here so
  callers write `<Caption>session 01</Caption>` without baking the slashes
  into every label string — but if a caller already includes "// " we
  don't double up.
-->
<script lang="ts">
    import type { Snippet } from "svelte";
    interface Props {
        children?: Snippet;
        color?: string;
        /** Skip the leading `// ` when the caller wants raw mono text. */
        bare?: boolean;
    }
    let { children, color, bare = false }: Props = $props();
</script>

<div
    class="caption mono"
    style={color ? `color: ${color}` : ""}
>
    {#if !bare}<span aria-hidden="true">// </span>{/if}{@render children?.()}
</div>

<style>
    .caption {
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-soft);
    }
</style>
