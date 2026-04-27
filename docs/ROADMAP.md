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

## Status as of 2026-04-27 (post Phase 19-D)

- **Web + Server**: ~83-91% complete (post Phase 19-D, quad 1/4 shipped).
  home has 7-day forecast bar + "+ Filtered" inline form; browse editor
  renders all fields generically AND offers per-card move-to-deck via
  flattened deck dropdown; saved-search CRUD persists to collection-config;
  clippy `--all-targets --workspace -- -D warnings` is the standing
  quality gate (note: `cargo fmt --check` is NOT in the gate — 3 files
  in 18-B/C drifted; consider a hygiene mini-phase).
- **iOS**: 0% (rslib_ffi v0-v7 surface ready, 12 C ABI symbols incl.
  `tag_list_json` + cbindgen header, but no Xcode project yet —
  deferred **11 times** now; 19-D paid down 0 FFI symbols by design,
  v8 notetype-ops surface deferred to M2 Phase 21 with the Xcode
  scaffold so it gets end-to-end validated on first ship).
- **Sync**: 0%, design decision pending (see M4).
- **Overall**: ~59-73% complete depending on definition.

---

## M1 · Web Daily Driver (~6-7 quads / ~15-20h)

> **Definition of Done**: Browser fully replaces desktop Anki for
> day-to-day review, edit, and add-note flows. FSRS, media, tag, preset,
> notetype all adjustable.

| Phase quad | Scope                                                                                                                                  | Risk   | Cum. % |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| 17 ✅      | tag_list_json FFI / new_card_order toggle (+ 12-B clippy cleanup) / card flag chips / forecast bar — shipped 2026-04-27                | low    | ~52%   |
| 18 ✅      | Saved searches CRUD / Browse editor all-fields generic / Filtered deck create / Hygiene (`--all-targets` CI gate) — shipped 2026-04-27 | medium | ~58%   |
| 19 ◐       | 19-D ✅ card-level move-to-deck (LOW, shipped 2026-04-27 commit 046d410af) → 19-A template HTML edit (MED) → 19-B notetype add field (MED-HIGH, additive) → 19-C notetype remove field (HIGH, destructive). Risk-gradient ordering; FFI v8 surface for notetype ops deferred to M2 Phase 21. | high   | ~60%   |
| 20         | Card-level tag override / Burn-recovery flow / Per-card review history viewer / Bulk operations (multi-select in browse)               | medium | ~70%   |

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
| 30 quad          | Single-binary release build (anki_server + bundled mockup static) / launchd plist (macOS auto-start) / Docker image (backup) / Release script + Setup README | low    | ~99%   |
| 31 (optional)    | iOS TestFlight build / personal-dev-account sideload pipeline                                                                                              | medium | ~100%  |

🟢 **Milestone exit**: "swap machine, no manual rebuild."

---

## Ascii view

```text
M1 Web Daily Driver ━━━━━━━━━━━━━━━━━━━━ (52%→70%)
                                          │
                                          ▼
                       ┌──────────────────┴────────────┐
                       │ Switch to macOS host;         │
                       │ M1 polish can run in the      │
                       │ background (saved searches v2 etc.) │
                       └──────────────────┬────────────┘
                                          ▼
M2 iOS Read-Only ━━━━━━━━━━━━━━━ (70%→82%)
                                          │
                                          ▼
M3 iOS Full Review ━━━━━━━━━━━━━━━━━━━━ (82%→94%)
                                          │
                                          ▼
M4 Sync ━━━━━━━━━━━ (94%→97%)
                                          │
                                          ▼
M5 Production ━━━━━━━ (97%→100%)
```

---

## Parallelism

M1 and M2 swap host (Linux ↔ macOS) so there's a switching cost there.
**M2/M3/M4 can run continuously on macOS** — no forced waits between
them. M1's tail (Phase 19/20) can be deferred until after M3 if iOS
work is the priority; those quads don't block iOS.

---

## Recommended execution order

For the fastest path to "good enough for personal use":

1. **M1 Phase 17-18 quads** (next 2 sessions, ~6h Linux) — push web to
   "daily driver" state.
2. **Jump to M2 Phase 21-23 quads** (3 sessions, ~10h macOS) — unlock
   commute-time iPhone browsing.
3. **Loop back to M1 Phase 19-20** (2 sessions, ~6h Linux) — notetype
   edits + bulk ops.
4. **M3 + M4** as the main push (~6-7 sessions, ~25-30h).
5. **M5** last.

The win: each milestone exit ships a real, usable artifact. No "wait
for 100% before turning the machine on."

---

## Maintenance

This file should be updated whenever:

- A milestone definition shifts (DoD changes scope).
- A quad ships and the cumulative % moves.
- A new milestone is introduced or one is dropped.

The MemPalace KG carries a `roadmap_captured` fact pointing to this
file as the source of truth for plan state. Re-read this file before
starting any phase quad.
