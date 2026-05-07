use std::sync::LazyLock;

use anki::card::{Card, CardQueueNumber};
use anki::prelude::*;
use anki::revlog::RevlogReviewKind;
use anki::search::SortMode;
use anki::template::RenderedNode;
use anki_proto::scheduler::bury_or_suspend_cards_request::Mode as BuryOrSuspendMode;
use anyhow::anyhow;
use axum::extract::{Path, Query};
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
    /// Phase 17-A: user-visible flag colour (0=none, 1..=7 the seven
    /// supported colours). Only the lower 3 bits of `card.flags` are
    /// the user flag — the upper bits encode "needs sync" markers and
    /// are intentionally NOT exposed.
    pub flag: u32,
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
    /// Phase 11-C: zero-based offset into the search-result list. Pagination
    /// uses (offset, limit) addressing; total in the response is the unfiltered
    /// match count so the client can compute "X-Y of Z" cheaply.
    #[serde(default)]
    pub offset: usize,
}

fn default_limit() -> usize {
    50
}

/// Phase 11-C: per-request page-size cap. Above this, the build_summary()
/// hot loop (template render per card) starts dominating request latency
/// — the browse list paginates client-side anyway, so the server enforces
/// a hard ceiling rather than letting an accidental `?limit=999999` hang
/// a session.
const MAX_LIMIT: usize = 500;

/// Pure validation surface for the pagination params, mirroring the
/// 9-R / 10-C / 11-B / 11-A validate_* extraction pattern. Returning a
/// `&'static str` keeps the handler thin and lets unit tests cover every
/// boundary without touching a Collection.
fn validate_pagination(offset: usize, limit: usize) -> Result<(usize, usize), &'static str> {
    if limit == 0 {
        return Err("limit must be >= 1");
    }
    if limit > MAX_LIMIT {
        return Err("limit must be <= 500");
    }
    Ok((offset, limit))
}

/// List cards matching an Anki search expression. Pagination is by
/// (offset, limit); `total` reflects the full match count, not the slice
/// returned, so the client can compute "X-Y of Z" without an extra call.
#[utoipa::path(
    get,
    path = "/api/cards",
    responses(
        (status = 200, body = CardListResponse),
        (status = 400, body = crate::error::ApiError),
    ),
    params(
        ("q" = Option<String>, Query, description = "Anki search expression"),
        ("limit" = Option<usize>, Query, description = "Page size, 1..=500 (default 50)"),
        ("offset" = Option<usize>, Query, description = "Zero-based offset into result list (default 0)")
    )
)]
pub async fn list_cards(
    state: AppState,
    Query(q): Query<ListQuery>,
) -> ApiResult<Json<CardListResponse>> {
    let (offset, limit) =
        validate_pagination(q.offset, q.limit).map_err(ServerError::bad_request)?;
    let mut col = state.col.lock().await;
    let search = q.q.as_deref().unwrap_or("").trim().to_string();
    // Phase 12-A: a malformed Anki search expression (unclosed quote,
    // misplaced operator, etc.) is user-input error, not server failure.
    // Remap AnkiError::SearchError to 400 so the live-search effect on
    // the client can fall back to local filtering without raising the
    // page banner. Other errors (storage, IO) keep the default 500
    // mapping via the blanket From<anyhow::Error> impl.
    let ids = col
        .search_cards(search.as_str(), SortMode::NoOrder)
        .map_err(|e| match e {
            AnkiError::SearchError { .. } => {
                ServerError::bad_request(format!("invalid search query: {e}"))
            }
            other => ServerError::from(other),
        })?;
    let total = ids.len();
    let cards = ids
        .into_iter()
        .skip(offset)
        .take(limit)
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
    state: AppState,
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
    let notetype = col.get_notetype(note.notetype_id)?.ok_or_else(|| {
        anyhow::anyhow!(
            "notetype {} not found for note {}",
            note.notetype_id,
            note.id
        )
    })?;
    let rendered = col.render_existing_card(cid, false, true)?;
    // Route through the proto conversion so we don't have to touch
    // `Card`'s pub(crate) `flags` field directly. Same trick 16-D used
    // for `card_get_json` — `From<Card> for anki_proto::cards::Card`
    // lives inside rslib and has the access we lack out here. The
    // proto packs the same byte: lower 3 bits = user flag (0..=7),
    // upper bits = sync markers we deliberately mask off.
    let flag = card_user_flag(&card);
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
        flag,
        notetype_id: notetype.id.0,
        notetype_name: notetype.name.clone(),
        notetype_css: notetype.config.css.clone(),
    })
}

