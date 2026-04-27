//! Phase 13-C: notetype listing. GET /api/notetypes returns every
//! notetype on the collection with its field names so the client can
//! drive a notetype picker without a follow-up per-id fetch. Names are
//! the only per-field datum exposed in v1 — they're enough to label
//! input rows on the Add Note form. Configuration (font, RTL, plain
//! text, etc.) stays server-side until a real notetype editor surface
//! exists.
//!
//! Phase 16-B: PATCH /api/notetypes/{id} accepts `{name}` for inline
//! rename. Field add/remove + template editing remain v0 surface and
//! stay deferred — rename is the highest-leverage edit because it
//! drives the picker labels, the Browse "Notetype" eyebrow on each
//! row, and the future notetype-stats bucketing.

use anki::notetype::NotetypeId;
use anki::prelude::*;
use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiResult, ServerError};
use crate::state::AppState;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct NotetypeSummary {
    pub id: i64,
    pub name: String,
    /// Field names in template order. Length == field count, so the
    /// client can also drive show/hide on a fixed Front/Back/Extra
    /// row layout if it doesn't want per-name labels.
    pub fields: Vec<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct NotetypeListResponse {
    pub notetypes: Vec<NotetypeSummary>,
}

const NOTETYPE_NAME_MAX_CHARS: usize = 100;

#[derive(Debug, Deserialize)]
pub struct NotetypeRenameRequest {
    /// New display name. Trimmed server-side; chars (not bytes) capped
    /// at 100 so CJK gets the same fairness budget as ASCII. No `::`
    /// separator rules — notetypes aren't hierarchical.
    pub name: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct NotetypeRenameResponse {
    pub id: i64,
    /// Server-canonical name after trim. Echoed back so a client that
    /// sent `"  Basic   "` sees the persisted `"Basic"` without a
    /// follow-up GET.
    pub name: String,
}

/// Pure-shape validation for a rename request. Same `&'static str`
/// extract pattern as the deck `validate_create_name` (Phase 14-C).
/// Counts chars-not-bytes — a 100-char Japanese notetype name passes,
/// 101 fails. No `::` rules because notetypes are flat.
fn validate_rename_name(name: &str) -> Result<&str, &'static str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("name must not be empty");
    }
    if trimmed.chars().count() > NOTETYPE_NAME_MAX_CHARS {
        return Err("name must be at most 100 characters");
    }
    Ok(trimmed)
}

/// Phase 16-B: rename a notetype.
///
/// Validation order (cheap → expensive, mirroring 14-C):
///   1. id positive (400) — same boundary rule as the other path-
///      addressed handlers.
///   2. Request shape via `validate_rename_name` (extracted, no
///      Collection access). Catches empty / over-length names early.
///   3. Notetype lookup (404 — strict).
///   4. `Collection::update_notetype` — transactional update path
///      that bumps `mtime`, refreshes the notetype cache, and
///      regenerates affected indexes. Rename has no card-side effect:
///      cards are linked by notetype_id, so a name change is a pure
///      label refresh.
///
/// `skip_checks=false` so Anki's full notetype validation still runs;
/// a rename should never disable invariants the rest of the codebase
/// depends on.
#[utoipa::path(
    patch,
    path = "/api/notetypes/{id}",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = NotetypeRenameResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Notetype id"))
)]
pub async fn patch_by_id(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<NotetypeRenameRequest>,
) -> ApiResult<Json<NotetypeRenameResponse>> {
    if id <= 0 {
        return Err(ServerError::bad_request("id must be a positive integer"));
    }
    let trimmed = validate_rename_name(&req.name).map_err(ServerError::bad_request)?;
    let trimmed = trimmed.to_owned();

    let mut col = state.col.lock().await;
    let ntid = NotetypeId(id);
    let arc = col
        .get_notetype(ntid)?
        .ok_or_else(|| ServerError::not_found(format!("notetype {id} not found")))?;

    // Clone the Arc inner so we can mutate without invalidating cached
    // shares. Same pattern as the deck rename path (Phase 9-S design
    // pattern: `let mut deck = (*deck).clone();`).
    let mut nt: anki::notetype::Notetype = (*arc).clone();
    if nt.name == trimmed {
        // No-op rename — return the current persisted name without
        // touching the transaction. Same fast-path the FSRS health-check
        // toggle uses; avoids a needless mtime bump on accidental
        // double-clicks.
        return Ok(Json(NotetypeRenameResponse {
            id: nt.id.0,
            name: nt.name.clone(),
        }));
    }
    nt.name = trimmed;
    col.update_notetype(&mut nt, false)?;

    Ok(Json(NotetypeRenameResponse {
        id: nt.id.0,
        name: nt.name.clone(),
    }))
}

