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
  Token,
  TokenValue,
  TokenType,
} from "../types/document";
import { VALID_TOKEN_TYPES, isValidTokenValue } from "../panels/token-helpers";
import {
  isValidStyleValue,
  isValidColor,
  isValidFiniteNumber,
} from "../store/style-value-validate";

/**
 * Recursively strips `readonly` from all properties.
 * Used inside `produce()` callbacks where Solid guarantees mutable access.
 */
type DeepMutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? DeepMutable<T[K]> : T[K];
};

// ── Corner shape validation constants ─────────────────────────────────
// RF-031: Consolidated — import from the canonical source in corners-input.ts
// instead of redefining locally. The previous local copies drifted silently
// when the Rust source-of-truth changed; a single import site prevents that.
import {
  MAX_CORNER_RADIUS,
  MIN_CORNER_SMOOTHING,
  MAX_CORNER_SMOOTHING,
} from "../store/corners-input";
import { MAX_NODE_TREE_DEPTH } from "../types/validation";

/** Valid discriminator strings for the Corner union type. */
const VALID_CORNER_TYPES = new Set(["round", "bevel", "notch", "scoop", "superellipse"]);

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

/** Mutable version of Page for use inside the Solid store. */
export interface MutablePage {
  id: string;
  name: string;
  root_nodes: Array<{ index: number; generation: number }>;
  /**
   * Root node UUIDs belonging to this page. Mirrors the document store's
   * MutablePage.rootNodeUuids — required by Spec 19's inverse-of-delete
   * path so applyCreateNode can restore page-root membership on undo
   * AND so applyDeleteNodes can strip page roots on remote/redo apply.
   */
  rootNodeUuids?: string[];
}

export interface StoreState {
  nodes: Record<string, StoreDocumentNode>;
  pages: MutablePage[];
  tokens: Record<string, Token>;
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
    case "delete_nodes":
      applyDeleteNodes(op.value, setState, getNode);
      break;
    case "reparent":
      applyReparent(op.nodeUuid, op.value, setState, getNode);
      break;
    case "reorder":
      applyReorder(op.nodeUuid, op.value, setState, getNode);
      break;
    case "create_page":
      applyCreatePage(op.value, setState);
      break;
    case "delete_page":
      applyDeletePage(op.nodeUuid, setState);
      break;
    case "rename_page":
      applyRenamePage(op.nodeUuid, op.value, setState);
      break;
    case "reorder_page":
      applyReorderPage(op.nodeUuid, op.value, setState);
      break;
    case "create_token":
      applyCreateToken(op.value, setState);
      break;
    case "update_token":
      applyUpdateToken(op.value, setState);
      break;
    case "delete_token":
      applyDeleteToken(op.value, setState);
      break;
    case "rename_token":
      applyRenameToken(op.value, setState);
      break;
    default:
      console.warn(`Unknown remote operation type: ${op.type}`);
  }
}

// ── Internal: shape validators for style payloads ─────────────────────

/**
 * RF-017: Validate a `Fill` object's embedded StyleValues before acceptance.
 * Only validates fields that carry StyleValues (solid color, gradient stop
 * colors). Returns true if all embedded StyleValues shape-match.
 */
function isValidFill(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const f = v as Record<string, unknown>;
  switch (f["type"]) {
    case "solid":
      return isValidStyleValue(f["color"], isValidColor);
    case "linear_gradient":
    case "radial_gradient": {
      const gradient = f["gradient"];
      if (typeof gradient !== "object" || gradient === null) return false;
      const stops = (gradient as Record<string, unknown>)["stops"];
      if (!Array.isArray(stops)) return false;
      for (const stop of stops) {
        if (typeof stop !== "object" || stop === null) return false;
        if (!isValidStyleValue((stop as Record<string, unknown>)["color"], isValidColor)) {
          return false;
        }
      }
      return true;
    }
    case "conic_gradient": {
      const gradient = f["gradient"];
      if (typeof gradient !== "object" || gradient === null) return false;
      const stops = (gradient as Record<string, unknown>)["stops"];
      if (!Array.isArray(stops)) return false;
      for (const stop of stops) {
        if (typeof stop !== "object" || stop === null) return false;
        if (!isValidStyleValue((stop as Record<string, unknown>)["color"], isValidColor)) {
          return false;
        }
      }
      return true;
    }
    case "image":
      // Image fills carry no StyleValues.
      return true;
    default:
      return false;
  }
}

