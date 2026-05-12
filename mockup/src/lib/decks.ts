import type { ApiDeckSummary } from "$lib/api";

/**
 * `GET /api/decks` returns a *nested* tree: the top-level array holds
 * level-1 decks, with sub-decks under each `.children`. Each node's
 * `.name` is only the **leaf segment** (e.g. `"L600"`), not the full
 * `"TOEIC::Vocabulary::L600"` path.
 *
 * `flattenLeafDecks` walks that tree and returns the **leaf** decks (the
 * ones that actually hold cards — a pure-container parent like `TOEIC`
 * holds none directly, only its children do) as shallow copies whose
 * `.name` has been rewritten to the full `Parent::Child::Leaf` path so
 * callers can render an unambiguous label. Counts are left untouched —
 * leaf counts are the deck's own, never roll-ups.
 *
 * Decks with no children pass through unchanged except for the
 * (no-op, when there's no prefix) name rewrite — so a flat list of
 * top-level decks is returned as-is.
 */
export function flattenLeafDecks(
    decks: ApiDeckSummary[],
    prefix = "",
): ApiDeckSummary[] {
    const out: ApiDeckSummary[] = [];
    for (const d of decks) {
        const fullName = prefix ? `${prefix}::${d.name}` : d.name;
        if (d.children.length === 0) {
            out.push({ ...d, name: fullName });
        } else {
            out.push(...flattenLeafDecks(d.children, fullName));
        }
    }
    return out;
}

/**
 * The last `::`-separated segment of a deck name — `"TOEIC::Vocabulary::L600"`
 * → `"L600"`. Useful for deriving a compact glyph/badge while still
 * showing the full path as the row label.
 */
export function leafSegment(fullName: string): string {
    const parts = fullName.split("::");
    return parts[parts.length - 1] || fullName;
}
