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
    /**
     * Phase 17-A: user-visible flag colour. 0 = no flag; 1..=7 are the
     * seven supported colours (red/orange/green/blue/pink/turquoise/
     * purple — same colour ordering as the desktop browse pane).
     */
    flag: number;
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
     * Phase 17-C: how the daily new-card pool is ordered. `"due"` (default)
     * picks in note creation order; `"random"` shuffles the pool. Server
     * persists the proto enum (`NewCardInsertOrder` Due=0, Random=1) but
     * exposes the lowercase string so a misconfigured client gets a 400
     * instead of silently accepting a wrong integer.
     */
    new_card_order: "due" | "random";
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
    /** Phase 17-C: see ApiDeckConfigDefault.new_card_order for the contract. */
    new_card_order?: "due" | "random";
}

export interface ApiFsrsEnabled {
    enabled: boolean;
}

/**
 * Phase 15-B: collection-level FSRS health-check toggle. When enabled,
 * the next FSRS optimize / enable-flip runs the trained-params sanity
 * check that surfaces warnings for unstable parameter values. Setting
 * this flag does NOT itself trigger an optimize or reschedule — it
 * just changes what the next expensive operation will do.
 */
export interface ApiFsrsHealthCheck {
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
 * Phase 17-B: per-day forecast of review-due cards for the next N days.
 * Server pre-pads zero-due gaps so the array always has exactly `days`
 * entries (offset=0..days-1, oldest first). Overdue cards collapse into
 * offset=0 so the home page bar chart's "today" bucket reflects the
 * actual review backlog rather than hiding it behind a future window.
 */
export interface ApiForecastDay {
    offset: number;
    reviews: number;
}

export interface ApiForecastResponse {
    days: number;
    history: ApiForecastDay[];
}

export async function fetchForecast(days = 7): Promise<ApiForecastResponse> {
    const query = new URLSearchParams({ days: String(days) });
    return getJson<ApiForecastResponse>(`/api/study/forecast?${query}`);
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

export interface ApiNotetypeRenameResponse {
    id: number;
    /** Server-canonical name after trim. May differ from the request
     * input when leading/trailing whitespace was stripped. */
    name: string;
}

/**
 * Phase 16-B: rename a notetype. Server validates id positive (400),
 * trimmed name non-empty + ≤100 chars (400), and existence (404).
 * Rename is a pure label refresh — cards are linked by notetype_id so
 * none of them need regeneration; mtime bumps so a sync would
 * propagate the change.
 */
export async function patchNotetypeName(
    id: number,
    name: string,
): Promise<ApiNotetypeRenameResponse> {
    return patchJson<ApiNotetypeRenameResponse>(`/api/notetypes/${id}`, {
        name,
    });
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

export interface ApiDeckDeleteResponse {
    removed_deck_id: number;
    /**
     * Total cards removed across the deleted deck and all descendants.
     * Useful for an undo toast like "Deleted deck (12 cards)". 0 when
     * the deck (and all children) were already empty.
     */
    removed_card_count: number;
}

/**
 * Phase 15-A: delete a deck (cascades through children + their cards
 * + orphan notes). Server rejects id<=0 (400), the protected Default
 * deck id=1 (400), and missing ids (404).
 */
export async function deleteDeck(id: number): Promise<ApiDeckDeleteResponse> {
    const res = await fetch(`${apiBase()}/api/decks/${id}`, {
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
    return (await res.json()) as ApiDeckDeleteResponse;
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

export interface ApiSavedSearch {
    /** Unique label, ≤60 chars, no `/`. Trimmed at the boundary. */
    name: string;
    /** Anki search expression. Server doesn't validate the syntax
     * here; /api/cards judges it at run time when the user clicks
     * the saved search. */
    query: string;
    /** Epoch seconds when the search was added. */
    created_at: number;
}

export interface ApiSavedSearchListResponse {
    searches: ApiSavedSearch[];
}

export interface ApiSavedSearchCreateRequest {
    name: string;
    query: string;
}

export interface ApiSavedSearchDeleteResponse {
    removed_name: string;
}

/**
 * Phase 18-C: list every persisted saved search. Empty array on a
 * fresh collection (server treats key-absent as empty list, not 404,
 * to avoid a cosmetic "first save" round-trip).
 */
export async function fetchSavedSearches(): Promise<ApiSavedSearchListResponse> {
    return getJson<ApiSavedSearchListResponse>("/api/saved_searches");
}

/**
 * Phase 18-C: append a new saved search. Server validates name shape
 * (1..=60 chars, no `/`), query non-empty (1..=1000 chars), and name
 * uniqueness; conflicts and shape errors all return 400.
 */
export async function postSavedSearch(
    req: ApiSavedSearchCreateRequest,
): Promise<ApiSavedSearch> {
    return postJson<ApiSavedSearch>("/api/saved_searches", req);
}

/**
 * Phase 18-C: remove a saved search by name. Name is URL-encoded
 * before going into the path so spaces and CJK round-trip cleanly.
 * Missing name → 404, malformed name → 400.
 */
export async function deleteSavedSearch(
    name: string,
): Promise<ApiSavedSearchDeleteResponse> {
    const encoded = encodeURIComponent(name);
    const res = await fetch(`${apiBase()}/api/saved_searches/${encoded}`, {
        method: "DELETE",
    });
    if (!res.ok) {
        let detail = res.statusText;
        try {
            const body = (await res.json()) as { message?: string };
            if (body.message) detail = body.message;
        } catch {
            // Fall through with statusText so we still surface something.
        }
        throw new Error(`${res.status} ${detail}`);
    }
    return (await res.json()) as ApiSavedSearchDeleteResponse;
}

export interface ApiFilteredDeckCreateRequest {
    /** Same shape rules as a normal deck name (Phase 14-C). */
    name: string;
    /** Anki search expression — same syntax the browse search bar
     * accepts (e.g. `deck:Spanish is:due`, `tag:hard prop:ivl<7`).
     * Server-side `normalize_search` will reject syntactic invalidity
     * with 400. */
    search: string;
    /** Per-term cap on cards pulled in. Default 100, max 1000. */
    limit?: number;
    /** Selection order. Lowercase wire string — `"due"` (default) or
     * `"random"`. Other proto enum variants are intentionally not
     * exposed by the v1 surface. */
    order?: "due" | "random";
}

export interface ApiFilteredDeckCreateResponse {
    id: number;
    /** Server-canonical name (auto-suffixed on duplicate). */
    name: string;
}

/**
 * Phase 18-B: create a filtered (cram) deck from a single search
 * expression. Server validates name shape, search non-empty, limit
 * 1..=1000, and order ∈ {"due","random"} at the boundary; rslib's
 * own `normalize_search` and `SearchReturnedNoCards` errors map back
 * to 400 so an invalid query or empty match is surfaced as a request
 * problem rather than a 500. The transaction is atomic — a rejected
 * deck never lingers in the collection.
 */
export async function postFilteredDeck(
    req: ApiFilteredDeckCreateRequest,
): Promise<ApiFilteredDeckCreateResponse> {
    return postJson<ApiFilteredDeckCreateResponse>("/api/decks/filtered", req);
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

export interface ApiNoteSummary {
    id: number;
    /** Owning notetype id (epoch-ms timestamp on real collections). */
    notetype_id: number;
    /** Notetype name, e.g. "Basic" / "Cloze". */
    notetype_name: string;
    /** Raw field values exactly as stored — preserves HTML so the
     * editor can round-trip without losing formatting. Distinct from
     * the rendered `front_html` / `back_html` on ApiCardSummary which
     * have already been through `{{Field}}` template expansion. */
    fields: string[];
    /** Persisted tags in canonical alphabetical order. */
    tags: string[];
    /** Note modified timestamp (epoch seconds). */
    modified: number;
}

/**
 * Phase 16-A: fetch a single note by id with raw field values
 * preserved. Mirrors the Phase 15-D FFI shape so the web client and
 * native iOS client share the same record model. Server validates
 * id positive (400) and existence (404). Read-only — safe to call
 * repeatedly from a Svelte effect without lock contention.
 */
export async function fetchNote(id: number): Promise<ApiNoteSummary> {
    const res = await fetch(`${apiBase()}/api/notes/${id}`, {
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
    return (await res.json()) as ApiNoteSummary;
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

export async function fetchFsrsHealthCheck(): Promise<ApiFsrsHealthCheck> {
    return getJson<ApiFsrsHealthCheck>("/api/fsrs/health_check");
}

/**
 * Phase 15-C: response shape for POST /media. `filename` is the
 * server-canonical name after dedupe — differs from the upload name
 * when an existing collision was resolved via " (N)" suffix. The
 * client renders `<img src="/media/${filename}">` from this value
 * (NOT the original File.name) so the rendered HTML always points
 * at the actually persisted byte stream.
 */
export interface ApiMediaUploadResponse {
    filename: string;
    size_bytes: number;
}

/**
 * Phase 15-C: upload an image into <collection-stem>.media/. Server
 * accepts multipart with a single `file` field, validates filename
 * (≤200 chars, no separators, must include extension, no leading dot)
 * and MIME (image/png|jpeg|webp|gif allow-list), caps size at 10 MiB,
 * dedup'es the filename via " (N)" suffix mirroring desktop Anki.
 */
export async function postMedia(file: File): Promise<ApiMediaUploadResponse> {
    const form = new FormData();
    form.append("file", file, file.name);
    const res = await fetch(`${apiBase()}/media`, {
        method: "POST",
        body: form,
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
    return (await res.json()) as ApiMediaUploadResponse;
}

export async function putFsrsHealthCheck(
    req: ApiFsrsHealthCheck,
): Promise<ApiFsrsHealthCheck> {
    return putJson<ApiFsrsHealthCheck>("/api/fsrs/health_check", req);
}

/**
 * Phase 14-B: per-preset optimize. When `presetId` is undefined, the
 * server keeps the v1 Default-preset behavior (Phase 9-O3 backward
 * compat). When supplied, the server validates the id (400 for
 * non-positive), looks up the preset (404 on miss), and refuses to
 * train a preset with no decks assigned (400 — see commit body).
 */
export async function postFsrsOptimize(
    presetId?: number,
): Promise<ApiFsrsOptimizeResponse> {
    const path =
        presetId === undefined
            ? "/api/fsrs/optimize"
            : `/api/fsrs/optimize?preset_id=${presetId}`;
    return postJson<ApiFsrsOptimizeResponse>(path, {});
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

/**
 * Phase 17-A: per-card flag colour. 0 clears, 1..=7 sets one of the
 * seven supported colours. Server validates the range (400 outside
 * 0..=7) and re-reads the card post-write so the response echoes the
 * persisted value.
 */
export interface ApiFlagResponse {
    id: number;
    flag: number;
}

export async function postCardFlag(
    id: number,
    flag: number,
): Promise<ApiFlagResponse> {
    return postJson<ApiFlagResponse>(`/api/cards/${id}/flag`, { flag });
}

/**
 * Phase 19-D: bulk-move a set of cards into a target deck. Wire shape
 * already takes a list so Phase 20's multi-select-in-browse can reuse
 * this without an API change — the 19-D UI just sends a one-element list
 * per move click. Server validates non-empty list, positive ids, and
 * `deck_id` existence (404) / non-filtered (400) before the rslib call;
 * cards already in the target and unknown card ids are silently skipped
 * (lower the `moved` count rather than fail the batch).
 */
export interface ApiCardMoveRequest {
    card_ids: number[];
    deck_id: number;
}

export interface ApiCardMoveResponse {
    moved: number;
}

export async function postMoveCards(
    req: ApiCardMoveRequest,
): Promise<ApiCardMoveResponse> {
    return postJson<ApiCardMoveResponse>("/api/cards/move", req);
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
