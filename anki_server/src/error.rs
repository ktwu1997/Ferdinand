use axum::http::header::RETRY_AFTER;
use axum::http::{HeaderValue, StatusCode};
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
    /// When `Some(n)`, the response carries a `Retry-After: n` header (in
    /// seconds). Set for 503s where the condition is transient — e.g. the
    /// per-user collection couldn't be opened yet right after a cold start
    /// — so well-behaved clients retry instead of surfacing a hard error.
    pub retry_after_secs: Option<u64>,
}

impl ServerError {
    /// Mark this error as a client error (e.g. validation failure).
    /// Without this, conversions from `anyhow::Error` default to 500.
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self {
            source: anyhow::anyhow!(message.into()),
            status: StatusCode::BAD_REQUEST,
            retry_after_secs: None,
        }
    }

    /// Mark this error as 404. Used when a path-addressed resource (deck,
    /// card, note) does not exist; without this, the missing-row branch
    /// would surface as 500 via the blanket anyhow conversion.
    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            source: anyhow::anyhow!(message.into()),
            status: StatusCode::NOT_FOUND,
            retry_after_secs: None,
        }
    }

    /// Mark this error as 409 (conflict — e.g. duplicate username on
    /// registration). Without this, a UNIQUE constraint violation would
    /// surface as 500.
    pub fn conflict(message: impl Into<String>) -> Self {
        Self {
            source: anyhow::anyhow!(message.into()),
            status: StatusCode::CONFLICT,
            retry_after_secs: None,
        }
    }

    /// Mark this error as 401 (auth failure). Used by login when password
    /// verification fails; surfaces as a uniform "invalid credentials"
    /// message without leaking whether the user exists.
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            source: anyhow::anyhow!(message.into()),
            status: StatusCode::UNAUTHORIZED,
            retry_after_secs: None,
        }
    }

    /// Mark this error as 503 (service unavailable) and attach a
    /// `Retry-After: <secs>` header. Used when the per-user collection
    /// can't be opened yet — typically the very first request after the
    /// container wakes from idle-sleep, where the previous process hasn't
    /// fully released the on-disk lock. A 503 is a *retryable* signal; the
    /// blanket `From<anyhow::Error>` conversion would otherwise surface
    /// this transient condition as a non-retryable 500.
    pub fn service_unavailable(message: impl Into<String>, retry_after_secs: u64) -> Self {
        Self {
            source: anyhow::anyhow!(message.into()),
            status: StatusCode::SERVICE_UNAVAILABLE,
            retry_after_secs: Some(retry_after_secs),
        }
    }
}

impl<E: Into<anyhow::Error>> From<E> for ServerError {
    fn from(err: E) -> Self {
        Self {
            source: err.into(),
            status: StatusCode::INTERNAL_SERVER_ERROR,
            retry_after_secs: None,
        }
    }
}

impl IntoResponse for ServerError {
    fn into_response(self) -> Response {
        if self.status.is_server_error() {
            tracing::error!(error = ?self.source, status = %self.status, "request failed");
        } else {
            tracing::info!(error = %self.source, status = %self.status, "request rejected");
        }
        let body = ApiError {
            status: self.status.as_u16(),
            message: self.source.to_string(),
        };
        let mut response = (self.status, Json(body)).into_response();
        if let Some(secs) = self.retry_after_secs {
            if let Ok(value) = HeaderValue::from_str(&secs.to_string()) {
                response.headers_mut().insert(RETRY_AFTER, value);
            }
        }
        response
    }
}

pub type ApiResult<T> = Result<T, ServerError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_unavailable_response_carries_retry_after_header() {
        let resp = ServerError::service_unavailable("collection not ready", 3).into_response();
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            resp.headers().get(RETRY_AFTER).map(|v| v.to_str().unwrap()),
            Some("3"),
            "503 must advertise Retry-After so clients retry",
        );
    }

    #[test]
    fn non_retryable_errors_omit_retry_after_header() {
        let resp = ServerError::not_found("nope").into_response();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        assert!(
            resp.headers().get(RETRY_AFTER).is_none(),
            "only retryable 503s should set Retry-After",
        );
    }

    #[test]
    fn anyhow_conversion_defaults_to_500_without_retry_after() {
        let err: ServerError = anyhow::anyhow!("boom").into();
        assert_eq!(err.status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(err.retry_after_secs, None);
    }
}
