//! `GET /media/:filename` — serve asset bytes from the collection's
//! `.media/` directory.
//! `POST /media` (Phase 15-C) — accept a multipart `file` field and
//! persist it under `.media/`, dedup'ing the filename via " (N)" suffix
//! mirroring desktop Anki.
//!
//! Security: the filename must be a single decoded path segment. We reject
//! anything containing `/`, `\`, `\0`, leading-dot, or the literal `..`,
//! and then canonicalise + prefix-check the resolved path to block symlink
//! escapes. Failures map to 400 so that probes can't tell traversal from
//! "file missing" via timing.

use std::path::{Path as StdPath, PathBuf};

use axum::body::Body;
use axum::extract::{Multipart, Path, State};
use axum::http::{header, HeaderValue, Response, StatusCode};
use axum::Json;
use serde::Serialize;

use crate::error::{ApiResult, ServerError};
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

/// 10 MiB cap. Big enough for screenshots and high-res cloze occlusion
/// images; small enough that a single typo'd drag-drop can't fill the
/// disk on a localhost-single-user collection. Adjust with care — Anki
/// desktop has no built-in cap, so callers that want to upload audio
/// or video can route around the API for now.
const MAX_UPLOAD_BYTES: u64 = 10 * 1024 * 1024;

/// MIME allow-list. Phase 15-C scope is image-only — drag-drop into the
/// /notes/new editor is the primary use case. Audio / video would need
/// additional UI flows (and waveform / poster frame handling) so they
/// stay out of v1. Comparison is exact: the client must send a clean
/// `image/png` etc., not `image/png; charset=binary`.
const ALLOWED_IMAGE_MIMES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
];

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct MediaUploadResponse {
    /// Server-canonical filename after dedupe. Differs from the request
    /// when an existing collision was resolved via " (N)" suffix —
    /// echoing it back lets the client write the correct
    /// `<img src="/media/{filename}">` token without a follow-up GET.
    pub filename: String,
    pub size_bytes: u64,
}

/// Pure-shape validation for a POST filename. Stricter than the GET-side
/// `validate_filename` because we're picking the on-disk name: cap to 200
/// chars (less than the 255 GET limit so a " (N)" suffix can fit without
/// re-failing on read), require an extension dot (so a stored file can be
/// MIME-sniffed by the GET side), and reject the same path-separator /
/// hidden-file shapes.
fn validate_upload_filename(name: &str) -> Result<&str, &'static str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("filename must not be empty");
    }
    if trimmed.chars().count() > 200 {
        return Err("filename must be at most 200 characters");
    }
    if trimmed.starts_with('.') {
        return Err("filename must not start with '.'");
    }
    if !trimmed.contains('.') {
        return Err("filename must include an extension");
    }
    for b in trimmed.bytes() {
        if b == b'/' || b == b'\\' || b == 0 {
            return Err("filename must not contain path separators or NUL");
        }
    }
    Ok(trimmed)
}

/// MIME allow-list check. Trim + lowercase + strict equality so a
/// `image/png; charset=binary` that gets through some buggy client
/// surfaces as a clear 400 rather than silently being accepted.
fn validate_upload_mime(mime: &str) -> Result<(), &'static str> {
    let lower = mime.trim().to_ascii_lowercase();
    if ALLOWED_IMAGE_MIMES.iter().any(|m| *m == lower) {
        Ok(())
    } else {
        Err("only PNG / JPEG / WEBP / GIF images are accepted")
    }
}

/// Resolve a non-colliding target path inside `media_dir`, mirroring
/// desktop Anki's " (N)" suffix scheme. Walks N from 1..=999; falls back
/// to an epoch-ms suffix only on the (effectively impossible) case where
/// a thousand prior dedupe attempts all happened.
fn unique_target_path(media_dir: &StdPath, name: &str) -> PathBuf {
    let candidate = media_dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s, format!(".{e}")),
        None => (name, String::new()),
    };
    for n in 1..=999_u32 {
        let alt = media_dir.join(format!("{stem} ({n}){ext}"));
        if !alt.exists() {
            return alt;
        }
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    media_dir.join(format!("{stem}-{ts}{ext}"))
}

