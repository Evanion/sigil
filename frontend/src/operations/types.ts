/**
 * Operation and Transaction types for the client-side undo/redo system.
 *
 * These types represent field-level mutations that flow through the system:
 * client → server → broadcast to other clients.
 *
 * See: Spec 15, section 3.
 */

/** Discriminant for the kind of mutation an operation represents. */
export type OperationType =
  | "set_field"
  | "create_node"
  | "delete_nodes"
  | "reparent"
  | "reorder"
  | "create_page"
  | "delete_page"
  | "rename_page"
  | "reorder_page"
  | "create_token"
  | "update_token"
  | "delete_token"
  | "rename_token";

/**
 * A single field-level mutation.
 *
 * The inverse of any operation is constructed by swapping `value` and
 * `previousValue`. For batch operations like `delete_nodes` whose inverse
 * is a different op type with N entries, the inverse is supplied
 * explicitly via `Transaction.inverseOperations`.
 */
export interface Operation {
  /** Unique operation ID (UUID). */
  readonly id: string;
  /** Who issued it (session ID). */
  readonly userId: string;
  /** Target node UUID. Empty string for create_node (node doesn't exist yet). */
  readonly nodeUuid: string;
  /** Kind of mutation. */
  readonly type: OperationType;
  /**
   * Field path for set_field operations: "transform", "style.fills", "name", etc.
   * Empty string for structural operations (create/delete/reparent/reorder use
   * value/previousValue to carry structured payloads).
   */
  readonly path: string;
  /**
   * New value (full node data for create_node).
   * TODO (RF-019): Replace `unknown` with a discriminated union based on `type`.
   * Each OperationType has a specific value shape (e.g., ReparentValue, ReorderValue,
   * CreatePageValue). A discriminated union would provide compile-time type safety
   * and eliminate unsafe casts at call sites.
   */
  readonly value: unknown;
  /**
   * Old value. For batch deletes (`delete_nodes`), the inverse `create_node`
   * snapshots live on `Transaction.inverseOperations` instead.
   * TODO (RF-019): Same typing gap as `value` — should be a discriminated union.
   */
  readonly previousValue: unknown;
  // INTENTIONAL: mutable — server assigns seq after creation
  seq: number;
}

/** Side-effect context snapshot (restored on undo/redo). */
export interface SideEffectContext {
  readonly selectedNodeIds: string[];
  readonly activeTool: string;
  readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number };
}

/**
 * A group of operations that form a single undo step.
 *
 * Undoing a transaction applies the inverse of every operation in reverse order.
 */
export interface Transaction {
  /** Unique transaction ID (UUID). */
  readonly id: string;
  /** Who issued it (session ID). */
  readonly userId: string;
  /** Ordered list of field changes. */
  readonly operations: readonly Operation[];
  /** Human-readable description: "Move Rectangle 1", "Align 4 nodes". */
  readonly description: string;
  /** Wall clock timestamp (Date.now()). */
  readonly timestamp: number;
  // INTENTIONAL: mutable — server assigns seq after creation
  seq: number;
  /** RF-019: Type-safe side-effect context for undo/redo restoration. */
  sideEffectContext?: SideEffectContext;
  /**
   * Spec 19: Pre-built inverse operations, used when the forward op is not
   * a single-op flip (e.g., delete_nodes inverts to N create_node ops).
   * When present, createInverseTransaction prefers these over per-op flip.
   */
  readonly inverseOperations?: readonly Operation[];
}

/**
 * Reparent operation value payload.
 * Stored in Operation.value for type="reparent".
 */
export interface ReparentValue {
  readonly parentUuid: string;
  readonly position: number;
}

/**
 * Reorder operation value payload.
 * Stored in Operation.value for type="reorder".
 *
 * RF-002: Uses a unified `position` field so that createInverse (which swaps
 * value/previousValue) produces a payload that applyReorder can always read
 * without field-name mismatch.
 */
export interface ReorderValue {
  readonly position: number;
}

/**
 * Reorder operation previousValue payload.
 * Stored in Operation.previousValue for type="reorder".
 *
 * RF-002: Uses the same `position` field as ReorderValue for symmetry.
 */
