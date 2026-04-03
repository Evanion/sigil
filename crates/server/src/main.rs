#![warn(clippy::all, clippy::pedantic)]

use std::time::Duration;

use anyhow::Context as _;

use agent_designer_server::{build_app, state::ServerState};
use tracing_subscriber::EnvFilter;

/// Maximum time to wait for the persistence task to complete a final flush
/// during shutdown.
const PERSISTENCE_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

/// Maximum time to wait for the MCP stdio task to drain on shutdown.
const MCP_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Detect MCP_STDIO *before* initialising the tracing subscriber so that
    // we can redirect log output to stderr.  Writing tracing events to stdout
    // while MCP stdio transport is active corrupts the JSON-RPC framing.
    let use_mcp_stdio = std::env::var("MCP_STDIO").is_ok();

    let subscriber = tracing_subscriber::fmt().with_env_filter(EnvFilter::from_default_env());
    if use_mcp_stdio {
        subscriber.with_writer(std::io::stderr).init();
    } else {
        subscriber.init();
    }

    if use_mcp_stdio {
        tracing::warn!(
            "MCP_STDIO is set — stdio transport requires stdin to be connected \
             (e.g., docker run -i)"
        );
    }

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

        ServerState::new_with_document_and_workfile(doc, workfile_path)
    } else {
        tracing::info!("no WORKFILE configured — running in-memory mode");
        // Create a default page so there's something to draw on
        let state = ServerState::new();
        {
            let mut doc = state.app.document.lock().expect("lock for default page");
            let page_id = agent_designer_core::PageId::new(uuid::Uuid::new_v4());
            let page = agent_designer_core::Page::new(page_id, "Page 1".to_string())
                .expect("create default page");
            doc.add_page(page).expect("add default page");
        }
        state
    };

    // Take the persistence handle and dirty_tx before moving state into the app.
    // We need these for graceful shutdown after the server stops.
    let persistence_handle = state.app.take_persistence_handle();
    let dirty_tx = state.app.take_dirty_tx();

    // Spawn MCP server on stdio if requested.
    // This allows agents to connect via stdin/stdout while the HTTP server
    // runs on the configured port for human users.
    let mcp_handle = if use_mcp_stdio {
        tracing::info!("starting MCP server on stdio");
        Some(agent_designer_mcp::server::start_stdio(state.app.clone()))
    } else {
        None
    };

    let app = build_app(state, Some(&static_dir));

    let listener = tokio::net::TcpListener::bind((host.as_str(), port)).await?;
    tracing::info!("listening on {host}:{port}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    // Graceful shutdown: drain the MCP task first so any final dirty signal
    // it might send is captured before we drop dirty_tx.
    if let Some(handle) = mcp_handle {
        tracing::info!("waiting for MCP task to drain...");
        match tokio::time::timeout(MCP_SHUTDOWN_TIMEOUT, handle).await {
            Ok(Ok(())) => tracing::info!("MCP task completed"),
            Ok(Err(e)) => tracing::error!("MCP task panicked: {e}"),
            Err(_) => {
                tracing::warn!(
                    "MCP task did not complete within {:?} — aborting",
                    MCP_SHUTDOWN_TIMEOUT
                );
            }
        }
    }

    // Drop the dirty sender to signal the persistence task to perform a final
    // save, then await the task with a timeout.
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
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut sigterm = signal(SignalKind::terminate()).expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = sigterm.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c()
            .await
            .expect("install ctrl+c handler");
    }
    tracing::info!("shutdown signal received");
}
