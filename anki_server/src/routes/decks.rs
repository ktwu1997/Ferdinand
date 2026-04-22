use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::error::ApiResult;
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
    // `deck_tree(None)` returns today's due counts using the collection's
    // current day cutoff. Passing Some(now) would pin it to a specific day.
    let tree = col.deck_tree(None)?;
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
