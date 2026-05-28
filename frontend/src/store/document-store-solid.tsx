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
  StyleValue,
  TextStyle,
  Token,
  TokenType,
  TokenValue,
} from "../types/document";
import type { Viewport } from "../canvas/viewport";
import { PAGES_QUERY, TOKENS_QUERY } from "../graphql/queries";
import { APPLY_OPERATIONS_MUTATION } from "../graphql/mutations";
import type { Operation, Transaction, ReparentValue, ReorderValue } from "../operations/types";
import { TRANSACTION_APPLIED_SUBSCRIPTION } from "../graphql/subscriptions";
import { applyRemoteTransaction, type RemoteTransactionPayload } from "../operations/apply-remote";
import { HistoryManager } from "../operations/history-manager";
import { createInterceptor, deepClone as sharedDeepClone } from "../operations/interceptor";
import {
  createCreateNodeOp,
  createDeleteNodesOp,
  createReparentOp,
  createReorderOp,
  createSetFieldOp,
  createCreatePageOp,
  createDeletePageOp,
  createRenamePageOp,
  createReorderPageOp,
  createCreateTokenOp,
  createUpdateTokenOp,
  createDeleteTokenOp,
  createRenameTokenOp,
} from "../operations/operation-helpers";
import type { TextStylePatch } from "./document-store-types";
import { parseCornersInput } from "./corners-input";
import type { CornersInput } from "./corners-input";
import { defaultCorners } from "./default-corners";
import { resolveToken as resolveTokenPure } from "./token-store";
import { VALID_TOKEN_TYPES, isValidTokenValue, validateTokenName } from "../panels/token-helpers";
import { isValidExpressionLength } from "./style-value-validate";
import { MAX_EXPRESSION_LENGTH } from "./expression-eval";
import { MAX_NODE_TREE_DEPTH, MAX_NODES_PER_DELETE_BATCH } from "../types/validation";
import {
  getSessionId,
  getGraphqlHttpUrl,
  getGraphqlWsUrl,
  setSessionGlobals,
} from "../transport/session";

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
  tokens: Record<string, Token>;
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
  /**
   * Spec 19: Atomic multi-node delete.
   *
   * Deduplicates ancestor/descendant pairs (descendants are removed transitively
   * via their parent's deletion). Wraps all deletions in a single transaction
   * with explicit inverse create_node ops (one per retained UUID, sorted by
   * parent+index ASC) so undo restores siblings in their original order.
   *
   * Sends a single deleteNodes GraphQL op to the server.
   */
  deleteNodes(uuids: readonly string[]): void;
  setVisible(uuid: string, visible: boolean): void;
  setLocked(uuid: string, locked: boolean): void;
  reparentNode(uuid: string, newParentUuid: string, position: number): void;
  reorderChildren(uuid: string, newPosition: number): void;
  setOpacity(uuid: string, opacity: StyleValue<number>): void;
  setBlendMode(uuid: string, blendMode: BlendMode): void;
  setFills(uuid: string, fills: Fill[]): void;
  setStrokes(uuid: string, strokes: Stroke[]): void;
  setEffects(uuid: string, effects: Effect[]): void;
  setCorners(uuid: string, input: import("./corners-input").CornersInput): void;
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

  // Token mutations
  createToken(name: string, tokenType: TokenType, value: TokenValue, description?: string): void;
  updateToken(name: string, value: TokenValue, description?: string): void;
  deleteToken(name: string): void;
  renameToken(oldName: string, newName: string): void;
  resolveToken(name: string): TokenValue | null;

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

/** Maximum token name length — matches crates/core/src/validate.rs MAX_TOKEN_NAME_LEN. */
export const MAX_TOKEN_NAME_LENGTH = 256;

/** Maximum tokens per context — matches crates/core/src/validate.rs MAX_TOKENS_PER_CONTEXT. */
const MAX_TOKENS_PER_CONTEXT = 50_000;

/** Maximum token description length — matches crates/core/src/validate.rs MAX_TOKEN_DESCRIPTION_LEN. */
export const MAX_TOKEN_DESCRIPTION_LENGTH = 1_024;

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

/**
 * Parse the GraphQL `tokens` query response into a Record<string, Token>.
 *
 * The server returns tokens with `value` as a JSON value (parsed by urql)
 * and `tokenType` as a string. We defensively validate shape per CLAUDE.md
 * "Defensive Message Parsing".
 */
