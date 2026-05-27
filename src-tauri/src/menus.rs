//! Native menubar definitions for Sigil.
//!
//! Builds the platform menubar (macOS app menu + File/Edit/View/Window) and
//! emits a `menu-action` event for each menu activation. The frontend
//! `frontend/src/transport/menu-events.ts` dispatcher routes the stable IDs
//! to the same handlers that respond to keyboard shortcuts.
//!
//! Menu IDs use a `<section>.<action>` convention (e.g. `file.open`,
//! `edit.undo`). When adding a new ID here, mirror it in `MenuAction` in
//! `frontend/src/transport/menu-events.ts` and add a corresponding handler
//! in the dispatcher's exhaustive switch.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;

    #[cfg(target_os = "macos")]
    {
        let app_submenu = Submenu::with_items(
            app,
            "Sigil",
            true,
            &[
                &PredefinedMenuItem::about(app, Some("About Sigil"), None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        menu.append(&app_submenu)?;
    }

    let new_workfile = MenuItem::with_id(
        app,
        "file.new",
        "New Workfile\u{2026}",
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let open_workfile = MenuItem::with_id(
        app,
        "file.open",
        "Open Workfile\u{2026}",
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let close_window =
        MenuItem::with_id(app, "file.close", "Close Window", true, Some("CmdOrCtrl+W"))?;
    let file_submenu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_workfile,
            &open_workfile,
            &PredefinedMenuItem::separator(app)?,
            &close_window,
        ],
    )?;
    menu.append(&file_submenu)?;

    let undo = MenuItem::with_id(app, "edit.undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
    let redo = MenuItem::with_id(app, "edit.redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?;
    let edit_submenu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &undo,
            &redo,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    menu.append(&edit_submenu)?;

    let zoom_in = MenuItem::with_id(app, "view.zoom_in", "Zoom In", true, Some("CmdOrCtrl+="))?;
    let zoom_out = MenuItem::with_id(app, "view.zoom_out", "Zoom Out", true, Some("CmdOrCtrl+-"))?;
    let zoom_reset = MenuItem::with_id(
        app,
        "view.zoom_reset",
        "Reset Zoom",
        true,
        Some("CmdOrCtrl+0"),
    )?;
    let view_submenu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &zoom_in,
            &zoom_out,
            &zoom_reset,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    menu.append(&view_submenu)?;

    let window_submenu = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?],
    )?;
    menu.append(&window_submenu)?;

    Ok(menu)
}

/// Wires `app.on_menu_event` to re-emit each activation as a `menu-action`
/// event with the menu item's stable ID as the payload. The frontend
/// dispatcher in `frontend/src/transport/menu-events.ts` consumes these.
pub fn install_menu_handler<R: Runtime>(app: &AppHandle<R>) {
    app.on_menu_event(|app_handle, event| {
        let id = event.id().0.clone();
        tracing::debug!("menu action: {id}");
        if let Err(err) = app_handle.emit("menu-action", id) {
            tracing::error!("emit menu-action failed: {err}");
        }
    });
}
