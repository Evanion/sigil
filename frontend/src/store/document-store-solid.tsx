import { createSignal, batch } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { createClient, cacheExchange, fetchExchange, subscriptionExchange, gql } from "@urql/solid";
import { createClient as createWSClient } from "graphql-ws";
import type { DocumentNode, Page, Transform, NodeKind, NodeId } from "../types/document";
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

  // UI signals
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
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
    } satisfies MutableDocumentNode);

    client
      .mutation(gql(CREATE_NODE_MUTATION), {
        kind: structuredClone(kind),
        name,
        pageId,
        transform: structuredClone(transform),
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
          if (selectedNodeId() === optimisticUuid) {
            setSelectedNodeId(null);
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
            // RF-005: Always remap selectedNodeId regardless of whether
            // the optimistic node still exists in state (fetch may have arrived first)
            if (selectedNodeId() === optimisticUuid) {
              setSelectedNodeId(serverUuid);
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
        if (selectedNodeId() === optimisticUuid) {
          setSelectedNodeId(null);
        }
      });

    return optimisticUuid;
  }

  function setTransform(uuid: string, transform: Transform): void {
    // RF-003: Capture previous value for rollback
    const previousTransform = state.nodes[uuid]?.transform
      ? structuredClone(state.nodes[uuid].transform)
      : undefined;

    // Optimistic update
    setState("nodes", uuid, "transform", transform);
    client
      .mutation(gql(SET_TRANSFORM_MUTATION), {
        uuid,
        transform: structuredClone(transform),
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
    const previousNode = state.nodes[uuid] ? structuredClone(state.nodes[uuid]) : undefined;
    const previousSelectedId = selectedNodeId();

    setState(
      produce((s) => {
        Reflect.deleteProperty(s.nodes, uuid);
      }),
    );
    if (selectedNodeId() === uuid) setSelectedNodeId(null);

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
    subscriptionHandle.unsubscribe();
    void wsClient.dispose();
  }

  return {
    state,
    selectedNodeId,
    setSelectedNodeId,
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
    undo,
    redo,
    destroy,
  };
}
