//! C ABI bridge from rslib to native Ferdinand clients.
//!
//! v0 surface: a single `ferdinand_version()` symbol returning the crate
//! version as a static C string. This is intentionally trivial — the goal
//! of Phase 10-D' is to stand up the build pipeline (workspace member +
//! cbindgen + staticlib/cdylib outputs) without adding new functionality
//! that would block on macOS toolchain availability. Subsequent phases on
//! a macOS host will widen this to read-only collection access.
//!
//! Memory model: the returned pointer is to a 'static NUL-terminated
//! buffer baked into the compiled artifact. Callers must NOT free it and
//! must NOT mutate it. They MAY assume the pointer remains valid for the
//! lifetime of the loaded library.

use std::ffi::CString;
use std::os::raw::c_char;
use std::sync::OnceLock;

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
}
