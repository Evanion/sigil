// crates/server/src/routes/ws.rs

//! WebSocket endpoint for real-time command dispatch and broadcast.
//!
//! Clients connect via `/ws`, send `ClientMessage` JSON, and receive
//! `ServerMessage` JSON. Commands are dispatched through the core engine
//! via `Document::execute`, and successful mutations are broadcast to all
//! connected clients. Each connection is assigned a unique client ID so
//! that broadcast messages are not echoed back to the sender.

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};

use agent_designer_core::wire::{BroadcastCommand, SerializableCommand};

use crate::dispatch;
use crate::state::{AppState, BroadcastEnvelope, BroadcastPayload, MAX_WS_MESSAGE_SIZE};

/// Messages sent from the client to the server over WebSocket.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Execute a design command.
    Command { command: Box<SerializableCommand> },
    /// Request undo of the last command.
    Undo,
    /// Request redo of the last undone command.
    Redo,
}

/// Messages sent from the server to connected clients over WebSocket.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    /// A command was broadcast to all clients.
    Broadcast { command: Box<BroadcastCommand> },
    /// An error occurred processing a client message.
    Error { message: String },
    /// Result of an undo or redo operation (sent to the originating client).
    UndoRedo { can_undo: bool, can_redo: bool },
    /// The document state changed (e.g. via another client's undo/redo).
    /// Receiving clients should update their undo/redo UI state.
    DocumentChanged { can_undo: bool, can_redo: bool },
}

/// Returns `true` if the given origin is acceptable for WebSocket connections.
///
/// When `SIGIL_DEV_CORS` is set, all origins are accepted (development mode).
/// Otherwise, only `localhost` origins (any port, http or https) are permitted.
fn is_allowed_origin(origin: &str) -> bool {
    if std::env::var("SIGIL_DEV_CORS").is_ok() {
        return true;
    }
    // Accept http(s)://localhost[:port]
    origin
        .strip_prefix("http://localhost")
        .or_else(|| origin.strip_prefix("https://localhost"))
        .is_some_and(|rest| rest.is_empty() || rest.starts_with(':'))
}

/// Handles the WebSocket upgrade request.
///
/// Validates the `Origin` header before upgrading. Rejects requests from
/// disallowed origins with HTTP 403.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> impl IntoResponse {
    // RF-007: Validate origin header
    if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
        if !is_allowed_origin(origin) {
            tracing::warn!(origin, "rejected WebSocket connection from disallowed origin");
            return axum::http::StatusCode::FORBIDDEN.into_response();
        }
    }

    let client_id = state.next_client_id();
    ws.max_message_size(MAX_WS_MESSAGE_SIZE)
        .on_upgrade(move |socket| handle_socket(socket, state, client_id))
        .into_response()
}

/// Manages a single WebSocket connection lifecycle.
///
/// Each connection is assigned a unique `client_id`. Broadcast messages from
/// the same `client_id` are filtered out so that a client never receives its
/// own commands back.
///
/// Uses `tokio::select!` to multiplex between:
/// - Incoming client messages (commands, undo, redo)
/// - Outgoing broadcast messages from other clients
///
/// The `std::sync::Mutex` on `Document` is never held across `.await` points.
/// All lock acquisitions are scoped to synchronous blocks.
async fn handle_socket(socket: WebSocket, state: AppState, client_id: u64) {
    tracing::debug!(client_id, "WebSocket client connected");

    let (mut sender, mut receiver) = socket.split();
    let mut broadcast_rx = state.broadcast_tx.subscribe();

    loop {
        tokio::select! {
            // Forward broadcast messages to this client (skip self-originated).
            broadcast_result = broadcast_rx.recv() => {
                match broadcast_result {
                    Ok(envelope) => {
                        // Skip messages from this client.
                        if envelope.sender_id == client_id {
                            continue;
                        }

                        let msg = match envelope.payload {
                            BroadcastPayload::Command(cmd) => {
                                ServerMessage::Broadcast {
                                    command: Box::new(cmd),
                                }
                            }
                            BroadcastPayload::DocumentChanged { can_undo, can_redo } => {
                                ServerMessage::DocumentChanged { can_undo, can_redo }
                            }
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
                    // RF-010: Disconnect lagging clients after notifying them.
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(client_id, "client lagged by {n} messages, disconnecting");
                        let err_msg = ServerMessage::Error {
                            message: format!("connection dropped: lagged by {n} messages"),
                        };
                        if let Ok(json) = serde_json::to_string(&err_msg) {
                            let _ = sender.send(Message::Text(json.into())).await;
                        }
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        break; // Channel closed
                    }
                }
            }

            // Process incoming messages from this client.
            ws_msg = receiver.next() => {
                let Some(msg_result) = ws_msg else {
                    break; // Stream ended -- client disconnected
                };

                let Ok(msg) = msg_result else {
                    break; // WebSocket error
                };

                let Message::Text(text) = msg else {
                    continue; // Ignore non-text messages (ping/pong handled by axum)
                };

                let response = process_client_message(&text, &state, client_id);
                if let Some(server_msg) = response {
                    let json = match serde_json::to_string(&server_msg) {
                        Ok(j) => j,
                        Err(e) => {
                            tracing::error!("failed to serialize server message: {e}");
                            continue;
                        }
                    };
                    if sender.send(Message::Text(json.into())).await.is_err() {
                        break; // Client disconnected
                    }
                }
            }
        }
    }

    tracing::debug!(client_id, "WebSocket client disconnected");
}

/// Acquires the document lock, recovering from mutex poisoning.
///
/// If the mutex is poisoned (a previous holder panicked), we log an error and
/// recover the inner value. This prevents a single panic from permanently
/// locking out all clients.
fn acquire_document_lock(
    state: &AppState,
) -> std::sync::MutexGuard<'_, crate::state::SendDocument> {
    match state.document.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            tracing::error!("document mutex poisoned, recovering");
            poisoned.into_inner()
        }
    }
}

