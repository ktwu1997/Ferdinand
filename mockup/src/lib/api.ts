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
}

export interface ApiDeckConfigDefaultPatch {
    desired_retention?: number;
    maximum_review_interval?: number;
}

export interface ApiFsrsEnabled {
    enabled: boolean;
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
    method: "PATCH" | "PUT",
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

export async function fetchHealth(): Promise<ApiHealth> {
    return getJson<ApiHealth>("/api/health");
}

export async function fetchDecks(): Promise<ApiDeckListResponse> {
    return getJson<ApiDeckListResponse>("/api/decks");
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

export async function fetchFsrsEnabled(): Promise<ApiFsrsEnabled> {
    return getJson<ApiFsrsEnabled>("/api/fsrs/enabled");
}

export async function putFsrsEnabled(req: ApiFsrsEnabled): Promise<ApiFsrsEnabled> {
    return putJson<ApiFsrsEnabled>("/api/fsrs/enabled", req);
}
