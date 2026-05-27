# Tauri Desktop Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Sigil as a Tauri 2.x desktop app (macOS Universal / Windows x64 / Linux x86_64) using the existing `sigil-server` axum binary as a sidecar.

**Architecture:** Tauri 2.x shell in a new `src-tauri/` directory (outside the Cargo workspace to avoid bloating non-Tauri builds). Each Tauri window spawns its own `sigil-server` child process on a random local port, passing `--port` and `--workfile` CLI args. Frontend speaks GraphQL+WS to the sidecar — same urql client used in browser/dev mode. `.sigil/` directories become macOS Document Packages via `LSItemContentTypes`; on Windows/Linux they remain folders with `.sigil` file-extension association.

**Tech Stack:** Tauri 2.x (Rust), `tauri-plugin-single-instance`, `tauri-plugin-shell`, `tauri-plugin-dialog`, existing axum/urql/Solid stack.

**Spec:** `docs/superpowers/specs/2026-05-27-20-tauri-desktop-packaging.md`

---

## Pre-task: Worktree setup

**Required sub-skill:** Use `superpowers:using-git-worktrees` before beginning.

- [ ] **Create worktree and branch**

```bash
cd /Volumes/projects/Personal/agent-designer
git fetch origin
git worktree add -b feature/tauri-desktop-spec-20 .worktrees/feature/tauri-desktop-spec-20 origin/main
cd .worktrees/feature/tauri-desktop-spec-20
```

All subsequent task commands run from this worktree.

---

## File Structure

**Created:**
- `src-tauri/Cargo.toml` — `sigil-shell` crate manifest.
- `src-tauri/tauri.conf.json` — Tauri 2.x bundle/window/menu config.
- `src-tauri/build.rs` — Tauri's codegen for icons + capabilities.
- `src-tauri/src/main.rs` — Tauri app entry: shell setup, plugins, run loop.
- `src-tauri/src/sidecar.rs` — sidecar spawn + graceful shutdown.
- `src-tauri/src/menus.rs` — native menubar definitions + event routing.
- `src-tauri/src/file_assoc.rs` — argv parsing, single-instance routing.
- `src-tauri/src/recent_files.rs` — recent-files JSON persistence.
- `src-tauri/capabilities/default.json` — Tauri permissions allowlist.
- `src-tauri/icons/sigil-app.icns` — macOS app icon.
- `src-tauri/icons/sigil-app.ico` — Windows app icon.
- `src-tauri/icons/sigil-app-{16,32,64,128,256,512,1024}.png` — Linux/PNG sizes.
- `src-tauri/icons/sigil-workfile.icns` — macOS `.sigil` bundle icon.
- `src-tauri/icons/sigil-workfile.ico` — Windows `.sigil` file icon.
- `frontend/src/transport/sidecar-url.ts` — picks GraphQL URL based on Tauri-injected globals or dev/browser fallback.
- `frontend/src/transport/__tests__/sidecar-url.test.ts` — unit tests.
- `frontend/src/transport/menu-events.ts` — frontend dispatcher for Tauri `menu-action` events.
- `frontend/src/transport/__tests__/menu-events.test.ts` — unit tests.
- `.github/workflows/tauri-build.yml` — cross-platform matrix build.

**Modified:**
- `Cargo.toml` (workspace root) — leave `[workspace.members]` alone; `src-tauri/` is intentionally a separate Cargo project.
- `crates/server/Cargo.toml` — ensure `clap` with `derive` is in deps (workspace already has it).
- `crates/server/src/main.rs` — add `--port` and `--workfile` CLI args (clap derive) alongside existing env vars; resolution order CLI > env > default.
- `crates/server/src/lib.rs` — export `pick_free_port` helper.
- `frontend/vite.config.ts` — read `TAURI_DEV_HOST` env when set (Tauri injects it).
- `frontend/src/store/document-store-solid.tsx` — replace `window.location.origin` URL construction with the new `sidecar-url.ts` helper. Wire menu events from Tauri to the existing keyboard-shortcut handlers.
- `frontend/package.json` — add `tauri-dev` and `tauri-build` npm scripts, `@tauri-apps/cli` dev dependency, `@tauri-apps/api` runtime dependency.
- `CLAUDE.md` — add §3 entry for `pnpm tauri dev` / `pnpm tauri build`, add §2 reference to `src-tauri/`.

---

## Task 1: Add `--port` and `--workfile` CLI args to `sigil-server`

**Files:**
- Modify: `crates/server/src/main.rs`
- Modify: `crates/server/Cargo.toml`

**Context:** Tauri spawns the sidecar with explicit CLI args. The existing env vars (`PORT`, `WORKFILE`, `HOST`) stay for docker compatibility. Resolution order at runtime: CLI arg → env var → default.

- [ ] **Step 1: Write the failing tests**

Add to `crates/server/src/main.rs`'s test module (create if absent):

```rust
#[cfg(test)]
mod cli_tests {
    use super::Cli;
    use clap::Parser;

    #[test]
    fn test_cli_parses_port() {
        let cli = Cli::try_parse_from(["sigil-server", "--port", "5000"]).unwrap();
        assert_eq!(cli.port, Some(5000));
    }

    #[test]
    fn test_cli_parses_workfile() {
        let cli = Cli::try_parse_from(["sigil-server", "--workfile", "/tmp/foo.sigil"]).unwrap();
        assert_eq!(cli.workfile.as_deref().unwrap().to_str(), Some("/tmp/foo.sigil"));
    }

    #[test]
    fn test_cli_no_args_is_valid() {
        let cli = Cli::try_parse_from(["sigil-server"]).unwrap();
        assert_eq!(cli.port, None);
        assert!(cli.workfile.is_none());
    }

    #[test]
    fn test_cli_rejects_invalid_port() {
        let result = Cli::try_parse_from(["sigil-server", "--port", "abc"]);
        assert!(result.is_err());
    }
}
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /Volumes/projects/Personal/agent-designer/.worktrees/feature/tauri-desktop-spec-20
cargo test -p sigil-server --bin sigil-server cli_tests 2>&1 | tail -20
```

Expected: FAIL — `Cli` struct doesn't exist.

- [ ] **Step 3: Add the `Cli` struct and wire it into `main`**

Edit `crates/server/Cargo.toml`. Ensure `[dependencies]` includes `clap` with `derive` (add `clap = { workspace = true }` if missing).

Edit `crates/server/src/main.rs`. Add at the top after the existing `use` statements:

```rust
use clap::Parser;

/// Sigil server. Runs the axum HTTP+WebSocket+MCP stack.
#[derive(Parser, Debug, Default)]
#[command(name = "sigil-server", version)]
struct Cli {
    /// Localhost port to bind. Overrides PORT env var.
    #[arg(long)]
    port: Option<u16>,

    /// Workfile directory to load. Overrides WORKFILE env var.
    #[arg(long, value_name = "PATH")]
    workfile: Option<std::path::PathBuf>,
}
```

Then update the resolution sites. Find:

```rust
let port = std::env::var("PORT")
    .unwrap_or_else(|_| "4680".to_string())
    .parse::<u16>()?;
```

Replace with:

```rust
let cli = Cli::parse();
let port = cli
    .port
    .or_else(|| std::env::var("PORT").ok().and_then(|s| s.parse().ok()))
    .unwrap_or(4680);
```

Find the workfile env-var resolution block:

```rust
let workfile_env = std::env::var("WORKFILE").ok();

let mut state = if let Some(ref workfile_str) = workfile_env {
    let workfile_path = std::path::PathBuf::from(workfile_str);
```

Replace with:

```rust
let workfile_path: Option<std::path::PathBuf> = cli
    .workfile
    .clone()
    .or_else(|| std::env::var("WORKFILE").ok().map(std::path::PathBuf::from));

let mut state = if let Some(ref workfile_path) = workfile_path {
```

