/**
 * Thin typed client for anki_server. Mirrors the server's response shapes.
 * Will later be generated from OpenAPI — today hand-rolled to keep Phase 1 moving.
 */

import { browser } from "$app/environment";

export interface ApiDeckSummary {
    id: number;
    name: string;
    level: number;
    new_count: number;
    learn_count: number;
    review_count: number;
    total_in_deck: number;
    filtered: boolean;
    collapsed: boolean;
    /**
     * Phase 11-A: assigned preset (deck config) id. `null` for filtered
     * decks (which have no preset by design).
     */
    preset_id: number | null;
    children: ApiDeckSummary[];
}

export interface ApiDeckListResponse {
    decks: ApiDeckSummary[];
}

export interface ApiHealth {
    ok: boolean;
    version: string;
}

export interface ApiCardSummary {
    id: number;
    note_id: number;
    deck_id: number;
    deck_name: string;
    template_idx: number;
    front_html: string;
    back_html: string;
    tags: string[];
    state: "new" | "learning" | "review" | "suspended";
    ease_factor: number;
    notetype_id: number;
    notetype_name: string;
    notetype_css: string;
}

export interface ApiCardListResponse {
    total: number;
    cards: ApiCardSummary[];
}

export interface ApiQueueResponse {
    new: number;
    learning: number;
    review: number;
    cards: ApiCardSummary[];
}

export interface ApiDeckConfigDefault {
    id: number;
    name: string;
    /** FSRS desired retention as a 0.70..=0.97 float. UI converts to percent at the boundary. */
    desired_retention: number;
    /** Maximum review interval in days (1..=36500). */
    maximum_review_interval: number;
    /** Daily new-card cap (0..=9999). Phase 10-C. */
    new_per_day: number;
    /** Daily review-card cap (0..=9999). Phase 10-C. */
    reviews_per_day: number;
    /** Soft answer-time cap in seconds (1..=600). Phase 10-C. */
    cap_answer_time_secs: number;
    /**
     * Persisted FSRS-6 parameters. Empty when the preset has never been
     * optimized. Phase 9-O' lets the weights grid hydrate on mount instead
     * of waiting for a Re-optimize click each session.
     */
    fsrs_params: number[];
}

export interface ApiDeckConfigDefaultPatch {
    desired_retention?: number;
    maximum_review_interval?: number;
    new_per_day?: number;
    reviews_per_day?: number;
    cap_answer_time_secs?: number;
}

export interface ApiFsrsEnabled {
    enabled: boolean;
}

export interface ApiFsrsOptimizeResponse {
    /** Number of training reviews after revlog filtering. 0 means no data. */
    fsrs_items: number;
    /** Newly fitted (or echoed, if fsrs_items==0) FSRS-6 parameters. */
    params: number[];
}

const DEFAULT_BASE = "http://localhost:40001";

export function apiBase(): string {
    if (!browser) return DEFAULT_BASE;
    const qp = new URLSearchParams(window.location.search).get("api");
    return qp ?? (import.meta.env.VITE_ANKI_API as string | undefined) ?? DEFAULT_BASE;
}