/// Extract the user-visible flag value (0..=7) from a `Card`. The proto
/// conversion is the only public path to `flags` from outside rslib —
/// see the comment at the call site above.
fn card_user_flag(card: &Card) -> u32 {
    anki_proto::cards::Card::from(card.clone()).flags & 0b111
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

pub(crate) fn card_state_label(card: &Card) -> &'static str {
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
    state: AppState,
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

#[derive(Debug, Deserialize)]
pub struct FlagRequest {
    /// Flag value in the 0..=7 range. 0 clears the flag; 1..=7 set one
    /// of the seven supported colours (red, orange, green, blue, pink,
    /// turquoise, purple — same colour ordering as the desktop browse
    /// pane).
    pub flag: u32,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct FlagResponse {
    pub id: i64,
    /// Post-action flag value (echo of the requested flag, modulo any
    /// future server-side capping). Lets the UI update its row without
    /// re-fetching the full `CardSummary`.
    pub flag: u32,
}

/// Set or clear a card's flag colour. POST `{"flag": 0}` clears,
/// POST `{"flag": N}` for N in 1..=7 sets the colour. Idempotent under
/// repeated calls with the same value (rslib `set_card_flag` no-ops
/// when the byte is unchanged). Missing card → 404; out-of-range flag
/// → 400.
#[utoipa::path(
    post,
    path = "/api/cards/{id}/flag",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = FlagResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Card id"))
)]
pub async fn post_flag(
    state: AppState,
    Path(id): Path<i64>,
    Json(req): Json<FlagRequest>,
) -> ApiResult<Json<FlagResponse>> {
    let flag = validate_flag(req.flag).map_err(ServerError::bad_request)?;
    let mut col = state.col.lock().await;
    let cid = CardId(id);
    if col.storage.get_card(cid)?.is_none() {
        return Err(ServerError::not_found(format!("card {id} not found")));
    }
    // rslib's set_card_flag takes a slice — single-card flips reuse the
    // bulk path with a one-element vec, mirroring how /suspend wraps
    // bury_or_suspend_cards. The lower-3-bits check matches rslib's
    // own `require!(flag < 8)`, but we re-validate at the API boundary
    // so a malformed request gets a clean 400 rather than a 500 from
    // the rslib panic-style require.
    col.set_card_flag(&[cid], flag)?;
    let card = col
        .storage
        .get_card(cid)?
        .ok_or_else(|| ServerError::from(anyhow!("card {id} disappeared post-flag")))?;
    Ok(Json(FlagResponse {
        id: cid.0,
        flag: card_user_flag(&card),
    }))
}

/// Pure validation surface for `FlagRequest`. The desktop browse pane
/// uses the same 0..=7 numeric range; flag 0 means "no flag" and is the
/// way to clear a previously-set colour.
fn validate_flag(flag: u32) -> Result<u32, &'static str> {
    if flag > 7 {
        return Err("flag must be between 0 and 7");
    }
    Ok(flag)
}

#[derive(Debug, Deserialize)]
pub struct MoveRequest {
    /// Target card ids. Must be non-empty; ids are deduplicated server-side
    /// before the rslib call so passing the same id twice is a safe no-op.
    /// Cards already in the target deck are silently skipped (rslib's
    /// `set_deck` short-circuits same-deck updates), and unknown card ids
    /// are silently dropped (rslib `all_cards_for_ids` returns only the
    /// rows that exist) — both cases simply lower the response `moved`
    /// count rather than failing the whole batch.
    pub card_ids: Vec<i64>,
    /// Target deck id. Must be a positive id of an existing non-filtered
    /// deck; filtered decks reject incoming card moves at the rslib layer
    /// (`FilteredDeckError::CanNotMoveCardsInto`).
    pub deck_id: i64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct MoveResponse {
    /// Count of cards re-parented in this call. Excludes cards that were
    /// already in the target deck and any unknown card ids that rslib
    /// silently skipped. Compare with the request's `card_ids.len()`
    /// client-side to detect a mismatch.
    pub moved: usize,
}

/// Per-request hard ceiling on `card_ids`. Anki collections in the wild
/// rarely have a single bulk operation over a few hundred cards, and the
/// rslib path holds the collection lock for the whole transaction, so a
/// runaway 100k batch would freeze every other request. 1000 leaves
/// plenty of headroom for Phase 20's bulk-select-in-browse without
/// risking a hung session.
const MOVE_MAX_CARDS: usize = 1000;

/// Pure validation for a `MoveRequest`. Mirrors the
/// `validate_pagination` / `validate_flag` `&'static str`-on-error pattern
/// so unit tests can cover every boundary without touching a Collection.
/// Returns the deduplicated, sorted card-id list so the handler doesn't
/// have to redo the work.
fn validate_move(card_ids: &[i64], deck_id: i64) -> Result<(Vec<i64>, i64), &'static str> {
    let deduped = validate_card_id_list(card_ids)?;
    if deck_id <= 0 {
        return Err("deck_id must be a positive integer");
    }
    Ok((deduped, deck_id))
}