function isValidFillsPayload(v: unknown): v is Fill[] {
  if (!Array.isArray(v)) return false;
  for (const fill of v) {
    if (!isValidFill(fill)) return false;
  }
  return true;
}

/**
 * RF-017: Validate a `Stroke` object's embedded StyleValues.
 * Both `color` (StyleValue<Color>) and `width` (StyleValue<number>) must match.
 */
function isValidStroke(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    isValidStyleValue(s["color"], isValidColor) &&
    isValidStyleValue(s["width"], isValidFiniteNumber)
  );
}

function isValidStrokesPayload(v: unknown): v is Stroke[] {
  if (!Array.isArray(v)) return false;
  for (const stroke of v) {
    if (!isValidStroke(stroke)) return false;
  }
  return true;
}

/**
 * RF-017: Validate an `Effect` object's embedded StyleValues.
 * Drop/inner shadow: color + blur + spread; layer/background blur: radius.
 */
function isValidEffect(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  switch (e["type"]) {
    case "drop_shadow":
    case "inner_shadow":
      return (
        isValidStyleValue(e["color"], isValidColor) &&
        isValidStyleValue(e["blur"], isValidFiniteNumber) &&
        isValidStyleValue(e["spread"], isValidFiniteNumber)
      );
    case "layer_blur":
    case "background_blur":
      return isValidStyleValue(e["radius"], isValidFiniteNumber);
    default:
      return false;
  }
}

