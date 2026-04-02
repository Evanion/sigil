use axum::http::StatusCode;
use axum::response::IntoResponse;

/// Health check endpoint.
pub async fn health() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}
