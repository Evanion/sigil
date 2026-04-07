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
} from "../types/document";
import type { Viewport } from "../canvas/viewport";
import { PAGES_QUERY } from "../graphql/queries";
import {
  CREATE_NODE_MUTATION,
  DELETE_NODE_MUTATION,
  RENAME_NODE_MUTATION,
  SET_TRANSFORM_MUTATION,
  SET_VISIBLE_MUTATION,
  SET_LOCKED_MUTATION,
  REPARENT_NODE_MUTATION,
  REORDER_CHILDREN_MUTATION,
  SET_OPACITY_MUTATION,
  SET_BLEND_MODE_MUTATION,
  SET_FILLS_MUTATION,
  SET_STROKES_MUTATION,
  SET_EFFECTS_MUTATION,
  SET_CORNER_RADII_MUTATION,
  BATCH_SET_TRANSFORM_MUTATION,
  GROUP_NODES_MUTATION,
  UNGROUP_NODES_MUTATION,
} from "../graphql/mutations";
import type { Operation, Transaction, ReparentValue, ReorderValue } from "../operations/types";
import { TRANSACTION_APPLIED_SUBSCRIPTION } from "../graphql/subscriptions";
import { applyRemoteTransaction, type RemoteTransactionPayload } from "../operations/apply-remote";
import { HistoryManager } from "../operations/history-manager";
import { createStoreHistoryBridge } from "../operations/store-history";
import {
  createSetFieldOp,
  createCreateNodeOp,
  createDeleteNodeOp,
  createReparentOp,
  createReorderOp,
} from "../operations/operation-helpers";
import type { StoreStateReader } from "../operations/apply-to-store";

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

export interface DocumentState {
  info: MutableDocumentInfo;
  pages: Page[];
  nodes: Record<string, MutableDocumentNode>;
}

export type ToolType = "select" | "frame" | "rectangle" | "ellipse";

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
  batchSetTransform(entries: Array<{ uuid: string; transform: Transform }>): void;
  groupNodes(uuids: string[], name: string): void;
  ungroupNodes(uuids: string[]): void;
  undo(): void;
  redo(): void;

  // Drag coalescing
  beginDrag(nodeUuid: string, path: string): void;
  commitDrag(): void;
  cancelDrag(): void;

  // Lifecycle
  destroy(): void;
}

// ── Constants ─────────────────────────────────────────────────────────

const PLACEHOLDER_NODE_ID: NodeId = { index: 0, generation: 0 };
const MAX_NODE_NAME_LENGTH = 1024;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Clone helper ──────────────────────────────────────────────────────

