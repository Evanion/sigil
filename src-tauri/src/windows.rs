//! Window creation and lifecycle (open-intent → openSession → new window).

use std::path::PathBuf;

use anyhow::{Context as _, Result};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::app_state::{AppState, WindowBinding};

fn fresh_window_label() -> String {
    format!("window-{}", uuid::Uuid::new_v4().simple())
}

/// Persist the current set of open-workfile paths to `sessions.json` so
/// Task 18's welcome window can offer "restore previous session" on the
/// next launch. The persisted list is the *deduplicated* union of every
/// `WindowBinding`'s workfile path — two windows viewing the same file
/// contribute one entry. Logs and swallows persistence errors: failing to
/// write `sessions.json` should not block the window-lifecycle flow that
/// triggered it.
pub(crate) fn persist_open_sessions(app: &AppHandle) {
    let state = app.state::<AppState>();
    let unique: std::collections::BTreeSet<_> = state
        .windows
        .lock()
        .expect("windows lock")
        .values()
        .map(|b| b.workfile_path.clone())
        .collect();
    let workfiles: Vec<_> = unique.into_iter().collect();
    if let Ok(app_data_dir) = app.path().app_data_dir()
        && let Err(e) = crate::sessions_persist::save(
            &app_data_dir,
            &crate::sessions_persist::PersistedSessions { workfiles },
        )
    {
        tracing::warn!("persist sessions.json: {e}");
    }
}

/// Open the welcome window on a cold launch with no workfile in argv.
/// The window has a fixed label so a second open attempt focuses the
/// existing window instead of spawning a duplicate. Fixed inner size —
/// the welcome window is a single full-screen surface, not a resizable
/// editor canvas.
pub fn open_welcome_window(app: &AppHandle) -> Result<()> {
    let label = "welcome";
    if app.get_webview_window(label).is_some() {
        return Ok(());
    }
    let _w = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App("src/welcome/welcome.html".into()),
    )
    .title("Sigil")
    .inner_size(640.0, 480.0)
    .build()
    .context("build welcome window")?;
    Ok(())
}

/// Open a workfile in a window. Idempotent: opening a path that's already
/// open in a window focuses the existing window instead of creating a new one.
pub async fn open_workfile_window(app: AppHandle, workfile: PathBuf) -> Result<()> {
    let canonical = std::fs::canonicalize(&workfile)
        .with_context(|| format!("canonicalize {}", workfile.display()))?;

    if let Some(state) = app.try_state::<AppState>()
        && let Some(label) = state.first_window_for_path(&canonical)
        && let Some(window) = app.get_webview_window(&label)
    {
        let _ = window.set_focus();
        let _ = window.unminimize();
        return Ok(());
    }

    let state = app.state::<AppState>();
    let session_info = state
        .gql
        .open_session(&canonical)
        .await
        .with_context(|| format!("openSession {}", canonical.display()))?;

    // Inject globals BEFORE any page script runs.
    let init_script = format!(
        "window.__SIGIL_SESSION_ID__ = '{}'; window.__SIGIL_SERVER_PORT__ = {};",
        session_info.id, state.server_port
    );

    let label = fresh_window_label();

    state.windows.lock().expect("windows lock").insert(
        label.clone(),
        WindowBinding {
            workfile_path: canonical.clone(),
            session_id: session_info.id.clone(),
        },
    );

    if let Ok(app_data_dir) = app.path().app_data_dir()
        && let Err(e) = crate::recent_files::add(&app_data_dir, &canonical)
    {
        tracing::warn!("record recent: {e}");
    }
    persist_open_sessions(&app);

    let _window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Sigil")
        .initialization_script(&init_script)
        .min_inner_size(800.0, 600.0)
        .inner_size(1280.0, 800.0)
        .build()
        .with_context(|| format!("build window {label}"))?;

    Ok(())
}

