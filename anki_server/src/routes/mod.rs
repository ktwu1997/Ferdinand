pub mod cards;
pub mod decks;
pub mod media;
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
        // Static media (images, audio) served from <collection-stem>.media/.
        // Not under /api/ so shadow-DOM <base href="/media/"> stays clean and
        // the path reads as a static resource root.
        .route("/media/{filename}", get(media::get_media))
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
