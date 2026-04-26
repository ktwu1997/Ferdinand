//! C ABI bridge from rslib to native Ferdinand clients.
//!
//! v0 surface (Phase 10-D'): `ferdinand_version()` — crate version string.
//! v1 surface (Phase 11-D): opaque `FerdinandCollection` handle with
//! `_open`, `_close`, and `_deck_count` for read-only collection access.
//! v2 surface (Phase 12-D): `_list_decks_json` returns owned heap JSON
//! that the caller MUST release via `ferdinand_free_string`.
//! v3 surface (Phase 13-D): `_deck_tree_json` returns the same deck list
//! as v2 plus today's due counts (new/learn/review) and `level` so
//! native callers can render the desktop-style sidebar without a second
//! API call. Returned JSON is a flat depth-first array — clients that
//! need a tree can re-nest by `level` if desired, but the flat shape is
//! cheaper for SwiftUI `List` rendering.
//! v4 surface (Phase 14-D): `_note_count` mirrors `_deck_count` for the
//! note table, and `_collection_stats_json` returns a single object with
//! `{note_count, card_count, deck_count, revlog_count}` so a top-bar
//! summary like "12 decks · 206 cards · 38 notes" can hydrate from one
//! FFI call instead of a fan-out of four.
//!
//! ## Memory model
//!
//! - `ferdinand_version()`: pointer to a 'static NUL-terminated buffer
//!   baked into the artifact. Callers must NOT free; valid for the
//!   library's lifetime.
//! - `FerdinandCollection`: opaque pointer returned by
//!   `ferdinand_collection_open()`, freed by
//!   `ferdinand_collection_close()`. Callers MUST close exactly once;
//!   leaking it leaks the underlying SQLite connection.
//! - Heap C strings returned by `ferdinand_list_decks_json` (and any
//!   future `*_json` functions): owned by the caller. Release with
//!   `ferdinand_free_string` exactly once. Mixing this with
//!   `ferdinand_version()`'s 'static pointer would double-free / segfault
//!   — always pair the producer with its documented free function.
//!
//! ## Threading
//!
//! `FerdinandCollection` is single-threaded. The wrapped `anki::Collection`
//! owns a `rusqlite::Connection` which is `!Send` + `!Sync` by design;
//! concurrent access from two threads is undefined behaviour. Clients
//! that need parallelism MUST open one collection per thread, or
//! serialise access with their own mutex.

use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::path::PathBuf;
use std::ptr;
use std::sync::OnceLock;

use anki::collection::{Collection, CollectionBuilder};
use anki::timestamp::TimestampSecs;
use serde::Serialize;

/// Return a pointer to a NUL-terminated UTF-8 string with this crate's
/// semantic version. The buffer is owned by the library — do not free.
///
/// # Safety
/// The returned pointer is valid for the lifetime of the loaded library
/// and is read-only. Reading past the NUL terminator is undefined
/// behaviour.
#[no_mangle]
pub extern "C" fn ferdinand_version() -> *const c_char {
    static CACHED: OnceLock<CString> = OnceLock::new();
    CACHED
        .get_or_init(|| {
            CString::new(env!("CARGO_PKG_VERSION"))
                .expect("CARGO_PKG_VERSION never contains an interior NUL")
        })
        .as_ptr()
}

/// Opaque handle to an open Anki collection. Callers treat this as a
/// pointer-only type — the size and field layout are intentionally
/// unspecified across versions.
pub struct FerdinandCollection {
    inner: Collection,
}

