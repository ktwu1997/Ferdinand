use anki::prelude::*;
use anki::scheduler::answering::{CardAnswer, Rating};
use anki::scheduler::states::{CardState, SchedulingStates};
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use super::cards::CardSummary;
use crate::error::{ApiResult, ServerError};
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

const FORECAST_MAX_DAYS: u32 = 30;
const FORECAST_DEFAULT_DAYS: u32 = 7;

fn default_forecast_days() -> u32 {
    FORECAST_DEFAULT_DAYS
}

#[derive(Debug, Deserialize)]
pub struct ForecastQuery {
    /// Window length, 1..=30 (default 7). Above 30 the histogram gets
    /// noisy enough that the bar chart is more confusing than useful;
    /// keep the cap tight so the home page render stays cheap.
    #[serde(default = "default_forecast_days")]
    pub days: u32,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ForecastDay {
    /// Days from today, 0 = today, 1 = tomorrow, etc.
    pub offset: u32,
    /// Number of review-state and day-learn cards due on that day. Overdue
    /// cards (`due < today`) are bucketed into offset=0 so the bar chart's
    /// "today" column reflects the user's actual review backlog rather
    /// than hiding them behind a pessimistic future projection.
    pub reviews: u32,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ForecastResponse {
    /// Echoed window length, after clamping.
    pub days: u32,
    /// Exactly `days` entries, oldest first (offset=0..days-1). Zero-day
    /// gaps are pre-filled so the client `.map()` is alignment-safe.
    pub history: Vec<ForecastDay>,
}

fn validate_forecast_days(d: u32) -> Result<u32, &'static str> {
    if d < 1 {
        return Err("days must be >= 1");
    }
    if d > FORECAST_MAX_DAYS {
        return Err("days must be <= 30");
    }
    Ok(d)
}

// Forecast SQL aggregates against the cards table directly. Cards with
// queue=2 (Review) and queue=3 (DayLearn) carry `due` as
// "days_since_creation" — we re-key to "days_from_today" by subtracting
// `?1` (today's day index from `Collection::timing_today`). Overdue
// cards (due - today < 0) are clamped to 0 with `MAX(...)` so they
// surface in the "today" bucket. queue=1 (LRN) uses epoch seconds, not
// day index, so the IN-clause excludes it; queue=0 (New) has no due
// date and is also excluded. Suspended (-1) and buried (-2) cards
// don't appear in any review forecast — same convention desktop uses.
const FORECAST_SQL: &str = "\
SELECT MAX(due - ?1, 0) AS day_offset, COUNT(*) AS n \
FROM cards \
WHERE queue IN (2, 3) \
  AND (due - ?1) < ?2 \
GROUP BY day_offset \
ORDER BY day_offset";

/// Per-day forecast of review-due cards for the next N days. Returns
/// exactly `days` entries (offset=0..days-1) with zero-due gaps padded
/// in Rust so a sparkline / bar chart can iterate without alignment
/// checks. Overdue cards collapse into offset=0.
#[utoipa::path(
    get,
    path = "/api/study/forecast",
    params(("days" = Option<u32>, Query, description = "Forecast window, 1..=30 (default 7)")),
    responses(
        (status = 200, body = ForecastResponse),
        (status = 400, body = crate::error::ApiError),
    )
)]
pub async fn get_forecast(
    State(state): State<AppState>,
    Query(q): Query<ForecastQuery>,
) -> ApiResult<Json<ForecastResponse>> {
    let days = validate_forecast_days(q.days).map_err(ServerError::bad_request)?;

    let mut col = state.col.lock().await;
    let today = col.timing_today()?.days_elapsed as i64;
    let mut buckets = vec![0_u32; days as usize];

    let mut stmt = col.storage.db().prepare(FORECAST_SQL)?;
    let mut rows = stmt.query([today, days as i64])?;
    while let Some(row) = rows.next()? {
        let offset: i64 = row.get(0)?;
        let count: u32 = row.get(1)?;
        // SQL clamps overdue to 0 and the WHERE excludes >=days, so
        // every offset is in 0..days. Defensive bound check anyway —
        // a future SQL tweak that drops the clamp would otherwise
        // panic on usize indexing.
        if (0..days as i64).contains(&offset) {
            buckets[offset as usize] = count;
        }
    }

    let history = buckets
        .into_iter()
        .enumerate()
        .map(|(i, n)| ForecastDay {
            offset: i as u32,
            reviews: n,
        })
        .collect();

    Ok(Json(ForecastResponse { days, history }))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_forecast_days_rejects_zero() {
        // 0 would yield an empty histogram — undefined for a "next N
        // days" query. Match validate_days from stats.rs which rejects
        // the same value with the same shape.
        assert_eq!(validate_forecast_days(0).unwrap_err(), "days must be >= 1");
    }

    #[test]
    fn validate_forecast_days_accepts_inclusive_boundaries() {
        // 1 = "just today"; 30 = max documented window. Both must pass
        // so the home page can default to 7 and a power user can ask
        // for 30 without hitting a 400.
        assert_eq!(validate_forecast_days(1).unwrap(), 1);
        assert_eq!(validate_forecast_days(7).unwrap(), 7);
        assert_eq!(validate_forecast_days(FORECAST_MAX_DAYS).unwrap(), 30);
    }

    #[test]
    fn validate_forecast_days_rejects_above_thirty() {
        // 31+ rejects with the same human-readable message — clients
        // that ask for "next 90 days" get a clean 400 instead of a
        // chart that's wider than the home page can render.
        assert_eq!(
            validate_forecast_days(FORECAST_MAX_DAYS + 1).unwrap_err(),
            "days must be <= 30"
        );
        assert_eq!(
            validate_forecast_days(u32::MAX).unwrap_err(),
            "days must be <= 30"
        );
    }

    #[test]
    fn validate_forecast_days_accepts_default() {
        // The default fires when the client omits `?days=`. Pin the
        // default value so a future tweak surfaces here as a test diff.
        assert_eq!(
            validate_forecast_days(default_forecast_days()).unwrap(),
            FORECAST_DEFAULT_DAYS
        );
    }
}
