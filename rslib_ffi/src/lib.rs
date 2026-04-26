//! C ABI bridge from rslib to native Ferdinand clients.
//!
//! v0 surface (Phase 10-D'): `ferdinand_version()` — crate version string.
//! v1 surface (Phase 11-D): opaque `FerdinandCollection` handle with
//! `_open`, `_close`, and `_deck_count` for read-only collection access.
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
        let path = CString::new(
            "/tmp/ferdinand_ffi_no_such_parent_dir/coll.anki2",
        )
        .unwrap();
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
        let tmpdir = std::env::temp_dir().join(format!(
            "ferdinand_ffi_test_{}.anki2",
            std::process::id(),
        ));
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
}
