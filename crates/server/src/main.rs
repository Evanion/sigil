#![warn(clippy::all, clippy::pedantic)]

mod state;

use axum::{Router, routing::get};
use tower_http::services::{ServeDir, ServeFile};
use tracing_subscriber::EnvFilter;

async fn health() -> &'static str {
    "ok"
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "4680".to_string())
        .parse::<u16>()?;

    let static_dir = std::env::var("STATIC_DIR")
        .unwrap_or_else(|_| "/usr/local/share/sigil/frontend".to_string());

    let spa = ServeDir::new(&static_dir)
        .not_found_service(ServeFile::new(format!("{static_dir}/index.html")));

    let app = Router::new()
        .route("/health", get(health))
        .fallback_service(spa);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!("listening on port {port}");
    tracing::info!("serving static files from {static_dir}");
    axum::serve(listener, app).await?;

    Ok(())
}
