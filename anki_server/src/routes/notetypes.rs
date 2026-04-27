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
//!
//! Phase 19-A: PATCH widened to also accept `{templates: [{ord, qfmt,
//! afmt}]}` so the client can edit `{{Field}}`-style question / answer
//! formats per card template. At-least-one-of-name-or-templates is
//! enforced at the boundary — a no-op PATCH still returns 400 instead
//! of silently bumping mtime. New GET /api/notetypes/{id} exposes the
//! full notetype shape (fields + templates) so the editor can hydrate
//! without slurping every notetype on the collection. Field add/remove
//! still deferred to 19-B/C.
//!
//! Schema-mutation safety: template format edits don't touch the
//! field list, the card-to-note linkage, or the revlog — Collection::
//! update_notetype handles regenerating the parsed-template cache and
//! bumping mtime. No card regeneration is triggered for pure format
//! edits, so revlog and FSRS training data are untouched.

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

/// Phase 19-A: per-template payload returned by the GET detail and
/// PATCH responses. `qfmt` / `afmt` mirror Anki's `q_format` /
/// `a_format` (the `{{Field}}` template strings); `ord` is the stable
/// 0-indexed position in the notetype's template list.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct NotetypeTemplateSummary {
    pub ord: u32,
    pub name: String,
    pub qfmt: String,
    pub afmt: String,
}

/// Phase 19-A: full notetype detail — what the editor needs to render
/// the templates panel without a follow-up fetch. Returned by
/// GET /api/notetypes/{id} and PATCH /api/notetypes/{id} so the
/// client always has the canonical post-write state.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct NotetypeDetailResponse {
    pub id: i64,
    pub name: String,
    pub fields: Vec<String>,
    pub templates: Vec<NotetypeTemplateSummary>,
}

const NOTETYPE_NAME_MAX_CHARS: usize = 100;
/// Phase 19-A: per-format character cap. 65K covers any realistic
/// `{{Field}}` template (Anki's stock notetypes are all <2K) while
/// keeping the API resistant to multi-MB payloads that would dwarf
/// the rest of the collection.
const TEMPLATE_FORMAT_MAX_CHARS: usize = 65_000;

/// Phase 19-A: combined patch request. Either or both fields may be
/// supplied; if neither is present, the boundary returns 400 so a
/// silent no-op PATCH still surfaces as a request error.
#[derive(Debug, Deserialize)]
pub struct NotetypePatchRequest {
    /// New display name. Trimmed server-side; chars (not bytes) capped
    /// at 100 so CJK gets the same fairness budget as ASCII. No `::`
    /// separator rules — notetypes aren't hierarchical.
    pub name: Option<String>,
    /// Templates to overwrite, addressed by `ord`. Each ord must
    /// correspond to an existing template (ord >= template count → 400).
    /// Duplicate ords in the same request → 400. Templates not
    /// included in the patch are left untouched.
    pub templates: Option<Vec<NotetypeTemplatePatch>>,
}

#[derive(Debug, Deserialize)]
pub struct NotetypeTemplatePatch {
    pub ord: u32,
    pub qfmt: String,
    pub afmt: String,
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

/// Phase 19-A: pure-shape validation for a templates patch. No
/// Collection access. Rejects an empty list (forces the caller to
/// drop the field instead of sending `[]` to mean "no change"),
/// duplicate ords, and per-format empty / over-length payloads.
/// Callers still need to validate ord against the live template
/// count once the notetype is loaded — that's `validate_template_ords`.
fn validate_template_patches(
    templates: &[NotetypeTemplatePatch],
) -> Result<(), &'static str> {
    if templates.is_empty() {
        return Err("templates must not be empty");
    }
    let mut seen: Vec<u32> = Vec::with_capacity(templates.len());
    for t in templates {
        if seen.contains(&t.ord) {
            return Err("templates must have unique ord values");
        }
        seen.push(t.ord);
        if t.qfmt.trim().is_empty() {
            return Err("qfmt must not be empty");
        }
        if t.qfmt.chars().count() > TEMPLATE_FORMAT_MAX_CHARS {
            return Err("qfmt must be at most 65000 characters");
        }
        if t.afmt.trim().is_empty() {
            return Err("afmt must not be empty");
        }
        if t.afmt.chars().count() > TEMPLATE_FORMAT_MAX_CHARS {
            return Err("afmt must be at most 65000 characters");
        }
    }
    Ok(())
}

