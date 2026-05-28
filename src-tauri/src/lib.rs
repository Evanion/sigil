//! Sigil desktop shell entry point.

mod file_assoc;
mod lockfile;
mod menus;
mod sidecar;
mod supervision;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    // Parse argv BEFORE constructing the Builder so the captured value can
    // move into the .setup() closure. The single-instance plugin's callback
    // currently logs second-launch argv; full second-instance routing
    // (`open_workfile_window`) lands in Task 15.
    let initial_workfile = file_assoc::extract_workfile_path(&std::env::args().collect::<Vec<_>>());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
            // Stub: full second-instance routing lands in Task 15.
            tracing::info!("second-instance argv: {argv:?}");
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

            // initial_workfile is consumed in Task 15 (window-create plumbing).
            // Captured here so the argv parse happens once at startup.
            let _ = &initial_workfile;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Sigil");
}
