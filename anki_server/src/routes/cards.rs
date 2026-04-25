use std::sync::LazyLock;

use anki::card::{Card, CardQueueNumber};
use anki::prelude::*;
use anki::search::SortMode;
use anki::template::RenderedNode;
use anki_proto::scheduler::bury_or_suspend_cards_request::Mode as BuryOrSuspendMode;
use anyhow::anyhow;
use axum::extract::{Path, Query, State};
use axum::Json;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::error::{ApiResult, ServerError};
use crate::state::AppState;

// Anki's default Basic template renders the answer as
// "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}", so rendered.anodes
// carries the question again at the top. Our UI shows front and back
// as two separate cards, so we strip the prefix up to and including
// the `<hr id=answer>` marker. Same pattern used by Anki core for
// CSV export (rslib/.../csv/export.rs) and pylib exporting.py.
static FRONTSIDE_PREFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)^.*<hr id=answer>\n*").unwrap());

fn strip_frontside_prefix(s: &str) -> String {
    FRONTSIDE_PREFIX.replace(s, "").into_owned()
}

/// Flattened card view used by the Browse list and the Study queue preview.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CardSummary {
    pub id: i64,
    pub note_id: i64,
    pub deck_id: i64,
    pub deck_name: String,
    pub template_idx: u32,
    pub front_html: String,
    pub back_html: String,
    pub tags: Vec<String>,
    pub state: &'static str,
    pub ease_factor: f32,
    pub notetype_id: i64,
    pub notetype_name: String,
    pub notetype_css: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CardListResponse {
    pub total: usize,
    pub cards: Vec<CardSummary>,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    /// Anki search expression, e.g. `deck:"Ferdinand demo"` or `tag:leech`.
    /// If absent, defaults to all cards.
    pub q: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    50
}

/// List cards matching an Anki search expression.
#[utoipa::path(
    get,
    path = "/api/cards",
    responses((status = 200, body = CardListResponse)),
    params(
        ("q" = Option<String>, Query, description = "Anki search expression"),
        ("limit" = Option<usize>, Query, description = "Max cards returned")
    )
)]
pub async fn list_cards(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> ApiResult<Json<CardListResponse>> {
    let mut col = state.col.lock().await;
    let search = q.q.as_deref().unwrap_or("").trim().to_string();
    let ids = col.search_cards(search.as_str(), SortMode::NoOrder)?;
    let total = ids.len();
    let cards = ids
        .into_iter()
        .take(q.limit)
        .map(|cid| build_summary(&mut col, cid))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(CardListResponse { total, cards }))
}

/// Fetch a single card by id with rendered HTML.
#[utoipa::path(
    get,
    path = "/api/cards/{id}",
    responses((status = 200, body = CardSummary)),
    params(("id" = i64, Path, description = "Card id"))
)]
pub async fn get_card(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<CardSummary>> {
    let mut col = state.col.lock().await;
    let summary = build_summary(&mut col, CardId(id))?;
    Ok(Json(summary))
}

pub(crate) fn build_summary(col: &mut Collection, cid: CardId) -> anyhow::Result<CardSummary> {
    let card = col
        .storage
        .get_card(cid)?
        .ok_or_else(|| anyhow::anyhow!("card {cid} not found"))?;
    let note = col
        .storage
        .get_note(card.note_id())?
        .ok_or_else(|| anyhow::anyhow!("note {} not found for card {cid}", card.note_id()))?;
    let deck = col
        .get_deck(card.deck_id())?
        .ok_or_else(|| anyhow::anyhow!("deck {} not found for card {cid}", card.deck_id()))?;
    let notetype = col
        .get_notetype(note.notetype_id)?
        .ok_or_else(|| anyhow::anyhow!("notetype {} not found for note {}", note.notetype_id, note.id))?;
    let rendered = col.render_existing_card(cid, false, true)?;
    Ok(CardSummary {
        id: cid.0,
        note_id: card.note_id().0,
        deck_id: card.deck_id().0,
        deck_name: deck.human_name(),
        template_idx: u32::from(card.template_idx()),
        front_html: flatten_nodes(&rendered.qnodes),
        back_html: strip_frontside_prefix(&flatten_nodes(&rendered.anodes)),
        tags: note.tags.clone(),
        state: card_state_label(&card),
        ease_factor: card.ease_factor(),
        notetype_id: notetype.id.0,
        notetype_name: notetype.name.clone(),
        notetype_css: notetype.config.css.clone(),
    })
}

fn flatten_nodes(nodes: &[RenderedNode]) -> String {
    let mut out = String::new();
    for n in nodes {
        match n {
            RenderedNode::Text { text } => out.push_str(text),
            RenderedNode::Replacement { current_text, .. } => out.push_str(current_text),
        }
    }
    out
}

fn card_state_label(card: &Card) -> &'static str {
    match card.queue_number() {
        CardQueueNumber::New => "new",
        CardQueueNumber::Learning => "learning",
        CardQueueNumber::Review => "review",
        CardQueueNumber::Invalid => "suspended",
    }
}

#[derive(Debug, Deserialize)]
pub struct SuspendRequest {
    /// If true (or absent), suspend the card; if false, unsuspend it. The
    /// underlying rslib calls (`bury_or_suspend_cards` / `unbury_or_unsuspend_cards`)
    /// are idempotent, so re-sending the same value is a safe no-op.
    #[serde(default = "default_suspended")]
    pub suspended: bool,
}

fn default_suspended() -> bool {
    true
}

impl Default for SuspendRequest {
    fn default() -> Self {
        Self { suspended: true }
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SuspendResponse {
    pub id: i64,
    /// Post-action state label, matching `CardSummary.state` ("new" |
    /// "learning" | "review" | "suspended"). Lets the UI update its row
    /// without re-fetching.
    pub state: &'static str,
}

/// Suspend or unsuspend a single card. POSTing with no body or `{}`
/// suspends; POST with `{"suspended": false}` unsuspends. Missing card →
/// 404. Idempotent under repeated calls with the same target state.
#[utoipa::path(
    post,
    path = "/api/cards/{id}/suspend",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = SuspendResponse),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Card id"))
)]
pub async fn post_suspend(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    body: Option<Json<SuspendRequest>>,
) -> ApiResult<Json<SuspendResponse>> {
    let req = body.map(|j| j.0).unwrap_or_default();
    let mut col = state.col.lock().await;
    let cid = CardId(id);
    if col.storage.get_card(cid)?.is_none() {
        return Err(ServerError::not_found(format!("card {id} not found")));
    }
    if req.suspended {
        col.bury_or_suspend_cards(&[cid], BuryOrSuspendMode::Suspend)?;
    } else {
        col.unbury_or_unsuspend_cards(&[cid])?;
    }
    let card = col
        .storage
        .get_card(cid)?
        .ok_or_else(|| ServerError::from(anyhow!("card {id} disappeared post-suspend")))?;
    Ok(Json(SuspendResponse {
        id: cid.0,
        state: card_state_label(&card),
    }))
}
