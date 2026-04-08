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
import { createSetFieldOp, createDeleteNodeOp } from "../../operations/operation-helpers";
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
    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
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

  it("should restore the node on undo after deleteNode", () => {
    const nodeSnapshot = deepClone(store.getNodes()["node-1"]);
    const op = createDeleteNodeOp(TEST_USER_ID, "node-1", nodeSnapshot);
    applyAndTrack(op, "Delete Rectangle 1", historyManager, store.setState, store.reader);

    // Node should be deleted
    expect(store.getNodes()["node-1"]).toBeUndefined();

    // Undo restores the node
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
