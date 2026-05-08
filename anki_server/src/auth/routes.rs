//! HTTP surface for `/api/auth/*` (Phase A2).
//!
//! Endpoints
//! ---------
//! * `POST /api/auth/register` — create a user. 201 on success, 409 if
//!   username taken.
//! * `POST /api/auth/login`    — verify credentials, mint a session.
//!   200 on success, 401 on bad creds.
//! * `POST /api/auth/logout`   — clear the session. Idempotent → 204 even
//!   if there was nothing to clear.
//! * `GET  /api/auth/me`       — return `{username}` when authenticated.
//!   The `require_auth` layer ahead of this guarantees we have one.
//!
//! These four are the only routes exposed before `require_auth` runs (well,
//! plus `/api/auth/me` which is auth-gated). Login/register are skipped
//! because you can't authenticate without first calling them.

use std::net::SocketAddr;
use std::time::Instant;

use axum::extract::{ConnectInfo, State};
use axum::http::header::RETRY_AFTER;
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
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
}

/// Routes that **do not** sit behind `require_auth`. Everything that mutates
/// session state (login/register) lives here so first-time visitors can
/// reach them.
pub fn public_router() -> Router<ServerState> {
    Router::new()
        .route("/api/auth/register", post(register))
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
}

/// Routes that require a valid session. Composed with `require_auth` in
/// `main.rs`.
pub fn protected_router() -> Router<ServerState> {
    Router::new().route("/api/auth/me", get(me))
}

async fn register(
    State(state): State<ServerState>,
    Json(body): Json<CredentialsBody>,
) -> ApiResult<impl IntoResponse> {
    let username = validate_username(&body.username)?;
    if body.password.is_empty() {
        return Err(ServerError::bad_request("password must not be empty"));
    }
    if state.auth.find_user(&username)?.is_some() {
        return Err(ServerError::conflict(format!(
            "user '{username}' already exists"
        )));
    }
    let hash = super::password::hash(&body.password)?;
    state.auth.insert_user(&username, &hash)?;
    Ok((StatusCode::CREATED, Json(UserBody { username })))
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
    Ok((
        StatusCode::OK,
        Json(UserBody {
            username: row.username,
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

async fn me(user: axum::extract::Extension<AuthedUser>) -> Json<UserBody> {
    Json(UserBody {
        username: user.0.username().to_string(),
    })
}

/// Tight username validation: 3-64 chars, [a-z0-9_-], lowercase only so
/// "ktwu" and "KTWU" can't both register and shadow each other on
/// case-insensitive filesystems.
fn validate_username(raw: &str) -> Result<String, ServerError> {
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
