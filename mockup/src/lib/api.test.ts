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
import { postAdminCreateUser, setOnUnauthorized } from "./api";

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
