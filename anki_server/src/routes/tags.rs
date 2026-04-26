use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::error::ApiResult;
use crate::state::AppState;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct TagListResponse {
    pub tags: Vec<String>,
}

/// Return all tag names in the collection, alphabetically sorted.
#[utoipa::path(
    get,
    path = "/api/tags",
    responses((status = 200, body = TagListResponse))
)]
pub async fn list_tags(State(state): State<AppState>) -> ApiResult<Json<TagListResponse>> {
    let col = state.col.lock().await;
    let tags = col
        .storage
        .all_tags()?
        .into_iter()
        .map(|t| t.name)
        .collect();
    Ok(Json(TagListResponse { tags }))
}
