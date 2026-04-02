// crates/server/src/routes/ws.rs

//! WebSocket endpoint for real-time command dispatch and broadcast.
//!
//! Clients connect via `/ws`, send `ClientMessage` JSON, and receive
//! `ServerMessage` JSON. Commands are dispatched through the core engine
//! via `Document::execute`, and successful mutations are broadcast to all
//! connected clients.

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};

use agent_designer_core::wire::{BroadcastCommand, SerializableCommand};

use crate::dispatch;
use crate::state::AppState;

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
    /// Result of an undo or redo operation.
    UndoRedo { can_undo: bool, can_redo: bool },
}

/// Handles the WebSocket upgrade request.
pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

/// Manages a single WebSocket connection lifecycle.
///
/// Uses `tokio::select!` to multiplex between:
/// - Incoming client messages (commands, undo, redo)
/// - Outgoing broadcast messages from other clients
///
/// The `std::sync::Mutex` on `Document` is never held across `.await` points.
/// All lock acquisitions are scoped to synchronous blocks.
async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let mut broadcast_rx = state.broadcast_tx.subscribe();

    loop {
        tokio::select! {
            // Forward broadcast messages to this client.
            broadcast_result = broadcast_rx.recv() => {
                match broadcast_result {
                    Ok(broadcast_cmd) => {
                        let msg = ServerMessage::Broadcast {
                            command: Box::new(broadcast_cmd),
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
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("broadcast receiver lagged, skipped {n} messages");
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

                let response = process_client_message(&text, &state);
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
}

/// Processes a single client message and returns an optional response.
///
/// All `Mutex` access is confined to this synchronous function, ensuring
/// the lock is never held across an `.await` point.
fn process_client_message(text: &str, state: &AppState) -> Option<ServerMessage> {
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
            // Convert wire format to executable command.
            let executable = match dispatch::dispatch(command.clone()) {
                Ok(cmd) => cmd,
                Err(e) => {
                    tracing::warn!("dispatch error: {e}");
                    return Some(ServerMessage::Error {
                        message: format!("dispatch error: {e}"),
                    });
                }
            };

            // Execute through the document engine.
            let mut doc_guard = state.document.lock().expect("document lock poisoned");
            match doc_guard.execute(executable) {
                Ok(_side_effects) => {
                    drop(doc_guard); // Release lock before broadcast
                    let broadcast: BroadcastCommand = (&command).into();
                    // Ignore send errors -- they mean no receivers are listening.
                    let _ = state.broadcast_tx.send(broadcast);
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
            let mut doc_guard = state.document.lock().expect("document lock poisoned");
            match doc_guard.undo() {
                Ok(_side_effects) => {
                    let can_undo = doc_guard.can_undo();
                    let can_redo = doc_guard.can_redo();
                    tracing::debug!(can_undo, can_redo, "undo successful");
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
            let mut doc_guard = state.document.lock().expect("document lock poisoned");
            match doc_guard.redo() {
                Ok(_side_effects) => {
                    let can_undo = doc_guard.can_undo();
                    let can_redo = doc_guard.can_redo();
                    tracing::debug!(can_undo, can_redo, "redo successful");
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
