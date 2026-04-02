#![warn(clippy::all, clippy::pedantic)]

//! Agent Designer server library.
//!
//! Exposes the application router builder and shared state types so that
//! integration tests can spin up test servers without duplicating setup.

pub mod dispatch;
pub mod routes;
pub mod state;

use axum::{Router, routing::get};
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

use crate::state::AppState;

/// Builds the full application router.
///
/// When `static_dir` is `Some`, a SPA fallback is configured to serve
/// static files and fall back to `index.html`. When `None` (e.g., in
/// integration tests), no static file serving is configured.
pub fn build_app(state: AppState, static_dir: Option<&str>) -> Router {
    let app = Router::new()
        .route("/health", get(routes::health::health))
        .route("/api/document", get(routes::document::get_document_info))
        .route("/ws", get(routes::ws::ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    if let Some(dir) = static_dir {
        let spa = ServeDir::new(dir).not_found_service(ServeFile::new(format!("{dir}/index.html")));
        app.fallback_service(spa)
    } else {
        app
    }
}
