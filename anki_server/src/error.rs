use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

/// Uniform error envelope returned to clients.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ApiError {
    pub status: u16,
    pub message: String,
}

#[derive(Debug)]
pub struct ServerError {
    pub source: anyhow::Error,
    pub status: StatusCode,
}

impl ServerError {
    /// Mark this error as a client error (e.g. validation failure).
    /// Without this, conversions from `anyhow::Error` default to 500.
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self {
            source: anyhow::anyhow!(message.into()),
            status: StatusCode::BAD_REQUEST,
        }
    }

    /// Mark this error as 404. Used when a path-addressed resource (deck,
    /// card, note) does not exist; without this, the missing-row branch
    /// would surface as 500 via the blanket anyhow conversion.
    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            source: anyhow::anyhow!(message.into()),
            status: StatusCode::NOT_FOUND,
        }
    }

    /// Mark this error as 409 (conflict — e.g. duplicate username on
    /// registration). Without this, a UNIQUE constraint violation would
    /// surface as 500.
    pub fn conflict(message: impl Into<String>) -> Self {
        Self {
            source: anyhow::anyhow!(message.into()),
            status: StatusCode::CONFLICT,
        }
    }

    /// Mark this error as 401 (auth failure). Used by login when password
    /// verification fails; surfaces as a uniform "invalid credentials"
    /// message without leaking whether the user exists.
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            source: anyhow::anyhow!(message.into()),
            status: StatusCode::UNAUTHORIZED,
        }
    }
}

impl<E: Into<anyhow::Error>> From<E> for ServerError {
    fn from(err: E) -> Self {
        Self {
            source: err.into(),
            status: StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for ServerError {
    fn into_response(self) -> Response {
        if self.status.is_server_error() {
            tracing::error!(error = ?self.source, "request failed");
        } else {
            tracing::info!(error = %self.source, status = %self.status, "request rejected");
        }
        let body = ApiError {
            status: self.status.as_u16(),
            message: self.source.to_string(),
        };
        (self.status, Json(body)).into_response()
    }
}

pub type ApiResult<T> = Result<T, ServerError>;