/// Open the Anki collection at `path` (UTF-8, NUL-terminated). Returns
/// an opaque pointer on success, or NULL on failure (NULL or non-UTF-8
/// `path`, schema mismatch, locked database, unreadable parent dir, …).
///
/// Note: matching `CollectionBuilder` semantics, a missing file at a
/// writable path is NOT an error — a fresh empty collection is created
/// in place. Pass a path you have actually verified exists if you want
/// strict open-only behaviour.
///
/// Ownership: the returned pointer must be freed via
/// [`ferdinand_collection_close`]; otherwise the SQLite handle leaks for
/// the lifetime of the process.
///
/// # Safety
/// - `path` must point to a NUL-terminated C string valid for the
///   duration of this call, or be NULL.
/// - The returned pointer must NOT be shared between threads — see
///   crate-level threading docs.
#[no_mangle]
pub unsafe extern "C" fn ferdinand_collection_open(
    path: *const c_char,
) -> *mut FerdinandCollection {
    if path.is_null() {
        return ptr::null_mut();
    }
    // SAFETY: caller contract — `path` points to a NUL-terminated UTF-8
    // C string valid for the duration of this call.
    let cstr = unsafe { CStr::from_ptr(path) };
    let path_str = match cstr.to_str() {
        Ok(s) => s,
        Err(_) => return ptr::null_mut(),
    };
    let inner = match CollectionBuilder::new(PathBuf::from(path_str)).build() {
        Ok(c) => c,
        Err(_) => return ptr::null_mut(),
    };
    Box::into_raw(Box::new(FerdinandCollection { inner }))
}

/// Close a collection previously opened via [`ferdinand_collection_open`]
/// and release its resources. Idempotent under NULL — passing NULL is a
/// no-op so clients can defensively close after a failed open without
/// branching.
///
/// # Safety
/// - `handle` must be either NULL or a pointer that was returned by
///   [`ferdinand_collection_open`] and has not yet been passed to this
///   function.
/// - After this call returns, `handle` is dangling and must not be used.
#[no_mangle]
pub unsafe extern "C" fn ferdinand_collection_close(handle: *mut FerdinandCollection) {
    if handle.is_null() {
        return;
    }
    // SAFETY: caller contract — `handle` was produced by Box::into_raw in
    // ferdinand_collection_open and has not been freed.
    drop(unsafe { Box::from_raw(handle) });
}

/// Return the number of decks in the collection (including the implicit
/// "Default" deck), or `-1` on error / NULL handle. Mirrors what the
/// desktop sidebar would show under "All Decks" pre-11-A preset
/// reassignment.
///
/// # Safety
/// - `handle` must be a non-NULL pointer returned by
///   [`ferdinand_collection_open`] that has not been closed.
/// - Must NOT be called concurrently with any other FFI call on the
///   same handle from another thread.
#[no_mangle]
pub unsafe extern "C" fn ferdinand_deck_count(handle: *const FerdinandCollection) -> i64 {
    if handle.is_null() {
        return -1;
    }
    // SAFETY: caller contract — `handle` is a valid open Collection and
    // is not concurrently accessed from another thread. We borrow
    // immutably; get_all_deck_names takes &self.
    let col = unsafe { &(*handle).inner };
    match col.get_all_deck_names(false) {
        Ok(names) => names.len() as i64,
        Err(_) => -1,
    }
}

/// One row in the JSON returned by [`ferdinand_list_decks_json`]. Mirrors
/// what the desktop sidebar would show in the deck-tree top level — id +
/// human-readable name + assigned preset id (None for filtered decks).
#[derive(Serialize)]
struct FfiDeck {
    id: i64,
    name: String,
    preset_id: Option<i64>,
}

