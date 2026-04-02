#![warn(clippy::all, clippy::pedantic)]

use std::time::Duration;

use anyhow::Context as _;

use agent_designer_server::{build_app, state::AppState};
use tracing_subscriber::EnvFilter;

/// Maximum time to wait for the persistence task to complete a final flush
/// during shutdown.
const PERSISTENCE_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

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

    let mut state = if let Some(ref workfile_str) = workfile_env {
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

    // Take the persistence handle and dirty_tx before moving state into the app.
    // We need these for graceful shutdown after the server stops.
    let persistence_handle = state.take_persistence_handle();
    let dirty_tx = state.take_dirty_tx();

    let app = build_app(state, Some(&static_dir));

    let listener = tokio::net::TcpListener::bind((host.as_str(), port)).await?;
    tracing::info!("listening on {host}:{port}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    // Graceful shutdown: drop the dirty sender to signal the persistence task
    // to perform a final save, then await the task with a timeout.
    drop(dirty_tx);
    if let Some(handle) = persistence_handle {
        tracing::info!("waiting for persistence task to flush...");
        match tokio::time::timeout(PERSISTENCE_SHUTDOWN_TIMEOUT, handle).await {
            Ok(Ok(())) => tracing::info!("persistence task completed"),
            Ok(Err(e)) => tracing::error!("persistence task panicked: {e}"),
            Err(_) => tracing::warn!(
                "persistence task did not complete within {:?} — giving up",
                PERSISTENCE_SHUTDOWN_TIMEOUT
            ),
        }
    }

    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("install ctrl+c handler");
    tracing::info!("shutdown signal received");
}
