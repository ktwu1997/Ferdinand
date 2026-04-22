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
pub struct ServerError(pub anyhow::Error);

impl<E: Into<anyhow::Error>> From<E> for ServerError {
    fn from(err: E) -> Self {
        ServerError(err.into())
    }
}

impl IntoResponse for ServerError {
    fn into_response(self) -> Response {
        tracing::error!(error = ?self.0, "request failed");
        let body = ApiError {
            status: 500,
            message: self.0.to_string(),
        };
        (StatusCode::INTERNAL_SERVER_ERROR, Json(body)).into_response()
    }
}

pub type ApiResult<T> = Result<T, ServerError>;
