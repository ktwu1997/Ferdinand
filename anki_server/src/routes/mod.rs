pub mod cards;
pub mod deck_config;
pub mod decks;
pub mod fsrs;
pub mod media;
pub mod study;
pub mod tags;

use axum::routing::{get, patch, post};
use axum::Router;
use serde::Serialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/decks", get(decks::list_decks))
        .route("/api/decks/{id}", patch(decks::patch_deck))
        .route("/api/cards", get(cards::list_cards))
        .route("/api/cards/{id}", get(cards::get_card))
        .route("/api/cards/{id}/suspend", post(cards::post_suspend))
        .route("/api/study/queue", get(study::get_queue))
        .route("/api/study/answer", post(study::post_answer))
        .route("/api/deck_config", get(deck_config::list_deck_configs))
        .route(
            "/api/deck_config/default",
            get(deck_config::get_default).patch(deck_config::patch_default),
        )
        .route(
            "/api/deck_config/{id}",
            get(deck_config::get_by_id).patch(deck_config::patch_by_id),
        )
        .route(
            "/api/fsrs/enabled",
            get(fsrs::get_enabled).put(fsrs::put_enabled),
        )
        .route("/api/fsrs/optimize", post(fsrs::post_optimize))
        .route("/api/tags", get(tags::list_tags))
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