function parseTokensResponse(data: unknown): Record<string, Token> {
  const tokens: Record<string, Token> = {};

  if (!data || typeof data !== "object") return tokens;
  const tokensRaw = (data as Record<string, unknown>)["tokens"];
  if (!Array.isArray(tokensRaw)) return tokens;

  for (const raw of tokensRaw) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;

    const name = t["name"];
    if (typeof name !== "string" || name.length === 0) continue;

    const id = t["id"];
    if (typeof id !== "string") continue;

    const tokenType = t["tokenType"];
    if (typeof tokenType !== "string") continue;
    // F-14: Validate tokenType against allowlist
    if (!VALID_TOKEN_TYPES.has(tokenType)) {
      console.warn(
        `parseTokensResponse: skipping token "${name}" with unknown type "${tokenType}"`,
      );
      continue;
    }

    const rawValue = t["value"];
    // F-08: Shape-validate token value
    if (!isValidTokenValue(rawValue)) {
      console.warn(`parseTokensResponse: skipping token "${name}" with invalid value shape`);
      continue;
    }

    const description = typeof t["description"] === "string" ? t["description"] : null;

    tokens[name] = {
      id,
      name,
      token_type: tokenType as TokenType,
      value: rawValue as TokenValue,
      description,
    };
  }

  return tokens;
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
  //
  // Spec 19 Task 16: after the singular delete-path removal, this only
  // needs to inspect `delete_nodes` payloads (which carry their target
  // UUIDs under `value.node_uuids`).
  const deletedUuids = new Set<string>();
  for (const op of tx.operations) {
    if (op.type === "delete_nodes") {
      const dv = op.value as { node_uuids?: unknown } | null;
      if (dv && Array.isArray(dv.node_uuids)) {
        for (const u of dv.node_uuids as string[]) {
          deletedUuids.add(u);
        }
      }
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
      case "delete_nodes":
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
      // Spec 19 (RF-002): forward pageId from the snapshot when this
      // create_node is the inverse of a delete_nodes for a page-root node.
      // The server's CreateNodeInput.page_id ensures the restored node
      // is re-added to the correct page's root_nodes — without this,
      // remote clients see a "ghost" node present in state.nodes but
      // absent from every page's rootNodeUuids.
      const rawPageId = nodeData["pageId"];
      const pageId = typeof rawPageId === "string" ? rawPageId : null;
      return {
        createNode: {
          nodeUuid: (nodeData["uuid"] as string) ?? "",
          kind: JSON.stringify(nodeData["kind"]),
          name: (nodeData["name"] as string) ?? "",
          transform: JSON.stringify(nodeData["transform"]),
          pageId,
        },
      };
    }
    case "delete_nodes": {
      const dv = op.value as { node_uuids?: unknown } | null;
      if (!dv || !Array.isArray(dv.node_uuids)) {
        console.warn("operationToServerOp: delete_nodes payload missing node_uuids", {
          value: op.value,
        });
        return null;
      }
      return {
        deleteNodes: {
          nodeUuids: [...(dv.node_uuids as string[])],
        },
      };
    }
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
    case "create_token": {
      const tokenData = op.value as {
        name: string;
        token_type: string;
        value: unknown;
        description: string | null;
        id: string;
      };
      return {
        addToken: {
          tokenUuid: tokenData.id,
          name: tokenData.name,
          tokenType: tokenData.token_type,
          value: JSON.stringify(tokenData.value),
          description: tokenData.description,
        },
      };
    }
    case "update_token": {
      const updateData = op.value as { name: string; value: unknown; description: string | null };
      return {
        updateToken: {
          name: updateData.name,
          value: JSON.stringify(updateData.value),
          description: updateData.description,
        },
      };
    }
    case "delete_token":
      return {
        removeToken: {
          name: op.nodeUuid,
        },
      };
    case "rename_token": {
      const renameData = op.value as { old_name: string; new_name: string };
      return {
        renameToken: {
          oldName: renameData.old_name,
          newName: renameData.new_name,
        },
      };
    }
  }
}

// ── Store factory ─────────────────────────────────────────────────────

