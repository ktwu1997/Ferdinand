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
//! WS2 addition
//! ------------
//! * `POST /api/admin/users` `{ username, password }` — mint a fresh
//!   account from the panel so the owner can add e.g. a "grace" login
//!   without redeploying with new `FERDINAND_SEED_*` env vars. Same
//!   username policy as self-service `/api/auth/register` (reuses
//!   [`crate::auth::routes::validate_username`]), 409 on a name clash,
//!   400 on bad input. No session is created — the new user logs in
//!   themselves with the password the admin handed them.
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

/// Wire shape for `POST /api/admin/users`. Mirrors the self-service
/// `/api/auth/register` body so the two creation paths stay aligned.
#[derive(Debug, Deserialize)]
pub struct CreateUserBody {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct OkBody {
    pub ok: bool,
}

/// Build the admin sub-router. `main.rs` is responsible for layering
/// `require_auth` and `require_admin` on top — both are mandatory.
pub fn admin_router() -> Router<ServerState> {
    Router::new()
        .route("/api/admin/users", get(list_users).post(create_user))
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

/// `POST /api/admin/users` — create a new account.
///
/// Validation mirrors `/api/auth/register`: the username is run through
/// [`crate::auth::routes::validate_username`] (3-64 chars, lowercase
/// `[a-z0-9_-]`) and the password must be non-empty (same floor the
/// register + change-password + admin-reset paths use — bumping the
/// strength minimum is a project-wide change tracked separately). A name
/// clash is a **409**; a malformed username or empty password is a
/// **400**. On success the user row is written with an Argon2id hash and
/// we return **201** with the new row in [`ApiAdminUser`] shape so the
/// frontend can append it to the list without a refetch (it refetches
/// anyway, but a self-describing response keeps the wrapper honest).
///
/// No session is minted — the new user authenticates themselves with the
/// password the admin handed them out-of-band.
async fn create_user(
    State(state): State<ServerState>,
    Json(body): Json<CreateUserBody>,
) -> ApiResult<impl IntoResponse> {
    let username = crate::auth::routes::validate_username(&body.username)?;
    if body.password.is_empty() {
        return Err(ServerError::bad_request("password must not be empty"));
    }
    if state.auth.find_user(&username)?.is_some() {
        return Err(ServerError::conflict(format!(
            "user '{username}' already exists"
        )));
    }
    let hash = crate::auth::password::hash(&body.password)?;
    let id = state.auth.insert_user(&username, &hash)?;
    // Re-read so `created_at` is the value the row actually got, not a
    // second `now()` that could skew by a tick.
    let row = state
        .auth
        .find_user(&username)?
        .ok_or_else(|| anyhow::anyhow!("user '{username}' vanished immediately after insert"))?;
    tracing::info!(new_user = %username, new_user_id = id, "admin created user");
    Ok((
        StatusCode::CREATED,
        Json(ApiAdminUser {
            id: row.id,
            username: row.username,
            created_at: row.created_at,
            disabled_at: row.disabled_at,
        }),
    ))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::db::AuthDb;
    use crate::state::ServerState;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    /// Stand up a `ServerState` over a throwaway sqlite file + temp users
    /// dir. Per-call unique paths so `cargo test`'s parallelism doesn't
    /// collide.
    fn test_state() -> ServerState {
        let suffix = format!(
            "{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let db_path = std::env::temp_dir().join(format!("ferdinand_admin_test_{suffix}.db"));
        let users_dir = std::env::temp_dir().join(format!("ferdinand_admin_users_{suffix}"));
        let auth = AuthDb::open(&db_path).expect("open temp auth db");
        ServerState::new(auth, users_dir)
    }

    /// Drive the handler and unwrap the response's status code, ignoring
    /// the body — every code path here returns a JSON body we don't need
    /// to inspect beyond the DB assertions that follow.
    async fn create_status(state: &ServerState, username: &str, password: &str) -> StatusCode {
        let body = CreateUserBody {
            username: username.to_string(),
            password: password.to_string(),
        };
        match create_user(State(state.clone()), Json(body)).await {
            Ok(resp) => resp.into_response().status(),
            Err(err) => err.status,
        }
    }

    #[tokio::test]
    async fn create_user_succeeds_and_appears_in_list_with_usable_hash() {
        let state = test_state();
        let status = create_status(&state, "grace", "s3kret-pw").await;
        assert_eq!(status, StatusCode::CREATED);

        // The new row is visible to the list endpoint's data source.
        let rows = state.auth.list_users().unwrap();
        let grace = rows
            .iter()
            .find(|r| r.username == "grace")
            .expect("grace present in user list");
        assert!(grace.disabled_at.is_none(), "fresh account is active");

        // The stored hash is a real Argon2id PHC string the new user can
        // authenticate against — and a wrong password is rejected.
        let row = state.auth.find_user("grace").unwrap().unwrap();
        assert!(crate::auth::password::verify("s3kret-pw", &row.password_hash).unwrap());
        assert!(!crate::auth::password::verify("wrong", &row.password_hash).unwrap());
    }

    #[tokio::test]
    async fn create_user_duplicate_username_is_conflict() {
        let state = test_state();
        assert_eq!(
            create_status(&state, "grace", "pw-one").await,
            StatusCode::CREATED
        );
        // Second create with the same name → 409, original hash untouched.
        assert_eq!(
            create_status(&state, "grace", "pw-two").await,
            StatusCode::CONFLICT
        );
        let row = state.auth.find_user("grace").unwrap().unwrap();
        assert!(
            crate::auth::password::verify("pw-one", &row.password_hash).unwrap(),
            "conflicting create must not overwrite the existing password"
        );
        // Still exactly one such user.
        let count = state
            .auth
            .list_users()
            .unwrap()
            .iter()
            .filter(|r| r.username == "grace")
            .count();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn create_user_empty_username_is_bad_request() {
        let state = test_state();
        assert_eq!(
            create_status(&state, "", "some-password").await,
            StatusCode::BAD_REQUEST
        );
        // Whitespace-only trims to empty → also rejected.
        assert_eq!(
            create_status(&state, "   ", "some-password").await,
            StatusCode::BAD_REQUEST
        );
        // Uppercase / illegal charset is rejected by the shared policy.
        assert_eq!(
            create_status(&state, "Grace", "some-password").await,
            StatusCode::BAD_REQUEST
        );
        assert!(
            state.auth.list_users().unwrap().is_empty(),
            "no row should have been written for any invalid username"
        );
    }

    #[tokio::test]
    async fn create_user_empty_password_is_bad_request() {
        let state = test_state();
        assert_eq!(
            create_status(&state, "grace", "").await,
            StatusCode::BAD_REQUEST
        );
        assert!(
            state.auth.find_user("grace").unwrap().is_none(),
            "no row should have been written when the password was empty"
        );
    }
}
