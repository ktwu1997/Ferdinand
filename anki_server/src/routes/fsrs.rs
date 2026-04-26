use anki::deckconfig::UpdateDeckConfigsRequest;
use anki::prelude::*;
use anki::scheduler::fsrs::params::ComputeParamsRequest;
use anki_proto::deck_config::deck_configs_for_update::current_deck::Limits;
use anki_proto::deck_config::UpdateDeckConfigsMode;
use anyhow::anyhow;
use axum::extract::{Query, State};
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

/// Optional per-preset selector. Phase 14-B: pass `?preset_id=<id>` to
/// optimize only on cards in decks assigned to that preset; omit for
/// the v1 default-preset behavior (Phase 9-O3).
#[derive(Debug, Default, Deserialize)]
pub struct FsrsOptimizeQuery {
    #[serde(default)]
    pub preset_id: Option<i64>,
}

/// Pure-shape validation for the optimize query string. Same
/// `&'static str` extract pattern as the deck/note validators.
/// `preset_id` is optional; when present, must be positive (preset
/// ids are i64 epoch-ms in the wild; 0 / negatives are nonsense).
fn validate_optimize_query(q: &FsrsOptimizeQuery) -> Result<(), &'static str> {
    if let Some(id) = q.preset_id {
        if id <= 0 {
            return Err("preset_id must be a positive integer");
        }
    }
    Ok(())
}

