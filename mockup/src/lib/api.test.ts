// WS2: unit tests for the admin create-user API wrapper.
//
// `postAdminCreateUser` is a thin shim over the shared `postJson` helper,
// so the contract worth pinning is:
//   - it POSTs to /api/admin/users with a JSON {username, password} body
//   - a 201 + JSON ApiAdminUser body is parsed and returned as-is
//   - a 4xx with the server's {message} envelope surfaces that message
//     (so the settings form can show "user 'grace' already exists" inline)
//   - a 401 fans out through fireOnUnauthorized like every other mutation
//
// We mock global.fetch directly — same approach the other api-layer
// tests take — rather than standing up a real server.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { apiBase, postAdminCreateUser, postAnswer, setOnUnauthorized } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    setOnUnauthorized(() => {});
    vi.restoreAllMocks();
});

function mockFetch(
    status: number,
    body: unknown,
    statusText = status === 201 ? "Created" : "Error",
): { calls: Array<{ url: string; init: RequestInit | undefined }> } {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
            calls.push({ url: String(input), init });
            return {
                ok: status >= 200 && status < 300,
                status,
                statusText,
                json: async () => body,
            } as Response;
        },
    ) as typeof fetch;
    return { calls };
}

describe("postAdminCreateUser", () => {
    beforeEach(() => {
        setOnUnauthorized(() => {});
    });

    test("POSTs username + password to /api/admin/users and returns the new row", async () => {
        const row = {
            id: 7,
            username: "grace",
            created_at: 1_700_000_000,
            disabled_at: null,
        };
        const { calls } = mockFetch(201, row);

        const result = await postAdminCreateUser("grace", "s3kret-pw");

        expect(result).toEqual(row);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain("/api/admin/users");
        expect(calls[0].init?.method).toBe("POST");
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({
            username: "grace",
            password: "s3kret-pw",
        });
        const headers = calls[0].init?.headers as Record<string, string>;
        expect(headers["content-type"]).toBe("application/json");
    });

    test("surfaces the server's {message} envelope on a 409 conflict", async () => {
        mockFetch(409, { status: 409, message: "user 'grace' already exists" }, "Conflict");

        await expect(postAdminCreateUser("grace", "pw")).rejects.toThrow(
            "409 user 'grace' already exists",
        );
    });

    test("surfaces the server's {message} envelope on a 400 bad request", async () => {
        mockFetch(400, { status: 400, message: "username must be 3-64 characters" });

        await expect(postAdminCreateUser("", "pw")).rejects.toThrow(
            "400 username must be 3-64 characters",
        );
    });

    test("a 401 fires the onUnauthorized hook", async () => {
        const onUnauth = vi.fn();
        setOnUnauthorized(onUnauth);
        mockFetch(401, { status: 401, message: "not authenticated" }, "Unauthorized");

        await expect(postAdminCreateUser("grace", "pw")).rejects.toThrow();
        expect(onUnauth).toHaveBeenCalledTimes(1);
    });
});

// #3 SSRF guard — apiBase ?api= override validation
// jsdom is configured with url "http://localhost:40001/" in vitest.config.ts
// so window.location.origin === "http://localhost:40001" throughout.

describe("apiBase — SSRF guard (#3)", () => {
    // Capture the real search so we can restore it between cases.
    // jsdom's window.location.search is not directly writable, but
    // we can drive it by navigating (jsdom allows history.pushState).
    function setSearch(search: string) {
        const url = new URL(window.location.href);
        url.search = search;
        window.history.pushState({}, "", url.toString());
    }

    afterEach(() => {
        // Reset to the bare origin so later tests start clean.
        window.history.pushState({}, "", "http://localhost:40001/");
    });

    test("returns window.location.origin when no ?api= override", () => {
        // No ?api= param → guard is skipped; falls through to origin fallback.
        expect(apiBase()).toBe(window.location.origin);
    });

    test("accepts a same-origin override", () => {
        setSearch("?api=http://localhost:40001");
        expect(apiBase()).toBe("http://localhost:40001");
    });

    test("REJECTS an evil.com override", () => {
        setSearch("?api=https://evil.com");
        expect(apiBase()).toBe("");
    });

    test("REJECTS a protocol-relative //evil.com override", () => {
        setSearch("?api=//evil.com");
        expect(apiBase()).toBe("");
    });

    test("REJECTS a javascript: scheme override", () => {
        setSearch("?api=javascript:alert(1)");
        expect(apiBase()).toBe("");
    });
});

// #9 postAnswer — must route through postJson / fireOnUnauthorized

describe("postAnswer — fireOnUnauthorized (#9)", () => {
    afterEach(() => {
        globalThis.fetch = originalFetch;
        setOnUnauthorized(() => {});
        vi.restoreAllMocks();
    });

    test("postAnswer triggers fireOnUnauthorized on 401", async () => {
        const onUnauth = vi.fn();
        setOnUnauthorized(onUnauth);

        globalThis.fetch = vi.fn(async () => ({
            ok: false,
            status: 401,
            statusText: "Unauthorized",
            json: async () => ({}),
        } as Response)) as typeof fetch;

        await expect(
            postAnswer({ card_id: 1, deck_id: 1, rating: "good" }),
        ).rejects.toThrow();
        expect(onUnauth).toHaveBeenCalledOnce();
    });

    test("postAnswer parses error envelope on 400", async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: false,
            status: 400,
            statusText: "Bad Request",
            json: async () => ({ message: "card not in queue" }),
        } as Response)) as typeof fetch;

        await expect(
            postAnswer({ card_id: 999, deck_id: 1, rating: "again" }),
        ).rejects.toThrow("card not in queue");
    });
});
