//! Window creation and lifecycle (open-intent → openSession → new window).

use std::path::PathBuf;

use anyhow::{Context as _, Result};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::app_state::{AppState, WindowBinding};

fn fresh_window_label() -> String {
    format!("window-{}", uuid::Uuid::new_v4().simple())
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

    let _window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Sigil")
        .initialization_script(&init_script)
        .min_inner_size(800.0, 600.0)
        .inner_size(1280.0, 800.0)
        .build()
        .with_context(|| format!("build window {label}"))?;

    Ok(())
}