/**
 * Deep clone a value. Uses JSON round-trip because Solid store proxies
 * throw DataCloneError with structuredClone.
 */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

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
  pages: Page[];
  nodes: Record<string, MutableDocumentNode>;
} {
  const pages: Page[] = [];
  const nodes: Record<string, MutableDocumentNode> = {};

  if (!data || typeof data !== "object") return { pages, nodes };
  const pagesRaw = (data as Record<string, unknown>)["pages"];
  if (!Array.isArray(pagesRaw)) return { pages, nodes };

  for (const pageRaw of pagesRaw) {
    if (!pageRaw || typeof pageRaw !== "object") continue;
    const p = pageRaw as Record<string, unknown>;
    const pageNodes = Array.isArray(p["nodes"]) ? p["nodes"] : [];
    const rootNodeIds: NodeId[] = [];

    for (const nodeRaw of pageNodes) {
      if (!nodeRaw || typeof nodeRaw !== "object") continue;
      const n = nodeRaw as Record<string, unknown>;
      const uuid = n["uuid"] as string;
      if (!uuid || typeof uuid !== "string" || !UUID_REGEX.test(uuid)) continue;
      nodes[uuid] = parseNode(n);
      rootNodeIds.push(PLACEHOLDER_NODE_ID);
    }

    pages.push({
      id: p["id"] as string,
      name: p["name"] as string,
      root_nodes: rootNodeIds,
    });
  }

  return { pages, nodes };
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
  const storeReader: StoreStateReader = {
    getNode: (uuid: string) => state.nodes[uuid] as Record<string, unknown> | undefined,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DocumentState is structurally compatible with StoreStateSetter
  const history = createStoreHistoryBridge(historyManager, setState as any, storeReader);

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

  // Derived from HistoryManager, not server state
  const canUndo = () => history.canUndo();
  const canRedo = () => history.canRedo();

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

  // ── Mutations ────────────────────────────────────────────────────────

  function createNode(kind: NodeKind, name: string, transform: Transform): string {
    const optimisticUuid = crypto.randomUUID();
    const pageId = state.pages[0]?.id ?? null;

    const nodeData = {
      uuid: optimisticUuid,
      kind,
      name: name.slice(0, MAX_NODE_NAME_LENGTH),
      transform,
      style: {
        fills: [],
        strokes: [],
        opacity: { type: "literal" as const, value: 1 },
        blend_mode: "normal" as const,
        effects: [],
      },
      visible: true,
      locked: false,
      parentUuid: null,
      childrenUuids: [],
    };

    const op = createCreateNodeOp(clientSessionId, nodeData);
    history.applyAndTrack(op, `Create ${name}`);

    client
      .mutation(gql(CREATE_NODE_MUTATION), {
        kind: deepClone(kind),
        name,
        pageId,
        transform: deepClone(transform),
        userId: clientSessionId,
      })
      .toPromise()
      .then((result) => {
        if (result.error) {
          console.error("createNode error:", result.error.message);
          history.undo();
          const filteredAfterError = selectedNodeIds().filter((id) => id !== optimisticUuid);
          if (filteredAfterError.length !== selectedNodeIds().length) {
            setSelectedNodeIds(filteredAfterError);
          }
          return;
        }
        const serverUuid = result.data?.createNode?.uuid as string | undefined;
        if (serverUuid && serverUuid !== optimisticUuid) {
          // Replace optimistic with server version
          batch(() => {
            const node = state.nodes[optimisticUuid];
            if (node) {
              setState(
                produce((s) => {
                  Reflect.deleteProperty(s.nodes, optimisticUuid);
                  s.nodes[serverUuid] = { ...node, uuid: serverUuid };
                }),
              );
            }
            // RF-005: Always remap selectedNodeIds regardless of whether
            // the optimistic node still exists in state (fetch may have arrived first)
            if (selectedNodeIds().includes(optimisticUuid)) {
              setSelectedNodeIds(
                selectedNodeIds().map((id) => (id === optimisticUuid ? serverUuid : id)),
              );
            }
          });
        }
      })
      .catch((err: unknown) => {
        console.error("createNode exception:", err);
        history.undo();
        const filteredAfterCatch = selectedNodeIds().filter((id) => id !== optimisticUuid);
        if (filteredAfterCatch.length !== selectedNodeIds().length) {
          setSelectedNodeIds(filteredAfterCatch);
        }
      });

    return optimisticUuid;
  }

  function setTransform(uuid: string, transform: Transform): void {
    const node = state.nodes[uuid];
    if (!node) return;
    const previous = deepClone(node.transform);

    const op = createSetFieldOp(clientSessionId, uuid, "transform", transform, previous);
    history.applyAndTrack(op, `Move ${node.name}`);

    // Send to server (existing mutation — server compat during transition)
    client
      .mutation(gql(SET_TRANSFORM_MUTATION), {
        uuid,
        transform: { ...transform },
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setTransform error:", r.error.message);
          history.undo();
        }
      })
      .catch((err: unknown) => {
        console.error("setTransform exception:", err);
        history.undo();
      });
  }

  function renameNode(uuid: string, newName: string): void {
    const node = state.nodes[uuid];
    if (!node) return;
    const previous = node.name;

    const op = createSetFieldOp(clientSessionId, uuid, "name", newName, previous);
    history.applyAndTrack(op, `Rename ${previous} to ${newName}`);

    client
      .mutation(gql(RENAME_NODE_MUTATION), { uuid, newName, userId: clientSessionId })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("renameNode error:", r.error.message);
          history.undo();
        }
      })
      .catch((err: unknown) => {
        console.error("renameNode exception:", err);
        history.undo();
      });
  }

  function deleteNode(uuid: string): void {
    const node = state.nodes[uuid];
    if (!node) return;

    const previousNode = deepClone(node);
    const previousSelectedId = selectedNodeId();

    const op = createDeleteNodeOp(clientSessionId, uuid, previousNode);
    history.applyAndTrack(op, `Delete ${node.name}`);

    // Clear selection if the deleted node was selected
    const filteredIds = selectedNodeIds().filter((id) => id !== uuid);
    if (filteredIds.length !== selectedNodeIds().length) {
      setSelectedNodeIds(filteredIds);
    }

    client
      .mutation(gql(DELETE_NODE_MUTATION), { uuid, userId: clientSessionId })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("deleteNode error:", r.error.message);
          history.undo();
          if (previousSelectedId === uuid) {
            setSelectedNodeId(previousSelectedId);
          }
        }
      })
      .catch((err: unknown) => {
        console.error("deleteNode exception:", err);
        history.undo();
        if (previousSelectedId === uuid) {
          setSelectedNodeId(previousSelectedId);
        }
      });
  }

  function setVisible(uuid: string, visible: boolean): void {
    const node = state.nodes[uuid];
    if (!node) return;
    const previous = node.visible;

    const op = createSetFieldOp(clientSessionId, uuid, "visible", visible, previous);
    history.applyAndTrack(op, `${visible ? "Show" : "Hide"} ${node.name}`);

    client
      .mutation(gql(SET_VISIBLE_MUTATION), { uuid, visible, userId: clientSessionId })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setVisible error:", r.error.message);
          history.undo();
        }
      })
      .catch((err: unknown) => {
        console.error("setVisible exception:", err);
        history.undo();
      });
  }

  function setLocked(uuid: string, locked: boolean): void {
    const node = state.nodes[uuid];
    if (!node) return;
    const previous = node.locked;

    const op = createSetFieldOp(clientSessionId, uuid, "locked", locked, previous);
    history.applyAndTrack(op, `${locked ? "Lock" : "Unlock"} ${node.name}`);

    client
      .mutation(gql(SET_LOCKED_MUTATION), { uuid, locked, userId: clientSessionId })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setLocked error:", r.error.message);
          history.undo();
        }
      })
      .catch((err: unknown) => {
        console.error("setLocked exception:", err);
        history.undo();
      });
  }

  function reparentNode(uuid: string, newParentUuid: string, position: number): void {
    if (!Number.isFinite(position)) return;
    const node = state.nodes[uuid];
    if (!node) return;

    const oldParentUuid = node.parentUuid;
    const clampedPos = Math.max(0, Math.round(position));

    // Determine old position within old parent
    const oldPosition = oldParentUuid
      ? (state.nodes[oldParentUuid]?.childrenUuids ?? []).indexOf(uuid)
      : 0;

    const op = createReparentOp(
      clientSessionId,
      uuid,
      newParentUuid,
      clampedPos,
      oldParentUuid ?? "",
      Math.max(0, oldPosition),
    );
    history.applyAndTrack(op, `Move ${node.name}`);

    client
      .mutation(gql(REPARENT_NODE_MUTATION), {
        uuid,
        newParentUuid,
        position: clampedPos,
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("reparentNode error:", r.error.message);
          history.undo();
        }
      })
      .catch((err: unknown) => {
        console.error("reparentNode exception:", err);
        history.undo();
      });
  }

  function reorderChildren(uuid: string, newPosition: number): void {
    if (!Number.isFinite(newPosition)) return;
    const node = state.nodes[uuid];
    if (!node) return;
    const parentUuid = node.parentUuid;
    if (!parentUuid) return;

    const clampedPos = Math.max(0, Math.round(newPosition));

    // Determine old position within parent
    const oldPosition = (state.nodes[parentUuid]?.childrenUuids ?? []).indexOf(uuid);

    const op = createReorderOp(
      clientSessionId,
      uuid,
      clampedPos,
      Math.max(0, oldPosition),
    );
    history.applyAndTrack(op, `Reorder ${node.name}`);

    client
      .mutation(gql(REORDER_CHILDREN_MUTATION), {
        uuid,
        newPosition: clampedPos,
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("reorderChildren error:", r.error.message);
          history.undo();
        }
      })
      .catch((err: unknown) => {
        console.error("reorderChildren exception:", err);
        history.undo();
      });
  }

  function setOpacity(uuid: string, opacity: number): void {
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return;

    const node = state.nodes[uuid];
    if (!node) return;
    const previousOpacity = node.style?.opacity ? deepClone(node.style.opacity) : { type: "literal" as const, value: 1 };

    const op = createSetFieldOp(
      clientSessionId,
      uuid,
      "style.opacity",
      { type: "literal", value: opacity },
      previousOpacity,
    );
    history.applyAndTrack(op, `Set opacity on ${node.name}`);

    client
      .mutation(gql(SET_OPACITY_MUTATION), { uuid, opacity, userId: clientSessionId })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setOpacity error:", r.error.message);
          history.undo();
        }
      })
      .catch((err: unknown) => {
        console.error("setOpacity exception:", err);
        history.undo();
      });
  }

  function setBlendMode(uuid: string, blendMode: BlendMode): void {
    const node = state.nodes[uuid];
    if (!node) return;
    const previous = node.style?.blend_mode ?? "normal";

    const op = createSetFieldOp(clientSessionId, uuid, "style.blend_mode", blendMode, previous);
    history.applyAndTrack(op, `Set blend mode on ${node.name}`);

    client
      .mutation(gql(SET_BLEND_MODE_MUTATION), { uuid, blendMode, userId: clientSessionId })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setBlendMode error:", r.error.message);
          history.undo();
        }
      })
      .catch((err: unknown) => {
        console.error("setBlendMode exception:", err);
        history.undo();
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

    const previousFills = node.style?.fills ? deepClone(node.style.fills) : [];

    const op = createSetFieldOp(clientSessionId, uuid, "style.fills", clonedFills, previousFills);
    history.applyAndTrack(op, `Update fills on ${node.name}`);

    client
      .mutation(gql(SET_FILLS_MUTATION), { uuid, fills: clonedFills, userId: clientSessionId })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setFills error:", r.error.message);
          history.undo();
        }
      })
      .catch((err: unknown) => {
        console.error("setFills exception:", err);
        history.undo();
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

    const previousStrokes = node.style?.strokes ? deepClone(node.style.strokes) : [];

    const op = createSetFieldOp(clientSessionId, uuid, "style.strokes", clonedStrokes, previousStrokes);
    history.applyAndTrack(op, `Update strokes on ${node.name}`);

    client
      .mutation(gql(SET_STROKES_MUTATION), {
        uuid,
        strokes: clonedStrokes,
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setStrokes error:", r.error.message);
          history.undo();
        }
      })
      .catch((err: unknown) => {
        console.error("setStrokes exception:", err);
        history.undo();
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

    const previousEffects = node.style?.effects ? deepClone(node.style.effects) : [];

    const op = createSetFieldOp(clientSessionId, uuid, "style.effects", clonedEffects, previousEffects);
    history.applyAndTrack(op, `Update effects on ${node.name}`);

    client
      .mutation(gql(SET_EFFECTS_MUTATION), {
        uuid,
        effects: clonedEffects,
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setEffects error:", r.error.message);
          history.undo();
        }
      })
      .catch((err: unknown) => {
        console.error("setEffects exception:", err);
        history.undo();
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

    const previousKind = deepClone(node.kind);
    const newKind = { ...previousKind, corner_radii: radii };

    const op = createSetFieldOp(clientSessionId, uuid, "kind", newKind, previousKind);
    history.applyAndTrack(op, `Set corner radii on ${node.name}`);

    client
      .mutation(gql(SET_CORNER_RADII_MUTATION), {
        uuid,
        radii: [...radii],
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setCornerRadii error:", r.error.message);
          history.undo();
        }
      })
      .catch((err: unknown) => {
        console.error("setCornerRadii exception:", err);
        history.undo();
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

    history.beginTransaction(`Align ${String(entries.length)} nodes`);

    for (const entry of entries) {
      const node = state.nodes[entry.uuid];
      if (!node) continue;
      // JSON clone: Solid proxy not structuredClone-safe
      const previous = deepClone(node.transform);
      const op = createSetFieldOp(clientSessionId, entry.uuid, "transform", entry.transform, previous);
      history.applyInTransaction(op);
    }

    history.commitTransaction();

    // Send batch to server
    client
      .mutation(gql(BATCH_SET_TRANSFORM_MUTATION), {
        entries: entries.map((e) => ({
          uuid: e.uuid,
          transform: { ...e.transform },
        })),
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("batchSetTransform error:", r.error.message);
          history.undo();
        } else {
          // Reconcile with server-canonical values
          const data = r.data as Record<string, unknown> | undefined;
          const results = data?.batchSetTransform as Array<Record<string, unknown>> | undefined;
          if (results) {
            batch(() => {
              for (const node of results) {
                const uuid = node.uuid as string;
                const transform = node.transform as Transform | undefined;
                if (uuid && transform && state.nodes[uuid]) {
                  setState("nodes", uuid, "transform", transform);
                }
              }
            });
          }
        }
      })
      .catch((err: unknown) => {
        console.error("batchSetTransform exception:", err);
        history.undo();
      });
  }

  // NOTE: groupNodes cannot be fully optimistic because the server creates
  // the group node with a new UUID. We track a placeholder operation after
  // server response and refetch so undo knows about it. Full undo support
  // deferred to Phase 15d when the server accepts operation-based mutations.
  function groupNodes(uuids: string[], name: string): void {
    client
      .mutation(gql(GROUP_NODES_MUTATION), { uuids, name, userId: clientSessionId })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("groupNodes error:", r.error.message);
          return;
        }
        const data = r.data as Record<string, unknown> | undefined;
        const groupUuid = data?.groupNodes as string | undefined;
        if (groupUuid) {
          // After server response, refetch to get complete state, then track
          void fetchPages().then(() => {
            // Track a create_node operation for the group so undo knows about it
            const groupNode = state.nodes[groupUuid];
            if (groupNode) {
              const op = createCreateNodeOp(clientSessionId, deepClone(groupNode));
              history.applyAndTrack(op, `Group ${name}`);
            }
          });
          setSelectedNodeIds([groupUuid]);
        }
      })
      .catch((err: unknown) => {
        console.error("groupNodes exception:", err);
      });
  }

  // NOTE: ungroupNodes is server-driven like groupNodes. We track a
  // placeholder delete_node operation after refetch so undo knows what
  // happened. Full undo support deferred to Phase 15d.
  function ungroupNodes(uuids: string[]): void {
    // Capture group node snapshots before the server deletes them
    const groupSnapshots: Array<{ uuid: string; snapshot: Record<string, unknown> }> = [];
    for (const uuid of uuids) {
      const node = state.nodes[uuid];
      if (node) {
        groupSnapshots.push({ uuid, snapshot: deepClone(node) as Record<string, unknown> });
      }
    }

    client
      .mutation(gql(UNGROUP_NODES_MUTATION), { uuids, userId: clientSessionId })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("ungroupNodes error:", r.error.message);
          return;
        }
        const data = r.data as Record<string, unknown> | undefined;
        const childUuids = data?.ungroupNodes as string[] | undefined;
        if (childUuids && childUuids.length > 0) {
          setSelectedNodeIds(childUuids.filter(Boolean));
        }
        // After server response, refetch to get complete state, then track
        void fetchPages().then(() => {
          // Track delete_node operations for the removed groups so undo knows
          for (const group of groupSnapshots) {
            const op = createDeleteNodeOp(clientSessionId, group.uuid, group.snapshot);
            history.applyAndTrack(op, `Ungroup ${(group.snapshot["name"] as string) ?? "nodes"}`);
          }
        });
      })
      .catch((err: unknown) => {
        console.error("ungroupNodes exception:", err);
      });
  }

  function undo(): void {
    client
      .mutation(gql(UNDO_MUTATION), { userId: clientSessionId })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("undo error:", r.error.message);
          return;
        }
        const data = r.data?.undo as { canUndo: boolean; canRedo: boolean } | undefined;
        if (data) {
          setState("info", "can_undo", data.canUndo);
          setState("info", "can_redo", data.canRedo);
        }
        // RF-017: Use direct fetch, not debounced, for undo
        void fetchPages();
      })
      .catch((err: unknown) => {
        console.error("undo exception:", err);
      });
  }

  function redo(): void {
    client
      .mutation(gql(REDO_MUTATION), { userId: clientSessionId })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("redo error:", r.error.message);
          return;
        }
        const data = r.data?.redo as { canUndo: boolean; canRedo: boolean } | undefined;
        if (data) {
          setState("info", "can_undo", data.canUndo);
          setState("info", "can_redo", data.canRedo);
        }
        // RF-017: Use direct fetch, not debounced, for redo
        void fetchPages();
      })
      .catch((err: unknown) => {
        console.error("redo exception:", err);
      });
  }

  // ── Drag coalescing ──────────────────────────────────────────────────

  function beginDrag(nodeUuid: string, path: string): void {
    history.beginDrag(nodeUuid, path);
  }

  function commitDrag(): void {
    history.commitDrag();
  }

  function cancelDrag(): void {
    history.cancelDrag();
  }

  // ── Lifecycle (RF-002) ──────────────────────────────────────────────

  function destroy(): void {
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
    batchSetTransform,
    groupNodes,
    ungroupNodes,
    undo,
    redo,
    beginDrag,
    commitDrag,
    cancelDrag,
    destroy,
  };
}
