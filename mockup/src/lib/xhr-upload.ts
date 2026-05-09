// Phase B3b: XHR-based upload helper for /api/import/apkg.
//
// fetch() does not expose the upload-progress event stream that
// XMLHttpRequest does (the Streams API is read-side only across the
// browsers we care about), so the import panel on /notes/new uses
// this wrapper to render a real progress bar instead of a spinner.
// The legacy fetch-based postImportApkg() in api.ts is kept for
// callers that don't need progress (none today, but the type and
// implementation are part of the typed-client contract).
//
// Contract parity with postImportApkg():
//   - same endpoint, multipart shape (single `file` field), credentials
//   - same 401 → fireOnUnauthorized() routing for the global session hook
//   - same error envelope parse (JSON `{message}` if available, else statusText)
//   - resolves with ApiImportResult on 2xx; rejects with Error otherwise
//
// Adds:
//   - onProgress callback fired on every xhr.upload.onprogress event
//     with monotonic { loaded, total, fraction } — total falls back to
//     file.size when the browser reports lengthComputable=false
//   - optional AbortSignal that cancels the in-flight upload
//
// Note: progress is for the upload only. The server runs rslib's
// import_apkg synchronously inside spawn_blocking AFTER the upload
// finishes, with no progress hook in B3b. UI should label the
// 0..100% range as "uploading" and switch to a "processing" indeterminate
// state once fraction hits 1 but the response hasn't arrived yet.

import { apiBase, fireOnUnauthorized, type ApiImportResult } from "./api";

export interface UploadProgress {
    loaded: number;
    total: number;
    fraction: number;
}

export interface UploadOptions {
    onProgress?: (progress: UploadProgress) => void;
    signal?: AbortSignal;
}

export function postImportApkgWithProgress(
    file: File,
    options: UploadOptions = {},
): Promise<ApiImportResult> {
    const { onProgress, signal } = options;
    const path = "/api/import/apkg";

    return new Promise<ApiImportResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const form = new FormData();
        form.append("file", file, file.name);

        xhr.open("POST", `${apiBase()}${path}`, true);
        xhr.withCredentials = true;
        xhr.responseType = "text";

        xhr.upload.onprogress = (e: ProgressEvent) => {
            if (!onProgress) return;
            // lengthComputable=false happens when a proxy strips
            // Content-Length; fall back to the file we know we sent
            // so the bar still tracks something deterministic.
            const total = e.lengthComputable ? e.total : file.size;
            const loaded = total > 0 ? Math.min(e.loaded, total) : e.loaded;
            const fraction = total > 0 ? loaded / total : 0;
            onProgress({ loaded, total, fraction });
        };

        xhr.onload = () => {
            const status = xhr.status;
            if (status >= 200 && status < 300) {
                try {
                    const body = JSON.parse(
                        xhr.responseText,
                    ) as ApiImportResult;
                    resolve(body);
                } catch (err) {
                    reject(
                        new Error(
                            `${status} response was not valid JSON: ${
                                err instanceof Error
                                    ? err.message
                                    : String(err)
                            }`,
                        ),
                    );
                }
                return;
            }
            if (status === 401) fireOnUnauthorized(path);
            let detail = xhr.statusText || `HTTP ${status}`;
            try {
                const parsed = JSON.parse(xhr.responseText) as {
                    message?: string;
                };
                if (parsed?.message) detail = parsed.message;
            } catch {
                // body wasn't JSON — fall through with statusText
            }
            reject(new Error(`${status} ${detail}`));
        };

        xhr.onerror = () => {
            reject(new Error("network error"));
        };

        xhr.onabort = () => {
            reject(new Error("upload aborted"));
        };

        if (signal) {
            if (signal.aborted) {
                xhr.abort();
                return;
            }
            signal.addEventListener("abort", () => xhr.abort(), {
                once: true,
            });
        }

        xhr.send(form);
    });
}
