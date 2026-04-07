/**
 * Integration tests for the full undo/redo flow:
 * mutation -> undo -> redo, verifying store state at each step.
 *
 * Uses a StoreHistoryBridge with a real HistoryManager and a simulated
 * store state (plain object + setState mock) to test the operation tracking,
 * undo, and redo without a full urql client.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { HistoryManager } from "../../operations/history-manager";
import { createStoreHistoryBridge, type StoreHistoryBridge } from "../../operations/store-history";
import { createSetFieldOp, createDeleteNodeOp } from "../../operations/operation-helpers";
import type { StoreStateReader } from "../../operations/apply-to-store";

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

describe("undo/redo integration", () => {
  let historyManager: HistoryManager;
  let history: StoreHistoryBridge;
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    historyManager = new HistoryManager(TEST_USER_ID);
    store = createTestStore();
    history = createStoreHistoryBridge(historyManager, store.setState, store.reader);

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
    history.applyAndTrack(op, "Move Rectangle 1");

    // Verify new value applied
    expect(store.getNodes()["node-1"]["transform"]).toEqual(newTransform);

    // Undo
    const inverseTx = history.undo();
    expect(inverseTx).not.toBeNull();

    // Verify original value restored
    expect(store.getNodes()["node-1"]["transform"]).toEqual(originalTransform);

    // Redo
    const redoTx = history.redo();
    expect(redoTx).not.toBeNull();

    // Verify new value re-applied
    expect(store.getNodes()["node-1"]["transform"]).toEqual(newTransform);
  });

  it("should restore previous name on undo after renameNode", () => {
    const op = createSetFieldOp(TEST_USER_ID, "node-1", "name", "New Name", "Rectangle 1");
    history.applyAndTrack(op, "Rename Rectangle 1 to New Name");

    expect(store.getNodes()["node-1"]["name"]).toBe("New Name");

    history.undo();
    expect(store.getNodes()["node-1"]["name"]).toBe("Rectangle 1");

    history.redo();
    expect(store.getNodes()["node-1"]["name"]).toBe("New Name");
  });

  it("should restore the node on undo after deleteNode", () => {
    const nodeSnapshot = deepClone(store.getNodes()["node-1"]);
    const op = createDeleteNodeOp(TEST_USER_ID, "node-1", nodeSnapshot);
    history.applyAndTrack(op, "Delete Rectangle 1");

    // Node should be deleted
    expect(store.getNodes()["node-1"]).toBeUndefined();

    // Undo restores the node
    history.undo();
    expect(store.getNodes()["node-1"]).toBeDefined();
    expect(store.getNodes()["node-1"]["name"]).toBe("Rectangle 1");

    // Redo deletes again
    history.redo();
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

    // Use transaction for batch
    history.beginTransaction("Align 2 nodes");
    const op1 = createSetFieldOp(TEST_USER_ID, "node-1", "transform", new1, prev1);
    history.applyInTransaction(op1);
    const op2 = createSetFieldOp(TEST_USER_ID, "node-2", "transform", new2, prev2);
    history.applyInTransaction(op2);
    history.commitTransaction();

    expect(store.getNodes()["node-1"]["transform"]).toEqual(new1);
    expect(store.getNodes()["node-2"]["transform"]).toEqual(new2);

    // Single undo reverts both
    history.undo();
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
    history.applyAndTrack(op1, "Move Rectangle 1");

    // Mutation 2: rename
    const op2 = createSetFieldOp(TEST_USER_ID, "node-1", "name", "Renamed", "Rectangle 1");
    history.applyAndTrack(op2, "Rename");

    // Mutation 3: toggle visible
    const op3 = createSetFieldOp(TEST_USER_ID, "node-1", "visible", false, true);
    history.applyAndTrack(op3, "Hide");

    // Undo 3: visible reverts
    history.undo();
    expect(store.getNodes()["node-1"]["visible"]).toBe(true);
    expect(store.getNodes()["node-1"]["name"]).toBe("Renamed");

    // Undo 2: name reverts
    history.undo();
    expect(store.getNodes()["node-1"]["name"]).toBe("Rectangle 1");
    expect(store.getNodes()["node-1"]["transform"]).toEqual(newTransform);

    // Undo 1: transform reverts
    history.undo();
    expect(store.getNodes()["node-1"]["transform"]).toEqual(originalTransform);
  });

  it("should clear redo stack when a new mutation is made after undo", () => {
    const original = deepClone(store.getNodes()["node-1"]["transform"]);
    const newVal = { x: 50, y: 50, width: 200, height: 200, rotation: 0, scale_x: 1, scale_y: 1 };

    // Mutate
    const op1 = createSetFieldOp(TEST_USER_ID, "node-1", "transform", newVal, original);
    history.applyAndTrack(op1, "Move");

    // Undo
    history.undo();
    expect(history.canRedo()).toBe(true);

    // New mutation clears redo
    const op2 = createSetFieldOp(TEST_USER_ID, "node-1", "name", "New Name", "Rectangle 1");
    history.applyAndTrack(op2, "Rename");

    expect(history.canRedo()).toBe(false);
    // Redo should return null
    const redoTx = history.redo();
    expect(redoTx).toBeNull();
  });

  it("should return the inverse transaction from undo for server send", () => {
    const original = deepClone(store.getNodes()["node-1"]["transform"]);
    const newVal = { x: 50, y: 50, width: 200, height: 200, rotation: 0, scale_x: 1, scale_y: 1 };

    const op = createSetFieldOp(TEST_USER_ID, "node-1", "transform", newVal, original);
    history.applyAndTrack(op, "Move");

    const inverseTx = history.undo();
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
    history.applyAndTrack(op, "Move");

    history.undo();
    const redoTx = history.redo();
    expect(redoTx).not.toBeNull();
    if (redoTx === null) return; // type narrowing for strict TS
    expect(redoTx.operations).toHaveLength(1);

    const redoOp = redoTx.operations[0];
    expect(redoOp.type).toBe("set_field");
    expect(redoOp.path).toBe("transform");
    expect(redoOp.value).toEqual(newVal);
  });

  it("should report canUndo/canRedo correctly", () => {
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);

    const op = createSetFieldOp(TEST_USER_ID, "node-1", "name", "New", "Rectangle 1");
    history.applyAndTrack(op, "Rename");

    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);

    history.undo();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);

    history.redo();
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });
});
