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
import type {
  DocumentInfo,
  DocumentNode,
  FullDocumentResponse,
  NodeKind,
  Page,
  SerializedNode,
  Transform,
} from "../types/document";
import type { ServerMessage } from "../types/messages";

/** Callback invoked whenever the store state changes. */
export type Subscriber = () => void;

/** Return type for subscribe — call to unsubscribe. */
export type Unsubscribe = () => void;

export interface DocumentStore {
  /** Get the current document info, or null if not yet loaded. */
  getInfo(): DocumentInfo | null;

  /** Get all nodes as a Map keyed by UUID. */
  getAllNodes(): ReadonlyMap<string, DocumentNode>;

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

  /** Get the currently selected node UUID, or null if nothing is selected. */
  getSelectedNodeId(): string | null;

  /** Select a node by UUID, or pass null to deselect. */
  select(uuid: string | null): void;

  /** Get the active page (defaults to the first page). */
  getActivePage(): Page | undefined;

  /**
   * Create a new node on the server.
   *
   * Generates a UUID locally, sends a `create_node_request` to the server,
   * and returns the UUID. The server will respond with a `node_created`
   * message containing the assigned NodeId.
   */
  createNode(kind: NodeKind, name: string, transform: Transform): string;

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
 * - `broadcast`: re-fetches full document state from the REST API
 * - `undo_redo`: updates can_undo/can_redo flags
 * - `document_changed`: updates can_undo/can_redo and re-fetches
 * - `node_created`: updates the node's server-assigned NodeId
 * - `error`: logged to console
 */

/**
 * Converts a `SerializedNode` (wire format with UUIDs) into a `DocumentNode`
 * (runtime format with a placeholder `NodeId`).
 *
 * The `NodeId` is set to `{ index: 0, generation: 0 }` as a placeholder
 * because arena indices are not available on the client. The server may
 * later send a `node_created` message with the real `NodeId`.
 */
function serializedNodeToDocumentNode(sn: SerializedNode): DocumentNode {
  return {
    id: { index: 0, generation: 0 },
    uuid: sn.id,
    kind: sn.kind,
    name: sn.name,
    parent: null,
    children: [],
    transform: sn.transform,
    style: sn.style,
    constraints: sn.constraints,
    grid_placement: sn.grid_placement ?? null,
    visible: sn.visible,
    locked: sn.locked,
  };
}

export function createDocumentStore(wsClient: WebSocketClient): DocumentStore {
  let info: DocumentInfo | null = null;
  let nodes: Map<string, DocumentNode> = new Map();
  let pages: Page[] = [];
  let selectedNodeId: string | null = null;
  let undoAvailable = false;
  let redoAvailable = false;
  let destroyed = false;
  let fetchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const FETCH_DEBOUNCE_MS = 100;

  const subscribers = new Set<Subscriber>();

  function notifySubscribers(): void {
    if (destroyed) return;
    for (const fn of subscribers) {
      fn();
    }
  }

  async function fetchFullDocument(): Promise<void> {
    try {
      const response = await fetch("/api/document/full");
      if (!response.ok) {
        return;
      }
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        return;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("info" in parsed) ||
        !("pages" in parsed)
      ) {
        return;
      }
      const data = parsed as FullDocumentResponse;
      info = data.info;
      undoAvailable = data.info.can_undo;
      redoAvailable = data.info.can_redo;

      const newNodes = new Map<string, DocumentNode>();
      const newPages: Page[] = [];
      for (const pageEntry of data.pages) {
        newPages.push({
          id: pageEntry.id,
          name: pageEntry.name,
          root_nodes: [],
        });
        for (const sn of pageEntry.nodes) {
          newNodes.set(sn.id, serializedNodeToDocumentNode(sn));
        }
      }
      nodes = newNodes;
      pages = newPages;

      notifySubscribers();
    } catch {
      // Network errors are silently ignored; the store remains in its
      // current state. The WebSocket reconnect will eventually restore sync.
    }
  }

  /** Debounced version of fetchFullDocument — collapses rapid calls into one. */
  function debouncedFetchFullDocument(): void {
    if (fetchDebounceTimer !== null) {
      clearTimeout(fetchDebounceTimer);
    }
    fetchDebounceTimer = setTimeout(() => {
      fetchDebounceTimer = null;
      void fetchFullDocument();
    }, FETCH_DEBOUNCE_MS);
  }

  function handleServerMessage(message: ServerMessage): void {
    if (destroyed) return;

    switch (message.type) {
      case "broadcast":
        // Another client made a change; re-fetch full state (debounced)
        debouncedFetchFullDocument();
        break;

      case "undo_redo":
        undoAvailable = message.can_undo;
        redoAvailable = message.can_redo;
        notifySubscribers();
        break;

      case "document_changed":
        undoAvailable = message.can_undo;
        redoAvailable = message.can_redo;
        // Also re-fetch since another client changed the document (debounced)
        debouncedFetchFullDocument();
        break;

      case "node_created": {
        // Update the node's NodeId from the server-assigned value.
        const existingNode = nodes.get(message.uuid);
        if (existingNode) {
          nodes.set(message.uuid, { ...existingNode, id: message.node_id });
          notifySubscribers();
        }
        break;
      }

      case "error":
        // Server errors are logged but do not update state.
        // No action needed — the error is informational only.
        break;
    }
  }

  function handleConnectionChange(connected: boolean): void {
    if (destroyed) return;
    if (connected) {
      void fetchFullDocument();
    }
    notifySubscribers();
  }

  // Wire up WebSocket handlers
  const unsubscribeMessage = wsClient.onMessage(handleServerMessage);
  const unsubscribeConnection = wsClient.onConnectionChange(handleConnectionChange);

  return {
    getInfo(): DocumentInfo | null {
      return info;
    },

    getAllNodes(): ReadonlyMap<string, DocumentNode> {
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

    getSelectedNodeId(): string | null {
      return selectedNodeId;
    },

    select(uuid: string | null): void {
      if (selectedNodeId !== uuid) {
        selectedNodeId = uuid;
        notifySubscribers();
      }
    },

    getActivePage(): Page | undefined {
      return pages[0];
    },

    createNode(kind: NodeKind, name: string, transform: Transform): string {
      const uuid = crypto.randomUUID();
      const activePage = pages[0];
      const pageId = activePage ? activePage.id : null;

      // RF-001: Optimistic insert — add the node to the local store
      // immediately so the canvas renders it before the server responds.
      // The NodeId is a placeholder {0,0} until the server sends node_created.
      const optimisticNode: DocumentNode = {
        id: { index: 0, generation: 0 },
        uuid,
        kind,
        name,
        parent: null,
        children: [],
        transform,
        style: {
          fills: [],
          strokes: [],
          opacity: { type: "literal", value: 1 },
          blend_mode: "normal",
          effects: [],
        },
        constraints: { horizontal: "start", vertical: "start" },
        grid_placement: null,
        visible: true,
        locked: false,
      };
      nodes.set(uuid, optimisticNode);
      notifySubscribers();

      wsClient.send({
        type: "create_node_request",
        uuid,
        kind,
        name,
        page_id: pageId,
        transform,
      });
      return uuid;
    },

    subscribe(fn: Subscriber): Unsubscribe {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },

    async loadInitialState(): Promise<void> {
      await fetchFullDocument();
    },

    destroy(): void {
      destroyed = true;
      if (fetchDebounceTimer !== null) {
        clearTimeout(fetchDebounceTimer);
        fetchDebounceTimer = null;
      }
      subscribers.clear();
      unsubscribeMessage();
      unsubscribeConnection();
    },
  };
}
