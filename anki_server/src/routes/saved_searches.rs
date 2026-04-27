// Phase 18-C: persisted saved-search list. Stored as a JSON array
// under the collection-config key `ferdinand:saved_searches` so the
// data lives inside the Anki collection file (round-trips on backup,
// follows the user across devices once sync lands in M4) without
// touching the desktop-Anki schema. The desktop client never reads
// this key — it's a Ferdinand-private extension behind the
// `ferdinand:` namespace prefix.

use anki::prelude::*;
use anki::services::ConfigService;
use anki::timestamp::TimestampSecs;
use anki_proto::generic;
use anyhow::anyhow;
use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiResult, ServerError};
use crate::state::AppState;

/// Collection-config key for the saved-search list. The
/// `ferdinand:` prefix keeps Ferdinand-specific extensions namespaced
/// away from any future Anki upstream key collision.
const SAVED_SEARCHES_KEY: &str = "ferdinand:saved_searches";
const NAME_MAX_CHARS: usize = 60;
const QUERY_MAX_CHARS: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct SavedSearch {
    /// Human-readable label for the saved search. Unique within the
    /// list (case-sensitive); the path-addressed DELETE keys off this
    /// so collisions would resolve ambiguously.
    pub name: String,
    /// Anki search expression — same syntax the browse search bar
    /// accepts. Server does NOT validate the expression here (saving
    /// a "broken" search and fixing it later is fine); the
    /// /api/cards search endpoint will surface invalid syntax with a
    /// 400 when the user tries to *run* it.
    pub query: String,
    /// Epoch seconds when the entry was added. Lets the client sort
    /// by recency without a separate sort field.
    pub created_at: i64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SavedSearchListResponse {
    pub searches: Vec<SavedSearch>,
}

#[derive(Debug, Deserialize)]
pub struct SavedSearchCreateRequest {
    pub name: String,
    pub query: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SavedSearchDeleteResponse {
    pub removed_name: String,
}

/// Pure-shape validation for saved-search names. Rejects:
///   - blank / whitespace-only (would render as an empty pill).
///   - over-60 chars (counted by Unicode chars, not bytes — same
///     fairness rule as deck name validation in 14-C).
///   - `/` (would break the path-addressed DELETE route).
///   - leading/trailing whitespace stays trimmed via the wrapper.
fn validate_name(name: &str) -> Result<&str, &'static str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("name must not be empty");
    }
    if trimmed.chars().count() > NAME_MAX_CHARS {
        return Err("name must be at most 60 characters");
    }
    if trimmed.contains('/') {
        return Err("name must not contain '/'");
    }
    Ok(trimmed)
}

/// Pure-shape validation for saved-search query expressions.
/// Whitespace-only would persist a no-op search; over-1000 chars is a
/// generous ceiling that still bounds the column width in the
/// sidebar. Anki search syntax itself is validated lazily — this
/// route only saves text, the /api/cards endpoint judges syntactic
/// validity at run time.
fn validate_query(query: &str) -> Result<&str, &'static str> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("query must not be empty");
    }
    if trimmed.chars().count() > QUERY_MAX_CHARS {
        return Err("query must be at most 1000 characters");
    }
    Ok(trimmed)
}

/// Read the persisted list from `ConfigService::get_config_json`.
/// The trait method maps "key absent" to `AnkiError::NotFound`; we
/// re-interpret that as "fresh collection, empty list" rather than
/// surfacing it as a 404 — every brand-new collection has zero
/// saved searches, and forcing the client to handle 404 there would
/// be cosmetic noise.
fn read_saved_searches(col: &mut Collection) -> ApiResult<Vec<SavedSearch>> {
    let input = generic::String {
        val: SAVED_SEARCHES_KEY.to_string(),
    };
    match col.get_config_json(input) {
        Ok(json) => {
            let parsed: Vec<SavedSearch> = serde_json::from_slice(&json.json)
                .map_err(|e| ServerError::from(anyhow!("malformed saved_searches: {e}")))?;
            Ok(parsed)
        }
        Err(AnkiError::NotFound { .. }) => Ok(Vec::new()),
        Err(other) => Err(ServerError::from(other)),
    }
}

/// Phase 18-C: list every saved search persisted on the collection.
///
/// Stable ordering: keep insertion order. The client sorts by
/// `created_at` if it wants recency-first; alphabetical sort is also
/// a one-liner client-side.
#[utoipa::path(
    get,
    path = "/api/saved_searches",
    responses((status = 200, body = SavedSearchListResponse))
)]
pub async fn list_saved(
    State(state): State<AppState>,
) -> ApiResult<Json<SavedSearchListResponse>> {
    let mut col = state.col.lock().await;
    let searches = read_saved_searches(&mut col)?;
    Ok(Json(SavedSearchListResponse { searches }))
}

