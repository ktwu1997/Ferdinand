<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        variant?: "default" | "primary" | "flat";
        padding?: "sm" | "md" | "lg";
        as?: "div" | "a" | "button";
        href?: string;
        onclick?: (e: MouseEvent) => void;
        interactive?: boolean;
        children?: Snippet;
    }

    let {
        variant = "default",
        padding = "md",
        as = "div",
        href,
        onclick,
        interactive = false,
        children,
    }: Props = $props();
</script>

{#if as === "a" || href}
    <a class="card {variant} pad-{padding}" class:interactive {href} {onclick}>
        {@render children?.()}
    </a>
{:else if as === "button"}
    <button class="card {variant} pad-{padding}" class:interactive {onclick}>
        {@render children?.()}
    </button>
{:else}
    <div class="card {variant} pad-{padding}" class:interactive>
        {@render children?.()}
    </div>
{/if}

<style>
    .card {
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        color: inherit;
        display: block;
        text-align: left;
        transition: border-color var(--duration-fast) var(--ease),
            background-color var(--duration-fast) var(--ease),
            transform var(--duration-fast) var(--ease);
        width: 100%;
    }

    .pad-sm {
        padding: var(--space-4);
    }
    .pad-md {
        padding: var(--space-6);
    }
    .pad-lg {
        padding: var(--space-8);
    }

    .primary {
        border-color: var(--accent-border);
        background: var(--accent-bg);
    }

    .flat {
        background: transparent;
        border-color: transparent;
    }

    .interactive {
        cursor: pointer;
    }
    .interactive:hover {
        border-color: var(--border-strong);
        background: var(--bg-hover);
    }
    .primary.interactive:hover {
        border-color: var(--accent);
    }
</style>
