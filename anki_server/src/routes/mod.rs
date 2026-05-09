pub mod burn_recovery;
pub mod cards;
pub mod deck_config;
pub mod decks;
pub mod fsrs;
pub mod import;
pub mod media;
pub mod notes;
pub mod notetype_fields;
pub mod notetypes;
pub mod saved_searches;
pub mod stats;
pub mod study;
pub mod tags;

use axum::routing::{delete, get, patch, post};
use axum::Router;
use serde::Serialize;

use crate::state::ServerState;

/// Routes that do not require authentication. Only `/api/health` for now —
/// keeping it public means liveness probes and uptime checks (Caddy /
/// monitoring, etc.) don't have to know the session cookie.
pub fn public_router() -> Router<ServerState> {
    Router::new().route("/api/health", get(health))
}

/// Authenticated API routes. Mounted behind `auth::middleware::require_auth`
/// in `main.rs`. Every handler here ends up extracting an `AppState` for
/// the session-resolved user — never a hardcoded one.
pub fn router() -> Router<ServerState> {
    Router::new()
        .route(
            "/api/decks",
            get(decks::list_decks).post(decks::post_create),
        )
        .route("/api/decks/filtered", post(decks::post_filtered))
        .route(
            "/api/decks/{id}",
            patch(decks::patch_deck).delete(decks::delete_by_id),
        )
        .route("/api/decks/{id}/preset", patch(decks::patch_deck_preset))
        .route("/api/cards", get(cards::list_cards))
        .route("/api/cards/move", post(cards::post_move_cards))
        .route("/api/cards/bulk_suspend", post(cards::post_bulk_suspend))
        .route("/api/cards/bulk_flag", post(cards::post_bulk_flag))
        .route("/api/cards/{id}", get(cards::get_card))
        .route("/api/cards/{id}/suspend", post(cards::post_suspend))
        .route("/api/cards/{id}/flag", post(cards::post_flag))
        .route("/api/cards/{id}/history", get(cards::get_card_history))
        .route("/api/notes", post(notes::post_create))
        .route(
            "/api/notes/{id}",
            get(notes::get_by_id)
                .delete(notes::delete_by_id)
                .patch(notes::patch_by_id),
        )
        .route("/api/notetypes", get(notetypes::list_notetypes))
        .route(
            "/api/notetypes/{id}",
            get(notetypes::get_by_id).patch(notetypes::patch_by_id),
        )
        .route(
            "/api/notetypes/{id}/fields",
            post(notetype_fields::post_add_field),
        )
        .route(
            "/api/notetypes/{id}/fields/{ord}",
            delete(notetype_fields::delete_field),
        )
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
        .route(
            "/api/stats/answer_buttons",
            get(stats::get_answer_buttons),
        )
        .route("/api/tags", get(tags::list_tags))
        .route(
            "/api/saved_searches",
            get(saved_searches::list_saved).post(saved_searches::post_saved),
        )
        .route(
            "/api/saved_searches/{name}",
            delete(saved_searches::delete_saved),
        )
        // Static media (images, audio) served from <collection-stem>.media/.
        // Not under /api/ so shadow-DOM <base href="/media/"> stays clean and
        // the path reads as a static resource root. Phase 15-C: POST /media
        // accepts multipart uploads for the /notes/new drag-drop surface.
        .route("/media", post(media::post_upload))
        .route("/media/{filename}", get(media::get_media))
        // Phase 20-C: burn-recovery — per-card reset to new (DESTRUCTIVE).
        // Appended last so the per-card route block stays grouped at the
        // tail of the chain (Phase 20-D's /api/cards/{id}/history slot
        // also lands here on merge).
        .route(
            "/api/cards/{id}/reset_to_new",
            post(burn_recovery::post_reset_to_new),
        )
        // Phase B3a: self-service .apkg import. Authed-only (sits behind
        // require_auth via the protected_router merge), no admin gate —
        // any user can ingest their own deck export.
        .route("/api/import/apkg", post(import::import_apkg))
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