/// List every notetype on the collection (including the seeded Basic /
/// Basic-and-Reverse / Cloze / Image-Occlusion). Sorted by name to match
/// the desktop "Tools → Manage Note Types" dialog ordering, so the picker
/// dropdown is predictable.
#[utoipa::path(
    get,
    path = "/api/notetypes",
    responses((status = 200, body = NotetypeListResponse))
)]
pub async fn list_notetypes(
    State(state): State<AppState>,
) -> ApiResult<Json<NotetypeListResponse>> {
    let mut col = state.col.lock().await;
    // get_all_notetypes returns Vec<Arc<Notetype>>; we clone field names
    // out into owned Strings since the response is serialized synchronously
    // on this task. The Arc is dropped at the end of this scope so the
    // notetype cache stays warm without a long-lived reference.
    let notetypes = col.get_all_notetypes()?;
    let mut summaries: Vec<NotetypeSummary> = notetypes
        .iter()
        .map(|nt| NotetypeSummary {
            id: nt.id.0,
            name: nt.name.clone(),
            fields: nt.fields.iter().map(|f| f.name.clone()).collect(),
        })
        .collect();
    // Sort by name, case-insensitive — matches the desktop dialog and
    // keeps "Basic" above "Basic (and reversed card)" without locale
    // surprises across glibc / icu builds.
    summaries.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(Json(NotetypeListResponse {
        notetypes: summaries,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_rename_name_accepts_typical_and_trims() {
        assert_eq!(validate_rename_name("Basic").unwrap(), "Basic");
        // CJK names get the same chars-not-bytes budget as ASCII.
        assert_eq!(validate_rename_name("基本").unwrap(), "基本");
        // Trims leading/trailing whitespace — same hygiene rule as
        // deck rename (Phase 14-C).
        assert_eq!(validate_rename_name("  Padded  ").unwrap(), "Padded");
    }

    #[test]
    fn validate_rename_name_rejects_blank() {
        for blank in ["", "   ", "\t\n"] {
            assert_eq!(
                validate_rename_name(blank).unwrap_err(),
                "name must not be empty",
                "blank={blank:?}"
            );
        }
    }

    #[test]
    fn validate_rename_name_enforces_chars_not_bytes_budget() {
        // 100 ASCII chars passes.
        let ascii_100 = "a".repeat(100);
        assert_eq!(validate_rename_name(&ascii_100).unwrap(), ascii_100);
        // 101 ASCII chars fails.
        let ascii_101 = "a".repeat(101);
        assert_eq!(
            validate_rename_name(&ascii_101).unwrap_err(),
            "name must be at most 100 characters"
        );
        // 100 CJK chars passes — even though byte length is ~300, the
        // budget counts characters so language fairness holds. Same rule
        // as Phase 14-C deck name validation.
        let cjk_100 = "森".repeat(100);
        assert_eq!(cjk_100.chars().count(), 100);
        assert!(validate_rename_name(&cjk_100).is_ok());
        // 101 CJK chars fails.
        let cjk_101 = "森".repeat(101);
        assert!(validate_rename_name(&cjk_101).is_err());
    }
}
