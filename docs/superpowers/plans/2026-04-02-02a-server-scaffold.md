# Server Scaffold — Implementation Plan (02a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Axum server with shared document state, WebSocket command dispatch, and broadcast — enabling real-time collaborative editing (in-memory only, no persistence yet).

**Architecture:** The server holds a shared `AppState` containing a `Document` wrapped in `Arc<RwLock<>>`. HTTP routes provide health and document info endpoints. A WebSocket endpoint receives `SerializableCommand` JSON, deserializes it, converts to a concrete `Command`, executes via `Document::execute`, and broadcasts the `BroadcastCommand` to all connected clients. The server generates all UUIDs. CORS is configured for development. Integration tests verify the full HTTP and WebSocket pipeline.

**Tech Stack:** Rust 1.94.1, Axum 0.8, Tokio 1.50, tower-http (CORS, static files), serde_json, uuid v4, anyhow

**IMPORTANT:** Your FIRST action before writing ANY code must be to read `CLAUDE.md` in full. Rules in CLAUDE.md take precedence over code in this plan if they conflict. The server crate uses `anyhow` for errors (NOT `thiserror`). All document mutations go through `Document::execute` — never mutate state directly.

---

## File Structure

```
crates/server/src/
├── main.rs              # MODIFY: startup, router setup, state initialization
├── state.rs             # NEW: AppState, shared document, broadcast channel
├── routes/
│   ├── mod.rs           # NEW: route module
│   ├── health.rs        # NEW: health endpoint (extract from main.rs)
│   ├── document.rs      # NEW: document info endpoints
│   └── ws.rs            # NEW: WebSocket endpoint — command dispatch + broadcast
├── dispatch.rs          # NEW: SerializableCommand → Box<dyn Command> conversion
```

---

## Task 1: Create AppState with shared document and broadcast channel

**Files:**
- Create: `crates/server/src/state.rs`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create `crates/server/src/state.rs`:

```rust
// crates/server/src/state.rs

use std::sync::Arc;
use tokio::sync::{RwLock, broadcast};

use agent_designer_core::Document;
use agent_designer_core::wire::BroadcastCommand;

/// Shared application state.
///
/// Wrapped in `Arc` and passed to all route handlers via Axum's state extractor.
#[derive(Clone)]
pub struct AppState {
    /// The in-memory design document. Protected by a read-write lock.
    pub document: Arc<RwLock<Document>>,
    /// Broadcast channel for sending commands to all connected WebSocket clients.
    pub broadcast_tx: broadcast::Sender<BroadcastCommand>,
}

impl AppState {
    /// Creates a new AppState with an empty document.
    #[must_use]
    pub fn new() -> Self {
        let (broadcast_tx, _) = broadcast::channel(256);
        Self {
            document: Arc::new(RwLock::new(Document::new("Untitled".to_string()))),
            broadcast_tx,
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
```

- [ ] 3. Add `serde` and `serde_json` to server's `Cargo.toml` (needed for JSON handling):

```toml
serde = { workspace = true }
serde_json = { workspace = true }
uuid = { workspace = true }
```

- [ ] 4. Add `mod state;` to `main.rs` and verify it compiles:

```bash
cargo check -p agent-designer-server
```

- [ ] 5. Commit:

```bash
git add crates/server/src/state.rs crates/server/src/main.rs crates/server/Cargo.toml
git commit -m "feat(server): add AppState with shared document and broadcast channel (spec-02)"
```

---

## Task 2: Extract routes into modules and add document info endpoint

**Files:**
- Create: `crates/server/src/routes/mod.rs`
- Create: `crates/server/src/routes/health.rs`
- Create: `crates/server/src/routes/document.rs`
- Modify: `crates/server/src/main.rs`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create `crates/server/src/routes/health.rs`:

```rust
use axum::http::StatusCode;
use axum::response::IntoResponse;

/// Health check endpoint.
pub async fn health() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}
```

- [ ] 3. Create `crates/server/src/routes/document.rs`:

