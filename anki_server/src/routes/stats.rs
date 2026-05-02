use anki::prelude::TimestampSecs;
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiResult, ServerError};
use crate::state::AppState;

const MAX_DAYS: u32 = 365;
const DEFAULT_DAYS: u32 = 30;

fn default_days() -> u32 {
    DEFAULT_DAYS
}

#[derive(Debug, Deserialize)]
pub struct RecentQuery {
    #[serde(default = "default_days")]
    pub days: u32,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DayCount {
    /// Server-local calendar date in `YYYY-MM-DD`.
    pub date: String,
    pub reviews: u32,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct StatsRecentResponse {
    /// Echoed window length (days, after clamping).
    pub days: u32,
    /// Exactly `days` entries, oldest first, including days with zero reviews.
    pub history: Vec<DayCount>,
}

fn validate_days(d: u32) -> Result<u32, &'static str> {
    if d < 1 {
        return Err("days must be >= 1");
    }
    if d > MAX_DAYS {
        return Err("days must be <= 365");
    }
    Ok(d)
}

// Pre-pads zero-review days inside SQL via a RECURSIVE CTE so the client
// gets exactly `days` rows oldest-first. Calendar days use the server's
// local timezone — single-user-localhost deployment, so the server's TZ
// is the user's TZ. Aggregates ALL revlog rows in the window (including
// manual rating changes); for a "study activity" sparkline this matches
// the user's intuition of "did I study that day".
const RECENT_HISTORY_SQL: &str = "\
WITH RECURSIVE win(d) AS ( \
    SELECT date(?1 / 1000, 'unixepoch', 'localtime') \
    UNION ALL \
    SELECT date(d, '+1 day') FROM win WHERE d < date('now', 'localtime') \
), agg AS ( \
    SELECT date(id / 1000, 'unixepoch', 'localtime') AS d, COUNT(*) AS n \
    FROM revlog WHERE id >= ?1 GROUP BY d \
) \
SELECT win.d, COALESCE(agg.n, 0) AS n \
FROM win LEFT JOIN agg ON win.d = agg.d \
ORDER BY win.d";

/// Recent review activity grouped by server-local calendar day.
///
/// `days` is clamped to `[1, 365]`; the response always carries exactly
/// `days` entries, oldest first, with zero-review days padded so a client
/// sparkline can `slice(-7).map(d => d.reviews)` without gap-filling.
#[utoipa::path(
    get,
    path = "/api/stats/recent",
    params(("days" = Option<u32>, Query, description = "Window length, 1..=365 (default 30)")),
    responses(
        (status = 200, body = StatsRecentResponse),
        (status = 400, body = crate::error::ApiError),
    )
)]
pub async fn get_recent(
    State(state): State<AppState>,
    Query(q): Query<RecentQuery>,
) -> ApiResult<Json<StatsRecentResponse>> {
    let days = validate_days(q.days).map_err(ServerError::bad_request)?;
    // Cutoff ms: midnight-of-(days-1-ago) is what we want, but the SQL
    // CTE re-derives the date via `date(?1/1000, 'unixepoch', 'localtime')`
    // so passing now-(days-1)*86_400s gives the same calendar day as
    // "today minus (days-1) days" in the server's local TZ.
    let cutoff_ms: i64 = TimestampSecs::now().0 * 1000 - (days as i64 - 1) * 86_400_000;

    let col = state.col.lock().await;
    let mut stmt = col.storage.db().prepare(RECENT_HISTORY_SQL)?;
    let history: Vec<DayCount> = stmt
        .query_map([cutoff_ms], |row| {
            Ok(DayCount {
                date: row.get::<_, String>(0)?,
                reviews: row.get::<_, u32>(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Json(StatsRecentResponse { days, history }))
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct AnswerButtonsResponse {
    /// Echoed window length (days, after clamping).
    pub days: u32,
    /// Count of `Again` (FSRS rating 1) reviews in the window.
    pub again: u32,
    /// Count of `Hard` (FSRS rating 2) reviews in the window.
    pub hard: u32,
    /// Count of `Good` (FSRS rating 3) reviews in the window.
    pub good: u32,
    /// Count of `Easy` (FSRS rating 4) reviews in the window.
    pub easy: u32,
}

// `revlog.ease` stores the four-button rating (1=Again, 2=Hard, 3=Good,
// 4=Easy). Manual rating-overrides (rated:1:1 etc.) and resets land in
// the same column, so this matches the user's intuition of "how often
// did I press each button". Window is the same `[id >= cutoff_ms]`
// shape as get_recent so the two endpoints stay consistent.
const ANSWER_BUTTONS_SQL: &str =
    "SELECT ease, COUNT(*) FROM revlog WHERE id >= ?1 GROUP BY ease";

/// Distribution of Again/Hard/Good/Easy presses in the last `days` days.
#[utoipa::path(
    get,
    path = "/api/stats/answer_buttons",
    params(("days" = Option<u32>, Query, description = "Window length, 1..=365 (default 30)")),
    responses(
        (status = 200, body = AnswerButtonsResponse),
        (status = 400, body = crate::error::ApiError),
    )
)]
pub async fn get_answer_buttons(
    State(state): State<AppState>,
    Query(q): Query<RecentQuery>,
) -> ApiResult<Json<AnswerButtonsResponse>> {
    let days = validate_days(q.days).map_err(ServerError::bad_request)?;
    let cutoff_ms: i64 = TimestampSecs::now().0 * 1000 - (days as i64 - 1) * 86_400_000;

    let col = state.col.lock().await;
    let mut stmt = col.storage.db().prepare(ANSWER_BUTTONS_SQL)?;
    let mut again = 0u32;
    let mut hard = 0u32;
    let mut good = 0u32;
    let mut easy = 0u32;
    for row in stmt.query_map([cutoff_ms], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, u32>(1)?))
    })? {
        let (ease, n) = row?;
        match ease {
            1 => again = n,
            2 => hard = n,
            3 => good = n,
            4 => easy = n,
            _ => {}
        }
    }

    Ok(Json(AnswerButtonsResponse {
        days,
        again,
        hard,
        good,
        easy,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_days_rejects_zero() {
        assert!(validate_days(0).is_err());
    }

    #[test]
    fn validate_days_rejects_above_one_year() {
        assert!(validate_days(MAX_DAYS + 1).is_err());
        assert!(validate_days(u32::MAX).is_err());
    }

    #[test]
    fn validate_days_accepts_inclusive_boundaries() {
        assert_eq!(validate_days(1).unwrap(), 1);
        assert_eq!(validate_days(MAX_DAYS).unwrap(), MAX_DAYS);
    }

    #[test]
    fn validate_days_accepts_default() {
        assert_eq!(validate_days(default_days()).unwrap(), DEFAULT_DAYS);
    }
}