/// Phase 18-C: append a new saved search.
///
/// Validation order (cheap → expensive):
///   1. `validate_name` rejects empty / >60 chars / `/`-containing.
///   2. `validate_query` rejects empty / >1000 chars.
///   3. Existing-name uniqueness check: 409-style 400 (the same
///      "Default deck cannot be deleted" pattern from 15-A — surface
///      the conflict at the boundary rather than silently overwrite).
///   4. Persist the full list back via `set_config_json`. The whole
///      array is rewritten on each mutation; saved-search lists are
///      O(few dozen) at most so the read-modify-write cost is fine
///      and avoids the partial-update consistency problem.
#[utoipa::path(
    post,
    path = "/api/saved_searches",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = SavedSearch),
        (status = 400, body = crate::error::ApiError),
    )
)]
pub async fn post_saved(
    State(state): State<AppState>,
    Json(req): Json<SavedSearchCreateRequest>,
) -> ApiResult<Json<SavedSearch>> {
    let trimmed_name = validate_name(&req.name).map_err(ServerError::bad_request)?;
    let trimmed_query = validate_query(&req.query).map_err(ServerError::bad_request)?;

    let mut col = state.col.lock().await;
    let mut current = read_saved_searches(&mut col)?;
    if current.iter().any(|s| s.name == trimmed_name) {
        return Err(ServerError::bad_request(format!(
            "saved search '{trimmed_name}' already exists"
        )));
    }

    let entry = SavedSearch {
        name: trimmed_name.to_string(),
        query: trimmed_query.to_string(),
        created_at: TimestampSecs::now().0,
    };
    current.push(entry.clone());
    // `undoable: false` matches FsrsHealthCheck (15-B): saved-search
    // edits aren't part of the review undo stack — they're metadata.
    col.set_config_json(SAVED_SEARCHES_KEY, &current, false)?;
    Ok(Json(entry))
}

/// Phase 18-C: remove a saved search by name.
///
/// 404 when the name isn't in the list (path-addressed misses match
/// the 13-A / 15-A delete-route convention). Empty list after the
/// removal is permitted — the key stays set with `[]` rather than
/// being removed, so the next POST doesn't have to round-trip
/// through the not-found→empty branch.
#[utoipa::path(
    delete,
    path = "/api/saved_searches/{name}",
    responses(
        (status = 200, body = SavedSearchDeleteResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("name" = String, Path, description = "Saved-search name (URL-encoded)"))
)]
pub async fn delete_saved(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> ApiResult<Json<SavedSearchDeleteResponse>> {
    // Even though axum URL-decodes for us, we re-validate the shape
    // so a malformed empty / >60-char path can never reach the
    // collection. `/` is rejected by validate_name; axum's path
    // matcher would already split on it before we got here, but the
    // belt-and-suspenders rejection keeps the boundary rule uniform
    // with POST.
    let trimmed = validate_name(&name).map_err(ServerError::bad_request)?;
    let mut col = state.col.lock().await;
    let mut current = read_saved_searches(&mut col)?;
    let before = current.len();
    current.retain(|s| s.name != trimmed);
    if current.len() == before {
        return Err(ServerError::not_found(format!(
            "saved search '{trimmed}' not found"
        )));
    }
    col.set_config_json(SAVED_SEARCHES_KEY, &current, false)?;
    Ok(Json(SavedSearchDeleteResponse {
        removed_name: trimmed.to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_name_rejects_blank_and_whitespace() {
        for bad in ["", "   ", "\t\n", "  \r\n  "] {
            assert_eq!(
                validate_name(bad).unwrap_err(),
                "name must not be empty",
                "bad={bad:?}"
            );
        }
    }

    #[test]
    fn validate_name_enforces_chars_not_bytes_budget() {
        // 60 single-byte chars: pass. 61 fails. 60 CJK chars (180
        // bytes) also pass — the cap is on display chars, not bytes,
        // matching deck/preset name budgets.
        let ascii_60 = "a".repeat(60);
        assert_eq!(validate_name(&ascii_60).unwrap(), ascii_60);
        let ascii_61 = "a".repeat(61);
        assert_eq!(
            validate_name(&ascii_61).unwrap_err(),
            "name must be at most 60 characters"
        );
        let cjk_60 = "森".repeat(60);
        assert_eq!(cjk_60.len(), 180);
        assert_eq!(validate_name(&cjk_60).unwrap(), cjk_60);
    }

    #[test]
    fn validate_name_rejects_slash() {
        // `/` would split the path-addressed DELETE so the route
        // never sees the full name. Reject at the boundary.
        for bad in ["a/b", "/leading", "trailing/", "with/slash/inside"] {
            assert_eq!(
                validate_name(bad).unwrap_err(),
                "name must not contain '/'",
                "bad={bad:?}"
            );
        }
    }

    #[test]
    fn validate_name_accepts_typical_names() {
        // Spaces, CJK, punctuation other than `/` all pass.
        assert_eq!(validate_name("Due cards").unwrap(), "Due cards");
        assert_eq!(validate_name("難しい単語").unwrap(), "難しい単語");
        assert_eq!(
            validate_name("hard:tag review").unwrap(),
            "hard:tag review"
        );
        // Trim leading/trailing whitespace.
        assert_eq!(validate_name("  Padded  ").unwrap(), "Padded");
    }

    #[test]
    fn validate_query_rejects_blank() {
        assert_eq!(validate_query("").unwrap_err(), "query must not be empty");
        assert_eq!(
            validate_query("   ").unwrap_err(),
            "query must not be empty"
        );
    }

    #[test]
    fn validate_query_caps_at_1000_chars() {
        let q1000 = "a".repeat(1000);
        assert_eq!(validate_query(&q1000).unwrap(), q1000);
        let q1001 = "a".repeat(1001);
        assert_eq!(
            validate_query(&q1001).unwrap_err(),
            "query must be at most 1000 characters"
        );
    }
}
