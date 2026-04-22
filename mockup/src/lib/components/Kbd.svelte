<script lang="ts">
    interface Props {
        children?: any;
    }

    let { children }: Props = $props();
</script>

<kbd>{@render children?.()}</kbd>

<style>
    kbd {
        font-family: var(--font-mono);
        font-size: 0.75rem;
        padding: 0.1em 0.45em;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--bg-subtle);
        color: var(--text-muted);
        line-height: 1;
        box-shadow: inset 0 -1px 0 var(--border);
        vertical-align: baseline;
    }
</style>