/// Return a heap-allocated NUL-terminated JSON string with every deck in
/// the collection: `[{"id": ..., "name": "...", "preset_id": ...}, ...]`.
/// Returns NULL on a NULL handle or any underlying storage error.
///
/// The implicit "Default" deck is always present so a successful call
/// against an empty collection yields a one-element array.
///
/// Ownership: the returned pointer is heap-allocated and owned by the
/// caller. Release with [`ferdinand_free_string`] exactly once. Calling
/// `free()` from libc would also work for cdylib consumers (it's a
/// `CString` under the hood), but the dedicated free function is the
/// supported contract — it's the only ABI that's guaranteed not to break
/// when the staticlib is used inside a Swift/Objective-C runtime that
/// has its own allocator.
///
/// # Safety
/// - `handle` must be a non-NULL pointer returned by
///   [`ferdinand_collection_open`] that has not been closed.
/// - Must NOT be called concurrently with any other FFI call on the
///   same handle from another thread.
#[no_mangle]
pub unsafe extern "C" fn ferdinand_list_decks_json(
    handle: *mut FerdinandCollection,
) -> *mut c_char {
    if handle.is_null() {
        return ptr::null_mut();
    }
    // SAFETY: caller contract — `handle` is a valid open Collection and
    // is not concurrently accessed from another thread. We need &mut to
    // call get_deck (which mutates the deck cache) below; the pattern
    // mirrors anki_server::routes::decks::convert.
    let col = unsafe { &mut (*handle).inner };

    // get_all_deck_names(false) keeps the implicit Default deck in.
    // Returns Vec<(DeckId, String)> sorted by name.
    let names = match col.get_all_deck_names(false) {
        Ok(n) => n,
        Err(_) => return ptr::null_mut(),
    };

    let mut decks = Vec::with_capacity(names.len());
    for (did, name) in names {
        let preset_id = col
            .get_deck(did)
            .ok()
            .flatten()
            .and_then(|d| d.config_id())
            .map(|cid| cid.0);
        decks.push(FfiDeck {
            id: did.0,
            name,
            preset_id,
        });
    }

    let json = match serde_json::to_string(&decks) {
        Ok(s) => s,
        Err(_) => return ptr::null_mut(),
    };
    // CString::new fails on interior NUL — deck names with embedded NULs
    // would already be rejected at insert time inside Anki, but we still
    // map it to the documented NULL-on-error sentinel rather than panic.
    match CString::new(json) {
        Ok(s) => s.into_raw(),
        Err(_) => ptr::null_mut(),
    }
}

/// One row in the JSON returned by [`ferdinand_deck_tree_json`]. Mirrors
/// the desktop sidebar's per-deck shape — id, name, depth (`level`), and
/// today's three queue counts. `total_in_deck` is the bare card count
/// without children or limits, useful for "X cards" labels next to
/// nested decks. The shape is a strict superset of v2's `FfiDeck` minus
/// `preset_id` (the deck-tree path doesn't surface config_id; clients
/// that need it can still call [`ferdinand_list_decks_json`]).
#[derive(Serialize)]
struct FfiDeckTreeRow {
    id: i64,
    name: String,
    /// 0-indexed depth in the tree. The implicit root container is not
    /// emitted, so the topmost real decks have level 1.
    level: u32,
    new_count: u32,
    learn_count: u32,
    review_count: u32,
    total_in_deck: u32,
}

fn flatten_deck_tree(node: &anki_proto::decks::DeckTreeNode, out: &mut Vec<FfiDeckTreeRow>) {
    // Skip the implicit root (deck_id=0) so callers iterate only real
    // decks. Mirrors anki_server::routes::decks::list_decks which also
    // throws away the wrapper and walks the children directly.
    if node.deck_id != 0 {
        out.push(FfiDeckTreeRow {
            id: node.deck_id,
            name: node.name.clone(),
            level: node.level,
            new_count: node.new_count,
            learn_count: node.learn_count,
            review_count: node.review_count,
            total_in_deck: node.total_in_deck,
        });
    }
    for child in &node.children {
        flatten_deck_tree(child, out);
    }
}