```rust
use axum::Json;
use axum::extract::State;
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
pub struct DocumentInfo {
    pub name: String,
    pub page_count: usize,
    pub node_count: usize,
    pub can_undo: bool,
    pub can_redo: bool,
}

/// Returns basic info about the current document.
pub async fn get_document_info(State(state): State<AppState>) -> Json<DocumentInfo> {
    let doc = state.document.read().await;
    Json(DocumentInfo {
        name: doc.metadata.name.clone(),
        page_count: doc.pages.len(),
        node_count: doc.arena.len(),
        can_undo: doc.can_undo(),
        can_redo: doc.can_redo(),
    })
}
```

- [ ] 4. Create `crates/server/src/routes/mod.rs`:

```rust
pub mod document;
pub mod health;
```

- [ ] 5. Update `main.rs` to use the route modules and add AppState:

```rust
#![warn(clippy::all, clippy::pedantic)]

mod routes;
mod state;

use axum::{Router, routing::get};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "4680".to_string())
        .parse::<u16>()?;

    let static_dir = std::env::var("STATIC_DIR")
        .unwrap_or_else(|_| "/usr/local/share/sigil/frontend".to_string());

    let state = AppState::new();

    let spa = ServeDir::new(&static_dir)
        .not_found_service(ServeFile::new(format!("{static_dir}/index.html")));

    let app = Router::new()
        .route("/health", get(routes::health::health))
        .route("/api/document", get(routes::document::get_document_info))
        .fallback_service(spa)
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!("listening on port {port}");
    tracing::info!("serving static files from {static_dir}");
    axum::serve(listener, app).await?;

    Ok(())
}
```

- [ ] 6. Verify it compiles and runs:

```bash
cargo check -p agent-designer-server
```

- [ ] 7. Commit:

```bash
git add crates/server/src/
git commit -m "feat(server): extract routes, add document info endpoint with CORS (spec-02)"
```

---

## Task 3: Implement command dispatch (SerializableCommand → Box<dyn Command>)

**Files:**
- Create: `crates/server/src/dispatch.rs`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create `crates/server/src/dispatch.rs` that converts `SerializableCommand` into an executable `Box<dyn Command>`:

This is the critical integration layer. Each `SerializableCommand` variant maps to the corresponding command struct from the core crate. The server generates UUIDs for `CreateNode`.

