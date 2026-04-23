/**
 * Pure factory functions for creating and inverting Operations and Transactions.
 *
 * Every factory assigns a fresh UUID via crypto.randomUUID().
 * All functions are pure (no side effects, no I/O).
 *
 * See: Spec 15, section 3.
 */

import type {
  Operation,
  OperationType,
  ReparentValue,
  ReorderValue,
  ReorderPreviousValue,
  CreatePageValue,
  DeletePageSnapshot,
  RenamePageValue,
  ReorderPageValue,
  CreateTokenValue,
  UpdateTokenValue,
  DeleteTokenSnapshot,
  RenameTokenValue,
  Transaction,
} from "./types";

// ── Internal helpers ─────────────────────────────────────────────────

function makeOp(
  userId: string,
  nodeUuid: string,
  type: OperationType,
  path: string,
  value: unknown,
  previousValue: unknown,
): Operation {
  return {
    id: crypto.randomUUID(),
    userId,
    nodeUuid,
    type,
    path,
    value,
    previousValue,
    seq: 0,
  };
}

/** Map from an operation type to its inverse type. */
function inverseType(type: OperationType): OperationType {
  if (type === "create_node") return "delete_node";
  if (type === "delete_node") return "create_node";
  if (type === "create_page") return "delete_page";
  if (type === "delete_page") return "create_page";
  if (type === "create_token") return "delete_token";
  if (type === "delete_token") return "create_token";
  return type; // set_field, reparent, reorder, rename_page, reorder_page, update_token invert by swapping values
}

// ── Public factory functions ─────────────────────────────────────────

/**
 * Create a set_field operation that changes a single field on a node.
 */
export function createSetFieldOp(
  userId: string,
  nodeUuid: string,
  path: string,
  value: unknown,
  previousValue: unknown,
): Operation {
  return makeOp(userId, nodeUuid, "set_field", path, value, previousValue);
}

/**
 * Create a create_node operation.
 * `nodeData` is the full node object to create.
 */
export function createCreateNodeOp(userId: string, nodeData: unknown): Operation {
  return makeOp(userId, "", "create_node", "", nodeData, null);
}

/**
 * Create a delete_node operation.
 * `nodeSnapshot` is the full node object being deleted (for undo).
 */
export function createDeleteNodeOp(
  userId: string,
  nodeUuid: string,
  nodeSnapshot: unknown,
): Operation {
  return makeOp(userId, nodeUuid, "delete_node", "", null, nodeSnapshot);
}

/**
 * Create a reparent operation.
 */
export function createReparentOp(
  userId: string,
  nodeUuid: string,
  newParentUuid: string,
  newPosition: number,
  oldParentUuid: string,
  oldPosition: number,
): Operation {
  const value: ReparentValue = { parentUuid: newParentUuid, position: newPosition };
  const previousValue: ReparentValue = { parentUuid: oldParentUuid, position: oldPosition };
  return makeOp(userId, nodeUuid, "reparent", "", value, previousValue);
}

/**
 * Create a reorder operation.
 */
export function createReorderOp(
  userId: string,
  nodeUuid: string,
  newPosition: number,
  oldPosition: number,
): Operation {
  // RF-002: Both value and previousValue use the unified `position` field
  // so that createInverse (which swaps value/previousValue) produces a
  // payload that applyReorder can always read without field-name mismatch.
  const value: ReorderValue = { position: newPosition };
  const previousValue: ReorderPreviousValue = { position: oldPosition };
  return makeOp(userId, nodeUuid, "reorder", "", value, previousValue);
}

/**
 * Create a create_page operation.
 * `pageData` contains the page's id and name.
 */
export function createCreatePageOp(userId: string, pageData: CreatePageValue): Operation {
  return makeOp(userId, pageData.id, "create_page", "", pageData, null);
}

/**
 * Create a delete_page operation.
 * `pageSnapshot` contains the page's id, name, and position for undo.
 */
