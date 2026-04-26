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
    /// Daily cap on newly introduced cards (0..=9999). 0 pauses new cards.
    pub new_per_day: u32,
    /// Daily cap on review cards (0..=9999). 0 pauses reviews.
    pub reviews_per_day: u32,
    /// Soft per-card answer-time cap in seconds for "good"-side ratings
    /// (1..=600). The desktop default is 60.
    pub cap_answer_time_secs: u32,
    /// Persisted FSRS-6 parameters. Empty when the preset has never been
    /// optimized; populated by Phase 9-O `POST /api/fsrs/optimize`.
    pub fsrs_params: Vec<f32>,
}

#[derive(Debug, Deserialize)]
pub struct DeckConfigPatch {
    pub desired_retention: Option<f32>,
    pub maximum_review_interval: Option<u32>,
    pub new_per_day: Option<u32>,
    pub reviews_per_day: Option<u32>,
    pub cap_answer_time_secs: Option<u32>,
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

#[derive(Debug, Deserialize)]
pub struct DeckConfigCreateRequest {
    /// Human-readable preset name. Trimmed before storage; max 100 chars.
    pub name: String,
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
    if let Err(msg) = validate_patch(&patch) {
        return Err(ServerError::bad_request(msg));
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
    if let Some(n) = patch.new_per_day {
        conf.inner.new_per_day = n;
    }
    if let Some(r) = patch.reviews_per_day {
        conf.inner.reviews_per_day = r;
    }
    if let Some(c) = patch.cap_answer_time_secs {
        conf.inner.cap_answer_time_to_secs = c;
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

/// Phase 12-B: create a new preset by name. The new config inherits all
/// per-preset defaults (`DeckConfig::default()`); subsequent
/// `PATCH /api/deck_config/{id}` calls dial in the editable knobs.
///
/// Persistence path: `Collection::update_deck_configs` with
/// `target_deck_id=DeckId(0)`. Passing a non-existent deck id keeps the
/// upstream "selected deck reassign" branch from firing for any real
/// deck — the new preset is added to storage but no existing deck has
/// its `config_id` silently flipped. (Phase 9-T `bug_caught` lesson:
/// don't let create endpoints have hidden reassignment side effects.)
///
/// After the write, the new id (epoch-ms, assigned inside
/// `add_deck_config_inner`) is recovered by finding the config with the
/// just-written name. Names are pre-validated unique so the lookup is
/// unambiguous.
#[utoipa::path(
    post,
    path = "/api/deck_config",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = DeckConfigListItem),
        (status = 400, body = crate::error::ApiError),
    )
)]
pub async fn post_create(
    State(state): State<AppState>,
    Json(req): Json<DeckConfigCreateRequest>,
) -> ApiResult<Json<DeckConfigListItem>> {
    let name = validate_create_name(&req.name)
        .map_err(ServerError::bad_request)?
        .to_string();

    let mut col = state.col.lock().await;

    // Duplicate-name check against the live preset list. Anki's storage
    // layer would happily accept a duplicate-named preset (id-keyed
    // primary key), so this guard lives at the API boundary.
    let existing = col.get_deck_configs_for_update(DeckId(1))?;
    if existing
        .all_config
        .iter()
        .filter_map(|cwe| cwe.config.as_ref())
        .any(|c| c.name == name)
    {
        return Err(ServerError::bad_request("preset name already exists"));
    }

    // id=0 triggers the upstream add path
    // (`Collection::add_or_update_deck_config` -> `add_deck_config_inner`),
    // which assigns a fresh epoch-ms id during update_deck_configs.
    let mut new_config = DeckConfig::default();
    new_config.name = name.clone();

    let fsrs = col.get_config_bool(BoolKey::Fsrs);
    let fsrs_health_check = col.get_config_bool(BoolKey::FsrsHealthCheck);
    let new_cards_ignore_review_limit = col.get_config_bool(BoolKey::NewCardsIgnoreReviewLimit);
    let apply_all_parent_limits = col.get_config_bool(BoolKey::ApplyAllParentLimits);

    let request = UpdateDeckConfigsRequest {
        // DeckId(0) does not match any real deck, so the rslib loop that
        // reassigns selected decks' config_id (update.rs:233) never fires
        // and no deck is silently retargeted to the new preset.
        target_deck_id: DeckId(0),
        configs: vec![new_config],
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
    col.update_deck_configs(request)?;

    // Recover the assigned id by name. The pre-write duplicate check
    // guarantees exactly one match.
    let bundle = col.get_deck_configs_for_update(DeckId(1))?;
    let created = bundle
        .all_config
        .into_iter()
        .filter_map(|cwe| cwe.config)
        .find(|c| c.name == name)
        .ok_or_else(|| ServerError::from(anyhow!("created preset {name} disappeared post-write")))?;

    Ok(Json(DeckConfigListItem {
        id: created.id,
        name: created.name,
    }))
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DeckConfigDeleteResponse {
    pub removed_config_id: i64,
}

/// Phase 13-B: delete a preset by id.
///
/// Deleting the seeded Default preset (id=1) is rejected at the API
/// boundary (400) — every collection needs at least one preset, and
/// rslib's reassignment loop falls back to `configs.last()` for orphaned
/// decks, so dropping Default would leave the only-config case
/// undefined. Missing ids return 404 (path-addressed; same strict
/// `fallback=false` semantics as `get_by_id` / `patch_by_id`).
///
/// Persistence path: `Collection::update_deck_configs` with
/// `removed_config_ids=[id]`. The endpoint must still pass a non-empty
/// `configs` slice (rslib `update.rs:160` `require!`); we send the
/// Default config as a no-op upsert placeholder. `target_deck_id=0` —
/// matching the Phase 12-B create trick — keeps the per-deck
/// reassignment loop from firing for any real deck via the
/// "selected_deck_ids" branch (DeckId(0) doesn't match anything).
///
/// Side effect, by upstream design: decks whose `config_id` was the
/// removed id get reassigned to `configs.last()` (= Default in our
/// placeholder vec) via the "previous config removed" branch in
/// rslib `update.rs:233-241`. This is the same behaviour the desktop
/// deck-options screen produces — orphan decks fall back to Default.
#[utoipa::path(
    delete,
    path = "/api/deck_config/{id}",
    responses(
        (status = 200, body = DeckConfigDeleteResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Deck config id"))
)]
pub async fn delete_by_id(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<DeckConfigDeleteResponse>> {
    validate_delete_id(id).map_err(ServerError::bad_request)?;

    let mut col = state.col.lock().await;
    let dcid = DeckConfigId(id);
    // fallback=false: a missing id returns 404 instead of silently
    // routing onto the Default preset. Same pre-flight check as the
    // GET/PATCH handlers above.
    let placeholder = col
        .get_deck_config(DEFAULT_PRESET_ID, false)?
        .ok_or_else(|| ServerError::from(anyhow!("Default preset id=1 missing — collection is corrupt")))?;
    if col.get_deck_config(dcid, false)?.is_none() {
        return Err(ServerError::not_found(format!("deck_config {id} not found")));
    }

    let fsrs = col.get_config_bool(BoolKey::Fsrs);
    let fsrs_health_check = col.get_config_bool(BoolKey::FsrsHealthCheck);
    let new_cards_ignore_review_limit = col.get_config_bool(BoolKey::NewCardsIgnoreReviewLimit);
    let apply_all_parent_limits = col.get_config_bool(BoolKey::ApplyAllParentLimits);

    let req = UpdateDeckConfigsRequest {
        // DeckId(0) matches no real deck, so the per-deck reassignment
        // loop never fires for selected decks. Decks that used the
        // removed preset still get reassigned to configs.last() (=
        // Default) via the "previous config removed" branch — this is
        // the desktop's standard behaviour for orphaned decks.
        target_deck_id: DeckId(0),
        // Default placeholder satisfies update.rs:160's require!() and
        // also serves as the configs.last() fallback for orphaned decks.
        configs: vec![placeholder],
        removed_config_ids: vec![dcid],
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

    Ok(Json(DeckConfigDeleteResponse { removed_config_id: id }))
}

/// Range-validate a delete-by-id request. Extracted so the rules
/// unit-test without a Collection. Default preset (id=1) is reserved
/// because (a) every fresh collection seeds it and (b) the rslib
/// reassignment loop falls back to `configs.last()` for orphaned decks
/// — making the only-config case undefined would be hard to recover
/// from. Non-positive ids are rejected before the storage lookup so
/// we never confuse "id 0 doesn't exist" with "DeckId(0) is the
/// create-only sentinel".
fn validate_delete_id(id: i64) -> Result<(), &'static str> {
    if id <= 0 {
        return Err("id must be a positive integer");
    }
    if id == DEFAULT_PRESET_ID.0 {
        return Err("the Default preset cannot be deleted");
    }
    Ok(())
}

/// Range-validate a `DeckConfigCreateRequest`'s name. Extracted so the
/// rules unit-test without a Collection — same `&'static str` extract
/// pattern as `validate_patch` and `validate_preset_id`.
///
/// `name` is trimmed before length-check so trailing whitespace doesn't
/// inflate the cap. Returns the trimmed slice on success.
fn validate_create_name(name: &str) -> Result<&str, &'static str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("name must not be empty");
    }
    if trimmed.chars().count() > 100 {
        return Err("name must be 100 characters or fewer");
    }
    Ok(trimmed)
}

/// Range-validate a DeckConfigPatch in isolation. Extracted so the rules
/// can be unit-tested without a Collection. Returns the same human-readable
/// strings the handler used to format inline.
fn validate_patch(patch: &DeckConfigPatch) -> Result<(), &'static str> {
    if let Some(r) = patch.desired_retention {
        if !(0.70..=0.97).contains(&r) || !r.is_finite() {
            return Err("desired_retention must be between 0.70 and 0.97");
        }
    }
    if let Some(m) = patch.maximum_review_interval {
        if !(1..=36_500).contains(&m) {
            return Err("maximum_review_interval must be between 1 and 36500");
        }
    }
    if let Some(n) = patch.new_per_day {
        if n > 9_999 {
            return Err("new_per_day must be between 0 and 9999");
        }
    }
    if let Some(r) = patch.reviews_per_day {
        if r > 9_999 {
            return Err("reviews_per_day must be between 0 and 9999");
        }
    }
    if let Some(c) = patch.cap_answer_time_secs {
        if !(1..=600).contains(&c) {
            return Err("cap_answer_time_secs must be between 1 and 600");
        }
    }
    Ok(())
}