export function createDocumentStoreSolid(): DocumentStoreAPI {
  // F-05: announceError dispatches a custom DOM event that AnnounceProvider
  // listens for, providing visible error notifications to screen readers.
  // Falls back to console.error if window is not available (tests).
  function announceError(message: string): void {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("sigil-announce-error", { detail: { message } }));
    }
  }

  /**
   * RF-022: Validate MAX_EXPRESSION_LENGTH at the outbound transport boundary.
   *
   * Returns true and announces an error if any StyleValue<*> in `values`
   * carries an expression longer than MAX_EXPRESSION_LENGTH. Callers should
   * early-return when this helper returns true — the mutation is rejected.
   *
   * Per CLAUDE.md §11 "Validation Must Be Symmetric Across All Transports",
   * the store layer is a transport boundary and must match Rust-side limits
   * (see `StyleValue::Expression` validation in `crates/core/src/types/`).
   */
  function rejectOversizedExpression(
    fieldLabel: string,
    ...values: ReadonlyArray<StyleValue<unknown> | null | undefined>
  ): boolean {
    for (const sv of values) {
      if (sv && sv.type === "expression" && !isValidExpressionLength(sv.expr)) {
        announceError(`${fieldLabel}: expression exceeds ${MAX_EXPRESSION_LENGTH} characters`);
        return true;
      }
    }
    return false;
  }

  // Client session ID for self-echo suppression (RF-004)
  const clientSessionId = crypto.randomUUID();

  // urql client — URLs and session header sourced from the Tauri-injected
  // globals (`__SIGIL_SESSION_ID__`, `__SIGIL_SERVER_PORT__`); the helpers
  // fall back to `window.location` for browser/dev mode (spec-20).
  const httpUrl = getGraphqlHttpUrl();
  const wsUrl = getGraphqlWsUrl();

  // Document state
  const [state, setState] = createStore<DocumentState>({
    info: { name: "", page_count: 0, node_count: 0, can_undo: false, can_redo: false },
    pages: [],
    nodes: {},
    tokens: {},
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
    // Forward the Tauri-injected sessionId to the server's WS upgrade handler
    // (spec-20 / Task 7). graphql-ws calls this lazily on every (re)connect,
    // so a `setSessionGlobals` from a `session-replaced` listener takes effect
    // on the next reconnect attempt without rebuilding the client.
    connectionParams: () => {
      const id = getSessionId();
      return id !== null ? { sessionId: id } : {};
    },
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
    // `fetchOptions` accepts a function so we read `getSessionId()` per-request
    // — this keeps the header live across `setSessionGlobals` updates.
    fetchOptions: () => {
      const sessionId = getSessionId();
      const headers: Record<string, string> = {};
      if (sessionId !== null) headers["X-Sigil-Session"] = sessionId;
      return {
        method: "POST",
        headers,
      };
    },
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

  // ── Tauri session-replaced + crash-recovery listeners (spec-20 Task 16) ──
  //
  // When the sidecar crashes and the Tauri host respawns it (Task 16), the
  // host emits `session-replaced` with the new sessionId + port. We update
  // `window.__SIGIL_*` so the next urql request and the next graphql-ws
  // reconnect attempt pick up the new values (both `fetchOptions` and
  // `connectionParams` are functions, so they re-read on every call).
  //
  // KNOWN CONCERN (deferred): the existing urql client and WS subscription
  // are bound to the original port at construction. After a port change the
  // WS will reconnect to the new port (graphql-ws retries automatically),
  // but in-flight HTTP requests against the OLD origin will fail. A full
  // urql-client rebuild is a larger refactor (closures in `sendOps`,
  // `fetchPages`, `subscriptionHandle` all capture `client`). The minimum
  // viable mitigation is `window.location.reload()` after the globals are
  // swapped — Tauri's host will rehydrate the WebView against the new port.
  // Track in Task 21/22 follow-up if a smoother in-place rebuild is needed.
  let unlistenSessionReplaced: (() => void) | null = null;
  let unlistenEngineCrashed: (() => void) | null = null;
  let unlistenRecoveryFailed: (() => void) | null = null;

  interface SessionReplacedPayload {
    newSessionId: string;
    serverPort: number;
  }

  async function installSessionEventListeners(): Promise<void> {
    if (typeof window === "undefined") return;
    if (!("__TAURI_INTERNALS__" in window)) return;

    try {
      const { listen } = await import("@tauri-apps/api/event");

      unlistenSessionReplaced = await listen<SessionReplacedPayload>(
        "session-replaced",
        (event) => {
          const { newSessionId, serverPort } = event.payload;
          setSessionGlobals(newSessionId, serverPort);
          console.warn("session-replaced: reloading WebView against new sidecar", {
            newSessionId,
            serverPort,
          });
          // Reload picks up the new globals and rebuilds the entire store
          // with the new URLs. See KNOWN CONCERN above.
          window.location.reload();
        },
      );

      unlistenEngineCrashed = await listen<{ message: string }>("engine-crashed", (event) => {
        console.warn("engine-crashed:", event.payload.message);
      });

      unlistenRecoveryFailed = await listen<{ message: string }>(
        "session-recovery-failed",
        (event) => {
          console.error("session-recovery-failed:", event.payload.message);
        },
      );
    } catch (e) {
      console.error("installSessionEventListeners failed:", e);
    }
  }

  void installSessionEventListeners();

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

  // ── Fetch tokens ─────────────────────────────────────────────────────

  async function fetchTokens(): Promise<void> {
    try {
      const result = await client.query(gql(TOKENS_QUERY), {}).toPromise();
      if (result.error) {
        console.error("fetchTokens error:", result.error.message);
        return;
      }
      if (!result.data) return;

      const tokens = parseTokensResponse(result.data);
      setState("tokens", reconcile(tokens));
    } catch (err) {
      console.error("fetchTokens exception:", err);
    }
  }

  // Track last received sequence number for future reconnect protocol (Plan 15d)
  // @ts-expect-error -- lastSeq is written but read will be used in reconnect/gap-fill protocol

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
  void fetchTokens();

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

    // Track structural operation for undo. Per RF-012, inverseType throws
    // for create_node — its inverse must be carried explicitly via
    // combineWith (forward = create_node, inverse = delete_nodes([uuid])).
    // Without this, HistoryManager.undo() catches the inverseType throw and
    // silently no-ops, leaving the created node unredoably present after
    // Ctrl+Z. Same pattern as ungroupNodes' delete (Batch F).
    interceptor.combineWith(
      createCreateNodeOp(clientSessionId, nodeData),
      createDeleteNodesOp(clientSessionId, [optimisticUuid]),
    );

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

  /**
   * Spec 19: Atomic multi-node delete.
   *
   * Steps:
   *  1. Dedup ancestor/descendant pairs — descendants are removed transitively
   *     via their parent's deletion (mirrors DeleteNodes::apply in core).
   *  2. Snapshot each retained node + its parent/index/page location BEFORE mutation.
   *  3. Remove the nodes from the store (and every descendant) in a single produce().
   *  4. Build a Transaction with one delete_nodes forward op and N create_node
   *     inverse ops sorted by (parentUuid, originalIndex ASC). Push via
   *     interceptor.pushTransaction so it becomes a single undo step.
   *  5. Prune the deleted UUIDs (and their descendants) from selectedNodeIds.
   *  6. Send a single deleteNodes GraphQL op to the server.
   */
  function deleteNodes(uuids: readonly string[]): void {
    if (uuids.length === 0) return;

    // ── Step 0: client-side batch-size guard (RF-027) ───────────────
    // Mirror the server's MAX_NODES_PER_DELETE_BATCH so we surface a
    // structured diagnostic before a doomed round-trip rather than
    // discovering the rejection asynchronously. Symmetric with the
    // Rust validator per CLAUDE.md §11 "Validation Must Be Symmetric
    // Across All Transports".
    if (uuids.length > MAX_NODES_PER_DELETE_BATCH) {
      console.warn("store.deleteNodes: batch size exceeds MAX_NODES_PER_DELETE_BATCH", {
        requested: uuids.length,
        max: MAX_NODES_PER_DELETE_BATCH,
      });
      return;
    }

    // Preserve the user-requested count BEFORE dedup so the history
    // description and any downstream caller can reflect the user's
    // intent (matching what announce() in Canvas/LayersTree reports).
    // See RF-017.
    const userRequestedCount = uuids.length;

    // ── Step 1: dedup ancestor/descendant pairs ─────────────────────
    // For each UUID, walk up its parent chain. If any ancestor is also
    // in the target set, drop this UUID — its parent will delete it
    // transitively. Mirrors DeleteNodes::apply in core.
    //
    // The walk is bounded by MAX_NODE_TREE_DEPTH (RF-004) — a malformed
    // store with a parent cycle would otherwise loop forever. If the
    // cap fires, log a structured `console.error` (cycle = invariant
    // class) and conservatively return `false` so the caller does NOT
    // dedup this uuid (the safer side: at worst, the server rejects
    // ancestor+descendant pair; at best, the structural anomaly is
    // observable in the console).
    const targetSet = new Set(uuids);
    const isDescendantOfOtherTarget = (uuid: string): boolean => {
      let cursor = state.nodes[uuid]?.parentUuid ?? null;
      let depth = 0;
      while (cursor !== null) {
        if (depth >= MAX_NODE_TREE_DEPTH) {
          console.error(
            "store.deleteNodes: ancestor walk exceeded MAX_NODE_TREE_DEPTH (possible cycle)",
            {
              uuid,
              depth,
              maxDepth: MAX_NODE_TREE_DEPTH,
            },
          );
          return false;
        }
        if (targetSet.has(cursor)) return true;
        cursor = state.nodes[cursor]?.parentUuid ?? null;
        depth++;
      }
      return false;
    };
    const retained = uuids.filter((u) => state.nodes[u] && !isDescendantOfOtherTarget(u));
    if (retained.length === 0) return;

    // ── Step 2: capture snapshots BEFORE mutation ───────────────────
    //
    // Spec 19 (RF-001 / RF-002): the snapshot must capture EVERY node
    // in each retained subtree (root + every descendant), with each
    // node's parentUuid, originalIndex, and pageId. The inverse
    // create_node ops use this to restore both `state.nodes` AND
    // `parent.childrenUuids` AND `page.rootNodeUuids` on undo.
    interface DeleteSnapshot {
      uuid: string;
      parentUuid: string | null;
      originalIndex: number;
      // pageId is non-null only when the node is a page root (parentUuid === null
      // AND the node appears in some page's rootNodeUuids). It identifies the
      // page whose rootNodeUuids must be restored on undo.
      pageId: string | null;
      nodeSnapshot: MutableDocumentNode;
    }

    // Pre-compute uuid → pageId map for top-level lookup (avoid O(P*N) scan).
    const uuidToPageId = new Map<string, string>();
    for (const page of state.pages) {
      for (const rootUuid of page.rootNodeUuids ?? []) {
        uuidToPageId.set(rootUuid, page.id);
      }
    }

    // Walk each retained root's full subtree and capture per-node snapshots.
    // Iterative walk via stack avoids the recursion-depth guard parity
    // problem; we still enforce MAX_NODE_TREE_DEPTH explicitly via the depth
    // tracked alongside each stack frame. RF-016: shared constant.
    const snapshots: DeleteSnapshot[] = [];
    const deletedUuids = new Set<string>();
    const seenForSnapshot = new Set<string>();

    interface WalkFrame {
      uuid: string;
      depth: number;
    }
    const walkStack: WalkFrame[] = retained.map((u) => ({ uuid: u, depth: 0 }));

    while (walkStack.length > 0) {
      const frame = walkStack.pop();
      if (!frame) break;
      const { uuid, depth } = frame;
      if (depth >= MAX_NODE_TREE_DEPTH) {
        // RF-015: structured warn (not silent return) so depth-limit
        // hits in the subtree walk are observable in production logs.
        console.warn("store.deleteNodes: subtree depth limit reached, descendants skipped", {
          uuid,
          depth,
          maxDepth: MAX_NODE_TREE_DEPTH,
          site: "store.deleteNodes",
        });
        continue;
      }
      if (seenForSnapshot.has(uuid)) continue;
      const node = state.nodes[uuid];
      if (!node) continue;
      seenForSnapshot.add(uuid);
      deletedUuids.add(uuid);

      const parentUuid = node.parentUuid ?? null;
      // Compute originalIndex against the parent's childrenUuids when
      // there is a parent; against the page's rootNodeUuids when the node
      // is a page root; default to 0 if neither location is found.
      let originalIndex = 0;
      let pageId: string | null = null;
      if (parentUuid) {
        const parent = state.nodes[parentUuid];
        if (parent) {
          const idx = parent.childrenUuids?.indexOf(uuid) ?? -1;
          if (idx >= 0) originalIndex = idx;
        }
      } else {
        // Page-root candidate. Look up which page owns it.
        const owningPage = uuidToPageId.get(uuid);
        if (owningPage !== undefined) {
          pageId = owningPage;
          const page = state.pages.find((p) => p.id === owningPage);
          const idx = page?.rootNodeUuids?.indexOf(uuid) ?? -1;
          if (idx >= 0) originalIndex = idx;
        }
      }

      // deepClone uses JSON round-trip (Solid proxy not structuredClone-safe).
      const nodeSnapshot = deepClone(node) as MutableDocumentNode;
      snapshots.push({ uuid, parentUuid, originalIndex, pageId, nodeSnapshot });

      // Enqueue children for snapshot capture.
      for (const cuuid of node.childrenUuids ?? []) {
        walkStack.push({ uuid: cuuid, depth: depth + 1 });
      }
    }

    // ── Step 3: local mutation ──────────────────────────────────────
    //
    // Only detach the *retained roots* from their parents / page roots —
    // descendants are removed transitively when we delete them from
    // `s.nodes`, and their parent (also being deleted) will not survive
    // to need its childrenUuids trimmed.
    const retainedSet = new Set(retained);
    setState(
      produce((s) => {
        for (const snap of snapshots) {
          if (!retainedSet.has(snap.uuid)) continue;
          // Detach from parent (only relevant for retained roots whose
          // parent survives the deletion).
          if (snap.parentUuid) {
            const parent = s.nodes[snap.parentUuid];
            if (parent) {
              parent.childrenUuids = parent.childrenUuids.filter((id) => id !== snap.uuid);
            }
          }
          // Detach from page roots.
          if (snap.pageId) {
            const page = s.pages.find((p) => p.id === snap.pageId);
            if (page) {
              page.rootNodeUuids = page.rootNodeUuids.filter((id) => id !== snap.uuid);
            }
          }
        }
        // Remove every node (retained roots + every descendant) from the nodes map.
        for (const duuid of deletedUuids) {
          Reflect.deleteProperty(s.nodes, duuid);
        }
      }),
    );

    // ── Step 4: build transaction with explicit inverseOperations ───
    //
    // Forward op carries only the retained roots — the server's core
    // engine removes descendants transitively (mirrors `DeleteNodes::apply`).
    const forwardOp = createDeleteNodesOp(clientSessionId, retained);

    // Inverse ops must be applied PARENT-BEFORE-CHILD so each child's
    // parentUuid resolves to an existing node when applyCreateNode wires up
    // parent.childrenUuids. Within a parent group, children must be sorted
    // by originalIndex ASC so applyCreateNode's insert-at-originalIndex
    // (or page.rootNodeUuids insert) replays sibling order correctly.
    //
    // Topological sort: build a uuid → snapshot index map, then walk each
    // snapshot up its parent chain to compute the depth from the
    // *snapshotted* tree (not the live store, which is now mutated). Sort
    // by (depth ASC, parentUuid, originalIndex ASC).
    const snapByUuid = new Map<string, DeleteSnapshot>();
    for (const snap of snapshots) snapByUuid.set(snap.uuid, snap);
    const depthCache = new Map<string, number>();
    const computeDepth = (uuid: string): number => {
      const cached = depthCache.get(uuid);
      if (cached !== undefined) return cached;
      const snap = snapByUuid.get(uuid);
      // Root of a captured subtree (parent not in snapshot set, or no
      // parent at all): depth 0. Otherwise: parent depth + 1.
      let depth = 0;
      if (snap && snap.parentUuid && snapByUuid.has(snap.parentUuid)) {
        depth = computeDepth(snap.parentUuid) + 1;
      }
      depthCache.set(uuid, depth);
      return depth;
    };
    const sortedForInverse = [...snapshots].sort((a, b) => {
      const da = computeDepth(a.uuid);
      const db = computeDepth(b.uuid);
      if (da !== db) return da - db;
      const pa = a.parentUuid ?? "";
      const pb = b.parentUuid ?? "";
      if (pa !== pb) return pa.localeCompare(pb);
      return a.originalIndex - b.originalIndex;
    });

    // Tag each inverse create_node snapshot with its `originalIndex` AND
    // its `pageId` (null for non-page-roots, the owning page id for page
    // roots). applyCreateNode in apply-to-store.ts / apply-remote.ts
    // consumes both to restore parent.childrenUuids (for nested nodes)
    // and page.rootNodeUuids (for page roots) at their original positions.
    const inverseOps = sortedForInverse.map((snap) =>
      createCreateNodeOp(clientSessionId, {
        ...(snap.nodeSnapshot as Record<string, unknown>),
        originalIndex: snap.originalIndex,
        pageId: snap.pageId,
      }),
    );

    // RF-017: description uses the user-requested count, not the dedup-
    // retained count. The user pressed Delete with N selected; their mental
    // model — and the corresponding screen-reader announcement in
    // Canvas/LayersTree — sees N. Reporting retained.length when it's
    // smaller than uuids.length leaks an internal dedup detail and creates
    // a count mismatch between the announcement and the history label.
    interceptor.pushTransaction({
      id: crypto.randomUUID(),
      userId: clientSessionId,
      operations: [forwardOp],
      inverseOperations: inverseOps,
      description: `Delete ${userRequestedCount} node${userRequestedCount > 1 ? "s" : ""}`,
      timestamp: Date.now(),
      seq: 0,
    });

    // ── Step 5: prune selection ─────────────────────────────────────
    const filtered = selectedNodeIds().filter((id) => !deletedUuids.has(id));
    if (filtered.length !== selectedNodeIds().length) {
      setSelectedNodeIds(filtered);
    }

    // ── Step 6: send to server ──────────────────────────────────────
    // Structural ops send immediately (not coalesced) — must reach server
    // before any undo attempt. Send only the retained roots; the core
    // engine removes descendants transitively.
    sendOps([{ deleteNodes: { nodeUuids: [...retained] } }]);
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

  function setOpacity(uuid: string, opacity: StyleValue<number>): void {
    // Validate literal values: 0..=1 range and finite.
    // Token refs accepted unconditionally — their runtime value is validated
    // by the renderer at evaluation time. Expressions additionally bounded by
    // MAX_EXPRESSION_LENGTH (RF-022).
    if (opacity.type === "literal") {
      const v = opacity.value;
      if (!Number.isFinite(v) || v < 0 || v > 1) return;
    }
    if (rejectOversizedExpression("opacity", opacity)) return;

    const node = state.nodes[uuid];
    if (!node) return;

    interceptor.set(uuid, "style.opacity", opacity);
    // RF-026: Queue server op — sent when interceptor commits (coalesced)
    pendingServerOps.push({
      setField: {
        nodeUuid: uuid,
        path: "style.opacity",
        value: JSON.stringify(opacity),
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

    // RF-022: Reject oversized expression strings at the transport boundary.
    // Validate every StyleValue embedded in each fill: solid `color`, and
    // gradient stop `color` for gradient variants.
    for (const fill of fills) {
      if (fill.type === "solid") {
        if (rejectOversizedExpression("fill color", fill.color)) return;
      } else if (
        fill.type === "linear_gradient" ||
        fill.type === "radial_gradient" ||
        fill.type === "conic_gradient"
      ) {
        for (const stop of fill.gradient.stops) {
          if (rejectOversizedExpression("gradient stop color", stop.color)) return;
        }
      }
    }

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

    // RF-022: Reject oversized expression strings at the transport boundary.
    for (const stroke of strokes) {
      if (rejectOversizedExpression("stroke color/width", stroke.color, stroke.width)) return;
    }

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

    // RF-022: Reject oversized expression strings at the transport boundary.
    for (const effect of effects) {
      if (effect.type === "drop_shadow" || effect.type === "inner_shadow") {
        if (
          rejectOversizedExpression(
            "shadow color/blur/spread",
            effect.color,
            effect.blur,
            effect.spread,
          )
        ) {
          return;
        }
      } else if (effect.type === "layer_blur" || effect.type === "background_blur") {
        if (rejectOversizedExpression("blur radius", effect.radius)) return;
      }
    }

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

  function setCorners(uuid: string, input: CornersInput): void {
    // Validate and expand the input to a canonical Corners tuple.
    // parseCornersInput enforces: Number.isFinite, non-negative, MAX_CORNER_RADIUS,
    // MIN/MAX_CORNER_SMOOTHING, no superellipse in per-corner form.
    // Returns null for any invalid input — we treat that as a no-op (no silent clamping).
    // RF-015: log structured payload at every early-return so callers can observe
    // why a mutation was silently dropped. The store layer's responsibility ends
    // at logging — surfacing a user-facing toast is the caller's job.
    const corners = parseCornersInput(input);
    if (corners === null) {
      console.warn("setCorners: parseCornersInput rejected input", {
        uuid,
        reason: "invalid_input",
        input,
      });
      return;
    }

    // Early return for non-corner-bearing kinds (text, ellipse, path, group,
    // component_instance). Only rectangle, frame, and image have a corners field.
    const node = state.nodes[uuid];
    if (!node) {
      console.warn("setCorners: node not found", {
        uuid,
        reason: "node_not_found",
        input,
      });
      return;
    }
    if (
      node.kind.type !== "rectangle" &&
      node.kind.type !== "frame" &&
      node.kind.type !== "image"
    ) {
      console.warn("setCorners: node kind does not bear corners", {
        uuid,
        reason: "kind_not_corner_bearing",
        kindType: node.kind.type,
        input,
      });
      return;
    }

    // RF-017: Wrap deepClone in try-catch — Solid proxy cloning may fail.
    // Mirrors the defensive pattern in setTextContent / setTextStyle.
    let previousKind: typeof node.kind;
    try {
      // JSON clone: Solid proxy not structuredClone-safe
      previousKind = deepClone(node.kind);
    } catch (err: unknown) {
      console.error("setCorners: deepClone failed", { uuid, err });
      return;
    }
    const newKind = { ...previousKind, corners };

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

    // RF-022: Reject oversized expression strings at the transport boundary
    // for the StyleValue-typed text style fields.
    if (
      patch.field === "font_size" ||
      patch.field === "line_height" ||
      patch.field === "letter_spacing" ||
      patch.field === "text_color"
    ) {
      if (rejectOversizedExpression(`text ${patch.field}`, patch.value)) return;
    }

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
      kind: { type: "frame" as const, layout: null, corners: defaultCorners() },
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

    // Track structural: create group + reparent each child + transform adjustments.
    // Per RF-012, create_node has no per-op flip — its inverse rides via
    // combineWith. Mirrors the createNode store function's pattern.
    interceptor.combineWith(
      createCreateNodeOp(clientSessionId, deepClone(groupNodeData)),
      createDeleteNodesOp(clientSessionId, [groupUuid]),
    );
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
        // remain at root (parentUuid = null) — no reparent needed for the
        // forward direction.
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
        } else {
          // RF-011: For root-level groups, the child's `parentUuid` still
          // changes (from groupUuid → null). We must track that as a
          // `set_field parentUuid` so the inverse can restore the link to
          // the group on undo. Without this op, the group's create_node
          // inverse would restore the group with childrenUuids intact, but
          // each child's parentUuid would remain null — an incoherent
          // intermediate state where the group "owns" its children but the
          // children deny their parent.
          interceptor.trackStructural(
            createSetFieldOp(clientSessionId, children[i], "parentUuid", null, groupUuid),
          );
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
      // RF-011: Track the group's removal as a `delete_nodes` op with an
      // explicit inverse `create_node` that restores the group from its
      // snapshot. We use `interceptor.combineWith` (NOT `pushTransaction`)
      // so the delete merges into the SAME coalesce window as the reparent
      // and transform ops tracked above. The previous `pushTransaction`
      // call force-flushed the coalesce buffer, producing TWO undo entries
      // per ungroup: the first restored the empty group (incoherent —
      // children's parentUuid still pointed at groupParent), and the
      // second restored parent linkage. With combineWith, both halves
      // commit as ONE atomic undo step: a single Ctrl+Z restores the
      // group with its children attached AND restores each child's
      // parentUuid in the same atomic step.
      //
      // groupSnapshot is captured BEFORE the produce() above, so its
      // `childrenUuids` array is intact (non-empty). The transaction's
      // `inverseOperations` (built by `commitBuffer`) replays in reverse:
      // first the create_node restores the group, then the reparent
      // inverses restore each child's parentUuid pointer.
      const forwardDeleteOp = createDeleteNodesOp(clientSessionId, [groupUuid]);
      const inverseCreateOp = createCreateNodeOp(clientSessionId, groupSnapshot);
      interceptor.combineWith(forwardDeleteOp, inverseCreateOp);
      pendingServerOps.push({ deleteNodes: { nodeUuids: [groupUuid] } });

      allChildUuids.push(...children);
    }

    if (allChildUuids.length > 0) {
      setSelectedNodeIds(allChildUuids);
    }
    syncHistorySignals();
  }

  // ── Token Mutations ─────────────────────────────────────────────────

  function createToken(
    name: string,
    tokenType: TokenType,
    value: TokenValue,
    description?: string,
  ): void {
    // F-01: Validate name against core's rules
    const nameError = validateTokenName(name);
    if (nameError !== null) {
      announceError(`createToken: ${nameError}`);
      return;
    }

    // Validate description length if provided
    if (description !== undefined && description.length > MAX_TOKEN_DESCRIPTION_LENGTH) {
      announceError(
        `createToken: description length ${description.length} exceeds max ${MAX_TOKEN_DESCRIPTION_LENGTH}`,
      );
      return;
    }

    // Validate token count limit
    if (Object.keys(state.tokens).length >= MAX_TOKENS_PER_CONTEXT) {
      announceError(
        `createToken: document already has ${Object.keys(state.tokens).length} tokens (max ${MAX_TOKENS_PER_CONTEXT})`,
      );
      return;
    }

    // Reject duplicate name
    if (state.tokens[name] !== undefined) {
      announceError(`createToken: token with name "${name}" already exists`);
      return;
    }

    const tokenUuid = crypto.randomUUID();
    const newToken: Token = {
      id: tokenUuid,
      name,
      token_type: tokenType,
      value,
      description: description ?? null,
    };

    // Apply optimistically (no full snapshot needed — surgical rollback deletes the new key)
    setState(
      produce((s) => {
        s.tokens[name] = newToken;
      }),
    );

    // F-03: Track for undo/redo
    interceptor.trackStructural(
      createCreateTokenOp(clientSessionId, {
        name,
        token_type: tokenType,
        value,
        description: description ?? null,
        id: tokenUuid,
      }),
    );
    syncHistorySignals();

    // Send to server
    client
      .mutation(gql(APPLY_OPERATIONS_MUTATION), {
        operations: [
          {
            addToken: {
              tokenUuid,
              name,
              tokenType: tokenType,
              value: JSON.stringify(value),
              description: description ?? null,
            },
          },
        ],
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("createToken server error:", r.error.message);
          // F-05: Announce error to screen reader
          announceError(`Failed to create token "${name}": ${r.error.message}`);
          // Surgical rollback: remove only the optimistically-added key
          setState(
            produce((s) => {
              Reflect.deleteProperty(s.tokens, name);
            }),
          );
        }
      })
      .catch((err: unknown) => {
        console.error("createToken exception:", err);
        // F-05: Announce error
        announceError(`Failed to create token "${name}"`);
        // Surgical rollback: remove only the optimistically-added key
        setState(
          produce((s) => {
            Reflect.deleteProperty(s.tokens, name);
          }),
        );
      });
  }

  function updateToken(name: string, value: TokenValue, description?: string): void {
    // Validate the token exists
    const existingToken = state.tokens[name];
    if (existingToken === undefined) {
      console.error(`updateToken: token "${name}" not found`);
      return;
    }

    // Validate description length if provided
    if (description !== undefined && description.length > MAX_TOKEN_DESCRIPTION_LENGTH) {
      console.error(
        `updateToken: description length ${description.length} exceeds max ${MAX_TOKEN_DESCRIPTION_LENGTH}`,
      );
      return;
    }

    // Capture before-value for undo BEFORE mutation (CLAUDE.md: capture snapshots before mutations)
    // JSON clone: Solid proxy not structuredClone-safe
    let previousValue: { value: TokenValue; description: string | null };
    let tokenSnapshot: Token;
    try {
      previousValue = JSON.parse(
        JSON.stringify({ value: existingToken.value, description: existingToken.description }),
      ) as { value: TokenValue; description: string | null };
      // Snapshot only the single token for surgical rollback
      // JSON clone: Solid proxy not structuredClone-safe
      tokenSnapshot = JSON.parse(JSON.stringify(existingToken)) as Token;
    } catch (err: unknown) {
      console.error("updateToken: failed to snapshot token", err);
      return;
    }

    const newDescription =
      description !== undefined ? (description ?? null) : previousValue.description;

    // Apply optimistically
    setState(
      produce((s) => {
        const existing = s.tokens[name];
        if (existing) {
          s.tokens[name] = {
            ...existing,
            value,
            description: newDescription,
          };
        }
      }),
    );

    // F-03: Track for undo/redo
    interceptor.trackStructural(
      createUpdateTokenOp(
        clientSessionId,
        name,
        { name, value, description: newDescription },
        { name, value: previousValue.value, description: previousValue.description },
      ),
    );
    syncHistorySignals();

    // Send to server
    client
      .mutation(gql(APPLY_OPERATIONS_MUTATION), {
        operations: [
          {
            updateToken: {
              name,
              value: JSON.stringify(value),
              description: newDescription,
            },
          },
        ],
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("updateToken server error:", r.error.message);
          // F-05: Announce error
          announceError(`Failed to update token "${name}": ${r.error.message}`);
          // Surgical rollback: restore only the single token
          setState(
            produce((s) => {
              s.tokens[name] = tokenSnapshot;
            }),
          );
        }
      })
      .catch((err: unknown) => {
        console.error("updateToken exception:", err);
        // F-05: Announce error
        announceError(`Failed to update token "${name}"`);
        // Surgical rollback: restore only the single token
        setState(
          produce((s) => {
            s.tokens[name] = tokenSnapshot;
          }),
        );
      });
  }

  function deleteToken(name: string): void {
    // Validate the token exists
    const existingToken = state.tokens[name];
    if (existingToken === undefined) {
      console.error(`deleteToken: token "${name}" not found`);
      return;
    }

    // Snapshot only the single token for rollback and undo (capture BEFORE mutation per CLAUDE.md)
    // JSON clone: Solid proxy not structuredClone-safe
    let tokenSnapshot: Token;
    try {
      tokenSnapshot = JSON.parse(JSON.stringify(existingToken)) as Token;
    } catch (err: unknown) {
      console.error("deleteToken: failed to snapshot token", err);
      return;
    }

    // Apply optimistically
    setState(
      produce((s) => {
        Reflect.deleteProperty(s.tokens, name);
      }),
    );

    // F-03: Track for undo/redo
    interceptor.trackStructural(
      createDeleteTokenOp(clientSessionId, {
        name: tokenSnapshot.name,
        token_type: tokenSnapshot.token_type,
        value: tokenSnapshot.value,
        description: tokenSnapshot.description,
        id: tokenSnapshot.id,
      }),
    );
    syncHistorySignals();

    // Send to server
    client
      .mutation(gql(APPLY_OPERATIONS_MUTATION), {
        operations: [{ removeToken: { name } }],
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("deleteToken server error:", r.error.message);
          // F-05: Announce error
          announceError(`Failed to delete token "${name}": ${r.error.message}`);
          // Surgical rollback: re-insert only the deleted token
          setState(
            produce((s) => {
              s.tokens[name] = tokenSnapshot;
            }),
          );
        }
      })
      .catch((err: unknown) => {
        console.error("deleteToken exception:", err);
        // F-05: Announce error
        announceError(`Failed to delete token "${name}"`);
        // Surgical rollback: re-insert only the deleted token
        setState(
          produce((s) => {
            s.tokens[name] = tokenSnapshot;
          }),
        );
      });
  }

  function renameToken(oldName: string, newName: string): void {
    // No-op if names are the same
    if (oldName === newName) {
      return;
    }

    // Validate new name
    const nameError = validateTokenName(newName);
    if (nameError !== null) {
      announceError(`renameToken: ${nameError}`);
      return;
    }

    // Validate source token exists
    const existingToken = state.tokens[oldName];
    if (existingToken === undefined) {
      announceError(`renameToken: token "${oldName}" not found`);
      return;
    }

    // Reject if new name is already taken
    if (state.tokens[newName] !== undefined) {
      announceError(`renameToken: token "${newName}" already exists`);
      return;
    }

    // Capture snapshot BEFORE mutation (CLAUDE.md: capture snapshots before mutations)
    // JSON clone: Solid proxy not structuredClone-safe
    let tokenSnapshot: Token;
    try {
      tokenSnapshot = JSON.parse(JSON.stringify(existingToken)) as Token;
    } catch (err: unknown) {
      console.error("renameToken: failed to snapshot token", err);
      return;
    }

    // Apply optimistically: move token to new key
    setState(
      produce((s) => {
        const token = s.tokens[oldName];
        if (token) {
          s.tokens[newName] = { ...token, name: newName };
          Reflect.deleteProperty(s.tokens, oldName);
        }
      }),
    );

    // Track for undo/redo: forward = old→new, inverse = new→old
    interceptor.trackStructural(
      createRenameTokenOp(
        clientSessionId,
        {
          old_name: oldName,
          new_name: newName,
          token_type: tokenSnapshot.token_type,
          value: tokenSnapshot.value,
          description: tokenSnapshot.description,
          id: tokenSnapshot.id,
        },
        {
          old_name: newName,
          new_name: oldName,
          token_type: tokenSnapshot.token_type,
          value: tokenSnapshot.value,
          description: tokenSnapshot.description,
          id: tokenSnapshot.id,
        },
      ),
    );
    syncHistorySignals();

    // Send to server
    client
      .mutation(gql(APPLY_OPERATIONS_MUTATION), {
        operations: [{ renameToken: { oldName, newName } }],
        userId: clientSessionId,
      })
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("renameToken server error:", r.error.message);
          announceError(`Failed to rename token "${oldName}": ${r.error.message}`);
          // Surgical rollback: move back to old name
          setState(
            produce((s) => {
              const token = s.tokens[newName];
              if (token) {
                s.tokens[oldName] = { ...token, name: oldName };
                Reflect.deleteProperty(s.tokens, newName);
              } else {
                // Fallback: restore from snapshot
                s.tokens[oldName] = tokenSnapshot;
              }
            }),
          );
        }
      })
      .catch((err: unknown) => {
        console.error("renameToken exception:", err);
        announceError(`Failed to rename token "${oldName}"`);
        // Surgical rollback: move back to old name
        setState(
          produce((s) => {
            const token = s.tokens[newName];
            if (token) {
              s.tokens[oldName] = { ...token, name: oldName };
              Reflect.deleteProperty(s.tokens, newName);
            } else {
              // Fallback: restore from snapshot
              s.tokens[oldName] = tokenSnapshot;
            }
          }),
        );
      });
  }

  function resolveTokenLocal(name: string): TokenValue | null {
    return resolveTokenPure(state.tokens, name);
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
    // Per frontend-defensive.md "Module-Level Timers and Subscriptions Must
    // Be Cleared on Teardown" — release the Tauri event listeners installed
    // in `installSessionEventListeners`.
    unlistenSessionReplaced?.();
    unlistenEngineCrashed?.();
    unlistenRecoveryFailed?.();
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
    deleteNodes,
    setVisible,
    setLocked,
    reparentNode,
    reorderChildren,
    setOpacity,
    setBlendMode,
    setFills,
    setStrokes,
    setEffects,
    setCorners,
    setTextContent,
    setTextStyle,
    batchSetTransform,
    groupNodes,
    ungroupNodes,
    undo,
    redo,
    flushHistory,
    createToken,
    updateToken,
    deleteToken,
    renameToken,
    resolveToken: resolveTokenLocal,
    createPage,
    deletePage,
    renamePage,
    reorderPages,
    setActivePage,
    activePageId,
    destroy,
  };
}
