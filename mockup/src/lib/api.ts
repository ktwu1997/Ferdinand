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

const DEFAULT_BASE = "http://localhost:40001";

export function apiBase(): string {
    if (!browser) return DEFAULT_BASE;
    const qp = new URLSearchParams(window.location.search).get("api");
    return qp ?? (import.meta.env.VITE_ANKI_API as string | undefined) ?? DEFAULT_BASE;
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${apiBase()}${path}`, {
        headers: { accept: "application/json" },
        ...init,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
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