/// Phase 15-C: receive a multipart upload and persist it under
/// `<collection-stem>.media/`. Expects exactly one form field named
/// `file` with a filename and content type. Returns
/// `{filename, size_bytes}` so the caller can render an
/// `<img src="/media/{filename}">` token without a follow-up GET.
///
/// Validation order (cheap → expensive):
///   1. Read fields until we find the `file` field; reject if absent
///      (400). axum's Multipart returns a `MultipartError` for malformed
///      bodies, which folds into a 400 too.
///   2. validate_upload_filename — extension required, no path
///      separators, ≤200 chars, no leading dot.
///   3. validate_upload_mime — strict allow-list match against the four
///      web-safe image types.
///   4. Read the field bytes; reject if > 10 MiB.
///   5. Pick a non-colliding target via unique_target_path; write the
///      bytes via tokio::fs::write.
///
/// File I/O failures fold to 500 via ServerError::from(anyhow). The path
/// is always inside the canonicalised media_dir (we never construct from
/// user-supplied path components), so we don't need a post-write
/// `starts_with(media_dir)` check — validate_upload_filename's
/// no-separators rule already prevents directory escape.
#[utoipa::path(
    post,
    path = "/media",
    responses(
        (status = 200, body = MediaUploadResponse),
        (status = 400, body = crate::error::ApiError),
    )
)]
pub async fn post_upload(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> ApiResult<Json<MediaUploadResponse>> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ServerError::bad_request(format!("malformed multipart body: {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let raw_name = field
            .file_name()
            .ok_or_else(|| ServerError::bad_request("multipart field 'file' missing filename"))?
            .to_owned();
        let raw_mime = field.content_type().unwrap_or("").to_owned();
        let validated_name = validate_upload_filename(&raw_name)
            .map(|s| s.to_owned())
            .map_err(ServerError::bad_request)?;
        validate_upload_mime(&raw_mime).map_err(ServerError::bad_request)?;
        let bytes = field
            .bytes()
            .await
            .map_err(|e| ServerError::bad_request(format!("multipart read failed: {e}")))?;
        if bytes.len() as u64 > MAX_UPLOAD_BYTES {
            return Err(ServerError::bad_request(format!(
                "file too large ({} bytes); max is {} bytes",
                bytes.len(),
                MAX_UPLOAD_BYTES
            )));
        }
        let target = unique_target_path(state.media_dir.as_path(), &validated_name);
        tokio::fs::write(&target, &bytes)
            .await
            .map_err(|e| ServerError::from(anyhow::anyhow!("write {} failed: {e}", target.display())))?;
        let stored = target
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| ServerError::from(anyhow::anyhow!("stored filename was non-UTF-8")))?
            .to_owned();
        return Ok(Json(MediaUploadResponse {
            filename: stored,
            size_bytes: bytes.len() as u64,
        }));
    }
    Err(ServerError::bad_request(
        "multipart body must include a 'file' field",
    ))
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

    // Phase 15-C upload-side validators.

    #[test]
    fn validate_upload_filename_accepts_extension_and_cjk() {
        assert_eq!(validate_upload_filename("hello.png").unwrap(), "hello.png");
        assert_eq!(validate_upload_filename("photo.jpg").unwrap(), "photo.jpg");
        // CJK names get the same 200-char budget; "森森.png" (5 chars) passes.
        assert_eq!(validate_upload_filename("森森.png").unwrap(), "森森.png");
        // Trim leading/trailing whitespace.
        assert_eq!(
            validate_upload_filename("  padded.png  ").unwrap(),
            "padded.png"
        );
    }

    #[test]
    fn validate_upload_filename_rejects_blank_and_separator_and_hidden_and_no_ext() {
        for blank in ["", "   ", "\t\n"] {
            assert_eq!(
                validate_upload_filename(blank).unwrap_err(),
                "filename must not be empty",
                "blank={blank:?}"
            );
        }
        for sep in ["foo/bar.png", "foo\\bar.png", "x\0.png"] {
            assert_eq!(
                validate_upload_filename(sep).unwrap_err(),
                "filename must not contain path separators or NUL",
                "sep={sep:?}"
            );
        }
        assert_eq!(
            validate_upload_filename(".hidden.png").unwrap_err(),
            "filename must not start with '.'"
        );
        // No extension dot — would defeat MIME-sniffing on the GET side.
        assert_eq!(
            validate_upload_filename("noext").unwrap_err(),
            "filename must include an extension"
        );
    }

    #[test]
    fn validate_upload_filename_enforces_chars_not_bytes_budget() {
        // 200 single-byte chars + ".png" = 204 chars over the cap; 200
        // total chars passes if the extension fits within them.
        let just_under = format!("{}.png", "a".repeat(196));
        assert_eq!(just_under.chars().count(), 200);
        assert_eq!(
            validate_upload_filename(&just_under).unwrap(),
            just_under.as_str()
        );
        // 201 chars rejected.
        let over = format!("{}.png", "a".repeat(197));
        assert_eq!(over.chars().count(), 201);
        assert_eq!(
            validate_upload_filename(&over).unwrap_err(),
            "filename must be at most 200 characters"
        );
        // CJK gets the same chars-not-bytes budget — same fairness rule
        // as Phase 14-C deck-name validation.
        let cjk_200 = format!("{}.png", "森".repeat(196));
        assert_eq!(cjk_200.chars().count(), 200);
        assert!(validate_upload_filename(&cjk_200).is_ok());
    }

    #[test]
    fn validate_upload_mime_accepts_image_allow_list() {
        for ok in ["image/png", "image/jpeg", "image/webp", "image/gif"] {
            assert!(validate_upload_mime(ok).is_ok(), "mime={ok}");
            // Case-insensitive on the wire — some clients UPPERCASE.
            assert!(validate_upload_mime(&ok.to_ascii_uppercase()).is_ok());
        }
        // Trim whitespace before matching.
        assert!(validate_upload_mime("  image/png  ").is_ok());
    }

    #[test]
    fn validate_upload_mime_rejects_non_image_and_charset_suffixed() {
        // Non-image types — block at the boundary.
        for bad in [
            "application/pdf",
            "audio/mpeg",
            "video/mp4",
            "text/html",
            "application/octet-stream",
        ] {
            assert_eq!(
                validate_upload_mime(bad).unwrap_err(),
                "only PNG / JPEG / WEBP / GIF images are accepted",
                "bad={bad}"
            );
        }
        // Strict equality means `image/png; charset=binary` fails — that
        // shape implies a buggy client and we surface it as a clean 400
        // rather than silently accepting (and possibly mis-typing the
        // GET response Content-Type later).
        assert!(validate_upload_mime("image/png; charset=binary").is_err());
        // Empty mime fails.
        assert!(validate_upload_mime("").is_err());
    }

    #[test]
    fn unique_target_path_appends_n_suffix_on_collision() {
        let tmp = std::env::temp_dir().join(format!(
            "ferdinand_media_dedup_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        // No collision — returns the verbatim path.
        let p0 = unique_target_path(&tmp, "a.png");
        assert_eq!(p0.file_name().unwrap(), "a.png");
        // Seed an existing file → next call gets " (1)".
        std::fs::write(&p0, b"x").unwrap();
        let p1 = unique_target_path(&tmp, "a.png");
        assert_eq!(p1.file_name().unwrap(), "a (1).png");
        // Seed " (1)" too → "(2)".
        std::fs::write(&p1, b"x").unwrap();
        let p2 = unique_target_path(&tmp, "a.png");
        assert_eq!(p2.file_name().unwrap(), "a (2).png");
        std::fs::remove_dir_all(&tmp).unwrap();
    }
}
