use anki::deckconfig::UpdateDeckConfigsRequest;
use anki::prelude::*;
use anki_proto::deck_config::deck_configs_for_update::current_deck::Limits;
use anki_proto::deck_config::UpdateDeckConfigsMode;
use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiResult, ServerError};
use anyhow::anyhow;
use crate::state::AppState;

/// Subset of `DeckConfig` we expose in v1. Phase 9-N wires the three
/// highest-frequency knobs; Phase 9-O' adds the FSRS-6 params so the
/// settings page can hydrate the weights grid on mount instead of waiting
/// for a Re-optimize click each session. Per-deck overrides remain deferred.
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

const DEFAULT_PRESET_ID: DeckConfigId = DeckConfigId(1);

/// Read the seeded "Default" preset (id=1). All fresh collections include
/// this preset; it is the same row the desktop deck-options screen opens
/// when no other preset is chosen.
#[utoipa::path(
    get,
    path = "/api/deck_config/default",
    responses((status = 200, body = DeckConfigDefault))
)]
pub async fn get_default(
    State(state): State<AppState>,
) -> ApiResult<Json<DeckConfigDefault>> {
    let col = state.col.lock().await;
    let conf = col
        .get_deck_config(DEFAULT_PRESET_ID, true)?
        .ok_or_else(|| ServerError::from(anyhow!("default deck config missing")))?;
    Ok(Json(to_response(&conf)))
}

/// Patch the Default preset. Only the fields wired in v1 are honoured;
/// other fields are preserved from the current on-disk config.
///
/// Persistence path: `Collection::update_deck_configs` (the public API used
/// by the desktop deck-options screen). We pass through the current
/// collection-level FSRS/health flags so the bulk request does not
/// inadvertently flip them off.
#[utoipa::path(
    patch,
    path = "/api/deck_config/default",
    request_body = inline(serde_json::Value),
    responses((status = 200, body = DeckConfigDefault))
)]
pub async fn patch_default(
    State(state): State<AppState>,
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
    let mut conf = col
        .get_deck_config(DEFAULT_PRESET_ID, true)?
        .ok_or_else(|| ServerError::from(anyhow!("default deck config missing")))?;
    if let Some(r) = patch.desired_retention {
        conf.inner.desired_retention = r;
    }
    if let Some(m) = patch.maximum_review_interval {
        conf.inner.maximum_review_interval = m;
    }

    let fsrs = col.get_config_bool(BoolKey::Fsrs);
    let fsrs_health_check = col.get_config_bool(BoolKey::FsrsHealthCheck);
    let new_cards_ignore_review_limit =
        col.get_config_bool(BoolKey::NewCardsIgnoreReviewLimit);
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
        .get_deck_config(DEFAULT_PRESET_ID, true)?
        .ok_or_else(|| ServerError::from(anyhow!("default deck config missing")))?;
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