/// True if at least one normal (non-filtered) deck has the given
/// preset assigned. Walks `get_all_deck_names(false)` and short-
/// circuits on the first match — O(decks) but on a localhost-single-
/// user collection that's a handful of cache hits at most.
///
/// Filtered decks have no `config_id` so they never match. The
/// implicit Default deck (id=1) DOES count — every fresh collection
/// has it assigned to preset id=1, so a `?preset_id=1` request always
/// passes this check.
fn deck_uses_preset(col: &mut Collection, preset_id: DeckConfigId) -> anyhow::Result<bool> {
    let names = col.get_all_deck_names(false)?;
    for (did, _) in names {
        if let Some(deck) = col.get_deck(did)? {
            if deck.config_id() == Some(preset_id) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Recompute FSRS parameters from the revlog and persist them, then
/// reschedule existing cards under the new params.
///
/// Phase 14-B: per-preset opt-in via `?preset_id=<id>`. Without the
/// query parameter the v1 Default-preset behavior is preserved
/// (Phase 9-O3 backward compat). With an explicit `preset_id`:
///   1. Validates id positive (400) — `validate_optimize_query`.
///   2. Looks up the preset with `fallback=false` so a missing id
///      surfaces as 404 (Phase 9-T `bug_caught` lesson — a silent
///      fallback to Default would train on the wrong dataset).
///   3. Pre-flights the deck assignment: if no normal deck uses
///      this preset, returns 400 with explicit copy. The training
///      search is `preset:<name>` which would otherwise return
///      zero cards and hit the Phase 9-R skip-noop branch — that's
///      not a silent error, but the explicit 400 lets the UI
///      surface a fix-it-yourself hint instead of "0 reviews
///      trained" (which looks like an empty-history collection).
///   4. Persists via `update_deck_configs` with `target_deck_id=0`
///      (Phase 13-B safety pattern — no silent reassignment).
///
/// Synchronous; can block from a few seconds (small collections) to
/// tens of seconds (10k+ reviews). Async progress reporting deferred.
///
/// Requires FSRS enabled — desktop mirrors this. With FSRS off the
/// optimize run produces parameters that would have no scheduling
/// effect, and triggering the post-optimize reschedule would write
/// FSRS memory state onto SM-2-managed cards.
#[utoipa::path(
    post,
    path = "/api/fsrs/optimize",
    responses(
        (status = 200, body = FsrsOptimizeResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    )
)]
pub async fn post_optimize(
    State(state): State<AppState>,
    Query(query): Query<FsrsOptimizeQuery>,
) -> ApiResult<Json<FsrsOptimizeResponse>> {
    validate_optimize_query(&query).map_err(ServerError::bad_request)?;

    let mut col = state.col.lock().await;

    if !col.get_config_bool(BoolKey::Fsrs) {
        return Err(ServerError::bad_request(
            "FSRS must be enabled before optimizing",
        ));
    }

    let target_preset_id = query
        .preset_id
        .map(DeckConfigId)
        .unwrap_or(DEFAULT_PRESET_ID);

    // Explicit preset_id: 404 on miss (no silent Default fallback).
    // Default path: Default preset always exists on a valid collection,
    // keep `with_fallback=true` for backward compat with Phase 9-O3.
    let mut conf = if query.preset_id.is_some() {
        col.get_deck_config(target_preset_id, false)?
            .ok_or_else(|| {
                ServerError::not_found(format!("preset {} not found", target_preset_id.0))
            })?
    } else {
        col.get_deck_config(target_preset_id, true)?
            .ok_or_else(|| ServerError::from(anyhow!("default deck config missing")))?
    };

    // Per-preset preflight: refuse to optimize a preset with no decks
    // assigned. The default-preset path skips this check because every
    // deck without an explicit assignment inherits id=1, so there's
    // always at least one consumer.
    if query.preset_id.is_some() && !deck_uses_preset(&mut col, target_preset_id)? {
        return Err(ServerError::bad_request(format!(
            "no decks use preset {}; assign it to at least one deck before optimizing",
            target_preset_id.0
        )));
    }

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

    // target_deck_id: per-preset path uses 0 (Phase 13-B safety pattern,
    // no silent reassignment). Default path keeps DeckId(1) for Phase
    // 9-O3 backward compat — DeckId(1) is the implicit Default deck and
    // both call sites are persisting the same Default preset, so the
    // distinction is mostly aesthetic but the existing tests / behavior
    // pin it.
    let target_deck_id = if query.preset_id.is_some() {
        DeckId(0)
    } else {
        DeckId(1)
    };

    let update = UpdateDeckConfigsRequest {
        target_deck_id,
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

    #[test]
    fn validate_optimize_query_accepts_preset_id_omitted() {
        // Default path — backward-compatible with Phase 9-O3 callers
        // that POST without query parameters.
        let q = FsrsOptimizeQuery::default();
        assert!(q.preset_id.is_none());
        assert!(validate_optimize_query(&q).is_ok());
    }

    #[test]
    fn validate_optimize_query_accepts_positive_preset_ids() {
        // Default preset id (1) and an epoch-ms id (real new presets
        // get epoch-ms ids) both pass the rule set.
        let q1 = FsrsOptimizeQuery {
            preset_id: Some(1),
        };
        assert!(validate_optimize_query(&q1).is_ok());
        let q2 = FsrsOptimizeQuery {
            preset_id: Some(1_777_223_641_337),
        };
        assert!(validate_optimize_query(&q2).is_ok());
        let q3 = FsrsOptimizeQuery {
            preset_id: Some(i64::MAX),
        };
        assert!(validate_optimize_query(&q3).is_ok());
    }

    #[test]
    fn validate_optimize_query_rejects_zero_preset_id() {
        // 0 is the sentinel reserved for "no specific deck" in
        // update_deck_configs.target_deck_id; reusing it for preset_id
        // would conflate two different meanings, so reject at the
        // boundary. Same rule as Phase 11-A `validate_preset_id`.
        let q = FsrsOptimizeQuery {
            preset_id: Some(0),
        };
        assert_eq!(
            validate_optimize_query(&q).unwrap_err(),
            "preset_id must be a positive integer"
        );
    }

    #[test]
    fn validate_optimize_query_rejects_negative_preset_id() {
        let q = FsrsOptimizeQuery {
            preset_id: Some(-1),
        };
        assert!(validate_optimize_query(&q).is_err());
        let q2 = FsrsOptimizeQuery {
            preset_id: Some(i64::MIN),
        };
        assert!(validate_optimize_query(&q2).is_err());
    }
}
