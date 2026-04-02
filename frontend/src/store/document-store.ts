/**
 * Reactive document store with urql GraphQL integration.
 *
 * Holds the local document state (info, nodes, pages) and provides
 * methods to mutate via GraphQL mutations, undo/redo, and subscribe
 * to state changes. Real-time updates arrive via a GraphQL subscription;
 * on each event the store re-fetches pages and notifies subscribers.
 */

import type { Client } from "urql";
import type { DocumentInfo, DocumentNode, NodeKind, Page, Transform } from "../types/document";
import { PAGES_QUERY } from "../graphql/queries";
import {
  CREATE_NODE_MUTATION,
  DELETE_NODE_MUTATION,
  RENAME_NODE_MUTATION,
  REDO_MUTATION,
  SET_LOCKED_MUTATION,
  SET_TRANSFORM_MUTATION,
  SET_VISIBLE_MUTATION,
  UNDO_MUTATION,
} from "../graphql/mutations";
import { DOCUMENT_CHANGED_SUBSCRIPTION } from "../graphql/subscriptions";

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

// ── GraphQL response shapes (defensive parsing, no `any`) ───────────

interface GqlNodeData {
  readonly uuid: string;
  readonly name: string;
  readonly kind: NodeKind;
  readonly parent: string | null;
  readonly children: readonly string[];
  readonly transform: Transform;
  readonly style: DocumentNode["style"];
  readonly visible: boolean;
  readonly locked: boolean;
}

interface GqlPageData {
  readonly id: string;
  readonly name: string;
  readonly nodes: readonly GqlNodeData[];
}

interface PagesQueryResult {
  readonly pages: readonly GqlPageData[];
}

interface CreateNodeResult {
  readonly createNode: {
    readonly uuid: string;
    readonly node: GqlNodeData;
  };
}

interface UndoRedoResult {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

interface UndoMutationResult {
  readonly undo: UndoRedoResult;
}

interface RedoMutationResult {
  readonly redo: UndoRedoResult;
}

interface DocumentChangedEvent {
  readonly documentChanged: {
    readonly eventType: string;
    readonly uuid: string | null;
    readonly data: unknown;
    readonly senderId: string | null;
  };
}

/**
 * Converts a GraphQL node response into a `DocumentNode`.
 *
 * The `NodeId` is set to `{ index: 0, generation: 0 }` as a placeholder
 * because arena indices are not available on the client.
 */
function gqlNodeToDocumentNode(gn: GqlNodeData): DocumentNode {
  return {
    id: { index: 0, generation: 0 },
    uuid: gn.uuid,
    kind: gn.kind,
    name: gn.name,
    parent: null,
    children: [],
    transform: gn.transform,
    style: gn.style,
    constraints: { horizontal: "start", vertical: "start" },
    grid_placement: null,
    visible: gn.visible,
    locked: gn.locked,
  };
}

/**
 * Type guard to validate that a parsed GraphQL pages result has the
 * expected shape. Defensive parsing per GOV-024.
 */
function isPagesQueryResult(data: unknown): data is PagesQueryResult {
  if (typeof data !== "object" || data === null) return false;
  if (!("pages" in data)) return false;
  const candidate = data as Record<string, unknown>;
  return Array.isArray(candidate["pages"]);
}

/**
 * Type guard for create node mutation result.
 */
function isCreateNodeResult(data: unknown): data is CreateNodeResult {
  if (typeof data !== "object" || data === null) return false;
  if (!("createNode" in data)) return false;
  const candidate = data as Record<string, unknown>;
  const createNode = candidate["createNode"];
  if (typeof createNode !== "object" || createNode === null) return false;
  return "uuid" in createNode && "node" in createNode;
}

/**
 * Type guard for undo mutation result.
 */
function isUndoMutationResult(data: unknown): data is UndoMutationResult {
  if (typeof data !== "object" || data === null) return false;
  if (!("undo" in data)) return false;
  const candidate = data as Record<string, unknown>;
  const undo = candidate["undo"];
  if (typeof undo !== "object" || undo === null) return false;
  return "canUndo" in undo && "canRedo" in undo;
}

/**
 * Type guard for redo mutation result.
 */
function isRedoMutationResult(data: unknown): data is RedoMutationResult {
  if (typeof data !== "object" || data === null) return false;
  if (!("redo" in data)) return false;
  const candidate = data as Record<string, unknown>;
  const redo = candidate["redo"];
  if (typeof redo !== "object" || redo === null) return false;
  return "canUndo" in redo && "canRedo" in redo;
}

/**
 * Type guard for subscription event.
 */
function isDocumentChangedEvent(data: unknown): data is DocumentChangedEvent {
  if (typeof data !== "object" || data === null) return false;
  if (!("documentChanged" in data)) return false;
  const candidate = data as Record<string, unknown>;
  const dc = candidate["documentChanged"];
  if (typeof dc !== "object" || dc === null) return false;
  return "eventType" in dc;
}

/**
 * Creates a reactive document store backed by a urql GraphQL client.
 *
 * The store uses:
 * - `PAGES_QUERY` to load initial state and refresh after changes
 * - Specific mutations for each operation (create, transform, rename, etc.)
 * - `DOCUMENT_CHANGED_SUBSCRIPTION` for real-time updates from other clients
 *
 * Components interact with the store through the pub/sub subscriber pattern
 * (Set<Subscriber> + notifySubscribers). They do not interact with urql directly.
 */
export function createDocumentStore(client: Client): DocumentStore {
  let info: DocumentInfo | null = null;
  let nodes: Map<string, DocumentNode> = new Map();
  let pages: Page[] = [];
  let selectedNodeId: string | null = null;
  let undoAvailable = false;
  let redoAvailable = false;
  let destroyed = false;
  let connected = false;
  let fetchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let subscriptionUnsubscribe: (() => void) | null = null;

  const FETCH_DEBOUNCE_MS = 100;

  const subscribers = new Set<Subscriber>();

  function notifySubscribers(): void {
    if (destroyed) return;
    for (const fn of subscribers) {
      fn();
    }
  }

  /**
   * Fetch pages via GraphQL query and populate the store.
   * Defensive: validates the response shape before using it.
   */
  async function fetchPages(): Promise<void> {
    try {
      const result = await client.query(PAGES_QUERY, {}).toPromise();
      if (result.data && isPagesQueryResult(result.data)) {
        const data = result.data;
        const newNodes = new Map<string, DocumentNode>();
        const newPages: Page[] = [];

        let nodeCount = 0;
        for (const pageEntry of data.pages) {
          newPages.push({
            id: pageEntry.id,
            name: pageEntry.name,
            root_nodes: [],
          });
          for (const gn of pageEntry.nodes) {
            newNodes.set(gn.uuid, gqlNodeToDocumentNode(gn));
            nodeCount++;
          }
        }

        nodes = newNodes;
        pages = newPages;
        info = {
          name: "Document",
          page_count: newPages.length,
          node_count: nodeCount,
          can_undo: undoAvailable,
          can_redo: redoAvailable,
        };

        notifySubscribers();
      }
    } catch {
      // Network errors are silently ignored; the store remains in its
      // current state. The subscription reconnect will eventually restore sync.
    }
  }

  /** Debounced version of fetchPages -- collapses rapid calls into one. */
  function debouncedFetchPages(): void {
    if (fetchDebounceTimer !== null) {
      clearTimeout(fetchDebounceTimer);
    }
    fetchDebounceTimer = setTimeout(() => {
      fetchDebounceTimer = null;
      void fetchPages();
    }, FETCH_DEBOUNCE_MS);
  }

  /** Start the GraphQL subscription for real-time updates. */
  function startSubscription(): void {
    const sub = client.subscription(DOCUMENT_CHANGED_SUBSCRIPTION, {}).subscribe((result) => {
      if (destroyed) return;

      if (!connected) {
        connected = true;
        notifySubscribers();
      }

      if (result.data && isDocumentChangedEvent(result.data)) {
        // On any document change from another client, re-fetch pages
        debouncedFetchPages();
      }
    });

    subscriptionUnsubscribe = sub.unsubscribe;
  }

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
      return connected;
    },

