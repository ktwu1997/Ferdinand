<script lang="ts">
    interface Props {
        variant?: "primary" | "secondary" | "ghost" | "danger";
        size?: "sm" | "md" | "lg";
        href?: string;
        onclick?: (e: MouseEvent) => void;
        disabled?: boolean;
        type?: "button" | "submit";
        children?: any;
    }

    let {
        variant = "secondary",
        size = "md",
        href,
        onclick,
        disabled = false,
        type = "button",
        children,
    }: Props = $props();
</script>

{#if href}
    <a class="btn {variant} {size}" {href} class:disabled>
        {@render children?.()}
    </a>
{:else}
    <button class="btn {variant} {size}" {type} {onclick} {disabled}>
        {@render children?.()}
    </button>
{/if}

<style>
    .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        font-family: var(--font-sans);
        font-weight: 500;
        border-radius: var(--radius-md);
        border: 1px solid transparent;
        transition: background-color var(--duration-fast) var(--ease),
            border-color var(--duration-fast) var(--ease),
            color var(--duration-fast) var(--ease),
            transform var(--duration-fast) var(--ease);
        user-select: none;
        white-space: nowrap;
    }

    .btn:active:not(.disabled) {
        transform: translateY(1px);
    }

    .sm {
        padding: 0.35rem 0.75rem;
        font-size: var(--text-sm);
        border-radius: var(--radius-sm);
    }
    .md {
        padding: 0.55rem 1rem;
        font-size: var(--text-sm);
    }
    .lg {
        padding: 0.85rem 1.5rem;
        font-size: var(--text-base);
    }

    .primary {
        background: var(--accent);
        color: var(--text-on-accent);
        border-color: var(--accent);
    }
    .primary:hover {
        background: var(--accent-hover);
        border-color: var(--accent-hover);
    }

    .secondary {
        background: var(--bg-elevated);
        color: var(--text);
        border-color: var(--border);
    }
    .secondary:hover {
        background: var(--bg-hover);
        border-color: var(--border-strong);
    }

    .ghost {
        background: transparent;
        color: var(--text-muted);
    }
    .ghost:hover {
        background: var(--bg-hover);
        color: var(--text);
    }

    .danger {
        background: transparent;
        color: var(--danger);
        border-color: var(--border);
    }
    .danger:hover {
        background: var(--bg-hover);
    }

    .disabled {
        opacity: 0.5;
        pointer-events: none;
    }
</style>