/// Phase 16-B + 19-A: rename a notetype and/or overwrite per-template
/// `qfmt` / `afmt` formats.
///
/// Validation order (cheap → expensive, mirroring 14-C):
///   1. id positive (400) — same boundary rule as the other path-
///      addressed handlers.
///   2. At-least-one-of-name-or-templates (400) — a request with both
///      omitted is a client bug, not a no-op.
///   3. Pure-shape validation on each present field (no Collection
///      access). Catches empty / over-length names + format payloads
///      and duplicate ords early.
///   4. Notetype lookup (404 — strict).
///   5. Per-template ord existence check against the loaded notetype
///      (400). Done before any mutation so a partial failure can't
///      leave the notetype half-edited.
///   6. Apply the diff in-place on a cloned `Notetype`, skipping the
///      transaction entirely when nothing actually changed (no-op
///      fast path mirrors the rename `nt.name == trimmed` case from
///      16-B).
///   7. `Collection::update_notetype` — transactional; bumps mtime,
///      refreshes the parsed-template cache, and regenerates affected
///      indexes. Pure format edits don't touch fields, card-to-note
///      linkage, or revlog, so FSRS training data is preserved.
///
/// `skip_checks=false` so Anki's full notetype validation still runs —
/// a malformed `{{Field}}` reference will surface as a TemplateError
/// (mapped to 400 via `ServerError`) instead of silently persisting.
#[utoipa::path(
    patch,
    path = "/api/notetypes/{id}",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = NotetypeDetailResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Notetype id"))
)]
pub async fn patch_by_id(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<NotetypePatchRequest>,
) -> ApiResult<Json<NotetypeDetailResponse>> {
    if id <= 0 {
        return Err(ServerError::bad_request("id must be a positive integer"));
    }
    if req.name.is_none() && req.templates.is_none() {
        return Err(ServerError::bad_request(
            "at least one of name or templates must be supplied",
        ));
    }

    let trimmed_name = match req.name.as_deref() {
        Some(n) => Some(
            validate_rename_name(n)
                .map_err(ServerError::bad_request)?
                .to_owned(),
        ),
        None => None,
    };

    if let Some(ts) = &req.templates {
        validate_template_patches(ts).map_err(ServerError::bad_request)?;
    }

    let mut col = state.col.lock().await;
    let ntid = NotetypeId(id);
    let arc = col
        .get_notetype(ntid)?
        .ok_or_else(|| ServerError::not_found(format!("notetype {id} not found")))?;

    // Clone the Arc inner so we can mutate without invalidating cached
    // shares. Same pattern as the deck rename path (Phase 9-S design
    // pattern: `let mut deck = (*deck).clone();`).
    let mut nt: anki::notetype::Notetype = (*arc).clone();
    let mut dirty = false;

    if let Some(name) = trimmed_name {
        if nt.name != name {
            nt.name = name;
            dirty = true;
        }
    }

    if let Some(patches) = req.templates {
        let template_count = nt.templates.len() as u32;
        // Validate every ord exists before mutating so a partial
        // failure can't leave the notetype half-edited.
        for t in &patches {
            if t.ord >= template_count {
                return Err(ServerError::bad_request(format!(
                    "template ord {} not found (notetype has {} templates)",
                    t.ord, template_count
                )));
            }
        }
        for t in patches {
            let tpl = &mut nt.templates[t.ord as usize];
            if tpl.config.q_format != t.qfmt {
                tpl.config.q_format = t.qfmt;
                dirty = true;
            }
            if tpl.config.a_format != t.afmt {
                tpl.config.a_format = t.afmt;
                dirty = true;
            }
        }
    }

    if dirty {
        col.update_notetype(&mut nt, false)?;
    }

    Ok(Json(notetype_detail_response(&nt)))
}

