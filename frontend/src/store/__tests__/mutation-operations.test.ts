/**
 * Tests that mutation operations create Operations with correct fields,
 * track them in HistoryManager, and can be undone/redone.
 *
 * These tests exercise the Operation + HistoryManager integration
 * without needing a full urql client. The HistoryManager tracks operations
 * and applyOperationToStore applies them to a simulated store.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HistoryManager } from "../../operations/history-manager";
import {
  createSetFieldOp,
  createCreateNodeOp,
  createDeleteNodeOp,
  createReparentOp,
  createReorderOp,
} from "../../operations/operation-helpers";
import {
  applyOperationToStore,
  type StoreStateReader,
  type StoreStateSetter,
} from "../../operations/apply-to-store";
import type { Transaction } from "../../operations/types";

// ── Test helpers ────────────────────────────────────────────────────────

/** Deep clone using JSON round-trip (same as store's deepClone). */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Minimal node shape for tests. */
function makeTestNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uuid: "node-1",
    name: "Rectangle 1",
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal", value: 1 },
      blend_mode: "normal",
      effects: [],
    },
    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
    parentUuid: null,
    childrenUuids: [],
    ...overrides,
  };
}

const TEST_USER_ID = "test-user-session";

/** Helper: apply op to store and track in HistoryManager as a single transaction. */
function applyAndTrack(
  op: import("../../operations/types").Operation,
  description: string,
  historyManager: HistoryManager,
  setState: StoreStateSetter,
  reader: StoreStateReader,
): void {
  applyOperationToStore(op, setState, reader);
  historyManager.apply(op, description);
}

/** Helper: undo via HistoryManager, apply inverse to store. */
function undoAndApply(
  historyManager: HistoryManager,
  setState: StoreStateSetter,
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
  setState: StoreStateSetter,
  reader: StoreStateReader,
): Transaction | null {
  const redoTx = historyManager.redo();
  if (!redoTx) return null;
  for (const op of redoTx.operations) {
    applyOperationToStore(op, setState, reader);
  }
  return redoTx;
}