    canUndo(): boolean {
      return undoAvailable;
    },

    canRedo(): boolean {
      return redoAvailable;
    },

    undo(): void {
      void (async () => {
        try {
          const result = await client.mutation(UNDO_MUTATION, {}).toPromise();
          if (result.data && isUndoMutationResult(result.data)) {
            undoAvailable = result.data.undo.canUndo;
            redoAvailable = result.data.undo.canRedo;
            notifySubscribers();
          }
          // Re-fetch pages to reflect the undo
          await fetchPages();
        } catch {
          // Mutation errors are silently ignored
        }
      })();
    },

    redo(): void {
      void (async () => {
        try {
          const result = await client.mutation(REDO_MUTATION, {}).toPromise();
          if (result.data && isRedoMutationResult(result.data)) {
            undoAvailable = result.data.redo.canUndo;
            redoAvailable = result.data.redo.canRedo;
            notifySubscribers();
          }
          // Re-fetch pages to reflect the redo
          await fetchPages();
        } catch {
          // Mutation errors are silently ignored
        }
      })();
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

      // Optimistic insert -- add the node to the local store
      // immediately so the canvas renders it before the server responds.
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

      // Fire-and-forget mutation; on result, update with server data
      void (async () => {
        try {
          const result = await client
            .mutation(CREATE_NODE_MUTATION, {
              kind,
              name,
              pageId,
              transform,
            })
            .toPromise();
          if (result.data && isCreateNodeResult(result.data)) {
            const serverNode = gqlNodeToDocumentNode(result.data.createNode.node);
            nodes.set(uuid, serverNode);
            notifySubscribers();
          }
        } catch {
          // Mutation errors are silently ignored; optimistic node remains
        }
      })();

      return uuid;
    },

    setTransform(uuid: string, transform: Transform): void {
      void client.mutation(SET_TRANSFORM_MUTATION, { uuid, transform }).toPromise();
    },

    renameNode(uuid: string, newName: string): void {
      void client.mutation(RENAME_NODE_MUTATION, { uuid, newName }).toPromise();
    },

    deleteNode(uuid: string): void {
      void client.mutation(DELETE_NODE_MUTATION, { uuid }).toPromise();
    },

    setVisible(uuid: string, visible: boolean): void {
      void client.mutation(SET_VISIBLE_MUTATION, { uuid, visible }).toPromise();
    },

    setLocked(uuid: string, locked: boolean): void {
      void client.mutation(SET_LOCKED_MUTATION, { uuid, locked }).toPromise();
    },

    subscribe(fn: Subscriber): Unsubscribe {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },

    async loadInitialState(): Promise<void> {
      await fetchPages();
      startSubscription();
    },

    destroy(): void {
      destroyed = true;
      connected = false;
      if (fetchDebounceTimer !== null) {
        clearTimeout(fetchDebounceTimer);
        fetchDebounceTimer = null;
      }
      subscribers.clear();
      if (subscriptionUnsubscribe !== null) {
        subscriptionUnsubscribe();
        subscriptionUnsubscribe = null;
      }
    },
  };
}
