# Ferdinand Roadmap

> Ferdinand-specific milestone roadmap for the personal fork direction
> (`is_personal_fork_of Anki`, `backend Rust_axum`, `web SvelteKit`,
> `ios_strategy native_SwiftUI_with_rslib_staticlib_offline_plus_sync`,
> `drops Python_aqt_addons_Qt_launcher`).
>
> **Captured**: 2026-04-27 (post-Phase 16 quad, main 115 ahead origin).
> **Convention**: each "quad" is 4 file-disjoint phases shipped sequential
> single-context (the validated `orchestrate` pattern, 8 quads in a row
> through Phase 16). Estimates assume daily-driver pace (~1.5-2h per
> phase). Numbers are guidance, not contracts — adjust as scope lands.

---

## 🟢 WEB-LAUNCH MILESTONE REACHED — 2026-04-28

`kt`'s daily driver is online via single-binary `target/release-lto/anki_server`
(17 MB, embedded SvelteKit mockup) plus three install paths shipped in
Phase 30 quad: macOS launchd plist, Docker compose, fresh-machine bootstrap
script. M1 + M5 closed in 2 sessions over 2 days; only macOS-side M2/M3
(iOS) and M4 (sync) remain.

---

## Status as of 2026-04-28 (post Phase 30 quad — M5 shipped, web-launch reached)

- **Web + Server**: ✅ ~98% complete (M1 closed Phase 20 + 4-way parallel
  M5 Phase 30 just shipped). All daily-driver flows in place (review,
  edit, add-note, tag, deck-config, FSRS, bulk ops, history, burn-recovery,
  saved-search, notetype rename + field add/remove). Standing gate: clippy
  -D warnings, fmt --check, 128 anki_server tests, 198 vitest, 0
  svelte-check errors.
- **Distribution**: ✅ M5 Phase 30 shipped 2026-04-28 — single-binary
  release (`build/release.sh` → `target/release-lto/anki_server` w/
  embedded mockup via `include_dir!` + `embed-mockup` feature; 17 MB,
  release-lto + strip + codegen-units=1), launchd plist + install/uninstall
  scripts (`launchd/com.ktwu.ferdinand.plist`), Docker multi-stage image +
  compose (Dockerfile + docker-compose.yml + .dockerignore), top-level
  Ferdinand-fork README + `docs/SETUP.md` + `scripts/bootstrap.sh`
  fresh-machine bootstrap.
- **iOS**: 0% (rslib_ffi v0-v7 surface ready, 12 C ABI symbols incl.
  `tag_list_json` + cbindgen header, but no Xcode project yet —
  deferred **11 times** now; 19-A/B/C/D paid down 0 FFI symbols by
  design, v8 notetype-ops surface deferred to M2 Phase 21 with the
  Xcode scaffold so it gets end-to-end validated on first ship).
- **Sync**: 0%, design decision pending (see M4).
- **Overall**: ~78% complete (M1 + M5 shipped; M2/M3/M4 outstanding).

---

## M1 · Web Daily Driver (~6-7 quads / ~15-20h)

> **Definition of Done**: Browser fully replaces desktop Anki for
> day-to-day review, edit, and add-note flows. FSRS, media, tag, preset,
> notetype all adjustable.

| Phase quad | Scope                                                                                                                                  | Risk   | Cum. % |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| 17 ✅      | tag_list_json FFI / new_card_order toggle (+ 12-B clippy cleanup) / card flag chips / forecast bar — shipped 2026-04-27                | low    | ~52%   |
| 18 ✅      | Saved searches CRUD / Browse editor all-fields generic / Filtered deck create / Hygiene (`--all-targets` CI gate) — shipped 2026-04-27 | medium | ~58%   |
| 19 ✅      | Card-level move-to-deck (19-D LOW) / Template HTML edit (19-A MED) / Notetype add field (19-B MED-HIGH, additive) / Notetype remove field (19-C HIGH, destructive). Risk-gradient ordering proven; FFI v8 surface for notetype ops deferred to M2 Phase 21. Shipped 2026-04-27 commit 21ec7d654. | high   | ~64%   |
| 20 ✅      | Quad shipped via 2-wave parallel orchestration. Wave 1 (2026-04-27): 20-D Per-card review history viewer (LOW, read-only, commits 260803815 + 4e7ba4ee3) + 20-C Burn-recovery single-card `reset_to_new` (MED-HIGH, destructive, commits 65c499bec + 1d5ace64e). Hygiene mini-phase folded in: `cargo fmt --check` now part of standing gate. Wave 2 (2026-04-28): 20-A Card-level tag override on study review pane (LOW, optimistic patchNote, commits 81c24548a + a7b40cb87) + 20-B Bulk operations multi-select on browse with `bulk_suspend` / `bulk_flag` endpoints (MED, idempotent, commit 6eb48d9ee). Quad pattern proven: 4 file-disjoint phases shipped via 2× 2-way parallel Agent worktree dispatch, ~3.5h Wave 1 + ~1.5h Wave 2 wall. | medium | ~70%   |

