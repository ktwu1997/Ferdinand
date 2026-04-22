use anki::prelude::*;
use anki::scheduler::answering::{CardAnswer, Rating};
use anki::scheduler::states::{CardState, SchedulingStates};
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnswerRating {
    Again,
    Hard,
    Good,
    Easy,
}

impl From<AnswerRating> for Rating {
    fn from(r: AnswerRating) -> Self {
        match r {
            AnswerRating::Again => Rating::Again,
            AnswerRating::Hard => Rating::Hard,
            AnswerRating::Good => Rating::Good,
            AnswerRating::Easy => Rating::Easy,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct AnswerRequest {
    pub card_id: i64,
    /// Deck id to refetch the next queued cards from after the answer lands.
    pub deck_id: i64,
    pub rating: AnswerRating,
    /// Time the learner spent on the card. Capped by the deck preset.
    #[serde(default)]
    pub milliseconds_taken: u32,
}

fn pick_new_state(states: &SchedulingStates, rating: &AnswerRating) -> CardState {
    match rating {
        AnswerRating::Again => states.again,
        AnswerRating::Hard => states.hard,
        AnswerRating::Good => states.good,
        AnswerRating::Easy => states.easy,
    }
}

/// Record an answer for a card and return the refreshed queue preview for the deck.
#[utoipa::path(
    post,
    path = "/api/study/answer",
    request_body = inline(serde_json::Value),
    responses((status = 200, body = QueueResponse))
)]
pub async fn post_answer(
    State(state): State<AppState>,
    Json(req): Json<AnswerRequest>,
) -> ApiResult<Json<QueueResponse>> {
    let mut col = state.col.lock().await;
    let cid = CardId(req.card_id);
    let states = col.get_scheduling_states(cid)?;
    let new_state = pick_new_state(&states, &req.rating);
    let mut answer = CardAnswer {
        card_id: cid,
        current_state: states.current,
        new_state,
        rating: req.rating.into(),
        answered_at: TimestampMillis::now(),
        milliseconds_taken: req.milliseconds_taken,
        custom_data: None,
        from_queue: true,
    };
    col.answer_card(&mut answer)?;

    col.set_current_deck(DeckId(req.deck_id))?;
    let queued = col.get_queued_cards(1, false)?;
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
