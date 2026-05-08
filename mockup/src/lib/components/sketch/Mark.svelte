<!--
  Sketch SVG wrapper. Children are inline path/circle/rect elements that
  inherit stroke/fill rules from `.sketch` styles defined in styles/tokens.css.
  Set `class="thick"` / `"thin"` / `"fill-paper"` / `"fill-accent-soft"` on
  individual children when the path needs the specific decoration.
-->
<script lang="ts">
    interface Props {
        w?: number;
        h?: number;
        vb?: string;
        class?: string;
        children?: import("svelte").Snippet;
    }
    let { w = 24, h = 24, vb = "0 0 24 24", class: klass = "", children }: Props = $props();
</script>

<svg
    viewBox={vb}
    width={w}
    height={h}
    class="sketch {klass}"
    aria-hidden="true"
>
    {@render children?.()}
</svg>
