#![warn(clippy::all, clippy::pedantic)]

use anyhow::Context as _;

use agent_designer_server::{build_app, state::AppState};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "4680".to_string())
        .parse::<u16>()?;

    let static_dir = std::env::var("STATIC_DIR")
        .unwrap_or_else(|_| "/usr/local/share/sigil/frontend".to_string());

    let workfile_env = std::env::var("WORKFILE").ok();

    let state = if let Some(ref workfile_str) = workfile_env {
        let workfile_path = std::path::PathBuf::from(workfile_str);
        tracing::info!("loading workfile from {}", workfile_path.display());

        let doc = agent_designer_server::workfile::load_workfile(&workfile_path)
            .await
            .context("failed to load workfile")?;

        AppState::new_with_document_and_workfile(doc, workfile_path)
    } else {
        tracing::info!("no WORKFILE configured — running in-memory mode");
        AppState::new()
    };

    let app = build_app(state, Some(&static_dir));

    let listener = tokio::net::TcpListener::bind((host.as_str(), port)).await?;
    tracing::info!("listening on {host}:{port}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("install ctrl+c handler");
    tracing::info!("shutdown signal received");
}
