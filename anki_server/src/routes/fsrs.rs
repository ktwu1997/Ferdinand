use anki::deckconfig::UpdateDeckConfigsRequest;
use anki::prelude::*;
use anki::scheduler::fsrs::params::ComputeParamsRequest;
use anki_proto::deck_config::deck_configs_for_update::current_deck::Limits;
use anki_proto::deck_config::UpdateDeckConfigsMode;
use anyhow::anyhow;
use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiResult, ServerError};
use crate::state::AppState;

const DEFAULT_PRESET_ID: DeckConfigId = DeckConfigId(1);

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct FsrsEnabled {
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct FsrsToggle {
    pub enabled: bool,
}

/// Result of a single-preset FSRS parameter optimization run.
///
/// `fsrs_items` is the number of training reviews extracted from the revlog
/// after filtering. When the count is below the FSRS author's recommended
/// minimum (~400) the trainer still runs but quality drops; the UI surfaces
/// the count so the user understands when "Re-optimize" did nothing useful.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct FsrsOptimizeResponse {
    pub fsrs_items: u32,
    pub params: Vec<f32>,
}

/// Returns true when newly trained params match the persisted ones — the
/// optimize run produced no improvement and persisting would be a no-op
/// reschedule. FSRS upstream behavior: `compute_params` keeps current params
/// when log-loss does not improve (rslib/src/scheduler/fsrs/params.rs).
fn params_unchanged(trained: &[f32], current: &[f32]) -> bool {
    trained == current
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

/// Set the collection-level FSRS toggle and trigger a memory-state reschedule
/// on the Default preset. Closes the Phase 9-N1 v1 limitation: previously
/// `set_config_bool` only flipped the flag; now we route through
/// `update_deck_configs(fsrs_reschedule: true)` so existing cards have their
/// FSRS memory state recomputed against current params (matching the desktop
/// deck-options screen).
///
/// Synchronous; may block several seconds on large collections while the
/// reschedule runs. Per-deck overrides remain Phase 9+ work.
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

    // Skip the update_deck_configs round-trip (which forces a full reschedule)
    // when the requested state already matches. Reschedule is expensive on
    // large collections; idempotent toggles must not pay that cost.
    let current_enabled = col.get_config_bool(BoolKey::Fsrs);
    if req.enabled == current_enabled {
        return Ok(Json(FsrsEnabled {
            enabled: current_enabled,
        }));
    }

    let conf = col
        .get_deck_config(DEFAULT_PRESET_ID, true)?
        .ok_or_else(|| ServerError::from(anyhow!("default deck config missing")))?;

    let fsrs_health_check = col.get_config_bool(BoolKey::FsrsHealthCheck);
    let new_cards_ignore_review_limit = col.get_config_bool(BoolKey::NewCardsIgnoreReviewLimit);
    let apply_all_parent_limits = col.get_config_bool(BoolKey::ApplyAllParentLimits);

    let update = UpdateDeckConfigsRequest {
        target_deck_id: DeckId(1),
        configs: vec![conf],
        removed_config_ids: vec![],
        mode: UpdateDeckConfigsMode::Normal,
        card_state_customizer: String::new(),
        limits: Limits::default(),
        new_cards_ignore_review_limit,
        apply_all_parent_limits,
        fsrs: req.enabled,
        fsrs_reschedule: true,
        fsrs_health_check,
    };
    col.update_deck_configs(update)?;

    Ok(Json(FsrsEnabled {
        enabled: col.get_config_bool(BoolKey::Fsrs),
    }))
}

/// Recompute FSRS parameters from the revlog for the Default preset and
/// persist them, then reschedule existing cards under the new params.
///
/// Synchronous; can block from a few seconds (small collections) to tens of
/// seconds (10k+ reviews). Async progress reporting is deferred.
///
/// Requires FSRS enabled — desktop mirrors this. With FSRS off the optimize
/// run produces parameters that would have no scheduling effect, and
/// triggering the post-optimize reschedule would write FSRS memory state
/// onto SM-2-managed cards.
#[utoipa::path(
    post,
    path = "/api/fsrs/optimize",
    responses(
        (status = 200, body = FsrsOptimizeResponse),
        (status = 400, body = crate::error::ApiError)
    )
)]
pub async fn post_optimize(State(state): State<AppState>) -> ApiResult<Json<FsrsOptimizeResponse>> {
    let mut col = state.col.lock().await;

    if !col.get_config_bool(BoolKey::Fsrs) {
        return Err(ServerError::bad_request(
            "FSRS must be enabled before optimizing",
        ));
    }

    let mut conf = col
        .get_deck_config(DEFAULT_PRESET_ID, true)?
        .ok_or_else(|| ServerError::from(anyhow!("default deck config missing")))?;

    let search = format!("\"preset:{}\" -is:suspended", conf.name);
    let num_of_relearning_steps = conf.inner.relearn_steps.len();
    let current_params = conf.fsrs_params().clone();

    let response = col.compute_params(ComputeParamsRequest {
        search: &search,
        ignore_revlogs_before_ms: 0.into(),
        current_preset: 1,
        total_presets: 1,
        current_params: &current_params,
        num_of_relearning_steps,
        health_check: false,
    })?;

    // No training data: skip persistence so we don't overwrite existing
    // trained params with the (echoed) input. UI surfaces the count.
    if response.fsrs_items == 0 {
        return Ok(Json(FsrsOptimizeResponse {
            fsrs_items: 0,
            params: current_params,
        }));
    }

    // Trained but no improvement: FSRS keeps `current_params` when log-loss
    // does not beat the previous params. Persisting and rescheduling under
    // identical params is wasted work — return the response unchanged.
    if params_unchanged(&response.params, &current_params) {
        return Ok(Json(FsrsOptimizeResponse {
            fsrs_items: response.fsrs_items,
            params: response.params,
        }));
    }

    conf.inner.fsrs_params_6 = response.params.clone();

    let fsrs_health_check = col.get_config_bool(BoolKey::FsrsHealthCheck);
    let new_cards_ignore_review_limit = col.get_config_bool(BoolKey::NewCardsIgnoreReviewLimit);
    let apply_all_parent_limits = col.get_config_bool(BoolKey::ApplyAllParentLimits);

    let update = UpdateDeckConfigsRequest {
        target_deck_id: DeckId(1),
        configs: vec![conf],
        removed_config_ids: vec![],
        mode: UpdateDeckConfigsMode::Normal,
        card_state_customizer: String::new(),
        limits: Limits::default(),
        new_cards_ignore_review_limit,
        apply_all_parent_limits,
        fsrs: true,
        fsrs_reschedule: true,
        fsrs_health_check,
    };
    col.update_deck_configs(update)?;

    Ok(Json(FsrsOptimizeResponse {
        fsrs_items: response.fsrs_items,
        params: response.params,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn params_unchanged_treats_empty_pair_as_match() {
        assert!(params_unchanged(&[], &[]));
    }

    #[test]
    fn params_unchanged_detects_identical_trained_params() {
        let p = vec![0.4, 0.6, 2.4, 5.8];
        assert!(params_unchanged(&p, &p));
    }

    #[test]
    fn params_unchanged_rejects_value_drift() {
        assert!(!params_unchanged(&[0.4, 0.6], &[0.4, 0.61]));
    }

    #[test]
    fn params_unchanged_rejects_length_mismatch() {
        assert!(!params_unchanged(&[], &[0.5]));
        assert!(!params_unchanged(&[0.5], &[0.5, 0.6]));
    }
}
