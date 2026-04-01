#![warn(clippy::all, clippy::pedantic)]

use axum::{Router, routing::get};
use tracing_subscriber::EnvFilter;

async fn health() -> &'static str {
    "ok"
}

async fn index() -> &'static str {
    "agent-designer is running"
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "4680".to_string())
        .parse::<u16>()?;

    let app = Router::new()
        .route("/", get(index))
        .route("/health", get(health));

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!("listening on port {port}");
    axum::serve(listener, app).await?;

    Ok(())
}