/// Return a heap-allocated NUL-terminated JSON string with every deck
/// in the collection plus today's due counts:
/// `[{"id":..., "name":"...", "level":..., "new_count":..., "learn_count":...,
///   "review_count":..., "total_in_deck":...}, ...]`.
/// Returns NULL on a NULL handle or any underlying storage error.
///
/// The array is depth-first — a parent always precedes its children, and
/// the implicit root container is skipped so the topmost real decks land
/// at index 0+. Counts are computed against the current wall clock via
/// `TimestampSecs::now()` so a rerender after midnight reflects the new
/// day automatically.
///
/// Ownership: the returned pointer is heap-allocated and owned by the
/// caller. Release with [`ferdinand_free_string`] exactly once — same
/// contract as [`ferdinand_list_decks_json`].
///
/// # Safety
/// - `handle` must be a non-NULL pointer returned by
///   [`ferdinand_collection_open`] that has not been closed.
/// - Must NOT be called concurrently with any other FFI call on the
///   same handle from another thread.
#[no_mangle]
pub unsafe extern "C" fn ferdinand_deck_tree_json(handle: *mut FerdinandCollection) -> *mut c_char {
    if handle.is_null() {
        return ptr::null_mut();
    }
    // SAFETY: caller contract — `handle` is a valid open Collection and
    // is not concurrently accessed from another thread. `deck_tree`
    // takes `&mut self` to populate the per-deck cache while computing
    // due counts.
    let col = unsafe { &mut (*handle).inner };

    let tree = match col.deck_tree(Some(TimestampSecs::now())) {
        Ok(t) => t,
        Err(_) => return ptr::null_mut(),
    };

    let mut rows = Vec::new();
    flatten_deck_tree(&tree, &mut rows);

    let json = match serde_json::to_string(&rows) {
        Ok(s) => s,
        Err(_) => return ptr::null_mut(),
    };
    // CString::new fails on interior NUL — same defensive mapping to the
    // documented NULL-on-error sentinel as `ferdinand_list_decks_json`.
    match CString::new(json) {
        Ok(s) => s.into_raw(),
        Err(_) => ptr::null_mut(),
    }
}

/// Return the number of notes in the collection, or `-1` on error /
/// NULL handle. Mirrors [`ferdinand_deck_count`] for the notes table —
/// useful for a "N notes" footer label without paying the cost of
/// listing every note.
///
/// # Safety
/// - `handle` must be a non-NULL pointer returned by
///   [`ferdinand_collection_open`] that has not been closed.
/// - Must NOT be called concurrently with any other FFI call on the
///   same handle from another thread.
#[no_mangle]
pub unsafe extern "C" fn ferdinand_note_count(handle: *const FerdinandCollection) -> i64 {
    if handle.is_null() {
        return -1;
    }
    // SAFETY: caller contract — `handle` is a valid open Collection and
    // is not concurrently accessed from another thread. `db()` returns
    // an immutable borrow of the SQLite connection.
    let col = unsafe { &(*handle).inner };
    col.storage
        .db()
        .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get::<_, i64>(0))
        .unwrap_or(-1)
}

/// Aggregated counts shape returned by [`ferdinand_collection_stats_json`].
/// Each field is a non-negative count derived from the same source as the
/// individual `*_count` FFI calls, so a SwiftUI top-bar can render
/// "{deck_count} decks · {card_count} cards · {note_count} notes" with
/// `revlog_count` available for a "since first review" subtitle.
#[derive(Serialize)]
struct FfiCollectionStats {
    note_count: i64,
    card_count: i64,
    deck_count: i64,
    revlog_count: i64,
}

/// Return a heap-allocated NUL-terminated JSON object with the four
/// top-level table counts: `{"note_count": ..., "card_count": ...,
/// "deck_count": ..., "revlog_count": ...}`. Returns NULL on a NULL
/// handle or any underlying storage error.
///
/// `deck_count` matches [`ferdinand_deck_count`] (includes the implicit
/// Default deck via `get_all_deck_names(false)`); the three table counts
/// are direct `SELECT COUNT(*)` reads against the open SQLite handle.
///
/// Ownership: the returned pointer is heap-allocated and owned by the
/// caller. Release with [`ferdinand_free_string`] exactly once — same
/// contract as [`ferdinand_list_decks_json`] and
/// [`ferdinand_deck_tree_json`].
///
/// # Safety
/// - `handle` must be a non-NULL pointer returned by
///   [`ferdinand_collection_open`] that has not been closed.
/// - Must NOT be called concurrently with any other FFI call on the
///   same handle from another thread.
#[no_mangle]
pub unsafe extern "C" fn ferdinand_collection_stats_json(
    handle: *mut FerdinandCollection,
) -> *mut c_char {
    if handle.is_null() {
        return ptr::null_mut();
    }
    // SAFETY: caller contract — `handle` is a valid open Collection and
    // is not concurrently accessed from another thread. We borrow
    // immutably; both `storage.db()` and `get_all_deck_names` take &self.
    let col = unsafe { &(*handle).inner };

    let db = col.storage.db();
    let note_count: i64 = match db.query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0)) {
        Ok(n) => n,
        Err(_) => return ptr::null_mut(),
    };
    let card_count: i64 = match db.query_row("SELECT COUNT(*) FROM cards", [], |r| r.get(0)) {
        Ok(n) => n,
        Err(_) => return ptr::null_mut(),
    };
    let revlog_count: i64 = match db.query_row("SELECT COUNT(*) FROM revlog", [], |r| r.get(0)) {
        Ok(n) => n,
        Err(_) => return ptr::null_mut(),
    };
    let deck_count: i64 = match col.get_all_deck_names(false) {
        Ok(names) => names.len() as i64,
        Err(_) => return ptr::null_mut(),
    };

    let stats = FfiCollectionStats {
        note_count,
        card_count,
        deck_count,
        revlog_count,
    };
    let json = match serde_json::to_string(&stats) {
        Ok(s) => s,
        Err(_) => return ptr::null_mut(),
    };
    match CString::new(json) {
        Ok(s) => s.into_raw(),
        Err(_) => ptr::null_mut(),
    }
}

