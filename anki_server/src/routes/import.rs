//! `POST /api/import/apkg` — multipart upload of an Anki `.apkg` file.
//!
//! Self-service for any authenticated user: friends bring their own deck
//! export and migrate it onto the web client without admin intervention.
//! v1 (Phase B3a) accepts what's there and runs rslib's `import_apkg` on
//! the result. Out of scope for v1 (lands in B3b or later):
//!
//! * progress reporting — the handler blocks until rslib finishes;
//! * deck-mapping UI — the importer uses whatever names the `.apkg` carries;
//! * preview / dry-run — the file is committed straight into the user's
//!   collection;
//! * cancel — close the tab to abandon.
//!
//! ## Streaming + cap
//!
//! The multipart `file` field is consumed chunk-by-chunk and written to a
//! `NamedTempFile`. The cap (env `ANKI_IMPORT_MAX_BYTES`, default 100 MiB)
//! is enforced as bytes accumulate so we 400 *before* the whole body lands
//! on disk. Reading via `field.bytes()` would defeat that — it buffers the
//! entire field in memory first.
//!
//! ## Locking + sync rslib
//!
//! `Collection::import_apkg` is sync and takes `&mut Collection`; the call
//! lives inside `tokio::task::spawn_blocking` to keep the runtime threads
//! responsive on a multi-minute import. We clone the `Arc<Mutex<Collection>>`
//! into the blocking closure and acquire `blocking_lock()` there — that
//! call is only safe outside an async runtime context, which `spawn_blocking`
//! provides.

use std::io::Write;

use anki::error::AnkiError;
use anki::import_export::package::ImportAnkiPackageOptions;
use anki::import_export::NoteLog;
use axum::extract::Multipart;
use axum::Json;
use serde::Serialize;
use tempfile::NamedTempFile;

use crate::error::{ApiResult, ServerError};
use crate::state::AppState;

/// Default upload cap: 100 MiB. Generous enough for a friend's whole
/// collection export but small enough that an accidental wrong-file
/// drag-drop fails fast.
const DEFAULT_MAX_BYTES: u64 = 100 * 1024 * 1024;

/// Result body for a successful import. Mirrors what rslib's `NoteLog`
/// surfaces. Per-card counts aren't directly available from `import_apkg`
/// in v1 so `imported_card_count` is `None` — kept in the schema so B3b
/// can fill it without a breaking change.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiImportResult {
    /// `log.new.len()` — fresh notes added to the collection.
    pub imported_note_count: u64,
    /// `log.updated.len()` — existing notes modified by the import.
    pub updated_note_count: u64,
    /// `log.duplicate.len() + log.conflicting.len()` — notes the importer
    /// declined to merge. Surfacing this matters for friend-self-host:
    /// a re-import shouldn't silently look like a no-op.
    pub skipped_count: u64,
    /// `None` in v1 — rslib doesn't surface per-card counts from
    /// `import_apkg`. B3b's UI falls back to "imported N notes".
    pub imported_card_count: Option<u64>,
    /// One-line human-readable breakdown for the UI toast.
    pub log_summary: String,
}

#[utoipa::path(
    post,
    path = "/api/import/apkg",
    responses(
        (status = 200, body = ApiImportResult),
        (status = 400, body = crate::error::ApiError),
        (status = 401, body = crate::error::ApiError),
    )
)]
pub async fn import_apkg(
    state: AppState,
    multipart: Multipart,
) -> ApiResult<Json<ApiImportResult>> {
    let cap = parse_max_bytes_env(std::env::var("ANKI_IMPORT_MAX_BYTES").ok().as_deref());
    let temp = stream_apkg_field_to_tempfile(multipart, cap).await?;
    let path = temp.path().to_path_buf();
    let col = state.col.clone();
    let log = tokio::task::spawn_blocking(move || -> Result<NoteLog, AnkiError> {
        // `blocking_lock` is safe here because `spawn_blocking` runs on a
        // dedicated blocking thread, not on a tokio worker.
        let mut col = col.blocking_lock();
        col.import_apkg(&path, ImportAnkiPackageOptions::default())
            .map(|out| out.output)
    })
    .await
    .map_err(|join| ServerError::from(anyhow::anyhow!("import task panicked: {join}")))?
    .map_err(map_import_error)?;
    // Keep `temp` alive across the spawn_blocking await so the path stays
    // valid until rslib finishes reading it. Drop is implicit at scope-exit
    // but we make it loud so a future refactor doesn't accidentally move it.
    drop(temp);
    Ok(Json(build_result(&log)))
}

