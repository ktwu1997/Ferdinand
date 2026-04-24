<script lang="ts">
    // Loading skeleton matching BrowseRow geometry. Pure CSS shimmer; reduced-motion aware.
</script>

<div class="row" aria-hidden="true">
    <div class="thumb shimmer"></div>
    <div class="body">
        <div class="bar primary shimmer"></div>
        <div class="bar secondary shimmer"></div>
    </div>
</div>

<style>
    .row {
        display: grid;
        grid-template-columns: 64px minmax(0, 1fr);
        align-items: center;
        gap: var(--space-4);
        padding: var(--space-3) var(--space-4);
        background: #ffffff;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
    }
    :global([data-theme="dark"]) .row {
        background: var(--bg-elevated);
    }

    .thumb {
        width: 64px;
        height: 64px;
        border-radius: var(--radius-sm);
    }

    .body {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }
    .bar {
        height: 12px;
        border-radius: var(--radius-sm);
    }
    .bar.primary {
        width: 60%;
    }
    .bar.secondary {
        width: 35%;
        height: 10px;
    }

    .shimmer {
        background:
            linear-gradient(
                90deg,
                var(--bg-subtle) 0%,
                var(--bg-hover) 50%,
                var(--bg-subtle) 100%
            );
        background-size: 200% 100%;
        animation: shimmer 1.6s ease-in-out infinite;
    }
    @keyframes shimmer {
        0% {
            background-position: 200% 0;
        }
        100% {
            background-position: -200% 0;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .shimmer {
            animation: none;
        }
    }
</style>
