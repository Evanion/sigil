import { createSignal, batch } from "solid-js";
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
  UNDO_MUTATION,
  REDO_MUTATION,
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
import { DOCUMENT_CHANGED_SUBSCRIPTION } from "../graphql/subscriptions";

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

  // Lifecycle
  destroy(): void;
}

// ── Constants ─────────────────────────────────────────────────────────

const PLACEHOLDER_NODE_ID: NodeId = { index: 0, generation: 0 };
const DEBOUNCE_MS = 100;
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

// ── Debounce helper ────────────────────────────────────────────────────

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
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

  // UI signals — multi-select with backwards-compatible single-select accessors
  const [selectedNodeIds, setSelectedNodeIds] = createSignal<string[]>([]);
  const selectedNodeId = (): string | null => selectedNodeIds()[0] ?? null;
  const setSelectedNodeId = (id: string | null): void => {
    setSelectedNodeIds(id ? [id] : []);
  };
  const [activeTool, setActiveTool] = createSignal<ToolType>("select");
  const [viewport, setViewport] = createSignal<Viewport>({
    x: 0,
    y: 0,
    zoom: 1,
  });
  const [connected, setConnected] = createSignal(false);

  // Derived
  const canUndo = () => state.info.can_undo;
  const canRedo = () => state.info.can_redo;

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

  const debouncedFetchPages = debounce(fetchPages, DEBOUNCE_MS);

  // ── Subscription (RF-002: capture for cleanup, RF-004: self-echo) ───

  const subscriptionHandle = client
    .subscription(gql(DOCUMENT_CHANGED_SUBSCRIPTION), {})
    .subscribe((result) => {
      if (result.error) {
        console.error("subscription error:", result.error.message);
        return;
      }

      // RF-004: Self-echo suppression
      const senderId = (result.data as Record<string, Record<string, unknown>> | undefined)
        ?.documentChanged?.senderId as string | null | undefined;

      // If senderId matches our session, skip re-fetch (we already applied optimistically).
      // If senderId is null/undefined (server doesn't populate yet), always re-fetch.
      if (senderId != null && senderId === clientSessionId) {
        return;
      }

      debouncedFetchPages();
    });

  // Initial load
  void fetchPages();

  // ── Mutations ────────────────────────────────────────────────────────

  function createNode(kind: NodeKind, name: string, transform: Transform): string {
    const optimisticUuid = crypto.randomUUID();
    const pageId = state.pages[0]?.id ?? null;

    // Optimistic insert
    setState("nodes", optimisticUuid, {
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
        opacity: { type: "literal", value: 1 },
        blend_mode: "normal",
        effects: [],
      },
      constraints: { horizontal: "start", vertical: "start" },
      grid_placement: null,
      visible: true,
      locked: false,
      parentUuid: null,
      childrenUuids: [],
    } satisfies MutableDocumentNode);

    client
      .mutation(gql(CREATE_NODE_MUTATION), {
        kind: deepClone(kind),
        name,
        pageId,
        transform: deepClone(transform),
      })
      .toPromise()
      .then((result) => {
        if (result.error) {
          console.error("createNode error:", result.error.message);
          // Remove optimistic node
          setState(
            produce((s) => {
              Reflect.deleteProperty(s.nodes, optimisticUuid);
            }),
          );
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
        // Revert optimistic state
        setState(
          produce((s) => {
            Reflect.deleteProperty(s.nodes, optimisticUuid);
          }),
        );
        const filteredAfterCatch = selectedNodeIds().filter((id) => id !== optimisticUuid);
        if (filteredAfterCatch.length !== selectedNodeIds().length) {
          setSelectedNodeIds(filteredAfterCatch);
        }
      });

    return optimisticUuid;
  }

  function setTransform(uuid: string, transform: Transform): void {
    // RF-003: Capture previous value for rollback
    const node = state.nodes[uuid];
    const previousTransform = node?.transform ? { ...node.transform } : undefined;

    // Optimistic update
    setState("nodes", uuid, "transform", transform);
    client
      .mutation(gql(SET_TRANSFORM_MUTATION), {
        uuid,
        transform: { ...transform },
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setTransform error:", r.error.message);
          // RF-003: Revert optimistic update
          if (previousTransform && state.nodes[uuid]) {
            setState("nodes", uuid, "transform", previousTransform);
          }
        }
      })
      .catch((err: unknown) => {
        console.error("setTransform exception:", err);
        if (previousTransform && state.nodes[uuid]) {
          setState("nodes", uuid, "transform", previousTransform);
        }
      });
  }

  function renameNode(uuid: string, newName: string): void {
    // RF-003: Capture previous value for rollback
    const previousName = state.nodes[uuid]?.name;

    setState("nodes", uuid, "name", newName);
    client
      .mutation(gql(RENAME_NODE_MUTATION), { uuid, newName })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("renameNode error:", r.error.message);
          if (previousName !== undefined && state.nodes[uuid]) {
            setState("nodes", uuid, "name", previousName);
          }
        }
      })
      .catch((err: unknown) => {
        console.error("renameNode exception:", err);
        if (previousName !== undefined && state.nodes[uuid]) {
          setState("nodes", uuid, "name", previousName);
        }
      });
  }

  function deleteNode(uuid: string): void {
    // RF-003: Capture full node and selection for rollback
    const previousNode = state.nodes[uuid]
      ? (deepClone(state.nodes[uuid]) as MutableDocumentNode)
      : undefined;
    const previousSelectedId = selectedNodeId();

    setState(
      produce((s) => {
        Reflect.deleteProperty(s.nodes, uuid);
      }),
    );
    const filteredIds = selectedNodeIds().filter((id) => id !== uuid);
    if (filteredIds.length !== selectedNodeIds().length) {
      setSelectedNodeIds(filteredIds);
    }

    client
      .mutation(gql(DELETE_NODE_MUTATION), { uuid })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("deleteNode error:", r.error.message);
          // RF-003: Restore deleted node
          if (previousNode) {
            setState("nodes", uuid, previousNode);
            if (previousSelectedId === uuid) {
              setSelectedNodeId(previousSelectedId);
            }
          }
        }
      })
      .catch((err: unknown) => {
        console.error("deleteNode exception:", err);
        if (previousNode) {
          setState("nodes", uuid, previousNode);
          if (previousSelectedId === uuid) {
            setSelectedNodeId(previousSelectedId);
          }
        }
      });
  }

  function setVisible(uuid: string, visible: boolean): void {
    // RF-003: Capture previous value for rollback
    const previousVisible = state.nodes[uuid]?.visible;

    setState("nodes", uuid, "visible", visible);
    client
      .mutation(gql(SET_VISIBLE_MUTATION), { uuid, visible })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setVisible error:", r.error.message);
          if (previousVisible !== undefined && state.nodes[uuid]) {
            setState("nodes", uuid, "visible", previousVisible);
          }
        }
      })
      .catch((err: unknown) => {
        console.error("setVisible exception:", err);
        if (previousVisible !== undefined && state.nodes[uuid]) {
          setState("nodes", uuid, "visible", previousVisible);
        }
      });
  }

  function setLocked(uuid: string, locked: boolean): void {
    // RF-003: Capture previous value for rollback
    const previousLocked = state.nodes[uuid]?.locked;

    setState("nodes", uuid, "locked", locked);
    client
      .mutation(gql(SET_LOCKED_MUTATION), { uuid, locked })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setLocked error:", r.error.message);
          if (previousLocked !== undefined && state.nodes[uuid]) {
            setState("nodes", uuid, "locked", previousLocked);
          }
        }
      })
      .catch((err: unknown) => {
        console.error("setLocked exception:", err);
        if (previousLocked !== undefined && state.nodes[uuid]) {
          setState("nodes", uuid, "locked", previousLocked);
        }
      });
  }

  function reparentNode(uuid: string, newParentUuid: string, position: number): void {
    if (!Number.isFinite(position)) return;

    // Capture previous state for rollback
    const node = state.nodes[uuid];
    if (!node) return;
    const oldParentUuid = node.parentUuid;
    const oldParentChildren = oldParentUuid
      ? [...(state.nodes[oldParentUuid]?.childrenUuids ?? [])]
      : [];
    const newParentChildren = [...(state.nodes[newParentUuid]?.childrenUuids ?? [])];
    const clampedPos = Math.max(0, Math.round(position));

    // Optimistic update: move node from old parent to new parent
    setState(
      produce((s) => {
        // Remove from old parent's childrenUuids
        if (oldParentUuid && s.nodes[oldParentUuid]) {
          s.nodes[oldParentUuid].childrenUuids = s.nodes[oldParentUuid].childrenUuids.filter(
            (c: string) => c !== uuid,
          );
        }
        // Insert into new parent's childrenUuids
        if (s.nodes[newParentUuid]) {
          const children = s.nodes[newParentUuid].childrenUuids.filter((c: string) => c !== uuid);
          const insertAt = Math.min(clampedPos, children.length);
          children.splice(insertAt, 0, uuid);
          s.nodes[newParentUuid].childrenUuids = children;
        }
        // Update node's parentUuid
        if (s.nodes[uuid]) {
          s.nodes[uuid].parentUuid = newParentUuid;
        }
      }),
    );

    client
      .mutation(gql(REPARENT_NODE_MUTATION), {
        uuid,
        newParentUuid,
        position: clampedPos,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("reparentNode error:", r.error.message);
          // Rollback: restore previous parent relationships
          setState(
            produce((s) => {
              if (oldParentUuid && s.nodes[oldParentUuid]) {
                s.nodes[oldParentUuid].childrenUuids = oldParentChildren;
              }
              if (s.nodes[newParentUuid]) {
                s.nodes[newParentUuid].childrenUuids = newParentChildren;
              }
              if (s.nodes[uuid]) {
                s.nodes[uuid].parentUuid = oldParentUuid;
              }
            }),
          );
        }
      })
      .catch((err: unknown) => {
        console.error("reparentNode exception:", err);
        void fetchPages();
      });
  }

  function reorderChildren(uuid: string, newPosition: number): void {
    if (!Number.isFinite(newPosition)) return;

    // Capture previous state for rollback
    const node = state.nodes[uuid];
    if (!node) return;
    const parentUuid = node.parentUuid;
    if (!parentUuid) return;
    const previousChildren = [...(state.nodes[parentUuid]?.childrenUuids ?? [])];
    const clampedPos = Math.max(0, Math.round(newPosition));

    // Optimistic update: reorder within parent's childrenUuids
    setState(
      produce((s) => {
        if (s.nodes[parentUuid]) {
          const children = s.nodes[parentUuid].childrenUuids.filter((c: string) => c !== uuid);
          const insertAt = Math.min(clampedPos, children.length);
          children.splice(insertAt, 0, uuid);
          s.nodes[parentUuid].childrenUuids = children;
        }
      }),
    );

    client
      .mutation(gql(REORDER_CHILDREN_MUTATION), {
        uuid,
        newPosition: clampedPos,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("reorderChildren error:", r.error.message);
          // Rollback: restore previous children order
          setState(
            produce((s) => {
              if (s.nodes[parentUuid]) {
                s.nodes[parentUuid].childrenUuids = previousChildren;
              }
            }),
          );
        }
      })
      .catch((err: unknown) => {
        console.error("reorderChildren exception:", err);
        void fetchPages();
      });
  }

  function setOpacity(uuid: string, opacity: number): void {
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return;

    // Snapshot previous value for rollback
    const previousOpacity = state.nodes[uuid]?.style?.opacity
      ? deepClone(state.nodes[uuid].style.opacity)
      : undefined;

    // Optimistic update
    setState(
      produce((s) => {
        if (s.nodes[uuid]) {
          s.nodes[uuid].style = {
            ...s.nodes[uuid].style,
            opacity: { type: "literal", value: opacity },
          };
        }
      }),
    );

    client
      .mutation(gql(SET_OPACITY_MUTATION), { uuid, opacity })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setOpacity error:", r.error.message);
          if (previousOpacity !== undefined && state.nodes[uuid]) {
            setState(
              produce((s) => {
                if (s.nodes[uuid]) {
                  s.nodes[uuid].style = { ...s.nodes[uuid].style, opacity: previousOpacity };
                }
              }),
            );
          }
        }
      })
      .catch((err: unknown) => {
        console.error("setOpacity exception:", err);
        if (previousOpacity !== undefined && state.nodes[uuid]) {
          setState(
            produce((s) => {
              if (s.nodes[uuid]) {
                s.nodes[uuid].style = { ...s.nodes[uuid].style, opacity: previousOpacity };
              }
            }),
          );
        }
      });
  }

  function setBlendMode(uuid: string, blendMode: BlendMode): void {
    // Snapshot previous value for rollback
    const previousBlendMode = state.nodes[uuid]?.style?.blend_mode;

    // Optimistic update
    setState(
      produce((s) => {
        if (s.nodes[uuid]) {
          s.nodes[uuid].style = { ...s.nodes[uuid].style, blend_mode: blendMode };
        }
      }),
    );

    client
      .mutation(gql(SET_BLEND_MODE_MUTATION), { uuid, blendMode })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setBlendMode error:", r.error.message);
          if (previousBlendMode !== undefined && state.nodes[uuid]) {
            setState(
              produce((s) => {
                if (s.nodes[uuid]) {
                  s.nodes[uuid].style = { ...s.nodes[uuid].style, blend_mode: previousBlendMode };
                }
              }),
            );
          }
        }
      })
      .catch((err: unknown) => {
        console.error("setBlendMode exception:", err);
        if (previousBlendMode !== undefined && state.nodes[uuid]) {
          setState(
            produce((s) => {
              if (s.nodes[uuid]) {
                s.nodes[uuid].style = { ...s.nodes[uuid].style, blend_mode: previousBlendMode };
              }
            }),
          );
        }
      });
  }

  // Debounce timers and rollback snapshots for style mutations
  // (prevents 60Hz network spam during drag while preserving rollback)
  let fillsMutationTimer: ReturnType<typeof setTimeout> | null = null;
  let fillsRollbackSnapshot: Fill[] | null = null;

  function setFills(uuid: string, fills: Fill[]): void {
    let clonedFills: Fill[];
    try {
      clonedFills = deepClone(fills);
    } catch {
      console.error("setFills: failed to clone fills");
      return;
    }

    // Capture rollback snapshot on first call of debounce window
    if (fillsMutationTimer === null) {
      try {
        fillsRollbackSnapshot = state.nodes[uuid]?.style?.fills
          ? (deepClone(state.nodes[uuid].style.fills) as Fill[])
          : [];
      } catch {
        fillsRollbackSnapshot = [];
      }
    }

    // Optimistic update (instant — no network delay)
    setState(
      produce((s) => {
        if (s.nodes[uuid]) {
          s.nodes[uuid].style = {
            ...s.nodes[uuid].style,
            fills: clonedFills,
          } as (typeof s.nodes)[string]["style"];
        }
      }),
    );

    // Debounce the mutation — only send after 100ms of inactivity
    if (fillsMutationTimer) clearTimeout(fillsMutationTimer);
    const snapshot = fillsRollbackSnapshot;
    fillsMutationTimer = setTimeout(() => {
      fillsMutationTimer = null;
      fillsRollbackSnapshot = null;
      client
        .mutation(gql(SET_FILLS_MUTATION), { uuid, fills: clonedFills })
        .toPromise()
        .then((r) => {
          if (r.error) {
            console.error("setFills error:", r.error.message);
            // Rollback to pre-debounce-window state
            if (snapshot && state.nodes[uuid]) {
              setState(
                produce((s) => {
                  if (s.nodes[uuid]) {
                    s.nodes[uuid].style = {
                      ...s.nodes[uuid].style,
                      fills: snapshot,
                    } as (typeof s.nodes)[string]["style"];
                  }
                }),
              );
            }
          }
        })
        .catch((err: unknown) => {
          console.error("setFills exception:", err);
          if (snapshot && state.nodes[uuid]) {
            setState(
              produce((s) => {
                if (s.nodes[uuid]) {
                  s.nodes[uuid].style = {
                    ...s.nodes[uuid].style,
                    fills: snapshot,
                  } as (typeof s.nodes)[string]["style"];
                }
              }),
            );
          }
        });
    }, DEBOUNCE_MS);
  }

  let strokesMutationTimer: ReturnType<typeof setTimeout> | null = null;
  let strokesRollbackSnapshot: Stroke[] | null = null;

  function setStrokes(uuid: string, strokes: Stroke[]): void {
    let clonedStrokes: Stroke[];
    try {
      clonedStrokes = deepClone(strokes);
    } catch {
      console.error("setStrokes: failed to clone strokes");
      return;
    }

    // Capture rollback snapshot on first call of debounce window
    if (strokesMutationTimer === null) {
      try {
        strokesRollbackSnapshot = state.nodes[uuid]?.style?.strokes
          ? (deepClone(state.nodes[uuid].style.strokes) as Stroke[])
          : [];
      } catch {
        strokesRollbackSnapshot = [];
      }
    }

    // Optimistic update (instant — no network delay)
    setState(
      produce((s) => {
        if (s.nodes[uuid]) {
          s.nodes[uuid].style = {
            ...s.nodes[uuid].style,
            strokes: clonedStrokes,
          } as (typeof s.nodes)[string]["style"];
        }
      }),
    );

    // Debounce the mutation — only send after 100ms of inactivity
    if (strokesMutationTimer) clearTimeout(strokesMutationTimer);
    const snapshot = strokesRollbackSnapshot;
    strokesMutationTimer = setTimeout(() => {
      strokesMutationTimer = null;
      strokesRollbackSnapshot = null;
      client
        .mutation(gql(SET_STROKES_MUTATION), { uuid, strokes: clonedStrokes })
        .toPromise()
        .then((r) => {
          if (r.error) {
            console.error("setStrokes error:", r.error.message);
            if (snapshot && state.nodes[uuid]) {
              setState(
                produce((s) => {
                  if (s.nodes[uuid]) {
                    s.nodes[uuid].style = {
                      ...s.nodes[uuid].style,
                      strokes: snapshot,
                    } as (typeof s.nodes)[string]["style"];
                  }
                }),
              );
            }
          }
        })
        .catch((err: unknown) => {
          console.error("setStrokes exception:", err);
          if (snapshot && state.nodes[uuid]) {
            setState(
              produce((s) => {
                if (s.nodes[uuid]) {
                  s.nodes[uuid].style = {
                    ...s.nodes[uuid].style,
                    strokes: snapshot,
                  } as (typeof s.nodes)[string]["style"];
                }
              }),
            );
          }
        });
    }, DEBOUNCE_MS);
  }

  let effectsMutationTimer: ReturnType<typeof setTimeout> | null = null;
  let effectsRollbackSnapshot: Effect[] | null = null;

  function setEffects(uuid: string, effects: Effect[]): void {
    let clonedEffects: Effect[];
    try {
      clonedEffects = deepClone(effects);
    } catch {
      console.error("setEffects: failed to clone effects");
      return;
    }

    // Capture rollback snapshot on first call of debounce window
    if (effectsMutationTimer === null) {
      try {
        effectsRollbackSnapshot = state.nodes[uuid]?.style?.effects
          ? (deepClone(state.nodes[uuid].style.effects) as Effect[])
          : [];
      } catch {
        effectsRollbackSnapshot = [];
      }
    }

    // Optimistic update (instant — no network delay)
    setState(
      produce((s) => {
        if (s.nodes[uuid]) {
          s.nodes[uuid].style = {
            ...s.nodes[uuid].style,
            effects: clonedEffects,
          } as (typeof s.nodes)[string]["style"];
        }
      }),
    );

    // Debounce the mutation — only send after 100ms of inactivity
    if (effectsMutationTimer) clearTimeout(effectsMutationTimer);
    const snapshot = effectsRollbackSnapshot;
    effectsMutationTimer = setTimeout(() => {
      effectsMutationTimer = null;
      effectsRollbackSnapshot = null;
      client
        .mutation(gql(SET_EFFECTS_MUTATION), { uuid, effects: clonedEffects })
        .toPromise()
        .then((r) => {
          if (r.error) {
            console.error("setEffects error:", r.error.message);
            if (snapshot && state.nodes[uuid]) {
              setState(
                produce((s) => {
                  if (s.nodes[uuid]) {
                    s.nodes[uuid].style = {
                      ...s.nodes[uuid].style,
                      effects: snapshot,
                    } as (typeof s.nodes)[string]["style"];
                  }
                }),
              );
            }
          }
        })
        .catch((err: unknown) => {
          console.error("setEffects exception:", err);
          if (snapshot && state.nodes[uuid]) {
            setState(
              produce((s) => {
                if (s.nodes[uuid]) {
                  s.nodes[uuid].style = {
                    ...s.nodes[uuid].style,
                    effects: snapshot,
                  } as (typeof s.nodes)[string]["style"];
                }
              }),
            );
          }
        });
    }, DEBOUNCE_MS);
  }

  function setCornerRadii(uuid: string, radii: [number, number, number, number]): void {
    // Validate all 4 values are finite and non-negative
    for (const r of radii) {
      if (!Number.isFinite(r) || r < 0) return;
    }

    // Early return if node is not a rectangle — before snapshot to avoid spurious mutations
    const targetNode = state.nodes[uuid];
    if (!targetNode || targetNode.kind.type !== "rectangle") return;

    // Snapshot previous value for rollback
    const previousKind = state.nodes[uuid]?.kind ? deepClone(state.nodes[uuid].kind) : undefined;

    // Optimistic update — kind.type guard is required for TypeScript narrowing even
    // though the early return above already guarantees we only reach this point for
    // rectangle nodes; the produce draft is typed as the full NodeKind union.
    setState(
      produce((s) => {
        if (s.nodes[uuid] && s.nodes[uuid].kind.type === "rectangle") {
          s.nodes[uuid].kind = { ...s.nodes[uuid].kind, corner_radii: radii };
        }
      }),
    );

    client
      .mutation(gql(SET_CORNER_RADII_MUTATION), { uuid, radii: [...radii] })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("setCornerRadii error:", r.error.message);
          if (previousKind !== undefined && state.nodes[uuid]) {
            setState(
              produce((s) => {
                if (s.nodes[uuid]) {
                  s.nodes[uuid].kind = previousKind;
                }
              }),
            );
          }
        }
      })
      .catch((err: unknown) => {
        console.error("setCornerRadii exception:", err);
        if (previousKind !== undefined && state.nodes[uuid]) {
          setState(
            produce((s) => {
              if (s.nodes[uuid]) {
                s.nodes[uuid].kind = previousKind;
              }
            }),
          );
        }
      });
  }

  function batchSetTransform(entries: Array<{ uuid: string; transform: Transform }>): void {
    // Capture previous values for rollback
    const rollbackEntries: Array<{ uuid: string; transform: Transform }> = [];
    for (const entry of entries) {
      const node = state.nodes[entry.uuid];
      if (node?.transform) {
        // JSON clone: Solid proxy not structuredClone-safe
        rollbackEntries.push({ uuid: entry.uuid, transform: deepClone(node.transform) });
      }
    }

    // Optimistic update: apply all transforms immediately
    batch(() => {
      for (const entry of entries) {
        if (state.nodes[entry.uuid]) {
          setState("nodes", entry.uuid, "transform", entry.transform);
        }
      }
    });

    client
      .mutation(gql(BATCH_SET_TRANSFORM_MUTATION), {
        entries: entries.map((e) => ({
          uuid: e.uuid,
          transform: { ...e.transform },
        })),
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("batchSetTransform error:", r.error.message);
          batch(() => {
            for (const entry of rollbackEntries) {
              if (state.nodes[entry.uuid]) {
                setState("nodes", entry.uuid, "transform", entry.transform);
              }
            }
          });
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
        batch(() => {
          for (const entry of rollbackEntries) {
            if (state.nodes[entry.uuid]) {
              setState("nodes", entry.uuid, "transform", entry.transform);
            }
          }
        });
      });
  }

  // RF-005 optimistic update deferred: Grouping creates a new node requiring
  // server-generated UUID. Ungrouping involves complex tree reparenting. Both
  // are discrete one-shot operations (Ctrl+G), not continuous drag operations.
  // Subscription handler triggers refetch within one round-trip. Full optimistic
  // implementation deferred to reduce complexity — latency is bounded and
  // acceptable for the action frequency.
  function groupNodes(uuids: string[], name: string): void {
    client
      .mutation(gql(GROUP_NODES_MUTATION), { uuids, name })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("groupNodes error:", r.error.message);
          return;
        }
        const data = r.data as Record<string, unknown> | undefined;
        const groupUuid = data?.groupNodes as string | undefined;
        if (groupUuid) {
          setSelectedNodeIds([groupUuid]);
        }
      })
      .catch((err: unknown) => {
        console.error("groupNodes exception:", err);
      });
  }

  // RF-005 optimistic update deferred: see groupNodes comment above.
  function ungroupNodes(uuids: string[]): void {
    client
      .mutation(gql(UNGROUP_NODES_MUTATION), { uuids })
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
      })
      .catch((err: unknown) => {
        console.error("ungroupNodes exception:", err);
      });
  }

  function undo(): void {
    client
      .mutation(gql(UNDO_MUTATION), {})
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
      .mutation(gql(REDO_MUTATION), {})
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

  // ── Lifecycle (RF-002) ──────────────────────────────────────────────

  function destroy(): void {
    // Clear debounce timers to prevent post-dispose mutations
    if (fillsMutationTimer) {
      clearTimeout(fillsMutationTimer);
      fillsMutationTimer = null;
    }
    if (strokesMutationTimer) {
      clearTimeout(strokesMutationTimer);
      strokesMutationTimer = null;
    }
    if (effectsMutationTimer) {
      clearTimeout(effectsMutationTimer);
      effectsMutationTimer = null;
    }
    subscriptionHandle.unsubscribe();
    void wsClient.dispose();
  }

  return {
    state,
    selectedNodeId,
    setSelectedNodeId,
    selectedNodeIds,
    setSelectedNodeIds,
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
    destroy,
  };
}
