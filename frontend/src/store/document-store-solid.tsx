import { createSignal, createMemo, batch } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { createClient, cacheExchange, fetchExchange, subscriptionExchange, gql } from "@urql/solid";
import { createClient as createWSClient } from "graphql-ws";
import type {
  DocumentNode,
  Page,
  Transform,
  NodeKind,
  NodeId,
  Fill,
  Stroke,
  Effect,
  BlendMode,
  TextStyle,
} from "../types/document";
import type { Viewport } from "../canvas/viewport";
import { PAGES_QUERY } from "../graphql/queries";
import { APPLY_OPERATIONS_MUTATION } from "../graphql/mutations";
import type { Operation, Transaction, ReparentValue, ReorderValue } from "../operations/types";
import { TRANSACTION_APPLIED_SUBSCRIPTION } from "../graphql/subscriptions";
import { applyRemoteTransaction, type RemoteTransactionPayload } from "../operations/apply-remote";
import { HistoryManager } from "../operations/history-manager";
import { createInterceptor, deepClone as sharedDeepClone } from "../operations/interceptor";
import {
  createCreateNodeOp,
  createDeleteNodeOp,
  createReparentOp,
  createReorderOp,
  createSetFieldOp,
  createCreatePageOp,
  createDeletePageOp,
  createRenamePageOp,
  createReorderPageOp,
} from "../operations/operation-helpers";
import type { TextStylePatch } from "./document-store-types";

// ── Types ──────────────────────────────────────────────────────────────

/** Mutable version of DocumentInfo for use inside createStore. */
interface MutableDocumentInfo {
  name: string;
  page_count: number;
  node_count: number;
  can_undo: boolean;
  can_redo: boolean;
}

/** Mutable version of DocumentNode for use inside createStore. */
type MutableDocumentNode = {
  -readonly [K in keyof DocumentNode]: DocumentNode[K];
} & {
  /** Parent UUID from GraphQL (string, not arena NodeId). */
  parentUuid: string | null;
  /** Children UUIDs from GraphQL (strings, not arena NodeIds). */
  childrenUuids: string[];
};

/** Mutable version of Page for use inside createStore. */
type MutablePage = {
  -readonly [K in keyof Page]: Page[K];
} & {
  /** Root node UUIDs belonging to this page (populated during parsePagesResponse). */
  rootNodeUuids: string[];
};

export interface DocumentState {
  info: MutableDocumentInfo;
  pages: MutablePage[];
  nodes: Record<string, MutableDocumentNode>;
}

export type ToolType = "select" | "frame" | "rectangle" | "ellipse" | "text";

export interface DocumentStoreAPI {
  // Document state (reactive — read inside components/effects to track)
  readonly state: DocumentState;

  // UI signals
  readonly selectedNodeId: () => string | null;
  readonly setSelectedNodeId: (id: string | null) => void;
  readonly selectedNodeIds: () => string[];
  readonly setSelectedNodeIds: (ids: string[]) => void;
  /** RF-004: Memoized Set for O(1) lookup — avoids O(n) .includes() per TreeNode. */
  readonly isNodeSelected: (uuid: string) => boolean;
  readonly activeTool: () => ToolType;
  readonly setActiveTool: (tool: ToolType) => void;
  readonly viewport: () => Viewport;
  readonly setViewport: (vp: Viewport) => void;
  readonly connected: () => boolean;

  // Derived
  readonly canUndo: () => boolean;
  readonly canRedo: () => boolean;

  // Mutations
  createNode(kind: NodeKind, name: string, transform: Transform): string;
  setTransform(uuid: string, transform: Transform): void;
  renameNode(uuid: string, newName: string): void;
  deleteNode(uuid: string): void;
  setVisible(uuid: string, visible: boolean): void;
  setLocked(uuid: string, locked: boolean): void;
  reparentNode(uuid: string, newParentUuid: string, position: number): void;
  reorderChildren(uuid: string, newPosition: number): void;
  setOpacity(uuid: string, opacity: number): void;
  setBlendMode(uuid: string, blendMode: BlendMode): void;
  setFills(uuid: string, fills: Fill[]): void;
  setStrokes(uuid: string, strokes: Stroke[]): void;
  setEffects(uuid: string, effects: Effect[]): void;
  setCornerRadii(uuid: string, radii: [number, number, number, number]): void;
  setTextContent(uuid: string, content: string): void;
  setTextStyle(uuid: string, patch: TextStylePatch): void;
  batchSetTransform(entries: Array<{ uuid: string; transform: Transform }>): void;
  groupNodes(uuids: string[], name: string): void;
  ungroupNodes(uuids: string[]): void;
  undo(): void;
  redo(): void;
  /**
   * Flush the interceptor's pending coalesce buffer, committing any buffered
   * changes as a single undo entry. Used at gesture boundaries (drag start/end)
   * to ensure continuous-value controls coalesce correctly. See CLAUDE.md
   * "Continuous-Value Controls Must Coalesce History Entries".
   */
  flushHistory(): void;

  // Page mutations
  createPage(name: string): void;
  deletePage(pageId: string): void;
  renamePage(pageId: string, newName: string): void;
  reorderPages(pageId: string, newPosition: number): void;
  setActivePage(pageId: string): void;
  readonly activePageId: () => string | null;

  // Lifecycle
  destroy(): void;
}

// ── Constants ─────────────────────────────────────────────────────────

const PLACEHOLDER_NODE_ID: NodeId = { index: 0, generation: 0 };
const MAX_NODE_NAME_LENGTH = 1024;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RF-021: Maximum text content length in characters. */
const MAX_TEXT_CONTENT_LENGTH = 1_000_000;

/** Maximum page name length — matches crates/core/src/validate.rs MAX_PAGE_NAME_LEN. */
export const MAX_PAGE_NAME_LENGTH = 256;

/** Maximum pages per document — matches crates/core/src/validate.rs MAX_PAGES_PER_DOCUMENT. */
const MAX_PAGES_PER_DOCUMENT = 100;

/** Minimum pages per document — at least one page must exist. */
const MIN_PAGES_PER_DOCUMENT = 1;

// RF-028: deepClone is imported from operations/interceptor as sharedDeepClone.
// Alias it as deepClone for local use to keep call sites unchanged.
const deepClone = sharedDeepClone;

// ── Parse GraphQL response ────────────────────────────────────────────

