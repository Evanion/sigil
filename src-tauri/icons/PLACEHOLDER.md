# Placeholder Icons

These are 1x1 transparent PNGs generated during Task 4 (Plan 20) solely
to satisfy `tauri::generate_context!()`, which hard-codes a runtime lookup
for `icons/icon.png`. The empty `bundle.icon` array in `tauri.conf.json`
disables icons in the macOS bundle, but the runtime macro still needs the
file to exist.

Task 11 (Icons + .sigil file associations) replaces these with real
artwork (1024x1024 source + the rendered set Tauri expects, including
`.ico` and `.icns` variants).
