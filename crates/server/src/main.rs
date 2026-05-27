#![warn(clippy::all, clippy::pedantic)]

use std::time::Duration;

use anyhow::Context as _;
use clap::Parser;

use sigil_server::{build_app, state::ServerState};
use tracing_subscriber::EnvFilter;

/// Maximum time to wait for the persistence task to complete a final flush
/// during shutdown.
const PERSISTENCE_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

/// Maximum time to wait for the MCP stdio task to drain on shutdown.
const MCP_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

/// Sigil server. Runs the axum HTTP+WebSocket+MCP stack.
///
/// CLI args take precedence over environment variables; env vars take
/// precedence over defaults. Env vars (`PORT`, `WORKFILE`, `HOST`) remain
/// supported for docker compatibility.
#[derive(Parser, Debug, Default)]
#[command(name = "sigil-server", version)]
struct Cli {
    /// Localhost port to bind. Overrides PORT env var.
    #[arg(long)]
    port: Option<u16>,

    /// Workfile directory to load. Overrides WORKFILE env var.
    #[arg(long, value_name = "PATH")]
    workfile: Option<std::path::PathBuf>,
}

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

    let cli = Cli::parse();

    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = cli
        .port
        .or_else(|| std::env::var("PORT").ok().and_then(|s| s.parse().ok()))
        .unwrap_or(4680);

    let static_dir = std::env::var("STATIC_DIR")
        .unwrap_or_else(|_| "/usr/local/share/sigil/frontend".to_string());

    let workfile_path: Option<std::path::PathBuf> = cli
        .workfile
        .clone()
        .or_else(|| std::env::var("WORKFILE").ok().map(std::path::PathBuf::from));

    let mut state = if let Some(ref workfile_path) = workfile_path {
        tracing::info!("loading workfile from {}", workfile_path.display());

        let loaded = sigil_server::workfile::load_workfile(workfile_path)
            .await
            .context("failed to load workfile")?;

        let migrated_from = loaded.migrated_from;
        let state = ServerState::new_with_document_and_workfile_migrated(
            loaded.document,
            workfile_path.clone(),
            migrated_from,
        );

        // RF-009: if the document was migrated on load, signal the persistence
        // task that the document is dirty so the v2 form is flushed back to disk.
        if migrated_from.is_some() {
            tracing::info!("triggering migrated-form save after workfile load");
            state.app.signal_dirty();
        }

        state
    } else {
        tracing::info!("no WORKFILE configured — running in-memory mode");
        // Create a default page so there's something to draw on
        let state = ServerState::new();
        {
            let mut doc = state.app.document.lock().expect("lock for default page");
            let page_id = sigil_core::PageId::new(uuid::Uuid::new_v4());
            let page =
                sigil_core::Page::new(page_id, "Page 1".to_string()).expect("create default page");
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
        Some(sigil_mcp::server::start_stdio(state.app.clone()))
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

#[cfg(test)]
mod cli_tests {
    use super::Cli;
    use clap::Parser;

    #[test]
    fn test_cli_parses_port() {
        let cli = Cli::try_parse_from(["sigil-server", "--port", "5000"]).unwrap();
        assert_eq!(cli.port, Some(5000));
    }

    #[test]
    fn test_cli_parses_workfile() {
        let cli = Cli::try_parse_from(["sigil-server", "--workfile", "/tmp/foo.sigil"]).unwrap();
        assert_eq!(
            cli.workfile.as_deref().unwrap().to_str(),
            Some("/tmp/foo.sigil")
        );
    }

    #[test]
    fn test_cli_no_args_is_valid() {
        let cli = Cli::try_parse_from(["sigil-server"]).unwrap();
        assert_eq!(cli.port, None);
        assert!(cli.workfile.is_none());
    }

    #[test]
    fn test_cli_rejects_invalid_port() {
        let result = Cli::try_parse_from(["sigil-server", "--port", "abc"]);
        assert!(result.is_err());
    }
}
