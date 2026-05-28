//! File Open/New dialog Tauri commands.
//!
//! Wires the native file picker (via `tauri-plugin-dialog`) to the
//! `open_workfile_window` flow defined in `crate::windows`. Three commands:
//!
//! * `open_workfile_dialog` — pick an existing `.sigil` directory and open it.
//! * `new_workfile_dialog` — pick a path for a new workfile; create the
//!   directory if it doesn't exist, ensure the `.sigil` extension, then open.
//! * `get_recent_workfiles` — return the persisted recents list (pruned).
//!
//! The dialog calls themselves are `blocking_*` because Tauri marshals
//! command handlers to a dedicated runtime — the modal dialog runs on a
//! background thread, not the UI thread. The handler signatures are `async`
//! so we can `await` the downstream `open_workfile_window` (which performs
//! an async `openSession` GraphQL call).

use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn open_workfile_dialog(app: tauri::AppHandle) -> Result<(), String> {
    let path = app
        .dialog()
        .file()
        .set_title("Open Sigil Workfile")
        .add_filter("Sigil Workfile", &["sigil"])
        .blocking_pick_folder();

    let Some(path) = path else {
        return Ok(());
    };
    let path_buf = path.into_path().map_err(|e| format!("path: {e}"))?;

    crate::windows::open_workfile_window(app, path_buf)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn new_workfile_dialog(app: tauri::AppHandle) -> Result<(), String> {
    let path = app
        .dialog()
        .file()
        .set_title("New Sigil Workfile")
        .set_can_create_directories(true)
        .add_filter("Sigil Workfile", &["sigil"])
        .blocking_save_file();

    let Some(path) = path else {
        return Ok(());
    };
    let mut path_buf = path.into_path().map_err(|e| format!("path: {e}"))?;
    if path_buf.extension().is_none() {
        path_buf.set_extension("sigil");
    }

    // Create the directory if it doesn't exist (user picked a NEW name).
    if !path_buf.exists() {
        std::fs::create_dir(&path_buf).map_err(|e| format!("create workfile dir: {e}"))?;
    }

    crate::windows::open_workfile_window(app, path_buf)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recent_workfiles(app: tauri::AppHandle) -> Vec<crate::recent_files::RecentEntry> {
    use tauri::Manager;
    if let Ok(dir) = app.path().app_data_dir() {
        crate::recent_files::load(&dir).unwrap_or_default()
    } else {
        Vec::new()
    }
}
