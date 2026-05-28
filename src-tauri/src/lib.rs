//! Sigil desktop shell entry point.

mod app_state;
mod file_assoc;
mod graphql_client;
mod lockfile;
mod menus;
mod sidecar;
mod supervision;
mod windows;

use app_state::AppState;
use sidecar::SidecarProcess;
use supervision::Supervisor;
use tauri::Manager;

const SERVER_PORT: u16 = 4680;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    // Parse argv BEFORE constructing the Builder so the captured value can
    // move into the .setup() closure.
    let initial_workfile = file_assoc::extract_workfile_path(&std::env::args().collect::<Vec<_>>());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let workfile = file_assoc::extract_workfile_path(&argv);
            tracing::info!("second-instance argv={argv:?} workfile={workfile:?}");
            if let Some(wf) = workfile {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = windows::open_workfile_window(app, wf).await {
                        tracing::error!("open second-instance workfile: {e}");
                    }
                });
            } else if let Some((_, w)) = app.webview_windows().iter().next() {
                let _: tauri::Result<()> = w.set_focus();
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

            let sidecar = tauri::async_runtime::block_on(SidecarProcess::spawn(SERVER_PORT))
                .map_err(|e| format!("spawn sidecar: {e}"))?;
            let app_state = AppState::new(sidecar);
            handle.manage(app_state);

            let (supervisor, mut rx) = Supervisor::new(SERVER_PORT);
            tauri::async_runtime::spawn(supervisor.run());

            // Drain the supervision channel — proper crash recovery lands in
            // Task 16. Without a drainer, a backed-up channel would block the
            // supervisor's `send()` after `MAX_FAILURES`.
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    if matches!(event, supervision::SupervisionEvent::CrashDetected) {
                        tracing::error!("crash detected (recovery flow in Task 16)");
                    }
                }
            });

            if let Some(wf) = initial_workfile.clone() {
                let app_clone = handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = windows::open_workfile_window(app_clone, wf).await {
                        tracing::error!("open initial workfile: {e}");
                    }
                });
            }
            // Welcome window for the no-initial-workfile case lands in Task 18.

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Sigil");
}