function parseNode(raw: Record<string, unknown>): MutableDocumentNode {
  const rawName = raw["name"] as string;
  const name = typeof rawName === "string" ? rawName.slice(0, MAX_NODE_NAME_LENGTH) : "";

  // GraphQL returns parent as a UUID string (or null) and children as UUID string array.
  // Preserve these for tree rendering.
  const rawParent = raw["parent"];
  const parentUuid = typeof rawParent === "string" && UUID_REGEX.test(rawParent) ? rawParent : null;

  const rawChildren = raw["children"];
  const childrenUuids: string[] = Array.isArray(rawChildren)
    ? (rawChildren as unknown[]).filter(
        (c): c is string => typeof c === "string" && UUID_REGEX.test(c),
      )
    : [];

  return {
    id: PLACEHOLDER_NODE_ID,
    uuid: raw["uuid"] as string,
    kind: raw["kind"] as NodeKind,
    name,
    parent: null,
    children: [],
    transform: raw["transform"] as Transform,
    style: raw["style"] as DocumentNode["style"],
    constraints: { horizontal: "start", vertical: "start" },
    grid_placement: null,
    visible: raw["visible"] as boolean,
    locked: raw["locked"] as boolean,
    parentUuid,
    childrenUuids,
  };
}

function parsePagesResponse(data: unknown): {
  pages: MutablePage[];
  nodes: Record<string, MutableDocumentNode>;
} {
  const pages: MutablePage[] = [];
  const nodes: Record<string, MutableDocumentNode> = {};

  if (!data || typeof data !== "object") return { pages, nodes };
  const pagesRaw = (data as Record<string, unknown>)["pages"];
  if (!Array.isArray(pagesRaw)) return { pages, nodes };

  for (const pageRaw of pagesRaw) {
    if (!pageRaw || typeof pageRaw !== "object") continue;
    const p = pageRaw as Record<string, unknown>;
    const pageNodes = Array.isArray(p["nodes"]) ? p["nodes"] : [];
    const rootNodeIds: NodeId[] = [];
    const rootNodeUuids: string[] = [];

    for (const nodeRaw of pageNodes) {
      if (!nodeRaw || typeof nodeRaw !== "object") continue;
      const n = nodeRaw as Record<string, unknown>;
      const uuid = n["uuid"] as string;
      if (!uuid || typeof uuid !== "string" || !UUID_REGEX.test(uuid)) continue;
      nodes[uuid] = parseNode(n);
      rootNodeIds.push(PLACEHOLDER_NODE_ID);
      // Track root nodes: nodes without a parentUuid belong to this page's root.
      const parentUuid = n["parent"];
      if (parentUuid === null || parentUuid === undefined) {
        rootNodeUuids.push(uuid);
      }
    }

    pages.push({
      id: p["id"] as string,
      name: p["name"] as string,
      root_nodes: rootNodeIds,
      rootNodeUuids,
    });
  }

  return { pages, nodes };
}

// ── Server operation mapping ──────────────────────────────────────────

/**
 * Convert a Transaction's operations into server OperationInput format
 * for the applyOperations mutation.
 */
function transactionToServerOps(tx: Transaction): Record<string, unknown>[] {
  // Collect UUIDs of nodes being deleted in this transaction.
  // Field changes on soon-to-be-deleted nodes are pointless and cause
  // "node not found" errors if the delete is processed first.
  const deletedUuids = new Set<string>();
  for (const op of tx.operations) {
    if (op.type === "delete_node") {
      deletedUuids.add(op.nodeUuid);
    }
  }

  // Similarly, collect UUIDs of nodes being created — field changes on
  // these nodes (like setTransform after create) should come AFTER the create.
  // We reorder: creates first, then field changes, then deletes last.
  const creates: Record<string, unknown>[] = [];
  const fieldOps: Record<string, unknown>[] = [];
  const deletes: Record<string, unknown>[] = [];
  const structuralOther: Record<string, unknown>[] = []; // reparent, reorder

  for (const op of tx.operations) {
    // Skip field changes on nodes being deleted in this batch
    if (op.type === "set_field" && deletedUuids.has(op.nodeUuid)) {
      continue;
    }

    const mapped = operationToServerOp(op);
    if (!mapped) continue;

    switch (op.type) {
      case "create_node":
        creates.push(mapped);
        break;
      case "delete_node":
        deletes.push(mapped);
        break;
      case "set_field":
        fieldOps.push(mapped);
        break;
      default: // reparent, reorder
        structuralOther.push(mapped);
        break;
    }
  }

  // Order: creates → field changes → reparent/reorder → deletes
  return [...creates, ...fieldOps, ...structuralOther, ...deletes];
}

function operationToServerOp(op: Operation): Record<string, unknown> | null {
  switch (op.type) {
    case "set_field":
      return {
        setField: {
          nodeUuid: op.nodeUuid,
          path: op.path,
          value: JSON.stringify(op.value),
        },
      };
    case "create_node": {
      const nodeData = op.value as Record<string, unknown>;
      return {
        createNode: {
          nodeUuid: (nodeData["uuid"] as string) ?? "",
          kind: JSON.stringify(nodeData["kind"]),
          name: (nodeData["name"] as string) ?? "",
          transform: JSON.stringify(nodeData["transform"]),
          pageId: null,
        },
      };
    }
    case "delete_node":
      return {
        deleteNode: {
          nodeUuid: op.nodeUuid,
        },
      };
    case "reparent": {
      const rv = op.value as ReparentValue;
      return {
        reparent: {
          nodeUuid: op.nodeUuid,
          newParentUuid: rv.parentUuid,
          position: rv.position,
        },
      };
    }
    case "reorder": {
      const reorder = op.value as ReorderValue;
      return {
        reorder: {
          nodeUuid: op.nodeUuid,
          newPosition: reorder.position,
        },
      };
    }
    case "create_page": {
      const pageData = op.value as { id: string; name: string };
      return {
        createPage: {
          pageUuid: pageData.id,
          name: pageData.name,
        },
      };
    }
    case "delete_page":
      return {
        deletePage: {
          pageId: op.nodeUuid,
        },
      };
    case "rename_page": {
      const renameData = op.value as { name: string };
      return {
        renamePage: {
          pageId: op.nodeUuid,
          newName: renameData.name,
        },
      };
    }
    case "reorder_page": {
      const reorderData = op.value as { position: number };
      return {
        reorderPage: {
          pageId: op.nodeUuid,
          newPosition: reorderData.position,
        },
      };
    }
  }
}

// ── Store factory ─────────────────────────────────────────────────────

