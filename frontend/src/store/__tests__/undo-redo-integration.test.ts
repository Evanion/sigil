/**
 * Integration tests for the full undo/redo flow:
 * mutation -> undo -> redo, verifying store state at each step.
 *
 * Uses a HistoryManager with a simulated store state (plain object +
 * setState function) and applyOperationToStore to test the operation
 * tracking, undo, and redo without a full urql client.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { HistoryManager } from "../../operations/history-manager";
import {
  createSetFieldOp,
  createCreateNodeOp,
  createDeleteNodesOp,
} from "../../operations/operation-helpers";
import { applyOperationToStore, type StoreStateReader } from "../../operations/apply-to-store";
import type { Transaction, Operation } from "../../operations/types";

// ── Test helpers ────────────────────────────────────────────────────────

/** Deep clone using JSON round-trip (same as store's deepClone). */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const TEST_USER_ID = "test-user-session";

const DEFAULT_TRANSFORM = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  scale_x: 1,
  scale_y: 1,
};
const DEFAULT_STYLE = {
  fills: [],
  strokes: [],
  opacity: { type: "literal" as const, value: 1 },
  blend_mode: "normal" as const,
  effects: [],
};

/** Minimal node shape for tests. */
function makeTestNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uuid: "node-1",
    name: "Rectangle 1",
    visible: true,
    locked: false,
    transform: deepClone(DEFAULT_TRANSFORM),
    style: deepClone(DEFAULT_STYLE),
    kind: {
      type: "rectangle",
      corners: [
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
      ],
    },
    parentUuid: null,
    childrenUuids: [],
    ...overrides,
  };
}

/**
 * Creates a simple in-memory store simulation that mirrors how Solid's
 * setState works for our purposes. We track a plain object and route
 * setState calls to update it, so the StoreStateReader always reflects
 * the latest state.
 */
function createTestStore() {
  const storeData: Record<string, Record<string, unknown>> = { nodes: {} };

  function getNodes(): Record<string, Record<string, unknown>> {
    return storeData["nodes"] as Record<string, Record<string, unknown>>;
  }

  const reader: StoreStateReader = {
    getNode(uuid: string): Record<string, unknown> | undefined {
      return getNodes()[uuid];
    },
  };

  /**
   * Minimal setState simulation that handles the call patterns used by
   * applyOperationToStore:
   * - setState("nodes", uuid, field, value) — set a field on a node
   * - setState("nodes", uuid, nodeObj) — create/set a full node
   * - setState(produce(fn)) — produce callback with mutable draft
   */
  function setState(...args: unknown[]): void {
    if (args.length === 1 && typeof args[0] === "function") {
      // produce() callback — call with mutable draft
      const fn = args[0] as (draft: Record<string, unknown>) => void;
      fn(storeData);
      return;
    }
    if (args.length === 4 && args[0] === "nodes") {
      const uuid = args[1] as string;
      const field = args[2] as string;
      const value = args[3];
      const nodes = getNodes();
      if (nodes[uuid]) {
        nodes[uuid][field] = value;
      }
      return;
    }
    if (args.length === 3 && args[0] === "nodes") {
      const uuid = args[1] as string;
      const value = args[2];
      const nodes = getNodes();
      nodes[uuid] = value as Record<string, unknown>;
      return;
    }
  }

  return { storeData, getNodes, reader, setState };
}

/** Helper: apply op to store and track in HistoryManager. */
function applyAndTrack(
  op: Operation,
  description: string,
  historyManager: HistoryManager,
  setState: (...args: unknown[]) => void,
  reader: StoreStateReader,
): void {
  applyOperationToStore(op, setState, reader);
  historyManager.apply(op, description);
}

/** Helper: undo via HistoryManager, apply inverse to store. */
function undoAndApply(
  historyManager: HistoryManager,
  setState: (...args: unknown[]) => void,
  reader: StoreStateReader,
): Transaction | null {
  const inverseTx = historyManager.undo();
  if (!inverseTx) return null;
  for (const op of inverseTx.operations) {
    applyOperationToStore(op, setState, reader);
  }
  return inverseTx;
}

