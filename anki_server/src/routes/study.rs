use anki::prelude::*;
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use super::cards::CardSummary;
use crate::error::ApiResult;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct QueueQuery {
    /// Deck to study. Parent deck studies include descendants.
    pub deck_id: i64,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    1
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct QueueResponse {
    pub new: u32,
    pub learning: u32,
    pub review: u32,
    pub cards: Vec<CardSummary>,
}

/// Get the next N queued cards for a deck. For the reviewer we usually
/// fetch `limit=1` and refetch after each answer.
#[utoipa::path(
    get,
    path = "/api/study/queue",
    responses((status = 200, body = QueueResponse)),
    params(
        ("deck_id" = i64, Query, description = "Deck id to study"),
        ("limit" = Option<usize>, Query)
    )
)]
pub async fn get_queue(
    State(state): State<AppState>,
    Query(q): Query<QueueQuery>,
) -> ApiResult<Json<QueueResponse>> {
    let mut col = state.col.lock().await;
    col.set_current_deck(DeckId(q.deck_id))?;
    let queued = col.get_queued_cards(q.limit.max(1), false)?;
    let new_count = queued.new_count as u32;
    let learning_count = queued.learning_count as u32;
    let review_count = queued.review_count as u32;
    let card_ids: Vec<CardId> = queued.cards.iter().map(|q| q.card.id()).collect();
    let cards = card_ids
        .into_iter()
        .map(|cid| super::cards::build_summary(&mut col, cid))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(QueueResponse {
        new: new_count,
        learning: learning_count,
        review: review_count,
        cards,
    }))
}