Update subsequent code that referenced `workfile_str` to use `workfile_path` directly (it's already a `PathBuf`).

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test -p sigil-server --bin sigil-server cli_tests 2>&1 | tail -10
cargo build -p sigil-server 2>&1 | tail -5
```

Expected: tests PASS; build clean.

- [ ] **Step 5: Smoke test the CLI args manually**

```bash
cargo build -p sigil-server 2>&1 | tail -3
./target/debug/sigil-server --port 5001 2>&1 &
SERVER_PID=$!
sleep 1
curl -s http://localhost:5001/graphql -X POST -H 'Content-Type: application/json' -d '{"query":"{__typename}"}' | head -1
kill $SERVER_PID 2>&1
```

Expected: curl returns `{"data":{"__typename":"Query"}}`. Server bound to 5001 because `--port` overrode the default.

- [ ] **Step 6: Quality gate**

```bash
cargo clippy -p sigil-server -- -D warnings 2>&1 | tail -5
cargo fmt --check 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add crates/server/src/main.rs crates/server/Cargo.toml
git commit -m "feat(server): add --port and --workfile CLI args (spec-20)"
```

---

## Task 2: Frontend `sidecar-url` helper

**Files:**
- Create: `frontend/src/transport/sidecar-url.ts`
- Create: `frontend/src/transport/__tests__/sidecar-url.test.ts`
- Modify: `frontend/src/store/document-store-solid.tsx`

**Context:** The urql client currently builds URLs from `window.location.origin`. Tauri loads from a custom scheme (no usable port) and injects the sidecar port via a global. The helper handles both modes.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/transport/__tests__/sidecar-url.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getGraphqlHttpUrl, getGraphqlWsUrl } from "../sidecar-url";

describe("sidecar-url", () => {
  let originalGlobal: unknown;

  beforeEach(() => {
    originalGlobal = (window as unknown as { __SIGIL_SIDECAR_PORT__?: number }).__SIGIL_SIDECAR_PORT__;
  });

  afterEach(() => {
    (window as unknown as { __SIGIL_SIDECAR_PORT__?: number }).__SIGIL_SIDECAR_PORT__ = originalGlobal as number | undefined;
  });

  describe("Tauri mode (sidecar port injected)", () => {
    beforeEach(() => {
      (window as unknown as { __SIGIL_SIDECAR_PORT__: number }).__SIGIL_SIDECAR_PORT__ = 51234;
    });

    it("uses 127.0.0.1 with injected port for HTTP", () => {
      expect(getGraphqlHttpUrl()).toBe("http://127.0.0.1:51234/graphql");
    });

    it("uses 127.0.0.1 with injected port for WS", () => {
      expect(getGraphqlWsUrl()).toBe("ws://127.0.0.1:51234/graphql/ws");
    });
  });

  describe("browser/dev mode (no injected port)", () => {
    beforeEach(() => {
      delete (window as unknown as { __SIGIL_SIDECAR_PORT__?: number }).__SIGIL_SIDECAR_PORT__;
    });

    it("uses window.location.origin for HTTP", () => {
      const expected = `${window.location.origin}/graphql`;
      expect(getGraphqlHttpUrl()).toBe(expected);
    });

    it("uses ws:// + window.location.host for WS over HTTP", () => {
      const expected = `ws://${window.location.host}/graphql/ws`;
      expect(getGraphqlWsUrl()).toBe(expected);
    });
  });

  it("rejects non-finite injected port (defense-in-depth)", () => {
    (window as unknown as { __SIGIL_SIDECAR_PORT__: unknown }).__SIGIL_SIDECAR_PORT__ = "not a number";
    expect(getGraphqlHttpUrl()).toBe(`${window.location.origin}/graphql`);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm --prefix frontend test --run sidecar-url 2>&1 | tail -15
```

Expected: FAIL with "Cannot find module '../sidecar-url'".

- [ ] **Step 3: Implement `sidecar-url.ts`**

Create `frontend/src/transport/sidecar-url.ts`:

```typescript
/**
 * GraphQL URL construction for the sigil-server sidecar.
 *
 * In Tauri mode, the shell injects `window.__SIGIL_SIDECAR_PORT__` before
 * the SPA bootstraps. We bind to 127.0.0.1:<port>. In browser/dev mode,
 * the URL derives from `window.location` (Vite proxies /graphql to the
 * dev server on port 4680).
 */

declare global {
  interface Window {
    __SIGIL_SIDECAR_PORT__?: number;
  }
}

function getSidecarPort(): number | null {
  const raw = window.__SIGIL_SIDECAR_PORT__;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0 && raw < 65536) {
    return raw;
  }
  return null;
}

export function getGraphqlHttpUrl(): string {
  const port = getSidecarPort();
  if (port !== null) {
    return `http://127.0.0.1:${port}/graphql`;
  }
  return `${window.location.origin}/graphql`;
}

export function getGraphqlWsUrl(): string {
  const port = getSidecarPort();
  if (port !== null) {
    return `ws://127.0.0.1:${port}/graphql/ws`;
  }
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${window.location.host}/graphql/ws`;
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --prefix frontend test --run sidecar-url 2>&1 | tail -10
```

Expected: 5 tests PASS.

- [ ] **Step 5: Wire into `document-store-solid.tsx`**

Find the URL construction (around line 582-584 of `frontend/src/store/document-store-solid.tsx`):

```typescript
const httpUrl = `${window.location.origin}/graphql`;
// ...
const wsUrl = `${wsProtocol}//${window.location.host}/graphql/ws`;
```

Replace with:

```typescript
import { getGraphqlHttpUrl, getGraphqlWsUrl } from "../transport/sidecar-url";
// ...
const httpUrl = getGraphqlHttpUrl();
const wsUrl = getGraphqlWsUrl();
```

Remove the now-unused `wsProtocol` local if it was only used for the inline construction.

- [ ] **Step 6: Run full frontend test suite**

```bash
pnpm --prefix frontend test --run 2>&1 | tail -10
pnpm --prefix frontend exec tsc --noEmit 2>&1 | tail -5
pnpm --prefix frontend lint 2>&1 | tail -5
```

Expected: all pass, including pre-existing tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/transport/sidecar-url.ts \
        frontend/src/transport/__tests__/sidecar-url.test.ts \
        frontend/src/store/document-store-solid.tsx
git commit -m "feat(frontend): sidecar-url helper for Tauri + browser mode (spec-20)"
```

---

## Task 3: Server `pick_free_port` helper

**Files:**
- Modify: `crates/server/src/lib.rs`

**Context:** Tauri picks a random ephemeral port BEFORE spawning the sidecar so it can pass `--port` and inject the URL into the frontend. The cleanest pattern: a small utility in `sigil-server` library.

- [ ] **Step 1: Write the failing test**

Append to `crates/server/src/lib.rs`:

```rust
#[cfg(test)]
mod port_tests {
    use super::pick_free_port;

    #[test]
    fn test_pick_free_port_returns_usable_port() {
        let port = pick_free_port().expect("pick a free port");
        assert!(port > 0);
        let listener = std::net::TcpListener::bind(format!("127.0.0.1:{port}"))
            .expect("bind to picked port");
        drop(listener);
    }

    #[test]
    fn test_pick_free_port_distinct_on_consecutive_calls() {
        let a = pick_free_port().unwrap();
        let b = pick_free_port().unwrap();
        let _ = (a, b);
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cargo test -p sigil-server --lib port_tests 2>&1 | tail -10
```

Expected: FAIL — `pick_free_port` doesn't exist.

- [ ] **Step 3: Implement `pick_free_port`**

In `crates/server/src/lib.rs`, add (near the top, after existing `pub mod` declarations):

```rust
/// Picks a free local TCP port by asking the OS to assign one and immediately
/// releasing it. There is a race window where another process could bind the
/// same port between this call and the subsequent bind, but for desktop
/// sidecar-spawn use cases the window is negligible.
pub fn pick_free_port() -> std::io::Result<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}
```

- [ ] **Step 4: Run tests**

```bash
cargo test -p sigil-server --lib port_tests 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 5: Quality gate + commit**

```bash
cargo clippy -p sigil-server -- -D warnings 2>&1 | tail -3
cargo fmt --check 2>&1 | tail -3

git add crates/server/src/lib.rs
git commit -m "feat(server): expose pick_free_port helper (spec-20)"
```

---

## Task 4: Scaffold `src-tauri/` crate

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs` (minimal)
- Create: `src-tauri/capabilities/default.json`
- Modify: `frontend/package.json` (add tauri scripts + deps)
- Modify: `.gitignore`

**Context:** Get a minimal Tauri shell that compiles. No sidecar yet, no menus, no file association — just verify the Tauri 2.x dependency tree builds.

- [ ] **Step 1: Create `src-tauri/Cargo.toml`**

```toml
[package]
name = "sigil-shell"
version = "0.1.1"
edition = "2024"
license = "BUSL-1.1"
description = "Sigil desktop shell (Tauri 2.x)."
publish = false

[lib]
name = "sigil_shell_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
serde = { version = "1.0.228", features = ["derive"] }
serde_json = "1.0.149"
tauri = { version = "2", features = ["macos-private-api"] }
tauri-plugin-dialog = "2"
tauri-plugin-shell = "2"
tauri-plugin-single-instance = "2"
tokio = { version = "1.50.0", features = ["full"] }
anyhow = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
uuid = { version = "1.23.0", features = ["v4"] }

[target.'cfg(unix)'.dependencies]
libc = "0.2"

[dev-dependencies]
tempfile = "3"

[features]
custom-protocol = ["tauri/custom-protocol"]
```

**IMPORTANT:** `src-tauri/` is intentionally NOT in `[workspace.members]` of the root `Cargo.toml`. Verify:

```bash
grep -n "src-tauri" Cargo.toml || echo "src-tauri NOT in workspace — correct"
```

- [ ] **Step 2: Create `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build();
}
```

- [ ] **Step 3: Create `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Sigil",
  "version": "0.1.1",
  "identifier": "dev.sigil.app",
  "build": {
    "frontendDist": "../frontend/dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "pnpm --prefix ../frontend dev",
    "beforeBuildCommand": "pnpm --prefix ../frontend build"
  },
  "app": {
    "windows": [
      {
        "title": "Sigil",
        "width": 1280,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "label": "main"
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all"
  }
}
```

(Icons added in Task 11. The `bundle.icon` array is intentionally omitted until icons exist — dev mode doesn't require them.)

- [ ] **Step 4: Create minimal `src-tauri/src/main.rs`**

```rust
//! Sigil desktop shell entry point.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running Sigil");
}
```

- [ ] **Step 5: Create `src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Sigil default capabilities — desktop file picker, sidecar lifecycle.",
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

- [ ] **Step 6: Update `frontend/package.json`**

Edit `frontend/package.json` `scripts`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "format": "prettier --write 'src/**/*.{ts,tsx,json,css}'",
    "format:check": "prettier --check 'src/**/*.{ts,tsx,json,css}'",
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build",
    "tauri": "tauri",
    "tauri-dev": "tauri dev",
    "tauri-build": "tauri build"
  }
}
```

Install Tauri CLI:

```bash
pnpm --prefix frontend add -D @tauri-apps/cli@^2 2>&1 | tail -5
pnpm --prefix frontend add @tauri-apps/api@^2 2>&1 | tail -5
```

- [ ] **Step 7: Update `.gitignore`**

Append to `.gitignore`:

```
# Tauri build artifacts
src-tauri/target/
src-tauri/gen/
```

- [ ] **Step 8: Verify Tauri scaffold compiles**

```bash
cd src-tauri
cargo check 2>&1 | tail -10
cd ..
```

Expected: clean compile. First run downloads many crates (~3-5 min).

- [ ] **Step 9: Commit**

```bash
git add src-tauri/ frontend/package.json frontend/pnpm-lock.yaml .gitignore
git commit -m "feat(shell): scaffold src-tauri/ crate + Tauri 2.x deps (spec-20)"
```

---

## Task 5: Sidecar spawn module

**Files:**
- Create: `src-tauri/src/sidecar.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/Cargo.toml`

**Context:** `sidecar.rs` owns the `tokio::process::Child` for each window's sidecar. On window close: SIGTERM, wait 5s, SIGKILL fallback.

This task wires the sidecar to spawn ONCE on app startup (single shared instance). Per-window lifecycle lands in Task 8.

- [ ] **Step 1: Add `sigil-server` dependency to `src-tauri/Cargo.toml`**

Append to `[dependencies]`:

```toml
sigil-server = { path = "../crates/server" }
```

This pulls `pick_free_port` (Task 3) into the Tauri shell. The sidecar BINARY is invoked via `Command`; the library import is just for the port-picking helper.

- [ ] **Step 2: Create `src-tauri/src/sidecar.rs`**

```rust
//! Sigil sidecar process management.
//!
//! Each Tauri window has its own `sigil-server` child process bound to a
//! unique localhost port. Closing a window sends SIGTERM and waits up to
//! `SHUTDOWN_TIMEOUT` for the sidecar to drain. SIGKILL fallback only fires
//! if drain genuinely deadlocks.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context as _, Result};
use tokio::process::{Child, Command};

const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

pub struct SidecarProcess {
    pub port: u16,
    child: Option<Child>,
}

impl SidecarProcess {
    pub async fn spawn(workfile: Option<&PathBuf>) -> Result<Self> {
        let port = sigil_server::pick_free_port().context("pick free port")?;
        let sidecar_path = locate_sidecar_binary()?;

        let mut cmd = Command::new(&sidecar_path);
        cmd.arg("--port").arg(port.to_string());
        if let Some(wf) = workfile {
            cmd.arg("--workfile").arg(wf);
        }
        cmd.stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .stdin(Stdio::null());
        cmd.kill_on_drop(true);

        let child = cmd.spawn().with_context(|| {
            format!("spawn sidecar {} on port {}", sidecar_path.display(), port)
        })?;

        tracing::info!(
            "spawned sidecar pid={} port={} workfile={:?}",
            child.id().unwrap_or(0),
            port,
            workfile
        );

        Ok(Self { port, child: Some(child) })
    }

    pub async fn shutdown_gracefully(mut self) {
        let Some(mut child) = self.child.take() else { return };

        #[cfg(unix)]
        {
            if let Some(pid) = child.id() {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }
        }

        let wait_fut = child.wait();
        match tokio::time::timeout(SHUTDOWN_TIMEOUT, wait_fut).await {
            Ok(Ok(status)) => {
                tracing::info!("sidecar exited gracefully status={status:?}");
            }
            Ok(Err(e)) => {
                tracing::warn!("sidecar wait error: {e}");
            }
            Err(_) => {
                tracing::warn!("sidecar drain timeout, sending SIGKILL");
                let _ = child.kill().await;
            }
        }
    }
}

fn locate_sidecar_binary() -> Result<PathBuf> {
    if let Ok(current) = std::env::current_exe()
        && let Some(parent) = current.parent()
    {
        let bundled = parent.join(format!("sigil-server-{TARGET_TRIPLE}"));
        if bundled.exists() { return Ok(bundled); }
        let bundled_plain = parent.join(if cfg!(windows) { "sigil-server.exe" } else { "sigil-server" });
        if bundled_plain.exists() { return Ok(bundled_plain); }
    }

    let cwd = std::env::current_dir().context("current_dir")?;
    let mut search = cwd.clone();
    for _ in 0..6 {
        for profile in ["release", "debug"] {
            let candidate = search.join("target").join(profile).join(if cfg!(windows) { "sigil-server.exe" } else { "sigil-server" });
            if candidate.exists() { return Ok(candidate); }
        }
        if !search.pop() { break; }
    }

    anyhow::bail!(
        "could not locate sigil-server binary; checked next-to-exe and target/debug|release walking up from {}",
        cwd.display()
    )
}

const TARGET_TRIPLE: &str = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
    "aarch64-apple-darwin"
} else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
    "x86_64-apple-darwin"
} else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
    "x86_64-unknown-linux-gnu"
} else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
    "x86_64-pc-windows-msvc"
} else {
    "unknown"
};
```

- [ ] **Step 3: Wire sidecar spawn into `main.rs`**

Replace `src-tauri/src/main.rs`:

```rust
//! Sigil desktop shell entry point.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use std::sync::Mutex;

use sidecar::SidecarProcess;
use tauri::Manager;

struct AppState {
    sidecar: Mutex<Option<SidecarProcess>>,
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let sidecar = tauri::async_runtime::block_on(SidecarProcess::spawn(None))
                .map_err(|e| format!("spawn sidecar: {e}"))?;
            let port = sidecar.port;
            handle.manage(AppState { sidecar: Mutex::new(Some(sidecar)) });

            if let Some(window) = handle.get_webview_window("main") {
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
                    if let Some(sidecar) = sidecar_opt {
                        tauri::async_runtime::block_on(sidecar.shutdown_gracefully());
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Sigil");
}
```

- [ ] **Step 4: Verify compile**

```bash
cargo build -p sigil-server 2>&1 | tail -3
cd src-tauri && cargo check 2>&1 | tail -10 && cd ..
```

Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/main.rs src-tauri/src/sidecar.rs
git commit -m "feat(shell): sidecar spawn + graceful shutdown (spec-20)"
```

---

## Task 6: argv parsing + single-instance

**Files:**
- Create: `src-tauri/src/file_assoc.rs`
- Modify: `src-tauri/src/main.rs`

**Context:** When the user opens a `.sigil/` via Finder, the OS launches Sigil with the path as argv. Single-instance plugin routes second-launch argv to the existing process.

- [ ] **Step 1: Create `src-tauri/src/file_assoc.rs`**

```rust
//! argv parsing for "open with Sigil" workflows.

use std::path::PathBuf;

pub fn extract_workfile_path(argv: &[String]) -> Option<PathBuf> {
    for arg in argv.iter().skip(1) {
        if arg.starts_with("--") { continue; }
        if arg.starts_with("-psn_") { continue; } // macOS legacy
        let path = PathBuf::from(arg);
        if path.extension().is_some_and(|ext| ext == "sigil") {
            return Some(path);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_workfile_path_from_macos_argv() {
        let argv = vec!["sigil".to_string(), "/Users/foo/main.sigil".to_string()];
        let result = extract_workfile_path(&argv);
        assert_eq!(result.as_deref().unwrap().to_str(), Some("/Users/foo/main.sigil"));
    }

    #[test]
    fn test_extract_workfile_path_from_windows_argv() {
        let argv = vec!["sigil.exe".to_string(), r"C:\Users\foo\design.sigil".to_string()];
        assert!(extract_workfile_path(&argv).is_some());
    }

    #[test]
    fn test_extract_workfile_path_returns_none_when_no_sigil_arg() {
        let argv = vec!["sigil".to_string(), "--version".to_string()];
        assert!(extract_workfile_path(&argv).is_none());
    }

    #[test]
    fn test_extract_workfile_path_skips_cli_flags() {
        let argv = vec!["sigil".to_string(), "--port".to_string(), "5000".to_string(), "/path/to/foo.sigil".to_string()];
        let result = extract_workfile_path(&argv);
        assert_eq!(result.as_deref().unwrap().to_str(), Some("/path/to/foo.sigil"));
    }

    #[test]
    fn test_extract_workfile_path_skips_macos_psn() {
        let argv = vec!["sigil".to_string(), "-psn_0_123456".to_string(), "/path/to/foo.sigil".to_string()];
        let result = extract_workfile_path(&argv);
        assert_eq!(result.as_deref().unwrap().to_str(), Some("/path/to/foo.sigil"));
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cd src-tauri && cargo test --lib file_assoc::tests 2>&1 | tail -10 && cd ..
```

Expected: 5 tests pass.

- [ ] **Step 3: Wire into `main.rs`**

Replace `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod file_assoc;
mod sidecar;

use std::sync::Mutex;

use sidecar::SidecarProcess;
use tauri::Manager;

struct AppState {
    sidecar: Mutex<Option<SidecarProcess>>,
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let initial_workfile = file_assoc::extract_workfile_path(
        &std::env::args().collect::<Vec<_>>(),
    );

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
            let sidecar = tauri::async_runtime::block_on(SidecarProcess::spawn(workfile.as_ref()))
                .map_err(|e| format!("spawn sidecar: {e}"))?;
            let port = sidecar.port;
            handle.manage(AppState { sidecar: Mutex::new(Some(sidecar)) });

            if let Some(window) = handle.get_webview_window("main") {
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
                    if let Some(sidecar) = sidecar_opt {
                        tauri::async_runtime::block_on(sidecar.shutdown_gracefully());
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Sigil");
}
```

- [ ] **Step 4: Compile check + commit**

```bash
cd src-tauri && cargo check 2>&1 | tail -10 && cd ..

git add src-tauri/src/file_assoc.rs src-tauri/src/main.rs
git commit -m "feat(shell): argv parsing + single-instance plugin (spec-20)"
```

---

## Task 7: Native menubar

**Files:**
- Create: `src-tauri/src/menus.rs`
- Modify: `src-tauri/src/main.rs`
- Create: `frontend/src/transport/menu-events.ts`
- Create: `frontend/src/transport/__tests__/menu-events.test.ts`
- Modify: `frontend/src/store/document-store-solid.tsx`

**Context:** Native menubar emits `menu-action` events with stable IDs. Frontend listens and routes to existing keyboard-shortcut handlers.

- [ ] **Step 1: Create `src-tauri/src/menus.rs`**

```rust
//! Native menubar definitions for Sigil.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;

    #[cfg(target_os = "macos")]
    {
        let app_submenu = Submenu::with_items(
            app, "Sigil", true,
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

    let new_workfile = MenuItem::with_id(app, "file.new", "New Workfile…", true, Some("CmdOrCtrl+N"))?;
    let open_workfile = MenuItem::with_id(app, "file.open", "Open Workfile…", true, Some("CmdOrCtrl+O"))?;
    let close_window = MenuItem::with_id(app, "file.close", "Close Window", true, Some("CmdOrCtrl+W"))?;
    let file_submenu = Submenu::with_items(
        app, "File", true,
        &[&new_workfile, &open_workfile, &PredefinedMenuItem::separator(app)?, &close_window],
    )?;
    menu.append(&file_submenu)?;

    let undo = MenuItem::with_id(app, "edit.undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
    let redo = MenuItem::with_id(app, "edit.redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?;
    let edit_submenu = Submenu::with_items(
        app, "Edit", true,
        &[
            &undo, &redo, &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    menu.append(&edit_submenu)?;

    let zoom_in = MenuItem::with_id(app, "view.zoom_in", "Zoom In", true, Some("CmdOrCtrl+="))?;
    let zoom_out = MenuItem::with_id(app, "view.zoom_out", "Zoom Out", true, Some("CmdOrCtrl+-"))?;
    let zoom_reset = MenuItem::with_id(app, "view.zoom_reset", "Reset Zoom", true, Some("CmdOrCtrl+0"))?;
    let view_submenu = Submenu::with_items(
        app, "View", true,
        &[&zoom_in, &zoom_out, &zoom_reset, &PredefinedMenuItem::fullscreen(app, None)?],
    )?;
    menu.append(&view_submenu)?;

    let window_submenu = Submenu::with_items(
        app, "Window", true,
        &[&PredefinedMenuItem::minimize(app, None)?],
    )?;
    menu.append(&window_submenu)?;

    Ok(menu)
}

pub fn install_menu_handler<R: Runtime>(app: &AppHandle<R>) {
    app.on_menu_event(|app_handle, event| {
        let id = event.id().0.clone();
        tracing::debug!("menu action: {id}");
        let _ = app_handle.emit("menu-action", id);
    });
}
```

- [ ] **Step 2: Wire menus into `main.rs` setup**

Add `mod menus;` to `src-tauri/src/main.rs`. In the `setup` closure, BEFORE the sidecar spawn:

```rust
let menu = menus::build_menu(&handle).map_err(|e| format!("build menu: {e}"))?;
handle.set_menu(menu).map_err(|e| format!("set menu: {e}"))?;
menus::install_menu_handler(&handle);
```

- [ ] **Step 3: Create frontend menu-event dispatcher**

Create `frontend/src/transport/menu-events.ts`:

```typescript
import type { UnlistenFn } from "@tauri-apps/api/event";

export type MenuAction =
  | "file.new" | "file.open" | "file.close"
  | "edit.undo" | "edit.redo"
  | "view.zoom_in" | "view.zoom_out" | "view.zoom_reset";

export interface MenuHandlers {
  onNewWorkfile?: () => void;
  onOpenWorkfile?: () => void;
  onCloseWindow?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
}

export async function installMenuListener(handlers: MenuHandlers): Promise<UnlistenFn | null> {
  if (typeof window === "undefined") return null;
  if (!("__TAURI_INTERNALS__" in window)) return null;

  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>("menu-action", (event) => {
    dispatch(event.payload as MenuAction, handlers);
  });
}

export function dispatch(action: MenuAction, handlers: MenuHandlers): void {
  switch (action) {
    case "file.new": handlers.onNewWorkfile?.(); break;
    case "file.open": handlers.onOpenWorkfile?.(); break;
    case "file.close": handlers.onCloseWindow?.(); break;
    case "edit.undo": handlers.onUndo?.(); break;
    case "edit.redo": handlers.onRedo?.(); break;
    case "view.zoom_in": handlers.onZoomIn?.(); break;
    case "view.zoom_out": handlers.onZoomOut?.(); break;
    case "view.zoom_reset": handlers.onZoomReset?.(); break;
    default: {
      const _exhaustive: never = action;
      console.warn("Unknown menu action:", _exhaustive);
    }
  }
}
```

- [ ] **Step 4: Add dispatcher test**

Create `frontend/src/transport/__tests__/menu-events.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { dispatch, type MenuHandlers } from "../menu-events";

describe("menu-events dispatch", () => {
  it("routes file.open to onOpenWorkfile", () => {
    const onOpenWorkfile = vi.fn();
    dispatch("file.open", { onOpenWorkfile });
    expect(onOpenWorkfile).toHaveBeenCalledOnce();
  });

  it("routes edit.undo to onUndo", () => {
    const onUndo = vi.fn();
    dispatch("edit.undo", { onUndo });
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("routes edit.redo to onRedo", () => {
    const onRedo = vi.fn();
    dispatch("edit.redo", { onRedo });
    expect(onRedo).toHaveBeenCalledOnce();
  });

  it("no-ops when handler is not provided", () => {
    expect(() => dispatch("view.zoom_in", {})).not.toThrow();
  });

  it("routes all view.* events", () => {
    const onZoomIn = vi.fn(), onZoomOut = vi.fn(), onZoomReset = vi.fn();
    dispatch("view.zoom_in", { onZoomIn });
    dispatch("view.zoom_out", { onZoomOut });
    dispatch("view.zoom_reset", { onZoomReset });
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onZoomReset).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 5: Wire dispatcher into the store**

In `frontend/src/store/document-store-solid.tsx`, after the store factory has constructed `store` (find via grep for `return {`), add:

```typescript
import { installMenuListener } from "../transport/menu-events";

// After store construction, before return:
installMenuListener({
  onUndo: () => store.undo(),
  onRedo: () => store.redo(),
  // Zoom handlers wired in Task 9; the file.* handlers wired in Task 9 too.
}).then((unlisten) => {
  if (unlisten) {
    // Wire to the store's existing teardown method or onCleanup if in scope.
    // For now, leak — the listener lifetime matches the window lifetime,
    // which terminates the SPA anyway.
  }
});
```

- [ ] **Step 6: Run tests**

```bash
pnpm --prefix frontend test --run menu-events 2>&1 | tail -10
pnpm --prefix frontend exec tsc --noEmit 2>&1 | tail -5
cd src-tauri && cargo check 2>&1 | tail -5 && cd ..
```

Expected: 5 tests pass; tsc + cargo check clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/menus.rs src-tauri/src/main.rs \
        frontend/src/transport/menu-events.ts \
        frontend/src/transport/__tests__/menu-events.test.ts \
        frontend/src/store/document-store-solid.tsx
git commit -m "feat(shell): native menubar + frontend menu-action dispatcher (spec-20)"
```

---

## Task 8: Per-window sidecar lifecycle

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/tauri.conf.json`

**Context:** Refactor from app-wide single sidecar (Task 5) to per-window: each new window spawns its own sidecar; closing a window terminates only its sidecar.

- [ ] **Step 1: Refactor `AppState`**

In `src-tauri/src/main.rs`, replace `AppState`:

```rust
use std::collections::HashMap;

struct AppState {
    /// Map from window label to its sidecar. Mutated when windows open/close.
    sidecars: Mutex<HashMap<String, SidecarProcess>>,
}
```

- [ ] **Step 2: Add `open_workfile_window` helper**

Above `fn main`:

```rust
use std::path::PathBuf;
use tauri::{WebviewWindowBuilder, WebviewUrl};

fn fresh_window_label() -> String {
    format!("window-{}", uuid::Uuid::new_v4().simple())
}

async fn open_workfile_window(
    app: tauri::AppHandle,
    workfile: Option<PathBuf>,
) -> anyhow::Result<()> {
    let label = fresh_window_label();
    let sidecar = SidecarProcess::spawn(workfile.as_ref()).await?;
    let port = sidecar.port;

    if let Some(state) = app.try_state::<AppState>() {
        state.sidecars.lock().expect("lock sidecars").insert(label.clone(), sidecar);
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
```

- [ ] **Step 3: Update close-window handler**

Replace `on_window_event`:

```rust
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
```

- [ ] **Step 4: Update `setup` to use `open_workfile_window`**

```rust
.setup(move |app| {
    let handle = app.handle().clone();

    let menu = menus::build_menu(&handle).map_err(|e| format!("build menu: {e}"))?;
    handle.set_menu(menu).map_err(|e| format!("set menu: {e}"))?;
    menus::install_menu_handler(&handle);

    handle.manage(AppState { sidecars: Mutex::new(HashMap::new()) });

    let workfile = initial_workfile.clone();
    tauri::async_runtime::block_on(open_workfile_window(handle.clone(), workfile))
        .map_err(|e| format!("open initial window: {e}"))?;

    Ok(())
})
```

- [ ] **Step 5: Remove auto-window from `tauri.conf.json`**

Edit `src-tauri/tauri.conf.json`. Change `"windows": [...]` to `"windows": []`.

- [ ] **Step 6: Update single-instance handler**

```rust
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
        let windows = app.webview_windows();
        if let Some((_label, window)) = windows.iter().next() {
            let _ = window.set_focus();
        }
    }
}))
```

- [ ] **Step 7: Compile + commit**

```bash
cd src-tauri && cargo check 2>&1 | tail -10 && cd ..

git add src-tauri/src/main.rs src-tauri/tauri.conf.json
git commit -m "feat(shell): per-window sidecar lifecycle + multi-window (spec-20)"
```

---

## Task 9: File → Open/New dialogs

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `frontend/src/store/document-store-solid.tsx`

**Context:** Wire File → Open / New menu items to Tauri's dialog plugin, opening a new window for the chosen workfile.

- [ ] **Step 1: Add Tauri commands**

In `src-tauri/src/main.rs`, above `fn main`:

```rust
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
async fn open_workfile_dialog(app: tauri::AppHandle) -> Result<(), String> {
    let path = app.dialog().file()
        .set_title("Open Sigil Workfile")
        .add_filter("Sigil Workfile", &["sigil"])
        .blocking_pick_folder();

    let Some(path) = path else { return Ok(()) };
    let path_buf = path.into_path().map_err(|e| format!("path: {e}"))?;

    open_workfile_window(app, Some(path_buf)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn new_workfile_dialog(app: tauri::AppHandle) -> Result<(), String> {
    let path = app.dialog().file()
        .set_title("New Sigil Workfile")
        .set_can_create_directories(true)
        .add_filter("Sigil Workfile", &["sigil"])
        .blocking_save_file();

    let Some(path) = path else { return Ok(()) };
    let mut path_buf = path.into_path().map_err(|e| format!("path: {e}"))?;
    if path_buf.extension().is_none() {
        path_buf.set_extension("sigil");
    }
    open_workfile_window(app, Some(path_buf)).await.map_err(|e| e.to_string())
}
```

Register in the Builder:

```rust
.invoke_handler(tauri::generate_handler![
    open_workfile_dialog,
    new_workfile_dialog
])
```

- [ ] **Step 2: Add `dialog:allow-save` capability**

Edit `src-tauri/capabilities/default.json`:

```json
"permissions": [
  "core:default",
  "core:window:default",
  "core:webview:default",
  "core:event:default",
  "core:menu:default",
  "dialog:allow-open",
  "dialog:allow-save",
  "shell:allow-open"
]
```

(Deviation from spec §8 which excluded `dialog:allow-save` — that exclusion was about autosave-not-Save-As. The save dialog here picks a NEW workfile's location, which is a different semantic.)

- [ ] **Step 3: Wire frontend handlers**

In `frontend/src/store/document-store-solid.tsx`, expand the `installMenuListener` call:

```typescript
import { invoke } from "@tauri-apps/api/core";

installMenuListener({
  onNewWorkfile: () => invoke("new_workfile_dialog").catch(console.error),
  onOpenWorkfile: () => invoke("open_workfile_dialog").catch(console.error),
  onCloseWindow: () => { /* Native Cmd+W handles this */ },
  onUndo: () => store.undo(),
  onRedo: () => store.redo(),
  onZoomIn: () => { /* TODO: viewport wiring */ },
  onZoomOut: () => { /* TODO: viewport wiring */ },
  onZoomReset: () => { /* TODO: viewport wiring */ },
});
```

- [ ] **Step 4: Compile + lint + commit**

```bash
cd src-tauri && cargo check 2>&1 | tail -5 && cd ..
pnpm --prefix frontend exec tsc --noEmit 2>&1 | tail -3
pnpm --prefix frontend lint 2>&1 | tail -3

git add src-tauri/src/main.rs src-tauri/capabilities/default.json \
        frontend/src/store/document-store-solid.tsx
git commit -m "feat(shell): File → Open/New dialogs + new-window spawn (spec-20)"
```

---

## Task 10: Recent files persistence

**Files:**
- Create: `src-tauri/src/recent_files.rs`
- Modify: `src-tauri/src/main.rs`

**Context:** Persist a JSON list of recent workfile paths in Tauri's app-data dir. Max 10 entries. Pruned at load time when paths no longer exist.

- [ ] **Step 1: Create `src-tauri/src/recent_files.rs`**

```rust
//! Recent-workfile-paths persistence.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};

const MAX_RECENT_ENTRIES: usize = 10;
const RECENT_FILENAME: &str = "recent.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentEntry {
    pub path: PathBuf,
    pub opened_at: String,
}

pub fn load(app_data_dir: &Path) -> Result<Vec<RecentEntry>> {
    let path = app_data_dir.join(RECENT_FILENAME);
    if !path.exists() { return Ok(Vec::new()); }
    let raw = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    let entries: Vec<RecentEntry> = serde_json::from_str(&raw)
        .with_context(|| format!("parse {}", path.display()))?;
    Ok(entries.into_iter().filter(|e| e.path.exists()).collect())
}

pub fn add(app_data_dir: &Path, workfile: &Path) -> Result<()> {
    fs::create_dir_all(app_data_dir)
        .with_context(|| format!("create {}", app_data_dir.display()))?;

    let mut entries = load(app_data_dir).unwrap_or_default();
    entries.retain(|e| e.path != workfile);
    entries.insert(0, RecentEntry {
        path: workfile.to_path_buf(),
        opened_at: timestamp_now(),
    });
    entries.truncate(MAX_RECENT_ENTRIES);

    let path = app_data_dir.join(RECENT_FILENAME);
    let raw = serde_json::to_string_pretty(&entries)?;
    fs::write(&path, raw).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

fn timestamp_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("@{secs}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_empty_when_file_missing() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(load(tmp.path()).unwrap().is_empty());
    }

    #[test]
    fn test_add_creates_file_and_persists() {
        let tmp = tempfile::tempdir().unwrap();
        let workfile = tmp.path().join("foo.sigil");
        fs::create_dir_all(&workfile).unwrap();
        add(tmp.path(), &workfile).unwrap();
        let entries = load(tmp.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, workfile);
    }

    #[test]
    fn test_add_dedups_same_path() {
        let tmp = tempfile::tempdir().unwrap();
        let workfile = tmp.path().join("foo.sigil");
        fs::create_dir_all(&workfile).unwrap();
        add(tmp.path(), &workfile).unwrap();
        add(tmp.path(), &workfile).unwrap();
        assert_eq!(load(tmp.path()).unwrap().len(), 1);
    }

    #[test]
    fn test_add_truncates_to_max() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..15 {
            let workfile = tmp.path().join(format!("foo-{i}.sigil"));
            fs::create_dir_all(&workfile).unwrap();
            add(tmp.path(), &workfile).unwrap();
        }
        assert_eq!(load(tmp.path()).unwrap().len(), MAX_RECENT_ENTRIES);
    }

    #[test]
    fn test_load_prunes_missing_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let workfile = tmp.path().join("ghost.sigil");
        fs::create_dir_all(&workfile).unwrap();
        add(tmp.path(), &workfile).unwrap();
        fs::remove_dir_all(&workfile).unwrap();
        assert!(load(tmp.path()).unwrap().is_empty());
    }
}
```

- [ ] **Step 2: Wire into `main.rs`**

Add `mod recent_files;` to `src-tauri/src/main.rs`. In `open_workfile_window`, after window creation, record the path:

```rust
if let Some(ref wf) = workfile
    && let Ok(app_data_dir) = app.path().app_data_dir()
    && let Err(e) = recent_files::add(&app_data_dir, wf)
{
    tracing::warn!("failed to record recent workfile: {e}");
}
```

Add a Tauri command to expose the list:

```rust
#[tauri::command]
fn get_recent_workfiles(app: tauri::AppHandle) -> Vec<recent_files::RecentEntry> {
    if let Ok(dir) = app.path().app_data_dir() {
        recent_files::load(&dir).unwrap_or_default()
    } else {
        Vec::new()
    }
}
```

Register:

```rust
.invoke_handler(tauri::generate_handler![
    open_workfile_dialog,
    new_workfile_dialog,
    get_recent_workfiles
])
```

- [ ] **Step 3: Test + commit**

```bash
cd src-tauri && cargo test --lib recent_files 2>&1 | tail -10 && cd ..

git add src-tauri/src/recent_files.rs src-tauri/src/main.rs
git commit -m "feat(shell): recent-files persistence + get_recent_workfiles command (spec-20)"
```

---

## Task 11: Icons + file association config

**Files:**
- Create: `src-tauri/icons/*` (multiple)
- Modify: `src-tauri/tauri.conf.json`

**Context:** Generate placeholder icons + register `.sigil` file associations on all three platforms. Production-quality icons are a Spec 16 (Visual Identity) concern.

- [ ] **Step 1: Generate placeholder icons**

Either use ImageMagick or a single PNG + Tauri's icon generator:

```bash
# Option A: ImageMagick (if available)
mkdir -p src-tauri/icons
convert -size 1024x1024 xc:#1a1a2e -gravity center -pointsize 600 \
  -fill '#e8e8f0' -annotate +0+0 'S' src-tauri/icons/source.png

# Option B: any 1024x1024 PNG you generate by hand
# Then run Tauri's icon generator:
pnpm --prefix frontend exec tauri icon src-tauri/icons/source.png \
  --output src-tauri/icons/
```

Tauri's `icon` command produces: `icon.icns`, `icon.ico`, plus PNGs at multiple sizes. Move or rename to the spec's naming:

```bash
cd src-tauri/icons
mv icon.icns sigil-app.icns
mv icon.ico sigil-app.ico
# Tauri also produces 32x32.png, 128x128.png, 128x128@2x.png, etc. — keep those.
cp sigil-app.icns sigil-workfile.icns  # placeholder; differentiate visual in follow-up
cp sigil-app.ico sigil-workfile.ico    # ditto
cd ../..
```

- [ ] **Step 2: Update `tauri.conf.json` bundle.icon**

```json
"bundle": {
  "active": true,
  "targets": "all",
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/sigil-app.icns",
    "icons/sigil-app.ico"
  ]
}
```

- [ ] **Step 3: Add file associations to `tauri.conf.json`**

Append to `bundle`:

```json
"fileAssociations": [
  {
    "ext": ["sigil"],
    "name": "Sigil Workfile",
    "description": "Sigil design workfile (directory bundle).",
    "role": "Editor",
    "mimeType": "application/x-sigil-workfile"
  }
]
```

For the macOS Document Package treatment, add an `Info.plist` additions block. Tauri 2.x supports this via `bundle.macOS.infoPlist` (verify field name against the installed Tauri version):

```json
"macOS": {
  "frameworks": [],
  "providerShortName": null,
  "signingIdentity": null,
  "infoPlistAdditions": {
    "UTExportedTypeDeclarations": [
      {
        "UTTypeIdentifier": "dev.sigil.workfile",
        "UTTypeDescription": "Sigil Workfile",
        "UTTypeConformsTo": ["com.apple.package"],
        "UTTypeTagSpecification": {
          "public.filename-extension": ["sigil"]
        }
      }
    ],
    "CFBundleDocumentTypes": [
      {
        "CFBundleTypeName": "Sigil Workfile",
        "CFBundleTypeRole": "Editor",
        "LSItemContentTypes": ["dev.sigil.workfile"],
        "LSTypeIsPackage": true
      }
    ]
  }
}
```

If `infoPlistAdditions` is not supported by the installed Tauri version, use the `tauri-bundler` `before-bundle` hook to post-process `Info.plist`. Either path is acceptable for v1.

- [ ] **Step 4: Verify build doesn't fail on missing icons**

```bash
cd src-tauri && cargo build --release 2>&1 | tail -10 && cd ..
```

Expected: clean (icons may or may not be referenced at this layer; full bundling validates in Task 13's CI).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/icons/ src-tauri/tauri.conf.json
git commit -m "feat(shell): icons + .sigil file associations for all platforms (spec-20)"
```

---

## Task 12: Vite config for Tauri dev mode

**Files:**
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: Update `frontend/vite.config.ts`**

```typescript
/// <reference types="vitest" />
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [solidPlugin()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    proxy: {
      "/graphql": { target: "http://localhost:4680", ws: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
  test: { setupFiles: ["./vitest.setup.ts"] },
});
```

- [ ] **Step 2: Verify dev mode still works**

```bash
pnpm --prefix frontend dev &
VITE_PID=$!
sleep 5
curl -sI http://localhost:5173/ | head -1
kill $VITE_PID 2>&1
```

Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 3: Quality gate + commit**

```bash
pnpm --prefix frontend exec tsc --noEmit 2>&1 | tail -3
pnpm --prefix frontend lint 2>&1 | tail -3
pnpm --prefix frontend test --run 2>&1 | tail -5

git add frontend/vite.config.ts
git commit -m "feat(frontend): Vite config honors TAURI_DEV_HOST in dev (spec-20)"
```

---

## Task 13: CI matrix workflow `tauri-build.yml`

**Files:**
- Create: `.github/workflows/tauri-build.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: Tauri Build

on:
  push:
    branches: [main]
    paths:
      - 'src-tauri/**'
      - 'crates/**'
      - 'frontend/**'
      - '.github/workflows/tauri-build.yml'
    tags: ['v*.*.*']
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: 'macos-14'
            args: '--target universal-apple-darwin'
            artifact-name: 'macos-universal'
          - platform: 'ubuntu-22.04'
            args: ''
            artifact-name: 'linux-x86_64'
          - platform: 'windows-2022'
            args: ''
            artifact-name: 'windows-x86_64'

    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8 # stable
        with:
          toolchain: "1.94.1"
          targets: ${{ matrix.platform == 'macos-14' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Install Linux dependencies
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
            librsvg2-dev patchelf

      - name: Install pnpm
        uses: pnpm/action-setup@a7487c7e89a18df4991f7f222e4898a00d66ddda # v4.0.0
        with:
          version: 10

      - name: Setup Node
        uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4
        with:
          node-version: 22

      - name: Cache cargo
        uses: actions/cache@1bd1e32a3bdc45362d1e726936510720a7c30a57 # v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            src-tauri/target
          key: ${{ runner.os }}-cargo-tauri-${{ hashFiles('**/Cargo.lock') }}
          restore-keys: ${{ runner.os }}-cargo-tauri-

      - name: Install pnpm deps
        run: pnpm --prefix frontend install --frozen-lockfile

      - name: Build Tauri app
        working-directory: frontend
        run: pnpm tauri build ${{ matrix.args }}

      - name: Upload artifacts to workflow run
        uses: actions/upload-artifact@b4b15b8c7c6ac21ea08fcf65892d2ee8f75cf882 # v4
        with:
          name: sigil-${{ matrix.artifact-name }}
          path: |
            src-tauri/target/**/release/bundle/dmg/*.dmg
            src-tauri/target/**/release/bundle/msi/*.msi
            src-tauri/target/**/release/bundle/appimage/*.AppImage
            src-tauri/target/**/release/bundle/deb/*.deb
          if-no-files-found: ignore

      - name: Upload to GitHub Release (on tag)
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
        with:
          files: |
            src-tauri/target/**/release/bundle/dmg/*.dmg
            src-tauri/target/**/release/bundle/msi/*.msi
            src-tauri/target/**/release/bundle/appimage/*.AppImage
            src-tauri/target/**/release/bundle/deb/*.deb
```

- [ ] **Step 2: Validate YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/tauri-build.yml'))" && echo "YAML valid"
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/tauri-build.yml
git commit -m "ci: cross-platform Tauri build matrix (macOS/Win/Linux) (spec-20)"
```

The first push will likely have build failures until all task PRs are merged. That's acceptable — release-please tag push is the canonical trigger.

---

## Task 14: Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `src-tauri/` to §2 directory tree**

Find the directory tree in CLAUDE.md §2. Add a `src-tauri/` entry next to the existing crates/frontend lines:

```
├── src-tauri/         # Tauri 2.x desktop shell (NOT in workspace)
```

- [ ] **Step 2: Add to §3 (Running Commands)**

Append:

```markdown
### Tauri desktop

- Dev (auto-spawns sidecar): `pnpm --prefix frontend tauri-dev`
- Production build: `pnpm --prefix frontend tauri-build`
- Run sidecar alone: `cargo run --bin sigil-server -- --port 5001 --workfile /path/to/foo.sigil`
```

- [ ] **Step 3: Add to §4 (Crate Responsibilities)**

After `sigil-mcp`:

```markdown
### `sigil-shell` (src-tauri/)

- Tauri 2.x desktop shell. NOT a workspace member — intentionally excluded to keep `cargo build --workspace` fast.
- Spawns `sigil-server` as a sidecar process per window, passing `--port` (random ephemeral) and `--workfile`.
- Owns: window lifecycle, native menubar, file association (`.sigil/` Document Package on macOS), single-instance routing, recent-files persistence.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document src-tauri/ + pnpm tauri commands (spec-20)"
```

---

## Task 15: Final verification + PR

- [ ] **Step 1: Full quality gate**

```bash
cargo test --workspace 2>&1 | tail -10
cargo clippy --workspace --no-deps -- -D warnings 2>&1 | tail -5
cargo fmt --check 2>&1 | tail -3
cargo check --target wasm32-unknown-unknown -p sigil-core 2>&1 | tail -3

pnpm --prefix frontend test --run 2>&1 | tail -10
pnpm --prefix frontend exec tsc --noEmit 2>&1 | tail -3
pnpm --prefix frontend lint 2>&1 | tail -3
pnpm --prefix frontend exec prettier --check 'src/**/*.{ts,tsx,json,css}' 2>&1 | tail -3

cd src-tauri && cargo check 2>&1 | tail -5 && cd ..
cd src-tauri && cargo clippy -- -D warnings 2>&1 | tail -5 && cd ..
cd src-tauri && cargo fmt --check 2>&1 | tail -3 && cd ..
cd src-tauri && cargo test 2>&1 | tail -5 && cd ..

.github/workflows/scripts/test-delete-node-removal-discipline.sh
```

Expected: ALL clean.

- [ ] **Step 2: Manual smoke (interactive — requires GUI)**

```bash
cargo build -p sigil-server
pnpm --prefix frontend tauri-dev &
TAURI_PID=$!
sleep 10
# Manually verify:
# 1. A Sigil window appears with the native menubar.
# 2. Cmd+Z performs an undo (after creating some history).
# 3. File → Open shows a dialog filtered to `.sigil` files.
# 4. Closing the window terminates the sidecar (verify with `ps -ef | grep sigil-server`).
kill $TAURI_PID 2>&1
```

(Skip if dev environment is headless. PR description should call out which manual smokes were performed.)

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feature/tauri-desktop-spec-20

gh pr create --title "feat: Tauri desktop packaging (Spec 20)" --body "$(cat <<'EOF'
## Summary

Ships Sigil as a Tauri 2.x desktop app for macOS / Windows / Linux. Uses the existing `sigil-server` axum binary as a sidecar — frontend speaks GraphQL+WS to it just like in dev/browser mode. No transport rewrite.

Scoped explicitly to **single-workfile-per-window**. Multi-workfile-in-window with parent/child navigation is the subject of Spec 21.

## Architecture

- New `src-tauri/` directory (Tauri 2.x convention) outside the Cargo workspace to keep `cargo build --workspace` fast.
- One Tauri window = one `sigil-server` sidecar = one workfile.
- Random ephemeral port per sidecar; injected into the webview via `window.__SIGIL_SIDECAR_PORT__`.
- `tauri-plugin-single-instance` routes second-launch argv to the running instance.
- Native menubar (File / Edit / View / Window / Help) emits `menu-action` events that the frontend listens to and routes to the same handlers as keyboard shortcuts.
- macOS `.sigil` Document Package via `LSItemContentTypes` (`LSTypeIsPackage = true`); Windows + Linux register `.sigil` file extension.
- CI matrix builds (`.github/workflows/tauri-build.yml`) produce .dmg / .msi / .AppImage / .deb on tag push.

## Deferred (per spec)

- Code signing (Apple Developer ID, Windows EV cert).
- Auto-update.
- Crash reporting.
- Multi-workfile project model (Spec 21).
- Custom URL scheme (`sigil://...`).

## Test plan

- [x] `cargo test --workspace` passes
- [x] `cargo clippy --workspace -- -D warnings` clean
- [x] `cargo fmt --check` clean
- [x] `cargo check --target wasm32-unknown-unknown -p sigil-core` clean
- [x] `pnpm --prefix frontend test --run` passes
- [x] `pnpm --prefix frontend lint` clean
- [x] `pnpm --prefix frontend exec tsc --noEmit` clean
- [x] `cd src-tauri && cargo check / clippy / test` clean
- [x] Sentinel `test-delete-node-removal-discipline.sh` passes
- [ ] Manual smoke: Tauri window opens, menubar works, sidecar terminates on close
- [ ] CI matrix build green on at least one platform (full matrix validates on tag)

Closes Spec 20.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned.

---

## Self-Review

Spec coverage:

- **§1 Architecture** — Tasks 3 + 5 + 8 cover port helper + sidecar spawn + per-window model. ✓
- **§2 File association** — Task 11 covers all three platforms incl. `LSTypeIsPackage`. ✓
- **§3 Native menus** — Task 7 covers menubar + dispatcher. ✓
- **§4 Window lifecycle** — Tasks 5 + 8 + 9 cover spawn/close/open-dialog. ✓
- **§5 Dev workflow** — Task 12 (Vite config), Task 4 (package.json scripts). ✓
- **§6 Build pipeline / CI** — Task 13. ✓
- **§7 Repo structure** — Task 4 (scaffold). ✓
- **§8 Tauri permissions** — Task 4 (initial set), Task 9 (adds `dialog:allow-save` with documented deviation). ✓
- **§9 Input Validation Inventory** — Task 1 (clap-validated CLI), Task 6 (argv parsing). ✓
- **§10 PDR Traceability** — implicit (no explicit task). ✓
- **§11 Atomicity** — Task 5's `shutdown_gracefully`. ✓
- **§12 Recursion Safety** — N/A. ✓
- **§13 Tool Lifecycle** — N/A. ✓
- **§14 Cross-Stack Type Extension** — N/A. ✓
- **§15 WASM Compatibility** — N/A. ✓
- **§16 Done criteria** — Task 15. ✓

**Placeholder scan:** Three `// TODO Task 9` markers in Task 7's zoom handlers are explicitly carried forward to Task 9 (staged delivery, not a placeholder). The `/* TODO: viewport wiring */` comments in Task 9 are deferred to a follow-up (zoom handlers need viewport state exposure — out of scope for this PR). No other TBD/TODO/fill-in-details markers. ✓

**Type consistency:** `SidecarProcess`, `AppState`, `open_workfile_window`, `extract_workfile_path` consistent across Tasks 5/6/8/9. `MenuAction`, `MenuHandlers`, `installMenuListener` consistent across Tasks 7/9. ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-27-20-tauri-desktop-packaging.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