export function createDeletePageOp(userId: string, pageSnapshot: DeletePageSnapshot): Operation {
  return makeOp(userId, pageSnapshot.id, "delete_page", "", null, pageSnapshot);
}

/**
 * Create a rename_page operation.
 */
export function createRenamePageOp(
  userId: string,
  pageId: string,
  newName: string,
  oldName: string,
): Operation {
  const value: RenamePageValue = { name: newName };
  const previousValue: RenamePageValue = { name: oldName };
  return makeOp(userId, pageId, "rename_page", "", value, previousValue);
}

/**
 * Create a reorder_page operation.
 */
export function createReorderPageOp(
  userId: string,
  pageId: string,
  newPosition: number,
  oldPosition: number,
): Operation {
  const value: ReorderPageValue = { position: newPosition };
  const previousValue: ReorderPageValue = { position: oldPosition };
  return makeOp(userId, pageId, "reorder_page", "", value, previousValue);
}

/**
 * Create a create_token operation.
 * `tokenData` contains the full token state for undo.
 */
export function createCreateTokenOp(userId: string, tokenData: CreateTokenValue): Operation {
  return makeOp(userId, tokenData.name, "create_token", "", tokenData, null);
}

/**
 * Create an update_token operation.
 * `newValue` is the new token state, `previousValue` is the old state (for undo).
 */
export function createUpdateTokenOp(
  userId: string,
  name: string,
  newValue: UpdateTokenValue,
  previousValue: UpdateTokenValue,
): Operation {
  return makeOp(userId, name, "update_token", "", newValue, previousValue);
}

/**
 * Create a delete_token operation.
 * `tokenSnapshot` contains the full token state for undo.
 */
export function createDeleteTokenOp(userId: string, tokenSnapshot: DeleteTokenSnapshot): Operation {
  return makeOp(userId, tokenSnapshot.name, "delete_token", "", null, tokenSnapshot);
}

/**
 * Create a rename_token operation.
 * `value` contains the forward rename data (old→new), `previousValue` contains
 * the reverse (new→old) for undo. Both use the same RenameTokenValue schema.
 */
export function createRenameTokenOp(
  userId: string,
  value: RenameTokenValue,
  previousValue: RenameTokenValue,
): Operation {
  return makeOp(userId, value.old_name, "rename_token", "", value, previousValue);
}

/**
 * Create the inverse of an operation by swapping value/previousValue
 * and flipping create_node <-> delete_node.
 *
 * The inverse gets a fresh id and seq=0.
 */
export function createInverse(op: Operation): Operation {
  // When inverting create_node → delete_node, the original op has nodeUuid=""
  // because the node didn't exist yet. Extract the UUID from the value payload
  // so the delete_node inverse knows which node to delete.
  let nodeUuid = op.nodeUuid;
  if (op.type === "create_node" && nodeUuid === "") {
    const val = op.value as Record<string, unknown> | null;
    nodeUuid = (typeof val?.uuid === "string" ? val.uuid : "") as string;
  }
  // For create_page, the page ID is in the value payload's `id` field.
  if (op.type === "create_page" && nodeUuid === "") {
    const val = op.value as Record<string, unknown> | null;
    nodeUuid = (typeof val?.id === "string" ? val.id : "") as string;
  }

  return {
    id: crypto.randomUUID(),
    userId: op.userId,
    nodeUuid,
    type: inverseType(op.type),
    path: op.path,
    value: op.previousValue,
    previousValue: op.value,
    seq: 0,
  };
}

/**
 * Create the inverse of a transaction: inverse all operations in reverse order.
 *
 * The inverse transaction gets a fresh id, fresh timestamp, seq=0,
 * and a description prefixed with "Undo: ".
 */
export function createInverseTransaction(tx: Transaction): Transaction {
  return {
    id: crypto.randomUUID(),
    userId: tx.userId,
    operations: [...tx.operations].reverse().map(createInverse),
    description: `Undo: ${tx.description}`,
    timestamp: Date.now(),
    seq: 0,
  };
}