/// Phase 20-B: shared validation helper for bulk card-id payloads.
/// Mirrors the `validate_move` shape (non-empty, positive, ≤1000,
/// deduped+sorted) without the deck_id leg, so bulk_suspend and
/// bulk_flag can reuse the same boundary checks. Returns the
/// deduplicated, sorted list so handlers don't redo the work.
fn validate_card_id_list(card_ids: &[i64]) -> Result<Vec<i64>, &'static str> {
    if card_ids.is_empty() {
        return Err("card_ids must not be empty");
    }
    if card_ids.len() > MOVE_MAX_CARDS {
        return Err("card_ids must contain at most 1000 entries");
    }
    if card_ids.iter().any(|&id| id <= 0) {
        return Err("card_ids must all be positive integers");
    }
    let mut deduped = card_ids.to_vec();
    deduped.sort_unstable();
    deduped.dedup();
    Ok(deduped)
}

/// Bulk-move a set of cards into a target deck. Wraps rslib's
/// `Collection::set_deck` (atomic via `transact(Op::SetCardDeck)`).
///
/// Validation order (cheap → expensive):
///   1. Request shape via `validate_move` — catches empty list,
///      over-limit batches, non-positive ids before any Collection access.
///   2. Target deck lookup — 404 if missing. Done explicitly here even
///      though rslib's `set_deck` would also error, so the response
///      status is "404 deck not found" rather than 500-from-AnkiError.
///   3. `set_deck` — does the rest: refuses filtered targets
///      (`FilteredDeckError::CanNotMoveCardsInto` → 400), silently skips
///      cards already in the target deck, silently drops unknown ids.
///
/// Forward-compat with Phase 20 bulk-select-in-browse: the wire shape
/// already takes a list, so multi-select just sends N ids instead of
/// 1. The 19-D UI sends a single-element list per move click.
#[utoipa::path(
    post,
    path = "/api/cards/move",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = MoveResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    )
)]
pub async fn post_move_cards(
    state: AppState,
    Json(req): Json<MoveRequest>,
) -> ApiResult<Json<MoveResponse>> {
    let (deduped_ids, deck_id) =
        validate_move(&req.card_ids, req.deck_id).map_err(ServerError::bad_request)?;
    let mut col = state.col.lock().await;
    let did = DeckId(deck_id);
    if col.get_deck(did)?.is_none() {
        return Err(ServerError::not_found(format!("deck {deck_id} not found")));
    }
    let cids: Vec<CardId> = deduped_ids.into_iter().map(CardId).collect();
    let result = col.set_deck(&cids, did).map_err(|e| match e {
        AnkiError::FilteredDeckError { .. } => {
            ServerError::bad_request(format!("target deck rejects card moves: {e}"))
        }
        AnkiError::NotFound { .. } => ServerError::not_found(format!("deck {deck_id} not found")),
        other => ServerError::from(other),
    })?;
    Ok(Json(MoveResponse {
        moved: result.output,
    }))
}

