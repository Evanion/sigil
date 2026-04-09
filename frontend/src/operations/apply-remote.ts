/**
 * Applies a remote transaction's operations directly to the Solid store.
 *
 * This replaces the old "debouncedFetchPages()" pattern. Instead of refetching
 * all pages from the server on every subscription event, we patch individual
 * fields in the store using setState.
 *
 * See: Spec 15, Phase 15b, Task 5.
 */

import { batch } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import { produce } from "solid-js/store";
import type {
  Transform,
  Fill,
  Stroke,
  Effect,
  BlendMode,
  NodeKind,
  StyleValue,
  NodeId,
} from "../types/document";

// ── Remote payload types ──────────────────────────────────────────────

/**
 * Shape of a transaction event received from the GraphQL subscription.
 * Matches the server's TransactionAppliedEvent GraphQL type.
 */
export interface RemoteTransactionPayload {
  readonly transactionId: string;
  readonly userId: string;
  readonly seq: string; // string because GraphQL sends u64 as string
  readonly operations: readonly RemoteOperationPayload[];
  readonly eventType: string; // legacy event type for fallback
  readonly uuid: string | null;
}

export interface RemoteOperationPayload {
  readonly id: string;
  readonly nodeUuid: string;
  readonly type: string;
  readonly path: string | null;
  readonly value: unknown;
}

// ── Store shape types (mirrors document-store-solid.tsx) ──────────────

/** Mutable version of DocumentNode used in the Solid store. */
export interface StoreDocumentNode {
  id: NodeId;
  uuid: string;
  kind: NodeKind;
  name: string;
  parent: NodeId | null;
  children: readonly NodeId[];
  transform: Transform;
  style: {
    fills: readonly Fill[];
    strokes: readonly Stroke[];
    opacity: StyleValue<number>;
    blend_mode: BlendMode;
    effects: readonly Effect[];
  };
  constraints: { horizontal: string; vertical: string };
  grid_placement: unknown;
  visible: boolean;
  locked: boolean;
  parentUuid: string | null;
  childrenUuids: string[];
}

export interface StoreState {
  nodes: Record<string, StoreDocumentNode>;
  pages: unknown[];
}

// ── Placeholder for new nodes ─────────────────────────────────────────

const PLACEHOLDER_NODE_ID: NodeId = { index: 0, generation: 0 };

// ── Public API ────────────────────────────────────────────────────────

/**
 * Applies a remote transaction's operations directly to the Solid store.
 *
 * Self-echo suppression: transactions with userId matching localUserId are
 * ignored (the originating client already applied these optimistically).
 *
 * @param tx - The remote transaction payload from the subscription.
 * @param localUserId - The current client's session ID for self-echo filtering.
 * @param setState - Solid store's setState function.
 * @param getNode - Lookup function to check if a node exists in the store.
 * @param fetchPages - Fallback function for legacy events without operation payloads.
 * @returns The seq number from the transaction, for tracking.
 */
export function applyRemoteTransaction(
  tx: RemoteTransactionPayload,
  localUserId: string,
  setState: SetStoreFunction<StoreState>,
  getNode: (uuid: string) => StoreDocumentNode | undefined,
  fetchPages: () => Promise<void>,
): number {
  // Guard: parse seq and reject non-finite values (CLAUDE.md floating-point validation)
  const rawSeq = parseInt(tx.seq, 10);
  const seq = Number.isFinite(rawSeq) ? rawSeq : 0;

  // Self-echo suppression: the originating client already applied optimistically
  if (tx.userId === localUserId) {
    return seq;
  }

  // Legacy fallback: no operations means the server hasn't been updated yet.
  // This calls fetchPages() immediately (not debounced) because it only fires for
  // legacy events that lack operation payloads — expected to be rare during the
  // transition period. Will be removed in Phase 15d when all events carry operations.
  if (tx.operations.length === 0) {
    void fetchPages();
    return seq;
  }

  batch(() => {
    for (const op of tx.operations) {
      applyRemoteOperation(op, setState, getNode);
    }
  });

  return seq;
}

// ── Internal: operation dispatch ──────────────────────────────────────

function applyRemoteOperation(
  op: RemoteOperationPayload,
  setState: SetStoreFunction<StoreState>,
  getNode: (uuid: string) => StoreDocumentNode | undefined,
): void {
  switch (op.type) {
    case "set_field":
      applyFieldSet(op.nodeUuid, op.path, op.value, setState, getNode);
      break;
    case "create_node":
      applyCreateNode(op.value, setState, getNode);
      break;
    case "delete_node":
      applyDeleteNode(op.nodeUuid, setState, getNode);
      break;
    case "reparent":
      applyReparent(op.nodeUuid, op.value, setState, getNode);
      break;
    case "reorder":
      applyReorder(op.nodeUuid, op.value, setState, getNode);
      break;
    default:
      console.warn(`Unknown remote operation type: ${op.type}`);
  }
}

// ── Internal: set_field ───────────────────────────────────────────────

