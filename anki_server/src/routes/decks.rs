use anki::decks::DeckKind;
use anki::prelude::*;
use anki::timestamp::TimestampSecs;
use anyhow::anyhow;
use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiResult, ServerError};
use crate::state::AppState;

/// Summary of one deck in the tree. Nested `children` for sub-decks.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DeckSummary {
    pub id: i64,
    pub name: String,
    pub level: u32,
    pub new_count: u32,
    pub learn_count: u32,
    pub review_count: u32,
    pub total_in_deck: u32,
    pub filtered: bool,
    pub collapsed: bool,
    /// Phase 11-A: assigned preset (deck config) id. `None` for filtered
    /// decks (which have no preset by design) and the implicit root.
    pub preset_id: Option<i64>,
    pub children: Vec<DeckSummary>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DeckListResponse {
    pub decks: Vec<DeckSummary>,
}

/// Return the deck tree with today's due counts.
#[utoipa::path(
    get,
    path = "/api/decks",
    responses((status = 200, body = DeckListResponse))
)]
pub async fn list_decks(State(state): State<AppState>) -> ApiResult<Json<DeckListResponse>> {
    let mut col = state.col.lock().await;
    // deck_tree(None) returns the tree structure only; due and total counts
    // are populated only when a timestamp is supplied (see rslib tree.rs).
    let tree = col.deck_tree(Some(TimestampSecs::now()))?;
    let mut decks = Vec::with_capacity(tree.children.len());
    for child in tree.children {
        decks.push(convert(&mut col, child)?);
    }
    Ok(Json(DeckListResponse { decks }))
}

// Phase 11-A: convert is now fallible because we look up each node's
// preset (config_id) via Collection::get_deck. One extra cache hit per
// deck — fine for the localhost-single-user scale (Anki collections in
// the wild rarely top a few hundred decks).
fn convert(
    col: &mut Collection,
    node: anki_proto::decks::DeckTreeNode,
) -> anyhow::Result<DeckSummary> {
    let preset_id = col
        .get_deck(DeckId(node.deck_id))?
        .and_then(|d| d.config_id())
        .map(|c| c.0);
    let mut children = Vec::with_capacity(node.children.len());
    for child in node.children {
        children.push(convert(col, child)?);
    }
    Ok(DeckSummary {
        id: node.deck_id,
        name: node.name,
        level: node.level,
        new_count: node.new_count,
        learn_count: node.learn_count,
        review_count: node.review_count,
        total_in_deck: node.total_in_deck,
        filtered: node.filtered,
        collapsed: node.collapsed,
        preset_id,
        children,
    })
}

