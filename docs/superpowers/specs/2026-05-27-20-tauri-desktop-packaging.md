# Spec 20 — Tauri Desktop Packaging

**Status:** Draft
**Author:** Mikael Pettersson (brainstormed 2026-05-27)
**Depends on:** Spec 19 (atomic delete) shipped; existing `sigil-server` axum stack; existing `sigil-cli` argv parsing patterns.
**Estimated PR size:** ~2,000 LOC including the new `src-tauri/` crate, CI workflow, server CLI args, native menus, file association config, and tests.

---

## Overview

Ship Sigil as a desktop application via [Tauri 2.x](https://v2.tauri.app). The existing `sigil-server` axum binary becomes a Tauri **sidecar**: spawned as a child process on a random local port when the user opens a `.sigil/` workfile. The frontend continues to speak GraphQL + WebSocket subscriptions to the sidecar — same urql client, same wire protocol as the browser/dev mode. No transport-layer rewrite, no IPC migration.

The Tauri shell (a new `src-tauri/` crate) owns:
- Window lifecycle (open per workfile, close terminates sidecar)
- File association (`.sigil` directory bundle on all three platforms)
- Native menubar (File / Edit / View / Window / Help)
- argv handling for "open with" workflows
- Cross-platform packaging (DMG, MSI, AppImage + deb) via Tauri's bundler

**Pre-public dogfooding context.** Code signing, auto-update, and crash reporting are explicitly deferred. The bar is "a developer can install Sigil on macOS/Windows/Linux from a GitHub Release, open a `.sigil/` directory, and edit it natively."

This spec deliberately ships **one-workfile-per-window**. Multi-workfile-in-window with parent/child inheritance navigation is the subject of a follow-up Spec 21.

---

## Motivation

- **Workfiles are local-first per PDR.** Today they only work in the dev container or via `docker run` — the user has to mount a directory and remember the port. Tauri turns Sigil into a real "double-click a `.sigil/` to edit it" experience.
- **Filesystem access is structurally easier in a native shell.** The browser sandbox makes the workfile format awkward; the existing axum server already does file I/O, but it's exposed via HTTP, which is overkill for a single-user desktop scenario.
- **Native keyboard shortcuts integrate properly.** Today the editor's Cmd+Z fights with browser/system bindings. A native menubar wires Cmd+Z directly to the editor's undo path with no contention.
- **Dogfooding velocity.** Designers and engineers using Sigil to design Sigil need a single-step install, not a `docker run + open localhost:4680` flow.
- **Architectural decisions made early scale better.** IPC, single-instance behavior, file association, native menus — all retrofit poorly. Better to confront with the codebase still flexible.

---

## Goals

1. **Cross-platform from day 1.** macOS (Universal — Apple Silicon + Intel), Windows (x86_64), Linux (x86_64). All three built from a single CI matrix.
2. **Sidecar architecture, not IPC rewrite.** Same `sigil-server` binary runs in dev (`cargo run`), in containers (`docker run`, future web deploy), and inside the Tauri shell. Frontend speaks GraphQL/WS unchanged.
3. **`.sigil/` as a Document Package on macOS.** Finder shows `.sigil/` as a single file with the Sigil icon. Right-click → "Show Package Contents" still works. Windows + Linux treat `.sigil/` as a folder with file-extension association (functional but less polished UX).
4. **One window = one workfile.** Opening a `.sigil/` opens a window for that workfile. Multi-window for multi-workfile.
5. **Single-instance on each platform.** Double-clicking a second `.sigil/` while Sigil is already running routes to the existing process (opens a new window, doesn't spawn a duplicate process).
6. **No behavior regression for browser/dev mode.** `pnpm dev` continues to work. `pnpm tauri dev` becomes a parallel option.
7. **CI matrix builds unsigned binaries.** Triggered by release-please's tag push. Output: DMG, MSI, AppImage, .deb uploaded to the GitHub Release.

---

## Non-goals

- **Multi-workfile-in-window** — deferred to Spec 21 (project model, parent/child discovery, tab navigation, deeplink).
- **Tauri IPC replacing GraphQL** — even if perf becomes a concern later, the existing transport stays. A "native IPC mode" would be a separate spec.
- **Code signing** (Apple Developer ID, Windows EV cert) — deferred until pre-public ends.
- **Auto-update** — deferred. Dogfooders download from GitHub Releases. Pairs with code signing for a real implementation.
- **Custom URL scheme** (`sigil://...`) — deferred. Needs a multi-workfile model first.
- **Crash reporting / telemetry** — pre-public, dogfooders file GitHub issues with backtraces. Telemetry conflicts with PDR's local-first stance.
- **System tray / background mode** — Sigil is a foreground editor.
- **Native notifications** — no notification triggers exist yet.

---

## §1 Architecture

### Process model

```
[OS launches Sigil with argv: /path/to/foo.sigil]
        │
        ▼
[Tauri shell (src-tauri)]
        │
        ├─ Spawns sigil-server sidecar with:
        │     --port <random ephemeral>
        │     --workfile /path/to/foo.sigil
        │
        ├─ Opens a webview window
        │     loads index.html
        │     passes VITE_SIDECAR_PORT=<port> via init script
        │
        └─ Frontend (Solid SPA)
              └─ urql GraphQL client → http://127.0.0.1:<port>/graphql
              └─ graphql-ws client → ws://127.0.0.1:<port>/graphql
```

One Tauri window = one sidecar process = one workfile. Closing the window sends SIGTERM to the sidecar (Tauri handles this); the sidecar's existing graceful-shutdown drain (per CLAUDE.md §4) flushes dirty documents to disk before exit.

### Why sidecar (not native Tauri commands)

The "swappable transport" question came up during brainstorming. The sidecar approach IS the swappable layer:
- Same `sigil-server` binary runs in dev, docker (web someday), and Tauri.
- Frontend doesn't branch on transport — it always speaks GraphQL/WS.
- Replacing the transport later with native IPC remains an option (the core engine is transport-agnostic per CLAUDE.md §1), but is unnecessary given the perf profile of a single-user desktop app.

Pure native-IPC alternative was rejected: ~2× the engineering cost, no observable user-facing benefit at this scale, and would fork the codebase into two parallel implementations of every operation.

### Sidecar port allocation

Tauri picks a random ephemeral port for each window's sidecar. Avoids port-4680 collisions when:
- Multiple Sigil windows run concurrently.
- The user has the dev server running on 4680.
- Another process on the machine bound port 4680.

The port is passed to the sidecar via `--port <N>` and to the frontend via a Tauri-injected init script that sets `window.__SIGIL_SIDECAR_PORT__` on the page before the SPA bootstraps. The frontend reads this value when constructing the urql client.

### `sigil-server` CLI changes

Two new CLI args added alongside the existing `PORT`/`WORKFILE`/`HOST` env vars:

```rust
// crates/server/src/main.rs (additions)
#[derive(clap::Parser)]
struct Cli {
    /// Localhost port to bind. Overrides PORT env var.
    #[arg(long)]
    port: Option<u16>,
    /// Workfile directory to load. Overrides WORKFILE env var.
    #[arg(long)]
    workfile: Option<PathBuf>,
}
```

Resolution order: CLI arg → env var → default (4680 / no workfile). Env vars remain canonical for docker deployments; CLI args are what Tauri uses. ~30 LOC change.

---

## §2 File association

`.sigil` is a directory bundle on disk. Per-platform mechanisms differ:

### macOS

`Info.plist` declares the `.sigil` Uniform Type Identifier:

```xml
<key>UTExportedTypeDeclarations</key>
<array>
  <dict>
    <key>UTTypeIdentifier</key>     <string>dev.sigil.workfile</string>
    <key>UTTypeDescription</key>    <string>Sigil Workfile</string>
    <key>UTTypeConformsTo</key>     <array><string>com.apple.package</string></array>
    <key>UTTypeTagSpecification</key>
    <dict>
      <key>public.filename-extension</key><array><string>sigil</string></array>
    </dict>
    <key>UTTypeIconFile</key>       <string>SigilWorkfile.icns</string>
  </dict>
</array>
<key>CFBundleDocumentTypes</key>
<array>
  <dict>
    <key>CFBundleTypeName</key>         <string>Sigil Workfile</string>
    <key>CFBundleTypeRole</key>         <string>Editor</string>
    <key>CFBundleTypeOSTypes</key>      <array><string>SIGL</string></array>
    <key>LSItemContentTypes</key>       <array><string>dev.sigil.workfile</string></array>
    <key>LSTypeIsPackage</key>          <true/>
  </dict>
</array>
```

Result: Finder shows `.sigil/` directories as single files with the Sigil icon. Double-click sends an Apple Event to Sigil with the path. `LSTypeIsPackage` is the key flag — it hides the directory contents from Finder.

### Windows

The MSI installer registers `.sigil` as a file extension associated with Sigil.exe:

```
HKEY_CLASSES_ROOT\.sigil          → "Sigil.Workfile"
HKEY_CLASSES_ROOT\Sigil.Workfile  → "Sigil Workfile"
HKEY_CLASSES_ROOT\Sigil.Workfile\shell\open\command → "C:\Program Files\Sigil\sigil.exe" "%1"
```

Windows Explorer shows `.sigil` as a folder (Windows has no Document Package equivalent), but double-click launches Sigil.exe with the path as argv. Tauri's MSI builder generates these registry entries from `tauri.conf.json`'s `bundle.windows.fileAssociations`.

### Linux

A `.desktop` file in `/usr/share/applications/sigil.desktop` declares:

```ini
[Desktop Entry]
Name=Sigil
Exec=/opt/sigil/sigil %f
MimeType=application/x-sigil-workfile;
Icon=sigil
```

Plus a MIME-type file in `/usr/share/mime/packages/sigil.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-sigil-workfile">
    <comment>Sigil Workfile</comment>
    <glob pattern="*.sigil"/>
    <generic-icon name="sigil"/>
  </mime-type>
</mime-info>
```

`xdg-mime` registers the association on install. The `.deb` package's `postinst` script calls `update-mime-database` and `update-desktop-database`.

### Single-instance behavior

Tauri's `tauri-plugin-single-instance` ensures a second invocation of `sigil /path/to/bar.sigil` while Sigil is already running gets routed to the existing process. The first instance receives the argv via the plugin's callback and decides what to do:

- If the path is already open in a window → focus that window.
- Otherwise → open a new window for it.

macOS does this naturally via `apple-events`; Windows/Linux need the explicit plugin (which uses a named pipe / Unix socket for IPC).

---

## §3 Native menus

Tauri 2.x `Menu` API. Each `MenuItem` has an ID; selection emits a `MenuEvent` that the shell forwards to the frontend via `app.emit("menu-action", id)`. The frontend dispatches based on the ID, routing to the existing command handlers (the same code paths keyboard shortcuts already trigger).

| Menu | Items | Notes |
|---|---|---|
| **Sigil** (macOS only) | About Sigil, Preferences… (greyed v1), Hide / Hide Others / Show All, Quit (Cmd+Q) | Standard macOS app menu. |
| **File** | New Workfile… (Cmd+N), Open Workfile… (Cmd+O), Open Recent ▸, Close Window (Cmd+W), Save (greyed) | Save greyed because autosave is the model (PDR). |
| **Edit** | Undo (Cmd+Z), Redo (Shift+Cmd+Z), Cut, Copy, Paste, Select All (Cmd+A), Delete | Wired to the existing HistoryManager + clipboard handlers. |
| **View** | Zoom In (Cmd+=), Zoom Out (Cmd+-), Reset Zoom (Cmd+0), Toggle Fullscreen | Wired to canvas zoom (already keyboard-bound). |
| **Window** | Minimize (Cmd+M), Bring All to Front, list of open windows | Tauri auto-populates the window list. |
| **Help** | Sigil Documentation, Report Issue, View License | External-link items via Tauri's `shell.open`. |

**Recent files list:** persisted in Tauri's app-data directory (`~/Library/Application Support/Sigil/recent.json` on macOS, equivalent on Win/Linux). Max 10 entries. Pruned when the user opens a workfile whose path no longer exists.

**Deferred from v1 menus:**
- Object menu (Group / Ungroup / Bring to Front / Send to Back / Lock / Hide) — context menu + keyboard shortcuts already cover these.
- Insert menu (Frame / Rect / Ellipse / Text / Path) — toolbar already covers these.
- Preferences panel — no preferences exist yet.

**i18n note:** menu strings go through the existing i18n pipeline. Tauri's menu API accepts plain strings; the shell calls into the i18n locale files at startup to localize labels.

---

## §4 Window lifecycle

### Launch flows

1. **Bare launch** (no argv): Sigil opens with a welcome window — "Open Workfile…" button + recent-files list.
2. **Launch with argv** (`sigil /path/to/foo.sigil`): opens a window for that workfile directly.
3. **Already-running, second launch** (single-instance): routes argv to the existing process. If the path is already open → focus that window. Else → open a new window.

### Open Workfile flow

1. User picks `.sigil/` via File → Open (Tauri's `dialog.open` with `directory: true` + extension filter `.sigil`).
2. Tauri shell:
   - Picks a random ephemeral port.
   - Spawns `sigil-server` sidecar: `sigil-server --port <port> --workfile <path>`.
   - Opens a new webview window pointed at `tauri://localhost`.
   - Injects `window.__SIGIL_SIDECAR_PORT__` and `window.__SIGIL_WORKFILE_PATH__` init values.
   - Adds the path to the recent-files list.
3. Frontend reads the init values, constructs urql client → connects → loads document.
4. Title bar shows the workfile path (or a short form: parent dir + workfile name).

### Close Window flow

1. User closes the window (Cmd+W or red-X).
2. Tauri shell:
   - Sends SIGTERM to the sidecar.
   - Waits up to 5s for graceful shutdown (matches existing `PERSISTENCE_SHUTDOWN_TIMEOUT`).
   - If timeout exceeded → SIGKILL.
3. Sidecar's existing shutdown drain flushes dirty document to disk before exit.

### Quit App flow

Same as Close Window, but iterated over all open windows. macOS Cmd+Q triggers `before-quit` event; Tauri's event handler waits for all windows to close (and all sidecars to drain) before terminating the parent process.

### Crash recovery

If a sidecar crashes (panic, OOM, etc.) while the window is open:
- The webview observes a WebSocket disconnect.
- The frontend shows a "Lost connection to sidecar — reload window to recover" message.
- The user can either close the window OR Cmd+R to reload, which prompts Tauri to spawn a fresh sidecar.

Persistence is per-tick (existing): on crash, at-most-N seconds of editing are lost (matches the existing dev-server behavior — no regression).

---

## §5 Dev workflow

Two parallel dev flows preserved.

| Command | What it does |
|---|---|
| `pnpm dev` (existing) | Vite + manual `cargo run --bin sigil-server`. Browser mode at localhost:5173. No Tauri overhead. **Default for frontend iteration.** |
| `pnpm tauri dev` (new) | Tauri shell spawns + uses the same Vite dev server for hot reload. Sidecar binary built once via `cargo build` and reused. **For validating Tauri-specific behaviors.** |
| `pnpm tauri build` (new) | Production build: release sidecar, bundled frontend, .dmg / .msi / .AppImage / .deb. **For local packaging tests.** |

The Vite config gets a small addition: when `TAURI_DEV_HOST` is set (Tauri injects this), the Vite dev server binds to the host Tauri expects. Otherwise default localhost:5173.

The frontend's urql client construction reads `window.__SIGIL_SIDECAR_PORT__` if present (Tauri mode), else falls back to `import.meta.env.VITE_API_BASE_URL` (existing pattern, `/graphql` proxy in dev).

`Dockerfile` is unchanged — docker deployment continues to work using env vars.

---

## §6 Build pipeline / CI

New workflow: `.github/workflows/tauri-build.yml`.

### Matrix

| Job | Runner | Targets | Output |
|---|---|---|---|
| macOS | `macos-14` (Apple Silicon) | `aarch64-apple-darwin` + `x86_64-apple-darwin` then `lipo` | `Sigil-<version>-universal.dmg` |
| Windows | `windows-2022` | `x86_64-pc-windows-msvc` | `Sigil-<version>-x64.msi` |
| Linux | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `Sigil-<version>-x86_64.AppImage` + `Sigil-<version>-amd64.deb` |

### Triggers

- **Push to `main`**: build (sanity check), upload artifacts to the workflow run, don't publish.
- **Tag push** (`v*.*.*` matching release-please): build, upload to the corresponding GitHub Release as assets.
- **`workflow_dispatch`**: manual trigger for ad-hoc dogfooding builds.

### Caching

- `actions/cache` for `~/.cargo/registry`, `target/`, `~/.pnpm-store`, and Tauri's per-platform build artifacts.
- Expected cold build: ~15-20 min per platform. Warm build: ~5-10 min.

### Sidecar packaging

`tauri.conf.json` declares the sidecar via `bundle.externalBin`:

```json
{
  "bundle": {
    "externalBin": [
      "../target/release/sigil-server"
    ]
  }
}
```

Tauri's bundler copies the binary into the app's resources directory on each platform (`Resources/` on macOS, `bin/` in MSI, alongside the binary on Linux). The bundled binary is named per the Tauri convention `sigil-server-<target-triple>` to support multi-arch macOS Universal builds. The shell looks up the appropriate binary at runtime via Tauri's `tauri-plugin-shell` API.

### Release-please integration

Existing `.github/workflows/release-please.yml` already creates release PRs from conventional commits. When the release PR merges, a tag is pushed. The new `tauri-build.yml`'s `tag push` trigger fires → builds → uploads to the GitHub Release that release-please just created. No manual coordination needed.

### CI Gate

The new `tauri-build` job is **NOT** added to the existing CI Gate (`if: always()`). Build failures should not block routine non-release PRs from merging. Tauri builds are gated on the tag-push event and the manual dispatcher.

---

## §7 Repo structure

```
sigil/                          # existing
├── crates/                     # existing (sigil-core, sigil-state, sigil-server, sigil-mcp)
├── cli/                        # existing (sigil-cli)
├── frontend/                   # existing
├── src-tauri/                  # NEW — Tauri shell
│   ├── Cargo.toml              # sigil-shell crate; NOT in workspace.members
│   ├── tauri.conf.json         # bundle config, file associations, window defaults
│   ├── icons/                  # platform icons at standard sizes
│   │   ├── sigil-app.icns      # macOS app icon
│   │   ├── sigil-app.ico       # Windows
│   │   ├── sigil-app-*.png     # Linux (multiple sizes)
│   │   ├── sigil-workfile.icns # macOS .sigil bundle icon
│   │   └── sigil-workfile.ico  # Windows .sigil file icon
│   ├── src/
│   │   ├── main.rs             # Tauri app entry — event loop, window mgmt
│   │   ├── menus.rs            # native menu definitions (§3)
│   │   ├── sidecar.rs          # spawn + monitor + graceful shutdown (§4)
│   │   ├── file_assoc.rs       # argv parsing → window routing (§2)
│   │   └── recent_files.rs     # recent-files persistence
│   ├── build.rs                # icon embedding via tauri-build
│   └── capabilities/
│       └── default.json        # Tauri permissions (fs, dialog, shell:open)
├── .github/workflows/
│   ├── ci.yml                  # existing (unchanged)
│   ├── tauri-build.yml         # NEW — matrix build
│   └── release-please.yml      # existing (unchanged; tag push triggers tauri-build.yml)
└── (existing root files: Cargo.toml, Dockerfile, dev.sh, CLAUDE.md, etc.)
```

### Why `src-tauri/` is outside `crates/workspace`

The existing `Cargo.toml`'s `[workspace.members]` is `crates/*` + `cli`. Tauri 2.x has substantial dependencies (~40 transitive crates) that would bloat `cargo build --workspace` builds for non-Tauri development. Keeping `src-tauri/` as a separate Cargo project — invoked only by `pnpm tauri dev` / `pnpm tauri build` — preserves the existing dev velocity.

`src-tauri/Cargo.toml` references the workspace's `sigil-core` etc. via `path = "../crates/core"` dependencies (path-based, not workspace-member-based).

### Why `sigil-shell` not `sigil-tauri`

The crate is the desktop shell. Future "what if we ship a different shell (Electron, web-app, embedded)?" makes the generic name appropriate. Tauri is an implementation detail.

---

## §8 Tauri permissions / capabilities

Tauri 2.x's capability system requires explicit declaration of what the webview can ask the shell to do. Sigil's `capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Sigil default capabilities — desktop file picker, sidecar lifecycle, recent files.",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:webview:default",
    "core:event:default",
    "core:menu:default",
    "dialog:allow-open",
    "shell:allow-open"
  ]
}
```

Notably absent:
- No `shell:allow-execute` — the only sidecar is the bundled `sigil-server`, spawned by the shell directly (not via webview-invoked shell command).
- No `fs:*` permissions — the webview doesn't directly touch the filesystem; all reads/writes flow through the sidecar's HTTP API (which uses Rust `std::fs`, not Tauri's `fs` scope). The Tauri shell's own filesystem access (recent-files persistence) is unrelated to the webview-facing capability system.
- No `http:allow-fetch` — the frontend talks to the sidecar via localhost; Tauri's HTTP scope isn't needed.
- No `dialog:allow-save` — Sigil's autosave model (PDR) means there's no explicit "Save As" UI yet.

Capabilities can be tightened further as the app stabilizes.

---

## §9 Input Validation Inventory

| Input | Source | Validation |
|---|---|---|
| `--port <N>` CLI arg | Tauri spawn / dev command | `u16` parsed by clap; reject 0; reject already-bound (axum error path handles this). |
| `--workfile <PATH>` CLI arg | Tauri spawn | `PathBuf`; canonicalize and verify the path exists (or is creatable). Existing workfile load path validates further. |
| Argv path on launch | OS → Tauri | UTF-8 string; sanitize against null bytes; resolve to absolute path before passing to sidecar. |
| Recent-files entries | Disk | Validate each entry's path exists at load time; silently drop missing entries. |
| Window count | Tauri's internal | Cap at 16 simultaneous windows (sanity limit; can be raised later). |

---

## §10 PDR Traceability

**PDR features implemented:**
- "Local-first design tool" (PDR Overview) — Tauri makes this true natively on macOS/Windows/Linux without Docker.
- "Git-native persistence" (PDR Goals) — preserved; workfile format unchanged.
- "Local container/workstation deployment" (PDR Goals: "performance in constrained environments") — extended from container-only to native-desktop.
- "User may run multiple instances for different projects simultaneously" (PDR §Server) — preserved; one sidecar per window matches.

**PDR features explicitly deferred:**
- "Workfile discovery — scanning the directory tree for `.sigil/` directories and resolving the inheritance hierarchy" (PDR §Server Responsibilities) — deferred to Spec 21. v1 loads one workfile at a time per Tauri window.
- "Approach C migration path (Rust core compiled to WASM in the browser)" — neither pursued nor blocked. The sidecar architecture keeps the browser-deploy option open.

---

## §11 Atomicity and Consistency Guarantees

**Window lifecycle:** opening / closing a window must not corrupt the workfile. Achieved by:
- Sidecar's existing graceful-shutdown drain (CLAUDE.md §4) flushes dirty documents before exit.
- Tauri's SIGTERM + 5s timeout matches `PERSISTENCE_SHUTDOWN_TIMEOUT`.
- SIGKILL fallback only fires if drain genuinely deadlocks; at-most-N-seconds of editing lost (same as today's `docker stop`).

**Single-instance:** the `tauri-plugin-single-instance` handshake is best-effort. Race condition: two simultaneous double-clicks could spawn two processes before the named pipe is bound. Mitigation: the second-spawned process detects the existing pipe on bind failure and routes its argv to the first.

**Sidecar crash:** the document state is held in the sidecar's memory. A crash mid-edit loses the unsaved buffer (same as today). The persistence task's dirty-flag tick (existing) bounds the loss to <N seconds.

**File association registration:** unsigned binaries can still register `.sigil` on macOS via `lsregister`. The first launch of an unsigned `.dmg` requires the user to right-click → Open to bypass Gatekeeper; subsequent launches work normally. Windows SmartScreen shows a "publisher unknown" warning on first MSI install.

---

## §12 Recursion Safety

N/A. This spec introduces no new recursive functions or tree walks. The Tauri shell handles linear argv parsing, window mgmt, and sidecar spawn — no traversal.

---

## §13 Tool Lifecycle Contract

N/A. This spec introduces no new canvas tools.

---

## §14 Cross-Stack Type Extension Inventory

N/A. This spec introduces no new shared wire-format types. The existing GraphQL/MCP/WebSocket types are unchanged. The new CLI args (`--port`, `--workfile`) on `sigil-server` are Rust-only and don't cross any transport boundary.

---

## §15 WASM Compatibility

N/A. The new `src-tauri/` crate is desktop-only by definition (Tauri runs a native shell). It does not depend on `sigil-core` directly — only the existing `sigil-server` binary, which is spawned as a sidecar. The WASM-compatibility constraint on `sigil-core` is unchanged.

---

## §16 Done criteria

1. `pnpm tauri build` produces `.dmg`, `.msi`, `.AppImage`, `.deb` artifacts that install and launch on each respective OS.
2. Double-clicking a `.sigil/` directory on each OS launches Sigil and opens the workfile.
3. On macOS, Finder shows `.sigil/` as a single file with the Sigil icon (Document Package presentation).
4. Multiple `.sigil/` workfiles can be open simultaneously in separate windows; each has its own sidecar on a unique port.
5. Closing a window terminates its sidecar within 5 seconds and flushes the document to disk.
6. Cmd+Q (macOS) / Alt+F4 (Windows) / Ctrl+Q (Linux) quits the app cleanly, draining all sidecars first.
7. The native menubar's Undo/Redo bind to the same HistoryManager as the editor's keyboard shortcuts (one Cmd+Z = one undo step, not two).
8. `pnpm dev` (browser/dev mode) is unchanged; existing dev workflow works.
9. The CI matrix builds all three platforms on tag push and uploads artifacts to the GitHub Release.
10. `cargo test --workspace` continues to pass; no Rust regressions.
11. `pnpm --prefix frontend test --run` continues to pass; no frontend regressions.

---

## §17 Open questions / deferred

- **Spec 21 — Multi-workfile project model.** Once Sigil ships as a desktop app and dogfooding produces usage patterns, design the inheritance/discovery model (git-repo-bounded scan, manifest-pointer-based, or hybrid), in-window tab navigation for descendant workfiles, deeplinking, and the sidecar-multi-document architecture. Out of scope here.
- **Performance characterization.** How much memory does each sidecar process consume at idle? At a 1000-node document load? Need to measure on real workloads before deciding the per-window sidecar model scales (vs. a future "shared sidecar serving multiple windows" model).
- **macOS Universal vs separate Intel/AS DMGs.** Current decision: Universal binary via `lipo`. Build time cost is ~1.5× vs single-arch. If CI time becomes a constraint, split into two DMGs.
- **`.deb` vs Flatpak vs Snap on Linux.** Current decision: AppImage (portable, no install) + `.deb` (Debian/Ubuntu native). Snap/Flatpak deferred — they require store accounts and signing infrastructure not yet in place.
- **Sidecar binary signing on macOS.** Even when the Tauri shell is signed, the sidecar binary must ALSO be signed (or hardened-runtime-exempted) or macOS will refuse to spawn it. Deferred with the rest of code signing; the workaround for unsigned builds is `--disable-library-validation` on the spawn.

---