#[derive(Debug, Deserialize)]
pub struct BulkSuspendRequest {
    /// Target card ids. Same shape as `MoveRequest.card_ids` —
    /// non-empty, positive, deduped server-side, capped at 1000 per
    /// call.
    pub card_ids: Vec<i64>,
    /// If true (default), suspend the cards; if false, unsuspend. The
    /// underlying rslib calls are slice-aware and idempotent, so
    /// re-sending the same value is a safe no-op.
    #[serde(default = "default_suspended")]
    pub suspended: bool,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct BulkSuspendResponse {
    /// Count of input ids after dedup. Echoes the size of the batch
    /// the server actually processed; rslib silently skips unknown
    /// ids inside the slice, so a partial-hit batch still reports the
    /// post-dedup input length here. Compare against
    /// `request.card_ids.len()` client-side to detect dedup-collapse.
    pub count: usize,
    /// Echo of the requested target state so the client can update
    /// its row-state cache without re-fetching.
    pub suspended: bool,
}

/// Phase 20-B: bulk suspend / unsuspend. Wraps rslib's slice-aware
/// `bury_or_suspend_cards` / `unbury_or_unsuspend_cards`. Idempotent
/// under repeated calls with the same target state — re-sending the
/// same payload is a safe no-op. Unknown card ids inside the batch
/// are silently skipped at the rslib layer; the response `count`
/// reflects the deduplicated input length, NOT the count of rows
/// rslib actually mutated.
#[utoipa::path(
    post,
    path = "/api/cards/bulk_suspend",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = BulkSuspendResponse),
        (status = 400, body = crate::error::ApiError),
    )
)]
pub async fn post_bulk_suspend(
    state: AppState,
    Json(req): Json<BulkSuspendRequest>,
) -> ApiResult<Json<BulkSuspendResponse>> {
    let deduped_ids = validate_card_id_list(&req.card_ids).map_err(ServerError::bad_request)?;
    let mut col = state.col.lock().await;
    let cids: Vec<CardId> = deduped_ids.iter().copied().map(CardId).collect();
    if req.suspended {
        col.bury_or_suspend_cards(&cids, BuryOrSuspendMode::Suspend)?;
    } else {
        col.unbury_or_unsuspend_cards(&cids)?;
    }
    Ok(Json(BulkSuspendResponse {
        count: deduped_ids.len(),
        suspended: req.suspended,
    }))
}

#[derive(Debug, Deserialize)]
pub struct BulkFlagRequest {
    /// Target card ids. Same shape as `MoveRequest.card_ids`.
    pub card_ids: Vec<i64>,
    /// Flag value 0..=7. 0 clears; 1..=7 set one of the seven
    /// supported colours (red, orange, green, blue, pink, turquoise,
    /// purple — same colour ordering as the desktop browse pane).
    pub flag: u32,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct BulkFlagResponse {
    /// Count of input ids after dedup. Same convention as
    /// `BulkSuspendResponse.count` — see that doc for the
    /// silently-skipped-unknown-id note.
    pub count: usize,
    /// Echo of the requested flag so the client can update its
    /// row-flag cache without re-fetching.
    pub flag: u32,
}

/// Phase 20-B: bulk flag set/clear. Wraps rslib's slice-aware
/// `set_card_flag`. Idempotent under repeated calls with the same
/// flag value (rslib no-ops when the byte is unchanged). Unknown
/// card ids inside the batch are silently skipped at the rslib
/// layer; the response `count` reflects the deduplicated input
/// length, NOT the count of rows rslib actually mutated.
#[utoipa::path(
    post,
    path = "/api/cards/bulk_flag",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = BulkFlagResponse),
        (status = 400, body = crate::error::ApiError),
    )
)]
pub async fn post_bulk_flag(
    state: AppState,
    Json(req): Json<BulkFlagRequest>,
) -> ApiResult<Json<BulkFlagResponse>> {
    let deduped_ids = validate_card_id_list(&req.card_ids).map_err(ServerError::bad_request)?;
    let flag = validate_flag(req.flag).map_err(ServerError::bad_request)?;
    let mut col = state.col.lock().await;
    let cids: Vec<CardId> = deduped_ids.iter().copied().map(CardId).collect();
    col.set_card_flag(&cids, flag)?;
    Ok(Json(BulkFlagResponse {
        count: deduped_ids.len(),
        flag,
    }))
}

