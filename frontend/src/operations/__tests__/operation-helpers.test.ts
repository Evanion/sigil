import { describe, it, expect } from "vitest";
import {
  createSetFieldOp,
  createCreateNodeOp,
  createDeleteNodeOp,
  createDeleteNodesOp,
  createReparentOp,
  createReorderOp,
  createInverse,
  createInverseTransaction,
} from "../operation-helpers";
import type { Operation, Transaction } from "../types";

/** Local test helper that mirrors the internal `makeOp` factory shape. */
function makeOp(
  userId: string,
  nodeUuid: string,
  type: Operation["type"],
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

const USER_ID = "user-1";

describe("createSetFieldOp", () => {
  it("creates a set_field operation with correct fields", () => {
    const op = createSetFieldOp(USER_ID, "node-1", "transform", { x: 10 }, { x: 0 });
    expect(op.type).toBe("set_field");
    expect(op.userId).toBe(USER_ID);
    expect(op.nodeUuid).toBe("node-1");
    expect(op.path).toBe("transform");
    expect(op.value).toEqual({ x: 10 });
    expect(op.previousValue).toEqual({ x: 0 });
    expect(op.seq).toBe(0);
  });

  it("assigns a unique UUID as id", () => {
    const op1 = createSetFieldOp(USER_ID, "node-1", "name", "new", "old");
    const op2 = createSetFieldOp(USER_ID, "node-1", "name", "new", "old");
    expect(op1.id).not.toBe(op2.id);
    // UUID format: 8-4-4-4-12 hex chars
    expect(op1.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});

describe("createCreateNodeOp", () => {
  it("creates a create_node operation", () => {
    const nodeData = { uuid: "new-node", kind: { type: "rectangle" }, name: "Rect 1" };
    const op = createCreateNodeOp(USER_ID, nodeData);
    expect(op.type).toBe("create_node");
    expect(op.nodeUuid).toBe("");
    expect(op.path).toBe("");
    expect(op.value).toEqual(nodeData);
    expect(op.previousValue).toBeNull();
  });
});

describe("createDeleteNodeOp", () => {
  it("creates a delete_node operation with snapshot as previousValue", () => {
    const snapshot = { uuid: "node-1", kind: { type: "rectangle" }, name: "Rect 1" };
    const op = createDeleteNodeOp(USER_ID, "node-1", snapshot);
    expect(op.type).toBe("delete_node");
    expect(op.nodeUuid).toBe("node-1");
    expect(op.path).toBe("");
    expect(op.value).toBeNull();
    expect(op.previousValue).toEqual(snapshot);
  });
});

describe("createReparentOp", () => {
  it("creates a reparent operation with new and old parent info", () => {
    const op = createReparentOp(USER_ID, "node-1", "parent-new", 2, "parent-old", 0);
    expect(op.type).toBe("reparent");
    expect(op.nodeUuid).toBe("node-1");
    expect(op.path).toBe("");
    expect(op.value).toEqual({ parentUuid: "parent-new", position: 2 });
    expect(op.previousValue).toEqual({ parentUuid: "parent-old", position: 0 });
  });
});

describe("createReorderOp", () => {
  it("creates a reorder operation with new and old positions", () => {
    const op = createReorderOp(USER_ID, "node-1", 3, 1);
    expect(op.type).toBe("reorder");
    expect(op.nodeUuid).toBe("node-1");
    expect(op.path).toBe("");
    expect(op.value).toEqual({ position: 3 });
    expect(op.previousValue).toEqual({ position: 1 });
  });
});

describe("createInverse", () => {
  it("swaps value and previousValue for set_field", () => {
    const op = createSetFieldOp(USER_ID, "node-1", "name", "new", "old");
    const inv = createInverse(op);
    expect(inv.type).toBe("set_field");
    expect(inv.value).toBe("old");
    expect(inv.previousValue).toBe("new");
    expect(inv.nodeUuid).toBe("node-1");
    expect(inv.path).toBe("name");
    expect(inv.userId).toBe(USER_ID);
  });

  it("assigns a new id to the inverse", () => {
    const op = createSetFieldOp(USER_ID, "node-1", "name", "new", "old");
    const inv = createInverse(op);
    expect(inv.id).not.toBe(op.id);
  });

  it("flips create_node to delete_node and extracts nodeUuid from value", () => {
    const nodeData = { uuid: "new-node", kind: { type: "rectangle" } };
    const op = createCreateNodeOp(USER_ID, nodeData);
    const inv = createInverse(op);
    expect(inv.type).toBe("delete_node");
    expect(inv.value).toBeNull();
    expect(inv.previousValue).toEqual(nodeData);
    // RF-002: inverse of create_node should carry the node UUID
    expect(inv.nodeUuid).toBe("new-node");
  });

  it("falls back to empty nodeUuid when create_node value has no uuid field", () => {
    const nodeData = { kind: { type: "rectangle" } };
    const op = createCreateNodeOp(USER_ID, nodeData);
    const inv = createInverse(op);
    expect(inv.type).toBe("delete_node");
    expect(inv.nodeUuid).toBe("");
  });

  it("flips delete_node to create_node", () => {
    const snapshot = { uuid: "node-1", kind: { type: "rectangle" } };
    const op = createDeleteNodeOp(USER_ID, "node-1", snapshot);
    const inv = createInverse(op);
    expect(inv.type).toBe("create_node");
    expect(inv.value).toEqual(snapshot);
    expect(inv.previousValue).toBeNull();
  });

  it("swaps value and previousValue for reparent", () => {
    const op = createReparentOp(USER_ID, "node-1", "parent-new", 2, "parent-old", 0);
    const inv = createInverse(op);
    expect(inv.type).toBe("reparent");
    expect(inv.value).toEqual({ parentUuid: "parent-old", position: 0 });
    expect(inv.previousValue).toEqual({ parentUuid: "parent-new", position: 2 });
  });

  it("swaps value and previousValue for reorder", () => {
    const op = createReorderOp(USER_ID, "node-1", 3, 1);
    const inv = createInverse(op);
    expect(inv.type).toBe("reorder");
    // RF-002: After inversion, value/previousValue are swapped.
    // With unified `position` field, the inverse reads correctly.
    expect(inv.value).toEqual({ position: 1 });
    expect(inv.previousValue).toEqual({ position: 3 });
  });

  it("preserves seq = 0 on inverse", () => {
    const op = createSetFieldOp(USER_ID, "node-1", "name", "new", "old");
    op.seq = 42;
    const inv = createInverse(op);
    expect(inv.seq).toBe(0);
  });
});

describe("createInverseTransaction", () => {
  it("inverts all operations in reverse order", () => {
    const op1 = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
    const op2 = createSetFieldOp(USER_ID, "node-2", "visible", false, true);

    const tx: Transaction = {
      id: "tx-1",
      userId: USER_ID,
      operations: [op1, op2],
      description: "Test transaction",
      timestamp: 1000,
      seq: 0,
    };

    const inv = createInverseTransaction(tx);
    expect(inv.operations).toHaveLength(2);
    // Reversed order
    expect(inv.operations[0].nodeUuid).toBe("node-2");
    expect(inv.operations[1].nodeUuid).toBe("node-1");
    // Values swapped
    expect(inv.operations[0].value).toBe(true);
    expect(inv.operations[0].previousValue).toBe(false);
    expect(inv.operations[1].value).toBe("A");
    expect(inv.operations[1].previousValue).toBe("B");
  });

  it("assigns a new id and fresh timestamp to the inverse transaction", () => {
    const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
    const tx: Transaction = {
      id: "tx-1",
      userId: USER_ID,
      operations: [op],
      description: "Original",
      timestamp: 1000,
      seq: 5,
    };

    const inv = createInverseTransaction(tx);
    expect(inv.id).not.toBe(tx.id);
    expect(inv.timestamp).toBeGreaterThanOrEqual(tx.timestamp);
    expect(inv.seq).toBe(0);
    expect(inv.userId).toBe(USER_ID);
  });

  it("prefixes description with 'Undo: '", () => {
    const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
    const tx: Transaction = {
      id: "tx-1",
      userId: USER_ID,
      operations: [op],
      description: "Move Rectangle 1",
      timestamp: 1000,
      seq: 0,
    };

    const inv = createInverseTransaction(tx);
    expect(inv.description).toBe("Undo: Move Rectangle 1");
  });
});

describe("createDeleteNodesOp (Spec 19)", () => {
  it("creates a delete_nodes operation with node_uuids in value", () => {
    const op = createDeleteNodesOp("user-1", ["uuid-a", "uuid-b"]);
    expect(op.type).toBe("delete_nodes");
    expect(op.userId).toBe("user-1");
    expect(op.nodeUuid).toBe("");
    expect(op.value).toEqual({ node_uuids: ["uuid-a", "uuid-b"] });
    expect(op.previousValue).toBeNull();
  });

  it("copies the input array (does not retain reference)", () => {
    const inputUuids = ["uuid-a", "uuid-b"];
    const op = createDeleteNodesOp("user-1", inputUuids);
    inputUuids.push("uuid-c");
    expect((op.value as { node_uuids: string[] }).node_uuids).toEqual(["uuid-a", "uuid-b"]);
  });
});

describe("createInverseTransaction with inverseOperations (Spec 19)", () => {
  it("uses pre-built inverseOperations when present", () => {
    const inverse1 = makeOp("user-1", "a", "create_node", "", { uuid: "a" }, null);
    const inverse2 = makeOp("user-1", "b", "create_node", "", { uuid: "b" }, null);
    const tx: Transaction = {
      id: "tx-1",
      userId: "user-1",
      operations: [makeOp("user-1", "", "delete_nodes", "", { node_uuids: ["a", "b"] }, null)],
      inverseOperations: [inverse1, inverse2],
      description: "Delete 2 nodes",
      timestamp: 1000,
      seq: 1,
    };
    const result = createInverseTransaction(tx);
    expect(result.operations.length).toBe(2);
    expect(result.operations[0].type).toBe("create_node");
    expect(result.operations[1].type).toBe("create_node");
    expect(result.description).toBe("Undo: Delete 2 nodes");
  });

  it("falls back to per-op flip when inverseOperations is absent", () => {
    // Existing single-op flip path still works.
    const op = makeOp("user-1", "node-x", "set_field", "name", "new", "old");
    const tx: Transaction = {
      id: "tx-1",
      userId: "user-1",
      operations: [op],
      description: "Rename",
      timestamp: 1000,
      seq: 1,
    };
    const result = createInverseTransaction(tx);
    expect(result.operations.length).toBe(1);
    expect(result.operations[0].value).toBe("old");
    expect(result.operations[0].previousValue).toBe("new");
  });
});
