<!--
  Mono uppercase caption. Design rev 2 keeps a single leading "// " on
  section labels (see screenshots: "// SECTIONS", "// NAV", "// THE.LEDGER").
  The "// " is NOT auto-prepended here — call sites pass it as part of the
  slot text, matching the design source (primitives.jsx Caption renders the
  children verbatim). That keeps the prefix opt-out-able and avoids the old
  "//// " doubling bug from when this component auto-prefixed AND callers
  also wrote "// ".
-->
<script lang="ts">
    import type { Snippet } from "svelte";
    interface Props {
        children?: Snippet;
        color?: string;
    }
    let { children, color }: Props = $props();
</script>

<div
    class="caption mono"
    style={color ? `color: ${color}` : ""}
>
    {@render children?.()}
</div>

<style>
    .caption {
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-soft);
    }
</style>