/// Phase 20-D: per-card review history viewer. Read-only — returns the
/// card's revlog entries newest-first so the browse editor's disclosure
/// can render a chronological list without sorting client-side. The
/// rslib primitive (`get_revlog_entries_for_card`) returns rows in
/// storage order; we reverse to newest-first by sorting on the
/// millisecond-epoch `id`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CardHistoryEntry {
    /// Millisecond epoch timestamp of the review.
    pub id: i64,
    /// 0=manual/cram, 1=Again, 2=Hard, 3=Good, 4=Easy.
    pub button: u8,
    /// Human label: "again" | "hard" | "good" | "easy" | "manual".
    pub button_label: &'static str,
    /// Post-review interval in days (negative = seconds for sub-day reviews).
    pub interval_days: i32,
    /// Pre-review interval in days (same sign convention).
    pub last_interval_days: i32,
    /// Ease factor in percent (e.g. 250 means 2.50). 0 if unset.
    pub ease_percent: u32,
    /// Time taken to answer, in milliseconds.
    pub taken_ms: u32,
    /// "learning" | "review" | "relearning" | "filtered" | "manual" | "rescheduled".
    pub review_kind: &'static str,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CardHistoryResponse {
    pub card_id: i64,
    pub total: usize,
    pub entries: Vec<CardHistoryEntry>,
}

/// Map the raw `button_chosen` byte (0..=4) to a stable lowercase label.
/// 0 is the historical "manual / cram" sentinel — see RevlogEntry docs;
/// 5+ would only appear from a corrupted row, so we floor it to "manual"
/// rather than 500-ing the whole response.
fn button_label(b: u8) -> &'static str {
    match b {
        1 => "again",
        2 => "hard",
        3 => "good",
        4 => "easy",
        _ => "manual",
    }
}

/// Map RevlogReviewKind to a stable lowercase wire string. Mirrors the
/// `button_label` shape so the client gets two parallel string enums it
/// can match on without reaching for an integer.
fn review_kind_label(rk: RevlogReviewKind) -> &'static str {
    match rk {
        RevlogReviewKind::Learning => "learning",
        RevlogReviewKind::Review => "review",
        RevlogReviewKind::Relearning => "relearning",
        RevlogReviewKind::Filtered => "filtered",
        RevlogReviewKind::Manual => "manual",
        RevlogReviewKind::Rescheduled => "rescheduled",
    }
}

