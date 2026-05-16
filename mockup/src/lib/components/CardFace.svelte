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
        // Strip data: URIs from src attributes — an attacker-controlled
        // notetype could otherwise exfiltrate data via <audio src="data:...">.
        // The hook runs per sanitize call and is removed immediately after.
        DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
            if (
                data.attrName === "src" &&
                data.attrValue.toLowerCase().startsWith("data:")
            ) {
                data.keepAttr = false;
            }
        });
        const cleanHtml = DOMPurify.sanitize(prepared, {
            // Strip <script>, inline event handlers, and other live vectors
            // while preserving the rich markup Anki card templates need.
            FORBID_TAGS: ["script", "iframe", "object", "embed"],
            FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
            ADD_TAGS: ["audio", "source"],
            ADD_ATTR: ["controls", "preload", "src"],
            // Prevent data-* attribute exfiltration channels.
            ALLOW_DATA_ATTR: false,
        });
        DOMPurify.removeHook("uponSanitizeAttribute");
        // Per HTML spec, <base> only affects the host Document's URL — it has
        // no effect inside a shadow root, so relative <img src="foo.jpg"> would
        // resolve against the page's URL (e.g. /study/123/foo.jpg) and 404.
        // Resolve media-relative src/href on each affected element instead.
        shadow.innerHTML =
            `<style>${css}</style>` +
            `<div class="card">${cleanHtml}</div>`;
        const base = mediaBase();
        for (const el of shadow.querySelectorAll<HTMLElement>(
            "img[src], audio[src], video[src], source[src], a[href]"
        )) {
            const attr = el.tagName === "A" ? "href" : "src";
            const raw = el.getAttribute(attr);
            if (!raw) continue;
            // Skip already-absolute URLs and data/blob refs.
            if (/^(https?:|data:|blob:|\/\/|\/)/i.test(raw)) continue;
            el.setAttribute(attr, base + raw);
        }

        // Concept-Deep template omits the `.card-image` block entirely when
        // the Image field is empty (Mustache `{{#Image}}…{{/Image}}` truthy
        // section). For words gemini classified as too abstract to illustrate
        // (added to image_skip.txt — adverbs, function words), this leaves an
        // unexplained gap above the Why/Example/Contrast sections. Inject a
        // sketch-style "no illustration" placeholder so the user sees an
        // intentional absence instead of wondering if the image failed to load.
        // Guarded so it only fires on the Concept-Deep answer side (hr#answer
        // present + at least one .section.{why,example,contrast,mnemonic,source}
        // — Cloze-Deep cards don't carry those sections and never had an
        // Image field, so they never get a placeholder).
        const isAnswerSide = shadow.querySelector("hr#answer");
        const hasConceptSection = shadow.querySelector(
            ".section.why, .section.example, .section.contrast, .section.mnemonic, .section.source",
        );
        const hasImage = shadow.querySelector(".card-image");
        if (isAnswerSide && hasConceptSection && !hasImage) {
            const placeholder = document.createElement("div");
            placeholder.className = "card-image card-image-empty";
            placeholder.setAttribute("data-testid", "card-image-empty");
            placeholder.innerHTML =
                '<svg class="empty-frame" viewBox="0 0 80 60" width="80" height="60" aria-hidden="true">' +
                '<path d="M5 5 H20 M5 5 V15 M75 5 H60 M75 5 V15 M5 55 H20 M5 55 V45 M75 55 H60 M75 55 V45" ' +
                'stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" />' +
                '<path d="M12 14 L68 46" stroke="currentColor" stroke-width="1.2" fill="none" ' +
                'stroke-linecap="round" opacity="0.4" />' +
                "</svg>" +
                '<div class="empty-caption">no illustration · abstract concept</div>';
            // Insert directly after the .back block (matches the position
            // .card-image would have occupied in the template), falling back
            // to appending to .card if the back div is somehow absent.
            const back = shadow.querySelector(".back");
            if (back?.parentNode) {
                back.parentNode.insertBefore(placeholder, back.nextSibling);
            } else {
                shadow.querySelector(".card")?.appendChild(placeholder);
            }
        }

        // Append a safety stylesheet AFTER the user CSS so viewport defaults
        // override author rules that would otherwise overflow on phones.
        // Tests assert a single user-authored style block via
        // querySelector("style"), so this is added via DOM API, not innerHTML.
        const safety = document.createElement("style");
        safety.dataset.role = "card-face-safety";
        safety.textContent =
            ":host{display:block;}" +
            "img,video,audio,table{max-width:100%;height:auto;}" +
            "pre{white-space:pre-wrap;word-break:break-word;}" +
            ".card{box-sizing:border-box;max-width:100%;}" +
            ".card-image-empty{" +
                "flex-direction:column;align-items:center;gap:8px;" +
                "opacity:0.55;color:var(--text-subtle,oklch(65% 0.006 60));" +
                "font-family:var(--font-mono,ui-monospace,\"JetBrains Mono\",Menlo,monospace);" +
            "}" +
            ".card-image-empty .empty-frame{color:inherit;}" +
            ".card-image-empty .empty-caption{" +
                "font-size:11px;letter-spacing:0.04em;text-transform:lowercase;" +
            "}";
        shadow.appendChild(safety);
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