🟢 **Milestone exit**: web is `kt`'s daily driver, desktop Anki retired.

---

## M2 · iOS Read-Only Viewer (~3 quads / ~10h on macOS)

> **Definition of Done**: iPhone/iPad shows deck list, note content, card
> scheduling state offline. No review, no edit. Commute browsing.
>
> **Prerequisite**: switch to macOS host (this Linux dev container can't
> run xcodebuild).

| Phase quad | Scope                                                                                                                                                  | Risk                            | Cum. % |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ------ |
| 21         | Xcode project scaffold + staticlib link / SwiftUI App entry + ContentView / `ferdinand_version` smoke / `ferdinand_collection_open/close` lifecycle    | medium (initial Xcode setup)    | ~74%   |
| 22         | DeckList view (list_decks_json) / DeckDetail (deck_tree_json + due counts) / TopBar stats (collection_stats_json) / NoteRow (note_get_json)            | low                             | ~78%   |
| 23         | CardDetail (card_get_json scheduling state) / TagPicker (tag_list_json) / Browse-style search list / Settings read-only mirror                         | low                             | ~82%   |

🟡 **Milestone exit**: iPhone shows deck/note/card content; collection
file shared via AirDrop/iCloud while sync is still M4 pending.

---

## M3 · iOS Full Review (~4 quads / ~15-20h) — hardest segment

> **Definition of Done**: iPhone supports full review (Again/Hard/Good/
> Easy), scheduling persists to collection.anki2, card render matches
> web (template + media + sound).

Anki's card render pipeline lives inline in rslib + axum on the web
side; iOS needs the staticlib to expose template-rendered HTML and
media path lists. New FFI surface required.

| Phase quad | Scope                                                                                                                                                                  | Risk      | Cum. % |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------ |
| 24         | FFI v8: `_card_render_html(handle, cid, side)` returns rendered HTML + media path list / Memory-model docs hardening                                                   | very high | ~85%   |
| 25         | SwiftUI WebView card render harness / `[sound:]` AVPlayer wiring / Image cache from .media/ / Shadow-DOM CSS injection (mirror web Phase 7-C)                          | high      | ~88%   |
| 26         | FFI v9: `_card_answer(handle, cid, rating)` via `next_card_state` + revlog write / Queue management (`_study_queue_next`) / Answer animation                           | high      | ~91%   |
| 27         | Add Note iOS / Browse edit parity / Settings write parity (FSRS slider, preset switch)                                                                                 | medium    | ~94%   |

🟢 **Milestone exit**: iPhone is a true second review device.

---

## M4 · Sync (~2-3 quads / ~10-15h)

> **Definition of Done**: changes from web and iOS are visible to each
> other. Specific mechanism depends on the design decision below.

### Pre-decision required (Phase 28a — no code, design only)

| Option | Effort   | Best for                                                                              |
| ------ | -------- | ------------------------------------------------------------------------------------- |
| A      | ~3 quads | AnkiWeb sync protocol (reuse rslib `sync/` module); compatibility with the ecosystem  |
| B      | ~1 quad  | LAN/Tailscale file sync (collection.anki2 SFTP transfer + lock coordination); minimal |
| C      | ~2 quads | Self-hosted simple sync server with collection diff endpoint; full control            |

### Default plan: Option B (smallest ops surface, single-user reality)

| Phase           | Scope                                                                                                                                              | Risk   | Cum. % |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| 28 (single)     | Sync design decision + spec doc / Lock-file coordination protocol                                                                                  | n/a    | —      |
| 29 quad         | SFTP/Tailscale collection push script / iOS "pull from Mac" button + WebDAV or file picker / Lock file (`.locked`) for concurrent-write guard / mtime-based conflict resolver | medium | ~97%   |

(Option A adds +2 quads; Option C adds +1 quad.)

🟢 **Milestone exit**: multi-device edits don't clobber each other.

---

## M5 · Production / Distribution (~1-2 quads / ~5-8h)

> **Definition of Done**: after a clean reinstall / device swap, the full
> stack is back up in under an hour by following the README.

| Phase            | Scope                                                                                                                                                      | Risk   | Cum. % |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| 30 quad ✅       | Shipped 2026-04-28 via 4-way parallel orchestrate (one message, 4 isolated worktrees, file-disjoint). 30-A single-binary release (commit `94cae04c1`, `build/release.sh` → 17 MB binary at `target/release-lto/` w/ embedded mockup via `include_dir!` + `embed-mockup` feature, 128 tests pass) + 30-B launchd plist (commit `a5a7d5742`, `launchd/com.ktwu.ferdinand.plist` + install/uninstall + README, xmllint clean) + 30-C Docker (commit `10542b539`, 3-stage Dockerfile + compose + dockerignore, runtime structurally lint-reviewed since docker not in dev container) + 30-D setup docs (commit `50107135f`, README rewrite + `docs/SETUP.md` + `scripts/bootstrap.sh`, shellcheck clean). Live cold-boot smoke confirmed binary serves embedded `index.html` after `mockup/build/` moved aside; 206 cards baseline + "森林" 201-result query intact. PROTOC auto-detect added post-smoke for fresh-machine ergonomics. | low    | ~99%   |
| 31 (optional)    | iOS TestFlight build / personal-dev-account sideload pipeline                                                                                              | medium | ~100%  |

