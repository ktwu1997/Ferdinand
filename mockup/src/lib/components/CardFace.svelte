<script lang="ts">
    import DOMPurify from "dompurify";

    interface Props {
        html: string;
        css: string;
        testid?: string;
    }

    let { html, css, testid }: Props = $props();

    let host = $state<HTMLDivElement | null>(null);

    // Render into a shadow root so the notetype CSS is scoped and
    // cannot leak into the app chrome (and vice versa). Re-runs on
    // every card transition since `html` changes.
    $effect(() => {
        if (!host) return;
        if (typeof window === "undefined") return;
        const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
        const cleanHtml = DOMPurify.sanitize(html, {
            // Strip <script>, inline event handlers, and other live vectors
            // while preserving the rich markup Anki card templates need.
            FORBID_TAGS: ["script", "iframe", "object", "embed"],
            FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
        });
        shadow.innerHTML = `<style>${css}</style><div class="card">${cleanHtml}</div>`;
    });
</script>

<div
    class="card-face-host"
    data-testid={testid}
    bind:this={host}
></div>

<style>
    .card-face-host {
        display: block;
        width: 100%;
        max-width: 760px;
        margin: 0 auto;
        color: var(--text);
        font-family: var(--font-serif);
    }
</style>
