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

// SSR fallback only — used when there's no `window` (e.g. during build).
// At runtime in the browser the default is the page's own origin, so the
// single-binary deployment (mockup served from anki_server on :40001)
// works whether opened via localhost, a container IP, or a remote host.
// `?api=` query param and `VITE_ANKI_API` env var still override (dev mode
// where the vite dev server on :5174 calls anki_server on :40001).
const SSR_FALLBACK_BASE = "http://localhost:40001";

export function apiBase(): string {
    if (!browser) return SSR_FALLBACK_BASE;
    const qp = new URLSearchParams(window.location.search).get("api");
    if (qp) return qp;
    const env = import.meta.env.VITE_ANKI_API as string | undefined;
    if (env) return env;
    return window.location.origin;
}

/** Base URL (with trailing slash) for collection media served by anki_server. */
export function mediaBase(): string {
    return `${apiBase()}/media/`;
}

// Phase A4-β: signed-cookie session lives in a HttpOnly cookie set by
// anki_server on POST /api/auth/login. Every API call needs
// `credentials: "include"` so the browser actually sends it cross-origin
// during dev (vite :5174 → anki_server :40001) and same-origin in prod.
// Without this, every authed request becomes anonymous and the server
// returns 401 even for a freshly-logged-in user.

// Phase A4-β: 401-redirect hook. The auth store (mockup/src/lib/auth.svelte.ts)
// registers a callback here on bootstrap; whenever a non-auth API call
// returns 401, the callback clears auth state and redirects to /login.
// We deliberately skip the hook for /api/auth/* so:
//   - fetchAuthMe()'s 401 (anonymous user) doesn't redirect-loop
//   - postAuthLogin()'s 401 (wrong password) surfaces inline as a form
//     error instead of bouncing the user away from the login page.
type UnauthorizedCallback = () => void;
let onUnauthorizedCallback: UnauthorizedCallback | null = null;

export function setOnUnauthorized(cb: UnauthorizedCallback | null): void {
    onUnauthorizedCallback = cb;
}

