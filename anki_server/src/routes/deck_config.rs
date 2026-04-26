use anki::deckconfig::UpdateDeckConfigsRequest;
use anki::prelude::*;
use anki_proto::deck_config::deck_configs_for_update::current_deck::Limits;
use anki_proto::deck_config::UpdateDeckConfigsMode;
use anyhow::anyhow;
use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiResult, ServerError};
use crate::state::AppState;

/// Subset of `DeckConfig` we expose in v1. Phase 9-N wires the three
/// highest-frequency knobs; Phase 9-O' adds the FSRS-6 params so the
/// settings page can hydrate the weights grid on mount instead of waiting
/// for a Re-optimize click each session. Phase 9-O'' generalizes the same
/// shape to any preset (the JSON name is kept for backwards compatibility
/// — the response shape is preset-agnostic, not "default-only").
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DeckConfigDefault {
    pub id: i64,
    pub name: String,
    /// FSRS desired retention (0.70..=0.97).
    pub desired_retention: f32,
    /// Maximum review interval in days (1..=36500).
    pub maximum_review_interval: u32,
    /// Persisted FSRS-6 parameters. Empty when the preset has never been
    /// optimized; populated by Phase 9-O `POST /api/fsrs/optimize`.
    pub fsrs_params: Vec<f32>,
}

#[derive(Debug, Deserialize)]
pub struct DeckConfigPatch {
    pub desired_retention: Option<f32>,
    pub maximum_review_interval: Option<u32>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DeckConfigListItem {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DeckConfigListResponse {
    pub configs: Vec<DeckConfigListItem>,
}

const DEFAULT_PRESET_ID: DeckConfigId = DeckConfigId(1);

/// List all deck configs (presets) sorted by name. Used by Phase 9-O'' to
/// populate the settings preset selector. The list is intentionally lean —
/// only id + name — so the dropdown stays cheap and the per-preset detail
/// fetch (`GET /api/deck_config/{id}`) remains the source of truth for
/// editable fields.
#[utoipa::path(
    get,
    path = "/api/deck_config",
    responses((status = 200, body = DeckConfigListResponse))
)]
pub async fn list_deck_configs(
    State(state): State<AppState>,
) -> ApiResult<Json<DeckConfigListResponse>> {
    let mut col = state.col.lock().await;
    // Reuse the desktop deck-options helper which returns all configs
    // sorted by name. `DeckId(1)` only shapes `current_deck` (which we
    // discard); the `all_config` field is preset-list-source-of-truth.
    let bundle = col.get_deck_configs_for_update(DeckId(1))?;
    let configs = bundle
        .all_config
        .into_iter()
        .filter_map(|cwe| cwe.config)
        .map(|c| DeckConfigListItem {
            id: c.id,
            name: c.name,
        })
        .collect();
    Ok(Json(DeckConfigListResponse { configs }))
}

/// Read the seeded "Default" preset (id=1). All fresh collections include
/// this preset; it is the same row the desktop deck-options screen opens
/// when no other preset is chosen. Kept as a stable alias of
/// `GET /api/deck_config/1` so existing clients (Phase 9-N+) do not need
/// to know the numeric id.
#[utoipa::path(
    get,
    path = "/api/deck_config/default",
    responses((status = 200, body = DeckConfigDefault))
)]
pub async fn get_default(state: State<AppState>) -> ApiResult<Json<DeckConfigDefault>> {
    get_by_id(state, Path(DEFAULT_PRESET_ID.0)).await
}

/// Patch the Default preset (alias for `PATCH /api/deck_config/1`).
#[utoipa::path(
    patch,
    path = "/api/deck_config/default",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = DeckConfigDefault),
        (status = 400, body = crate::error::ApiError),
    )
)]
pub async fn patch_default(
    state: State<AppState>,
    patch: Json<DeckConfigPatch>,
) -> ApiResult<Json<DeckConfigDefault>> {
    patch_by_id(state, Path(DEFAULT_PRESET_ID.0), patch).await
}

