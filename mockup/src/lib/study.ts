/**
 * Shared constants + helpers for the /study/[deckId] review screen.
 *
 * Mirrors `design_handoff_ferdinand/source/study.jsx` (`STUDY_INTERVALS`).
 * Kept in $lib so the pure bits are unit-testable without mounting the
 * route component.
 */

/**
 * Placeholder next-interval labels per FSRS rating, mirroring the design
 * source. These are *not* real scheduling output — the backend's
 * `post_answer` already calls `col.get_scheduling_states(cid)` but does
 * not surface the per-button interval strings, so a future
 * `GET /api/study/next_intervals` endpoint (backed by rslib's
 * `describe_next_states`) is needed to show live values. Until then the
 * answer buttons display these design placeholders.
 */
export const STUDY_INTERVALS = {
    again: "<10m",
    hard: "1d",
    good: "5d",
    easy: "12d",
} as const;

/** Format a millisecond duration as `mm:ss` (minutes are not capped). */
export function formatMMSS(ms: number): string {
    const totalSeconds = Math.floor(Math.max(ms, 0) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export interface ReviewDay {
    /** ISO YYYY-MM-DD in user local timezone. */
    date: string;
    reviews: number;
}

/**
 * Counts consecutive days with reviews > 0, sorted newest-first,
 * stopping at the first day with 0 reviews.
 *
 * Callers are responsible for ensuring `date` strings are in the
 * user's local timezone so midnight boundaries are consistent.
 */
export function computeStreak(history: ReadonlyArray<ReviewDay>): number {
    if (history.length === 0) return 0;
    const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
    let streak = 0;
    for (const day of sorted) {
        if (day.reviews > 0) streak++;
        else break;
    }
    return streak;
}