/// Handle a CloseRequested event. Removes the binding; if no other window
/// is viewing the same workfile, calls closeSession to release the
/// server-side session. Removal + "is anyone else viewing this path" are
/// performed under a single lock acquisition — per rust-defensive.md
/// "Hold Locks for the Full Read-Modify-Write Sequence", splitting the
/// remove from the check would be a TOCTOU race if another window for the
/// same path closed between the two acquisitions.
pub fn handle_window_close(window: &tauri::Window) {
    let label = window.label().to_string();
    let app = window.app_handle().clone();

    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    let (removed_binding, still_open) = {
        let mut windows = state.windows.lock().expect("windows lock");
        let Some(binding) = windows.remove(&label) else {
            return;
        };
        let still_open = windows
            .values()
            .any(|b| b.workfile_path == binding.workfile_path);
        (binding, still_open)
    };

    // Persist regardless of `still_open`: when the closing window was the
    // last viewer of a path, that path drops out of sessions.json; when
    // another viewer remains, the path stays. Either way the on-disk set
    // must match the in-memory window registry after every close.
    persist_open_sessions(&app);

    if still_open {
        // Another window is still viewing the same workfile — keep the
        // server-side session alive.
        return;
    }

    let gql = state.gql.clone();
    let session_id = removed_binding.session_id;
    tauri::async_runtime::spawn(async move {
        if let Err(e) = gql.close_session(&session_id).await {
            tracing::warn!(session_id = %session_id, error = %e, "closeSession failed");
        }
    });
}

/// Called when supervision detects a server crash. Snapshots current bindings
/// under a held lock, respawns the server, replays openSession for each
/// known path, and emits `session-replaced` events so frontend windows can
/// rebind their urql clients. Per-window failures fall back to a
/// `session-recovery-failed` event so the UI can surface a persistent error.
pub async fn handle_crash(app: AppHandle) -> Result<()> {
    tracing::error!("crash recovery: respawning sigil-server");

    let snapshot: Vec<(String, PathBuf)> = {
        let state = app.state::<AppState>();
        let windows = state.windows.lock().expect("windows lock");
        windows
            .iter()
            .map(|(label, b)| (label.clone(), b.workfile_path.clone()))
            .collect()
    };

    // Notify each window of the crash so frontends can show a recovery toast
    // before the new session arrives.
    for (label, _) in &snapshot {
        if let Some(window) = app.get_webview_window(label)
            && let Err(e) = window.emit(
                "engine-crashed",
                serde_json::json!({
                    "message": "Sigil's engine restarted. Reopening your workfile…"
                }),
            )
        {
            tracing::warn!(label = %label, error = %e, "emit engine-crashed failed");
        }
    }

    // Respawn the sidecar on the same port. The old SidecarProcess is
    // dropped here — `kill_on_drop(true)` ensures any zombie process is
    // reaped — and replaced with the fresh handle.
    let state = app.state::<AppState>();
    let port = state.server_port;
    let new_sidecar = crate::sidecar::SidecarProcess::spawn(port)
        .await
        .with_context(|| format!("respawn sidecar on port {port}"))?;
    *state.server_proc.lock().expect("server_proc lock") = Some(new_sidecar);

    // Brief delay to let the new server bind its listener before replay.
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Replay each binding. We snapshotted labels-and-paths above and do not
    // hold the windows lock across the awaits below.
    for (label, path) in snapshot {
        match state.gql.open_session(&path).await {
            Ok(info) => {
                state.windows.lock().expect("windows lock").insert(
                    label.clone(),
                    WindowBinding {
                        workfile_path: path.clone(),
                        session_id: info.id.clone(),
                    },
                );
                if let Some(window) = app.get_webview_window(&label)
                    && let Err(e) = window.emit(
                        "session-replaced",
                        serde_json::json!({
                            "newSessionId": info.id,
                            "serverPort": port,
                        }),
                    )
                {
                    tracing::warn!(
                        label = %label,
                        error = %e,
                        "emit session-replaced failed",
                    );
                }
            }
            Err(e) => {
                tracing::error!(label = %label, error = %e, "replay openSession failed");
                if let Some(window) = app.get_webview_window(&label)
                    && let Err(emit_err) = window.emit(
                        "session-recovery-failed",
                        serde_json::json!({ "message": e.to_string() }),
                    )
                {
                    tracing::warn!(
                        label = %label,
                        error = %emit_err,
                        "emit session-recovery-failed failed",
                    );
                }
            }
        }
    }

    Ok(())
}
