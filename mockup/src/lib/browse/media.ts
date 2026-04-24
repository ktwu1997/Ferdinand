export interface ExtractedImage {
    src: string;
    alt: string;
}

const UNSAFE_URI_PREFIXES = ["javascript:"];

function isUnsafeUri(src: string): boolean {
    const normalized = src.trim().toLowerCase();
    return UNSAFE_URI_PREFIXES.some((p) => normalized.startsWith(p));
}

export function extractFirstImage(html: string): ExtractedImage | null {
    if (!html) return null;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const img = doc.querySelector("img");
    if (!img) return null;
    const src = img.getAttribute("src");
    if (!src || isUnsafeUri(src)) return null;
    return { src, alt: img.getAttribute("alt") ?? "" };
}

const AUDIO_TAG_RE = /\[sound:[^\]\n]+\]/;

export function hasAudio(html: string): boolean {
    if (!html) return false;
    return AUDIO_TAG_RE.test(html);
}

export function stripHtmlToSnippet(html: string, maxChars = 140): string {
    const text = html
        .replace(/<hr[^>]*>/gi, "  ·  ")
        .replace(/<br\s*\/?>(\r?\n)?/gi, " ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + "…";
}
