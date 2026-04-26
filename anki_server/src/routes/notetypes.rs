//! Phase 13-C: notetype listing. GET /api/notetypes returns every
//! notetype on the collection with its field names so the client can
//! drive a notetype picker without a follow-up per-id fetch. Names are
//! the only per-field datum exposed in v1 — they're enough to label
//! input rows on the Add Note form. Configuration (font, RTL, plain
//! text, etc.) stays server-side until a real notetype editor surface
//! exists.

use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::error::ApiResult;
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
