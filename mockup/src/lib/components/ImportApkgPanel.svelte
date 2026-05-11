<script lang="ts">
    // Phase B3b: collapsible <ImportApkgPanel/> for /notes/new.
    //
    // Consumer flow:
    //   1. user expands the panel ("import .apkg" toggle)
    //   2. picks a file (drag-drop OR tap → native file picker)
    //   3. we POST it through xhr-upload's progress-aware wrapper
    //   4. progress bar tracks 0..100% during upload
    //   5. when fraction hits 1 we switch to an indeterminate
    //      "processing…" bar — the server runs rslib's import_apkg
    //      synchronously after the upload finishes and has no progress
    //      hook in B3b, so the UI explicitly differentiates the two
    //      states instead of pretending to know
    //   6. on 2xx we show a success toast and (by default) goto /browse
    //      after a 1.5s grace so the toast is readable
    //   7. on error we show an inline banner with a dismiss action
    //
    // Sketch-skin styling reuses the .tx-pw-form / drop-zone idioms from
    // /notes/new and /settings: dashed borders, kraft-paper surface tones,
    // mono labels, accent-line highlight on success. All tokens fall
    // back to literal colours when --surface-*, --text-*, --skin-edge,
    // --accent aren't defined so the panel still renders sensibly in
    // the test runner's headless env.

    import { goto } from "$app/navigation";
    import { Caption } from "$lib/components/ui";
    import { SketchPlus } from "$lib/components/sketch";
    import {
        postImportApkgWithProgress,
        type UploadProgress,
    } from "$lib/xhr-upload";
    import type { ApiImportResult } from "$lib/api";

    type Props = {
        // Set false in tests / embedded contexts to keep the success
        // toast on screen instead of navigating away.
        redirectOnDone?: boolean;
    };
    let { redirectOnDone = true }: Props = $props();

    type Phase =
        | { kind: "idle" }
        | { kind: "uploading"; fraction: number; fileName: string }
        | { kind: "processing"; fileName: string }
        | { kind: "done"; result: ApiImportResult }
        | { kind: "error"; message: string };

    let open = $state(false);
    let phase: Phase = $state({ kind: "idle" });
    let dragOver = $state(false);
    let fileInput: HTMLInputElement | null = $state(null);

    const ACCEPT = ".apkg";

    function toggleOpen(): void {
        open = !open;
        // Collapsing dismisses an error so re-opening is a clean slate.
        if (!open && phase.kind === "error") {
            phase = { kind: "idle" };
        }
    }

    async function handleFile(file: File): Promise<void> {
        if (phase.kind === "uploading" || phase.kind === "processing") return;
        phase = { kind: "uploading", fraction: 0, fileName: file.name };
        try {
            const result = await postImportApkgWithProgress(file, {
                onProgress: ({ fraction }: UploadProgress) => {
                    if (phase.kind !== "uploading") return;
                    if (fraction >= 1) {
                        phase = { kind: "processing", fileName: phase.fileName };
                    } else {
                        phase = { ...phase, fraction };
                    }
                },
            });
            phase = { kind: "done", result };
            if (redirectOnDone) {
                setTimeout(() => {
                    void goto("/browse");
                }, 1500);
            }
        } catch (err) {
            phase = {
                kind: "error",
                message: err instanceof Error ? err.message : String(err),
            };
        } finally {
            // Reset the input so re-selecting the same file after an
            // error still fires onchange.
            if (fileInput) fileInput.value = "";
        }
    }

    function onFileChange(e: Event): void {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (file) void handleFile(file);
    }

    function onDragOver(e: DragEvent): void {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        dragOver = true;
    }

    function onDragLeave(): void {
        dragOver = false;
    }

    function onDrop(e: DragEvent): void {
        e.preventDefault();
        dragOver = false;
        const file = e.dataTransfer?.files?.[0];
        if (file) void handleFile(file);
    }

    function pickFile(): void {
        fileInput?.click();
    }

    function dismissError(): void {
        phase = { kind: "idle" };
    }

    // For the {phase.result.imported_note_count === 1 ? "" : "s"}
    // singular/plural switch we want to keep the template terse.
    function plural(n: number): string {
        return n === 1 ? "" : "s";
    }
