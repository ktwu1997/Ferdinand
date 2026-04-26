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

export async function fetchCards(q = "", limit = 50): Promise<ApiCardListResponse> {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    query.set("limit", String(limit));
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
