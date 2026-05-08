<!--
  Sketch-aesthetic button. Mirrors design_handoff_ferdinand/source/primitives.jsx
  <Btn>. Five kinds × three sizes; lowercase JetBrains Mono with uppercase
  tracking; solid offset stamp shadow (no blur). When `kind="ghost"` the
  border + shadow drop so it reads like a text link with breathing room.
-->
<script lang="ts">
    import type { Snippet } from "svelte";
    import type {
        HTMLButtonAttributes,
        HTMLAnchorAttributes,
    } from "svelte/elements";

    type Kind = "primary" | "paper" | "outline" | "ghost" | "accent";
    type Size = "sm" | "md" | "lg";

    interface Props extends Omit<HTMLButtonAttributes, "size" | "children"> {
        kind?: Kind;
        size?: Size;
        leading?: Snippet;
        trailing?: Snippet;
        children?: Snippet;
        /** Render as `<a>` instead of `<button>` when present. */
        href?: string;
        /** Match width of the parent (used for stacked CTAs in mobile login). */
        block?: boolean;
    }

    let {
        kind = "primary",
        size = "md",
        leading,
        trailing,
        children,
        href,
        block = false,
        class: klass = "",
        style: styleProp = "",
        ...rest
    }: Props & { class?: string; style?: string } = $props();
</script>

<svelte:element
    this={href ? "a" : "button"}
    {href}
    class="btn btn-{kind} btn-{size}"
    class:block
    class:has-trailing={!!trailing}
    class:has-leading={!!leading}
    style={styleProp}
    {...rest}
>
    {#if leading}<span class="btn-leading">{@render leading()}</span>{/if}
    <span class="btn-label">{@render children?.()}</span>
    {#if trailing}<span class="btn-trailing">{@render trailing()}</span>{/if}
</svelte:element>

<style>
    .btn {
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
        font-family: var(--font-mono);
        font-weight: 500;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        border: var(--border-w) solid var(--ink);
        border-radius: var(--radius);
        background: var(--paper);
        color: var(--ink);
        cursor: pointer;
        text-decoration: none;
        transition:
            transform 100ms ease,
            box-shadow 100ms ease,
            background-color 120ms ease;
        box-shadow: var(--shadow-stamp-sm);
    }
    .btn.block {
        width: 100%;
        justify-content: center;
    }

    /* Sizes — heights/paddings/font-sizes per primitives.jsx Btn. */
    .btn-sm {
        font-size: 12px;
        padding: 6px 12px;
    }
    .btn-md {
        font-size: 13px;
        padding: 9px 16px;
    }
    .btn-lg {
        font-size: 14px;
        padding: 12px 22px;
    }

    /* Kinds — primary uses Pine accent ground per primitives.jsx
       (NOT solid ink; matches the design canvas). */
    .btn-primary {
        background: var(--accent);
        color: var(--bg);
        border-color: var(--ink);
    }
    .btn-paper {
        background: var(--paper);
        color: var(--ink);
    }
    .btn-outline {
        background: transparent;
        color: var(--ink);
    }
    .btn-accent {
        background: var(--accent);
        color: var(--bg);
        border-color: var(--ink);
    }
    .btn-ghost {
        background: transparent;
        color: var(--ink-soft);
        border-color: transparent;
        box-shadow: none;
        padding: 6px 10px;
    }
    .btn-ghost.btn-sm {
        padding: 4px 8px;
    }

    /* Pressed feel — slide into the stamp shadow. */
    .btn:hover {
        transform: translate(-0.5px, -0.5px);
        box-shadow: 3px 3px 0 var(--ink);
    }
    .btn-ghost:hover {
        background: var(--bg-soft);
        transform: none;
        box-shadow: none;
    }
    .btn:active {
        transform: translate(2px, 2px);
        box-shadow: none;
    }
    .btn:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 3px;
    }
    .btn[disabled],
    .btn[aria-disabled="true"] {
        cursor: not-allowed;
        opacity: 0.55;
        transform: none;
    }

    .btn-leading,
    .btn-trailing {
        display: inline-flex;
        align-items: center;
    }
</style>
