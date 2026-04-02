/**
 * Wire-format message types for WebSocket communication.
 * These mirror the Rust server's ClientMessage and ServerMessage enums.
 *
 * NOTE: These are placeholder types for the frontend foundation.
 * They will be expanded when the core crate's wire format is finalized.
 */

// --- Client -> Server messages ---

export interface ExecuteCommandMessage {
  readonly type: "execute_command";
  readonly command: SerializableCommand;
}

export interface UndoMessage {
  readonly type: "undo";
}

export interface RedoMessage {
  readonly type: "redo";
}

export type ClientMessage =
  | ExecuteCommandMessage
  | UndoMessage
  | RedoMessage;

// --- Server -> Client messages ---

export interface CommandBroadcastMessage {
  readonly type: "command_broadcast";
  readonly command: BroadcastCommand;
}

export interface UndoRedoStateMessage {
  readonly type: "undo_redo_state";
  readonly can_undo: boolean;
  readonly can_redo: boolean;
}

export interface DocumentChangedMessage {
  readonly type: "document_changed";
}

export interface ErrorMessage {
  readonly type: "error";
  readonly message: string;
}

export type ServerMessage =
  | CommandBroadcastMessage
  | UndoRedoStateMessage
  | DocumentChangedMessage
  | ErrorMessage;

// --- Placeholder command types (will be expanded by Task 1 / spec-01) ---

export interface SerializableCommand {
  readonly kind: string;
  readonly [key: string]: unknown;
}

export interface BroadcastCommand {
  readonly kind: string;
  readonly [key: string]: unknown;
}
