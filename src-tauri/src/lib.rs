//! Sigil desktop shell library entry point.
//!
//! The `run` function is invoked from `main.rs` on desktop and from the
//! mobile entry points on iOS/Android. Tauri 2.x recommends placing the
//! Builder in a library so it can be reused across desktop and mobile.

mod file_assoc;
mod menus;
mod sidecar;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use sidecar::SidecarProcess;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

struct AppState {
    /// Map from window label to its sidecar. Mutated when windows open or
    /// close — each Tauri window owns its own `sigil-server` child process,
    /// bound to a unique localhost port. Insert happens in
    /// `open_workfile_window`; remove + graceful shutdown happens in the
    /// `on_window_event` close-requested branch.
    sidecars: Mutex<HashMap<String, SidecarProcess>>,
}

fn fresh_window_label() -> String {
    format!("window-{}", uuid::Uuid::new_v4().simple())
}

/// Spawn a fresh sidecar bound to a free port, then build a new Tauri
/// window wired to that sidecar. The sidecar's port is injected into the
/// WebView via `initialization_script`, which runs before any page script,
/// so the frontend's sidecar-url helper can dial it from the very first
/// bootstrap call.
async fn open_workfile_window(
    app: tauri::AppHandle,
    workfile: Option<PathBuf>,
) -> anyhow::Result<()> {
    let label = fresh_window_label();
    let sidecar = SidecarProcess::spawn(workfile.as_ref()).await?;
    let port = sidecar.port;

    if let Some(state) = app.try_state::<AppState>() {
        state
            .sidecars
            .lock()
            .expect("lock sidecars")
            .insert(label.clone(), sidecar);
    }

    let init_script = format!("window.__SIGIL_SIDECAR_PORT__ = {port};");

    let _window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Sigil")
        .initialization_script(&init_script)
        .min_inner_size(800.0, 600.0)
        .inner_size(1280.0, 800.0)
        .build()?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    // Parse argv BEFORE constructing the Builder so the captured value can
    // move into the .setup() closure. The single-instance plugin's callback
    // handles argv from second launches by routing them through
    // `open_workfile_window` for fresh per-window sidecar isolation.
    let initial_workfile = file_assoc::extract_workfile_path(&std::env::args().collect::<Vec<_>>());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let workfile = file_assoc::extract_workfile_path(&argv);
            tracing::info!("second-instance argv={argv:?} workfile={workfile:?}");
            if let Some(wf) = workfile {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = open_workfile_window(app, Some(wf)).await {
                        tracing::error!("failed to open workfile window: {e}");
                    }
                });
            } else {
                // No workfile in argv — fall back to focusing any existing
                // window. `webview_windows()` returns a HashMap whose
                // iteration order is nondeterministic, but every window is
                // equivalent in this case (the second launch had nothing to
                // open), so focusing an arbitrary one is the right behavior.
                let windows = app.webview_windows();
                if let Some((_label, window)) = windows.iter().next() {
                    let _ = window.set_focus();
                }
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let handle = app.handle().clone();

            // Install the native menubar before any sidecar work — menu
            // construction should not depend on the sidecar's readiness, and
            // failing fast on a menu build error is more diagnosable than
            // failing after spawning a child process.
            let menu = menus::build_menu(&handle).map_err(|e| format!("build menu: {e}"))?;
            handle
                .set_menu(menu)
                .map_err(|e| format!("set menu: {e}"))?;
            menus::install_menu_handler(&handle);

            handle.manage(AppState {
                sidecars: Mutex::new(HashMap::new()),
            });

            let workfile = initial_workfile.clone();
            tauri::async_runtime::block_on(open_workfile_window(handle.clone(), workfile))
                .map_err(|e| format!("open initial window: {e}"))?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let label = window.label().to_string();
                let handle = window.app_handle().clone();
                if let Some(state) = handle.try_state::<AppState>() {
                    let sidecar = state.sidecars.lock().expect("lock sidecars").remove(&label);
                    if let Some(sidecar) = sidecar {
                        tauri::async_runtime::block_on(sidecar.shutdown_gracefully());
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Sigil");
}