/// Stream the first `file` field of a multipart body into a `NamedTempFile`,
/// enforcing `max_bytes` as we go. Returns 400 on any client-shaped failure
/// (missing field, empty body, oversize, malformed multipart) and 500 on
/// tempfile / IO failures.
async fn stream_apkg_field_to_tempfile(
    mut multipart: Multipart,
    max_bytes: u64,
) -> Result<NamedTempFile, ServerError> {
    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| ServerError::bad_request(format!("malformed multipart body: {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let mut temp = NamedTempFile::new()
            .map_err(|e| ServerError::from(anyhow::anyhow!("create tempfile failed: {e}")))?;
        let mut written: u64 = 0;
        while let Some(chunk) = field
            .chunk()
            .await
            .map_err(|e| ServerError::bad_request(format!("multipart read failed: {e}")))?
        {
            written = written.saturating_add(chunk.len() as u64);
            if written > max_bytes {
                return Err(ServerError::bad_request(format!(
                    "upload exceeds cap ({written} bytes > {max_bytes}); \
                     raise ANKI_IMPORT_MAX_BYTES to allow more"
                )));
            }
            temp.write_all(&chunk).map_err(|e| {
                ServerError::from(anyhow::anyhow!("write to tempfile failed: {e}"))
            })?;
        }
        temp.as_file_mut()
            .sync_all()
            .map_err(|e| ServerError::from(anyhow::anyhow!("flush tempfile failed: {e}")))?;
        if written == 0 {
            return Err(ServerError::bad_request("multipart 'file' field was empty"));
        }
        return Ok(temp);
    }
    Err(ServerError::bad_request(
        "multipart body must include a 'file' field",
    ))
}

/// Map an rslib import error to the right HTTP status.
///
/// Bad input (corrupt archive, wrong format, unsupported version, malformed
/// zip) → 400; everything else (DB, IO, internal) → 500 via the blanket
/// `From<anyhow::Error>` impl.
///
/// rslib surfaces zip-decode failures as `AnkiError::SyncError` (because
/// `From<zip::ZipError> for AnkiError` lives next to the sync transport,
/// see `rslib/src/error/network.rs`). Inside `import_apkg` the only
/// possible source of a SyncError is a malformed zip — we never call any
/// actual sync code from this handler — so it's safe to fold to 400 here.
fn map_import_error(err: AnkiError) -> ServerError {
    match err {
        AnkiError::ImportError { ref source } => {
            ServerError::bad_request(format!("import failed: {source:?}"))
        }
        AnkiError::InvalidInput { ref source } => ServerError::bad_request(format!(
            "import rejected: {} ({})",
            source.message(),
            source.context()
        )),
        AnkiError::SyncError { ref source } => ServerError::bad_request(format!(
            "import rejected (malformed archive): {source:?}"
        )),
        other => ServerError::from(other),
    }
}

/// Resolve the cap from env. Garbage / empty / zero falls back to the
/// hard-coded default rather than refusing to start; operators flipping
/// the env on for an experiment shouldn't have to redeploy to recover
/// from a typo.
fn parse_max_bytes_env(raw: Option<&str>) -> u64 {
    raw.and_then(|s| s.trim().parse::<u64>().ok())
        .filter(|&v| v > 0)
        .unwrap_or(DEFAULT_MAX_BYTES)
}

fn build_result(log: &NoteLog) -> ApiImportResult {
    let new = log.new.len() as u64;
    let updated = log.updated.len() as u64;
    let skipped = (log.duplicate.len() + log.conflicting.len()) as u64;
    let log_summary = format!(
        "imported {new} new note(s), updated {updated}, skipped {skipped} (duplicate+conflict)"
    );
    ApiImportResult {
        imported_note_count: new,
        updated_note_count: updated,
        skipped_count: skipped,
        imported_card_count: None,
        log_summary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anki_proto::import_export::import_response::Log as ProtoLog;

    #[test]
    fn parse_max_bytes_env_default_when_unset() {
        assert_eq!(parse_max_bytes_env(None), DEFAULT_MAX_BYTES);
    }

    #[test]
    fn parse_max_bytes_env_default_when_garbage() {
        assert_eq!(parse_max_bytes_env(Some("not-a-number")), DEFAULT_MAX_BYTES);
        assert_eq!(parse_max_bytes_env(Some("")), DEFAULT_MAX_BYTES);
        assert_eq!(parse_max_bytes_env(Some("0")), DEFAULT_MAX_BYTES);
    }

    #[test]
    fn parse_max_bytes_env_parses_explicit() {
        assert_eq!(parse_max_bytes_env(Some("1048576")), 1_048_576);
        assert_eq!(parse_max_bytes_env(Some("  2048  ")), 2_048);
    }

    #[test]
    fn build_result_summarises_log_with_counts() {
        let log = ProtoLog {
            new: vec![Default::default(); 5],
            updated: vec![Default::default(); 2],
            duplicate: vec![Default::default(); 1],
            conflicting: vec![Default::default(); 1],
            ..Default::default()
        };
        let result = build_result(&log);
        assert_eq!(result.imported_note_count, 5);
        assert_eq!(result.updated_note_count, 2);
        assert_eq!(result.skipped_count, 2);
        assert!(result.imported_card_count.is_none());
        assert!(
            result.log_summary.contains("5 new"),
            "log_summary missing new count: {}",
            result.log_summary
        );
        assert!(
            result.log_summary.contains("updated 2"),
            "log_summary missing updated count: {}",
            result.log_summary
        );
    }

    #[test]
    fn build_result_zero_when_log_empty() {
        let log = ProtoLog::default();
        let result = build_result(&log);
        assert_eq!(result.imported_note_count, 0);
        assert_eq!(result.updated_note_count, 0);
        assert_eq!(result.skipped_count, 0);
        assert!(result.imported_card_count.is_none());
    }
}
