//! `GET /media/:filename` — serve asset bytes from the collection's
//! `.media/` directory.
//!
//! Security: the filename must be a single decoded path segment. We reject
//! anything containing `/`, `\`, `\0`, leading-dot, or the literal `..`,
//! and then canonicalise + prefix-check the resolved path to block symlink
//! escapes. Failures map to 400 so that probes can't tell traversal from
//! "file missing" via timing.

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderValue, Response, StatusCode};

use crate::state::AppState;

/// Reject filenames that could escape the media directory or target hidden
/// / reserved names. Input is the already percent-decoded segment axum hands
/// us via `Path<String>`, so we only have to defend against the decoded form.
fn validate_filename(name: &str) -> Result<(), &'static str> {
    if name.is_empty() {
        return Err("empty filename");
    }
    if name.len() > 255 {
        return Err("filename too long");
    }
    if name.starts_with('.') {
        // Covers `.`, `..`, `.hidden`, `.env` in one shot.
        return Err("hidden/reserved filename");
    }
    for b in name.bytes() {
        if b == b'/' || b == b'\\' || b == 0 {
            return Err("reserved character in filename");
        }
    }
    Ok(())
}

pub async fn get_media(
    State(state): State<AppState>,
    Path(filename): Path<String>,
) -> Response<Body> {
    if let Err(reason) = validate_filename(&filename) {
        tracing::debug!(filename = %filename, reason, "media request rejected");
        return bad_request();
    }

    let candidate = state.media_dir.join(&filename);
    let canonical = match tokio::fs::canonicalize(&candidate).await {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return not_found(),
        Err(e) => {
            tracing::error!(filename = %filename, error = %e, "canonicalize failed");
            return internal_error();
        }
    };

    if !canonical.starts_with(state.media_dir.as_path()) {
        tracing::warn!(filename = %filename, "resolved path escapes media dir");
        return bad_request();
    }

    let bytes = match tokio::fs::read(&canonical).await {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return not_found(),
        Err(e) => {
            tracing::error!(filename = %filename, error = %e, "media read failed");
            return internal_error();
        }
    };

    let mime = mime_guess::from_path(&canonical).first_or_octet_stream();
    let mime_header = HeaderValue::from_str(mime.as_ref())
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime_header)
        .header("x-content-type-options", "nosniff")
        .body(Body::from(bytes))
        .unwrap_or_else(|_| internal_error())
}

fn bad_request() -> Response<Body> {
    status_only(StatusCode::BAD_REQUEST)
}

fn not_found() -> Response<Body> {
    status_only(StatusCode::NOT_FOUND)
}

fn internal_error() -> Response<Body> {
    status_only(StatusCode::INTERNAL_SERVER_ERROR)
}

fn status_only(status: StatusCode) -> Response<Body> {
    Response::builder()
        .status(status)
        .body(Body::empty())
        .expect("static status response must build")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_filenames() {
        assert!(validate_filename("hello.png").is_ok());
        assert!(validate_filename("audio_01.mp3").is_ok());
        assert!(validate_filename("image-1.jpg").is_ok());
        // UTF-8 filenames are legitimate (Anki collections contain CJK media).
        assert!(validate_filename("日本語.png").is_ok());
    }

    #[test]
    fn rejects_empty() {
        assert!(validate_filename("").is_err());
    }

    #[test]
    fn rejects_slash_variants() {
        assert!(validate_filename("foo/bar").is_err());
        assert!(validate_filename("/etc/passwd").is_err());
        assert!(validate_filename("../etc/passwd").is_err());
    }

    #[test]
    fn rejects_backslash() {
        assert!(validate_filename("foo\\bar").is_err());
        assert!(validate_filename("..\\etc\\passwd").is_err());
    }

    #[test]
    fn rejects_parent_traversal() {
        assert!(validate_filename("..").is_err());
        assert!(validate_filename(".").is_err());
    }

    #[test]
    fn rejects_leading_dot() {
        assert!(validate_filename(".hidden").is_err());
        assert!(validate_filename(".env").is_err());
    }

    #[test]
    fn rejects_null_byte() {
        assert!(validate_filename("hello\0.png").is_err());
    }

    #[test]
    fn rejects_overlong() {
        let long = "a".repeat(256);
        assert!(validate_filename(&long).is_err());
    }
}
