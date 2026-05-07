//! `require_auth`: the axum layer that gates every non-public route on a
//! valid session.
//!
//! The flow per request:
//!
//! 1. `SessionManagerLayer` (configured in `main.rs`) parses the cookie and
//!    inserts a `Session` into request extensions.
//! 2. We read `Session::get(SESSION_USER_KEY)`. Some(username) → put an
//!    [`AuthedUser`] into request extensions and call `next`. None → 401.
//! 3. Per-user state extractors (`AppState`'s `FromRequestParts`) downstream
//!    read the [`AuthedUser`] back out of the extensions to resolve which
//!    user's collection to open.

use axum::body::Body;
use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use tower_sessions::Session;

use super::SESSION_USER_KEY;
use crate::error::ApiError;

/// Marker placed into request extensions once auth has succeeded. Kept as a
/// newtype so we can `req.extensions().get::<AuthedUser>()` from anywhere
/// downstream without colliding with another `String` extension someone
/// adds later.
#[derive(Debug, Clone)]
pub struct AuthedUser(pub String);

impl AuthedUser {
    pub fn username(&self) -> &str {
        &self.0
    }
}

/// Reject requests that don't carry an authenticated session.
///
/// Mounted as `axum::middleware::from_fn` over the `/api/*` subrouter
/// (excluding `/api/health` and `/api/auth/{register,login}`).
pub async fn require_auth(mut req: Request<Body>, next: Next) -> Response {
    // Tower-sessions has already inserted Session into extensions in its
    // own middleware layer; if it's missing, that's a wiring bug, not an
    // unauth — surface it as 500 so it's loud.
    let Some(session) = req.extensions().get::<Session>().cloned() else {
        return unauth_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "session middleware missing",
        );
    };

    let username: Option<String> = match session.get(SESSION_USER_KEY).await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "failed to read session");
            return unauth_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to read session",
            );
        }
    };

    let Some(username) = username else {
        return unauth_response(StatusCode::UNAUTHORIZED, "not logged in");
    };

    req.extensions_mut().insert(AuthedUser(username));
    next.run(req).await
}

fn unauth_response(status: StatusCode, message: &str) -> Response {
    let body = ApiError {
        status: status.as_u16(),
        message: message.to_string(),
    };
    (status, Json(body)).into_response()
}