export function createDocumentStoreSolid(): DocumentStoreAPI {
  // RF-010: Visible error notifications deferred until toast/notification system
  // is implemented. console.error provides diagnostic trail per CLAUDE.md
  // minimum requirement.

  // Client session ID for self-echo suppression (RF-004)
  const clientSessionId = crypto.randomUUID();

  // urql client
  const httpUrl = `${window.location.origin}/graphql`;
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${window.location.host}/graphql/ws`;

  // Document state
  const [state, setState] = createStore<DocumentState>({
    info: { name: "", page_count: 0, node_count: 0, can_undo: false, can_redo: false },
    pages: [],
    nodes: {},
  });

  // ── History Manager ───────────────────────────────────────────────────
  const historyManager = new HistoryManager(clientSessionId);

  // ── Interceptor ───────────────────────────────────────────────────────

  // RF-026: Pending server ops accumulated during the coalesce window.
  // Sent in a single batch when the interceptor commits (onCommit callback).
  let pendingServerOps: Record<string, unknown>[] = [];

  // RF-003: onCommit callback syncs canUndo/canRedo signals after every commit,
  // undo, and redo. Also flushes pending server ops (RF-026).
  function onInterceptorCommit(): void {
    syncHistorySignals();
    if (pendingServerOps.length > 0) {
      const ops = pendingServerOps;
      pendingServerOps = [];
      sendOps(ops);
    }
  }

  const interceptor = createInterceptor(
    state as unknown as Record<string, unknown>,
    setState as unknown as import("../operations/apply-to-store").StoreStateSetter,
    historyManager,
    clientSessionId,
    onInterceptorCommit,
  );

  // UI signals — multi-select with backwards-compatible single-select accessors
  const [selectedNodeIds, setSelectedNodeIds] = createSignal<string[]>([]);
  const selectedNodeId = (): string | null => selectedNodeIds()[0] ?? null;
  const setSelectedNodeId = (id: string | null): void => {
    setSelectedNodeIds(id ? [id] : []);
  };
  // RF-004: Memoized Set for O(1) lookup — avoids O(n) .includes() per TreeNode.
  const selectedNodeIdsSet = createMemo((): ReadonlySet<string> => new Set(selectedNodeIds()));
  const isNodeSelected = (uuid: string): boolean => selectedNodeIdsSet().has(uuid);
  const [activeTool, setActiveTool] = createSignal<ToolType>("select");
  const [viewport, setViewport] = createSignal<Viewport>({
    x: 0,
    y: 0,
    zoom: 1,
  });
  const [connected, setConnected] = createSignal(false);
  const [activePageId, setActivePageId] = createSignal<string | null>(null);

  // RF-012: Reactive undo/redo availability signals.
  // HistoryManager is a plain class — its canUndo()/canRedo() don't trigger Solid reactivity.
  // We maintain signals that are synced after every history-mutating operation.
  const [canUndoSignal, setCanUndoSignal] = createSignal(false);
  const [canRedoSignal, setCanRedoSignal] = createSignal(false);
  /** Sync the reactive signals with the current interceptor/HistoryManager state. */
  function syncHistorySignals(): void {
    setCanUndoSignal(interceptor.canUndo());
    setCanRedoSignal(interceptor.canRedo());
  }
  const canUndo = canUndoSignal;
  const canRedo = canRedoSignal;

  // Wire side-effect readers for undo/redo context restoration
  interceptor.setSideEffectReaders({
    getSelectedNodeIds: () => selectedNodeIds(),
    setSelectedNodeIds,
    getActiveTool: () => activeTool(),
    setActiveTool,
    getViewport: () => viewport(),
    setViewport,
  });

  // ── WebSocket client with connection tracking (RF-025) ──────────────

  const wsClient = createWSClient({
    url: wsUrl,
    on: {
      connected: () => {
        setConnected(true);
      },
      closed: () => {
        setConnected(false);
      },
    },
  });

  const client = createClient({
    url: httpUrl,
    fetchOptions: { method: "POST" },
    exchanges: [
      cacheExchange,
      subscriptionExchange({
        forwardSubscription(request) {
          const input = { ...request, query: request.query || "" };
          return {
            subscribe(sink) {
              const unsubscribe = wsClient.subscribe(input, sink);
              return { unsubscribe };
            },
          };
        },
      }),
      fetchExchange,
    ],
  });

  // ── Fetch pages ──────────────────────────────────────────────────────

  async function fetchPages(): Promise<void> {
    try {
      const result = await client.query(gql(PAGES_QUERY), {}).toPromise();
      if (result.error) {
        console.error("fetchPages error:", result.error.message);
        return;
      }
      if (!result.data) return;

      const { pages, nodes } = parsePagesResponse(result.data);
      batch(() => {
        setState("pages", reconcile(pages));
        setState("nodes", reconcile(nodes));
        setState("info", "node_count", Object.keys(nodes).length);
        setState("info", "page_count", pages.length);
        // Initialize activePageId to the first page if not already set
        // or if the current active page no longer exists.
        const currentActive = activePageId();
        const activeStillExists =
          currentActive !== null && pages.some((p) => p.id === currentActive);
        if (!activeStillExists && pages.length > 0) {
          setActivePageId(pages[0].id);
        }
      });
    } catch (err) {
      console.error("fetchPages exception:", err);
    }
  }

  // Track last received sequence number for future reconnect protocol (Plan 15d)
  // @ts-expect-error -- lastSeq is written but read will be used in reconnect/gap-fill protocol
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let _lastSeq = 0;

  // ── Subscription (RF-002: capture for cleanup, RF-004: self-echo) ───

  const subscriptionHandle = client
    .subscription(gql(TRANSACTION_APPLIED_SUBSCRIPTION), {})
    .subscribe((result) => {
      if (result.error) {
        console.error("subscription error:", result.error.message);
        return;
      }

      const data = result.data as Record<string, unknown> | undefined;
      if (!data?.transactionApplied) return;

      const payload = data.transactionApplied as RemoteTransactionPayload;

      _lastSeq = applyRemoteTransaction(
        payload,
        clientSessionId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DocumentState is structurally compatible with StoreState
        setState as any,
        (uuid: string) => state.nodes[uuid],
        fetchPages,
      );
    });

  // Initial load
  void fetchPages();

  // ── Send operations to server ──────────────────────────────────────

  // RF-002: On server error, resync state via fetchPages() — this is the simplest
  // correct approach (full refetch on error). The optimistic local state may have
  // diverged from the server, so a full refetch is the safe recovery path.
  function sendOps(operations: Record<string, unknown>[]): void {
    client
      .mutation(gql(APPLY_OPERATIONS_MUTATION), {
        operations,
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("applyOperations error:", r.error.message);
          void fetchPages();
        }
      })
      .catch((err: unknown) => {
        console.error("applyOperations exception:", err);
        void fetchPages();
      });
  }

  // ── Mutations ────────────────────────────────────────────────────────

  // TODO(RF-005): createNode redo UUID mismatch — when a createNode is undone then
  // redone, the redo re-applies the operation with the original optimistic UUID, but
  // the server will assign a new UUID. The redo path needs to handle UUID remapping
  // similar to the initial create success handler. Deferred to Phase 15d.
  function createNode(kind: NodeKind, name: string, transform: Transform): string {
    const optimisticUuid = crypto.randomUUID();
    const pageId = state.pages[0]?.id ?? null;

    const nodeData: MutableDocumentNode = {
      id: PLACEHOLDER_NODE_ID,
      uuid: optimisticUuid,
      kind,
      name: name.slice(0, MAX_NODE_NAME_LENGTH),
      parent: null,
      children: [],
      transform,
      style: {
        fills: [],
        strokes: [],
        opacity: { type: "literal" as const, value: 1 },
        blend_mode: "normal" as const,
        effects: [],
      },
      constraints: { horizontal: "start", vertical: "start" },
      grid_placement: null,
      visible: true,
      locked: false,
      parentUuid: null,
      childrenUuids: [],
    };

    // Apply to store
    setState(
      produce((s) => {
        s.nodes[optimisticUuid] = nodeData;
      }),
    );

    // Track structural operation for undo
    interceptor.trackStructural(createCreateNodeOp(clientSessionId, nodeData));

    // Structural ops send immediately — they MUST reach the server before any
    // undo attempt. Field changes (coalesced via pendingServerOps) can be deferred,
    // but create/delete cannot.
    sendOps([
      {
        createNode: {
          nodeUuid: optimisticUuid,
          kind: JSON.stringify(kind),
          name,
          transform: JSON.stringify(transform),
          pageId,
        },
      },
    ]);

    return optimisticUuid;
  }

  // RF-003: setTransform is called once per drag on pointerUp (not during drag),
  // so the interceptor.set call creates exactly one undo entry per drag. The select
  // tool uses local preview transforms during drag, not store mutations.
  function setTransform(uuid: string, transform: Transform): void {
    const node = state.nodes[uuid];
    if (!node) return;

    interceptor.set(uuid, "transform", { ...transform });
    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      setField: {
        nodeUuid: uuid,
        path: "transform",
        value: JSON.stringify(transform),
      },
    });
  }

  function renameNode(uuid: string, newName: string): void {
    const node = state.nodes[uuid];
    if (!node) return;

    interceptor.set(uuid, "name", newName);
    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      setField: {
        nodeUuid: uuid,
        path: "name",
        value: JSON.stringify(newName),
      },
    });
  }

  function deleteNode(uuid: string): void {
    const node = state.nodes[uuid];
    if (!node) return;

    const previousNode = deepClone(node);

    // Remove from store
    setState(
      produce((s) => {
        Reflect.deleteProperty(s.nodes, uuid);
      }),
    );

    // Track structural operation for undo
    interceptor.trackStructural(createDeleteNodeOp(clientSessionId, uuid, previousNode));

    // Clear selection if the deleted node was selected
    const filteredIds = selectedNodeIds().filter((id) => id !== uuid);
    if (filteredIds.length !== selectedNodeIds().length) {
      setSelectedNodeIds(filteredIds);
    }

    // Structural ops send immediately (not coalesced) — must reach server
    // before any undo attempt.
    sendOps([{ deleteNode: { nodeUuid: uuid } }]);
  }

  function setVisible(uuid: string, visible: boolean): void {
    const node = state.nodes[uuid];
    if (!node) return;

    interceptor.set(uuid, "visible", visible);
    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      setField: {
        nodeUuid: uuid,
        path: "visible",
        value: JSON.stringify(visible),
      },
    });
  }

  function setLocked(uuid: string, locked: boolean): void {
    const node = state.nodes[uuid];
    if (!node) return;

    interceptor.set(uuid, "locked", locked);
    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      setField: {
        nodeUuid: uuid,
        path: "locked",
        value: JSON.stringify(locked),
      },
    });
  }

  function reparentNode(uuid: string, newParentUuid: string, position: number): void {
    if (!Number.isFinite(position)) return;
    // RF-021: Reject negative positions instead of silently clamping
    if (position < 0) {
      console.error(`reparentNode: negative position ${position} for node ${uuid}`);
      return;
    }
    const roundedPos = Math.round(position);
    const node = state.nodes[uuid];
    if (!node) return;

    const oldParentUuid = node.parentUuid;

    // Determine old position within old parent
    const oldPosition = oldParentUuid
      ? (state.nodes[oldParentUuid]?.childrenUuids ?? []).indexOf(uuid)
      : 0;

    // Apply to store: update parentUuid and childrenUuids
    setState(
      produce((s) => {
        // Remove from old parent's children
        if (oldParentUuid && s.nodes[oldParentUuid]) {
          s.nodes[oldParentUuid].childrenUuids = s.nodes[oldParentUuid].childrenUuids.filter(
            (id) => id !== uuid,
          );
        }
        // Add to new parent's children
        if (s.nodes[newParentUuid]) {
          const children = [...s.nodes[newParentUuid].childrenUuids];
          children.splice(roundedPos, 0, uuid);
          s.nodes[newParentUuid].childrenUuids = children;
        }
        // Update the node's parent reference
        if (s.nodes[uuid]) {
          s.nodes[uuid].parentUuid = newParentUuid;
        }
      }),
    );

    // Track structural operation for undo
    interceptor.trackStructural(
      createReparentOp(
        clientSessionId,
        uuid,
        newParentUuid,
        roundedPos,
        oldParentUuid ?? "",
        Math.max(0, oldPosition),
      ),
    );

    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      reparent: {
        nodeUuid: uuid,
        newParentUuid,
        position: roundedPos,
      },
    });
  }

  function reorderChildren(uuid: string, newPosition: number): void {
    if (!Number.isFinite(newPosition)) return;
    // RF-021: Reject negative positions instead of silently clamping
    if (newPosition < 0) {
      console.error(`reorderChildren: negative position ${newPosition} for node ${uuid}`);
      return;
    }
    const roundedPos = Math.round(newPosition);
    const node = state.nodes[uuid];
    if (!node) return;
    const parentUuid = node.parentUuid;
    if (!parentUuid) return;

    // Determine old position within parent
    const oldPosition = (state.nodes[parentUuid]?.childrenUuids ?? []).indexOf(uuid);

    // Apply to store: reorder within parent's children
    setState(
      produce((s) => {
        if (s.nodes[parentUuid]) {
          const children = s.nodes[parentUuid].childrenUuids.filter((id) => id !== uuid);
          children.splice(roundedPos, 0, uuid);
          s.nodes[parentUuid].childrenUuids = children;
        }
      }),
    );

    // Track structural operation for undo
    interceptor.trackStructural(
      createReorderOp(clientSessionId, uuid, roundedPos, Math.max(0, oldPosition)),
    );

    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      reorder: {
        nodeUuid: uuid,
        newPosition: roundedPos,
      },
    });
  }

  function setOpacity(uuid: string, opacity: number): void {
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return;

    const node = state.nodes[uuid];
    if (!node) return;

    interceptor.set(uuid, "style.opacity", { type: "literal", value: opacity });
    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      setField: {
        nodeUuid: uuid,
        path: "style.opacity",
        value: JSON.stringify({ type: "literal", value: opacity }),
      },
    });
  }

  function setBlendMode(uuid: string, blendMode: BlendMode): void {
    const node = state.nodes[uuid];
    if (!node) return;

    interceptor.set(uuid, "style.blend_mode", blendMode);
    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      setField: {
        nodeUuid: uuid,
        path: "style.blend_mode",
        value: JSON.stringify(blendMode),
      },
    });
  }

  function setFills(uuid: string, fills: Fill[]): void {
    const node = state.nodes[uuid];
    if (!node) return;

    let clonedFills: Fill[];
    try {
      clonedFills = deepClone(fills);
    } catch {
      console.error("setFills: failed to clone fills");
      return;
    }

    interceptor.set(uuid, "style.fills", clonedFills);
    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      setField: {
        nodeUuid: uuid,
        path: "style.fills",
        value: JSON.stringify(clonedFills),
      },
    });
  }

  function setStrokes(uuid: string, strokes: Stroke[]): void {
    const node = state.nodes[uuid];
    if (!node) return;

    let clonedStrokes: Stroke[];
    try {
      clonedStrokes = deepClone(strokes);
    } catch {
      console.error("setStrokes: failed to clone strokes");
      return;
    }

    interceptor.set(uuid, "style.strokes", clonedStrokes);
    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      setField: {
        nodeUuid: uuid,
        path: "style.strokes",
        value: JSON.stringify(clonedStrokes),
      },
    });
  }

  function setEffects(uuid: string, effects: Effect[]): void {
    const node = state.nodes[uuid];
    if (!node) return;

    let clonedEffects: Effect[];
    try {
      clonedEffects = deepClone(effects);
    } catch {
      console.error("setEffects: failed to clone effects");
      return;
    }

    interceptor.set(uuid, "style.effects", clonedEffects);
    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      setField: {
        nodeUuid: uuid,
        path: "style.effects",
        value: JSON.stringify(clonedEffects),
      },
    });
  }

  function setCornerRadii(uuid: string, radii: [number, number, number, number]): void {
    // Validate all 4 values are finite and non-negative
    for (const r of radii) {
      if (!Number.isFinite(r) || r < 0) return;
    }

    // Early return if node is not a rectangle — before snapshot to avoid spurious mutations
    const node = state.nodes[uuid];
    if (!node || node.kind.type !== "rectangle") return;

    // JSON clone: Solid proxy not structuredClone-safe
    const previousKind = deepClone(node.kind);
    const newKind = { ...previousKind, corner_radii: radii };

    interceptor.set(uuid, "kind", newKind);
    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      setField: {
        nodeUuid: uuid,
        path: "kind",
        value: JSON.stringify(newKind),
      },
    });
  }

  function setTextContent(uuid: string, content: string): void {
    const node = state.nodes[uuid];
    if (!node || node.kind.type !== "text") return;

    // RF-021: Reject content exceeding maximum length.
    if (content.length > MAX_TEXT_CONTENT_LENGTH) return;

    // RF-023: Wrap deepClone in try-catch — Solid proxy cloning may fail.
    let previousKind: typeof node.kind;
    try {
      previousKind = deepClone(node.kind);
    } catch (err: unknown) {
      console.error("setTextContent: deepClone failed", err);
      return;
    }
    const newKind = { ...previousKind, content };

    interceptor.set(uuid, "kind", newKind);
    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      setField: {
        nodeUuid: uuid,
        path: "kind.content",
        value: JSON.stringify(content),
      },
    });
  }

  function setTextStyle(uuid: string, patch: TextStylePatch): void {
    const node = state.nodes[uuid];
    if (!node || node.kind.type !== "text") return;

    // RF-023: Wrap deepClone in try-catch — Solid proxy cloning may fail.
    let previousKind: typeof node.kind;
    try {
      previousKind = deepClone(node.kind);
    } catch (err: unknown) {
      console.error("setTextStyle: deepClone failed", err);
      return;
    }
    // JSON clone: Solid proxy not structuredClone-safe
    let clonedTextStyle: TextStyle;
    try {
      clonedTextStyle = JSON.parse(JSON.stringify(previousKind.text_style)) as TextStyle;
    } catch (err: unknown) {
      console.error("setTextStyle: JSON clone failed", err);
      return;
    }
    const updatedTextStyle: TextStyle = { ...clonedTextStyle, [patch.field]: patch.value };
    const newKind = { ...previousKind, text_style: updatedTextStyle };

    interceptor.set(uuid, "kind", newKind);
    const path = `kind.text_style.${patch.field}`;
    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      setField: {
        nodeUuid: uuid,
        path,
        value: JSON.stringify(patch.value),
      },
    });
  }

  function batchSetTransform(entries: Array<{ uuid: string; transform: Transform }>): void {
    // RF-038: Reject non-finite transform values at the store boundary.
    // NaN/Infinity would propagate silently through the optimistic update and
    // corrupt the document state.
    for (const entry of entries) {
      const t = entry.transform;
      if (
        !Number.isFinite(t.x) ||
        !Number.isFinite(t.y) ||
        !Number.isFinite(t.width) ||
        !Number.isFinite(t.height) ||
        !Number.isFinite(t.rotation) ||
        !Number.isFinite(t.scale_x) ||
        !Number.isFinite(t.scale_y)
      ) {
        console.error("batchSetTransform: non-finite transform for", entry.uuid, t);
        return;
      }
    }

    let opsApplied = 0;

    for (const entry of entries) {
      const node = state.nodes[entry.uuid];
      if (!node) continue;

      interceptor.set(entry.uuid, "transform", { ...entry.transform });
      // RF-026: Queue server op — sent when interceptor commits (coalesced)
      pendingServerOps.push({
        setField: {
          nodeUuid: entry.uuid,
          path: "transform",
          value: JSON.stringify(entry.transform),
        },
      });
      opsApplied++;
    }

    // No-op guard: avoid empty commit
    if (opsApplied === 0) return;
  }

  // NOTE: groupNodes is implemented as a client-side compound operation.
  // We compute the bounding box locally, create the group node optimistically,
  // and send all operations in one batch.
  function groupNodes(uuids: string[], name: string): void {
    if (uuids.length === 0) return;

    // Compute bounding box from selected nodes
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const uuid of uuids) {
      const node = state.nodes[uuid];
      if (!node) continue;
      const t = node.transform;
      minX = Math.min(minX, t.x);
      minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x + t.width);
      maxY = Math.max(maxY, t.y + t.height);
    }

    if (!Number.isFinite(minX)) return; // no valid nodes

    const groupUuid = crypto.randomUUID();
    const groupTransform: Transform = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
    };

    // RF-004: Capture each child's parentUuid and position BEFORE the produce() call
    // that mutates the store. After produce(), node.parentUuid will have changed.
    const childSnapshots: Array<{ childUuid: string; oldParentUuid: string; oldPosition: number }> =
      [];
    for (let i = 0; i < uuids.length; i++) {
      const childNode = state.nodes[uuids[i]];
      if (!childNode) continue;
      const parentUuid = childNode.parentUuid ?? "";
      const oldPosition = parentUuid
        ? (state.nodes[parentUuid]?.childrenUuids ?? []).indexOf(uuids[i])
        : 0;
      childSnapshots.push({
        childUuid: uuids[i],
        oldParentUuid: parentUuid,
        oldPosition: Math.max(0, oldPosition),
      });
    }

    const groupNodeData: MutableDocumentNode = {
      id: PLACEHOLDER_NODE_ID,
      uuid: groupUuid,
      kind: { type: "frame" as const, layout: null },
      name: name.slice(0, MAX_NODE_NAME_LENGTH),
      parent: null,
      children: [],
      transform: groupTransform,
      style: {
        fills: [],
        strokes: [],
        opacity: { type: "literal" as const, value: 1 },
        blend_mode: "normal" as const,
        effects: [],
      },
      constraints: { horizontal: "start", vertical: "start" },
      grid_placement: null,
      visible: true,
      locked: false,
      parentUuid: null,
      childrenUuids: [...uuids],
    };

    // Apply to store: create group, reparent children, adjust transforms
    setState(
      produce((s) => {
        s.nodes[groupUuid] = groupNodeData;
        for (let i = 0; i < uuids.length; i++) {
          const childUuid = uuids[i];
          if (s.nodes[childUuid]) {
            // Remove from old parent
            const oldParent = s.nodes[childUuid].parentUuid;
            if (oldParent && s.nodes[oldParent]) {
              s.nodes[oldParent].childrenUuids = s.nodes[oldParent].childrenUuids.filter(
                (id) => id !== childUuid,
              );
            }
            // Set new parent
            s.nodes[childUuid].parentUuid = groupUuid;

            // RF-006: Adjust child transforms to be relative to group origin.
            // JSON clone: Solid proxy not structuredClone-safe
            const oldTransform = JSON.parse(
              JSON.stringify(s.nodes[childUuid].transform),
            ) as Transform;
            s.nodes[childUuid].transform = {
              ...oldTransform,
              x: oldTransform.x - groupTransform.x,
              y: oldTransform.y - groupTransform.y,
            };
          }
        }
      }),
    );

    // Track structural: create group + reparent each child + transform adjustments
    interceptor.trackStructural(createCreateNodeOp(clientSessionId, deepClone(groupNodeData)));
    for (const snap of childSnapshots) {
      interceptor.trackStructural(
        createReparentOp(
          clientSessionId,
          snap.childUuid,
          groupUuid,
          childSnapshots.indexOf(snap),
          snap.oldParentUuid,
          snap.oldPosition,
        ),
      );
      // RF-006: Track the transform adjustment as a set_field operation for undo.
      const childNode = state.nodes[snap.childUuid];
      if (childNode) {
        const newTransform = deepClone(childNode.transform);
        // The old transform is the current (adjusted) + group offset
        const oldTransform: Transform = {
          ...newTransform,
          x: newTransform.x + groupTransform.x,
          y: newTransform.y + groupTransform.y,
        };
        interceptor.trackStructural(
          createSetFieldOp(
            clientSessionId,
            snap.childUuid,
            "transform",
            newTransform,
            oldTransform,
          ),
        );
      }
    }

    // RF-026: Queue server ops — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      createNode: {
        nodeUuid: groupUuid,
        kind: JSON.stringify({ type: "frame" }),
        name,
        transform: JSON.stringify(groupTransform),
        pageId: state.pages[0]?.id ?? null,
      },
    });
    for (let i = 0; i < uuids.length; i++) {
      pendingServerOps.push({
        reparent: {
          nodeUuid: uuids[i],
          newParentUuid: groupUuid,
          position: i,
        },
      });
      // RF-006: Also send transform adjustment to server
      const childNode = state.nodes[uuids[i]];
      if (childNode) {
        pendingServerOps.push({
          setField: {
            nodeUuid: uuids[i],
            path: "transform",
            value: JSON.stringify(childNode.transform),
          },
        });
      }
    }

    setSelectedNodeIds([groupUuid]);
    syncHistorySignals();
  }

  // NOTE: ungroupNodes dissolves groups by reparenting children out and deleting the group.
  function ungroupNodes(uuids: string[]): void {
    if (uuids.length === 0) return;

    const allChildUuids: string[] = [];

    for (const groupUuid of uuids) {
      const groupNode = state.nodes[groupUuid];
      if (!groupNode) continue;

      const children = [...groupNode.childrenUuids];
      const groupParent = groupNode.parentUuid;
      const groupTransform = deepClone(groupNode.transform);
      const groupSnapshot = deepClone(groupNode);

      // RF-005: Handle root-level groups (no parent).
      // When group has no parent, children become page roots (parentUuid = null).
      // We skip reparent server ops for root-level groups and just delete the group.

      // Reparent children to group's parent (or root)
      setState(
        produce((s) => {
          for (let i = 0; i < children.length; i++) {
            const childUuid = children[i];
            if (s.nodes[childUuid]) {
              s.nodes[childUuid].parentUuid = groupParent;
              // RF-006: Adjust child transforms back to absolute coordinates
              // JSON clone: Solid proxy not structuredClone-safe
              const childTransform = JSON.parse(
                JSON.stringify(s.nodes[childUuid].transform),
              ) as Transform;
              s.nodes[childUuid].transform = {
                ...childTransform,
                x: childTransform.x + groupTransform.x,
                y: childTransform.y + groupTransform.y,
              };
              if (groupParent && s.nodes[groupParent]) {
                s.nodes[groupParent].childrenUuids.push(childUuid);
              }
            }
          }
          // Remove group
          if (s.nodes[groupUuid]) {
            s.nodes[groupUuid].childrenUuids = [];
          }
          Reflect.deleteProperty(s.nodes, groupUuid);
        }),
      );

      // Track structural: reparent children (if parent exists), adjust transforms, then delete group
      for (let i = 0; i < children.length; i++) {
        // RF-005: Only track reparent if group has a parent. Root-level children
        // remain at root (parentUuid = null) — no reparent needed.
        if (groupParent) {
          interceptor.trackStructural(
            createReparentOp(clientSessionId, children[i], groupParent, i, groupUuid, i),
          );
          pendingServerOps.push({
            reparent: {
              nodeUuid: children[i],
              newParentUuid: groupParent,
              position: i,
            },
          });
        }

        // RF-006: Track transform restoration as a set_field operation for undo
        const childNode = state.nodes[children[i]];
        if (childNode) {
          const newTransform = deepClone(childNode.transform);
          // Old transform was group-relative
          const oldTransform: Transform = {
            ...newTransform,
            x: newTransform.x - groupTransform.x,
            y: newTransform.y - groupTransform.y,
          };
          interceptor.trackStructural(
            createSetFieldOp(clientSessionId, children[i], "transform", newTransform, oldTransform),
          );
          pendingServerOps.push({
            setField: {
              nodeUuid: children[i],
              path: "transform",
              value: JSON.stringify(newTransform),
            },
          });
        }
      }
      interceptor.trackStructural(createDeleteNodeOp(clientSessionId, groupUuid, groupSnapshot));
      pendingServerOps.push({ deleteNode: { nodeUuid: groupUuid } });

      allChildUuids.push(...children);
    }

    if (allChildUuids.length > 0) {
      setSelectedNodeIds(allChildUuids);
    }
    syncHistorySignals();
  }

  // ── Page Mutations ──────────────────────────────────────────────────

  function createPage(name: string): void {
    // Validate name length
    if (name.length === 0 || name.length > MAX_PAGE_NAME_LENGTH) {
      console.error(
        `createPage: name length ${name.length} outside valid range [1, ${MAX_PAGE_NAME_LENGTH}]`,
      );
      return;
    }
    // Validate page count limit
    if (state.pages.length >= MAX_PAGES_PER_DOCUMENT) {
      console.error(
        `createPage: document already has ${state.pages.length} pages (max ${MAX_PAGES_PER_DOCUMENT})`,
      );
      return;
    }

    const pageUuid = crypto.randomUUID();
    const newPage: MutablePage = {
      id: pageUuid,
      name,
      root_nodes: [],
      rootNodeUuids: [],
    };

    // Snapshot for rollback
    // JSON clone: Solid proxy not structuredClone-safe
    let pagesSnapshot: MutablePage[];
    try {
      pagesSnapshot = JSON.parse(JSON.stringify(state.pages)) as MutablePage[];
    } catch (err: unknown) {
      console.error("createPage: failed to snapshot pages", err);
      return;
    }

    // Apply optimistically
    setState(
      produce((s) => {
        s.pages.push(newPage);
        s.info.page_count = s.pages.length;
      }),
    );

    // RF-011: Track for undo/redo
    interceptor.trackStructural(createCreatePageOp(clientSessionId, { id: pageUuid, name }));
    syncHistorySignals();

    // Send to server
    client
      .mutation(gql(APPLY_OPERATIONS_MUTATION), {
        operations: [{ createPage: { pageUuid, name } }],
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("createPage server error:", r.error.message);
          // Rollback
          batch(() => {
            setState("pages", reconcile(pagesSnapshot));
            setState("info", "page_count", pagesSnapshot.length);
          });
        }
      })
      .catch((err: unknown) => {
        console.error("createPage exception:", err);
        // Rollback
        batch(() => {
          setState("pages", reconcile(pagesSnapshot));
          setState("info", "page_count", pagesSnapshot.length);
        });
      });
  }

  function deletePage(pageId: string): void {
    // Guard: cannot delete if only one page remains
    if (state.pages.length <= MIN_PAGES_PER_DOCUMENT) {
      console.error("deletePage: cannot delete the last remaining page");
      return;
    }

    // Validate pageId exists
    const pageIndex = state.pages.findIndex((p) => p.id === pageId);
    if (pageIndex === -1) {
      console.error(`deletePage: page ${pageId} not found`);
      return;
    }

    // Snapshot for rollback
    // JSON clone: Solid proxy not structuredClone-safe
    let pagesSnapshot: MutablePage[];
    try {
      pagesSnapshot = JSON.parse(JSON.stringify(state.pages)) as MutablePage[];
    } catch (err: unknown) {
      console.error("deletePage: failed to snapshot pages", err);
      return;
    }
    const previousActivePageId = activePageId();

    // Capture page name and position before mutation (CLAUDE.md: capture snapshots before mutations).
    const deletedPageName = state.pages[pageIndex].name;

    // Apply optimistically
    setState(
      produce((s) => {
        s.pages.splice(pageIndex, 1);
        s.info.page_count = s.pages.length;
      }),
    );

    // RF-011: Track for undo/redo
    interceptor.trackStructural(
      createDeletePageOp(clientSessionId, {
        id: pageId,
        name: deletedPageName,
        position: pageIndex,
      }),
    );
    syncHistorySignals();

    // If deleting the active page, switch to the first remaining page
    if (activePageId() === pageId) {
      const firstRemaining = state.pages[0];
      setActivePageId(firstRemaining ? firstRemaining.id : null);
    }

    // Send to server
    client
      .mutation(gql(APPLY_OPERATIONS_MUTATION), {
        operations: [{ deletePage: { pageId } }],
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("deletePage server error:", r.error.message);
          // Rollback
          batch(() => {
            setState("pages", reconcile(pagesSnapshot));
            setState("info", "page_count", pagesSnapshot.length);
          });
          setActivePageId(previousActivePageId);
        }
      })
      .catch((err: unknown) => {
        console.error("deletePage exception:", err);
        // Rollback
        batch(() => {
          setState("pages", reconcile(pagesSnapshot));
          setState("info", "page_count", pagesSnapshot.length);
        });
        setActivePageId(previousActivePageId);
      });
  }

  function renamePage(pageId: string, newName: string): void {
    // Validate name length
    if (newName.length === 0 || newName.length > MAX_PAGE_NAME_LENGTH) {
      console.error(
        `renamePage: name length ${newName.length} outside valid range [1, ${MAX_PAGE_NAME_LENGTH}]`,
      );
      return;
    }

    // Find the page
    const pageIndex = state.pages.findIndex((p) => p.id === pageId);
    if (pageIndex === -1) {
      console.error(`renamePage: page ${pageId} not found`);
      return;
    }

    // Snapshot the old name for rollback (CLAUDE.md: capture snapshots before mutations).
    const oldName = state.pages[pageIndex].name;

    // Apply optimistically
    setState("pages", pageIndex, "name", newName);

    // RF-011: Track for undo/redo
    interceptor.trackStructural(createRenamePageOp(clientSessionId, pageId, newName, oldName));
    syncHistorySignals();

    // Send to server
    client
      .mutation(gql(APPLY_OPERATIONS_MUTATION), {
        operations: [{ renamePage: { pageId, newName } }],
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("renamePage server error:", r.error.message);
          // Rollback — find the page again since index may have shifted
          const currentIndex = state.pages.findIndex((p) => p.id === pageId);
          if (currentIndex !== -1) {
            setState("pages", currentIndex, "name", oldName);
          }
        }
      })
      .catch((err: unknown) => {
        console.error("renamePage exception:", err);
        const currentIndex = state.pages.findIndex((p) => p.id === pageId);
        if (currentIndex !== -1) {
          setState("pages", currentIndex, "name", oldName);
        }
      });
  }

  function reorderPages(pageId: string, newPosition: number): void {
    // Validate position is finite
    if (!Number.isFinite(newPosition)) {
      console.error(`reorderPages: newPosition is not finite: ${newPosition}`);
      return;
    }
    // Reject negative positions
    if (newPosition < 0) {
      console.error(`reorderPages: negative position ${newPosition} for page ${pageId}`);
      return;
    }
    const roundedPos = Math.round(newPosition);

    // Find current position
    const currentIndex = state.pages.findIndex((p) => p.id === pageId);
    if (currentIndex === -1) {
      console.error(`reorderPages: page ${pageId} not found`);
      return;
    }

    // Validate target position is within range
    if (roundedPos >= state.pages.length) {
      console.error(
        `reorderPages: position ${roundedPos} out of range [0, ${state.pages.length - 1}]`,
      );
      return;
    }

    // No-op if position unchanged
    if (currentIndex === roundedPos) return;

    // Snapshot for rollback
    // JSON clone: Solid proxy not structuredClone-safe
    let pagesSnapshot: MutablePage[];
    try {
      pagesSnapshot = JSON.parse(JSON.stringify(state.pages)) as MutablePage[];
    } catch (err: unknown) {
      console.error("reorderPages: failed to snapshot pages", err);
      return;
    }

    // Apply optimistically: remove from old position, insert at new position
    setState(
      produce((s) => {
        const [page] = s.pages.splice(currentIndex, 1);
        s.pages.splice(roundedPos, 0, page);
      }),
    );

    // RF-011: Track for undo/redo
    interceptor.trackStructural(
      createReorderPageOp(clientSessionId, pageId, roundedPos, currentIndex),
    );
    syncHistorySignals();

    // Send to server
    client
      .mutation(gql(APPLY_OPERATIONS_MUTATION), {
        operations: [{ reorderPage: { pageId, newPosition: roundedPos } }],
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("reorderPages server error:", r.error.message);
          setState("pages", reconcile(pagesSnapshot));
        }
      })
      .catch((err: unknown) => {
        console.error("reorderPages exception:", err);
        setState("pages", reconcile(pagesSnapshot));
      });
  }

  function setActivePage(pageId: string): void {
    // Validate the page exists
    const exists = state.pages.some((p) => p.id === pageId);
    if (!exists) {
      console.error(`setActivePage: page ${pageId} not found`);
      return;
    }
    setActivePageId(pageId);
  }

  // ── Undo/Redo (local-first via interceptor) ───────────────────────

  function undo(): void {
    const inverseTx = interceptor.undo();
    if (!inverseTx) return;

    // Send inverse operations to server so other clients see the revert.
    // Undo/redo send ops directly (not coalesced) because they are discrete actions.
    const serverOps = transactionToServerOps(inverseTx);
    if (serverOps.length > 0) sendOps(serverOps);
    // RF-003: syncHistorySignals is already called by the interceptor's onCommit callback.
  }

  function redo(): void {
    const redoTx = interceptor.redo();
    if (!redoTx) return;

    // Send redo operations to server so other clients see the re-application.
    const serverOps = transactionToServerOps(redoTx);
    if (serverOps.length > 0) sendOps(serverOps);
    // RF-003: syncHistorySignals is already called by the interceptor's onCommit callback.
  }

  function flushHistory(): void {
    interceptor.flush();
  }

  // ── Lifecycle (RF-002) ──────────────────────────────────────────────

  function destroy(): void {
    interceptor.destroy();
    subscriptionHandle.unsubscribe();
    void wsClient.dispose();
  }

  return {
    state,
    selectedNodeId,
    setSelectedNodeId,
    selectedNodeIds,
    setSelectedNodeIds,
    isNodeSelected,
    activeTool,
    setActiveTool,
    viewport,
    setViewport,
    connected,
    canUndo,
    canRedo,
    createNode,
    setTransform,
    renameNode,
    deleteNode,
    setVisible,
    setLocked,
    reparentNode,
    reorderChildren,
    setOpacity,
    setBlendMode,
    setFills,
    setStrokes,
    setEffects,
    setCornerRadii,
    setTextContent,
    setTextStyle,
    batchSetTransform,
    groupNodes,
    ungroupNodes,
    undo,
    redo,
    flushHistory,
    createPage,
    deletePage,
    renamePage,
    reorderPages,
    setActivePage,
    activePageId,
    destroy,
  };
}
