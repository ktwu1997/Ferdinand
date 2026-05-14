//! HTTP surface for `/api/auth/*` (Phase A2).
//!
//! Endpoints
//! ---------
//! * `POST  /api/auth/login`    — verify credentials, mint a session.
//!   200 on success, 401 on bad creds.
//! * `POST  /api/auth/logout`   — clear the session. Idempotent → 204 even
//!   if there was nothing to clear.
//! * `GET   /api/auth/me`       — return `{username}` when authenticated.
//!   The `require_auth` layer ahead of this guarantees we have one.
//! * `PATCH /api/auth/password` — self-service password change (Phase B1).
//!   401 if `current` doesn't match the stored hash, 400 if `new` is empty
//!   or equals `current` (no-op), 200 on success. The non-empty rule matches
//!   register's policy intentionally — bumping the strength floor is a
//!   project-wide change (change_password + admin reset) tracked
//!   for a follow-up phase. Cycles the current session id so a session
//!   captured with the old credential can't be replayed after the change.
//!
//! Note: user creation is done via `POST /api/admin/users` (admin path).
//! The `/api/auth/register` route was removed — it was dead code once the
//! admin create-user endpoint landed (Phase B2/WS2).
//!
//! Public routes are everything before `require_auth` runs (login/logout).
//! Everything else (`me`, `password`) sits behind the auth gate.

use std::net::SocketAddr;
use std::time::Instant;

use axum::extract::{ConnectInfo, State};
use axum::http::header::RETRY_AFTER;
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tower_sessions::Session;

use super::middleware::AuthedUser;
use super::SESSION_USER_KEY;
use crate::error::{ApiError, ApiResult, ServerError};
use crate::state::ServerState;