fn to_response(c: &DeckConfig) -> DeckConfigDefault {
    DeckConfigDefault {
        id: c.id.0,
        name: c.name.clone(),
        desired_retention: c.inner.desired_retention,
        maximum_review_interval: c.inner.maximum_review_interval,
        new_per_day: c.inner.new_per_day,
        reviews_per_day: c.inner.reviews_per_day,
        cap_answer_time_secs: c.inner.cap_answer_time_to_secs,
        fsrs_params: c.inner.fsrs_params_6.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_patch() -> DeckConfigPatch {
        DeckConfigPatch {
            desired_retention: None,
            maximum_review_interval: None,
            new_per_day: None,
            reviews_per_day: None,
            cap_answer_time_secs: None,
        }
    }

    #[test]
    fn empty_patch_is_ok() {
        assert!(validate_patch(&empty_patch()).is_ok());
    }

    #[test]
    fn desired_retention_out_of_range() {
        let mut p = empty_patch();
        p.desired_retention = Some(0.50);
        assert_eq!(
            validate_patch(&p).unwrap_err(),
            "desired_retention must be between 0.70 and 0.97"
        );
        p.desired_retention = Some(0.99);
        assert!(validate_patch(&p).is_err());
        p.desired_retention = Some(f32::NAN);
        assert!(validate_patch(&p).is_err());
    }

    #[test]
    fn maximum_review_interval_boundaries() {
        let mut p = empty_patch();
        p.maximum_review_interval = Some(0);
        assert!(validate_patch(&p).is_err());
        p.maximum_review_interval = Some(36_501);
        assert!(validate_patch(&p).is_err());
        p.maximum_review_interval = Some(1);
        assert!(validate_patch(&p).is_ok());
        p.maximum_review_interval = Some(36_500);
        assert!(validate_patch(&p).is_ok());
    }

    #[test]
    fn new_per_day_allows_zero_pause_but_caps_at_9999() {
        let mut p = empty_patch();
        p.new_per_day = Some(0);
        assert!(
            validate_patch(&p).is_ok(),
            "0 must be allowed (pauses new cards intentionally)",
        );
        p.new_per_day = Some(9_999);
        assert!(validate_patch(&p).is_ok());
        p.new_per_day = Some(10_000);
        assert_eq!(
            validate_patch(&p).unwrap_err(),
            "new_per_day must be between 0 and 9999"
        );
    }

    #[test]
    fn reviews_per_day_allows_zero_pause_but_caps_at_9999() {
        let mut p = empty_patch();
        p.reviews_per_day = Some(0);
        assert!(validate_patch(&p).is_ok());
        p.reviews_per_day = Some(9_999);
        assert!(validate_patch(&p).is_ok());
        p.reviews_per_day = Some(10_000);
        assert!(validate_patch(&p).is_err());
    }

    #[test]
    fn cap_answer_time_secs_must_be_one_to_six_hundred() {
        let mut p = empty_patch();
        // 0 is rejected — a 0-second cap would round-trip every answer to
        // a hard rating, which is almost certainly not what the user wants.
        p.cap_answer_time_secs = Some(0);
        assert!(validate_patch(&p).is_err());
        p.cap_answer_time_secs = Some(1);
        assert!(validate_patch(&p).is_ok());
        p.cap_answer_time_secs = Some(600);
        assert!(validate_patch(&p).is_ok());
        p.cap_answer_time_secs = Some(601);
        assert_eq!(
            validate_patch(&p).unwrap_err(),
            "cap_answer_time_secs must be between 1 and 600"
        );
    }

    #[test]
    fn validate_create_name_rejects_empty_and_whitespace() {
        assert_eq!(
            validate_create_name("").unwrap_err(),
            "name must not be empty"
        );
        assert_eq!(
            validate_create_name("   ").unwrap_err(),
            "name must not be empty"
        );
        assert_eq!(
            validate_create_name("\t\n  ").unwrap_err(),
            "name must not be empty"
        );
    }

    #[test]
    fn validate_create_name_caps_at_100_chars_after_trim() {
        // Trailing whitespace shouldn't push a 100-char name over the cap.
        let ok_padded = format!("{}{}", "a".repeat(100), "   ");
        assert_eq!(validate_create_name(&ok_padded).unwrap(), "a".repeat(100));

        let too_long = "a".repeat(101);
        assert_eq!(
            validate_create_name(&too_long).unwrap_err(),
            "name must be 100 characters or fewer"
        );
    }

    #[test]
    fn validate_create_name_counts_unicode_chars_not_bytes() {
        // 100 CJK chars (300 UTF-8 bytes) must succeed; the cap is on
        // grapheme-ish chars (Anki desktop is consistent here). Use a
        // distinct character so the test would surface a byte-count
        // mistake immediately.
        let cjk = "字".repeat(100);
        assert!(validate_create_name(&cjk).is_ok());

        let cjk_over = "字".repeat(101);
        assert!(validate_create_name(&cjk_over).is_err());
    }

    #[test]
    fn validate_create_name_returns_trimmed_slice() {
        // Caller stores the trimmed value, not the raw user input — keeps
        // the duplicate check stable across "hello" vs "hello   ".
        assert_eq!(validate_create_name("  hello  ").unwrap(), "hello");
        assert_eq!(validate_create_name("\nfoo\t").unwrap(), "foo");
    }

    #[test]
    fn validate_delete_id_rejects_default_preset() {
        // id=1 is the seeded Default. Removing it would leave the
        // configs.last() reassignment branch undefined for orphaned
        // decks on the only-config case.
        assert_eq!(
            validate_delete_id(1).unwrap_err(),
            "the Default preset cannot be deleted"
        );
    }

    #[test]
    fn validate_delete_id_rejects_non_positive() {
        // 0 is the create-only target_deck_id sentinel; negative ids
        // can't index any real preset. Both rejected at the boundary
        // so the storage layer never sees them.
        assert_eq!(
            validate_delete_id(0).unwrap_err(),
            "id must be a positive integer"
        );
        assert_eq!(
            validate_delete_id(-7).unwrap_err(),
            "id must be a positive integer"
        );
    }

    #[test]
    fn validate_delete_id_accepts_epoch_ms_user_preset_ids() {
        // Real user presets carry epoch-ms ids (e.g. 1777214900905
        // from the Phase 12-B Smoke preset). The validation cap must
        // accept 64-bit values without overflow.
        assert!(validate_delete_id(1_777_214_900_905).is_ok());
        assert!(validate_delete_id(2).is_ok());
        assert!(validate_delete_id(i64::MAX).is_ok());
    }

    #[test]
    fn first_failure_short_circuits() {
        // desired_retention is checked first — so even though new_per_day
        // is also invalid, the user sees the retention message.
        let p = DeckConfigPatch {
            desired_retention: Some(2.0),
            maximum_review_interval: None,
            new_per_day: Some(99_999),
            reviews_per_day: None,
            cap_answer_time_secs: None,
        };
        assert_eq!(
            validate_patch(&p).unwrap_err(),
            "desired_retention must be between 0.70 and 0.97"
        );
    }
}