🟢 **Milestone exit reached 2026-04-28**: single-binary `anki_server` + 3 install paths; "swap machine, no manual rebuild" proven.

---

## Ascii view

```text
M1 Web Daily Driver ✅ ━━━━━━━━━━━━━━━━━━━ (52%→70%, Phase 20 shipped 2026-04-28)
                                          │
                                          ▼
M5 Production ✅ ━━━━━━━ (Phase 30 shipped 2026-04-28, 4-way parallel)
                                          │
                                          ▼
              🟢 WEB-LAUNCH MILESTONE REACHED 2026-04-28
                                          │
                                          ▼
                       ┌──────────────────┴────────────┐
                       │ Switch to macOS host (NEXT)   │
                       └──────────────────┬────────────┘
                                          ▼
M2 iOS Read-Only ━━━━━━━━━━━━━━━ (70%→82%)
                                          │
                                          ▼
M3 iOS Full Review ━━━━━━━━━━━━━━━━━━━━ (82%→94%)
                                          │
                                          ▼
M4 Sync ━━━━━━━━━━━ (94%→97%)
```

---

## Parallelism

M1 and M2 swap host (Linux ↔ macOS) so there's a switching cost there.
**M2/M3/M4 can run continuously on macOS** — no forced waits between
them. M1's tail (Phase 19/20) can be deferred until after M3 if iOS
work is the priority; those quads don't block iOS.

---

## First-deliverable milestone target (locked 2026-04-27)

**Goal**: web 版正式上線 — kt 本人能在乾淨環境（重灌 / 換機）一小時
內把整套服務拉起來當 daily driver 用，不靠手動 cargo build / npm
build / SQLite 路徑接管。

**Target = M1 完整 + M5 Phase 30**：
- M1 Phase 20 quad（4 phases，~6h）— 補完 daily-driver UX 缺口
- M5 Phase 30 quad（~5-8h）— single-binary release build + launchd /
  Docker / setup README

**Estimated wall**: 11-14h（2-3 個 session）。Phase 17/18/19 的 quad
節奏已經穩，Phase 20 應該在 1 個 session 內封盤；M5 因為涉及 build
pipeline + 跨平台 plist，預期 1.5-2 個 session。

**M2/M3/M4 順延**：iOS 解鎖（M2）、iOS full review（M3）、sync（M4）
都晚於 web-launch 目標。第 11 次 deferral 的 FFI v8 surface 也跟著
往後挪。

---

## Recommended execution order (revised post-19, milestone-locked)

For the **web-launch-first** path:

1. **M1 Phase 20 quad** ✅ shipped 2026-04-27/28 (2 sessions × 2-way
   parallel orchestration, ~5h wall total). All four phases merged:
   20-D + 20-C (Wave 1) + 20-A + 20-B (Wave 2). Closed M1 DoD.
2. **M5 Phase 30 quad** ✅ shipped 2026-04-28 (1 session, true 4-way
   parallel orchestrate via 4 isolated worktrees in one message; ~3h
   wall — agents ~30min concurrent + main session merge + smoke). 30-A
   single-binary release + 30-B launchd plist + 30-C Docker image +
   30-D setup README & bootstrap. Cherry-pick recovery used because 3
   of 4 worktree branches diverged from upstream Anki commits not
   Ferdinand main; 30-A pre-rebased correctly. Live cold-boot smoke
   confirmed embedded asset serve. 🟢 **Web-launch milestone reached.**
3. **M2 Phase 21-23 quads** (3 sessions, ~10h macOS) — iOS read-only
   viewer. **NEXT: Phase 21 starts M2; requires switch to macOS host
   (xcodebuild not available in Linux dev container).**
4. **M3 + M4** (~6-7 sessions, ~25-30h) — iOS full review + sync.

Web-launch shipped a real, usable artifact in 2 days × 3-4h sessions.
iOS work is host-gated but not blocked — M5 didn't pay down any FFI
surface, so M2 Phase 21 still has the v8 notetype-ops surface to add
alongside the Xcode scaffold.

---

## Maintenance

This file should be updated whenever:

- A milestone definition shifts (DoD changes scope).
- A quad ships and the cumulative % moves.
- A new milestone is introduced or one is dropped.

The MemPalace KG carries a `roadmap_captured` fact pointing to this
file as the source of truth for plan state. Re-read this file before
starting any phase quad.
