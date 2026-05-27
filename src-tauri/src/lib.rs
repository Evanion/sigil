//! Sigil desktop shell library entry point.
//!
//! The `run` function is invoked from `main.rs` on desktop and from the
//! mobile entry points on iOS/Android. Tauri 2.x recommends placing the
//! Builder in a library so it can be reused across desktop and mobile.

mod file_assoc;
mod sidecar;

use std::sync::Mutex;

use sidecar::SidecarProcess;
use tauri::Manager;

struct AppState {
    sidecar: Mutex<Option<SidecarProcess>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    // Parse argv BEFORE constructing the Builder so the captured value can
    // move into the .setup() closure. The single-instance plugin's callback
    // handles argv from second launches (focusing the existing window);
    // Task 8 will route the second-launch workfile into a new window.
    let initial_workfile = file_assoc::extract_workfile_path(&std::env::args().collect::<Vec<_>>());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            tracing::info!("second-instance argv: {argv:?}");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let handle = app.handle().clone();
            let workfile = initial_workfile.clone();
            let sidecar_proc =
                tauri::async_runtime::block_on(SidecarProcess::spawn(workfile.as_ref()))
                    .map_err(|e| format!("spawn sidecar: {e}"))?;
            let port = sidecar_proc.port;
            handle.manage(AppState {
                sidecar: Mutex::new(Some(sidecar_proc)),
            });

            if let Some(window) = handle.get_webview_window("main") {
                // Inject the sidecar port into the WebView so the frontend
                // sidecar-url helper (Task 2) can dial it. This uses Tauri's
                // WebView script-injection API, not JavaScript eval().
                let init_script = format!("window.__SIGIL_SIDECAR_PORT__ = {port};");
                let _ = window.eval(&init_script);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let handle = window.app_handle().clone();
                if let Some(state) = handle.try_state::<AppState>() {
                    let sidecar_opt = state.sidecar.lock().expect("lock sidecar").take();
                    if let Some(sidecar_proc) = sidecar_opt {
                        tauri::async_runtime::block_on(sidecar_proc.shutdown_gracefully());
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Sigil");
}