/** Helper: redo via HistoryManager, apply forward ops to store. */
function redoAndApply(
  historyManager: HistoryManager,
  setState: (...args: unknown[]) => void,
  reader: StoreStateReader,
): Transaction | null {
  const redoTx = historyManager.redo();
  if (!redoTx) return null;
  for (const op of redoTx.operations) {
    applyOperationToStore(op, setState, reader);
  }
  return redoTx;
}

describe("undo/redo integration", () => {
  let historyManager: HistoryManager;
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    historyManager = new HistoryManager(TEST_USER_ID);
    store = createTestStore();

    // Seed the store with a test node
    const nodes = store.getNodes();
    nodes["node-1"] = makeTestNode();
  });

  it("should restore previous transform on undo after setTransform", () => {
    const originalTransform = deepClone(store.getNodes()["node-1"]["transform"]);
    const newTransform = {
      x: 50,
      y: 50,
      width: 200,
      height: 200,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
    };

    // Apply setTransform
    const op = createSetFieldOp(
      TEST_USER_ID,
      "node-1",
      "transform",
      newTransform,
      originalTransform,
    );
    applyAndTrack(op, "Move Rectangle 1", historyManager, store.setState, store.reader);

    // Verify new value applied
    expect(store.getNodes()["node-1"]["transform"]).toEqual(newTransform);

    // Undo
    const inverseTx = undoAndApply(historyManager, store.setState, store.reader);
    expect(inverseTx).not.toBeNull();

    // Verify original value restored
    expect(store.getNodes()["node-1"]["transform"]).toEqual(originalTransform);

    // Redo
    const redoTx = redoAndApply(historyManager, store.setState, store.reader);
    expect(redoTx).not.toBeNull();

    // Verify new value re-applied
    expect(store.getNodes()["node-1"]["transform"]).toEqual(newTransform);
  });

  it("should restore previous name on undo after renameNode", () => {
    const op = createSetFieldOp(TEST_USER_ID, "node-1", "name", "New Name", "Rectangle 1");
    applyAndTrack(
      op,
      "Rename Rectangle 1 to New Name",
      historyManager,
      store.setState,
      store.reader,
    );

    expect(store.getNodes()["node-1"]["name"]).toBe("New Name");

    undoAndApply(historyManager, store.setState, store.reader);
    expect(store.getNodes()["node-1"]["name"]).toBe("Rectangle 1");

    redoAndApply(historyManager, store.setState, store.reader);
    expect(store.getNodes()["node-1"]["name"]).toBe("New Name");
  });

  it("should restore the node on undo after deleteNodes (single-uuid batch)", () => {
    // Spec 19 Task 16: after the singular per-uuid path removal, deletion
    // flows through the plural `delete_nodes` path. The store-level
    // `deleteNodes` builds a transaction with explicit `inverseOperations`
    // (a list of `create_node` snapshots). Mirror that pattern here so the
    // undo path exercises the same round-trip without depending on the
    // removed per-op flip.
    const nodeSnapshot = deepClone(store.getNodes()["node-1"]);
    const forwardOp = createDeleteNodesOp(TEST_USER_ID, ["node-1"]);
    const inverseOp = createCreateNodeOp(TEST_USER_ID, nodeSnapshot);
    const tx: Transaction = {
      id: crypto.randomUUID(),
      userId: TEST_USER_ID,
      operations: [forwardOp],
      inverseOperations: [inverseOp],
      description: "Delete Rectangle 1",
      timestamp: Date.now(),
      seq: 0,
    };
    // Apply forward op to the store directly, then push the transaction
    // (mirrors what `store.deleteNodes` does internally via the interceptor).
    applyOperationToStore(forwardOp, store.setState, store.reader);
    historyManager.pushTransaction(tx);

    // Node should be deleted
    expect(store.getNodes()["node-1"]).toBeUndefined();

    // Undo restores the node via the explicit inverseOperations
    undoAndApply(historyManager, store.setState, store.reader);
    expect(store.getNodes()["node-1"]).toBeDefined();
    expect(store.getNodes()["node-1"]["name"]).toBe("Rectangle 1");

    // Redo deletes again
    redoAndApply(historyManager, store.setState, store.reader);
    expect(store.getNodes()["node-1"]).toBeUndefined();
  });

  it("should revert all transforms on single undo for batchSetTransform", () => {
    // Add a second node
    store.getNodes()["node-2"] = makeTestNode({
      uuid: "node-2",
      name: "Rectangle 2",
      transform: deepClone(DEFAULT_TRANSFORM),
    });

    const prev1 = deepClone(store.getNodes()["node-1"]["transform"]);
    const prev2 = deepClone(store.getNodes()["node-2"]["transform"]);
    const new1 = { x: 10, y: 10, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 };
    const new2 = { x: 20, y: 20, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 };

    // Apply both ops to store
    const op1 = createSetFieldOp(TEST_USER_ID, "node-1", "transform", new1, prev1);
    const op2 = createSetFieldOp(TEST_USER_ID, "node-2", "transform", new2, prev2);
    applyOperationToStore(op1, store.setState, store.reader);
    applyOperationToStore(op2, store.setState, store.reader);

    // Push as single transaction
    const tx: Transaction = {
      id: crypto.randomUUID(),
      userId: TEST_USER_ID,
      operations: [op1, op2],
      description: "Align 2 nodes",
      timestamp: Date.now(),
      seq: 0,
    };
    historyManager.pushTransaction(tx);

    expect(store.getNodes()["node-1"]["transform"]).toEqual(new1);
    expect(store.getNodes()["node-2"]["transform"]).toEqual(new2);

    // Single undo reverts both
    undoAndApply(historyManager, store.setState, store.reader);
    expect(store.getNodes()["node-1"]["transform"]).toEqual(prev1);
    expect(store.getNodes()["node-2"]["transform"]).toEqual(prev2);
  });

  it("should undo multiple mutations in reverse order", () => {
    const originalTransform = deepClone(store.getNodes()["node-1"]["transform"]);
    const newTransform = {
      x: 50,
      y: 50,
      width: 200,
      height: 200,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
    };

    // Mutation 1: setTransform
    const op1 = createSetFieldOp(
      TEST_USER_ID,
      "node-1",
      "transform",
      newTransform,
      originalTransform,
    );
    applyAndTrack(op1, "Move Rectangle 1", historyManager, store.setState, store.reader);

    // Mutation 2: rename
    const op2 = createSetFieldOp(TEST_USER_ID, "node-1", "name", "Renamed", "Rectangle 1");
    applyAndTrack(op2, "Rename", historyManager, store.setState, store.reader);

    // Mutation 3: toggle visible
    const op3 = createSetFieldOp(TEST_USER_ID, "node-1", "visible", false, true);
    applyAndTrack(op3, "Hide", historyManager, store.setState, store.reader);

    // Undo 3: visible reverts
    undoAndApply(historyManager, store.setState, store.reader);
    expect(store.getNodes()["node-1"]["visible"]).toBe(true);
    expect(store.getNodes()["node-1"]["name"]).toBe("Renamed");

    // Undo 2: name reverts
    undoAndApply(historyManager, store.setState, store.reader);
    expect(store.getNodes()["node-1"]["name"]).toBe("Rectangle 1");
    expect(store.getNodes()["node-1"]["transform"]).toEqual(newTransform);

    // Undo 1: transform reverts
    undoAndApply(historyManager, store.setState, store.reader);
    expect(store.getNodes()["node-1"]["transform"]).toEqual(originalTransform);
  });

  it("should clear redo stack when a new mutation is made after undo", () => {
    const original = deepClone(store.getNodes()["node-1"]["transform"]);
    const newVal = { x: 50, y: 50, width: 200, height: 200, rotation: 0, scale_x: 1, scale_y: 1 };

    // Mutate
    const op1 = createSetFieldOp(TEST_USER_ID, "node-1", "transform", newVal, original);
    applyAndTrack(op1, "Move", historyManager, store.setState, store.reader);

    // Undo
    undoAndApply(historyManager, store.setState, store.reader);
    expect(historyManager.canRedo()).toBe(true);

    // New mutation clears redo
    const op2 = createSetFieldOp(TEST_USER_ID, "node-1", "name", "New Name", "Rectangle 1");
    applyAndTrack(op2, "Rename", historyManager, store.setState, store.reader);

    expect(historyManager.canRedo()).toBe(false);
    // Redo should return null
    const redoTx = historyManager.redo();
    expect(redoTx).toBeNull();
  });

  it("should return the inverse transaction from undo for server send", () => {
    const original = deepClone(store.getNodes()["node-1"]["transform"]);
    const newVal = { x: 50, y: 50, width: 200, height: 200, rotation: 0, scale_x: 1, scale_y: 1 };

    const op = createSetFieldOp(TEST_USER_ID, "node-1", "transform", newVal, original);
    applyAndTrack(op, "Move", historyManager, store.setState, store.reader);

    const inverseTx = undoAndApply(historyManager, store.setState, store.reader);
    expect(inverseTx).not.toBeNull();
    if (inverseTx === null) return; // type narrowing for strict TS
    expect(inverseTx.operations).toHaveLength(1);

    // The inverse operation should have the original value as its value
    // (to revert the forward mutation on the server)
    const inverseOp = inverseTx.operations[0];
    expect(inverseOp.type).toBe("set_field");
    expect(inverseOp.path).toBe("transform");
    expect(inverseOp.value).toEqual(original);
  });

  it("should return the redo transaction from redo for server send", () => {
    const original = deepClone(store.getNodes()["node-1"]["transform"]);
    const newVal = { x: 50, y: 50, width: 200, height: 200, rotation: 0, scale_x: 1, scale_y: 1 };

    const op = createSetFieldOp(TEST_USER_ID, "node-1", "transform", newVal, original);
    applyAndTrack(op, "Move", historyManager, store.setState, store.reader);

    undoAndApply(historyManager, store.setState, store.reader);
    const redoTx = redoAndApply(historyManager, store.setState, store.reader);
    expect(redoTx).not.toBeNull();
    if (redoTx === null) return; // type narrowing for strict TS
    expect(redoTx.operations).toHaveLength(1);

    const redoOp = redoTx.operations[0];
    expect(redoOp.type).toBe("set_field");
    expect(redoOp.path).toBe("transform");
    expect(redoOp.value).toEqual(newVal);
  });

  it("should report canUndo/canRedo correctly", () => {
    expect(historyManager.canUndo()).toBe(false);
    expect(historyManager.canRedo()).toBe(false);

    const op = createSetFieldOp(TEST_USER_ID, "node-1", "name", "New", "Rectangle 1");
    applyAndTrack(op, "Rename", historyManager, store.setState, store.reader);

    expect(historyManager.canUndo()).toBe(true);
    expect(historyManager.canRedo()).toBe(false);

    undoAndApply(historyManager, store.setState, store.reader);
    expect(historyManager.canUndo()).toBe(false);
    expect(historyManager.canRedo()).toBe(true);

    redoAndApply(historyManager, store.setState, store.reader);
    expect(historyManager.canUndo()).toBe(true);
    expect(historyManager.canRedo()).toBe(false);
  });
});

