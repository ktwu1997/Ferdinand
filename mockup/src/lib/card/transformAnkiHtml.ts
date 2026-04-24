/**
 * Rewrite Anki-specific markup into browser-native HTML before the card
 * content hits DOMPurify and the shadow DOM.
 *
 * Currently handles the `[sound:filename]` token that Anki uses for inline
 * audio clips. Image rendering relies on a `<base href>` injected by the
 * caller, so no `<img src>` rewriting happens here.
 */

const SOUND_TOKEN = /\[sound:([^\]\n]+)\]/g;

/** Replace `[sound:X]` tokens with `<audio controls preload="none" src="X">`. */
export function transformAnkiHtml(html: string): string {
    return html.replace(SOUND_TOKEN, (_, raw: string) => {
        const src = escapeAttr(raw.trim());
        return `<audio controls preload="none" src="${src}"></audio>`;
    });
}

function escapeAttr(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
