<!--
  Shared "Ferdinand" wordmark — FerdinandMark + "Ferdinand" (mono), links home.
  Canonical look = the nav rail's `.brand` block (Sidebar.svelte). Used by the
  nav rail, the mobile top bar, and the browse-page sidebar so the wordmark
  can't drift between surfaces. Renders inside a `.sketch-skin` ancestor on
  every consumer, so the token vars (--ink/--accent/--radius) resolve.

  Props:
    • size         — FerdinandMark glyph size (default 28; the mobile bar uses 24)
    • testid       — optional data-testid on the <a>
    • marginBottom — optional bottom margin (px); the nav rail wants 28
-->
<script lang="ts">
    import FerdinandMark from "$lib/components/sketch/FerdinandMark.svelte";

    interface Props {
        size?: number;
        testid?: string;
        marginBottom?: number;
    }

    let { size = 28, testid, marginBottom }: Props = $props();
</script>

<a
    class="brand"
    href="/"
    aria-label="Home — dashboard"
    data-testid={testid}
    style={marginBottom != null ? `margin-bottom: ${marginBottom}px` : undefined}
>
    <FerdinandMark {size} />
    <span class="brand-name mono">Ferdinand</span>
</a>

<style>
    .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        text-decoration: none;
        color: var(--ink);
        border-radius: var(--radius);
    }
    .brand:hover .brand-name {
        color: var(--accent);
    }
    .brand:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    .brand-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--ink);
        letter-spacing: 0.01em;
        transition: color 120ms ease;
    }
</style>