/// Fetch a single card's revlog entries newest-first.
#[utoipa::path(
    get,
    path = "/api/cards/{id}/history",
    responses(
        (status = 200, body = CardHistoryResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Card id"))
)]
pub async fn get_card_history(
    state: AppState,
    Path(id): Path<i64>,
) -> ApiResult<Json<CardHistoryResponse>> {
    if id <= 0 {
        return Err(ServerError::bad_request("id must be a positive integer"));
    }
    let col = state.col.lock().await;
    let cid = CardId(id);
    if col.storage.get_card(cid)?.is_none() {
        return Err(ServerError::not_found(format!("card {id} not found")));
    }
    let mut entries = col.storage.get_revlog_entries_for_card(cid)?;
    // Newest-first by epoch-ms id. Storage returns rows in insertion
    // order (which happens to be ascending id), so a stable
    // descending sort gives the wire ordering the browse list expects.
    entries.sort_by(|a, b| b.id.0.cmp(&a.id.0));
    let total = entries.len();
    let entries = entries
        .into_iter()
        .map(|e| CardHistoryEntry {
            id: e.id.0,
            button: e.button_chosen,
            button_label: button_label(e.button_chosen),
            interval_days: e.interval,
            last_interval_days: e.last_interval,
            // rslib stores ease as 10× the percent (2500 = 250%) — see
            // the RevlogEntry doc comment in rslib/src/revlog/mod.rs.
            // Divide by 10 here so the wire value is the human-readable
            // percent the UI renders directly.
            ease_percent: e.ease_factor / 10,
            taken_ms: e.taken_millis,
            review_kind: review_kind_label(e.review_kind),
        })
        .collect();
    Ok(Json(CardHistoryResponse {
        card_id: cid.0,
        total,
        entries,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_pagination_rejects_zero_limit() {
        assert!(validate_pagination(0, 0).is_err());
        assert!(validate_pagination(50, 0).is_err());
    }

    #[test]
    fn validate_pagination_rejects_oversize_limit() {
        assert!(validate_pagination(0, MAX_LIMIT + 1).is_err());
        assert!(validate_pagination(0, usize::MAX).is_err());
    }

    #[test]
    fn validate_pagination_accepts_inclusive_boundaries() {
        assert_eq!(validate_pagination(0, 1).unwrap(), (0, 1));
        assert_eq!(validate_pagination(0, MAX_LIMIT).unwrap(), (0, MAX_LIMIT));
    }

    #[test]
    fn validate_pagination_accepts_default_limit() {
        let limit = default_limit();
        assert_eq!(validate_pagination(0, limit).unwrap(), (0, 50));
    }

    #[test]
    fn validate_pagination_passes_offset_through_unchanged() {
        // Offset has no upper bound — Anki collections in the wild stay
        // well under usize::MAX, and `.skip(huge)` is just an empty slice.
        assert_eq!(
            validate_pagination(usize::MAX, 50).unwrap(),
            (usize::MAX, 50)
        );
        assert_eq!(validate_pagination(1_000_000, 50).unwrap(), (1_000_000, 50));
    }

    #[test]
    fn validate_flag_accepts_zero_and_seven() {
        // 0 clears the flag (the documented "no flag" sentinel). 7 is
        // the upper bound — rslib's set_card_flag rejects 8+ via
        // `require!(flag < 8)`, so we mirror the boundary at the API
        // edge to fail fast with a clean 400.
        assert_eq!(validate_flag(0).unwrap(), 0);
        assert_eq!(validate_flag(7).unwrap(), 7);
    }

    #[test]
    fn validate_flag_accepts_each_documented_colour() {
        // The desktop browse pane has 7 colours (red/orange/green/blue/
        // pink/turquoise/purple); pinning every value catches an
        // accidental off-by-one in a future range tweak.
        for n in 1..=7u32 {
            assert!(validate_flag(n).is_ok(), "flag {n} must be accepted");
        }
    }

    #[test]
    fn validate_flag_rejects_above_seven() {
        // 8 is the first rejected value (matches rslib's `flag < 8`
        // require); larger values hit the same human-readable error so
        // a clueless client doesn't leak the rslib-internal panic
        // message via a 500.
        assert_eq!(
            validate_flag(8).unwrap_err(),
            "flag must be between 0 and 7"
        );
        assert_eq!(
            validate_flag(99).unwrap_err(),
            "flag must be between 0 and 7"
        );
        assert_eq!(
            validate_flag(u32::MAX).unwrap_err(),
            "flag must be between 0 and 7"
        );
    }

    #[test]
    fn validate_move_rejects_empty_card_ids() {
        assert_eq!(
            validate_move(&[], 1).unwrap_err(),
            "card_ids must not be empty"
        );
    }

    #[test]
    fn validate_move_rejects_oversize_batch() {
        // MOVE_MAX_CARDS + 1 trips the ceiling; usize::MAX guards against
        // an integer-overflow style attempt to bypass the cap.
        let oversize = vec![1_i64; MOVE_MAX_CARDS + 1];
        assert_eq!(
            validate_move(&oversize, 1).unwrap_err(),
            "card_ids must contain at most 1000 entries"
        );
    }

    #[test]
    fn validate_move_accepts_max_batch_at_boundary() {
        let at_limit = vec![1_i64; MOVE_MAX_CARDS];
        assert!(validate_move(&at_limit, 1).is_ok());
    }

    #[test]
    fn validate_move_rejects_non_positive_card_id() {
        // 0 is reserved (no real Anki id is 0); negatives are nonsense.
        // Either taints the whole batch — fail fast at the boundary so
        // the rslib path doesn't have to deal with it.
        assert_eq!(
            validate_move(&[0], 1).unwrap_err(),
            "card_ids must all be positive integers"
        );
        assert_eq!(
            validate_move(&[-1], 1).unwrap_err(),
            "card_ids must all be positive integers"
        );
        assert_eq!(
            validate_move(&[1, 2, -3], 1).unwrap_err(),
            "card_ids must all be positive integers"
        );
    }

    #[test]
    fn validate_move_rejects_non_positive_deck_id() {
        assert_eq!(
            validate_move(&[1], 0).unwrap_err(),
            "deck_id must be a positive integer"
        );
        assert_eq!(
            validate_move(&[1], -1).unwrap_err(),
            "deck_id must be a positive integer"
        );
    }

    #[test]
    fn validate_move_dedupes_card_ids() {
        // Duplicate ids are dropped so the rslib transaction doesn't
        // process the same row twice. Sort keeps the output deterministic
        // for downstream call-site expectations.
        let (ids, deck_id) = validate_move(&[3, 1, 2, 1, 3], 5).unwrap();
        assert_eq!(ids, vec![1, 2, 3]);
        assert_eq!(deck_id, 5);
    }

    #[test]
    fn validate_move_passes_through_singleton() {
        let (ids, deck_id) = validate_move(&[42], 7).unwrap();
        assert_eq!(ids, vec![42]);
        assert_eq!(deck_id, 7);
    }

    // Phase 20-D: per-card history label maps. Pure-function coverage —
    // the handler itself is a thin orchestration over storage so its
    // behaviour falls out of the rslib path; integration coverage
    // (which would need a Collection fixture) is deliberately deferred.
    #[test]
    fn button_label_maps_each_documented_value() {
        assert_eq!(button_label(1), "again");
        assert_eq!(button_label(2), "hard");
        assert_eq!(button_label(3), "good");
        assert_eq!(button_label(4), "easy");
        // 0 is the historical "manual / cram" sentinel — see RevlogEntry
        // doc comment in rslib/src/revlog/mod.rs ("0 represents manual
        // rescheduling").
        assert_eq!(button_label(0), "manual");
    }

    #[test]
    fn button_label_floors_unknown_values_to_manual() {
        // Defensive: a corrupted row with an out-of-range byte must not
        // 500 the response. The label stays a stable string so the UI's
        // match never blows up on a user with a damaged collection.
        assert_eq!(button_label(5), "manual");
        assert_eq!(button_label(99), "manual");
        assert_eq!(button_label(u8::MAX), "manual");
    }

    // Phase 20-B: shared bulk-id validation. The bulk_suspend /
    // bulk_flag handlers reuse validate_card_id_list, so the cheap
    // boundary cases stay covered as pure functions even though the
    // handler bodies require a Collection fixture (deferred — same
    // pattern as post_move_cards).
    #[test]
    fn validate_card_id_list_rejects_empty() {
        assert_eq!(
            validate_card_id_list(&[]).unwrap_err(),
            "card_ids must not be empty"
        );
    }

    #[test]
    fn validate_card_id_list_rejects_oversize_batch() {
        let oversize = vec![1_i64; MOVE_MAX_CARDS + 1];
        assert_eq!(
            validate_card_id_list(&oversize).unwrap_err(),
            "card_ids must contain at most 1000 entries"
        );
    }

    #[test]
    fn validate_card_id_list_accepts_max_batch_at_boundary() {
        let at_limit = vec![1_i64; MOVE_MAX_CARDS];
        assert!(validate_card_id_list(&at_limit).is_ok());
    }

    #[test]
    fn validate_card_id_list_rejects_non_positive_id() {
        assert_eq!(
            validate_card_id_list(&[0]).unwrap_err(),
            "card_ids must all be positive integers"
        );
        assert_eq!(
            validate_card_id_list(&[-1]).unwrap_err(),
            "card_ids must all be positive integers"
        );
        assert_eq!(
            validate_card_id_list(&[1, 2, -3]).unwrap_err(),
            "card_ids must all be positive integers"
        );
    }

    #[test]
    fn validate_card_id_list_dedupes() {
        let ids = validate_card_id_list(&[3, 1, 2, 1, 3]).unwrap();
        assert_eq!(ids, vec![1, 2, 3]);
    }

    #[test]
    fn validate_card_id_list_passes_through_singleton() {
        let ids = validate_card_id_list(&[42]).unwrap();
        assert_eq!(ids, vec![42]);
    }

    #[test]
    fn validate_move_still_rejects_deck_after_card_id_extraction() {
        // After extracting validate_card_id_list, validate_move must
        // still reject a non-positive deck_id even when the card_ids
        // pass — covers the post-refactor split so a future tweak to
        // the helper can't silently drop the deck-id leg.
        assert_eq!(
            validate_move(&[1, 2, 3], 0).unwrap_err(),
            "deck_id must be a positive integer"
        );
        assert_eq!(
            validate_move(&[1, 2, 3], -1).unwrap_err(),
            "deck_id must be a positive integer"
        );
    }

    #[test]
    fn review_kind_label_maps_each_variant() {
        assert_eq!(review_kind_label(RevlogReviewKind::Learning), "learning");
        assert_eq!(review_kind_label(RevlogReviewKind::Review), "review");
        assert_eq!(
            review_kind_label(RevlogReviewKind::Relearning),
            "relearning"
        );
        assert_eq!(review_kind_label(RevlogReviewKind::Filtered), "filtered");
        assert_eq!(review_kind_label(RevlogReviewKind::Manual), "manual");
        assert_eq!(
            review_kind_label(RevlogReviewKind::Rescheduled),
            "rescheduled"
        );
    }
}
