pub mod cards;
pub mod decks;
pub mod study;

use axum::routing::{get, post};
use axum::Router;
use serde::Serialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/decks", get(decks::list_decks))
        .route("/api/cards", get(cards::list_cards))
        .route("/api/cards/{id}", get(cards::get_card))
        .route("/api/study/queue", get(study::get_queue))
        .route("/api/study/answer", post(study::post_answer))
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct Health {
    pub ok: bool,
    pub version: &'static str,
}

/// Liveness probe. No collection access.
#[utoipa::path(get, path = "/api/health", responses((status = 200, body = Health)))]
pub async fn health() -> axum::Json<Health> {
    axum::Json(Health {
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
    })
}
