/**
 * TypeScript types for WebSocket messages between client and server.
 *
 * Both `ClientMessage` and `ServerMessage` are tagged unions using
 * `#[serde(tag = "type", rename_all = "snake_case")]`.
 *
 * Source: crates/server/src/routes/ws.rs
 */

import type { BroadcastCommand, SerializableCommand } from "./commands";
import type { NodeId, NodeKind, Transform } from "./document";

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

export interface ClientMessageCreateNodeRequest {
  readonly type: "create_node_request";
  readonly uuid: string;
  readonly kind: NodeKind;
  readonly name: string;
  readonly page_id: string | null;
  readonly transform: Transform;
}

export type ClientMessage =
  | ClientMessageCommand
  | ClientMessageUndo
  | ClientMessageRedo
  | ClientMessageCreateNodeRequest;

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

export interface ServerMessageNodeCreated {
  readonly type: "node_created";
  readonly uuid: string;
  readonly node_id: NodeId;
}

export type ServerMessage =
  | ServerMessageBroadcast
  | ServerMessageError
  | ServerMessageUndoRedo
  | ServerMessageDocumentChanged
  | ServerMessageNodeCreated;

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

/** Create a create_node_request message. */
export function createNodeRequestMessage(
  uuid: string,
  kind: NodeKind,
  name: string,
  pageId: string | null,
  transform: Transform,
): ClientMessage {
  return { type: "create_node_request", uuid, kind, name, page_id: pageId, transform };
}