describe("mutation operations — simple field mutations (Task 3)", () => {
  let historyManager: HistoryManager;
  let setState: ReturnType<typeof vi.fn>;
  let reader: StoreStateReader;
  let testNode: Record<string, unknown>;

  beforeEach(() => {
    historyManager = new HistoryManager(TEST_USER_ID);
    setState = vi.fn();
    testNode = makeTestNode();
    reader = {
      getNode: (uuid: string) => (uuid === "node-1" ? testNode : undefined),
    };
  });

  describe("setTransform — operation tracking", () => {
    it("should create a set_field operation with path 'transform'", () => {
      const newTransform = {
        x: 50,
        y: 50,
        width: 200,
        height: 200,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
      };
      const previousTransform = deepClone(testNode["transform"]);

      const op = createSetFieldOp(
        TEST_USER_ID,
        "node-1",
        "transform",
        newTransform,
        previousTransform,
      );

      expect(op.type).toBe("set_field");
      expect(op.path).toBe("transform");
      expect(op.nodeUuid).toBe("node-1");
      expect(op.value).toEqual(newTransform);
      expect(op.previousValue).toEqual(previousTransform);
      expect(op.userId).toBe(TEST_USER_ID);
    });

    it("should track in HistoryManager after apply", () => {
      const newTransform = {
        x: 50,
        y: 50,
        width: 200,
        height: 200,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
      };
      const previous = deepClone(testNode["transform"]);

      const op = createSetFieldOp(TEST_USER_ID, "node-1", "transform", newTransform, previous);
      applyAndTrack(
        op,
        "Move Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.canRedo()).toBe(false);
    });

    it("should apply to store via setState when tracked", () => {
      const newTransform = {
        x: 50,
        y: 50,
        width: 200,
        height: 200,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
      };
      const previous = deepClone(testNode["transform"]);

      const op = createSetFieldOp(TEST_USER_ID, "node-1", "transform", newTransform, previous);
      applyAndTrack(
        op,
        "Move Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(setState).toHaveBeenCalledWith("nodes", "node-1", "transform", newTransform);
    });

    it("should restore previous value on undo", () => {
      const newTransform = {
        x: 50,
        y: 50,
        width: 200,
        height: 200,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
      };
      const previous = deepClone(testNode["transform"]);

      const op = createSetFieldOp(TEST_USER_ID, "node-1", "transform", newTransform, previous);
      applyAndTrack(
        op,
        "Move Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      setState.mockClear();
      const inverseTx = undoAndApply(
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(inverseTx).not.toBeNull();
      // Undo should set the previous transform value
      expect(setState).toHaveBeenCalledWith("nodes", "node-1", "transform", previous);
      expect(historyManager.canUndo()).toBe(false);
      expect(historyManager.canRedo()).toBe(true);
    });
  });

  describe("renameNode — operation tracking", () => {
    it("should create a set_field operation with path 'name'", () => {
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "name", "New Name", "Rectangle 1");

      expect(op.type).toBe("set_field");
      expect(op.path).toBe("name");
      expect(op.value).toBe("New Name");
      expect(op.previousValue).toBe("Rectangle 1");
    });

    it("should track in HistoryManager and restore on undo", () => {
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "name", "New Name", "Rectangle 1");
      applyAndTrack(
        op,
        "Rename Rectangle 1 to New Name",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);
      expect(setState).toHaveBeenCalledWith("nodes", "node-1", "name", "New Name");

      setState.mockClear();
      undoAndApply(historyManager, setState as unknown as StoreStateSetter, reader);

      expect(setState).toHaveBeenCalledWith("nodes", "node-1", "name", "Rectangle 1");
    });
  });

  describe("setVisible — operation tracking", () => {
    it("should create a set_field operation with path 'visible'", () => {
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "visible", false, true);

      expect(op.type).toBe("set_field");
      expect(op.path).toBe("visible");
      expect(op.value).toBe(false);
      expect(op.previousValue).toBe(true);
    });

    it("should track in HistoryManager and restore on undo", () => {
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "visible", false, true);
      applyAndTrack(
        op,
        "Hide Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      setState.mockClear();
      undoAndApply(historyManager, setState as unknown as StoreStateSetter, reader);

      expect(setState).toHaveBeenCalledWith("nodes", "node-1", "visible", true);
    });
  });

  describe("setLocked — operation tracking", () => {
    it("should create a set_field operation with path 'locked'", () => {
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "locked", true, false);

      expect(op.type).toBe("set_field");
      expect(op.path).toBe("locked");
      expect(op.value).toBe(true);
      expect(op.previousValue).toBe(false);
    });

    it("should track in HistoryManager and restore on undo", () => {
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "locked", true, false);
      applyAndTrack(
        op,
        "Lock Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      setState.mockClear();
      undoAndApply(historyManager, setState as unknown as StoreStateSetter, reader);

      expect(setState).toHaveBeenCalledWith("nodes", "node-1", "locked", false);
    });
  });

  describe("setOpacity — operation tracking", () => {
    it("should create a set_field operation with path 'style.opacity'", () => {
      const previousOpacity = { type: "literal", value: 1 };
      const newOpacity = { type: "literal", value: 0.5 };
      const op = createSetFieldOp(
        TEST_USER_ID,
        "node-1",
        "style.opacity",
        newOpacity,
        previousOpacity,
      );

      expect(op.type).toBe("set_field");
      expect(op.path).toBe("style.opacity");
      expect(op.value).toEqual(newOpacity);
      expect(op.previousValue).toEqual(previousOpacity);
    });

    it("should track in HistoryManager and can undo", () => {
      const previousOpacity = { type: "literal", value: 1 };
      const newOpacity = { type: "literal", value: 0.5 };
      const op = createSetFieldOp(
        TEST_USER_ID,
        "node-1",
        "style.opacity",
        newOpacity,
        previousOpacity,
      );
      applyAndTrack(
        op,
        "Set opacity on Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      setState.mockClear();
      undoAndApply(historyManager, setState as unknown as StoreStateSetter, reader);

      // Undo applies the inverse — setter is called with a produce function for style fields
      expect(setState).toHaveBeenCalled();
    });
  });

  describe("setBlendMode — operation tracking", () => {
    it("should create a set_field operation with path 'style.blend_mode'", () => {
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "style.blend_mode", "multiply", "normal");

      expect(op.type).toBe("set_field");
      expect(op.path).toBe("style.blend_mode");
      expect(op.value).toBe("multiply");
      expect(op.previousValue).toBe("normal");
    });

    it("should track in HistoryManager and can undo", () => {
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "style.blend_mode", "multiply", "normal");
      applyAndTrack(
        op,
        "Set blend mode on Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      setState.mockClear();
      undoAndApply(historyManager, setState as unknown as StoreStateSetter, reader);

      expect(setState).toHaveBeenCalled();
    });
  });

  describe("setCornerRadii — operation tracking", () => {
    it("should create a set_field operation with path 'kind'", () => {
      const previousKind = { type: "rectangle", corner_radii: [0, 0, 0, 0] };
      const newKind = { type: "rectangle", corner_radii: [8, 8, 8, 8] };
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "kind", newKind, previousKind);

      expect(op.type).toBe("set_field");
      expect(op.path).toBe("kind");
      expect(op.value).toEqual(newKind);
      expect(op.previousValue).toEqual(previousKind);
    });

    it("should track in HistoryManager and can undo", () => {
      const previousKind = { type: "rectangle", corner_radii: [0, 0, 0, 0] };
      const newKind = { type: "rectangle", corner_radii: [8, 8, 8, 8] };
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "kind", newKind, previousKind);
      applyAndTrack(
        op,
        "Set corner radii on Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      setState.mockClear();
      undoAndApply(historyManager, setState as unknown as StoreStateSetter, reader);

      // Undo applies the inverse — setter is called with a produce function for kind
      expect(setState).toHaveBeenCalled();
    });
  });
});

