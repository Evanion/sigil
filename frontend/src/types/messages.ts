/**
 * TypeScript types for WebSocket messages between client and server.
 *
 * Both `ClientMessage` and `ServerMessage` are tagged unions using
 * `#[serde(tag = "type", rename_all = "snake_case")]`.
 *
 * Source: crates/server/src/routes/ws.rs
 */

import type { BroadcastCommand, SerializableCommand } from "./commands";

// ── ClientMessage (client -> server) ──────────────────────────────────

export interface ClientMessageCommand {
  readonly type: "command";
  readonly command: SerializableCommand;
}

export interface ClientMessageUndo {
  readonly type: "undo";
}

export interface ClientMessageRedo {
  readonly type: "redo";
}

export type ClientMessage = ClientMessageCommand | ClientMessageUndo | ClientMessageRedo;

// ── ServerMessage (server -> client) ──────────────────────────────────

export interface ServerMessageBroadcast {
  readonly type: "broadcast";
  readonly command: BroadcastCommand;
}

export interface ServerMessageError {
  readonly type: "error";
  readonly message: string;
}

export interface ServerMessageUndoRedo {
  readonly type: "undo_redo";
  readonly can_undo: boolean;
  readonly can_redo: boolean;
}

export interface ServerMessageDocumentChanged {
  readonly type: "document_changed";
  readonly can_undo: boolean;
  readonly can_redo: boolean;
}

export type ServerMessage =
  | ServerMessageBroadcast
  | ServerMessageError
  | ServerMessageUndoRedo
  | ServerMessageDocumentChanged;

// ── Helper constructors ───────────────────────────────────────────────

/** Create a command message to send to the server. */
export function commandMessage(command: SerializableCommand): ClientMessage {
  return { type: "command", command };
}

/** Create an undo message. */
export function undoMessage(): ClientMessage {
  return { type: "undo" };
}

/** Create a redo message. */
export function redoMessage(): ClientMessage {
  return { type: "redo" };
}
