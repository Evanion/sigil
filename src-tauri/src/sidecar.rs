//! Sigil sidecar process management.
//!
//! The Tauri shell owns one sigil-server child process. SidecarProcess
//! spawns it on a known port and shuts it down gracefully (SIGTERM + 5s
//! drain + SIGKILL fallback).

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context as _, Result};
use tokio::process::{Child, Command};

// Plan-20 staged delivery: SHUTDOWN_TIMEOUT, the `child` field, and the
// `shutdown_gracefully` / `is_alive` methods are consumed by Task 16
// (window-close + crash recovery). Held here to keep the spawn path
// self-contained.
#[allow(dead_code)]
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

pub struct SidecarProcess {
    pub port: u16,
    #[allow(dead_code)]
    child: Option<Child>,
}

impl SidecarProcess {
    /// Spawn sigil-server on the given port. The server does NOT pre-open
    /// any workfile — sessions are opened via GraphQL after the server is up.
    pub async fn spawn(port: u16) -> Result<Self> {
        let sidecar_path = locate_sidecar_binary()?;

        let mut cmd = Command::new(&sidecar_path);
        cmd.arg("--port").arg(port.to_string());
        cmd.stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .stdin(Stdio::null());
        cmd.kill_on_drop(true);

        let child = cmd.spawn().with_context(|| {
            format!("spawn sidecar {} on port {}", sidecar_path.display(), port)
        })?;

        tracing::info!(pid = child.id().unwrap_or(0), port, "spawned sidecar");

        Ok(Self {
            port,
            child: Some(child),
        })
    }

    /// SIGTERM, wait up to `SHUTDOWN_TIMEOUT`, SIGKILL fallback.
    #[allow(dead_code)] // Wired in Task 16 (window-close).
    pub async fn shutdown_gracefully(mut self) {
        let Some(mut child) = self.child.take() else {
            return;
        };

        #[cfg(unix)]
        {
            if let Some(pid) = child.id() {
                // SAFETY: libc::kill takes a pid_t and signal; pid originates
                // from Child::id which only returns Some while the child is alive.
                // u32 -> i32 cast is safe because POSIX pids fit in i32.
                // We intentionally ignore the return value; failure falls through
                // to the timeout branch which sends SIGKILL.
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }
        }

        let wait_fut = child.wait();
        match tokio::time::timeout(SHUTDOWN_TIMEOUT, wait_fut).await {
            Ok(Ok(status)) => {
                tracing::info!("sidecar exited gracefully status={status:?}");
            }
            Ok(Err(e)) => {
                tracing::warn!("sidecar wait error: {e}");
            }
            Err(_) => {
                tracing::warn!("sidecar drain timeout, sending SIGKILL");
                let _ = child.kill().await;
            }
        }
    }

    /// Check if the sidecar process is still alive (non-blocking).
    #[allow(dead_code)] // Wired in Task 16 (crash recovery).
    pub fn is_alive(&mut self) -> bool {
        if let Some(child) = self.child.as_mut() {
            child.try_wait().map(|s| s.is_none()).unwrap_or(false)
        } else {
            false
        }
    }
}

fn locate_sidecar_binary() -> Result<PathBuf> {
    if let Ok(current) = std::env::current_exe()
        && let Some(parent) = current.parent()
    {
        let bundled = parent.join(if cfg!(windows) {
            "sigil-server.exe"
        } else {
            "sigil-server"
        });
        if bundled.exists() {
            return Ok(bundled);
        }
    }

    // Dev fallback: walk up from cwd looking for target/debug or target/release.
    let cwd = std::env::current_dir().context("current_dir")?;
    let mut search = cwd.clone();
    for _ in 0..6 {
        for profile in ["release", "debug"] {
            let candidate = search.join("target").join(profile).join(if cfg!(windows) {
                "sigil-server.exe"
            } else {
                "sigil-server"
            });
            if candidate.exists() {
                return Ok(candidate);
            }
        }
        if !search.pop() {
            break;
        }
    }

    anyhow::bail!(
        "could not locate sigil-server binary; checked next-to-exe and target/debug|release walking up from {}",
        cwd.display()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_locate_sidecar_binary_returns_path_or_documents_failure() {
        // This test passes if the binary exists in target/debug|release after a workspace build,
        // OR documents the actual error message if it doesn't.
        // The test doesn't actually need to find the binary; it just exercises the search path.
        let result = locate_sidecar_binary();
        match result {
            Ok(path) => {
                assert!(path.exists(), "located path should exist");
                assert!(path.file_name().is_some());
            }
            Err(e) => {
                assert!(e.to_string().contains("sigil-server"));
            }
        }
    }
}