describe("mutation operations — debounced style mutations (Task 4)", () => {
  let historyManager: HistoryManager;
  let setState: ReturnType<typeof vi.fn>;
  let reader: StoreStateReader;
  let testNode: Record<string, unknown>;

  beforeEach(() => {
    historyManager = new HistoryManager(TEST_USER_ID);
    setState = vi.fn();
    testNode = makeTestNode();
    reader = {
      getNode: (uuid: string) => (uuid === "node-1" ? testNode : undefined),
    };
  });

  describe("setFills — operation tracking", () => {
    it("should create a set_field operation with path 'style.fills'", () => {
      const previousFills: unknown[] = [];
      const newFills = [
        {
          type: "solid",
          color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } },
        },
      ];
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "style.fills", newFills, previousFills);

      expect(op.type).toBe("set_field");
      expect(op.path).toBe("style.fills");
      expect(op.value).toEqual(newFills);
      expect(op.previousValue).toEqual(previousFills);
    });

    it("should track in HistoryManager and can undo", () => {
      const newFills = [
        {
          type: "solid",
          color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } },
        },
      ];
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "style.fills", newFills, []);
      applyAndTrack(
        op,
        "Update fills on Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      setState.mockClear();
      const inverseTx = undoAndApply(
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(inverseTx).not.toBeNull();
      expect(setState).toHaveBeenCalled();
      expect(historyManager.canUndo()).toBe(false);
      expect(historyManager.canRedo()).toBe(true);
    });
  });

  describe("setStrokes — operation tracking", () => {
    it("should create a set_field operation with path 'style.strokes'", () => {
      const newStrokes = [
        {
          type: "solid",
          color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
          width: 1,
        },
      ];
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "style.strokes", newStrokes, []);

      expect(op.type).toBe("set_field");
      expect(op.path).toBe("style.strokes");
      expect(op.value).toEqual(newStrokes);
      expect(op.previousValue).toEqual([]);
    });

    it("should track in HistoryManager and can undo", () => {
      const newStrokes = [{ type: "solid", width: 2 }];
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "style.strokes", newStrokes, []);
      applyAndTrack(
        op,
        "Update strokes on Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      setState.mockClear();
      undoAndApply(historyManager, setState as unknown as StoreStateSetter, reader);

      expect(setState).toHaveBeenCalled();
      expect(historyManager.canRedo()).toBe(true);
    });
  });

  describe("setEffects — operation tracking", () => {
    it("should create a set_field operation with path 'style.effects'", () => {
      const newEffects = [{ type: "drop_shadow", x: 0, y: 4, blur: 8, spread: 0 }];
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "style.effects", newEffects, []);

      expect(op.type).toBe("set_field");
      expect(op.path).toBe("style.effects");
      expect(op.value).toEqual(newEffects);
      expect(op.previousValue).toEqual([]);
    });

    it("should track in HistoryManager and can undo", () => {
      const newEffects = [{ type: "drop_shadow", x: 0, y: 4, blur: 8, spread: 0 }];
      const op = createSetFieldOp(TEST_USER_ID, "node-1", "style.effects", newEffects, []);
      applyAndTrack(
        op,
        "Update effects on Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      setState.mockClear();
      undoAndApply(historyManager, setState as unknown as StoreStateSetter, reader);

      expect(setState).toHaveBeenCalled();
      expect(historyManager.canRedo()).toBe(true);
    });
  });

  describe("undo/redo cycle — full round-trip (Task 4)", () => {
    it("should support undo then redo for a set_field operation", () => {
      const newTransform = {
        x: 50,
        y: 50,
        width: 200,
        height: 200,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
      };
      const previous = deepClone(testNode["transform"]);

      const op = createSetFieldOp(TEST_USER_ID, "node-1", "transform", newTransform, previous);
      applyAndTrack(
        op,
        "Move Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      // State after apply
      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.canRedo()).toBe(false);

      // Undo
      setState.mockClear();
      const inverseTx = undoAndApply(
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );
      expect(inverseTx).not.toBeNull();
      if (inverseTx === null) throw new Error("unreachable");
      expect(inverseTx.operations).toHaveLength(1);
      expect(inverseTx.operations[0].value).toEqual(previous);
      expect(inverseTx.operations[0].previousValue).toEqual(newTransform);
      expect(historyManager.canUndo()).toBe(false);
      expect(historyManager.canRedo()).toBe(true);

      // Redo
      setState.mockClear();
      const redoTx = redoAndApply(historyManager, setState as unknown as StoreStateSetter, reader);
      expect(redoTx).not.toBeNull();
      if (redoTx === null) throw new Error("unreachable");
      expect(redoTx.operations).toHaveLength(1);
      expect(redoTx.operations[0].value).toEqual(newTransform);
      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.canRedo()).toBe(false);
    });

    it("should support multiple operations with sequential undo", () => {
      // Apply two operations
      const op1 = createSetFieldOp(TEST_USER_ID, "node-1", "name", "Name 1", "Rectangle 1");
      applyAndTrack(
        op1,
        "Rename to Name 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      const op2 = createSetFieldOp(TEST_USER_ID, "node-1", "visible", false, true);
      applyAndTrack(
        op2,
        "Hide Rectangle",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      // Undo second operation
      setState.mockClear();
      undoAndApply(historyManager, setState as unknown as StoreStateSetter, reader);
      expect(setState).toHaveBeenCalledWith("nodes", "node-1", "visible", true);

      // Undo first operation
      setState.mockClear();
      undoAndApply(historyManager, setState as unknown as StoreStateSetter, reader);
      expect(setState).toHaveBeenCalledWith("nodes", "node-1", "name", "Rectangle 1");

      expect(historyManager.canUndo()).toBe(false);
      expect(historyManager.canRedo()).toBe(true);
    });
  });
});

