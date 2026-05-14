//! Argon2id password hashing and validation.
//!
//! Defaults from the `argon2` crate (Argon2id, m=19456, t=2, p=1) are tuned
//! for interactive logins; we don't tune them down because Phase A2 is a
//! single-user personal server — a sub-100ms verify cost is fine.

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::http::StatusCode;

use crate::error::ServerError;

/// Minimum accepted password length enforced at every write path:
/// registration, admin create-user, admin reset-password, and self-service
/// password change.
pub const MIN_PASSWORD_LEN: usize = 8;

/// Validate password strength. Currently enforces only the minimum length
/// (`MIN_PASSWORD_LEN`). Returns `Err(400)` on failure so callers can use `?`
/// directly in request handlers.
pub fn validate_password_strength(pw: &str) -> Result<(), ServerError> {
    if pw.len() < MIN_PASSWORD_LEN {
        return Err(ServerError {
            source: anyhow::anyhow!(
                "password must be at least {} characters",
                MIN_PASSWORD_LEN
            ),
            status: StatusCode::BAD_REQUEST,
            retry_after_secs: None,
        });
    }
    Ok(())
}

/// Hash a plaintext password into a PHC-format string suitable for storage.
pub fn hash(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon = Argon2::default();
    argon
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("argon2 hash failed: {e}"))
}

/// Verify `password` against a previously stored PHC hash.
/// Returns `Ok(true)` for a match, `Ok(false)` for a mismatch — only
/// truly malformed hashes (i.e. corrupt DB) bubble up as `Err`.
pub fn verify(password: &str, phc: &str) -> anyhow::Result<bool> {
    let parsed = PasswordHash::new(phc)
        .map_err(|e| anyhow::anyhow!("stored password hash is malformed: {e}"))?;
    match Argon2::default().verify_password(password.as_bytes(), &parsed) {
        Ok(()) => Ok(true),
        Err(argon2::password_hash::Error::Password) => Ok(false),
        Err(e) => Err(anyhow::anyhow!("argon2 verify failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    #[test]
    fn hash_then_verify_round_trip() {
        let phc = hash("hunter2").unwrap();
        assert!(verify("hunter2", &phc).unwrap());
    }

    #[test]
    fn rejects_wrong_password() {
        let phc = hash("hunter2").unwrap();
        assert!(!verify("wrong", &phc).unwrap());
    }

    #[test]
    fn malformed_hash_errors() {
        assert!(verify("anything", "not-a-real-hash").is_err());
    }

    #[test]
    fn distinct_salts_produce_distinct_hashes() {
        // Defends against an accidental "salt = empty string" regression
        // sneaking in via a refactor — same plaintext should hash to two
        // different PHC strings on consecutive calls.
        let a = hash("hunter2").unwrap();
        let b = hash("hunter2").unwrap();
        assert_ne!(a, b, "same password produced identical hash twice");
    }

    // ---- validate_password_strength ----

    #[test]
    fn empty_password_is_rejected_with_400() {
        let err = validate_password_strength("").unwrap_err();
        assert_eq!(err.status, StatusCode::BAD_REQUEST);
        assert!(
            err.source.to_string().contains("at least"),
            "error message should mention minimum length: {}",
            err.source
        );
    }

    #[test]
    fn short_password_is_rejected_with_400() {
        let err = validate_password_strength("abc").unwrap_err();
        assert_eq!(err.status, StatusCode::BAD_REQUEST);
        assert!(err.source.to_string().contains("at least"));
    }

    #[test]
    fn exactly_min_length_is_accepted() {
        // "password" is exactly 8 characters == MIN_PASSWORD_LEN
        assert_eq!("password".len(), MIN_PASSWORD_LEN);
        assert!(validate_password_strength("password").is_ok());
    }

    #[test]
    fn long_password_is_accepted() {
        let pw = "a".repeat(100);
        assert!(validate_password_strength(&pw).is_ok());
    }
}
