#![warn(clippy::all, clippy::pedantic)]

use agent_designer_server::{build_app, state::AppState};
use tracing_subscriber::EnvFilter;

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

    let state = AppState::new();
    let app = build_app(state, Some(&static_dir));

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!("listening on port {port}");
    axum::serve(listener, app).await?;

    Ok(())
}
