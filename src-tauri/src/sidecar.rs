//! Sigil sidecar process management.
//!
//! Each Tauri window has its own `sigil-server` child process bound to a
//! unique localhost port. Closing a window sends SIGTERM and waits up to
//! `SHUTDOWN_TIMEOUT` for the sidecar to drain. SIGKILL fallback only fires
//! if drain genuinely deadlocks.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context as _, Result};
use tokio::process::{Child, Command};

const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

pub struct SidecarProcess {
    pub port: u16,
    child: Option<Child>,
}

impl SidecarProcess {
    pub async fn spawn(workfile: Option<&PathBuf>) -> Result<Self> {
        let port = sigil_server::pick_free_port().context("pick free port")?;
        let sidecar_path = locate_sidecar_binary()?;

        let mut cmd = Command::new(&sidecar_path);
        cmd.arg("--port").arg(port.to_string());
        if let Some(wf) = workfile {
            cmd.arg("--workfile").arg(wf);
        }
        cmd.stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .stdin(Stdio::null());
        cmd.kill_on_drop(true);

        let child = cmd.spawn().with_context(|| {
            format!("spawn sidecar {} on port {}", sidecar_path.display(), port)
        })?;

        tracing::info!(
            "spawned sidecar pid={} port={} workfile={:?}",
            child.id().unwrap_or(0),
            port,
            workfile
        );

        Ok(Self {
            port,
            child: Some(child),
        })
    }

    pub async fn shutdown_gracefully(mut self) {
        let Some(mut child) = self.child.take() else {
            return;
        };

        #[cfg(unix)]
        {
            if let Some(pid) = child.id() {
                // SAFETY: libc::kill is a documented POSIX syscall with no
                // memory-safety preconditions; it returns an error code
                // rather than invoking undefined behavior on an invalid pid.
                // `pid` originates from Child::id, which only returns Some
                // while the child is alive (per tokio docs). Casting u32 ->
                // i32 is safe because POSIX pids fit in i32 on every
                // supported platform. We intentionally ignore the return
                // value: a failed SIGTERM falls through to the timeout
                // branch which sends SIGKILL.
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
}

fn locate_sidecar_binary() -> Result<PathBuf> {
    if let Ok(current) = std::env::current_exe()
        && let Some(parent) = current.parent()
    {
        let bundled = parent.join(format!("sigil-server-{TARGET_TRIPLE}"));
        if bundled.exists() {
            return Ok(bundled);
        }
        let bundled_plain = parent.join(if cfg!(windows) {
            "sigil-server.exe"
        } else {
            "sigil-server"
        });
        if bundled_plain.exists() {
            return Ok(bundled_plain);
        }
    }

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

const TARGET_TRIPLE: &str = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
    "aarch64-apple-darwin"
} else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
    "x86_64-apple-darwin"
} else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
    "x86_64-unknown-linux-gnu"
} else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
    "x86_64-pc-windows-msvc"
} else {
    "unknown"
};