describe("mutation operations — structural mutations (Task 5)", () => {
  let historyManager: HistoryManager;
  let setState: ReturnType<typeof vi.fn>;
  let reader: StoreStateReader;
  let nodes: Record<string, Record<string, unknown>>;

  beforeEach(() => {
    historyManager = new HistoryManager(TEST_USER_ID);
    setState = vi.fn();
    nodes = {
      "node-1": makeTestNode(),
      "parent-a": makeTestNode({
        uuid: "parent-a",
        name: "Frame A",
        kind: { type: "frame" },
        childrenUuids: ["node-1"],
      }),
      "parent-b": makeTestNode({
        uuid: "parent-b",
        name: "Frame B",
        kind: { type: "frame" },
        childrenUuids: ["child-x", "child-y"],
      }),
    };
    // Wire node-1's parentUuid to parent-a
    nodes["node-1"]["parentUuid"] = "parent-a";
    reader = {
      getNode: (uuid: string) => nodes[uuid] as Record<string, unknown> | undefined,
    };
  });

  describe("createNode — operation tracking", () => {
    it("should create a create_node operation with full node data as value", () => {
      const nodeData = {
        uuid: "new-uuid",
        name: "Rect 1",
        kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
        transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
        style: {
          fills: [],
          strokes: [],
          opacity: { type: "literal", value: 1 },
          blend_mode: "normal",
          effects: [],
        },
        visible: true,
        locked: false,
        parentUuid: null,
        childrenUuids: [],
      };
      const op = createCreateNodeOp(TEST_USER_ID, nodeData);

      expect(op.type).toBe("create_node");
      expect(op.nodeUuid).toBe("");
      expect(op.value).toEqual(nodeData);
      expect(op.previousValue).toBeNull();
    });

    it("should track in HistoryManager — undo removes the node", () => {
      const nodeData = {
        uuid: "new-uuid",
        name: "Rect 1",
        kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
        transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
        style: {
          fills: [],
          strokes: [],
          opacity: { type: "literal", value: 1 },
          blend_mode: "normal",
          effects: [],
        },
        visible: true,
        locked: false,
        parentUuid: null,
        childrenUuids: [],
      };
      const op = createCreateNodeOp(TEST_USER_ID, nodeData);
      applyAndTrack(
        op,
        "Create Rect 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      setState.mockClear();
      const inverseTx = undoAndApply(
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(inverseTx).not.toBeNull();
      if (inverseTx === null) throw new Error("unreachable");
      // Inverse of create_node is delete_node
      expect(inverseTx.operations).toHaveLength(1);
      expect(inverseTx.operations[0].type).toBe("delete_node");
      expect(inverseTx.operations[0].nodeUuid).toBe("new-uuid");
      expect(historyManager.canUndo()).toBe(false);
      expect(historyManager.canRedo()).toBe(true);
    });
  });

  describe("deleteNode — operation tracking", () => {
    it("should create a delete_node operation with full node snapshot as previousValue", () => {
      const snapshot = deepClone(nodes["node-1"]);
      const op = createDeleteNodeOp(TEST_USER_ID, "node-1", snapshot);

      expect(op.type).toBe("delete_node");
      expect(op.nodeUuid).toBe("node-1");
      expect(op.previousValue).toEqual(snapshot);
      expect(op.value).toBeNull();
    });

    it("should track in HistoryManager — undo restores the node", () => {
      const snapshot = deepClone(nodes["node-1"]);
      const op = createDeleteNodeOp(TEST_USER_ID, "node-1", snapshot);
      applyAndTrack(
        op,
        "Delete Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      setState.mockClear();
      const inverseTx = undoAndApply(
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(inverseTx).not.toBeNull();
      if (inverseTx === null) throw new Error("unreachable");
      // Inverse of delete_node is create_node
      expect(inverseTx.operations).toHaveLength(1);
      expect(inverseTx.operations[0].type).toBe("create_node");
      expect(inverseTx.operations[0].value).toEqual(snapshot);
      expect(historyManager.canRedo()).toBe(true);
    });
  });

  describe("reparentNode — operation tracking", () => {
    it("should create a reparent operation with old and new parent info", () => {
      const op = createReparentOp(TEST_USER_ID, "node-1", "parent-b", 1, "parent-a", 0);

      expect(op.type).toBe("reparent");
      expect(op.nodeUuid).toBe("node-1");
      expect(op.value).toEqual({ parentUuid: "parent-b", position: 1 });
      expect(op.previousValue).toEqual({ parentUuid: "parent-a", position: 0 });
    });

    it("should track in HistoryManager — undo restores original parent", () => {
      const op = createReparentOp(TEST_USER_ID, "node-1", "parent-b", 1, "parent-a", 0);
      applyAndTrack(
        op,
        "Move Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      setState.mockClear();
      const inverseTx = undoAndApply(
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(inverseTx).not.toBeNull();
      if (inverseTx === null) throw new Error("unreachable");
      expect(inverseTx.operations).toHaveLength(1);
      // Inverse swaps value/previousValue
      expect(inverseTx.operations[0].value).toEqual({ parentUuid: "parent-a", position: 0 });
      expect(inverseTx.operations[0].previousValue).toEqual({
        parentUuid: "parent-b",
        position: 1,
      });
      expect(historyManager.canRedo()).toBe(true);
    });
  });

  describe("reorderChildren — operation tracking", () => {
    it("should create a reorder operation with old and new positions", () => {
      const op = createReorderOp(TEST_USER_ID, "node-1", 2, 0);

      expect(op.type).toBe("reorder");
      expect(op.nodeUuid).toBe("node-1");
      // RF-002: unified `position` field
      expect(op.value).toEqual({ position: 2 });
      expect(op.previousValue).toEqual({ position: 0 });
    });

    it("should track in HistoryManager — undo restores original position", () => {
      const op = createReorderOp(TEST_USER_ID, "node-1", 2, 0);
      applyAndTrack(
        op,
        "Reorder Rectangle 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      setState.mockClear();
      const inverseTx = undoAndApply(
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(inverseTx).not.toBeNull();
      if (inverseTx === null) throw new Error("unreachable");
      expect(inverseTx.operations).toHaveLength(1);
      // RF-002: Inverse swaps value/previousValue; unified `position` field
      expect(inverseTx.operations[0].value).toEqual({ position: 0 });
      expect(inverseTx.operations[0].previousValue).toEqual({ position: 2 });
      expect(historyManager.canRedo()).toBe(true);
    });
  });
});

describe("mutation operations — multi-node mutations (Task 6)", () => {
  let historyManager: HistoryManager;
  let setState: ReturnType<typeof vi.fn>;
  let reader: StoreStateReader;
  let nodes: Record<string, Record<string, unknown>>;

  beforeEach(() => {
    historyManager = new HistoryManager(TEST_USER_ID);
    setState = vi.fn();
    nodes = {
      "node-1": makeTestNode(),
      "node-2": makeTestNode({
        uuid: "node-2",
        name: "Rectangle 2",
        transform: { x: 100, y: 100, width: 50, height: 50, rotation: 0, scale_x: 1, scale_y: 1 },
      }),
      "node-3": makeTestNode({
        uuid: "node-3",
        name: "Rectangle 3",
        transform: { x: 200, y: 200, width: 75, height: 75, rotation: 0, scale_x: 1, scale_y: 1 },
      }),
    };
    reader = {
      getNode: (uuid: string) => nodes[uuid] as Record<string, unknown> | undefined,
    };
  });

  describe("batchSetTransform — transaction tracking", () => {
    it("should wrap N transforms in a single transaction via pushTransaction", () => {
      const newT1 = { x: 10, y: 10, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 };
      const newT2 = { x: 20, y: 20, width: 50, height: 50, rotation: 0, scale_x: 1, scale_y: 1 };

      const op1 = createSetFieldOp(
        TEST_USER_ID,
        "node-1",
        "transform",
        newT1,
        deepClone(nodes["node-1"]["transform"]),
      );
      const op2 = createSetFieldOp(
        TEST_USER_ID,
        "node-2",
        "transform",
        newT2,
        deepClone(nodes["node-2"]["transform"]),
      );

      // Apply to store
      applyOperationToStore(op1, setState as unknown as StoreStateSetter, reader);
      applyOperationToStore(op2, setState as unknown as StoreStateSetter, reader);

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

      // Both ops applied to store
      expect(setState).toHaveBeenCalledWith("nodes", "node-1", "transform", newT1);
      expect(setState).toHaveBeenCalledWith("nodes", "node-2", "transform", newT2);

      // Only one undo step
      expect(historyManager.canUndo()).toBe(true);
    });

    it("should revert all transforms with single undo", () => {
      const originalT1 = deepClone(nodes["node-1"]["transform"]);
      const originalT2 = deepClone(nodes["node-2"]["transform"]);
      const newT1 = { x: 10, y: 10, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 };
      const newT2 = { x: 20, y: 20, width: 50, height: 50, rotation: 0, scale_x: 1, scale_y: 1 };

      const op1 = createSetFieldOp(TEST_USER_ID, "node-1", "transform", newT1, originalT1);
      const op2 = createSetFieldOp(TEST_USER_ID, "node-2", "transform", newT2, originalT2);

      applyOperationToStore(op1, setState as unknown as StoreStateSetter, reader);
      applyOperationToStore(op2, setState as unknown as StoreStateSetter, reader);

      const tx: Transaction = {
        id: crypto.randomUUID(),
        userId: TEST_USER_ID,
        operations: [op1, op2],
        description: "Align 2 nodes",
        timestamp: Date.now(),
        seq: 0,
      };
      historyManager.pushTransaction(tx);

      setState.mockClear();
      const inverseTx = undoAndApply(
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(inverseTx).not.toBeNull();
      if (inverseTx === null) throw new Error("unreachable");
      // Inverse transaction should have 2 ops in reverse order
      expect(inverseTx.operations).toHaveLength(2);

      // After undo, previous values should be restored
      expect(setState).toHaveBeenCalledWith("nodes", "node-2", "transform", originalT2);
      expect(setState).toHaveBeenCalledWith("nodes", "node-1", "transform", originalT1);

      expect(historyManager.canUndo()).toBe(false);
      expect(historyManager.canRedo()).toBe(true);
    });
  });

  describe("groupNodes — operation tracking", () => {
    it("should create a create_node operation for tracking group creation", () => {
      const groupData = {
        uuid: "group-uuid",
        name: "Group 1",
        kind: { type: "frame" },
        transform: { x: 0, y: 0, width: 200, height: 200, rotation: 0, scale_x: 1, scale_y: 1 },
        style: {
          fills: [],
          strokes: [],
          opacity: { type: "literal", value: 1 },
          blend_mode: "normal",
          effects: [],
        },
        visible: true,
        locked: false,
        parentUuid: null,
        childrenUuids: ["node-1", "node-2"],
      };

      const op = createCreateNodeOp(TEST_USER_ID, groupData);
      applyAndTrack(
        op,
        "Group Group 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      setState.mockClear();
      const inverseTx = undoAndApply(
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(inverseTx).not.toBeNull();
      if (inverseTx === null) throw new Error("unreachable");
      expect(inverseTx.operations[0].type).toBe("delete_node");
    });
  });

  describe("ungroupNodes — operation tracking", () => {
    it("should create a delete_node operation for tracking ungroup", () => {
      const groupSnapshot = {
        uuid: "group-uuid",
        name: "Group 1",
        kind: { type: "frame" },
        childrenUuids: ["node-1", "node-2"],
      };

      const op = createDeleteNodeOp(TEST_USER_ID, "group-uuid", groupSnapshot);
      applyAndTrack(
        op,
        "Ungroup Group 1",
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(historyManager.canUndo()).toBe(true);

      setState.mockClear();
      const inverseTx = undoAndApply(
        historyManager,
        setState as unknown as StoreStateSetter,
        reader,
      );

      expect(inverseTx).not.toBeNull();
      if (inverseTx === null) throw new Error("unreachable");
      expect(inverseTx.operations[0].type).toBe("create_node");
      expect(inverseTx.operations[0].value).toEqual(groupSnapshot);
    });
  });
});