/// Phase 19-A: GET single-notetype detail. Mirrors the GET shape of
/// notes / cards / decks — a slim list endpoint plus a per-id detail
/// endpoint. The detail response includes `templates` (which the
/// list endpoint omits to keep the picker payload small) so the
/// browse editor can hydrate the Card Templates panel without
/// re-walking every notetype.
#[utoipa::path(
    get,
    path = "/api/notetypes/{id}",
    responses(
        (status = 200, body = NotetypeDetailResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Notetype id"))
)]
pub async fn get_by_id(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<NotetypeDetailResponse>> {
    if id <= 0 {
        return Err(ServerError::bad_request("id must be a positive integer"));
    }
    let mut col = state.col.lock().await;
    let ntid = NotetypeId(id);
    let arc = col
        .get_notetype(ntid)?
        .ok_or_else(|| ServerError::not_found(format!("notetype {id} not found")))?;
    Ok(Json(notetype_detail_response(&arc)))
}

pub(super) fn notetype_detail_response(
    nt: &anki::notetype::Notetype,
) -> NotetypeDetailResponse {
    NotetypeDetailResponse {
        id: nt.id.0,
        name: nt.name.clone(),
        fields: nt.fields.iter().map(|f| f.name.clone()).collect(),
        templates: nt
            .templates
            .iter()
            .enumerate()
            .map(|(idx, t)| NotetypeTemplateSummary {
                ord: idx as u32,
                name: t.name.clone(),
                qfmt: t.config.q_format.clone(),
                afmt: t.config.a_format.clone(),
            })
            .collect(),
    }
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

    fn make_patch(ord: u32, q: &str, a: &str) -> NotetypeTemplatePatch {
        NotetypeTemplatePatch {
            ord,
            qfmt: q.to_string(),
            afmt: a.to_string(),
        }
    }

    #[test]
    fn validate_template_patches_accepts_typical() {
        let patches = vec![
            make_patch(0, "{{Front}}", "{{FrontSide}}<hr id=answer>{{Back}}"),
            make_patch(1, "{{Back}}", "{{FrontSide}}<hr id=answer>{{Front}}"),
        ];
        assert!(validate_template_patches(&patches).is_ok());
    }

    #[test]
    fn validate_template_patches_rejects_empty_list() {
        let patches: Vec<NotetypeTemplatePatch> = vec![];
        assert_eq!(
            validate_template_patches(&patches).unwrap_err(),
            "templates must not be empty"
        );
    }

    #[test]
    fn validate_template_patches_rejects_duplicate_ords() {
        // Duplicate ord 0 — would otherwise overwrite itself in the
        // apply pass with whichever patch came last; rejecting at
        // boundary makes the contract obvious.
        let patches = vec![
            make_patch(0, "{{Front}}", "{{Back}}"),
            make_patch(0, "{{Front2}}", "{{Back2}}"),
        ];
        assert_eq!(
            validate_template_patches(&patches).unwrap_err(),
            "templates must have unique ord values"
        );
    }

    #[test]
    fn validate_template_patches_rejects_blank_formats() {
        // Blank qfmt — would render an empty front, breaking the card.
        for blank in ["", "   ", "\t\n"] {
            let patches = vec![make_patch(0, blank, "{{Back}}")];
            assert_eq!(
                validate_template_patches(&patches).unwrap_err(),
                "qfmt must not be empty",
                "blank qfmt={blank:?}"
            );
        }
        // Blank afmt — same logic, separate error message so a UI
        // error toast can pinpoint which side was wrong.
        for blank in ["", "   ", "\t\n"] {
            let patches = vec![make_patch(0, "{{Front}}", blank)];
            assert_eq!(
                validate_template_patches(&patches).unwrap_err(),
                "afmt must not be empty",
                "blank afmt={blank:?}"
            );
        }
    }

    #[test]
    fn validate_template_patches_enforces_format_length_cap() {
        // 65000 chars passes for both q and a; one over fails. Same
        // chars-not-bytes pattern as the rename validator so a CJK
        // template gets the same budget as an ASCII one.
        let q_ok = "a".repeat(65_000);
        let q_too_long = "a".repeat(65_001);
        let patches_ok = vec![make_patch(0, &q_ok, "{{Back}}")];
        assert!(validate_template_patches(&patches_ok).is_ok());

        let patches_q_long = vec![make_patch(0, &q_too_long, "{{Back}}")];
        assert_eq!(
            validate_template_patches(&patches_q_long).unwrap_err(),
            "qfmt must be at most 65000 characters"
        );

        let patches_a_long = vec![make_patch(0, "{{Front}}", &q_too_long)];
        assert_eq!(
            validate_template_patches(&patches_a_long).unwrap_err(),
            "afmt must be at most 65000 characters"
        );
    }
}
