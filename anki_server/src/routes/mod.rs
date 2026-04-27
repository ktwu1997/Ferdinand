pub mod cards;
pub mod deck_config;
pub mod decks;
pub mod fsrs;
pub mod media;
pub mod notes;
pub mod notetypes;
pub mod stats;
pub mod study;
pub mod tags;

use axum::routing::{get, patch, post};
use axum::Router;
use serde::Serialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health))
        .route(
            "/api/decks",
            get(decks::list_decks).post(decks::post_create),
        )
        .route(
            "/api/decks/{id}",
            patch(decks::patch_deck).delete(decks::delete_by_id),
        )
        .route("/api/decks/{id}/preset", patch(decks::patch_deck_preset))
        .route("/api/cards", get(cards::list_cards))
        .route("/api/cards/{id}", get(cards::get_card))
        .route("/api/cards/{id}/suspend", post(cards::post_suspend))
        .route("/api/cards/{id}/flag", post(cards::post_flag))
        .route("/api/notes", post(notes::post_create))
        .route(
            "/api/notes/{id}",
            get(notes::get_by_id)
                .delete(notes::delete_by_id)
                .patch(notes::patch_by_id),
        )
        .route("/api/notetypes", get(notetypes::list_notetypes))
        .route("/api/notetypes/{id}", patch(notetypes::patch_by_id))
        .route("/api/study/queue", get(study::get_queue))
        .route("/api/study/answer", post(study::post_answer))
        .route("/api/study/forecast", get(study::get_forecast))
        .route(
            "/api/deck_config",
            get(deck_config::list_deck_configs).post(deck_config::post_create),
        )
        .route(
            "/api/deck_config/default",
            get(deck_config::get_default).patch(deck_config::patch_default),
        )
        .route(
            "/api/deck_config/{id}",
            get(deck_config::get_by_id)
                .patch(deck_config::patch_by_id)
                .delete(deck_config::delete_by_id),
        )
        .route(
            "/api/fsrs/enabled",
            get(fsrs::get_enabled).put(fsrs::put_enabled),
        )
        .route(
            "/api/fsrs/health_check",
            get(fsrs::get_health_check).put(fsrs::put_health_check),
        )
        .route("/api/fsrs/optimize", post(fsrs::post_optimize))
        .route("/api/stats/recent", get(stats::get_recent))
        .route("/api/tags", get(tags::list_tags))
        // Static media (images, audio) served from <collection-stem>.media/.
        // Not under /api/ so shadow-DOM <base href="/media/"> stays clean and
        // the path reads as a static resource root. Phase 15-C: POST /media
        // accepts multipart uploads for the /notes/new drag-drop surface.
        .route("/media", post(media::post_upload))
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
