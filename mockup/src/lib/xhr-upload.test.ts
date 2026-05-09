// Phase B3b: unit tests for postImportApkgWithProgress.
//
// jsdom's XMLHttpRequest implementation doesn't drive progress events
// or expose hooks for completing a request synchronously, so we
// install a minimal mock class on globalThis and let each test drive
// the lifecycle (progress → load / error / abort).
//
// Tests cover the parts of the contract that callers depend on:
//   - progress events: monotonic + clamped + lengthComputable=false fallback
//   - happy-path 2xx parse into ApiImportResult
//   - 4xx with JSON {message} body surfaces the message
//   - non-JSON 5xx body falls back to statusText
//   - 401 routes through fireOnUnauthorized via setOnUnauthorized
//   - network error rejects without leaking the underlying event
//   - AbortSignal aborts the underlying XHR

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from "vitest";
import { postImportApkgWithProgress } from "./xhr-upload";
import { setOnUnauthorized } from "./api";

class MockXhrUpload {
    public onprogress: ((e: ProgressEvent) => void) | null = null;
}

class MockXHR {
    public method = "";
    public url = "";
    public withCredentials = false;
    public responseType = "";
    public status = 0;
    public statusText = "";
    public responseText = "";
    public upload = new MockXhrUpload();
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public onabort: (() => void) | null = null;
    public sentBody: unknown = null;
    public aborted = false;

    open(method: string, url: string, _async?: boolean): void {
        this.method = method;
        this.url = url;
    }

    send(body: unknown): void {
        this.sentBody = body;
    }

    abort(): void {
        this.aborted = true;
        this.onabort?.();
    }

    // Test helpers — drive lifecycle synchronously from the test body.
    _emitProgress(loaded: number, total: number, lengthComputable = true): void {
        this.upload.onprogress?.({
            lengthComputable,
            loaded,
            total,
        } as ProgressEvent);
    }
    _emitLoad(status: number, body: string, statusText = "OK"): void {
        this.status = status;
        this.statusText = statusText;
        this.responseText = body;
        this.onload?.();
    }
    _emitError(): void {
        this.onerror?.();
    }
}

let lastXhr: MockXHR | null = null;
let originalXHR: typeof XMLHttpRequest | undefined;

beforeEach(() => {
    lastXhr = null;
    originalXHR = globalThis.XMLHttpRequest;
    // The helper does `new XMLHttpRequest()`, so we install a real
    // constructor (vi.fn() returns a Mock that isn't constructable).
    class TrackedXHR extends MockXHR {
        constructor() {
            super();
            lastXhr = this;
        }
    }
    Object.defineProperty(globalThis, "XMLHttpRequest", {
        configurable: true,
        writable: true,
        value: TrackedXHR as unknown as typeof XMLHttpRequest,
    });
});

afterEach(() => {
    Object.defineProperty(globalThis, "XMLHttpRequest", {
        configurable: true,
        writable: true,
        value: originalXHR,
    });
    setOnUnauthorized(null);
});

function makeFile(size = 1024): File {
    return new File([new Uint8Array(size)], "sample.apkg", {
        type: "application/octet-stream",
    });
}

const SUCCESS_BODY = JSON.stringify({
    imported_note_count: 3,
    updated_note_count: 0,
    skipped_count: 0,
    imported_card_count: null,
    log_summary: "imported 3 notes",
});

describe("postImportApkgWithProgress", () => {
    test("emits monotonic progress fractions during upload", async () => {
        const events: number[] = [];
        const promise = postImportApkgWithProgress(makeFile(), {
            onProgress: (p) => events.push(p.fraction),
        });
        await Promise.resolve();
        const xhr = lastXhr!;
        xhr._emitProgress(0, 1024);
        xhr._emitProgress(512, 1024);
        xhr._emitProgress(1024, 1024);
        xhr._emitLoad(200, SUCCESS_BODY);
        const res = await promise;
        expect(res.imported_note_count).toBe(3);
        expect(events).toEqual([0, 0.5, 1]);
    });

    test("clamps loaded > total and falls back to file.size when not lengthComputable", async () => {
        const events: { loaded: number; total: number; fraction: number }[] = [];
        const promise = postImportApkgWithProgress(makeFile(2048), {
            onProgress: (p) => events.push(p),
        });
        await Promise.resolve();
        const xhr = lastXhr!;
        xhr._emitProgress(99999, 2048);
        xhr._emitProgress(0, 0, false);
        xhr._emitLoad(200, SUCCESS_BODY);
        await promise;
        expect(events[0]).toEqual({ loaded: 2048, total: 2048, fraction: 1 });
        // lengthComputable=false: total falls back to the File's known size
        expect(events[1].total).toBe(2048);
    });

    test("resolves with parsed ApiImportResult on 200", async () => {
        const promise = postImportApkgWithProgress(makeFile());
        await Promise.resolve();
        lastXhr!._emitLoad(200, SUCCESS_BODY);
        const res = await promise;
        expect(res).toEqual({
            imported_note_count: 3,
            updated_note_count: 0,
            skipped_count: 0,
            imported_card_count: null,
            log_summary: "imported 3 notes",
        });
    });

    test("rejects with parsed message on 400 JSON body", async () => {
        const promise = postImportApkgWithProgress(makeFile());
        await Promise.resolve();
        lastXhr!._emitLoad(
            400,
            JSON.stringify({ message: "not a valid apkg" }),
            "Bad Request",
        );
        await expect(promise).rejects.toThrow("400 not a valid apkg");
    });

    test("rejects with statusText fallback on non-JSON 5xx body", async () => {
        const promise = postImportApkgWithProgress(makeFile());
        await Promise.resolve();
        lastXhr!._emitLoad(500, "<html>boom</html>", "Internal Server Error");
        await expect(promise).rejects.toThrow("500 Internal Server Error");
    });

    test("invokes onUnauthorized callback on 401", async () => {
        const cb = vi.fn();
        setOnUnauthorized(cb);
        const promise = postImportApkgWithProgress(makeFile());
        await Promise.resolve();
        lastXhr!._emitLoad(401, "", "Unauthorized");
        await expect(promise).rejects.toThrow("401");
        expect(cb).toHaveBeenCalledTimes(1);
    });

    test("rejects with 'network error' when xhr.onerror fires", async () => {
        const promise = postImportApkgWithProgress(makeFile());
        await Promise.resolve();
        lastXhr!._emitError();
        await expect(promise).rejects.toThrow("network error");
    });

    test("AbortSignal aborts the underlying XHR", async () => {
        const ctrl = new AbortController();
        const promise = postImportApkgWithProgress(makeFile(), {
            signal: ctrl.signal,
        });
        await Promise.resolve();
        ctrl.abort();
        await expect(promise).rejects.toThrow("upload aborted");
        expect(lastXhr!.aborted).toBe(true);
    });

    test("aborts immediately when AbortSignal is already aborted at call time", async () => {
        const ctrl = new AbortController();
        ctrl.abort();
        const promise = postImportApkgWithProgress(makeFile(), {
            signal: ctrl.signal,
        });
        // Pre-aborted path: we abort before send(); the rejection comes
        // from xhr.abort() → onabort handler.
        await expect(promise).rejects.toThrow("upload aborted");
        expect(lastXhr!.aborted).toBe(true);
    });
});