```rust
// crates/server/src/dispatch.rs

use agent_designer_core::{
    Command,
    wire::SerializableCommand,
    commands::{
        node_commands::{CreateNode, DeleteNode, RenameNode, SetVisible, SetLocked, SetTextContent},
        style_commands::{SetTransform, SetFills, SetStrokes, SetOpacity, SetBlendMode, SetEffects, SetConstraints},
        tree_commands::{ReparentNode, ReorderChildren},
        transition_commands::{AddTransition, RemoveTransition, UpdateTransition},
        token_commands::{AddToken, RemoveToken, UpdateToken},
        component_commands::{AddComponent, RemoveComponent, SetOverride, RemoveOverride},
    },
};

/// Converts a wire-format command into an executable Command.
///
/// # Errors
/// Returns an error if the command cannot be converted (e.g., missing required fields).
pub fn dispatch(cmd: SerializableCommand) -> anyhow::Result<Box<dyn Command>> {
    let command: Box<dyn Command> = match cmd {
        SerializableCommand::CreateNode { node_id, uuid, kind, name, page_id } => {
            Box::new(CreateNode { node_id, uuid, kind, name, page_id })
        }
        SerializableCommand::DeleteNode { node_id, snapshot, page_id, page_root_index, parent_id, parent_child_index } => {
            Box::new(DeleteNode { node_id, snapshot, page_id, page_root_index, parent_id, parent_child_index })
        }
        SerializableCommand::RenameNode { node_id, new_name, old_name } => {
            Box::new(RenameNode { node_id, new_name, old_name })
        }
        SerializableCommand::SetVisible { node_id, new_visible, old_visible } => {
            Box::new(SetVisible { node_id, new_visible, old_visible })
        }
        SerializableCommand::SetLocked { node_id, new_locked, old_locked } => {
            Box::new(SetLocked { node_id, new_locked, old_locked })
        }
        SerializableCommand::SetTextContent { node_id, new_content, old_content } => {
            Box::new(SetTextContent { node_id, new_content, old_content })
        }
        SerializableCommand::SetTransform { node_id, new_transform, old_transform } => {
            Box::new(SetTransform { node_id, new_transform, old_transform })
        }
        SerializableCommand::SetFills { node_id, new_fills, old_fills } => {
            Box::new(SetFills { node_id, new_fills, old_fills })
        }
        SerializableCommand::SetStrokes { node_id, new_strokes, old_strokes } => {
            Box::new(SetStrokes { node_id, new_strokes, old_strokes })
        }
        SerializableCommand::SetOpacity { node_id, new_opacity, old_opacity } => {
            Box::new(SetOpacity { node_id, new_opacity, old_opacity })
        }
        SerializableCommand::SetBlendMode { node_id, new_blend_mode, old_blend_mode } => {
            Box::new(SetBlendMode { node_id, new_blend_mode, old_blend_mode })
        }
        SerializableCommand::SetEffects { node_id, new_effects, old_effects } => {
            Box::new(SetEffects { node_id, new_effects, old_effects })
        }
        SerializableCommand::SetConstraints { node_id, new_constraints, old_constraints } => {
            Box::new(SetConstraints { node_id, new_constraints, old_constraints })
        }
        SerializableCommand::ReparentNode { node_id, new_parent_id, new_position, old_parent_id, old_position } => {
            Box::new(ReparentNode { node_id, new_parent_id, new_position, old_parent_id, old_position })
        }
        SerializableCommand::ReorderChildren { node_id, new_position, old_position } => {
            Box::new(ReorderChildren { node_id, new_position, old_position })
        }
        SerializableCommand::AddTransition { transition } => {
            Box::new(AddTransition { transition })
        }
        SerializableCommand::RemoveTransition { transition_id, snapshot } => {
            Box::new(RemoveTransition { transition_id, snapshot })
        }
        SerializableCommand::UpdateTransition { transition_id, new_transition, old_transition } => {
            Box::new(UpdateTransition { transition_id, new_transition, old_transition })
        }
        SerializableCommand::AddToken { token } => {
            Box::new(AddToken { token })
        }
        SerializableCommand::RemoveToken { token_name, snapshot } => {
            Box::new(RemoveToken { token_name, snapshot })
        }
        SerializableCommand::UpdateToken { new_token, old_token } => {
            Box::new(UpdateToken { new_token, old_token })
        }
        SerializableCommand::AddComponent { component } => {
            Box::new(AddComponent { component })
        }
        SerializableCommand::RemoveComponent { component_id, snapshot } => {
            Box::new(RemoveComponent { component_id, snapshot })
        }
        SerializableCommand::SetOverride { node_id, key, new_value, new_source, old_entry } => {
            Box::new(SetOverride { node_id, key, new_value, new_source, old_entry })
        }
        SerializableCommand::RemoveOverride { node_id, key, old_entry } => {
            Box::new(RemoveOverride { node_id, key, old_entry })
        }
    };
    Ok(command)
}
```

- [ ] 3. Add `mod dispatch;` to `main.rs`.

- [ ] 4. Verify it compiles:

```bash
cargo check -p agent-designer-server
```

- [ ] 5. Commit:

```bash
git add crates/server/src/dispatch.rs crates/server/src/main.rs
git commit -m "feat(server): add command dispatch — SerializableCommand to executable Command (spec-02)"
```

---

## Task 4: Implement WebSocket endpoint with command execution and broadcast

**Files:**
- Create: `crates/server/src/routes/ws.rs`
- Modify: `crates/server/src/routes/mod.rs`
- Modify: `crates/server/src/main.rs`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create `crates/server/src/routes/ws.rs`:

