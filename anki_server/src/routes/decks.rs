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
    let decks = convert(tree).children;
    Ok(Json(DeckListResponse { decks }))
}

fn convert(node: anki_proto::decks::DeckTreeNode) -> DeckSummary {
    DeckSummary {
        id: node.deck_id,
        name: node.name,
        level: node.level,
        new_count: node.new_count,
        learn_count: node.learn_count,
        review_count: node.review_count,
        total_in_deck: node.total_in_deck,
        filtered: node.filtered,
        collapsed: node.collapsed,
        children: node.children.into_iter().map(convert).collect(),
    }
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