function applyFieldSet(
  nodeUuid: string,
  path: string | null,
  value: unknown,
  setState: SetStoreFunction<StoreState>,
  getNode: (uuid: string) => StoreDocumentNode | undefined,
): void {
  if (!path) return;

  // Guard: verify node exists before patching (it may have been deleted locally)
  const node = getNode(nodeUuid);
  if (!node) {
    console.warn(`Remote set_field: node ${nodeUuid} not found in store, skipping`);
    return;
  }

  switch (path) {
    case "transform":
      setState("nodes", nodeUuid, "transform", value as Transform);
      break;
    case "name":
      setState("nodes", nodeUuid, "name", value as string);
      break;
    case "visible":
      setState("nodes", nodeUuid, "visible", value as boolean);
      break;
    case "locked":
      setState("nodes", nodeUuid, "locked", value as boolean);
      break;
    case "style.fills":
      setState("nodes", nodeUuid, "style", "fills", value as Fill[]);
      break;
    case "style.strokes":
      setState("nodes", nodeUuid, "style", "strokes", value as Stroke[]);
      break;
    case "style.effects":
      setState("nodes", nodeUuid, "style", "effects", value as Effect[]);
      break;
    case "style.opacity":
      setState("nodes", nodeUuid, "style", "opacity", value as StyleValue<number>);
      break;
    case "style.blend_mode":
      setState("nodes", nodeUuid, "style", "blend_mode", value as BlendMode);
      break;
    case "kind":
      setState("nodes", nodeUuid, "kind", value as NodeKind);
      break;
    case "kind.content":
      if (node.kind.type === "text") {
        setState(
          produce((s) => {
            const n = s.nodes[nodeUuid];
            if (n && n.kind.type === "text") {
              // produce() provides mutable access — cast to bypass readonly
              (n.kind as { content: string }).content = value as string;
            }
          }),
        );
      }
      break;
    case "kind.corner_radii":
      if (node.kind.type === "rectangle") {
        setState(
          produce((s) => {
            const n = s.nodes[nodeUuid];
            if (n && n.kind.type === "rectangle") {
              // produce() provides mutable access — cast to bypass readonly
              (n.kind as { corner_radii: [number, number, number, number] }).corner_radii =
                value as [number, number, number, number];
            }
          }),
        );
      }
      break;
    default:
      // Handle kind.text_style.* sub-field paths
      if (path.startsWith("kind.text_style.") && node.kind.type === "text") {
        const subField = path.slice("kind.text_style.".length);
        setState(
          produce((s) => {
            const n = s.nodes[nodeUuid];
            if (n && n.kind.type === "text") {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic sub-field patching for text_style
              (n.kind as any).text_style[subField] = value;
            }
          }),
        );
        break;
      }
      console.warn(`Unknown field path in remote operation: ${path}`);
  }
}

// ── Internal: create_node ─────────────────────────────────────────────

function applyCreateNode(
  value: unknown,
  setState: SetStoreFunction<StoreState>,
  getNode: (uuid: string) => StoreDocumentNode | undefined,
): void {
  if (!value || typeof value !== "object") {
    console.warn("Remote create_node: missing or invalid node data");
    return;
  }

  const raw = value as Record<string, unknown>;

  // Shape validation: uuid must be a non-empty string (CLAUDE.md: defensive message parsing)
  const uuid = raw["uuid"];
  if (!uuid || typeof uuid !== "string") {
    console.warn("Remote create_node: missing or non-string uuid in node data");
    return;
  }

  // Shape validation: if transform is present, verify it has numeric fields
  // (CLAUDE.md: floating-point validation — guard against NaN/Infinity from external source)
  const rawTransform = raw["transform"];
  if (rawTransform !== undefined && rawTransform !== null) {
    if (typeof rawTransform !== "object") {
      console.warn("Remote create_node: transform is not an object, skipping node");
      return;
    }
    const t = rawTransform as Record<string, unknown>;
    const transformFields = ["x", "y", "width", "height", "rotation", "scale_x", "scale_y"];
    for (const field of transformFields) {
      if (field in t && (typeof t[field] !== "number" || !Number.isFinite(t[field] as number))) {
        console.warn(
          `Remote create_node: transform.${field} is not a finite number, skipping node`,
        );
        return;
      }
    }
  }

  // Build a store-compatible node from the raw payload
  const rawParent = raw["parent"];
  const parentUuid = typeof rawParent === "string" ? rawParent : null;
  const rawChildren = raw["children"];
  const childrenUuids: string[] = Array.isArray(rawChildren)
    ? (rawChildren as unknown[]).filter((c): c is string => typeof c === "string")
    : [];

  const node: StoreDocumentNode = {
    id: PLACEHOLDER_NODE_ID,
    uuid,
    kind: (raw["kind"] as NodeKind) ?? { type: "rectangle", corner_radii: [0, 0, 0, 0] },
    name: (raw["name"] as string) ?? "",
    parent: null,
    children: [],
    transform: (rawTransform as Transform) ?? {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
    },
    style: (raw["style"] as StoreDocumentNode["style"]) ?? {
      fills: [],
      strokes: [],
      opacity: { type: "literal" as const, value: 1 },
      blend_mode: "normal" as BlendMode,
      effects: [],
    },
    constraints: { horizontal: "start", vertical: "start" },
    grid_placement: null,
    visible: typeof raw["visible"] === "boolean" ? raw["visible"] : true,
    locked: typeof raw["locked"] === "boolean" ? raw["locked"] : false,
    parentUuid,
    childrenUuids,
  };

  setState(
    produce((s) => {
      s.nodes[uuid] = node;
    }),
  );

  // Wire up parent's childrenUuids so the tree stays consistent
  if (parentUuid) {
    const parent = getNode(parentUuid);
    if (parent && !parent.childrenUuids.includes(uuid)) {
      setState("nodes", parentUuid, "childrenUuids", [...parent.childrenUuids, uuid]);
    }
  }
}

