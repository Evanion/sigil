#![warn(clippy::all, clippy::pedantic)]

use std::path::{Path, PathBuf};
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
    /// Port to bind. Overrides PORT env var.
    #[arg(long)]
    port: Option<u16>,

    /// Workfile directory to load. Overrides WORKFILE env var.
    #[arg(long, value_name = "PATH")]
    workfile: Option<PathBuf>,
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

    let static_dir = std::env::var("STATIC_DIR")
        .unwrap_or_else(|_| "/usr/local/share/sigil/frontend".to_string());

    // Workfile: CLI > WORKFILE env > None
    let workfile_path: Option<PathBuf> = cli
        .workfile
        .or_else(|| std::env::var("WORKFILE").ok().map(PathBuf::from));

    // Resolve port after `cli.workfile` is consumed.
    // Port: CLI > PORT env (error on malformed) > default 4680.
    // Distinguish "PORT unset" (fall through to default) from "PORT set but
    // malformed" (surface a typed error) per CLAUDE.md §11 "No Silent Error
    // Suppression".
    let port = if let Some(p) = cli.port {
        p
    } else {
        match std::env::var("PORT") {
            Ok(s) => s
                .parse::<u16>()
                .with_context(|| format!("PORT env var '{s}' is not a valid u16"))?,
            Err(_) => 4680,
        }
    };

    let state = if let Some(ref workfile_path) = workfile_path {
        load_workfile_into_state(workfile_path).await?
    } else {
        new_in_memory_state()
    };

    // Clone the persistence manager handle for graceful shutdown after serve.
    let persistence = state.persistence.clone();

    // Spawn MCP server on stdio if requested.
    // This allows agents to connect via stdin/stdout while the HTTP server
    // runs on the configured port for human users.
    let mcp_handle = if use_mcp_stdio {
        tracing::info!("starting MCP server on stdio");
        // MCP carries both the legacy `AppState` (for the existing mutation
        // tools) and the shared `Sessions` registry (for the session-
        // discovery tools added in Task 9). Cloning the `Arc<Sessions>` is
        // cheap and ensures stdio MCP sees the same `register_in_memory`
        // default session that the HTTP transport sees.
        Some(sigil_mcp::server::start_stdio(
            state.app.legacy.clone(),
            state.app.sessions.clone(),
        ))
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

    // Graceful shutdown: drain every per-session persistence task within one
    // bounded total budget (Spec 22a §3.3). Each task does a final flush of its
    // session store before exiting.
    tracing::info!("draining persistence tasks...");
    persistence.shutdown_all(PERSISTENCE_SHUTDOWN_TIMEOUT).await;
    tracing::info!("persistence drain complete");

    Ok(())
}

/// Loads the workfile at `workfile_path` into a fresh `ServerState`, registers
/// it as the default session in the `Sessions` registry, and registers its
/// per-session persistence task.
///
/// Spec 22a §3.3 invariant: no disk-backed session exists without a persistence
/// entry. The session registration and the persistence registration therefore
/// happen in the same function. The legacy `AppState.document` still mirrors the
/// document (removed in 22c); the session store is the persistence source.
async fn load_workfile_into_state(workfile_path: &Path) -> anyhow::Result<ServerState> {
    tracing::info!("loading workfile from {}", workfile_path.display());

    let loaded = sigil_server::workfile::load_workfile(workfile_path)
        .await
        .context("failed to load workfile")?;

    let migrated_from = loaded.migrated_from;
    // The legacy `AppState` still mirrors the document (removed in 22c). The
    // session store is the persistence source as of Spec 22a.
    let doc_for_session = loaded.document.clone();
    let state = ServerState::new_with_document_and_workfile_migrated(
        loaded.document,
        workfile_path.to_path_buf(),
        migrated_from,
    );

    // Register the loaded workfile as the default session, then register its
    // per-session persistence task IN THE SAME FUNCTION (Spec 22a §3.3
    // invariant: no disk-backed session exists without a persistence entry).
    match state.app.open_session_with(workfile_path, |_path| {
        Ok::<_, std::convert::Infallible>(doc_for_session)
    }) {
        Ok(session_id) => {
            if let Some(session) = state.app.sessions.get(session_id) {
                // Passing `migrated_from` forces the first save + `.backup-v(N-1)/`
                // for a workfile that was migrated on load.
                state.persistence.register(session, migrated_from);
                tracing::info!(
                    "registered default session {session_id} + persistence for workfile {}",
                    workfile_path.display()
                );
            } else {
                tracing::error!(
                    "session {session_id} missing from registry immediately after open"
                );
            }
        }
        Err(e) => {
            tracing::warn!(
                "failed to register default session for workfile {}: {e}. \
                 Persistence will be unavailable.",
                workfile_path.display()
            );
        }
    }

    Ok(state)
}

/// Constructs an in-memory `ServerState` with a single default page.
fn new_in_memory_state() -> ServerState {
    tracing::info!("no WORKFILE configured — running in-memory mode");
    let state = ServerState::new();
    {
        let mut doc = state.app.document.lock().expect("lock for default page");
        let page_id = sigil_core::PageId::new(uuid::Uuid::new_v4());
        let page =
            sigil_core::Page::new(page_id, "Page 1".to_string()).expect("create default page");
        doc.add_page(page).expect("add default page");
    }
    state
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
