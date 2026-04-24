<script lang="ts">
    import DOMPurify from "dompurify";

    import { mediaBase } from "$lib/api";
    import { transformAnkiHtml } from "$lib/card/transformAnkiHtml";

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
        const prepared = transformAnkiHtml(html);
        const cleanHtml = DOMPurify.sanitize(prepared, {
            // Strip <script>, inline event handlers, and other live vectors
            // while preserving the rich markup Anki card templates need.
            FORBID_TAGS: ["script", "iframe", "object", "embed"],
            FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
            ADD_TAGS: ["audio", "source"],
            ADD_ATTR: ["controls", "preload", "src"],
        });
        // <base> lets Anki's relative <img src="foo.jpg"> and our rewritten
        // <audio src="bar.mp3"> resolve against the server's /media/ endpoint
        // without the caller knowing the absolute URL at authoring time.
        shadow.innerHTML =
            `<base href="${mediaBase()}">` +
            `<style>${css}</style>` +
            `<div class="card">${cleanHtml}</div>`;
    });
</script>

<div
    class="card-face-host"
    data-testid={testid}
    bind:this={host}
></div>

<style>
    .card-face-host {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 100%;
        color: var(--text);
        font-family: var(--font-serif);
    }
</style>