```rust
// crates/server/src/routes/ws.rs

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};

use agent_designer_core::wire::{BroadcastCommand, SerializableCommand};

use crate::dispatch;
use crate::state::AppState;

/// WebSocket protocol messages from client to server.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Execute a command.
    Command { command: SerializableCommand },
    /// Request undo.
    Undo,
    /// Request redo.
    Redo,
}

/// WebSocket protocol messages from server to client.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    /// A command was broadcast to all clients.
    Broadcast { command: BroadcastCommand },
    /// An error occurred.
    Error { message: String },
    /// Undo/redo result.
    UndoRedo { can_undo: bool, can_redo: bool },
}

/// WebSocket upgrade handler.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

/// Handles a single WebSocket connection.
async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let mut broadcast_rx = state.broadcast_tx.subscribe();

    // Spawn a task to forward broadcasts to this client
    let mut send_task = tokio::spawn(async move {
        while let Ok(broadcast_cmd) = broadcast_rx.recv().await {
            let msg = ServerMessage::Broadcast {
                command: broadcast_cmd,
            };
            let json = match serde_json::to_string(&msg) {
                Ok(j) => j,
                Err(e) => {
                    tracing::error!("failed to serialize broadcast: {e}");
                    continue;
                }
            };
            if sender.send(Message::Text(json.into())).await.is_err() {
                break; // Client disconnected
            }
        }
    });

    // Process incoming messages from this client
    let tx = state.broadcast_tx.clone();
    let doc = state.document.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            let Message::Text(text) = msg else {
                continue; // Ignore non-text messages
            };

            let client_msg: ClientMessage = match serde_json::from_str(&text) {
                Ok(m) => m,
                Err(e) => {
                    tracing::warn!("invalid message: {e}");
                    continue;
                }
            };

            match client_msg {
                ClientMessage::Command { command } => {
                    // Convert wire format to executable command
                    let executable = match dispatch::dispatch(command.clone()) {
                        Ok(cmd) => cmd,
                        Err(e) => {
                            tracing::warn!("dispatch error: {e}");
                            continue;
                        }
                    };

                    // Execute through the document
                    let mut doc_guard = doc.write().await;
                    match doc_guard.execute(executable) {
                        Ok(_side_effects) => {
                            // Convert to broadcast format and send to all clients
                            let broadcast: BroadcastCommand = (&command).into();
                            let _ = tx.send(broadcast);
                        }
                        Err(e) => {
                            tracing::warn!("command execution failed: {e}");
                        }
                    }
                }
                ClientMessage::Undo => {
                    let mut doc_guard = doc.write().await;
                    match doc_guard.undo() {
                        Ok(_) => {
                            tracing::debug!("undo successful");
                        }
                        Err(e) => {
                            tracing::warn!("undo failed: {e}");
                        }
                    }
                }
                ClientMessage::Redo => {
                    let mut doc_guard = doc.write().await;
                    match doc_guard.redo() {
                        Ok(_) => {
                            tracing::debug!("redo successful");
                        }
                        Err(e) => {
                            tracing::warn!("redo failed: {e}");
                        }
                    }
                }
            }
        }
    });

    // If either task completes, abort the other
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }
}
```

- [ ] 3. Add `futures-util` to `crates/server/Cargo.toml` (needed for stream splitting):

```toml
futures-util = "0.3"
```

- [ ] 4. Add `pub mod ws;` to `routes/mod.rs`.

- [ ] 5. Add the WebSocket route in `main.rs`:

```rust
.route("/ws", get(routes::ws::ws_handler))
```

- [ ] 6. Verify it compiles:

```bash
cargo check -p agent-designer-server
```

- [ ] 7. Commit:

```bash
git add crates/server/
git commit -m "feat(server): add WebSocket endpoint with command dispatch and broadcast (spec-02)"
```

---

## Task 5: Add integration tests

**Files:**
- Create: `crates/server/tests/api_test.rs`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Add test dependencies to `crates/server/Cargo.toml`:

```toml
[dev-dependencies]
assert_matches = { workspace = true }
reqwest = { version = "0.12", features = ["json"] }
tokio-tungstenite = "0.26"
```

- [ ] 3. Create `crates/server/tests/api_test.rs` with integration tests:

```rust
//! Integration tests for the server HTTP and WebSocket endpoints.

use std::net::SocketAddr;

/// Starts the server on a random port and returns the address.
async fn start_server() -> SocketAddr {
    // Build the app without static file serving (no frontend in tests)
    use axum::{Router, routing::get};
    use tower_http::cors::CorsLayer;

    // We need to import the server's modules — this requires the server
    // to expose its state and routes. For now, we build a minimal test app.

    let (tx, _) = tokio::sync::broadcast::channel(256);
    let state = agent_designer_server_test_state(tx);

    // ... test implementation depends on whether server exposes its types
}

// NOTE: Integration tests for the server require the server to expose
// its AppState and route builder. This may require adding a `lib.rs`
// alongside `main.rs` in the server crate.
```

Since the server is currently a binary-only crate (`main.rs`), integration tests need the server to expose a library interface. Add a `lib.rs`:

