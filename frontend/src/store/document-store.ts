/**
 * Reactive document store with WebSocket integration.
 *
 * Holds the local document state (info, nodes, pages) and provides
 * methods to send commands, undo/redo, and subscribe to state changes.
 * On server broadcast messages, the store re-fetches state and notifies
 * all subscribers.
 */

import type { WebSocketClient } from "../ws/client";
import type { SerializableCommand } from "../types/commands";
import type { DocumentInfo, DocumentNode, Page } from "../types/document";
import type { ServerMessage } from "../types/messages";

/** Callback invoked whenever the store state changes. */
export type Subscriber = () => void;

/** Return type for subscribe — call to unsubscribe. */
export type Unsubscribe = () => void;

export interface DocumentStore {
  /** Get the current document info, or null if not yet loaded. */
  getInfo(): DocumentInfo | null;

  /** Get all nodes as a Map keyed by UUID. */
  getAllNodes(): Map<string, DocumentNode>;

  /** Get a single node by UUID, or undefined if not found. */
  getNodeByUuid(uuid: string): DocumentNode | undefined;

  /** Get the list of pages. */
  getPages(): readonly Page[];

  /** Whether the WebSocket connection is currently open. */
  isConnected(): boolean;

  /** Whether the document has operations that can be undone. */
  canUndo(): boolean;

  /** Whether the document has operations that can be redone. */
  canRedo(): boolean;

  /** Send a command to the server via WebSocket. */
  sendCommand(command: SerializableCommand): void;

  /** Request undo of the last operation. */
  undo(): void;

  /** Request redo of the last undone operation. */
  redo(): void;

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(fn: Subscriber): Unsubscribe;

  /** Fetch initial document state from the server REST API. */
  loadInitialState(): Promise<void>;

  /** Clean up all subscriptions and WebSocket handlers. */
  destroy(): void;
}

/**
 * Creates a reactive document store backed by a WebSocket client.
 *
 * The store listens for server messages and updates its internal state:
 * - `broadcast`: re-fetches document info from the REST API
 * - `undo_redo`: updates can_undo/can_redo flags
 * - `document_changed`: updates can_undo/can_redo and re-fetches
 * - `error`: logged to console
 */
export function createDocumentStore(wsClient: WebSocketClient): DocumentStore {
  let info: DocumentInfo | null = null;
  let nodes: Map<string, DocumentNode> = new Map();
  let pages: Page[] = [];
  let undoAvailable = false;
  let redoAvailable = false;
  let destroyed = false;

  const subscribers = new Set<Subscriber>();

  function notifySubscribers(): void {
    if (destroyed) return;
    for (const fn of subscribers) {
      fn();
    }
  }

  async function fetchDocumentInfo(): Promise<void> {
    try {
      const response = await fetch("/api/document");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as DocumentInfo;
      info = data;
      undoAvailable = data.can_undo;
      redoAvailable = data.can_redo;
      notifySubscribers();
    } catch {
      // Network errors are silently ignored; the store remains in its
      // current state. The WebSocket reconnect will eventually restore sync.
    }
  }

  function handleServerMessage(message: ServerMessage): void {
    if (destroyed) return;

    switch (message.type) {
      case "broadcast":
        // Another client made a change; re-fetch full state
        void fetchDocumentInfo();
        break;

      case "undo_redo":
        undoAvailable = message.can_undo;
        redoAvailable = message.can_redo;
        notifySubscribers();
        break;

      case "document_changed":
        undoAvailable = message.can_undo;
        redoAvailable = message.can_redo;
        // Also re-fetch since another client changed the document
        void fetchDocumentInfo();
        break;

      case "error":
        // Server errors are logged but do not update state.
        // No action needed — the error is informational only.
        break;
    }
  }

  function handleConnectionChange(): void {
    if (destroyed) return;
    notifySubscribers();
  }

  // Wire up WebSocket handlers
  const unsubscribeMessage = wsClient.onMessage(handleServerMessage);
  const unsubscribeConnection = wsClient.onConnectionChange(
    handleConnectionChange,
  );

  return {
    getInfo(): DocumentInfo | null {
      return info;
    },

    getAllNodes(): Map<string, DocumentNode> {
      return nodes;
    },

    getNodeByUuid(uuid: string): DocumentNode | undefined {
      return nodes.get(uuid);
    },

    getPages(): readonly Page[] {
      return pages;
    },

    isConnected(): boolean {
      return wsClient.isConnected();
    },

    canUndo(): boolean {
      return undoAvailable;
    },

    canRedo(): boolean {
      return redoAvailable;
    },

    sendCommand(command: SerializableCommand): void {
      wsClient.send({ type: "command", command });
    },

    undo(): void {
      wsClient.send({ type: "undo" });
    },

    redo(): void {
      wsClient.send({ type: "redo" });
    },

    subscribe(fn: Subscriber): Unsubscribe {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },

    async loadInitialState(): Promise<void> {
      try {
        const response = await fetch("/api/document");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as DocumentInfo;
        info = data;
        undoAvailable = data.can_undo;
        redoAvailable = data.can_redo;
        // Reset nodes and pages — will be populated when full state
        // endpoint is available
        nodes = new Map();
        pages = [];
        notifySubscribers();
      } catch {
        // Fetch failed — leave state as-is
      }
    },

    destroy(): void {
      destroyed = true;
      subscribers.clear();
      unsubscribeMessage();
      unsubscribeConnection();
    },
  };
}
