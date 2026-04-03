/**
 * DocumentStore interface — the contract that tools use to interact
 * with the document state.
 *
 * Extracted from the old vanilla document-store.ts so that tool
 * implementations (select-tool, shape-tool) and adapters (Canvas.tsx)
 * can depend on the interface without depending on a concrete store
 * implementation.
 */

import type {
  DocumentInfo,
  DocumentNode,
  NodeKind,
  Page,
  Transform,
} from "../types/document";

/** Callback invoked whenever the store state changes. */
export type Subscriber = () => void;

/** Return type for subscribe -- call to unsubscribe. */
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

  /** Whether the GraphQL subscription connection is currently active. */
  isConnected(): boolean;

  /** Whether the document has operations that can be undone. */
  canUndo(): boolean;

  /** Whether the document has operations that can be redone. */
  canRedo(): boolean;

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
   * Create a new node on the server via GraphQL mutation.
   *
   * Generates a UUID locally, inserts an optimistic node, then fires the
   * mutation. On result, updates the node with server data.
   */
  createNode(kind: NodeKind, name: string, transform: Transform): string;

  /** Set the transform of a node via GraphQL mutation. */
  setTransform(uuid: string, transform: Transform): void;

  /** Rename a node via GraphQL mutation. */
  renameNode(uuid: string, newName: string): void;

  /** Delete a node via GraphQL mutation. */
  deleteNode(uuid: string): void;

  /** Set visibility of a node via GraphQL mutation. */
  setVisible(uuid: string, visible: boolean): void;

  /** Set lock state of a node via GraphQL mutation. */
  setLocked(uuid: string, locked: boolean): void;

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(fn: Subscriber): Unsubscribe;

  /** Fetch initial document state via GraphQL query and start subscription. */
  loadInitialState(): Promise<void>;

  /** Clean up all subscriptions and handlers. */
  destroy(): void;
}