</script>

<section
    class="ipx-panel"
    class:ipx-open={open}
    data-testid="import-apkg-panel"
>
    <button
        type="button"
        class="ipx-toggle mono"
        onclick={toggleOpen}
        data-testid="import-apkg-toggle"
        aria-expanded={open}
    >
        <Caption>// the.cabinet</Caption>
        <span class="ipx-toggle-row">
            <span class="ipx-toggle-title">import .apkg</span>
            <span class="ipx-toggle-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        </span>
        <span class="ipx-toggle-hint mono">
            bring a deck across from the desktop app
        </span>
    </button>

    {#if open}
        <div class="ipx-body" data-testid="import-apkg-body">
            {#if phase.kind === "idle" || phase.kind === "error"}
                <button
                    type="button"
                    class="ipx-drop"
                    class:ipx-drop-over={dragOver}
                    ondragover={onDragOver}
                    ondragleave={onDragLeave}
                    ondrop={onDrop}
                    onclick={pickFile}
                    data-testid="import-apkg-drop"
                >
                    <SketchPlus size={14} />
                    <span class="ipx-drop-title mono">drop .apkg or tap to choose</span>
                    <span class="ipx-drop-hint mono">
                        we'll import it into your collection
                    </span>
                </button>
                <input
                    bind:this={fileInput}
                    type="file"
                    accept={ACCEPT}
                    class="ipx-file-input"
                    onchange={onFileChange}
                    data-testid="import-apkg-file-input"
                />
                {#if phase.kind === "error"}
                    <div
                        class="ipx-error mono"
                        role="alert"
                        data-testid="import-apkg-error"
                    >
                        <span>// {phase.message}</span>
                        <button
                            type="button"
                            class="ipx-error-dismiss mono"
                            onclick={dismissError}
                            data-testid="import-apkg-error-dismiss"
                        >
                            dismiss
                        </button>
                    </div>
                {/if}
            {:else if phase.kind === "uploading"}
                <div
                    class="ipx-progress"
                    data-testid="import-apkg-progress"
                    data-phase="uploading"
                >
                    <div class="ipx-progress-row mono">
                        <span class="ipx-progress-label">
                            uploading {phase.fileName}…
                        </span>
                        <span
                            class="ipx-progress-pct"
                            data-testid="import-apkg-progress-pct"
                        >
                            {Math.round(phase.fraction * 100)}%
                        </span>
                    </div>
                    <div class="ipx-progress-track" aria-hidden="true">
                        <div
                            class="ipx-progress-bar"
                            style="width: {Math.min(
                                100,
                                Math.max(0, phase.fraction * 100),
                            )}%"
                        ></div>
                    </div>
                </div>
            {:else if phase.kind === "processing"}
                <div
                    class="ipx-progress"
                    data-testid="import-apkg-progress"
                    data-phase="processing"
                >
                    <div class="ipx-progress-row mono">
                        <span class="ipx-progress-label">
                            processing {phase.fileName}…
                        </span>
                        <span class="ipx-progress-pct">100%</span>
                    </div>
                    <div class="ipx-progress-track" aria-hidden="true">
                        <div class="ipx-progress-bar ipx-progress-bar-indet"></div>
                    </div>
                </div>
            {:else if phase.kind === "done"}
                <div
                    class="ipx-toast mono"
                    role="status"
                    data-testid="import-apkg-success"
                >
                    // imported {phase.result.imported_note_count} note{plural(
                        phase.result.imported_note_count,
                    )}
                    {#if phase.result.updated_note_count > 0}
                        — updated {phase.result.updated_note_count}
                    {/if}
                    {#if phase.result.skipped_count > 0}
                        — skipped {phase.result.skipped_count}
                    {/if}
                </div>
                {#if redirectOnDone}
                    <p
                        class="ipx-toast-sub mono"
                        data-testid="import-apkg-redirect-hint"
                    >
                        // jumping to /browse…
                    </p>
                {/if}
            {/if}
        </div>
    {/if}
</section>

<style>
    .ipx-panel {
        margin: 0 0 var(--space-4, 1rem);
        padding: 0.75rem 1rem;
        border: 1px dashed var(--skin-edge, #d6cdba);
        background: var(--surface-soft, rgba(255, 250, 240, 0.55));
        border-radius: 6px;
        position: relative;
    }
    .ipx-toggle {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        width: 100%;
        background: transparent;
        border: 0;
        padding: 0;
        text-align: left;
        color: var(--text-strong, #2b2218);
        cursor: pointer;
    }
    .ipx-toggle-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem;
    }
    .ipx-toggle-title {
        font-size: 1.05rem;
        font-weight: 500;
        letter-spacing: 0.01em;
    }
    .ipx-toggle-caret {
        font-size: 0.9rem;
        color: var(--text-muted, #7a6c52);
    }
    .ipx-toggle-hint {
        font-size: 0.78rem;
        color: var(--text-muted, #7a6c52);
    }
    .ipx-body {
        margin-top: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    .ipx-drop {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.4rem;
        width: 100%;
        padding: 1rem 0.75rem;
        background: var(--surface-base, #fbf6ec);
        border: 1.5px dashed var(--skin-edge, #d6cdba);
        border-radius: 6px;
        cursor: pointer;
        color: var(--text-strong, #2b2218);
        transition: background 120ms ease-out, border-color 120ms ease-out;
    }
    .ipx-drop:hover {
        background: var(--surface-hover, #f5edd9);
    }
    .ipx-drop-over {
        background: var(--surface-hover, #f5edd9);
        border-color: var(--accent, #b07b3f);
    }
    .ipx-drop-title {
        font-size: 0.92rem;
        font-weight: 500;
    }
    .ipx-drop-hint {
        font-size: 0.78rem;
        color: var(--text-muted, #7a6c52);
    }
    .ipx-file-input {
        position: absolute;
        left: -9999px;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
    }
    .ipx-progress {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }
    .ipx-progress-row {
        display: flex;
        justify-content: space-between;
        font-size: 0.8rem;
        color: var(--text-strong, #2b2218);
    }
    .ipx-progress-track {
        height: 6px;
        background: var(--surface-hover, #f5edd9);
        border: 1px solid var(--skin-edge, #d6cdba);
        border-radius: 3px;
        overflow: hidden;
    }
    .ipx-progress-bar {
        height: 100%;
        background: var(--accent, #b07b3f);
        transition: width 100ms linear;
    }
    .ipx-progress-bar-indet {
        width: 100%;
        opacity: 0.6;
        animation: ipx-pulse 1.4s ease-in-out infinite;
    }
    @keyframes ipx-pulse {
        0%,
        100% {
            opacity: 0.35;
        }
        50% {
            opacity: 0.85;
        }
    }
    .ipx-toast {
        padding: 0.5rem 0.6rem;
        background: var(--surface-base, #fbf6ec);
        border: 1px solid var(--skin-edge, #d6cdba);
        border-left: 3px solid var(--accent, #b07b3f);
        border-radius: 3px;
        font-size: 0.84rem;
    }
    .ipx-toast-sub {
        font-size: 0.74rem;
        color: var(--text-muted, #7a6c52);
        margin: 0;
    }
    .ipx-error {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.4rem 0.55rem;
        font-size: 0.8rem;
        color: #8a3a1d;
        background: #fbe9de;
        border: 1px solid #d99a82;
        border-radius: 3px;
    }
    .ipx-error-dismiss {
        background: transparent;
        border: 0;
        cursor: pointer;
        font-size: 0.74rem;
        color: #8a3a1d;
        text-decoration: underline;
    }
    @media (max-width: 720px) {
        .ipx-toggle-title {
            font-size: 1rem;
        }
        .ipx-drop {
            padding: 0.75rem;
        }
    }
</style>