/// Release a heap C string previously returned by an `*_json` FFI
/// function ([`ferdinand_list_decks_json`],
/// [`ferdinand_deck_tree_json`], or
/// [`ferdinand_collection_stats_json`]). NULL-safe so callers can
/// defensively free after a NULL return without branching.
///
/// # Safety
/// - `s` must be either NULL, or a pointer returned by an FFI function
///   that documents `ferdinand_free_string` as its release path. Passing
///   any other pointer (including [`ferdinand_version`]'s 'static
///   pointer) is undefined behaviour.
/// - After this call returns, `s` is dangling and must not be used.
#[no_mangle]
pub unsafe extern "C" fn ferdinand_free_string(s: *mut c_char) {
    if s.is_null() {
        return;
    }
    // SAFETY: caller contract — `s` was produced by CString::into_raw
    // and has not been freed.
    drop(unsafe { CString::from_raw(s) });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CStr;

    #[test]
    fn version_pointer_is_non_null_and_matches_cargo_version() {
        let p = ferdinand_version();
        assert!(!p.is_null());

        // SAFETY: ferdinand_version() guarantees a 'static NUL-terminated
        // buffer. CStr::from_ptr requires that exact contract.
        let s = unsafe { CStr::from_ptr(p) }
            .to_str()
            .expect("version string must be valid UTF-8");
        assert_eq!(s, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn version_pointer_is_stable_across_calls() {
        // OnceLock guarantees the same buffer is returned every call —
        // important for clients that might cache the pointer rather than
        // copying the bytes out on each access.
        let a = ferdinand_version();
        let b = ferdinand_version();
        assert_eq!(a, b);
    }

    #[test]
    fn collection_open_returns_null_for_null_path() {
        // SAFETY: NULL is the documented sentinel for "no path"; the fn
        // short-circuits before any unsafe deref.
        let p = unsafe { ferdinand_collection_open(ptr::null()) };
        assert!(p.is_null());
    }

    #[test]
    fn collection_open_returns_null_for_unwritable_parent_dir() {
        // CollectionBuilder creates the file if missing, so a path with a
        // *missing* file but valid parent succeeds. To reach the failure
        // branch we point at a parent dir that doesn't exist — open
        // can't create the .anki2 file there.
        let path = CString::new("/tmp/ferdinand_ffi_no_such_parent_dir/coll.anki2").unwrap();
        // SAFETY: `path` is a valid NUL-terminated UTF-8 C string that
        // outlives the call.
        let p = unsafe { ferdinand_collection_open(path.as_ptr()) };
        assert!(
            p.is_null(),
            "open should fail when parent dir does not exist"
        );
    }

    #[test]
    fn collection_close_is_null_safe() {
        // SAFETY: NULL is documented as a no-op.
        unsafe { ferdinand_collection_close(ptr::null_mut()) };
    }

    #[test]
    fn deck_count_returns_minus_one_for_null_handle() {
        // SAFETY: NULL is documented as the error sentinel.
        let n = unsafe { ferdinand_deck_count(ptr::null()) };
        assert_eq!(n, -1);
    }

    #[test]
    fn open_count_close_round_trip_against_real_collection() {
        // Build a fresh collection in a tempdir; CollectionBuilder will
        // create the file if missing. `get_all_deck_names(false)` always
        // returns at least the implicit Default deck, so the count is
        // strictly positive.
        let tmpdir =
            std::env::temp_dir().join(format!("ferdinand_ffi_test_{}.anki2", std::process::id(),));
        let tmpdir_str = tmpdir.to_str().expect("tempdir path is utf-8");
        let cpath = CString::new(tmpdir_str).unwrap();

        // SAFETY: `cpath` outlives the call.
        let handle = unsafe { ferdinand_collection_open(cpath.as_ptr()) };
        assert!(!handle.is_null(), "open should succeed for fresh path");

        // SAFETY: `handle` is a freshly opened, single-threaded handle.
        let n = unsafe { ferdinand_deck_count(handle) };
        assert!(n >= 1, "Default deck always present, got {n}");

        // SAFETY: `handle` was opened above and has not been closed.
        unsafe { ferdinand_collection_close(handle) };

        // Cleanup; ignore errors since the next test run would clobber.
        let _ = std::fs::remove_file(&tmpdir);
    }

    #[test]
    fn list_decks_json_returns_null_for_null_handle() {
        // SAFETY: NULL is the documented sentinel for "no collection".
        let p = unsafe { ferdinand_list_decks_json(ptr::null_mut()) };
        assert!(p.is_null());
    }

    #[test]
    fn free_string_is_null_safe() {
        // Defensive callers should be able to free unconditionally
        // after a possible NULL return without branching.
        // SAFETY: NULL is documented as a no-op.
        unsafe { ferdinand_free_string(ptr::null_mut()) };
    }

    #[test]
    fn list_decks_json_round_trip_against_real_collection() {
        // Open a fresh collection, list its decks, parse the JSON, and
        // verify the implicit Default deck shape (id + name + preset_id).
        // Use a unique tempfile per run so parallel `cargo test` doesn't
        // race against the open_count_close test on the same path.
        let tmpdir = std::env::temp_dir().join(format!(
            "ferdinand_ffi_list_decks_test_{}_{}.anki2",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        ));
        let cpath = CString::new(tmpdir.to_str().unwrap()).unwrap();

        // SAFETY: `cpath` outlives the call.
        let handle = unsafe { ferdinand_collection_open(cpath.as_ptr()) };
        assert!(!handle.is_null(), "open should succeed for fresh path");

        // SAFETY: `handle` is a freshly opened, single-threaded handle.
        let json_ptr = unsafe { ferdinand_list_decks_json(handle) };
        assert!(!json_ptr.is_null(), "list should succeed for fresh col");

        // SAFETY: `json_ptr` was just produced by CString::into_raw and
        // has not been freed; it points to a NUL-terminated UTF-8 buffer.
        let json = unsafe { CStr::from_ptr(json_ptr) }
            .to_str()
            .expect("list_decks_json must return valid UTF-8");
        let decks: Vec<serde_json::Value> =
            serde_json::from_str(json).expect("list_decks_json must return a valid JSON array");
        assert!(!decks.is_empty(), "Default deck always present");
        // Shape check: every entry has id (i64), name (String),
        // preset_id (i64 or null).
        for d in &decks {
            assert!(d["id"].is_i64(), "deck id must be i64, got {d}");
            assert!(d["name"].is_string(), "deck name must be string, got {d}");
            let pid = &d["preset_id"];
            assert!(
                pid.is_i64() || pid.is_null(),
                "preset_id must be i64 or null, got {pid}"
            );
        }
        // The Default deck has a stable id of 1; this is the contract
        // anki_server::routes::decks relies on too.
        assert!(
            decks.iter().any(|d| d["id"] == 1),
            "Default deck id=1 must appear in list, got {decks:?}"
        );

        // SAFETY: produced by ferdinand_list_decks_json which documents
        // ferdinand_free_string as the release path.
        unsafe { ferdinand_free_string(json_ptr) };
        // SAFETY: `handle` was opened above and not yet closed.
        unsafe { ferdinand_collection_close(handle) };
        let _ = std::fs::remove_file(&tmpdir);
    }

    #[test]
    fn deck_tree_json_returns_null_for_null_handle() {
        // SAFETY: NULL is the documented sentinel for "no collection".
        let p = unsafe { ferdinand_deck_tree_json(ptr::null_mut()) };
        assert!(p.is_null());
    }

    #[test]
    fn deck_tree_json_round_trip_against_real_collection() {
        // Open a fresh collection, fetch the deck tree, parse the JSON,
        // and verify the per-row shape. The root container has deck_id=0
        // and must NOT appear; the implicit Default deck (id=1, level=1)
        // is the only entry on a fresh collection.
        let tmpdir = std::env::temp_dir().join(format!(
            "ferdinand_ffi_deck_tree_test_{}_{}.anki2",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        ));
        let cpath = CString::new(tmpdir.to_str().unwrap()).unwrap();

        // SAFETY: `cpath` outlives the call.
        let handle = unsafe { ferdinand_collection_open(cpath.as_ptr()) };
        assert!(!handle.is_null(), "open should succeed for fresh path");

        // SAFETY: `handle` is a freshly opened, single-threaded handle.
        let json_ptr = unsafe { ferdinand_deck_tree_json(handle) };
        assert!(
            !json_ptr.is_null(),
            "deck_tree should succeed for fresh col"
        );

        // SAFETY: produced by CString::into_raw above; not yet freed.
        let json = unsafe { CStr::from_ptr(json_ptr) }
            .to_str()
            .expect("deck_tree_json must return valid UTF-8");
        let rows: Vec<serde_json::Value> =
            serde_json::from_str(json).expect("deck_tree_json must return a valid JSON array");
        assert!(!rows.is_empty(), "Default deck always present");
        for r in &rows {
            assert!(r["id"].is_i64());
            assert!(r["name"].is_string());
            assert!(r["level"].is_u64());
            assert!(r["new_count"].is_u64());
            assert!(r["learn_count"].is_u64());
            assert!(r["review_count"].is_u64());
            assert!(r["total_in_deck"].is_u64());
            // Root container (deck_id=0) must never leak through.
            assert_ne!(r["id"], 0, "implicit root must be skipped, got {r}");
        }
        // Default deck id=1 must appear.
        assert!(
            rows.iter().any(|r| r["id"] == 1),
            "Default deck id=1 must appear in tree, got {rows:?}"
        );

        // SAFETY: produced by ferdinand_deck_tree_json; documented release path.
        unsafe { ferdinand_free_string(json_ptr) };
        // SAFETY: `handle` was opened above and not yet closed.
        unsafe { ferdinand_collection_close(handle) };
        let _ = std::fs::remove_file(&tmpdir);
    }

    #[test]
    fn note_count_returns_minus_one_for_null_handle() {
        // SAFETY: NULL is the documented sentinel for "no collection".
        let n = unsafe { ferdinand_note_count(ptr::null()) };
        assert_eq!(n, -1);
    }

    #[test]
    fn note_count_round_trip_against_real_collection() {
        // A fresh collection has zero notes — exercises the happy path
        // and pins the contract that the count is non-negative on
        // success (so callers can use `< 0` as the error sentinel).
        let tmpdir = std::env::temp_dir().join(format!(
            "ferdinand_ffi_note_count_test_{}_{}.anki2",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        ));
        let cpath = CString::new(tmpdir.to_str().unwrap()).unwrap();

        // SAFETY: `cpath` outlives the call.
        let handle = unsafe { ferdinand_collection_open(cpath.as_ptr()) };
        assert!(!handle.is_null(), "open should succeed for fresh path");

        // SAFETY: `handle` is a freshly opened, single-threaded handle.
        let n = unsafe { ferdinand_note_count(handle) };
        assert_eq!(n, 0, "fresh collection has no notes, got {n}");

        // SAFETY: `handle` was opened above and not yet closed.
        unsafe { ferdinand_collection_close(handle) };
        let _ = std::fs::remove_file(&tmpdir);
    }

    #[test]
    fn collection_stats_json_returns_null_for_null_handle() {
        // SAFETY: NULL is the documented sentinel for "no collection".
        let p = unsafe { ferdinand_collection_stats_json(ptr::null_mut()) };
        assert!(p.is_null());
    }

    #[test]
    fn collection_stats_json_round_trip_against_real_collection() {
        // Open a fresh collection, fetch the stats, parse the JSON, and
        // verify the four-field shape. A fresh collection has the
        // implicit Default deck (deck_count >= 1) and no rows in the
        // notes/cards/revlog tables (counts == 0). All four fields must
        // be non-negative on success.
        let tmpdir = std::env::temp_dir().join(format!(
            "ferdinand_ffi_stats_test_{}_{}.anki2",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        ));
        let cpath = CString::new(tmpdir.to_str().unwrap()).unwrap();

        // SAFETY: `cpath` outlives the call.
        let handle = unsafe { ferdinand_collection_open(cpath.as_ptr()) };
        assert!(!handle.is_null(), "open should succeed for fresh path");

        // SAFETY: `handle` is a freshly opened, single-threaded handle.
        let json_ptr = unsafe { ferdinand_collection_stats_json(handle) };
        assert!(!json_ptr.is_null(), "stats should succeed for fresh col");

        // SAFETY: produced by CString::into_raw above; not yet freed.
        let json = unsafe { CStr::from_ptr(json_ptr) }
            .to_str()
            .expect("collection_stats_json must return valid UTF-8");
        let stats: serde_json::Value = serde_json::from_str(json)
            .expect("collection_stats_json must return a valid JSON object");
        // Shape: object with the four documented keys.
        assert!(stats["note_count"].is_i64());
        assert!(stats["card_count"].is_i64());
        assert!(stats["deck_count"].is_i64());
        assert!(stats["revlog_count"].is_i64());
        // Fresh-collection invariants.
        assert_eq!(stats["note_count"], 0);
        assert_eq!(stats["card_count"], 0);
        assert_eq!(stats["revlog_count"], 0);
        assert!(
            stats["deck_count"].as_i64().unwrap() >= 1,
            "Default deck always present, got {stats}"
        );

        // SAFETY: produced by ferdinand_collection_stats_json; documented release path.
        unsafe { ferdinand_free_string(json_ptr) };
        // SAFETY: `handle` was opened above and not yet closed.
        unsafe { ferdinand_collection_close(handle) };
        let _ = std::fs::remove_file(&tmpdir);
    }

    #[test]
    fn flatten_deck_tree_emits_depth_first_and_skips_root() {
        // Pure unit test of the recursion rule — exercise without going
        // through Collection so we can assert the exact ordering. Mirrors
        // the anki_proto shape; field defaults fill the rest.
        use anki_proto::decks::DeckTreeNode;
        let tree = DeckTreeNode {
            deck_id: 0,
            name: String::new(),
            level: 0,
            children: vec![
                DeckTreeNode {
                    deck_id: 1,
                    name: "Default".into(),
                    level: 1,
                    new_count: 5,
                    children: vec![],
                    ..Default::default()
                },
                DeckTreeNode {
                    deck_id: 2,
                    name: "Parent".into(),
                    level: 1,
                    children: vec![DeckTreeNode {
                        deck_id: 3,
                        name: "Parent::Child".into(),
                        level: 2,
                        review_count: 7,
                        children: vec![],
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let mut rows = Vec::new();
        flatten_deck_tree(&tree, &mut rows);
        let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
        assert_eq!(ids, vec![1, 2, 3], "depth-first, root skipped");
        assert_eq!(rows[0].new_count, 5);
        assert_eq!(rows[2].review_count, 7);
        assert_eq!(rows[2].level, 2, "nested deck must keep its depth");
    }
}