#[derive(Debug, Deserialize)]
pub struct DeckRenameRequest {
    pub name: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DeckRenameResponse {
    pub id: i64,
    pub name: String,
}

/// Rename an existing deck. Whitespace-only names are rejected (400);
/// missing decks return 404. Anki's "::" nesting separator is permitted —
/// renaming to "Parent::Child" reparents through `update_deck_inner` per
/// rslib semantics, matching the desktop deck-options screen.
#[utoipa::path(
    patch,
    path = "/api/decks/{id}",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = DeckRenameResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Deck id"))
)]
pub async fn patch_deck(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<DeckRenameRequest>,
) -> ApiResult<Json<DeckRenameResponse>> {
    let trimmed = req.name.trim();
    if trimmed.is_empty() {
        return Err(ServerError::bad_request("name must not be empty"));
    }
    let mut col = state.col.lock().await;
    let did = DeckId(id);
    if col.get_deck(did)?.is_none() {
        return Err(ServerError::not_found(format!("deck {id} not found")));
    }
    col.rename_deck(did, trimmed)?;
    let renamed = col
        .get_deck(did)?
        .ok_or_else(|| ServerError::from(anyhow!("deck {id} disappeared post-rename")))?;
    Ok(Json(DeckRenameResponse {
        id: renamed.id.0,
        name: renamed.human_name(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct DeckPresetRequest {
    /// Target preset id (DeckConfigId). Must be a positive id that exists
    /// in the deck_config table; default config is `1`.
    pub preset_id: i64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DeckPresetResponse {
    pub id: i64,
    pub preset_id: i64,
    pub preset_name: String,
}

/// Pure validation surface for `preset_id`. Anki preset ids are positive
/// integers (default = 1, fresh presets get epoch-ms ids), so 0 and
/// negatives are rejected at the request boundary before any Collection
/// access. Same `&'static str` extract pattern as Phase 10-C `validate_patch`.
fn validate_preset_id(id: i64) -> Result<i64, &'static str> {
    if id <= 0 {
        return Err("preset_id must be a positive integer");
    }
    Ok(id)
}

/// Phase 11-A: assign a preset (deck config) to a deck.
///
/// Validation order matters: invalid `preset_id` is rejected before any
/// lookup so a malformed payload can never even brush the collection.
/// Then the deck is fetched (404 on miss), the preset is fetched with
/// `fallback=false` so a missing preset does NOT silently fall back to
/// the default config (Phase 9-T `bug_caught` lesson). Filtered decks
/// have no `config_id` field — reject with 400 rather than silently
/// no-op'ing on the user.
///
/// Closes the Phase 9-O'' "per-deck assignment comes in a later release"
/// disclaimer.
#[utoipa::path(
    patch,
    path = "/api/decks/{id}/preset",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = DeckPresetResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Deck id"))
)]
pub async fn patch_deck_preset(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<DeckPresetRequest>,
) -> ApiResult<Json<DeckPresetResponse>> {
    let preset_id = validate_preset_id(req.preset_id).map_err(ServerError::bad_request)?;
    let mut col = state.col.lock().await;
    let did = DeckId(id);
    // Collection::get_deck returns Arc<Deck> from the in-memory cache;
    // clone out so we can mutate freely and call update_deck afterwards.
    let mut deck: Deck = (*col
        .get_deck(did)?
        .ok_or_else(|| ServerError::not_found(format!("deck {id} not found")))?)
    .clone();
    let dcid = DeckConfigId(preset_id);
    // fallback=false per Phase 9-T bug_caught: with_fallback=true would
    // route a missing preset_id to DeckConfigId(1) and silently succeed.
    let preset = col
        .get_deck_config(dcid, false)?
        .ok_or_else(|| ServerError::not_found(format!("preset {preset_id} not found")))?;
    match &mut deck.kind {
        DeckKind::Normal(normal) => {
            normal.config_id = preset_id;
        }
        DeckKind::Filtered(_) => {
            return Err(ServerError::bad_request("filtered decks have no preset"));
        }
    }
    col.update_deck(&mut deck)?;
    Ok(Json(DeckPresetResponse {
        id: did.0,
        preset_id: preset.id.0,
        preset_name: preset.name.clone(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct DeckCreateRequest {
    /// Human-readable deck name. May contain `::` to nest under an
    /// existing parent (e.g. `"Spanish::Verbs::Irregular"`); auto-creates
    /// missing parents server-side, mirroring desktop Anki. Trimmed
    /// before further validation.
    pub name: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DeckCreateResponse {
    pub id: i64,
    /// Server-canonical name after normalization. Will differ from the
    /// request when Anki rewrites a duplicate to "Foo (1)" / "Foo (2)"
    /// via `ensure_deck_name_unique`. Echoing it back lets the client
    /// surface the actual persisted name without a follow-up GET.
    pub name: String,
}

const DECK_NAME_MAX_CHARS: usize = 100;

/// Pure-shape validation for a create request. Same `&'static str`
/// extract pattern as `validate_preset_id`, the create-note rules,
/// and the deck-config `validate_create_name` (Phase 12-B). Counts
/// chars-not-bytes so CJK names get the same 100-char budget as
/// ASCII — a 100-char Japanese deck name passes, 101 fails.
fn validate_create_name(name: &str) -> Result<&str, &'static str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("name must not be empty");
    }
    if trimmed.chars().count() > DECK_NAME_MAX_CHARS {
        return Err("name must be at most 100 characters");
    }
    if trimmed.starts_with("::") {
        return Err("name must not start with '::'");
    }
    if trimmed.ends_with("::") {
        return Err("name must not end with '::'");
    }
    // Three-or-more colons in a row implies an empty path component (e.g.
    // "Foo:::Bar" → empty middle). Same effective constraint as desktop
    // Anki, which rejects empty components in the deck-options dialog.
    if trimmed.contains(":::") {
        return Err("name must not contain consecutive '::' separators");
    }
    Ok(trimmed)
}

/// Phase 14-C: create a new normal (non-filtered) deck.
///
/// Validation order (cheap → expensive):
///   1. Request shape via `validate_create_name` (extracted, no
///      Collection access). Catches empty / over-length / `::`-edge
///      malformed inputs at the boundary.
///   2. `Collection::add_deck` — transactional add path that auto-
///      creates missing parents (so `"Spanish::Verbs::Irregular"`
///      transparently materialises any missing `Spanish` /
///      `Spanish::Verbs` ancestors), assigns the deck a fresh
///      epoch-ms id, and ensures uniqueness (a duplicate name gets
///      a `" (N)"` suffix appended, matching desktop Anki).
///
/// Filtered decks aren't reachable from this endpoint by design — the
/// home-page "+ New deck" button is for everyday review buckets, and
/// filtered decks need a search query that doesn't fit the v1 surface.
#[utoipa::path(
    post,
    path = "/api/decks",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = DeckCreateResponse),
        (status = 400, body = crate::error::ApiError),
    )
)]
pub async fn post_create(
    State(state): State<AppState>,
    Json(req): Json<DeckCreateRequest>,
) -> ApiResult<Json<DeckCreateResponse>> {
    let trimmed = validate_create_name(&req.name).map_err(ServerError::bad_request)?;
    let mut col = state.col.lock().await;

    // `Deck::new_normal()` returns a deck with id=0; `add_deck` requires
    // the zero-id sentinel and assigns an epoch-ms id during the
    // transaction. `from_human_name` turns "::"-separated input into
    // the native `\x1f`-joined storage form.
    let mut deck = anki::decks::Deck::new_normal();
    deck.name = anki::decks::NativeDeckName::from_human_name(trimmed);
    col.add_deck(&mut deck)?;

    Ok(Json(DeckCreateResponse {
        id: deck.id.0,
        name: deck.human_name(),
    }))
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DeckDeleteResponse {
    pub removed_deck_id: i64,
    /// Total cards removed across the deleted deck and all its children.
    /// `remove_decks_and_child_decks` cascades through every descendant
    /// in one transaction; orphaned notes are cleaned up automatically
    /// by `remove_cards_and_orphaned_notes` (rslib decks/remove.rs:54).
    pub removed_card_count: usize,
}

const DEFAULT_DECK_ID: i64 = 1;

/// Pure-shape validation for a delete request. Same `&'static str`
/// extract pattern as the create / preset / patch validators above.
///
/// Rejects:
///   - non-positive ids (400) — same boundary rule as every other
///     path-addressed handler in this server.
///   - DeckId(1), the Default deck (400). rslib's `remove_single_deck`
///     special-cases Default: it strips every card but keeps the deck
///     row alive and resets its name (rslib decks/remove.rs:36-44).
///     Letting that path run unchecked from a path-addressed delete
///     would silently destroy data without removing the deck the
///     caller asked to remove — exactly the "explicit not silent"
///     anti-pattern Phase 13-A and 14-B carved out. Block it here.
fn validate_delete_id(id: i64) -> Result<i64, &'static str> {
    if id <= 0 {
        return Err("id must be a positive integer");
    }
    if id == DEFAULT_DECK_ID {
        return Err("Default deck cannot be deleted");
    }
    Ok(id)
}

/// Phase 15-A: delete a deck (and cascade through children + their cards).
///
/// Validation order (cheap → expensive):
///   1. `validate_delete_id` rejects id<=0 and the protected Default
///      deck before any Collection access.
///   2. `col.get_deck(did)` strict existence check returns 404 on miss
///      — same path-addressed lookup pattern as `patch_deck` above and
///      13-A `delete_by_id` for notes. The downstream
///      `remove_decks_and_child_decks` is a no-op for unknown ids
///      (rslib decks/remove.rs:11), so without this guard the response
///      would silently report 0 cards removed instead of a 404.
///   3. `Collection::remove_decks_and_child_decks(&[did])` runs the
///      transactional cascade: collects child decks, deletes all their
///      cards via `remove_cards_and_orphaned_notes` (which folds in
///      orphan-note cleanup), and removes the deck rows themselves.
///
/// Returns the deleted id and the total card count from the OpOutput
/// payload so the caller can show "Removed N cards" feedback without a
/// follow-up GET.
#[utoipa::path(
    delete,
    path = "/api/decks/{id}",
    responses(
        (status = 200, body = DeckDeleteResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Deck id"))
)]
pub async fn delete_by_id(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<DeckDeleteResponse>> {
    validate_delete_id(id).map_err(ServerError::bad_request)?;
    let mut col = state.col.lock().await;
    let did = DeckId(id);
    if col.get_deck(did)?.is_none() {
        return Err(ServerError::not_found(format!("deck {id} not found")));
    }
    let output = col.remove_decks_and_child_decks(&[did])?;
    Ok(Json(DeckDeleteResponse {
        removed_deck_id: id,
        removed_card_count: output.output,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_delete_id_rejects_non_positive() {
        for bad in [0, -1, i64::MIN] {
            assert_eq!(
                validate_delete_id(bad).unwrap_err(),
                "id must be a positive integer",
                "bad={bad}"
            );
        }
    }

    #[test]
    fn validate_delete_id_rejects_default_deck() {
        // The Default deck (id=1) is silently special-cased by rslib's
        // remove path — it strips cards and renames the deck back to
        // default rather than removing the row. Block it at the request
        // boundary so a `DELETE /api/decks/1` can never silently destroy
        // user data.
        assert_eq!(
            validate_delete_id(DEFAULT_DECK_ID).unwrap_err(),
            "Default deck cannot be deleted"
        );
    }

    #[test]
    fn validate_delete_id_accepts_real_epoch_ms_id() {
        // Real Anki deck ids are epoch-ms timestamps (e.g. demo deck
        // 1776837237914 in /tmp/ferdinand_dev/collection.anki2).
        let epoch_ms_id = 1_776_837_237_914_i64;
        assert_eq!(validate_delete_id(epoch_ms_id).unwrap(), epoch_ms_id);
        assert_eq!(validate_delete_id(2).unwrap(), 2);
        assert_eq!(validate_delete_id(i64::MAX).unwrap(), i64::MAX);
    }

    #[test]
    fn validate_preset_id_rejects_zero() {
        assert!(validate_preset_id(0).is_err());
    }

    #[test]
    fn validate_preset_id_rejects_negative() {
        assert!(validate_preset_id(-1).is_err());
        assert!(validate_preset_id(i64::MIN).is_err());
    }

    #[test]
    fn validate_preset_id_accepts_default_config() {
        assert_eq!(validate_preset_id(1).unwrap(), 1);
    }

    #[test]
    fn validate_preset_id_accepts_epoch_ms_id() {
        // Real Anki presets get epoch-ms ids when created; same shape as
        // deck ids (e.g. demo deck = 1776837237914).
        let epoch_ms_id = 1_776_837_237_914_i64;
        assert_eq!(validate_preset_id(epoch_ms_id).unwrap(), epoch_ms_id);
        assert_eq!(validate_preset_id(i64::MAX).unwrap(), i64::MAX);
    }

    #[test]
    fn validate_create_name_rejects_blank_and_whitespace() {
        // Empty + whitespace-only must fail with the same message —
        // surfacing "name must not be empty" everywhere keeps the
        // client error banner predictable across mash-Enter inputs.
        for blank in ["", "   ", "\t\n", "  \r\n  "] {
            assert_eq!(
                validate_create_name(blank).unwrap_err(),
                "name must not be empty",
                "blank={blank:?}"
            );
        }
    }

    #[test]
    fn validate_create_name_enforces_chars_not_bytes_budget() {
        // 100 single-byte chars: pass.
        let ascii_100 = "a".repeat(100);
        assert_eq!(validate_create_name(&ascii_100).unwrap(), ascii_100);
        // 101 single-byte chars: fail.
        let ascii_101 = "a".repeat(101);
        assert_eq!(
            validate_create_name(&ascii_101).unwrap_err(),
            "name must be at most 100 characters"
        );
        // 100 CJK chars (each 3 bytes in UTF-8 = 300 bytes): pass.
        // A naïve `.len() > 100` byte check would reject this; the
        // chars-not-bytes rule keeps the budget fair across scripts.
        let cjk_100 = "森".repeat(100);
        assert_eq!(cjk_100.len(), 300);
        assert_eq!(validate_create_name(&cjk_100).unwrap(), cjk_100);
        // 101 CJK chars: fail (boundary inclusive at 100).
        let cjk_101 = "森".repeat(101);
        assert_eq!(
            validate_create_name(&cjk_101).unwrap_err(),
            "name must be at most 100 characters"
        );
    }

    #[test]
    fn validate_create_name_rejects_double_colon_edge_cases() {
        // Leading "::" reads as an unnamed root parent; trailing "::"
        // implies an unnamed leaf — both create empty-name components
        // that confuse the deck tree.
        assert_eq!(
            validate_create_name("::Spanish").unwrap_err(),
            "name must not start with '::'"
        );
        assert_eq!(
            validate_create_name("Spanish::").unwrap_err(),
            "name must not end with '::'"
        );
        // Triple-colon (and longer) sequences imply an empty middle
        // component — same disallowed shape as desktop Anki.
        assert_eq!(
            validate_create_name("Spanish:::Verbs").unwrap_err(),
            "name must not contain consecutive '::' separators"
        );
        assert_eq!(
            validate_create_name("A::::B").unwrap_err(),
            "name must not contain consecutive '::' separators"
        );
    }

    #[test]
    fn validate_create_name_accepts_normal_and_nested_names() {
        // Plain name, nested name, name with whitespace at the edges
        // (trimmed), and CJK name all pass the rule set.
        assert_eq!(validate_create_name("Spanish").unwrap(), "Spanish");
        assert_eq!(
            validate_create_name("Spanish::Verbs::Irregular").unwrap(),
            "Spanish::Verbs::Irregular"
        );
        // Trim leading/trailing whitespace.
        assert_eq!(validate_create_name("  Padded  ").unwrap(), "Padded");
        // CJK well under the 100-char cap.
        assert_eq!(validate_create_name("日本語").unwrap(), "日本語");
    }
}
