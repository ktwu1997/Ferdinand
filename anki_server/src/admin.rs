//! Phase B2: admin endpoints (`/api/admin/*`).
//!
//! Scope
//! -----
//! Just the three routes ktwu needs to manage friend accounts from the
//! `/settings` admin panel without SSHing into the box:
//!
//! * `GET  /api/admin/users`                         — list every user
//!   (id / username / created_at / disabled_at). No password hashes.
//! * `POST /api/admin/users/{username}/reset-password`
//!   `{ new: string }` — overwrite a user's password and **delete every
//!   one of their persisted sessions**. Force-reset is the security
//!   primitive that makes "I lost my password" recoverable without
//!   leaving the attacker with a still-valid cookie.
//! * `POST /api/admin/users/{username}/disable`
//!   `{ disabled: bool }` — set or clear the user's `disabled_at`.
//!   Disabling also deletes that user's sessions so a stolen-cookie
//!   attacker is kicked off in the same beat. Re-enabling does not
//!   restore sessions — the user has to log in again, which is the
//!   right behaviour.
//!
//! Gating
//! ------
//! Mounted under `require_auth` + `route_layer(require_admin)` in
//! `main.rs`. `require_admin` reads
//! [`crate::state::ServerState::admin_username`] (sourced from
//! `ANKI_ADMIN_USERNAME` at boot) and 403s any caller that doesn't
//! match. With the env var unset, every admin call 403s — the safer
//! default for a fresh install.
//!
//! Out of scope (deferred on purpose)
//! ----------------------------------
//! * `DELETE /api/admin/users/{u}` — destructive (the friend's whole
//!   collection rides on the user dir). Needs its own phase + UI
//!   double-confirm before we ship it.
//! * Audit log table — tracing logs the action; a structured audit
//!   table is a future phase.
//! * DB-side admin role flag — env-driven single admin is fine for
//!   the friend-self-host tier.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::auth::middleware::AuthedUser;
use crate::error::{ApiResult, ServerError};
use crate::state::ServerState;

/// Wire shape for one row of the admin user list. Stripped of the
/// password hash so a leaked /api/admin/users response from a misrouted
/// proxy can't seed an offline attack.
#[derive(Debug, Serialize)]
pub struct ApiAdminUser {
    pub id: i64,
    pub username: String,
    pub created_at: i64,
    /// `Some(unix_secs)` when this account is suspended; `None` when
    /// active. Frontend renders the toggle state from this directly.
    pub disabled_at: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ApiAdminUserList {
    pub users: Vec<ApiAdminUser>,
}

#[derive(Debug, Deserialize)]
pub struct ResetPasswordBody {
    /// Renamed via serde so the wire shape is `{ "new": "..." }` (mirrors
    /// the self-service endpoint's body) while the field stays a valid
    /// Rust identifier.
    #[serde(rename = "new")]
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct DisableBody {
    pub disabled: bool,
}

#[derive(Debug, Serialize)]
pub struct OkBody {
    pub ok: bool,
}

/// Build the admin sub-router. `main.rs` is responsible for layering
/// `require_auth` and `require_admin` on top — both are mandatory.
pub fn admin_router() -> Router<ServerState> {
    Router::new()
        .route("/api/admin/users", get(list_users))
        .route(
            "/api/admin/users/{username}/reset-password",
            post(reset_password),
        )
        .route(
            "/api/admin/users/{username}/disable",
            post(disable_user),
        )
}

async fn list_users(
    State(state): State<ServerState>,
) -> ApiResult<Json<ApiAdminUserList>> {
    let rows = state.auth.list_users()?;
    let users = rows
        .into_iter()
        .map(|row| ApiAdminUser {
            id: row.id,
            username: row.username,
            created_at: row.created_at,
            disabled_at: row.disabled_at,
        })
        .collect();
    Ok(Json(ApiAdminUserList { users }))
}

async fn reset_password(
    State(state): State<ServerState>,
    Path(username): Path<String>,
    Json(body): Json<ResetPasswordBody>,
) -> ApiResult<impl IntoResponse> {
    if body.new_password.is_empty() {
        return Err(ServerError::bad_request("new password must not be empty"));
    }
    if state.auth.find_user(&username)?.is_none() {
        return Err(ServerError::not_found(format!(
            "user '{username}' not found"
        )));
    }
    let new_hash = crate::auth::password::hash(&body.new_password)?;
    state.auth.update_password(&username, &new_hash)?;
    // Kick the target user off every device. Without this, an admin
    // reset triggered because a friend's password leaked would still
    // leave the attacker authenticated via their captured cookie.
    let killed = state.auth.delete_sessions_for_user(&username)?;
    tracing::info!(
        target_user = %username,
        sessions_revoked = killed,
        "admin reset_password"
    );
    Ok((StatusCode::OK, Json(OkBody { ok: true })))
}

async fn disable_user(
    State(state): State<ServerState>,
    user: axum::extract::Extension<AuthedUser>,
    Path(username): Path<String>,
    Json(body): Json<DisableBody>,
) -> ApiResult<impl IntoResponse> {
    // Refuse self-disable so the admin can't lock themselves out and
    // brick the install. They can still rotate their own password via
    // `/api/auth/password` if they need to.
    if user.0.username() == username {
        return Err(ServerError::bad_request(
            "admin cannot disable their own account",
        ));
    }
    if state.auth.find_user(&username)?.is_none() {
        return Err(ServerError::not_found(format!(
            "user '{username}' not found"
        )));
    }
    state.auth.update_disabled(&username, body.disabled)?;
    if body.disabled {
        // Same reasoning as reset-password: a still-valid session for a
        // freshly disabled user would defeat the point.
        let killed = state.auth.delete_sessions_for_user(&username)?;
        tracing::info!(
            target_user = %username,
            sessions_revoked = killed,
            "admin disabled user"
        );
    } else {
        tracing::info!(target_user = %username, "admin re-enabled user");
    }
    Ok((StatusCode::OK, Json(OkBody { ok: true })))
}
