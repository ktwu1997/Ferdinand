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
        <Caption>the.cabinet</Caption>
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
                        <span>{phase.message}</span>
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
        margin: 0 0 var(--space-4);
        padding: var(--space-5) var(--space-6);
        border: var(--border-w-thin) dashed var(--rule);
        background: var(--bg-soft);
        border-radius: var(--radius-md);
        position: relative;
    }
    .ipx-toggle {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        width: 100%;
        background: transparent;
        border: 0;
        padding: 0;
        text-align: left;
        color: var(--ink);
        cursor: pointer;
    }
    .ipx-toggle-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--space-3);
    }
    .ipx-toggle-title {
        font-size: 1.05rem;
        font-weight: 500;
        letter-spacing: 0.01em;
    }
    .ipx-toggle-caret {
        font-size: 0.9rem;
        color: var(--ink-mute);
    }
    .ipx-toggle-hint {
        font-size: 0.78rem;
        color: var(--ink-mute);
    }
    .ipx-body {
        margin-top: var(--space-5);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }
    .ipx-drop {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-3);
        width: 100%;
        padding: var(--space-6) var(--space-5);
        background: var(--paper);
        border: var(--border-w) dashed var(--rule);
        border-radius: var(--radius-md);
        cursor: pointer;
        color: var(--ink);
        transition: background 120ms ease-out, border-color 120ms ease-out;
    }
    .ipx-drop:hover {
        background: var(--bg-soft);
    }
    .ipx-drop-over {
        background: var(--bg-soft);
        border-color: var(--accent);
    }
    .ipx-drop-title {
        font-size: 0.92rem;
        font-weight: 500;
    }
    .ipx-drop-hint {
        font-size: 0.78rem;
        color: var(--ink-mute);
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
        gap: var(--space-2);
    }
    .ipx-progress-row {
        display: flex;
        justify-content: space-between;
        font-size: 0.8rem;
        color: var(--ink);
    }
    .ipx-progress-track {
        height: 6px;
        background: var(--bg-soft);
        border: 1px solid var(--rule);
        border-radius: var(--radius);
        overflow: hidden;
    }
    .ipx-progress-bar {
        height: 100%;
        background: var(--accent);
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
        padding: var(--space-4) var(--space-4);
        background: var(--paper);
        border: 1px solid var(--rule);
        border-left: 3px solid var(--accent);
        border-radius: var(--radius);
        font-size: 0.84rem;
    }
    .ipx-toast-sub {
        font-size: 0.74rem;
        color: var(--ink-mute);
        margin: 0;
    }
    .ipx-error {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--space-3);
        padding: var(--space-3) var(--space-4);
        font-size: 0.8rem;
        color: var(--due);
        background: color-mix(in oklch, var(--due) 8%, transparent);
        border: 1px solid color-mix(in oklch, var(--due) 32%, transparent);
        border-radius: var(--radius);
    }
    .ipx-error-dismiss {
        background: transparent;
        border: 0;
        cursor: pointer;
        font-size: 0.74rem;
        color: var(--due);
        text-decoration: underline;
    }
    @media (max-width: 720px) {
        .ipx-toggle-title {
            font-size: 1rem;
        }
        .ipx-drop {
            padding: var(--space-5);
        }
    }
</style>