/** Base URL (with trailing slash) for collection media served by anki_server. */
export function mediaBase(): string {
    return `${apiBase()}/media/`;
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${apiBase()}${path}`, {
        headers: { accept: "application/json" },
        ...init,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
}

// Mutating helpers parse the server's JSON error envelope ({status, message})
// so 400-class messages from anki_server (e.g. validation copy) surface inline.
async function jsonRequest<T>(
    path: string,
    method: "PATCH" | "PUT" | "POST",
    body: unknown,
): Promise<T> {
    const res = await fetch(`${apiBase()}${path}`, {
        method,
        headers: {
            "content-type": "application/json",
            accept: "application/json",
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        let detail = res.statusText;
        try {
            const parsed = (await res.json()) as { message?: string };
            if (parsed?.message) detail = parsed.message;
        } catch {
            // body wasn't JSON — fall through with statusText
        }
        throw new Error(`${res.status} ${detail}`);
    }
    return (await res.json()) as T;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
    return jsonRequest<T>(path, "PATCH", body);
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
    return jsonRequest<T>(path, "PUT", body);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
    return jsonRequest<T>(path, "POST", body);
}

export async function fetchHealth(): Promise<ApiHealth> {
    return getJson<ApiHealth>("/api/health");
}

export async function fetchDecks(): Promise<ApiDeckListResponse> {
    return getJson<ApiDeckListResponse>("/api/decks");
}

export interface ApiTagListResponse {
    tags: string[];
}

export async function fetchTags(): Promise<ApiTagListResponse> {
    return getJson<ApiTagListResponse>("/api/tags");
}

/**
 * Phase 11-B: recent review activity grouped by server-local calendar day.
 * Server pre-pads zero-review days so the array always has exactly `days`
 * entries, oldest first — sparkline rendering doesn't have to gap-fill.
 */
export interface ApiDayCount {
    date: string;
    reviews: number;
}

export interface ApiStatsRecent {
    days: number;
    history: ApiDayCount[];
}

export async function fetchStatsRecent(days = 30): Promise<ApiStatsRecent> {
    const query = new URLSearchParams({ days: String(days) });
    return getJson<ApiStatsRecent>(`/api/stats/recent?${query}`);
}

/**
 * List cards via /api/cards. Phase 11-C: pagination via (offset, limit);
 * `total` in the response reflects the unfiltered match count so callers
 * can render "X-Y of Z" without an extra round-trip. Server caps limit
 * at 500.
 */
export async function fetchCards(
    q = "",
    limit = 50,
    offset = 0,
): Promise<ApiCardListResponse> {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    query.set("limit", String(limit));
    query.set("offset", String(offset));
    return getJson<ApiCardListResponse>(`/api/cards?${query}`);
}

export async function fetchQueue(
    deckId: number,
    limit = 1,
): Promise<ApiQueueResponse> {
    const query = new URLSearchParams({ deck_id: String(deckId), limit: String(limit) });
    return getJson<ApiQueueResponse>(`/api/study/queue?${query}`);
}

export type AnswerRating = "again" | "hard" | "good" | "easy";

export interface AnswerRequest {
    card_id: number;
    deck_id: number;
    rating: AnswerRating;
    milliseconds_taken?: number;
}

export async function postAnswer(req: AnswerRequest): Promise<ApiQueueResponse> {
    return getJson<ApiQueueResponse>("/api/study/answer", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(req),
    });
}

export async function fetchDeckConfigDefault(): Promise<ApiDeckConfigDefault> {
    return getJson<ApiDeckConfigDefault>("/api/deck_config/default");
}

export async function patchDeckConfigDefault(
    patch: ApiDeckConfigDefaultPatch,
): Promise<ApiDeckConfigDefault> {
    return patchJson<ApiDeckConfigDefault>("/api/deck_config/default", patch);
}

/** Phase 9-O''. Lean preset list for the settings preset selector — only id+name. */
export interface ApiDeckConfigListItem {
    id: number;
    name: string;
}

export interface ApiDeckConfigListResponse {
    configs: ApiDeckConfigListItem[];
}

export async function fetchDeckConfigs(): Promise<ApiDeckConfigListResponse> {
    return getJson<ApiDeckConfigListResponse>("/api/deck_config");
}

export interface ApiDeckConfigCreateRequest {
    name: string;
}

/**
 * Phase 12-B: create a new preset by name. Server validates non-empty
 * (400) and uniqueness (400) before persisting via update_deck_configs.
 * The returned id is epoch-ms, assigned by Anki's add_deck_config_inner.
 */
export async function postDeckConfig(
    req: ApiDeckConfigCreateRequest,
): Promise<ApiDeckConfigListItem> {
    return postJson<ApiDeckConfigListItem>("/api/deck_config", req);
}

export interface ApiDeckConfigDeleteResponse {
    removed_config_id: number;
}

/**
 * Phase 13-B: delete a preset by id. Server rejects id=1 (Default,
 * 400) and missing ids (404). Decks that used the deleted preset are
 * reassigned to Default by the server (matches desktop behavior).
 */
export async function deleteDeckConfig(
    id: number,
): Promise<ApiDeckConfigDeleteResponse> {
    const res = await fetch(`${apiBase()}/api/deck_config/${id}`, {
        method: "DELETE",
        headers: { accept: "application/json" },
    });
    if (!res.ok) {
        let detail = res.statusText;
        try {
            const parsed = (await res.json()) as { message?: string };
            if (parsed?.message) detail = parsed.message;
        } catch {
            // body wasn't JSON — fall through with statusText
        }
        throw new Error(`${res.status} ${detail}`);
    }
    return (await res.json()) as ApiDeckConfigDeleteResponse;
}

export interface ApiNotetypeSummary {
    id: number;
    name: string;
    /** Field names in template order. Length == field count. */
    fields: string[];
}

export interface ApiNotetypeListResponse {
    notetypes: ApiNotetypeSummary[];
}

/**
 * Phase 13-C: list every notetype on the collection. Sorted by name
 * (case-insensitive) to match the desktop "Manage Note Types" dialog
 * ordering. Used by the Add Note picker.
 */
export async function fetchNotetypes(): Promise<ApiNotetypeListResponse> {
    return getJson<ApiNotetypeListResponse>("/api/notetypes");
}

export interface ApiNoteCreateRequest {
    deck_id: number;
    /** Field values in template order; first is the sort field. */
    fields: string[];
    tags?: string[];
    /** Optional notetype id; server falls back to "Basic" by name. */
    notetype_id?: number;
}

export interface ApiNoteCreateResponse {
    note_id: number;
    card_count: number;
}

/**
 * Phase 12-C: create a new note. Server validates first-field non-empty
 * (400), deck existence (404), notetype existence (404), and field-count
 * match (400) before persisting via Collection::add_note.
 */
export async function postNote(
    req: ApiNoteCreateRequest,
): Promise<ApiNoteCreateResponse> {
    return postJson<ApiNoteCreateResponse>("/api/notes", req);
}

export interface ApiNoteDeleteResponse {
    /**
     * Number of cards removed alongside the note. Varies by notetype
     * (Basic = 1, Basic+Reverse = 2, Cloze = N). Useful for an undo
     * toast like "Deleted note (3 cards)".
     */
    removed_card_count: number;
}

/**
 * Phase 13-A: delete a note (and its generated cards) by id. Server
 * validates id positive (400) and existence (404). Note id is the
 * note_id field on ApiCardSummary, NOT the card id.
 */
export async function deleteNote(id: number): Promise<ApiNoteDeleteResponse> {
    const res = await fetch(`${apiBase()}/api/notes/${id}`, {
        method: "DELETE",
        headers: { accept: "application/json" },
    });
    if (!res.ok) {
        let detail = res.statusText;
        try {
            const parsed = (await res.json()) as { message?: string };
            if (parsed?.message) detail = parsed.message;
        } catch {
            // body wasn't JSON — fall through with statusText
        }
        throw new Error(`${res.status} ${detail}`);
    }
    return (await res.json()) as ApiNoteDeleteResponse;
}

export interface ApiNotePatchRequest {
    /** New field values in template order. Length must match the
     * underlying notetype's field count exactly. Omit to leave fields
     * untouched. The first field is the sort field — non-empty after
     * trim is enforced server-side. */
    fields?: string[];
    /** New tag list. Trimmed + blank-dropped server-side. Omit to
     * leave tags untouched; an explicit empty array clears all tags. */
    tags?: string[];
}

export interface ApiNotePatchResponse {
    note_id: number;
    /** Persisted field values after the patch (server-canonical). */
    fields: string[];
    /** Persisted tag list after the patch, post-trim/dedup. */
    tags: string[];
    /** Note modified timestamp (epoch seconds). */
    modified: number;
}

export interface ApiDeckCreateRequest {
    /** Human-readable name. Use `::` to nest under existing parents
     * (auto-creates missing ancestors server-side). Server validates
     * trim non-empty + ≤100 chars + no leading/trailing/consecutive
     * `::` (Phase 14-C). */
    name: string;
}

export interface ApiDeckCreateResponse {
    id: number;
    /** Server-canonical name (may differ from request when a duplicate
     * is auto-suffixed to "Foo (1)"). */
    name: string;
}

/**
 * Phase 14-C: create a new (non-filtered) deck. Server validates the
 * name shape (400) — empty / >100 chars / `::` edge cases — then
 * returns the assigned epoch-ms id.
 */
export async function postDeck(
    name: string,
): Promise<ApiDeckCreateResponse> {
    return postJson<ApiDeckCreateResponse>("/api/decks", { name });
}

/**
 * Phase 14-A: partial-update a note's fields and/or tags. Server
 * validates id positive (400), at-least-one-of-fields-or-tags (400),
 * existence (404), and field-count match against the note's notetype
 * (400). Note id is the `note_id` field on ApiCardSummary, NOT the
 * card id.
 */
export async function patchNote(
    id: number,
    patch: ApiNotePatchRequest,
): Promise<ApiNotePatchResponse> {
    return patchJson<ApiNotePatchResponse>(`/api/notes/${id}`, patch);
}

export async function fetchDeckConfigById(id: number): Promise<ApiDeckConfigDefault> {
    return getJson<ApiDeckConfigDefault>(`/api/deck_config/${id}`);
}

export async function patchDeckConfigById(
    id: number,
    patch: ApiDeckConfigDefaultPatch,
): Promise<ApiDeckConfigDefault> {
    return patchJson<ApiDeckConfigDefault>(`/api/deck_config/${id}`, patch);
}

export async function fetchFsrsEnabled(): Promise<ApiFsrsEnabled> {
    return getJson<ApiFsrsEnabled>("/api/fsrs/enabled");
}

export async function putFsrsEnabled(req: ApiFsrsEnabled): Promise<ApiFsrsEnabled> {
    return putJson<ApiFsrsEnabled>("/api/fsrs/enabled", req);
}

export async function postFsrsOptimize(): Promise<ApiFsrsOptimizeResponse> {
    return postJson<ApiFsrsOptimizeResponse>("/api/fsrs/optimize", {});
}

export interface ApiDeckRenameResponse {
    id: number;
    name: string;
}

/**
 * Rename a deck by id. Server validates name (empty/whitespace → 400) and
 * existence (missing → 404); both surface as Error("400 ...") /
 * Error("404 ...") via jsonRequest's {message} parsing.
 */
export async function patchDeckName(
    id: number,
    name: string,
): Promise<ApiDeckRenameResponse> {
    return patchJson<ApiDeckRenameResponse>(`/api/decks/${id}`, { name });
}

export interface ApiSuspendResponse {
    id: number;
    state: ApiCardSummary["state"];
}

/**
 * Suspend or unsuspend a card by id. POST with `{suspended: true}` (or
 * default body) suspends; `{suspended: false}` unsuspends. Idempotent
 * server-side; missing card → 404 surfaced via jsonRequest.
 */
export async function postCardSuspend(
    id: number,
    suspended: boolean,
): Promise<ApiSuspendResponse> {
    return postJson<ApiSuspendResponse>(`/api/cards/${id}/suspend`, {
        suspended,
    });
}

/** Phase 11-A: per-deck preset assignment. */
export interface ApiDeckPresetResponse {
    id: number;
    preset_id: number;
    preset_name: string;
}

/**
 * Assign a preset (deck config) to a deck. Server validates preset_id
 * (non-positive → 400) and existence (missing deck or preset → 404);
 * filtered decks reject with 400. Affects ALL cards in the deck — caller
 * UI should make this scope clear to the user.
 */
export async function patchDeckPreset(
    deckId: number,
    presetId: number,
): Promise<ApiDeckPresetResponse> {
    return patchJson<ApiDeckPresetResponse>(`/api/decks/${deckId}/preset`, {
        preset_id: presetId,
    });
}
