<!--
  Mono uppercase caption. Design rev 2 = ZERO slashes: section labels render
  as plain uppercase mono text (see authoritative screenshots
  02-dashboard.png / 04-browse.png / 06-stats.png / 07-settings.png — "NAV",
  "TODAY", "PINNED", "THE.DECK.LEDGER", etc., no "// " anywhere). Earlier revs
  carried a "// " prefix; it has been removed entirely per the owner's
  "斜線還是很多" complaint. Call sites pass the bare label as slot text.
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
