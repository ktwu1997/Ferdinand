//! Phase 19-B: notetype field add. POST /api/notetypes/{id}/fields with
//! `{name: string}` appends a new field to the notetype, padding every
//! existing note with an empty string in the new slot. Implementation
//! goes through `Collection::update_notetype` so Anki's full schema-
//! change machinery handles the per-note pad: cards/revlog/notes counts
//! are unchanged, only the per-note field length grows by one.
//!
//! Schema-mutation safety: the only invariant the user-facing UI cares
//! about is that no card render breaks and no revlog row gets dropped.
//! `update_notetype(&mut nt, false)` keeps `skip_checks=false` so a
//! field-name collision (which fix_field_names auto-renames) won't
//! land silently — the boundary `validate_field_name` rejects bad
//! characters up front so a user typo doesn't get auto-mangled into
//! something they didn't ask for.
//!
//! 19-C will reuse this module's path-extractor and helper for the
//! DELETE /api/notetypes/{id}/fields/{ord} surface; the field name
//! validator stays add-only since DELETE doesn't take a name payload.

use anki::notetype::NoteField;
use anki::notetype::NotetypeId;
use anki::prelude::*;
use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;

use crate::error::{ApiResult, ServerError};
use crate::routes::notetypes::{notetype_detail_response, NotetypeDetailResponse};
use crate::state::AppState;

const FIELD_NAME_MAX_CHARS: usize = 100;

#[derive(Debug, Deserialize)]
pub struct FieldAddRequest {
    /// Display name for the new field. Trimmed at the boundary;
    /// chars-not-bytes capped at 100 (matches notetype + deck name
    /// budgets). Bad characters (`:` `{` `}` `"`) are rejected
    /// up-front instead of letting rslib's `fix_field_names` strip
    /// them — silent normalization of user input is exactly the
    /// surprise we want to avoid for a destructive-adjacent edit.
    pub name: String,
}

/// Pure-shape validation for an add-field request. Same `&'static str`
/// extract pattern as the notetype rename / template validators
/// (Phase 16-B / 19-A) so the route handler stays a thin orchestration
/// layer over a unit-testable function.
fn validate_field_name(name: &str) -> Result<&str, &'static str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("name must not be empty");
    }
    if trimmed.chars().count() > FIELD_NAME_MAX_CHARS {
        return Err("name must be at most 100 characters");
    }
    // Anki's `NoteField::fix_name` strips `:` / `{` / `}` / `"` since
    // they collide with template-language meta. Rejecting at the
    // boundary surfaces a clear 400 instead of letting the persisted
    // name silently differ from what the user typed.
    for ch in [':', '{', '}', '"'] {
        if trimmed.contains(ch) {
            return Err("name must not contain :, {, }, or \"");
        }
    }
    Ok(trimmed)
}

/// Phase 19-B: append a new field to a notetype.
///
/// Validation order (cheap → expensive, mirroring 19-A):
///   1. id positive (400).
///   2. Pure-shape validation on the name (no Collection access).
///   3. Notetype lookup (404 — strict).
///   4. Duplicate-name check against the existing fields (400).
///   5. `Collection::update_notetype` — transactional. The schema-
///      change machinery pads every existing note with an empty
///      string in the new slot and bumps mtime; no card regeneration
///      is triggered for an additive field-only change.
///
/// Returns the canonical post-write notetype detail (id, name,
/// fields, templates) so the client doesn't need to refetch.
#[utoipa::path(
    post,
    path = "/api/notetypes/{id}/fields",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = NotetypeDetailResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Notetype id"))
)]
pub async fn post_add_field(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<FieldAddRequest>,
) -> ApiResult<Json<NotetypeDetailResponse>> {
    if id <= 0 {
        return Err(ServerError::bad_request("id must be a positive integer"));
    }
    let trimmed = validate_field_name(&req.name)
        .map_err(ServerError::bad_request)?
        .to_owned();

    let mut col = state.col.lock().await;
    let ntid = NotetypeId(id);
    let arc = col
        .get_notetype(ntid)?
        .ok_or_else(|| ServerError::not_found(format!("notetype {id} not found")))?;

    let mut nt: anki::notetype::Notetype = (*arc).clone();
    if nt.fields.iter().any(|f| f.name == trimmed) {
        return Err(ServerError::bad_request(format!(
            "field name {trimmed:?} already exists on this notetype"
        )));
    }
    nt.fields.push(NoteField::new(trimmed));
    col.update_notetype(&mut nt, false)?;

    Ok(Json(notetype_detail_response(&nt)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_field_name_accepts_typical_and_trims() {
        assert_eq!(validate_field_name("Front").unwrap(), "Front");
        // CJK names get the same chars-not-bytes budget as ASCII.
        assert_eq!(validate_field_name("基本欄位").unwrap(), "基本欄位");
        // Trims leading/trailing whitespace — same hygiene rule as
        // the notetype rename / deck name validators.
        assert_eq!(validate_field_name("  Padded  ").unwrap(), "Padded");
    }

    #[test]
    fn validate_field_name_rejects_blank() {
        for blank in ["", "   ", "\t\n"] {
            assert_eq!(
                validate_field_name(blank).unwrap_err(),
                "name must not be empty",
                "blank={blank:?}"
            );
        }
    }

    #[test]
    fn validate_field_name_enforces_chars_not_bytes_budget() {
        // 100 ASCII chars passes.
        let ascii_100 = "a".repeat(100);
        assert_eq!(validate_field_name(&ascii_100).unwrap(), ascii_100);
        // 101 ASCII chars fails.
        let ascii_101 = "a".repeat(101);
        assert_eq!(
            validate_field_name(&ascii_101).unwrap_err(),
            "name must be at most 100 characters"
        );
        // 100 CJK chars passes — even though byte length is ~300, the
        // budget counts characters so language fairness holds.
        let cjk_100 = "森".repeat(100);
        assert_eq!(cjk_100.chars().count(), 100);
        assert!(validate_field_name(&cjk_100).is_ok());
    }

    #[test]
    fn validate_field_name_rejects_template_meta_chars() {
        // The four characters Anki's NoteField::fix_name strips. We
        // reject at the boundary so the persisted name matches what
        // the user typed — silent normalization on a destructive-
        // adjacent edit is exactly the surprise we want to avoid.
        for bad in [':', '{', '}', '"'] {
            let s = format!("foo{bad}bar");
            assert_eq!(
                validate_field_name(&s).unwrap_err(),
                "name must not contain :, {, }, or \"",
                "should reject {bad:?}"
            );
        }
    }
}
