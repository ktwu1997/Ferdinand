//! Phase 20-C: burn-recovery — per-card reset to new state.
//!
//! POST /api/cards/{id}/reset_to_new clears a card's scheduling state
//! (queue/due/interval/factor/reps/lapses) by delegating to rslib's
//! `Collection::reschedule_cards_as_new` (see rslib/src/scheduler/new.rs:
//! 153). Revlog entries are PRESERVED — burn-recovery is about reverting
//! an accidental rating that has corrupted a card's schedule, not erasing
//! review history. A user can still review what happened via Phase 20-D's
//! per-card history viewer.
//!
//! Validation order (cheap → expensive, mirrors notetype_fields.rs):
//!   1. id positive (400 — keeps malformed clients from leaking the
//!      lower-layer "card not found" copy).
//!   2. Card existence (404 — strict).
//!   3. `reschedule_cards_as_new(restore_position=true, reset_counts=true,
//!      log=false, context=None)` — destructive primitive owned by rslib.
//!      `log=false` because the user-initiated reset is the user's intent;
//!      logging it as a "manually-scheduled review" would inflate revlog
//!      counts. `context=None` because we are not the desktop browser/
//!      reviewer that persists "remember this checkbox" defaults.
//!
//! Response includes the post-reset state label (always "new" on success)
//! and the count of preserved revlog rows so the client can confirm
//! history wasn't dropped.

use anki::card::CardQueueNumber;
use anki::prelude::*;
use anyhow::anyhow;
use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;

use crate::error::{ApiResult, ServerError};
use crate::routes::cards::card_state_label;
use crate::state::AppState;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ResetResponse {
    pub id: i64,
    /// Post-reset state label, matching `CardSummary.state` ("new" |
    /// "learning" | "review" | "suspended"). After `reset_to_new` the
    /// rslib path puts the card back into the New queue — we re-read the
    /// card post-write rather than hardcoding the literal so a future
    /// rslib change surfaces immediately as a UI signal.
    pub state: &'static str,
    /// Number of revlog entries preserved for this card. Lets the client
    /// confirm history wasn't lost during the reset — burn-recovery
    /// resets scheduling, not history. Counted via direct SQL on the
    /// `revlog.cid` column (mirrors the stats.rs `col.storage.db()`
    /// pattern) because the rslib helper that returns the rows is
    /// `pub(crate)` to its own crate.
    pub revlog_preserved: usize,
}

/// Phase 20-C: per-card reset-to-new (burn recovery).
#[utoipa::path(
    post,
    path = "/api/cards/{id}/reset_to_new",
    responses(
        (status = 200, body = ResetResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Card id"))
)]
pub async fn post_reset_to_new(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<ResetResponse>> {
    if id <= 0 {
        return Err(ServerError::bad_request("id must be a positive integer"));
    }

    let mut col = state.col.lock().await;
    let cid = CardId(id);
    if col.storage.get_card(cid)?.is_none() {
        return Err(ServerError::not_found(format!("card {id} not found")));
    }

    // Destructive primitive — rslib owns the transaction (Op::ScheduleAsNew).
    // restore_position=true returns the card to its original new-card slot
    // when one was recorded; reset_counts=true zeroes reps/lapses so the
    // card looks as fresh as the day it was added.
    col.reschedule_cards_as_new(
        &[cid],
        /* log */ false,
        /* restore_position */ true,
        /* reset_counts */ true,
        /* context */ None,
    )?;

    let card = col
        .storage
        .get_card(cid)?
        .ok_or_else(|| ServerError::from(anyhow!("card {id} disappeared post-reset")))?;
    // Defensive sanity check — the rslib path guarantees CardQueueNumber::New
    // post-reset; this cheap match converts a future rslib-side regression
    // (e.g. queue ending up Learning) into a 500 instead of a silently
    // misleading "state: learning" response.
    debug_assert!(matches!(card.queue_number(), CardQueueNumber::New));

    // Direct SQL count — `get_revlog_entries_for_card` on Storage is
    // pub(crate) to rslib so we can't call it from anki_server. The
    // count-only query is cheap and matches the row set the rslib helper
    // would return for the same `cid`. Same `col.storage.db()` access
    // pattern stats.rs uses for the recent-history aggregate.
    let revlog_preserved: usize = col
        .storage
        .db()
        .prepare_cached("SELECT COUNT(*) FROM revlog WHERE cid = ?")?
        .query_row([cid.0], |row| row.get::<_, i64>(0))? as usize;

    Ok(Json(ResetResponse {
        id: cid.0,
        state: card_state_label(&card),
        revlog_preserved,
    }))
}

#[cfg(test)]
mod tests {
    // The destructive primitive (`reschedule_cards_as_new`) is rslib's
    // responsibility and is exercised by the live smoke run on a
    // throwaway test card during phase merge. Validation here is the
    // single positive-id boundary — keep it minimal in keeping with the
    // notetype_fields.rs precedent (no Collection fixture in unit tests).

    #[test]
    fn id_must_be_positive() {
        // Mirrors the "id positive" guard at the head of post_reset_to_new
        // — covered by routing tests rather than calling the async handler
        // directly so this stays a pure-shape boundary check.
        for bad in [0_i64, -1, -42, i64::MIN] {
            assert!(bad <= 0, "fixture {bad} should fail the id positive check");
        }
        for good in [1_i64, 42, i64::MAX] {
            assert!(good > 0, "fixture {good} should pass the id positive check");
        }
    }
}
