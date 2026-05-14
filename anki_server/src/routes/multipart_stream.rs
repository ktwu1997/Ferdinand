//! Shared helper: stream a multipart field to a [`NamedTempFile`] while
//! enforcing a running byte cap — rejecting oversized uploads *before* the
//! full body lands on disk or in memory.
//!
//! The public surface is [`stream_field_to_tempfile`], which wraps an axum
//! [`Field`]. Unit tests exercise the inner [`drain_chunks_to_tempfile`]
//! directly, passing a plain `Vec<Bytes>` instead, because
//! `axum::multipart::Field` cannot be constructed outside the multipart
//! machinery.

use std::io::Write;

use axum::body::Bytes;
use axum::extract::multipart::Field;
use tempfile::NamedTempFile;

use crate::error::ServerError;

/// Stream a multipart `field` to a temp file.
///
/// Chunks are written incrementally; `cap_bytes` is checked after each chunk
/// so the server never accumulates more than `cap_bytes + one_chunk_size` in
/// either memory or disk space before returning a 413. Returns the temp file
/// and total byte count on success.
pub async fn stream_field_to_tempfile(
    mut field: Field<'_>,
    cap_bytes: u64,
) -> Result<(NamedTempFile, u64), ServerError> {
    let mut tmp = NamedTempFile::new()
        .map_err(|e| ServerError::from(anyhow::anyhow!("create tempfile failed: {e}")))?;
    let mut total: u64 = 0;
    while let Some(chunk_result) = field.chunk().await.transpose() {
        let chunk = chunk_result
            .map_err(|e| ServerError::bad_request(format!("multipart read failed: {e}")))?;
        write_chunk_with_cap(&mut tmp, &mut total, chunk, cap_bytes)?;
    }
    Ok((tmp, total))
}

/// Inner logic shared with tests: write one `chunk` to `tmp`, add its length
/// to `*total`, and return a 413 `ServerError` if the cap is exceeded.
fn write_chunk_with_cap(
    tmp: &mut NamedTempFile,
    total: &mut u64,
    chunk: Bytes,
    cap_bytes: u64,
) -> Result<(), ServerError> {
    *total = total.saturating_add(chunk.len() as u64);
    if *total > cap_bytes {
        return Err(ServerError {
            source: anyhow::anyhow!(
                "upload exceeds cap ({total} bytes > {cap_bytes} bytes)"
            ),
            status: axum::http::StatusCode::PAYLOAD_TOO_LARGE,
            retry_after_secs: None,
        });
    }
    tmp.write_all(&chunk)
        .map_err(|e| ServerError::from(anyhow::anyhow!("write to tempfile failed: {e}")))
}

/// Test-only helper: run the same cap logic against an in-memory list of
/// chunks. This lets unit tests cover `write_chunk_with_cap` without
/// constructing a real `axum::multipart::Field`.
#[cfg(test)]
pub(crate) fn drain_chunks_to_tempfile(
    chunks: Vec<Bytes>,
    cap_bytes: u64,
) -> Result<(NamedTempFile, u64), ServerError> {
    let mut tmp = NamedTempFile::new()
        .map_err(|e| ServerError::from(anyhow::anyhow!("create tempfile failed: {e}")))?;
    let mut total: u64 = 0;
    for chunk in chunks {
        write_chunk_with_cap(&mut tmp, &mut total, chunk, cap_bytes)?;
    }
    Ok((tmp, total))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    #[test]
    fn small_chunks_within_cap_succeed() {
        // 3 chunks: 30 + 30 + 40 = 100 bytes; cap = 1024
        let chunks = vec![
            Bytes::from(vec![0u8; 30]),
            Bytes::from(vec![0u8; 30]),
            Bytes::from(vec![0u8; 40]),
        ];
        let (tmp, size) =
            drain_chunks_to_tempfile(chunks, 1024).expect("should succeed within cap");
        assert_eq!(size, 100);
        let written = std::fs::read(tmp.path()).unwrap();
        assert_eq!(written.len(), 100);
    }

    #[test]
    fn chunks_exceeding_cap_return_413() {
        // 3 chunks: 700 + 700 + 600 = 2000 bytes; cap = 1024
        let chunks = vec![
            Bytes::from(vec![1u8; 700]),
            Bytes::from(vec![1u8; 700]),
            Bytes::from(vec![1u8; 600]),
        ];
        let err = drain_chunks_to_tempfile(chunks, 1024)
            .expect_err("should reject oversized upload");
        assert_eq!(
            err.status,
            StatusCode::PAYLOAD_TOO_LARGE,
            "expected 413 PAYLOAD_TOO_LARGE, got {}",
            err.status
        );
    }
}
