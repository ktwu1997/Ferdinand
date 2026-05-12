import type { ApiAnswerButtons, ApiDeckSummary } from "$lib/api";
import { flattenLeafDecks, leafSegment } from "$lib/decks";

/**
 * One row of the stats "deck breakdown" table. Mirrors the design's deck
 * table (design_handoff_ferdinand/source/stats.jsx l. 241-288) — deck /
 * cards / mature / retention / activity / last.
 *
 * Only `glyph`, `fullName` and `cards` are populated: the `GET /api/decks`
 * tree doesn't expose mature counts, per-deck retention, per-deck activity
 * or a last-review timestamp. The view renders the rest as "—".
 *
 * TODO(backend): a `GET /api/stats/decks` route (rslib's deck/card stats
 * already compute mature counts + true-retention) would let us fill the
 * `mature` and `retention` columns for real — and a per-deck day-count
 * series would feed the `activity` mini-bar + `last`.
 */
export interface DeckBreakdownRow {
    /** 2-char uppercase badge derived from the leaf segment, e.g. "L6". */
    glyph: string;
    /** Full `Parent::Child::Leaf` path — the row label + the testid hook. */
    fullName: string;
    /** Total cards in the deck (the leaf's own count, never a roll-up). */
    cards: number;
}

/**
 * Walks the nested deck tree, keeps the leaf decks (the ones that actually
 * hold cards), and projects each onto a {@link DeckBreakdownRow}. `cards`
 * prefers the server's `total_in_deck`; when that's 0 (some queue states
 * report it lazily) it falls back to the visible new+learn+review sum so a
 * freshly-seeded deck still shows a number rather than a flat 0.
 */
export function deckBreakdownRows(
    decks: ApiDeckSummary[],
): DeckBreakdownRow[] {
    return flattenLeafDecks(decks).map((d) => ({
        glyph: leafSegment(d.name).slice(0, 2).toUpperCase() || "··",
        fullName: d.name,
        cards:
            d.total_in_deck > 0
                ? d.total_in_deck
                : d.new_count + d.learn_count + d.review_count,
    }));
}

/**
 * Aggregate review retention over the answer-button window, as a whole
 * percent. Anki counts a review as "retained" when the answer was anything
 * other than `again` (i.e. you recalled it, even if with difficulty), so
 * this is `(hard + good + easy) / total`.
 *
 * Returns `null` when there were no answers in the window (so the caller
 * can render "—" instead of a misleading "0%"). This is the aggregate
 * stand-in for the design's per-day retention curve — the backend has no
 * per-day pass-rate series yet.
 *
 * TODO(backend): a `GET /api/stats/retention?days=N` route (rslib has the
 * true-retention graph data) would let us draw the real curve.
 */
export function aggregateRetentionPct(
    ab: Pick<ApiAnswerButtons, "again" | "hard" | "good" | "easy"> | null,
): number | null {
    if (!ab) return null;
    const total = ab.again + ab.hard + ab.good + ab.easy;
    if (total <= 0) return null;
    return Math.round(((ab.hard + ab.good + ab.easy) / total) * 100);
}
