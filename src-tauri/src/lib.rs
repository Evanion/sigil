//! Sigil desktop shell library entry point.
//!
//! The `run` function is invoked from `main.rs` on desktop and from the
//! mobile entry points on iOS/Android. Tauri 2.x recommends placing the
//! Builder in a library so it can be reused across desktop and mobile.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running Sigil");
}
