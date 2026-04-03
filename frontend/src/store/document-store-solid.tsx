import { createSignal, batch } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import {
  createClient,
  cacheExchange,
  fetchExchange,
  subscriptionExchange,
  gql,
  type Client,
} from "@urql/solid";
import { createClient as createWSClient } from "graphql-ws";
import type {
  DocumentNode,
  Page,
  Transform,
  NodeKind,
  NodeId,
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
  readonly client: Client;
}

// ── Placeholder NodeId ─────────────────────────────────────────────────

const PLACEHOLDER_NODE_ID: NodeId = { index: 0, generation: 0 };

// ── Debounce helper ────────────────────────────────────────────────────

const DEBOUNCE_MS = 100;

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

// ── Parse GraphQL response ────────────────────────────────────────────

function parseNode(raw: Record<string, unknown>): MutableDocumentNode {
  return {
    id: PLACEHOLDER_NODE_ID,
    uuid: raw["uuid"] as string,
    kind: raw["kind"] as NodeKind,
    name: raw["name"] as string,
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

function parsePagesResponse(
  data: unknown,
): { pages: Page[]; nodes: Record<string, MutableDocumentNode> } {
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
      if (!uuid) continue;
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
  // urql client
  const httpUrl = `${window.location.origin}/graphql`;
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${window.location.host}/graphql/ws`;

  const wsClient = createWSClient({ url: wsUrl });

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

  // ── Subscription ─────────────────────────────────────────────────────

  client
    .subscription(gql(DOCUMENT_CHANGED_SUBSCRIPTION), {})
    .subscribe((result) => {
      if (result.error) {
        console.error("subscription error:", result.error.message);
        return;
      }
      setConnected(true);
      debouncedFetchPages();
    });

  // Initial load
  void fetchPages().then(() => setConnected(true));

  // ── Mutations ────────────────────────────────────────────────────────

  function createNode(kind: NodeKind, name: string, transform: Transform): string {
    const optimisticUuid = crypto.randomUUID();
    const pageId = state.pages[0]?.id ?? null;

    // Optimistic insert
    setState("nodes", optimisticUuid, {
      id: PLACEHOLDER_NODE_ID,
      uuid: optimisticUuid,
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
    } satisfies MutableDocumentNode);

    client
      .mutation(gql(CREATE_NODE_MUTATION), {
        kind: JSON.parse(JSON.stringify(kind)),
        name,
        pageId,
        transform: JSON.parse(JSON.stringify(transform)),
      })
      .toPromise()
      .then((result) => {
        if (result.error) {
          console.error("createNode error:", result.error.message);
          // Remove optimistic node
          setState(
            produce((s) => {
              delete s.nodes[optimisticUuid];
            }),
          );
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
                  delete s.nodes[optimisticUuid];
                  s.nodes[serverUuid] = { ...node, uuid: serverUuid };
                }),
              );
              if (selectedNodeId() === optimisticUuid) {
                setSelectedNodeId(serverUuid);
              }
            }
          });
        }
      });

    return optimisticUuid;
  }

  function setTransform(uuid: string, transform: Transform): void {
    // Optimistic update
    setState("nodes", uuid, "transform", transform);
    client
      .mutation(gql(SET_TRANSFORM_MUTATION), {
        uuid,
        transform: JSON.parse(JSON.stringify(transform)),
      })
      .toPromise()
      .then((r) => {
        if (r.error) console.error("setTransform error:", r.error.message);
      });
  }

  function renameNode(uuid: string, newName: string): void {
    setState("nodes", uuid, "name", newName);
    client
      .mutation(gql(RENAME_NODE_MUTATION), { uuid, newName })
      .toPromise()
      .then((r) => {
        if (r.error) console.error("renameNode error:", r.error.message);
      });
  }

  function deleteNode(uuid: string): void {
    setState(
      produce((s) => {
        delete s.nodes[uuid];
      }),
    );
    if (selectedNodeId() === uuid) setSelectedNodeId(null);
    client
      .mutation(gql(DELETE_NODE_MUTATION), { uuid })
      .toPromise()
      .then((r) => {
        if (r.error) console.error("deleteNode error:", r.error.message);
      });
  }

  function setVisible(uuid: string, visible: boolean): void {
    setState("nodes", uuid, "visible", visible);
    client
      .mutation(gql(SET_VISIBLE_MUTATION), { uuid, visible })
      .toPromise()
      .then((r) => {
        if (r.error) console.error("setVisible error:", r.error.message);
      });
  }

  function setLocked(uuid: string, locked: boolean): void {
    setState("nodes", uuid, "locked", locked);
    client
      .mutation(gql(SET_LOCKED_MUTATION), { uuid, locked })
      .toPromise()
      .then((r) => {
        if (r.error) console.error("setLocked error:", r.error.message);
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
        debouncedFetchPages();
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
        debouncedFetchPages();
      });
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
    client,
  };
}