function isValidEffectsPayload(v: unknown): v is Effect[] {
  if (!Array.isArray(v)) return false;
  for (const effect of v) {
    if (!isValidEffect(effect)) return false;
  }
  return true;
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
      // RF-017: validate every StyleValue embedded in each fill before accepting
      if (!isValidFillsPayload(value)) {
        console.warn(`Remote set_field style.fills: invalid payload shape, skipping`);
        return;
      }
      setState("nodes", nodeUuid, "style", "fills", value as Fill[]);
      break;
    case "style.strokes":
      // RF-017: validate every StyleValue embedded in each stroke before accepting
      if (!isValidStrokesPayload(value)) {
        console.warn(`Remote set_field style.strokes: invalid payload shape, skipping`);
        return;
      }
      setState("nodes", nodeUuid, "style", "strokes", value as Stroke[]);
      break;
    case "style.effects":
      // RF-017: validate every StyleValue embedded in each effect before accepting
      if (!isValidEffectsPayload(value)) {
        console.warn(`Remote set_field style.effects: invalid payload shape, skipping`);
        return;
      }
      setState("nodes", nodeUuid, "style", "effects", value as Effect[]);
      break;
    case "style.opacity":
      // RF-017: validate opacity as a StyleValue<number> — literal must be a
      // finite number; expressions bounded by MAX_EXPRESSION_LENGTH.
      if (!isValidStyleValue(value, isValidFiniteNumber)) {
        console.warn(`Remote set_field style.opacity: invalid StyleValue<number> shape, skipping`);
        return;
      }
      setState("nodes", nodeUuid, "style", "opacity", value as StyleValue<number>);
      break;
    case "style.blend_mode":
      setState("nodes", nodeUuid, "style", "blend_mode", value as BlendMode);
      break;
    case "kind": {
      // RF-030: log structured payload at every early-return so silent drops
      // are observable in dev tools / production logs. The local helper
      // captures the nodeUuid + reason and short context.
      const reject = (reason: string, ctx?: Record<string, unknown>): void => {
        console.warn("Remote set_field kind: rejected", { nodeUuid, reason, ...ctx });
      };

      // Defensive validation: reject non-object / null / array values.
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        reject("kind_value_not_object");
        return;
      }
      const payload = value as Record<string, unknown>;

      // Reject cross-kind replacements — prevents rectangle→frame corruption.
      if (payload["type"] !== node.kind.type) {
        reject("kind_type_mismatch", { incoming: payload["type"], existing: node.kind.type });
        return;
      }

      // For corner-bearing kinds, validate the corners array before committing.
      if (
        payload["type"] === "rectangle" ||
        payload["type"] === "frame" ||
        payload["type"] === "image"
      ) {
        const rawCorners = payload["corners"];
        if (!Array.isArray(rawCorners) || rawCorners.length !== 4) {
          reject("corners_not_array_of_4");
          return;
        }
        let superellipseCount = 0;
        let firstSuperellipseSmoothing: number | null = null;
        for (let i = 0; i < rawCorners.length; i++) {
          const c = rawCorners[i];
          if (typeof c !== "object" || c === null) {
            reject("corner_not_object", { index: i });
            return;
          }
          const corner = c as Record<string, unknown>;
          const cornerType = corner["type"];
          if (typeof cornerType !== "string" || !VALID_CORNER_TYPES.has(cornerType)) {
            reject("corner_invalid_type", { index: i, cornerType });
            return;
          }
          const radii = corner["radii"];
          if (typeof radii !== "object" || radii === null) {
            reject("corner_radii_not_object", { index: i });
            return;
          }
          const rx = (radii as Record<string, unknown>)["x"];
          const ry = (radii as Record<string, unknown>)["y"];
          if (typeof rx !== "number" || !Number.isFinite(rx)) {
            reject("corner_radius_x_not_finite", { index: i, rx });
            return;
          }
          if (rx < 0 || rx > MAX_CORNER_RADIUS) {
            reject("corner_radius_x_out_of_range", { index: i, rx });
            return;
          }
          if (typeof ry !== "number" || !Number.isFinite(ry)) {
            reject("corner_radius_y_not_finite", { index: i, ry });
            return;
          }
          if (ry < 0 || ry > MAX_CORNER_RADIUS) {
            reject("corner_radius_y_out_of_range", { index: i, ry });
            return;
          }
          if (cornerType === "superellipse") {
            superellipseCount += 1;
            const smoothing = corner["smoothing"];
            if (typeof smoothing !== "number" || !Number.isFinite(smoothing)) {
              reject("superellipse_smoothing_not_finite", { index: i, smoothing });
              return;
            }
            if (smoothing < MIN_CORNER_SMOOTHING || smoothing > MAX_CORNER_SMOOTHING) {
              reject("superellipse_smoothing_out_of_range", { index: i, smoothing });
              return;
            }
            if (firstSuperellipseSmoothing === null) {
              firstSuperellipseSmoothing = smoothing;
            }
          }
        }
        // Superellipse uniformity: if any corner is superellipse, all four must be.
        if (superellipseCount > 0 && superellipseCount < 4) {
          reject("superellipse_partial_uniformity", { superellipseCount });
          return;
        }
        // Superellipse smoothing parity: all four smoothings must be identical.
        // Object.is gives bitwise equality for finite numbers (NaN already rejected above).
        if (superellipseCount === 4 && firstSuperellipseSmoothing !== null) {
          for (let i = 0; i < rawCorners.length; i++) {
            const corner = rawCorners[i] as Record<string, unknown>;
            const smoothing = corner["smoothing"] as number;
            if (!Object.is(smoothing, firstSuperellipseSmoothing)) {
              reject("superellipse_smoothing_parity_violation", {
                index: i,
                smoothing,
                expected: firstSuperellipseSmoothing,
              });
              return;
            }
          }
        }
      }

      setState(
        produce((s) => {
          const n = s.nodes[nodeUuid];
          // Double-check type hasn't changed between the read above and the write now.
          if (!n || n.kind.type !== payload["type"]) return;
          (s.nodes[nodeUuid] as DeepMutable<StoreDocumentNode>).kind =
            payload as DeepMutable<NodeKind>;
        }),
      );
      break;
    }
    case "kind.content":
      if (node.kind.type === "text") {
        setState(
          produce((s) => {
            const n = s.nodes[nodeUuid];
            if (n && n.kind.type === "text") {
              // produce() provides mutable access — DeepMutable strips readonly
              const mutableKind = n.kind as DeepMutable<typeof n.kind>;
              mutableKind.content = value as string;
            }
          }),
        );
      }
      break;
    default:
      // Handle kind.text_style.* sub-field paths
      if (path.startsWith("kind.text_style.") && node.kind.type === "text") {
        const subField = path.slice("kind.text_style.".length);
        // RF-017: validate StyleValue-typed text style fields before accepting.
        // font_size, line_height, letter_spacing are StyleValue<number>;
        // text_color is StyleValue<Color>. Other fields (font_family,
        // font_weight, font_style, text_align, text_decoration, text_shadow)
        // are plain values and pass through without StyleValue validation.
        if (
          subField === "font_size" ||
          subField === "line_height" ||
          subField === "letter_spacing"
        ) {
          if (!isValidStyleValue(value, isValidFiniteNumber)) {
            console.warn(
              `Remote set_field kind.text_style.${subField}: invalid StyleValue<number> shape, skipping`,
            );
            return;
          }
        } else if (subField === "text_color") {
          if (!isValidStyleValue(value, isValidColor)) {
            console.warn(
              `Remote set_field kind.text_style.text_color: invalid StyleValue<Color> shape, skipping`,
            );
            return;
          }
        }
        setState(
          produce((s) => {
            const n = s.nodes[nodeUuid];
            if (n && n.kind.type === "text") {
              // produce() provides mutable access — DeepMutable strips readonly
              const mutableKind = n.kind as DeepMutable<typeof n.kind>;
              (mutableKind.text_style as Record<string, unknown>)[subField] = value;
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
    kind: (raw["kind"] as NodeKind) ?? {
      type: "rectangle",
      corners: [
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
      ],
    },
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

  // Spec 19: when the snapshot carries an originalIndex (undo of
  // delete_nodes), restore the child at its original position instead
  // of appending. Otherwise (normal create flow), append.
  //
  // RF-033: `Number.isSafeInteger` rejects fractional positives,
  // Infinity, NaN, and non-integer values in one predicate. A non-finite
  // or fractional index would propagate into Math.min and corrupt the
  // sibling order on undo. We diagnose malformed values so the silent
  // append-fallback is observable.
  const originalIndex = raw["originalIndex"];
  const hasOriginalIndex =
    typeof originalIndex === "number" &&
    Number.isSafeInteger(originalIndex) &&
    originalIndex >= 0;
  if (originalIndex !== undefined && !hasOriginalIndex) {
    // Defensive: log when the field is present but invalid. `undefined`
    // is the normal "no originalIndex" case (a fresh create_node, not
    // an undo replay); any other non-conforming value is malformed
    // payload data worth surfacing.
    console.warn("applyCreateNode: originalIndex not a non-negative safe integer", {
      uuid,
      originalIndex,
    });
  }

  // Wire up parent's childrenUuids so the tree stays consistent
  if (parentUuid) {
    const parent = getNode(parentUuid);
    if (parent && !parent.childrenUuids.includes(uuid)) {
      const insertAt = hasOriginalIndex
        ? Math.min(originalIndex as number, parent.childrenUuids.length)
        : parent.childrenUuids.length;
      const updated = [
        ...parent.childrenUuids.slice(0, insertAt),
        uuid,
        ...parent.childrenUuids.slice(insertAt),
      ];
      setState("nodes", parentUuid, "childrenUuids", updated);
    }
  }

  // Spec 19 (RF-002): restore page-root membership when the snapshot
  // identifies the node as a page root. A page-root node has parentUuid
  // === null AND a pageId tag in the inverse snapshot. Insert into the
  // page's rootNodeUuids at the original index so the layer order
  // survives the undo round-trip even when the broadcast arrives at a
  // remote client.
  const rawPageId = raw["pageId"];
  const pageId = typeof rawPageId === "string" ? rawPageId : null;
  if (pageId !== null && !parentUuid) {
    setState(
      produce((s) => {
        const page = s.pages.find((p) => p.id === pageId);
        if (!page) {
          console.warn("Remote create_node: pageId provided but page not found in store", {
            uuid,
            pageId,
          });
          return;
        }
        const existingRoots = (page.rootNodeUuids ?? []).slice();
        if (existingRoots.includes(uuid)) return;
        const insertAt = hasOriginalIndex
          ? Math.min(originalIndex as number, existingRoots.length)
          : existingRoots.length;
        existingRoots.splice(insertAt, 0, uuid);
        page.rootNodeUuids = existingRoots;
      }),
    );
  }
}

// ── Internal: delete_nodes (Spec 19) ──────────────────────────────────

/**
 * Apply a batch delete broadcast from a remote client (or local redo).
 *
 * Spec 19 contract:
 *   - The payload carries only the *retained roots* (the core engine
 *     handles descendants transitively on the server). The local handler
 *     MUST walk each root's subtree in the current store, collecting every
 *     descendant for removal.
 *   - For each removed UUID, strip it from every page's `rootNodeUuids`
 *     array (a top-level node will appear in exactly one page; iterating
 *     all defensively keeps the loop simple and resilient to corruption).
 *   - Validate that every element of `node_uuids` is a string — a malformed
 *     payload (mixed types, nulls) must produce a structured warn and
 *     no-op without partial application.
 *   - Wrap the entire mutation in a single `produce()` block so the
 *     subscription event lands as one reactive update.
 */
function applyDeleteNodes(
  value: unknown,
  setState: SetStoreFunction<StoreState>,
  getNode: (uuid: string) => StoreDocumentNode | undefined,
): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { node_uuids?: unknown }).node_uuids)
  ) {
    console.warn("applyRemoteOperation: delete_nodes payload missing or malformed node_uuids", {
      value,
    });
    return;
  }
  const rawUuids = (value as { node_uuids: unknown[] }).node_uuids;
  // RF-010: defense-in-depth — reject any non-string element. Partial
  // application of a malformed batch could leave the store in a state
  // inconsistent with the server.
  if (!rawUuids.every((u): u is string => typeof u === "string")) {
    console.warn("applyRemoteOperation: delete_nodes node_uuids contains non-string element", {
      value,
    });
    return;
  }
  const nodeUuids = rawUuids;

  // Walk each UUID's subtree in the current store and collect every
  // descendant. Mirrors the core engine's transitive removal. Use an
  // iterative stack with an explicit depth cap to satisfy CLAUDE.md
  // "Recursive Functions Require Depth Guards". RF-016: shared constant.
  const deletedSet = new Set<string>();
  interface WalkFrame {
    uuid: string;
    depth: number;
  }
  const walkStack: WalkFrame[] = [];
  for (const uuid of nodeUuids) {
    const node = getNode(uuid);
    if (!node) {
      // RF-023: structured warn so silent drops are observable. A remote
      // delete for a uuid not present locally is benign (the local client
      // may have already applied a prior delete optimistically) but the
      // information is useful for diagnostics.
      console.warn("applyRemoteOperation: delete_nodes uuid not in store, skipping", { uuid });
      continue;
    }
    walkStack.push({ uuid, depth: 0 });
  }
  while (walkStack.length > 0) {
    const frame = walkStack.pop();
    if (!frame) break;
    if (frame.depth >= MAX_NODE_TREE_DEPTH) {
      // RF-015: structured warn so depth-limit hits are observable.
      console.warn("applyRemoteOperation: delete_nodes subtree depth limit reached", {
        uuid: frame.uuid,
        depth: frame.depth,
        maxDepth: MAX_NODE_TREE_DEPTH,
        site: "applyDeleteNodes",
      });
      continue;
    }
    if (deletedSet.has(frame.uuid)) continue;
    const node = getNode(frame.uuid);
    if (!node) continue;
    deletedSet.add(frame.uuid);
    for (const childUuid of node.childrenUuids ?? []) {
      walkStack.push({ uuid: childUuid, depth: frame.depth + 1 });
    }
  }
  if (deletedSet.size === 0) {
    return;
  }

  // RF-019: batched single produce block — one reactive update for the
  // whole delete instead of 2N independent setState calls.
  setState(
    produce((s) => {
      for (const uuid of deletedSet) {
        const node = s.nodes[uuid];
        // Detach from parent's childrenUuids (only relevant for the
        // batch's top-level entries whose parent survives; descendants'
        // parents are also being deleted so the work is wasted but
        // harmless).
        if (node?.parentUuid) {
          const parent = s.nodes[node.parentUuid];
          if (parent) {
            parent.childrenUuids = parent.childrenUuids.filter((id) => id !== uuid);
          }
        }
        // Strip from every page's rootNodeUuids. A top-level node lives
        // in exactly one page; iterating defensively avoids relying on
        // the StoreState type having rootNodeUuids populated.
        for (const page of s.pages) {
          if (page.rootNodeUuids?.includes(uuid)) {
            page.rootNodeUuids = page.rootNodeUuids.filter((id) => id !== uuid);
          }
        }
        Reflect.deleteProperty(s.nodes, uuid);
      }
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

// ── Internal: create_page ─────────────────────────────────────────────

function applyCreatePage(value: unknown, setState: SetStoreFunction<StoreState>): void {
  if (!value || typeof value !== "object") {
    console.warn("Remote create_page: missing or invalid payload");
    return;
  }

  const raw = value as Record<string, unknown>;
  const id = raw["id"] ?? raw["pageId"] ?? raw["pageUuid"];
  if (!id || typeof id !== "string") {
    console.warn("Remote create_page: missing or non-string page id");
    return;
  }

  const name = typeof raw["name"] === "string" ? raw["name"] : "Untitled";
  const rawRootNodes = raw["root_nodes"];
  const rootNodes = Array.isArray(rawRootNodes)
    ? (rawRootNodes as unknown[]).filter(
        (n): n is { index: number; generation: number } => typeof n === "object" && n !== null,
      )
    : [];

  const newPage: MutablePage = {
    id,
    name,
    root_nodes: rootNodes,
  };

  setState(
    produce((s) => {
      // Guard against duplicates.
      if (!s.pages.some((p) => p.id === id)) {
        s.pages.push(newPage);
      }
    }),
  );
}

// ── Internal: delete_page ─────────────────────────────────────────────

function applyDeletePage(pageId: string, setState: SetStoreFunction<StoreState>): void {
  if (!pageId) {
    console.warn("Remote delete_page: missing pageId");
    return;
  }

  setState(
    produce((s) => {
      const idx = s.pages.findIndex((p) => p.id === pageId);
      if (idx !== -1) {
        s.pages.splice(idx, 1);
      }
    }),
  );
}

// ── Internal: rename_page ─────────────────────────────────────────────

function applyRenamePage(
  pageId: string,
  value: unknown,
  setState: SetStoreFunction<StoreState>,
): void {
  if (!pageId) {
    console.warn("Remote rename_page: missing pageId");
    return;
  }

  let newName: string | null = null;

  if (typeof value === "string") {
    newName = value;
  } else if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    newName =
      typeof raw["newName"] === "string"
        ? raw["newName"]
        : typeof raw["name"] === "string"
          ? raw["name"]
          : null;
  }

  if (!newName) {
    console.warn("Remote rename_page: missing name in payload");
    return;
  }

  const resolvedName = newName;
  setState(
    produce((s) => {
      const page = s.pages.find((p) => p.id === pageId);
      if (page) {
        page.name = resolvedName;
      }
    }),
  );
}

// ── Internal: reorder_page ────────────────────────────────────────────

function applyReorderPage(
  pageId: string,
  value: unknown,
  setState: SetStoreFunction<StoreState>,
): void {
  if (!pageId) {
    console.warn("Remote reorder_page: missing pageId");
    return;
  }

  if (!value || typeof value !== "object") {
    console.warn("Remote reorder_page: missing or invalid payload");
    return;
  }

  // RF-019: Only accept `newPosition` — the server always sends this field name.
  // The dead `position` key was never sent by the server and created confusion.
  const payload = value as { newPosition?: number };
  const position = payload.newPosition;
  if (typeof position !== "number" || !Number.isFinite(position)) {
    console.warn("Remote reorder_page: missing or non-finite newPosition");
    return;
  }

  setState(
    produce((s) => {
      const currentIdx = s.pages.findIndex((p) => p.id === pageId);
      if (currentIdx === -1) {
        console.warn(`Remote reorder_page: page ${pageId} not found`);
        return;
      }
      const [page] = s.pages.splice(currentIdx, 1);
      if (page) {
        s.pages.splice(position, 0, page);
      }
    }),
  );
}

// ── Internal: create_token ────────────────────────────────────────────

function applyCreateToken(value: unknown, setState: SetStoreFunction<StoreState>): void {
  if (!value || typeof value !== "object") {
    console.warn("Remote create_token: missing or invalid token data");
    return;
  }

  const raw = value as Record<string, unknown>;

  const name = raw["name"];
  if (!name || typeof name !== "string") {
    console.warn("Remote create_token: missing or non-string name");
    return;
  }

  const id = raw["id"];
  if (!id || typeof id !== "string") {
    console.warn("Remote create_token: missing or non-string id");
    return;
  }

  const tokenType = raw["token_type"] ?? raw["tokenType"];
  if (typeof tokenType !== "string") {
    console.warn("Remote create_token: missing or non-string token_type");
    return;
  }
  // F-14: Validate tokenType against allowlist
  if (!VALID_TOKEN_TYPES.has(tokenType)) {
    console.warn(`Remote create_token: unknown token_type "${tokenType}"`);
    return;
  }

  const tokenValue = raw["value"];
  // F-08: Shape-validate token value
  if (!isValidTokenValue(tokenValue)) {
    console.warn("Remote create_token: missing or invalid value shape");
    return;
  }

  const description = typeof raw["description"] === "string" ? raw["description"] : null;

  const token: Token = {
    id: id,
    name,
    token_type: tokenType as TokenType,
    value: tokenValue as TokenValue,
    description,
  };

  setState(
    produce((s) => {
      // Guard against duplicates — last-writer-wins for remote ops
      s.tokens[name] = token;
    }),
  );
}

// ── Internal: update_token ────────────────────────────────────────────

function applyUpdateToken(value: unknown, setState: SetStoreFunction<StoreState>): void {
  if (!value || typeof value !== "object") {
    console.warn("Remote update_token: missing or invalid payload");
    return;
  }

  const raw = value as Record<string, unknown>;

  const name = raw["name"];
  if (!name || typeof name !== "string") {
    console.warn("Remote update_token: missing or non-string name");
    return;
  }

  const tokenValue = raw["value"];
  // F-08: Shape-validate token value
  if (!isValidTokenValue(tokenValue)) {
    console.warn("Remote update_token: missing or invalid value shape");
    return;
  }

  const description =
    "description" in raw
      ? typeof raw["description"] === "string"
        ? raw["description"]
        : null
      : undefined;

  setState(
    produce((s) => {
      const existing = s.tokens[name];
      if (!existing) {
        console.warn(`Remote update_token: token "${name}" not found in store, skipping`);
        return;
      }
      s.tokens[name] = {
        ...existing,
        value: tokenValue as TokenValue,
        description: description !== undefined ? description : existing.description,
      };
    }),
  );
}

// ── Internal: delete_token ────────────────────────────────────────────

function applyDeleteToken(value: unknown, setState: SetStoreFunction<StoreState>): void {
  // The name can come either as the value payload or as a string field within it
  let name: string | null = null;

  if (typeof value === "string") {
    name = value;
  } else if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    if (typeof raw["name"] === "string") {
      name = raw["name"];
    }
  }

  if (!name) {
    console.warn("Remote delete_token: missing token name");
    return;
  }

  const tokenName = name;
  setState(
    produce((s) => {
      Reflect.deleteProperty(s.tokens, tokenName);
    }),
  );
}

// ── Internal: rename_token ───────────────────────────────────────────

function applyRenameToken(value: unknown, setState: SetStoreFunction<StoreState>): void {
  if (!value || typeof value !== "object") {
    console.warn("Remote rename_token: missing or invalid payload");
    return;
  }

  const raw = value as Record<string, unknown>;
  const oldName = raw["old_name"];
  const newName = raw["new_name"];

  if (typeof oldName !== "string" || typeof newName !== "string") {
    console.warn("Remote rename_token: missing old_name or new_name");
    return;
  }

  // No-op if names are the same
  if (oldName === newName) {
    return;
  }

  setState(
    produce((s) => {
      const existing = s.tokens[oldName];
      if (!existing) {
        console.warn(`Remote rename_token: token "${oldName}" not found in store, skipping`);
        return;
      }
      // Move token to new key with updated name
      s.tokens[newName] = { ...existing, name: newName };
      Reflect.deleteProperty(s.tokens, oldName);
    }),
  );
}