// ── Internal: delete_node ─────────────────────────────────────────────

function applyDeleteNode(
  nodeUuid: string,
  setState: SetStoreFunction<StoreState>,
  getNode: (uuid: string) => StoreDocumentNode | undefined,
): void {
  const node = getNode(nodeUuid);

  // Remove from parent's childrenUuids if the node has a parent
  if (node?.parentUuid) {
    const parentUuid = node.parentUuid;
    const parent = getNode(parentUuid);
    if (parent) {
      const newChildren = parent.childrenUuids.filter((id) => id !== nodeUuid);
      setState("nodes", parentUuid, "childrenUuids", newChildren);
    }
  }

  // Remove the node from the store.
  // Using produce + Reflect.deleteProperty to satisfy no-dynamic-delete lint rule.
  setState(
    produce((s) => {
      Reflect.deleteProperty(s.nodes, nodeUuid);
    }),
  );
}

// ── Internal: reparent ────────────────────────────────────────────────

function applyReparent(
  nodeUuid: string,
  value: unknown,
  setState: SetStoreFunction<StoreState>,
  getNode: (uuid: string) => StoreDocumentNode | undefined,
): void {
  if (!value || typeof value !== "object") {
    console.warn("Remote reparent: missing or invalid payload");
    return;
  }

  const payload = value as { parentUuid?: string; position?: number };
  const newParentUuid = payload.parentUuid;
  if (typeof newParentUuid !== "string") {
    console.warn("Remote reparent: missing parentUuid");
    return;
  }

  const node = getNode(nodeUuid);
  if (!node) {
    console.warn(`Remote reparent: node ${nodeUuid} not found`);
    return;
  }

  // Remove from old parent's childrenUuids
  const oldParentUuid = node.parentUuid;
  if (oldParentUuid) {
    const oldParent = getNode(oldParentUuid);
    if (oldParent) {
      const filtered = oldParent.childrenUuids.filter((id) => id !== nodeUuid);
      setState("nodes", oldParentUuid, "childrenUuids", filtered);
    }
  }

  // Add to new parent's childrenUuids at specified position
  const newParent = getNode(newParentUuid);
  if (newParent) {
    const position =
      typeof payload.position === "number" ? payload.position : newParent.childrenUuids.length;
    const newChildren = [...newParent.childrenUuids];
    newChildren.splice(position, 0, nodeUuid);
    setState("nodes", newParentUuid, "childrenUuids", newChildren);
  }

  // Update the node's parentUuid
  setState("nodes", nodeUuid, "parentUuid", newParentUuid);
}

// ── Internal: reorder ─────────────────────────────────────────────────

function applyReorder(
  nodeUuid: string,
  value: unknown,
  setState: SetStoreFunction<StoreState>,
  getNode: (uuid: string) => StoreDocumentNode | undefined,
): void {
  if (!value || typeof value !== "object") {
    console.warn("Remote reorder: missing or invalid payload");
    return;
  }

  // RF-002: Accept both `position` (new unified format) and `newPosition` (legacy server format)
  const payload = value as { position?: number; newPosition?: number };
  const reorderPosition = payload.position ?? payload.newPosition;
  if (typeof reorderPosition !== "number") {
    console.warn("Remote reorder: missing position/newPosition");
    return;
  }

  const node = getNode(nodeUuid);
  if (!node?.parentUuid) {
    console.warn(`Remote reorder: node ${nodeUuid} not found or has no parent`);
    return;
  }

  const parentUuid = node.parentUuid;
  const parent = getNode(parentUuid);
  if (!parent) {
    console.warn(`Remote reorder: parent ${parentUuid} not found`);
    return;
  }

  // Remove from current position and insert at new position
  const newChildren = parent.childrenUuids.filter((id) => id !== nodeUuid);
  newChildren.splice(reorderPosition, 0, nodeUuid);
  setState("nodes", parentUuid, "childrenUuids", newChildren);
}