/// Read a preset by id. Phase 9-O''.
#[utoipa::path(
    get,
    path = "/api/deck_config/{id}",
    responses(
        (status = 200, body = DeckConfigDefault),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Deck config id"))
)]
pub async fn get_by_id(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<DeckConfigDefault>> {
    let col = state.col.lock().await;
    let dcid = DeckConfigId(id);
    // fallback=false: missing id must surface as 404 instead of silently
    // returning the Default preset. The /default alias keeps fallback=true
    // semantics through patch_default → patch_by_id with id=1 (the row that
    // is guaranteed to exist on every fresh collection).
    let conf = col
        .get_deck_config(dcid, false)?
        .ok_or_else(|| ServerError::not_found(format!("deck_config {id} not found")))?;
    Ok(Json(to_response(&conf)))
}

/// Patch a preset by id. Only the fields wired in v1 are honoured; other
/// fields are preserved from the current on-disk config.
///
/// Persistence path: `Collection::update_deck_configs` (the public API used
/// by the desktop deck-options screen). We pass through the current
/// collection-level FSRS/health flags so the bulk request does not
/// inadvertently flip them off.
#[utoipa::path(
    patch,
    path = "/api/deck_config/{id}",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = DeckConfigDefault),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Deck config id"))
)]
pub async fn patch_by_id(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(patch): Json<DeckConfigPatch>,
) -> ApiResult<Json<DeckConfigDefault>> {
    if let Some(r) = patch.desired_retention {
        if !(0.70..=0.97).contains(&r) || !r.is_finite() {
            return Err(ServerError::bad_request(
                "desired_retention must be between 0.70 and 0.97",
            ));
        }
    }
    if let Some(m) = patch.maximum_review_interval {
        if !(1..=36_500).contains(&m) {
            return Err(ServerError::bad_request(
                "maximum_review_interval must be between 1 and 36500",
            ));
        }
    }

    let mut col = state.col.lock().await;
    let dcid = DeckConfigId(id);
    // fallback=false: do not silently re-route missing-id writes onto the
    // Default preset. /default keeps the fallback semantics via the
    // patch_default → patch_by_id(1) alias.
    let mut conf = col
        .get_deck_config(dcid, false)?
        .ok_or_else(|| ServerError::not_found(format!("deck_config {id} not found")))?;
    if let Some(r) = patch.desired_retention {
        conf.inner.desired_retention = r;
    }
    if let Some(m) = patch.maximum_review_interval {
        conf.inner.maximum_review_interval = m;
    }

    let fsrs = col.get_config_bool(BoolKey::Fsrs);
    let fsrs_health_check = col.get_config_bool(BoolKey::FsrsHealthCheck);
    let new_cards_ignore_review_limit = col.get_config_bool(BoolKey::NewCardsIgnoreReviewLimit);
    let apply_all_parent_limits = col.get_config_bool(BoolKey::ApplyAllParentLimits);

    let req = UpdateDeckConfigsRequest {
        target_deck_id: DeckId(1),
        configs: vec![conf.clone()],
        removed_config_ids: vec![],
        mode: UpdateDeckConfigsMode::Normal,
        card_state_customizer: String::new(),
        limits: Limits::default(),
        new_cards_ignore_review_limit,
        apply_all_parent_limits,
        fsrs,
        fsrs_reschedule: false,
        fsrs_health_check,
    };
    col.update_deck_configs(req)?;

    let updated = col
        .get_deck_config(dcid, false)?
        .ok_or_else(|| ServerError::from(anyhow!("deck_config {id} disappeared post-update")))?;
    Ok(Json(to_response(&updated)))
}

fn to_response(c: &DeckConfig) -> DeckConfigDefault {
    DeckConfigDefault {
        id: c.id.0,
        name: c.name.clone(),
        desired_retention: c.inner.desired_retention,
        maximum_review_interval: c.inner.maximum_review_interval,
        fsrs_params: c.inner.fsrs_params_6.clone(),
    }
}