/// Processes a single client message and returns an optional response.
///
/// All `Mutex` access is confined to this synchronous function, ensuring
/// the lock is never held across an `.await` point.
fn process_client_message(
    text: &str,
    state: &AppState,
    client_id: u64,
) -> Option<ServerMessage> {
    let client_msg: ClientMessage = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("invalid client message: {e}");
            return Some(ServerMessage::Error {
                message: format!("invalid message: {e}"),
            });
        }
    };

    match client_msg {
        ClientMessage::Command { command } => {
            let command = *command;
            // RF-012: Convert to BroadcastCommand first, then move into dispatch (no clone).
            let broadcast: BroadcastCommand = (&command).into();
            let executable = match dispatch::dispatch(command) {
                Ok(cmd) => cmd,
                Err(e) => {
                    tracing::warn!("dispatch error: {e}");
                    return Some(ServerMessage::Error {
                        message: format!("dispatch error: {e}"),
                    });
                }
            };

            // RF-009: Graceful mutex handling instead of expect().
            let mut doc_guard = acquire_document_lock(state);
            match doc_guard.0.execute(executable) {
                Ok(side_effects) => {
                    // RF-005: Log side effects at warn level if non-empty.
                    if !side_effects.is_empty() {
                        tracing::warn!(count = side_effects.len(), ?side_effects, "side effects produced but not yet processed");
                        // TODO(plan-02b): process side effects for file I/O
                    }
                    drop(doc_guard); // Release lock before broadcast
                    // Ignore send errors -- they mean no receivers are listening.
                    let _ = state.broadcast_tx.send(BroadcastEnvelope {
                        sender_id: client_id,
                        payload: BroadcastPayload::Command(broadcast),
                    });
                    None
                }
                Err(e) => {
                    tracing::warn!("command execution failed: {e}");
                    Some(ServerMessage::Error {
                        message: format!("execution error: {e}"),
                    })
                }
            }
        }
        ClientMessage::Undo => {
            // RF-009: Graceful mutex handling instead of expect().
            let mut doc_guard = acquire_document_lock(state);
            match doc_guard.0.undo() {
                Ok(side_effects) => {
                    // RF-005: Log side effects at warn level if non-empty.
                    if !side_effects.is_empty() {
                        tracing::warn!(count = side_effects.len(), ?side_effects, "side effects produced but not yet processed");
                        // TODO(plan-02b): process side effects for file I/O
                    }
                    let can_undo = doc_guard.0.can_undo();
                    let can_redo = doc_guard.0.can_redo();
                    drop(doc_guard); // Release lock before broadcast
                    tracing::debug!(can_undo, can_redo, "undo successful");
                    let _ = state.broadcast_tx.send(BroadcastEnvelope {
                        sender_id: client_id,
                        payload: BroadcastPayload::DocumentChanged { can_undo, can_redo },
                    });
                    Some(ServerMessage::UndoRedo { can_undo, can_redo })
                }
                Err(e) => {
                    tracing::warn!("undo failed: {e}");
                    Some(ServerMessage::Error {
                        message: format!("undo failed: {e}"),
                    })
                }
            }
        }
        ClientMessage::Redo => {
            // RF-009: Graceful mutex handling instead of expect().
            let mut doc_guard = acquire_document_lock(state);
            match doc_guard.0.redo() {
                Ok(side_effects) => {
                    // RF-005: Log side effects at warn level if non-empty.
                    if !side_effects.is_empty() {
                        tracing::warn!(count = side_effects.len(), ?side_effects, "side effects produced but not yet processed");
                        // TODO(plan-02b): process side effects for file I/O
                    }
                    let can_undo = doc_guard.0.can_undo();
                    let can_redo = doc_guard.0.can_redo();
                    drop(doc_guard); // Release lock before broadcast
                    tracing::debug!(can_undo, can_redo, "redo successful");
                    let _ = state.broadcast_tx.send(BroadcastEnvelope {
                        sender_id: client_id,
                        payload: BroadcastPayload::DocumentChanged { can_undo, can_redo },
                    });
                    Some(ServerMessage::UndoRedo { can_undo, can_redo })
                }
                Err(e) => {
                    tracing::warn!("redo failed: {e}");
                    Some(ServerMessage::Error {
                        message: format!("redo failed: {e}"),
                    })
                }
            }
        }
    }
}
