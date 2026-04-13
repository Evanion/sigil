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
  | "delete_node"
  | "reparent"
  | "reorder"
  | "create_page"
  | "delete_page"
  | "rename_page"
  | "reorder_page"
  | "create_token"
  | "update_token"
  | "delete_token";

/**
 * A single field-level mutation.
 *
 * The inverse of any operation is constructed by swapping `value` and
 * `previousValue`. For `create_node`, the inverse type is `delete_node`
 * and vice versa.
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
  /** New value (full node data for create_node). */
  readonly value: unknown;
  /** Old value (full node snapshot for delete_node). */
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

/** Maximum number of transactions in the undo or redo stack. */
export const MAX_HISTORY_SIZE = 500;

/** Maximum number of operations allowed in a single transaction. */
export const MAX_OPERATIONS_PER_TRANSACTION = 1000;