function fireOnUnauthorized(path: string): void {
    if (path.startsWith("/api/auth/")) return;
    onUnauthorizedCallback?.();
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${apiBase()}${path}`, {
        credentials: "include",
        headers: { accept: "application/json" },
        ...init,
    });
    if (!res.ok) {
        if (res.status === 401) fireOnUnauthorized(path);
        throw new Error(`${res.status} ${res.statusText}`);
    }
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
        credentials: "include",
        headers: {
            "content-type": "application/json",
            accept: "application/json",
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        if (res.status === 401) fireOnUnauthorized(path);
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

export interface ApiAnswerButtons {
    days: number;
    again: number;
    hard: number;
    good: number;
    easy: number;
}

export async function fetchAnswerButtons(days = 30): Promise<ApiAnswerButtons> {
    const query = new URLSearchParams({ days: String(days) });
    return getJson<ApiAnswerButtons>(`/api/stats/answer_buttons?${query}`);
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
    const path = `/api/deck_config/${id}`;
    const res = await fetch(`${apiBase()}${path}`, {
        method: "DELETE",
        credentials: "include",
        headers: { accept: "application/json" },
    });
    if (!res.ok) {
        if (res.status === 401) fireOnUnauthorized(path);
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

/**
 * Phase 19-A: per-template payload returned by `fetchNotetype` and
 * `patchNotetypeTemplates`. `qfmt` / `afmt` are the raw `{{Field}}`
 * template strings; `ord` is the stable 0-indexed position in the
 * notetype's template list.
 */
export interface ApiNotetypeTemplate {
    ord: number;
    name: string;
    qfmt: string;
    afmt: string;
}

/**
 * Phase 19-A: full notetype detail. Returned by GET /api/notetypes/{id}
 * and PATCH /api/notetypes/{id} so the client always has the canonical
 * post-write state. The list endpoint deliberately omits `templates`
 * to keep the picker payload small.
 */
export interface ApiNotetypeDetail {
    id: number;
    name: string;
    fields: string[];
    templates: ApiNotetypeTemplate[];
}

/**
 * Phase 19-A: combined patch payload — supplies a new `name`, a list
 * of `templates` to overwrite, or both. Server enforces at-least-one;
 * a request with both omitted returns 400 instead of silently bumping
 * mtime.
 */
export interface ApiNotetypePatchRequest {
    name?: string;
    templates?: Array<{
        ord: number;
        qfmt: string;
        afmt: string;
    }>;
}

/**
 * Phase 19-A: fetch a single notetype with its templates. Mirrors the
 * GET shape of notes / cards / decks — list endpoint stays slim, detail
 * endpoint includes the full template payload so the editor's Card
 * Templates panel can hydrate without re-walking every notetype.
 */
export async function fetchNotetype(id: number): Promise<ApiNotetypeDetail> {
    return getJson<ApiNotetypeDetail>(`/api/notetypes/${id}`);
}

/**
 * Phase 16-B + 19-A: rename a notetype and/or overwrite per-template
 * `qfmt` / `afmt` formats. Server validates id positive (400), name
 * shape (≤100 chars when supplied), per-format non-empty and ≤65000
 * chars, ord existence against the live notetype, and at-least-one-
 * of-name-or-templates (400). Returns the canonical post-write state
 * (name, fields, templates) so the client doesn't need to refetch.
 */
export async function patchNotetype(
    id: number,
    patch: ApiNotetypePatchRequest,
): Promise<ApiNotetypeDetail> {
    return patchJson<ApiNotetypeDetail>(`/api/notetypes/${id}`, patch);
}

/**
 * Phase 16-B: thin rename helper kept for callers that only need the
 * name path. Delegates to `patchNotetype` so the response shape stays
 * unified post-19-A.
 */
export async function patchNotetypeName(
    id: number,
    name: string,
): Promise<ApiNotetypeDetail> {
    return patchNotetype(id, { name });
}

/**
 * Phase 19-B: append a new field to a notetype. Server validates id
 * positive (400), name non-empty + ≤100 chars (400), no `:` / `{` /
 * `}` / `"` characters (400), uniqueness within the notetype's
 * existing fields (400), and notetype existence (404). On success
 * every existing note for this notetype is silently padded with an
 * empty string in the new slot — schema-mutation safe so cards and
 * revlog counts stay invariant. Response is the canonical post-write
 * notetype detail.
 */
export async function postNotetypeField(
    id: number,
    name: string,
): Promise<ApiNotetypeDetail> {
    return postJson<ApiNotetypeDetail>(`/api/notetypes/${id}/fields`, {
        name,
    });
}

/**
 * Phase 19-C: drop a field from a notetype. Destructive — every
 * note loses that field's content permanently. Server validates id
 * positive (400), notetype existence (404), ord existence against
 * the live notetype (400), and refuses to delete the last remaining
 * field (400 — rslib also rejects `fields.is_empty()` but the route
 * surfaces a friendlier message). Cards and revlog counts stay
 * invariant; only the per-note `fields` array length shrinks by one
 * and any template reference to the removed field is repointed by
 * Anki's schema-change machinery. Response is the canonical post-
 * write notetype detail.
 */
export async function deleteNotetypeField(
    id: number,
    ord: number,
): Promise<ApiNotetypeDetail> {
    const path = `/api/notetypes/${id}/fields/${ord}`;
    const res = await fetch(`${apiBase()}${path}`, {
        method: "DELETE",
        credentials: "include",
        headers: { accept: "application/json" },
    });
    if (!res.ok) {
        if (res.status === 401) fireOnUnauthorized(path);
        let detail = res.statusText;
        try {
            const body = (await res.json()) as { message?: string };
            if (body.message) detail = body.message;
        } catch {
            // body wasn't JSON — fall through with statusText
        }
        throw new Error(`${res.status} ${detail}`);
    }
    return (await res.json()) as ApiNotetypeDetail;
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
    const path = `/api/decks/${id}`;
    const res = await fetch(`${apiBase()}${path}`, {
        method: "DELETE",
        credentials: "include",
        headers: { accept: "application/json" },
    });
    if (!res.ok) {
        if (res.status === 401) fireOnUnauthorized(path);
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
    const path = `/api/notes/${id}`;
    const res = await fetch(`${apiBase()}${path}`, {
        method: "DELETE",
        credentials: "include",
        headers: { accept: "application/json" },
    });
    if (!res.ok) {
        if (res.status === 401) fireOnUnauthorized(path);
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
    const path = `/api/saved_searches/${encoded}`;
    const res = await fetch(`${apiBase()}${path}`, {
        method: "DELETE",
        credentials: "include",
    });
    if (!res.ok) {
        if (res.status === 401) fireOnUnauthorized(path);
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
    const path = `/api/notes/${id}`;
    const res = await fetch(`${apiBase()}${path}`, {
        credentials: "include",
        headers: { accept: "application/json" },
    });
    if (!res.ok) {
        if (res.status === 401) fireOnUnauthorized(path);
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
    const path = "/media";
    const res = await fetch(`${apiBase()}${path}`, {
        method: "POST",
        credentials: "include",
        body: form,
    });
    if (!res.ok) {
        if (res.status === 401) fireOnUnauthorized(path);
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

/**
 * Phase B3a: response shape for POST /api/import/apkg. Mirrors rslib's
 * NoteLog. `imported_card_count` is intentionally `null` in v1 — the
 * import endpoint doesn't yet surface per-card counts (rslib's NoteLog
 * is note-level only); B3b's UI falls back to a note-only toast. Keeping
 * the field in the schema so a future backend bump can populate it
 * without a typed-client breaking change.
 */
export interface ApiImportResult {
    imported_note_count: number;
    updated_note_count: number;
    skipped_count: number;
    imported_card_count: number | null;
    log_summary: string;
}

/**
 * Phase B3a: upload a `.apkg` file into the authenticated user's
 * collection. Multipart with a single `file` field. Server caps at
 * `ANKI_IMPORT_MAX_BYTES` (default 100 MiB) and runs rslib's
 * `import_apkg` synchronously inside `spawn_blocking`, so the request
 * stays open for the duration of the import. UI is wired in B3b
 * (file picker + drag-drop on `/notes/new`).
 */
export async function postImportApkg(file: File): Promise<ApiImportResult> {
    const form = new FormData();
    form.append("file", file, file.name);
    const path = "/api/import/apkg";
    const res = await fetch(`${apiBase()}${path}`, {
        method: "POST",
        credentials: "include",
        body: form,
    });
    if (!res.ok) {
        if (res.status === 401) fireOnUnauthorized(path);
        let detail = res.statusText;
        try {
            const parsed = (await res.json()) as { message?: string };
            if (parsed?.message) detail = parsed.message;
        } catch {
            // body wasn't JSON — fall through with statusText
        }
        throw new Error(`${res.status} ${detail}`);
    }
    return (await res.json()) as ApiImportResult;
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

/**
 * Phase 20-D: per-card revlog entry. `id` is the millisecond epoch
 * timestamp (also serves as the unique row key). `button` is the raw
 * 0..=4 byte for callers that prefer the integer; `button_label` is
 * the lowercase string for display. `interval_days` and
 * `last_interval_days` follow the rslib sign convention — positive is
 * days, negative is seconds (sub-day reviews). `ease_percent` is the
 * human-readable percent (e.g. 250 means 2.50); 0 if the row never
 * carried an ease.
 */
export interface ApiCardHistoryEntry {
    id: number;
    button: number;
    button_label: "again" | "hard" | "good" | "easy" | "manual";
    interval_days: number;
    last_interval_days: number;
    ease_percent: number;
    taken_ms: number;
    review_kind:
        | "learning"
        | "review"
        | "relearning"
        | "filtered"
        | "manual"
        | "rescheduled";
}

export interface ApiCardHistoryResponse {
    card_id: number;
    total: number;
    entries: ApiCardHistoryEntry[];
}

/**
 * Phase 20-D: fetch a card's revlog entries newest-first. Read-only —
 * safe to call repeatedly from a Svelte effect (the browse editor's
 * Review History disclosure does this on first open and on card
 * switch). Server validates id positive (400) and card existence
 * (404). Empty entries on a never-reviewed card is a valid 200, not
 * a 404.
 */
export async function getCardHistory(
    id: number,
): Promise<ApiCardHistoryResponse> {
    return getJson<ApiCardHistoryResponse>(`/api/cards/${id}/history`);
}

/**
 * Phase 20-C: fetch a single card by id. Same shape as the items
 * returned by `fetchCards`, but tied to a specific id rather than a
 * search query — used by the Recovery tab's lookup flow so the user
 * can preview the card before triggering a destructive reset.
 */
export async function getCard(id: number): Promise<ApiCardSummary> {
    return getJson<ApiCardSummary>(`/api/cards/${id}`);
}

/**
 * Phase 20-C: burn-recovery. POST /api/cards/{id}/reset_to_new clears
 * the card's scheduling state (queue/due/interval/factor/reps/lapses)
 * via rslib's `reschedule_cards_as_new`. Revlog rows are PRESERVED —
 * burn-recovery reverts an accidental rating, it doesn't erase
 * history. Server returns the post-reset state label (always "new" on
 * success) and the count of preserved revlog entries so the UI can
 * confirm history wasn't dropped. Missing card → 404; non-positive
 * id → 400; both surface via jsonRequest's {message} parsing.
 */
export interface ApiResetResponse {
    id: number;
    state: ApiCardSummary["state"];
    revlog_preserved: number;
}

export async function resetCardToNew(id: number): Promise<ApiResetResponse> {
    return postJson<ApiResetResponse>(`/api/cards/${id}/reset_to_new`, {});
}

/**
 * Phase 20-B: bulk suspend / unsuspend response. `count` is the
 * deduplicated input length the server processed; rslib silently
 * skips unknown ids inside the slice, so a partial-hit batch still
 * reports the dedup-collapsed input length here. Compare against the
 * request's `cardIds.length` client-side to detect dedup-collapse.
 * `suspended` echoes the requested target state.
 */
export interface ApiBulkSuspendResponse {
    count: number;
    suspended: boolean;
}

/**
 * Phase 20-B: bulk flag response. Same `count` convention as
 * `ApiBulkSuspendResponse`. `flag` echoes the persisted value
 * (0..=7) so the caller can mirror it across selected rows without
 * a refetch.
 */
export interface ApiBulkFlagResponse {
    count: number;
    flag: number;
}

/**
 * Phase 20-B: bulk suspend or unsuspend a set of cards. Wraps
 * rslib's slice-aware `bury_or_suspend_cards` /
 * `unbury_or_unsuspend_cards`. Idempotent under repeated calls with
 * the same target state. Server validates non-empty, positive,
 * deduped, ≤1000 ids (400 on violation); unknown ids inside the
 * batch are silently skipped.
 */
export async function bulkSuspend(
    cardIds: number[],
    suspended: boolean,
): Promise<ApiBulkSuspendResponse> {
    return postJson<ApiBulkSuspendResponse>("/api/cards/bulk_suspend", {
        card_ids: cardIds,
        suspended,
    });
}

/**
 * Phase 20-B: bulk set/clear flag on a set of cards. Wraps rslib's
 * slice-aware `set_card_flag`. Idempotent under repeated calls with
 * the same flag value. Server validates the id list (same rules as
 * `bulkSuspend`) plus `flag` in 0..=7 (400 on violation); unknown
 * ids inside the batch are silently skipped.
 */
export async function bulkFlag(
    cardIds: number[],
    flag: number,
): Promise<ApiBulkFlagResponse> {
    return postJson<ApiBulkFlagResponse>("/api/cards/bulk_flag", {
        card_ids: cardIds,
        flag,
    });
}

/**
 * Phase A4-β: authenticated user payload returned by GET /api/auth/me and
 * POST /api/auth/login. `username` is lowercase a-z 0-9 _ - (server
 * enforces 3..=64 chars at register/login boundary); the auth store and
 * /login page surface it as-is.
 *
 * Phase B2: `is_admin` is true when the env-configured admin username
 * (server-side `ANKI_ADMIN_USERNAME`) matches `username`. The settings
 * page uses this to gate the admin section. Always present on the wire
 * — non-admin = `false`, admin not configured = `false` for everyone.
 */
export interface ApiAuthMe {
    username: string;
    is_admin: boolean;
}

/**
 * Phase A4-β: GET /api/auth/me. Resolves to `null` when the server
 * reports 401 (no session yet) so the auth store's bootstrap can branch
 * into "anon" without catching an Error. Other HTTP failures still throw
 * so genuine outages aren't silently treated as "logged out".
 *
 * Bypasses the global `onUnauthorized` hook (path is under `/api/auth/`)
 * so an anonymous bootstrap doesn't trigger a redirect-loop on /login.
 */
export async function fetchAuthMe(): Promise<ApiAuthMe | null> {
    const path = "/api/auth/me";
    const res = await fetch(`${apiBase()}${path}`, {
        credentials: "include",
        headers: { accept: "application/json" },
    });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as ApiAuthMe;
}

/**
 * Phase A4-β: POST /api/auth/login. Server returns 200 + UserBody on
 * success, 401 ("invalid credentials") on bad creds, 400 on malformed
 * input, 429 ("too many login attempts; try again later") when the
 * sliding-window rate-limiter trips. Errors propagate as
 * `Error("<status> <message>")` so the form can render the message
 * inline. The 401 here is NOT routed through `fireOnUnauthorized` —
 * the path lives under `/api/auth/` so wrong-password doesn't bounce
 * the user away from the login form.
 */
export async function postAuthLogin(
    username: string,
    password: string,
): Promise<ApiAuthMe> {
    return jsonRequest<ApiAuthMe>("/api/auth/login", "POST", {
        username,
        password,
    });
}

/**
 * Phase A4-β: POST /api/auth/logout. Idempotent — server returns 204
 * even if no session existed. We don't go through `jsonRequest` because
 * 204 has no body to parse; we still send `credentials: "include"` so
 * the server can identify and flush the session cookie.
 */
export async function postAuthLogout(): Promise<void> {
    const path = "/api/auth/logout";
    const res = await fetch(`${apiBase()}${path}`, {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json" },
    });
    if (!res.ok && res.status !== 204) {
        throw new Error(`${res.status} ${res.statusText}`);
    }
}

/**
 * Phase B1: PATCH /api/auth/password. Self-service password change for the
 * currently-authed user. 200 + `{ok:true}` on success; 401 if `current` is
 * wrong; 400 if the new password fails server-side validation (min 8 chars,
 * must differ from current). Errors propagate as `Error("<status> <message>")`
 * so the settings form can surface them inline. Path lives under
 * `/api/auth/` so a 401 (wrong-current) does NOT redirect to /login —
 * the form stays open and shows the error in place.
 */
export interface ApiAuthOk {
    ok: boolean;
}
export async function postAuthChangePassword(
    current: string,
    newPassword: string,
): Promise<ApiAuthOk> {
    return patchJson<ApiAuthOk>("/api/auth/password", {
        current,
        new: newPassword,
    });
}

/**
 * Phase B2: admin user-list row. Mirrors `ApiAdminUser` on the server.
 * Password hashes never leave the server — only the metadata needed
 * to render the admin panel.
 *
 * `disabled_at` is null when the account is active; a unix-seconds
 * timestamp when an admin disabled it. Frontend renders the toggle
 * state from this directly (no separate `is_disabled` flag).
 */
export interface ApiAdminUser {
    id: number;
    username: string;
    created_at: number;
    disabled_at: number | null;
}

export interface ApiAdminUserList {
    users: ApiAdminUser[];
}

/**
 * Phase B2: GET /api/admin/users. Requires the caller to be the admin
 * user (server-side `ANKI_ADMIN_USERNAME`). Non-admin authed users get
 * 403; anon callers get 401 (which the global onUnauthorized hook
 * routes to /login). Returns every user in id-ascending order.
 */
export async function fetchAdminUsers(): Promise<ApiAdminUserList> {
    return getJson<ApiAdminUserList>("/api/admin/users");
}

/**
 * Phase B2: POST /api/admin/users/{username}/reset-password. Admin
 * force-reset — overwrites the target user's password and invalidates
 * every one of their persisted sessions, kicking the user off all
 * devices in the same beat. 200 + `{ok:true}` on success. 400 if
 * `newPassword` is empty, 404 if the user doesn't exist, 403 if the
 * caller isn't admin.
 */
export async function postAdminResetPassword(
    username: string,
    newPassword: string,
): Promise<ApiAuthOk> {
    const path = `/api/admin/users/${encodeURIComponent(username)}/reset-password`;
    return postJson<ApiAuthOk>(path, { new: newPassword });
}

/**
 * Phase B2: POST /api/admin/users/{username}/disable. Sets or clears
 * the user's `disabled_at`. Disabling also revokes their sessions so
 * a captured cookie stops working immediately. Re-enabling does NOT
 * restore sessions — the user has to log in again. 400 if the admin
 * tries to disable themselves, 404 if the user is unknown, 403 if
 * the caller isn't admin.
 */
export async function postAdminDisable(
    username: string,
    disabled: boolean,
): Promise<ApiAuthOk> {
    const path = `/api/admin/users/${encodeURIComponent(username)}/disable`;
    return postJson<ApiAuthOk>(path, { disabled });
}