// ── Spec 19: deleteNodes (atomic multi-node delete) ─────────────────────
//
// These tests pin the contract added by Spec 19, Tasks 7–11:
//   - `Transaction.inverseOperations` carries the N-op inverse for a
//     single forward `delete_nodes` op (Task 7).
//   - `applyOperationToStore` understands the `delete_nodes` type and
//     removes each node in the list (Task 9), reusing the per-uuid
//     delete logic that also strips parent.childrenUuids.
//   - `HistoryManager.undo()` reads `inverseOperations` via
//     `createInverseTransaction` and returns it for the caller to apply.
//
// The test file uses HistoryManager + applyOperationToStore directly
// (not the full Solid store), mirroring the single-uuid delete_nodes test
// above. The forward op + N inverse `create_node` ops are constructed
// inline to match what `store.deleteNodes` creates internally.

describe("deleteNodes — undo/redo integration (Spec 19)", () => {
  it("undoing a deleteNodes transaction restores all deleted nodes", () => {
    const historyManager = new HistoryManager(TEST_USER_ID);
    const store = createTestStore();

    // Seed: two sibling nodes with no parent.
    const nodeA = makeTestNode({ uuid: "a", name: "Node A" });
    const nodeB = makeTestNode({ uuid: "b", name: "Node B" });
    store.getNodes()["a"] = deepClone(nodeA);
    store.getNodes()["b"] = deepClone(nodeB);

    // Build the forward delete_nodes op and the N inverse create_node ops
    // — matching what store.deleteNodes (Task 11) will produce.
    const forwardOp: Operation = {
      id: crypto.randomUUID(),
      userId: TEST_USER_ID,
      nodeUuid: "",
      type: "delete_nodes",
      path: "",
      value: { node_uuids: ["a", "b"] },
      previousValue: null,
      seq: 0,
    };
    const inverseOps: Operation[] = [
      {
        id: crypto.randomUUID(),
        userId: TEST_USER_ID,
        nodeUuid: "a",
        type: "create_node",
        path: "",
        value: deepClone(nodeA),
        previousValue: null,
        seq: 0,
      },
      {
        id: crypto.randomUUID(),
        userId: TEST_USER_ID,
        nodeUuid: "b",
        type: "create_node",
        path: "",
        value: deepClone(nodeB),
        previousValue: null,
        seq: 0,
      },
    ];
    const tx: Transaction = {
      id: crypto.randomUUID(),
      userId: TEST_USER_ID,
      operations: [forwardOp],
      inverseOperations: inverseOps,
      description: "Delete 2 nodes",
      timestamp: Date.now(),
      seq: 0,
    };

    // Apply the forward op (simulating store.deleteNodes' optimistic local mutation).
    applyOperationToStore(forwardOp, store.setState, store.reader);
    expect(store.getNodes()["a"]).toBeUndefined();
    expect(store.getNodes()["b"]).toBeUndefined();

    // Track in history.
    historyManager.pushTransaction(tx);
    expect(historyManager.canUndo()).toBe(true);

    // Undo: a single undo step must return the inverse transaction carrying
    // both create_node ops (this exercises Transaction.inverseOperations
    // routing through createInverseTransaction).
    const inverseTx = historyManager.undo();
    expect(inverseTx).not.toBeNull();
    if (inverseTx === null) return;
    expect(inverseTx.operations).toHaveLength(2);
    expect(inverseTx.operations[0].type).toBe("create_node");
    expect(inverseTx.operations[1].type).toBe("create_node");

    // Apply each inverse op to the store.
    for (const op of inverseTx.operations) {
      applyOperationToStore(op, store.setState, store.reader);
    }

    // Both nodes restored.
    expect(store.getNodes()["a"]).toBeDefined();
    expect(store.getNodes()["b"]).toBeDefined();
    expect(store.getNodes()["a"]["name"]).toBe("Node A");
    expect(store.getNodes()["b"]["name"]).toBe("Node B");
  });

  it("undoing a deleteNodes restores nodes in original sibling order", () => {
    const historyManager = new HistoryManager(TEST_USER_ID);
    const store = createTestStore();

    // Build parent P with three children [C0, C1, C2] — delete C1 and C2.
    // The invariant under test: the inverse create_node ops, sorted by
    // originalIndex ASC, restore parent.childrenUuids to its original
    // [C0, C1, C2] order. This works because applyCreateNode appends to
    // parent.childrenUuids in arrival order.
    const parent = makeTestNode({
      uuid: "P",
      name: "Parent",
      childrenUuids: ["C0", "C1", "C2"],
    });
    const c0 = makeTestNode({ uuid: "C0", name: "C0", parentUuid: "P" });
    const c1 = makeTestNode({ uuid: "C1", name: "C1", parentUuid: "P" });
    const c2 = makeTestNode({ uuid: "C2", name: "C2", parentUuid: "P" });

    const nodes = store.getNodes();
    nodes["P"] = deepClone(parent);
    nodes["C0"] = deepClone(c0);
    nodes["C1"] = deepClone(c1);
    nodes["C2"] = deepClone(c2);

    // Forward op deletes C1 and C2.
    const forwardOp: Operation = {
      id: crypto.randomUUID(),
      userId: TEST_USER_ID,
      nodeUuid: "",
      type: "delete_nodes",
      path: "",
      value: { node_uuids: ["C1", "C2"] },
      previousValue: null,
      seq: 0,
    };
    // Inverse ops sorted by originalIndex ASC: C1 (index 1) first, C2 (index 2) second.
    const inverseOps: Operation[] = [
      {
        id: crypto.randomUUID(),
        userId: TEST_USER_ID,
        nodeUuid: "C1",
        type: "create_node",
        path: "",
        value: deepClone(c1),
        previousValue: null,
        seq: 0,
      },
      {
        id: crypto.randomUUID(),
        userId: TEST_USER_ID,
        nodeUuid: "C2",
        type: "create_node",
        path: "",
        value: deepClone(c2),
        previousValue: null,
        seq: 0,
      },
    ];
    const tx: Transaction = {
      id: crypto.randomUUID(),
      userId: TEST_USER_ID,
      operations: [forwardOp],
      inverseOperations: inverseOps,
      description: "Delete C1, C2",
      timestamp: Date.now(),
      seq: 0,
    };

    // Apply forward op.
    applyOperationToStore(forwardOp, store.setState, store.reader);
    expect(store.getNodes()["C1"]).toBeUndefined();
    expect(store.getNodes()["C2"]).toBeUndefined();
    // Parent's childrenUuids should now hold only C0.
    expect(store.getNodes()["P"]["childrenUuids"]).toEqual(["C0"]);

    // Push and undo.
    historyManager.pushTransaction(tx);
    const inverseTx = historyManager.undo();
    expect(inverseTx).not.toBeNull();
    if (inverseTx === null) return;

    for (const op of inverseTx.operations) {
      applyOperationToStore(op, store.setState, store.reader);
    }

    // Both deleted children restored.
    expect(store.getNodes()["C1"]).toBeDefined();
    expect(store.getNodes()["C2"]).toBeDefined();
    // The key invariant: parent.childrenUuids is back to [C0, C1, C2].
    expect(store.getNodes()["P"]["childrenUuids"]).toEqual(["C0", "C1", "C2"]);
  });

  it("restores middle child at original index on undo (Spec 19 sibling-order fix)", () => {
    // Bug scenario from Spec 19 Task 13: deleting a non-tail sibling and
    // undoing must restore parent.childrenUuids to its original order.
    //
    // Parent P has children [C0, C1, C2]. Delete C1 only.
    //   Forward: parent.childrenUuids becomes ["C0", "C2"].
    //   Undo: inverse create_node for C1 carries originalIndex=1 in its
    //         node-data snapshot. applyCreateNode must INSERT at index 1,
    //         not append — otherwise parent.childrenUuids would land at
    //         ["C0", "C2", "C1"], destroying user-visible order.
    //   Expected: parent.childrenUuids = ["C0", "C1", "C2"].
    const historyManager = new HistoryManager(TEST_USER_ID);
    const store = createTestStore();

    const parent = makeTestNode({
      uuid: "P",
      name: "Parent",
      childrenUuids: ["C0", "C1", "C2"],
    });
    const c0 = makeTestNode({ uuid: "C0", name: "C0", parentUuid: "P" });
    const c1 = makeTestNode({ uuid: "C1", name: "C1", parentUuid: "P" });
    const c2 = makeTestNode({ uuid: "C2", name: "C2", parentUuid: "P" });

    const nodes = store.getNodes();
    nodes["P"] = deepClone(parent);
    nodes["C0"] = deepClone(c0);
    nodes["C1"] = deepClone(c1);
    nodes["C2"] = deepClone(c2);

    const forwardOp: Operation = {
      id: crypto.randomUUID(),
      userId: TEST_USER_ID,
      nodeUuid: "",
      type: "delete_nodes",
      path: "",
      value: { node_uuids: ["C1"] },
      previousValue: null,
      seq: 0,
    };
    // Spec 19 sibling-order fix: inverse op carries originalIndex=1 so
    // applyCreateNode inserts at the original position rather than appending.
    const inverseOps: Operation[] = [
      {
        id: crypto.randomUUID(),
        userId: TEST_USER_ID,
        nodeUuid: "C1",
        type: "create_node",
        path: "",
        value: { ...deepClone(c1), originalIndex: 1 },
        previousValue: null,
        seq: 0,
      },
    ];
    const tx: Transaction = {
      id: crypto.randomUUID(),
      userId: TEST_USER_ID,
      operations: [forwardOp],
      inverseOperations: inverseOps,
      description: "Delete C1",
      timestamp: Date.now(),
      seq: 0,
    };

    // Apply forward op — C1 removed, parent has [C0, C2].
    applyOperationToStore(forwardOp, store.setState, store.reader);
    expect(store.getNodes()["C1"]).toBeUndefined();
    expect(store.getNodes()["P"]["childrenUuids"]).toEqual(["C0", "C2"]);

    // Push and undo.
    historyManager.pushTransaction(tx);
    const inverseTx = historyManager.undo();
    expect(inverseTx).not.toBeNull();
    if (inverseTx === null) return;

    for (const op of inverseTx.operations) {
      applyOperationToStore(op, store.setState, store.reader);
    }

    // C1 restored, AND parent.childrenUuids back to original [C0, C1, C2].
    expect(store.getNodes()["C1"]).toBeDefined();
    expect(store.getNodes()["P"]["childrenUuids"]).toEqual(["C0", "C1", "C2"]);
  });

  it("redo replays the delete_nodes forward op", () => {
    const historyManager = new HistoryManager(TEST_USER_ID);
    const store = createTestStore();

    const nodeA = makeTestNode({ uuid: "a", name: "Node A" });
    const nodeB = makeTestNode({ uuid: "b", name: "Node B" });
    store.getNodes()["a"] = deepClone(nodeA);
    store.getNodes()["b"] = deepClone(nodeB);

    const forwardOp: Operation = {
      id: crypto.randomUUID(),
      userId: TEST_USER_ID,
      nodeUuid: "",
      type: "delete_nodes",
      path: "",
      value: { node_uuids: ["a", "b"] },
      previousValue: null,
      seq: 0,
    };
    const inverseOps: Operation[] = [
      {
        id: crypto.randomUUID(),
        userId: TEST_USER_ID,
        nodeUuid: "a",
        type: "create_node",
        path: "",
        value: deepClone(nodeA),
        previousValue: null,
        seq: 0,
      },
      {
        id: crypto.randomUUID(),
        userId: TEST_USER_ID,
        nodeUuid: "b",
        type: "create_node",
        path: "",
        value: deepClone(nodeB),
        previousValue: null,
        seq: 0,
      },
    ];
    const tx: Transaction = {
      id: crypto.randomUUID(),
      userId: TEST_USER_ID,
      operations: [forwardOp],
      inverseOperations: inverseOps,
      description: "Delete 2 nodes",
      timestamp: Date.now(),
      seq: 0,
    };

    // Forward → both gone.
    applyOperationToStore(forwardOp, store.setState, store.reader);
    historyManager.pushTransaction(tx);

    // Undo → both restored.
    const inverseTx = historyManager.undo();
    expect(inverseTx).not.toBeNull();
    if (inverseTx === null) return;
    for (const op of inverseTx.operations) {
      applyOperationToStore(op, store.setState, store.reader);
    }
    expect(store.getNodes()["a"]).toBeDefined();
    expect(store.getNodes()["b"]).toBeDefined();

    // Redo → both deleted again.
    const redoTx = historyManager.redo();
    expect(redoTx).not.toBeNull();
    if (redoTx === null) return;
    expect(redoTx.operations).toHaveLength(1);
    expect(redoTx.operations[0].type).toBe("delete_nodes");
    for (const op of redoTx.operations) {
      applyOperationToStore(op, store.setState, store.reader);
    }
    expect(store.getNodes()["a"]).toBeUndefined();
    expect(store.getNodes()["b"]).toBeUndefined();
  });
});
