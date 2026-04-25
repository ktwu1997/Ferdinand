use anki::prelude::*;
use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::ApiResult;
use crate::state::AppState;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct FsrsEnabled {
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct FsrsToggle {
    pub enabled: bool,
}

/// Read the collection-level FSRS toggle (`BoolKey::Fsrs`). Unlike the
/// deck-options preset values, this flag is global to the collection.
#[utoipa::path(
    get,
    path = "/api/fsrs/enabled",
    responses((status = 200, body = FsrsEnabled))
)]
pub async fn get_enabled(State(state): State<AppState>) -> ApiResult<Json<FsrsEnabled>> {
    let col = state.col.lock().await;
    Ok(Json(FsrsEnabled {
        enabled: col.get_config_bool(BoolKey::Fsrs),
    }))
}

/// Set the collection-level FSRS toggle. v1 limitation: this writes the
/// bool only — it does NOT trigger memory-state recomputation for existing
/// cards (which the desktop deck-options screen does via
/// `update_deck_configs`). The next answer recomputes on demand. A full
/// reschedule pass is Phase 9-O work.
#[utoipa::path(
    put,
    path = "/api/fsrs/enabled",
    request_body = inline(serde_json::Value),
    responses((status = 200, body = FsrsEnabled))
)]
pub async fn put_enabled(
    State(state): State<AppState>,
    Json(req): Json<FsrsToggle>,
) -> ApiResult<Json<FsrsEnabled>> {
    let mut col = state.col.lock().await;
    col.set_config_bool(BoolKey::Fsrs, req.enabled, false)?;
    Ok(Json(FsrsEnabled {
        enabled: col.get_config_bool(BoolKey::Fsrs),
    }))
}
