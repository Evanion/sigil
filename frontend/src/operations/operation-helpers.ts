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
  return type; // set_field, reparent, reorder invert by swapping values
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
export function createCreateNodeOp(
  userId: string,
  nodeData: unknown,
): Operation {
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
  const value: ReorderValue = { newPosition };
  const previousValue: ReorderPreviousValue = { oldPosition };
  return makeOp(userId, nodeUuid, "reorder", "", value, previousValue);
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