#[derive(Debug, Deserialize)]
pub struct CredentialsBody {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct UserBody {
    pub username: String,
    /// Phase B2: true when the env-configured admin username (if any)
    /// matches `username`. The frontend uses this to decide whether to
    /// render the `/settings` admin section. Always serialised so the
    /// shape stays fixed across users — non-admin = `false`, no admin
    /// configured = `false` for everyone.
    pub is_admin: bool,
}

/// Body for `PATCH /api/auth/password`. `new` is renamed via serde so the
/// JSON key matches our wire shape while the field stays a valid Rust ident.
#[derive(Debug, Deserialize)]
pub struct ChangePasswordBody {
    pub current: String,
    #[serde(rename = "new")]
    pub new_password: String,
}

#[derive(Debug, Serialize)]
pub struct OkBody {
    pub ok: bool,
}

/// Routes that **do not** sit behind `require_auth`. Login/logout live here
/// so unauthenticated visitors can reach them.
pub fn public_router() -> Router<ServerState> {
    Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
}

/// Routes that require a valid session. Composed with `require_auth` in
/// `main.rs`.
pub fn protected_router() -> Router<ServerState> {
    Router::new()
        .route("/api/auth/me", get(me))
        .route("/api/auth/password", patch(change_password))
}

async fn login(
    State(state): State<ServerState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    session: Session,
    Json(body): Json<CredentialsBody>,
) -> ApiResult<Response> {
    let username = validate_username(&body.username)?;
    if body.password.is_empty() {
        return Err(ServerError::bad_request("password must not be empty"));
    }
    // Phase A3: rate-limit before the password verify path. Both per-IP
    // and per-username scopes are checked together; a 429 reply does not
    // consume an additional slot.
    if let Some(retry_secs) =
        state
            .login_limiter
            .check_and_register(addr.ip(), &username, Instant::now())
    {
        tracing::warn!(
            ip = %addr.ip(),
            username = %username,
            retry_after = retry_secs,
            "login rate-limited",
        );
        return Ok(too_many_requests(retry_secs));
    }
    let row = state
        .auth
        .find_user(&username)?
        .ok_or_else(|| ServerError::unauthorized("invalid credentials"))?;
    // Phase B2: refuse disabled accounts. Same generic "invalid
    // credentials" message as wrong-password so a disabled user can't
    // probe whether they exist vs. were suspended — admin disable is
    // load-bearing security, not just UX.
    if row.disabled_at.is_some() {
        tracing::info!(username = %row.username, "rejecting login for disabled account");
        return Err(ServerError::unauthorized("invalid credentials"));
    }
    let ok = super::password::verify(&body.password, &row.password_hash)?;
    if !ok {
        return Err(ServerError::unauthorized("invalid credentials"));
    }
    // Cycle the session id on login so a captured pre-login id can't be
    // upgraded to an authenticated session (session-fixation defence).
    session
        .cycle_id()
        .await
        .map_err(|e| anyhow::anyhow!("cycle session: {e}"))?;
    session
        .insert(SESSION_USER_KEY, &row.username)
        .await
        .map_err(|e| anyhow::anyhow!("write session: {e}"))?;
    let is_admin = state.is_admin(&row.username);
    Ok((
        StatusCode::OK,
        Json(UserBody {
            username: row.username,
            is_admin,
        }),
    )
        .into_response())
}

/// Build the 429 response with `Retry-After`. Kept as a free function so the
/// handler stays focused on the happy path.
fn too_many_requests(retry_secs: u64) -> Response {
    let body = ApiError {
        status: StatusCode::TOO_MANY_REQUESTS.as_u16(),
        message: "too many login attempts; try again later".to_string(),
    };
    let mut response = (StatusCode::TOO_MANY_REQUESTS, Json(body)).into_response();
    if let Ok(value) = HeaderValue::from_str(&retry_secs.to_string()) {
        response.headers_mut().insert(RETRY_AFTER, value);
    }
    response
}

async fn logout(session: Session) -> ApiResult<impl IntoResponse> {
    // Drop server-side state regardless of whether the request had a session.
    // Idempotent → always 204.
    session
        .flush()
        .await
        .map_err(|e| anyhow::anyhow!("flush session: {e}"))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn me(
    State(state): State<ServerState>,
    user: axum::extract::Extension<AuthedUser>,
) -> Json<UserBody> {
    let username = user.0.username().to_string();
    let is_admin = state.is_admin(&username);
    Json(UserBody { username, is_admin })
}

/// Self-service password change. The `require_auth` layer guarantees we
/// already have a session for `user`, so the only verification we do here
/// is that they still know the *current* password — defends against an
/// attacker who got hold of the cookie but not the underlying credential.
///
/// Session handling: we cycle the session id on success. The current device
/// keeps its session (the cookie jar still has the new id) but anyone
/// replaying the old id loses authentication. Full multi-device revocation
/// (kill every other session for this user) is deferred to Phase B2 admin
/// reset, where it's load-bearing — for self-service, the attacker would
/// also need the new credential to keep going.
async fn change_password(
    State(state): State<ServerState>,
    session: Session,
    user: axum::extract::Extension<AuthedUser>,
    Json(body): Json<ChangePasswordBody>,
) -> ApiResult<Response> {
    let username = user.0.username().to_string();
    if body.current.is_empty() {
        return Err(ServerError::bad_request("current password must not be empty"));
    }
    let new_password = body.new_password;
    if new_password.is_empty() {
        return Err(ServerError::bad_request("new password must not be empty"));
    }
    // Reject the no-op change so a misclick doesn't quietly keep the same
    // hash with a fresh salt — surfaces as inline UI feedback rather than a
    // success that confuses the user.
    if new_password == body.current {
        return Err(ServerError::bad_request(
            "new password must differ from the current password",
        ));
    }
    let row = state
        .auth
        .find_user(&username)?
        .ok_or_else(|| anyhow::anyhow!("authed user '{username}' not found in db"))?;
    let current_ok = super::password::verify(&body.current, &row.password_hash)?;
    if !current_ok {
        return Err(ServerError::unauthorized("current password is incorrect"));
    }
    let new_hash = super::password::hash(&new_password)?;
    state.auth.update_password(&username, &new_hash)?;
    // Cycle the session id so a leaked-cookie attacker on the *same* device
    // gets logged out at the next request.
    session
        .cycle_id()
        .await
        .map_err(|e| anyhow::anyhow!("cycle session: {e}"))?;
    // Re-insert the user binding under the new id.
    session
        .insert(SESSION_USER_KEY, &username)
        .await
        .map_err(|e| anyhow::anyhow!("write session: {e}"))?;
    Ok((StatusCode::OK, Json(OkBody { ok: true })).into_response())
}

/// Tight username validation: 3-64 chars, [a-z0-9_-], lowercase only so
/// "ktwu" and "KTWU" can't both register and shadow each other on
/// case-insensitive filesystems.
///
/// `pub(crate)` so the admin create-user endpoint ([`crate::admin`]) can
/// reuse the exact same policy — an admin-minted account must obey the
/// same naming rules a self-registered one does, otherwise the two paths
/// could diverge (e.g. admin creates "Grace", self-service can't, login
/// case-folds inconsistently).
pub(crate) fn validate_username(raw: &str) -> Result<String, ServerError> {
    let trimmed = raw.trim();
    if trimmed.len() < 3 || trimmed.len() > 64 {
        return Err(ServerError::bad_request(
            "username must be 3-64 characters",
        ));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return Err(ServerError::bad_request(
            "username must be lowercase a-z, 0-9, '_' or '-'",
        ));
    }
    Ok(trimmed.to_string())
}
