<script lang="ts">
    import { onMount } from "svelte";
    import { fetchHealth, apiBase } from "$lib/api";

    type Status = "checking" | "live" | "offline";
    let status: Status = $state("checking");
    let version = $state<string | null>(null);

    onMount(async () => {
        try {
            const h = await fetchHealth();
            status = h.ok ? "live" : "offline";
            version = h.version;
        } catch (_) {
            status = "offline";
        }
    });
</script>

<span class="tag {status}" title={status === "live" ? `anki_server ${version} @ ${apiBase()}` : `fake data · ${apiBase()} unreachable`}>
    <span class="dot"></span>
    {#if status === "checking"}Connecting…
    {:else if status === "live"}Live · {version}
    {:else}Demo data{/if}
</span>

<style>
    .tag {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 8px;
        font-size: 0.7rem;
        font-family: var(--font-mono);
        color: var(--text-subtle);
        background: var(--bg-subtle);
        border: 1px solid var(--border);
        border-radius: var(--radius-full);
    }
    .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--text-subtle);
    }
    .live .dot {
        background: var(--success);
        box-shadow: 0 0 0 3px color-mix(in oklch, var(--success) 22%, transparent);
    }
    .live {
        color: var(--success);
    }
    .offline .dot {
        background: var(--warning);
    }
</style>