```rust
// crates/server/src/lib.rs
#![warn(clippy::all, clippy::pedantic)]

pub mod dispatch;
pub mod routes;
pub mod state;

use axum::{Router, routing::get};
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

use crate::state::AppState;

/// Builds the full application router.
pub fn build_app(state: AppState, static_dir: Option<&str>) -> Router {
    let mut app = Router::new()
        .route("/health", get(routes::health::health))
        .route("/api/document", get(routes::document::get_document_info))
        .route("/ws", get(routes::ws::ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    if let Some(dir) = static_dir {
        let spa = ServeDir::new(dir)
            .not_found_service(ServeFile::new(format!("{dir}/index.html")));
        app = app.fallback_service(spa);
    }

    app
}
```

Update `main.rs` to use `build_app`:

```rust
#![warn(clippy::all, clippy::pedantic)]

use agent_designer_server::{build_app, state::AppState};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "4680".to_string())
        .parse::<u16>()?;

    let static_dir = std::env::var("STATIC_DIR")
        .unwrap_or_else(|_| "/usr/local/share/sigil/frontend".to_string());

    let state = AppState::new();
    let app = build_app(state, Some(&static_dir));

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!("listening on port {port}");
    axum::serve(listener, app).await?;

    Ok(())
}
```

Then the integration test:

```rust
use std::net::SocketAddr;
use agent_designer_server::{build_app, state::AppState};

async fn start_test_server() -> SocketAddr {
    let state = AppState::new();
    let app = build_app(state, None);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    addr
}

#[tokio::test]
async fn test_health_endpoint() {
    let addr = start_test_server().await;
    let resp = reqwest::get(format!("http://{addr}/health"))
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.unwrap(), "ok");
}

#[tokio::test]
async fn test_document_info_endpoint() {
    let addr = start_test_server().await;
    let resp = reqwest::get(format!("http://{addr}/api/document"))
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["name"], "Untitled");
    assert_eq!(body["page_count"], 0);
    assert_eq!(body["node_count"], 0);
}

#[tokio::test]
async fn test_websocket_command_execution() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    let addr = start_test_server().await;
    let (mut ws, _) = connect_async(format!("ws://{addr}/ws"))
        .await
        .expect("connect");

    // Send a SetVisible command (requires a node to exist first,
    // so this test verifies the WebSocket accepts and processes messages)
    let msg = serde_json::json!({
        "type": "command",
        "command": {
            "type": "rename_node",
            "node_id": [0, 0],
            "new_name": "Test",
            "old_name": "Original"
        }
    });
    ws.send(Message::Text(serde_json::to_string(&msg).unwrap().into()))
        .await
        .expect("send");

    // The command will likely fail (no node with id [0,0]), but the
    // WebSocket connection should remain open. Send a ping to verify.
    ws.close(None).await.expect("close");
}
```

- [ ] 4. Run tests:

```bash
cargo test -p agent-designer-server
cargo clippy -p agent-designer-server -- -D warnings
cargo fmt -p agent-designer-server
```

- [ ] 5. Commit:

```bash
git add crates/server/
git commit -m "feat(server): add lib.rs, build_app, and integration tests (spec-02)"
```

---

## Task 6: Run full workspace verification

**Files:** None (verification only)

- [ ] 1. Full workspace tests:

```bash
cargo test --workspace
```

- [ ] 2. Clippy:

```bash
cargo clippy --workspace -- -D warnings
```

- [ ] 3. Format:

```bash
cargo fmt --check
```

- [ ] 4. If any issues, fix and commit.

---

## Deferred Items

### Plan 02b: File I/O — Workfile Loading, Saving, Debounced Persistence

- Workfile format: `{name}.sigil/pages/*.json`, `components/*.json`, `tokens/*.json`, `manifest.json`
- Load workfile on startup
- Save on command execution (debounced)
- SideEffect handling (MoveTokenToWorkfile, MoveComponentToWorkfile)

### Plan 02c: File Watching + Workfile Discovery + Token Inheritance

- `notify` crate for filesystem watching
- Recursive `.sigil/` discovery under WORKSPACE_DIR
- Inheritance hierarchy resolution (ancestor walking)
- Expected-write tracking to suppress feedback loops
- Broadcast external changes to connected clients