export interface ReorderPreviousValue {
  readonly position: number;
}

/**
 * Delete nodes operation value payload (Spec 19).
 * Stored in Operation.value for type="delete_nodes". The inverse is
 * carried separately via Transaction.inverseOperations (a list of N
 * create_node ops).
 */
export interface DeleteNodesValue {
  readonly node_uuids: readonly string[];
}

/**
 * Spec 19: Inverse-of-delete restore metadata embedded in a create_node
 * operation's `value` (which is otherwise a `MutableDocumentNode` snapshot).
 *
 * When a `create_node` op is built as the inverse of `delete_nodes`,
 * the value spreads the node snapshot AND adds these fields:
 *
 *   - `originalIndex`: position in `parent.childrenUuids` (or in
 *     `page.rootNodeUuids` when the node was a page root). Consumed by
 *     `applyCreateNode` in `apply-to-store.ts` and `apply-remote.ts` so
 *     undo restores the sibling at its original position instead of
 *     appending. Without this, a middle-sibling delete + undo cycle
 *     reorders the parent's children (e.g., [C0, C1, C2] → [C0, C2, C1]).
 *
 *   - `pageId`: identifies the page whose `rootNodeUuids` array must be
 *     updated when restoring a page-root node (i.e. when `parentUuid` is
 *     null). Without this, undo restores the node to `state.nodes` but
 *     leaves it absent from every page's `rootNodeUuids` array — the
 *     restored node has no rendering context.
 *
 * Both fields are optional. Forward creates omit them; the inverse-of-delete
 * path supplies them. Field names are top-level on the snapshot value
 * (not namespaced) to match how `applyCreateNode` reads `originalIndex`
 * via `nodeData["originalIndex"]`.
 */
export interface CreateNodeRestoreMetadata {
  readonly originalIndex?: number;
  readonly pageId?: string | null;
}

/**
 * Create page operation value payload.
 * Stored in Operation.value for type="create_page".
 */
export interface CreatePageValue {
  readonly id: string;
  readonly name: string;
}

/**
 * Delete page operation value payload.
 * Stored in Operation.previousValue for type="delete_page" (snapshot for undo).
 */
export interface DeletePageSnapshot {
  readonly id: string;
  readonly name: string;
  readonly position: number;
}

/**
 * Rename page operation value payload.
 * Stored in Operation.value for type="rename_page".
 */
export interface RenamePageValue {
  readonly name: string;
}

/**
 * Reorder page operation value payload.
 * Stored in Operation.value for type="reorder_page".
 */
export interface ReorderPageValue {
  readonly position: number;
}

/**
 * Create token operation value payload.
 * Stored in Operation.value for type="create_token".
 */
export interface CreateTokenValue {
  readonly name: string;
  readonly token_type: string;
  readonly value: unknown;
  readonly description: string | null;
  readonly id: string;
}

/**
 * Update token operation value payload.
 * Stored in Operation.value for type="update_token".
 */
export interface UpdateTokenValue {
  readonly name: string;
  readonly value: unknown;
  readonly description: string | null;
}

/**
 * Delete token operation value payload.
 * Stored in Operation.previousValue for type="delete_token" (snapshot for undo).
 */
export interface DeleteTokenSnapshot {
  readonly name: string;
  readonly token_type: string;
  readonly value: unknown;
  readonly description: string | null;
  readonly id: string;
}

/**
 * Rename token operation value payload.
 * Stored in Operation.value for type="rename_token".
 * The same schema is used for previousValue (with names swapped) so that
 * createInverse produces a valid rename operation in the opposite direction.
 */
export interface RenameTokenValue {
  readonly old_name: string;
  readonly new_name: string;
  /** Full token snapshot for undo — preserved so rollback can restore. */
  readonly token_type: string;
  readonly value: unknown;
  readonly description: string | null;
  readonly id: string;
}

/** Maximum number of transactions in the undo or redo stack. */
export const MAX_HISTORY_SIZE = 500;

/** Maximum number of operations allowed in a single transaction. */
export const MAX_OPERATIONS_PER_TRANSACTION = 1000;
