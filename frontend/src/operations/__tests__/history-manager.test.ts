import { describe, it, expect, beforeEach } from "vitest";
import { HistoryManager } from "../history-manager";
import { createSetFieldOp, createCreateNodeOp } from "../operation-helpers";
import { MAX_HISTORY_SIZE, MAX_OPERATIONS_PER_TRANSACTION } from "../types";
import type { Transaction } from "../types";

const USER_ID = "test-user";

/**
 * Assert that a value is not null and return it with a narrowed type.
 * Used to avoid non-null assertions (`!`) which are forbidden by lint rules.
 */
function assertNonNull(value: Transaction | null): Transaction {
  expect(value).not.toBeNull();
  // After the assertion above, we know value is not null.
  // Use a type guard to narrow.
  if (value === null) {
    throw new Error("Unexpected null");
  }
  return value;
}

describe("HistoryManager", () => {
  let hm: HistoryManager;

  beforeEach(() => {
    hm = new HistoryManager(USER_ID);
  });

  // ── apply ────────────────────────────────────────────────────────

  describe("apply", () => {
    it("should push a single operation as a transaction onto the undo stack", () => {
      const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      hm.apply(op, "Rename node");
      expect(hm.canUndo()).toBe(true);
      expect(hm.canRedo()).toBe(false);
    });

    it("should clear the redo stack when a new operation is applied", () => {
      const op1 = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      hm.apply(op1, "Step 1");
      hm.undo();
      expect(hm.canRedo()).toBe(true);

      const op2 = createSetFieldOp(USER_ID, "node-1", "name", "C", "A");
      hm.apply(op2, "Step 2");
      expect(hm.canRedo()).toBe(false);
    });
  });

  // ── undo / redo ──────────────────────────────────────────────────

  describe("undo", () => {
    it("should return null when nothing to undo", () => {
      expect(hm.undo()).toBeNull();
    });

    it("should return the inverse transaction", () => {
      const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      hm.apply(op, "Rename");
      const inv = assertNonNull(hm.undo());

      expect(inv.operations).toHaveLength(1);
      expect(inv.operations[0].value).toBe("A");
      expect(inv.operations[0].previousValue).toBe("B");
    });

    it("should move transaction from undo to redo stack", () => {
      const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      hm.apply(op, "Rename");
      hm.undo();
      expect(hm.canUndo()).toBe(false);
      expect(hm.canRedo()).toBe(true);
    });
  });

  describe("redo", () => {
    it("should return null when nothing to redo", () => {
      expect(hm.redo()).toBeNull();
    });

    it("should return the original transaction (inverse of inverse)", () => {
      const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      hm.apply(op, "Rename");
      hm.undo();

      const redo = assertNonNull(hm.redo());
      expect(redo.operations).toHaveLength(1);
      expect(redo.operations[0].value).toBe("B");
      expect(redo.operations[0].previousValue).toBe("A");
    });

    it("should move transaction back to undo stack", () => {
      const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      hm.apply(op, "Rename");
      hm.undo();
      hm.redo();
      expect(hm.canUndo()).toBe(true);
      expect(hm.canRedo()).toBe(false);
    });
  });

  describe("multiple undo/redo", () => {
    it("should support multiple sequential undo/redo cycles", () => {
      hm.apply(createSetFieldOp(USER_ID, "n1", "name", "B", "A"), "Step 1");
      hm.apply(createSetFieldOp(USER_ID, "n2", "name", "D", "C"), "Step 2");
      hm.apply(createSetFieldOp(USER_ID, "n3", "name", "F", "E"), "Step 3");

      // Undo all three
      const inv3 = assertNonNull(hm.undo());
      expect(inv3.operations[0].nodeUuid).toBe("n3");
      const inv2 = assertNonNull(hm.undo());
      expect(inv2.operations[0].nodeUuid).toBe("n2");
      const inv1 = assertNonNull(hm.undo());
      expect(inv1.operations[0].nodeUuid).toBe("n1");
      expect(hm.undo()).toBeNull();

      // Redo all three
      const redo1 = assertNonNull(hm.redo());
      expect(redo1.operations[0].nodeUuid).toBe("n1");
      const redo2 = assertNonNull(hm.redo());
      expect(redo2.operations[0].nodeUuid).toBe("n2");
      const redo3 = assertNonNull(hm.redo());
      expect(redo3.operations[0].nodeUuid).toBe("n3");
      expect(hm.redo()).toBeNull();
    });
  });

  // ── canUndo / canRedo ────────────────────────────────────────────

  describe("canUndo / canRedo", () => {
    it("should report canUndo as false when empty", () => {
      expect(hm.canUndo()).toBe(false);
    });

    it("should report canRedo as false when empty", () => {
      expect(hm.canRedo()).toBe(false);
    });
  });

  // ── MAX_HISTORY_SIZE eviction ────────────────────────────────────

  describe("max history size", () => {
    // RF-008: Named test for constant enforcement
    it("test_max_history_size_enforced", () => {
      for (let i = 0; i < MAX_HISTORY_SIZE + 10; i++) {
        hm.apply(createSetFieldOp(USER_ID, `node-${i}`, "name", `v${i + 1}`, `v${i}`), `Step ${i}`);
      }

      // Should only be able to undo MAX_HISTORY_SIZE times
      let undoCount = 0;
      while (hm.undo() !== null) {
        undoCount++;
      }
      expect(undoCount).toBe(MAX_HISTORY_SIZE);
    });

    it("should evict oldest transactions when redo stack exceeds MAX_HISTORY_SIZE", () => {
      // Fill the undo stack
      for (let i = 0; i < MAX_HISTORY_SIZE + 10; i++) {
        hm.apply(createSetFieldOp(USER_ID, `node-${i}`, "name", `v${i + 1}`, `v${i}`), `Step ${i}`);
      }
      // Undo all to fill redo stack
      while (hm.undo() !== null) {
        // drain
      }
      let redoCount = 0;
      while (hm.redo() !== null) {
        redoCount++;
      }
      expect(redoCount).toBeLessThanOrEqual(MAX_HISTORY_SIZE);
    });
  });

  // ── Explicit transactions ────────────────────────────────────────

  describe("explicit transactions", () => {
    it("should group multiple operations into a single undo step", () => {
      hm.beginTransaction("Align 3 nodes");
      hm.addOperation(createSetFieldOp(USER_ID, "n1", "transform", { x: 10 }, { x: 0 }));
      hm.addOperation(createSetFieldOp(USER_ID, "n2", "transform", { x: 10 }, { x: 5 }));
      hm.addOperation(createSetFieldOp(USER_ID, "n3", "transform", { x: 10 }, { x: 3 }));
      hm.commitTransaction();

      expect(hm.canUndo()).toBe(true);

      const inv = assertNonNull(hm.undo());
      // All three operations reversed in one step
      expect(inv.operations).toHaveLength(3);
      // Reversed order
      expect(inv.operations[0].nodeUuid).toBe("n3");
      expect(inv.operations[1].nodeUuid).toBe("n2");
      expect(inv.operations[2].nodeUuid).toBe("n1");

      expect(hm.canUndo()).toBe(false);
    });

    it("should discard pending operations when cancelTransaction is called", () => {
      hm.beginTransaction("Will cancel");
      hm.addOperation(createSetFieldOp(USER_ID, "n1", "name", "B", "A"));
      hm.cancelTransaction();

      expect(hm.canUndo()).toBe(false);
    });

    it("should clear redo stack on commit", () => {
      hm.apply(createSetFieldOp(USER_ID, "n1", "name", "B", "A"), "Step 1");
      hm.undo();
      expect(hm.canRedo()).toBe(true);

      hm.beginTransaction("New work");
      hm.addOperation(createSetFieldOp(USER_ID, "n2", "name", "D", "C"));
      hm.commitTransaction();
      expect(hm.canRedo()).toBe(false);
    });

    // RF-004: Empty transaction commit still clears redo
    it("should clear redo stack even when committing an empty transaction", () => {
      hm.apply(createSetFieldOp(USER_ID, "n1", "name", "B", "A"), "Step 1");
      hm.undo();
      expect(hm.canRedo()).toBe(true);

      hm.beginTransaction("Empty");
      hm.commitTransaction();
      expect(hm.canRedo()).toBe(false);
    });

    it("should throw when calling addOperation without beginTransaction", () => {
      const op = createSetFieldOp(USER_ID, "n1", "name", "B", "A");
      expect(() => hm.addOperation(op)).toThrow();
    });

    it("should throw when calling commitTransaction without beginTransaction", () => {
      expect(() => hm.commitTransaction()).toThrow();
    });

    it("should throw when calling beginTransaction while one is active", () => {
      hm.beginTransaction("First");
      expect(() => hm.beginTransaction("Second")).toThrow();
    });

    // RF-006: MAX_OPERATIONS_PER_TRANSACTION enforcement
    it("test_max_operations_per_transaction_enforced", () => {
      hm.beginTransaction("Big transaction");
      for (let i = 0; i < MAX_OPERATIONS_PER_TRANSACTION; i++) {
        hm.addOperation(createSetFieldOp(USER_ID, `node-${i}`, "name", `v${i + 1}`, `v${i}`));
      }
      // The next one should throw
      expect(() =>
        hm.addOperation(createSetFieldOp(USER_ID, "node-overflow", "name", "x", "y")),
      ).toThrow("MAX_OPERATIONS_PER_TRANSACTION");
    });
  });

  // ── cancelTransaction guard ─────────────────────────────────────

  describe("cancelTransaction guard", () => {
    // RF-012: cancelTransaction throws when no active transaction
    it("should throw when calling cancelTransaction without beginTransaction", () => {
      expect(() => hm.cancelTransaction()).toThrow("no active transaction");
    });
  });

  // ── Drag coalescing ──────────────────────────────────────────────

  describe("drag coalescing", () => {
    it("should merge updates on the same node+path into a single transaction", () => {
      hm.beginDrag("node-1", "transform");

      // Simulate 3 pointermove events
      hm.updateDrag(createSetFieldOp(USER_ID, "node-1", "transform", { x: 1 }, { x: 0 }));
      hm.updateDrag(createSetFieldOp(USER_ID, "node-1", "transform", { x: 5 }, { x: 1 }));
      hm.updateDrag(createSetFieldOp(USER_ID, "node-1", "transform", { x: 10 }, { x: 5 }));

      hm.commitDrag();

      expect(hm.canUndo()).toBe(true);
      const inv = assertNonNull(hm.undo());
      // Should be ONE operation: previousValue from first, value from last
      expect(inv.operations).toHaveLength(1);
      // Inverse: value = original previousValue (x:0), previousValue = final value (x:10)
      expect(inv.operations[0].value).toEqual({ x: 0 });
      expect(inv.operations[0].previousValue).toEqual({ x: 10 });
    });

    it("should discard all drag operations when cancelDrag is called", () => {
      hm.beginDrag("node-1", "transform");
      hm.updateDrag(createSetFieldOp(USER_ID, "node-1", "transform", { x: 5 }, { x: 0 }));
      hm.cancelDrag();

      expect(hm.canUndo()).toBe(false);
    });

    it("should throw when calling updateDrag without beginDrag", () => {
      const op = createSetFieldOp(USER_ID, "node-1", "transform", { x: 5 }, { x: 0 });
      expect(() => hm.updateDrag(op)).toThrow();
    });

    it("should throw when calling commitDrag without beginDrag", () => {
      expect(() => hm.commitDrag()).toThrow();
    });

    it("should throw when calling beginDrag while a drag is active", () => {
      hm.beginDrag("node-1", "transform");
      expect(() => hm.beginDrag("node-2", "name")).toThrow();
    });

    it("should throw when calling beginDrag while a transaction is active", () => {
      hm.beginTransaction("Work");
      expect(() => hm.beginDrag("node-1", "transform")).toThrow();
    });

    it("should throw when calling beginTransaction while a drag is active", () => {
      hm.beginDrag("node-1", "transform");
      expect(() => hm.beginTransaction("Work")).toThrow();
    });

    it("should not push anything if commitDrag is called with zero updates", () => {
      hm.beginDrag("node-1", "transform");
      hm.commitDrag();
      expect(hm.canUndo()).toBe(false);
    });

    // RF-012: cancelDrag guard
    it("should throw when calling cancelDrag without beginDrag", () => {
      expect(() => hm.cancelDrag()).toThrow("no active drag");
    });

    // updateDrag node/path mismatch guard
    it("should throw when updateDrag operation has mismatched node/path", () => {
      hm.beginDrag("node-1", "transform");
      const op = createSetFieldOp(USER_ID, "node-2", "transform", { x: 5 }, { x: 0 });
      expect(() => hm.updateDrag(op)).toThrow("does not match drag");
    });

    it("should throw when updateDrag operation has mismatched path", () => {
      hm.beginDrag("node-1", "transform");
      const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      expect(() => hm.updateDrag(op)).toThrow("does not match drag");
    });
  });

  // ── clear ────────────────────────────────────────────────────────

  describe("clear", () => {
    it("should empty both undo and redo stacks", () => {
      hm.apply(createSetFieldOp(USER_ID, "n1", "name", "B", "A"), "Step 1");
      hm.undo();
      expect(hm.canRedo()).toBe(true);
      hm.apply(createSetFieldOp(USER_ID, "n2", "name", "D", "C"), "Step 2");
      expect(hm.canUndo()).toBe(true);

      hm.clear();
      expect(hm.canUndo()).toBe(false);
      expect(hm.canRedo()).toBe(false);
    });
  });

  // ── restoreStacks enforces MAX_HISTORY_SIZE ──────────────────────

  describe("restoreStacks", () => {
    it("should truncate restored stacks to MAX_HISTORY_SIZE", () => {
      const bigUndo: Transaction[] = [];
      const bigRedo: Transaction[] = [];
      for (let i = 0; i < MAX_HISTORY_SIZE + 50; i++) {
        bigUndo.push({
          id: `u-${i}`,
          userId: USER_ID,
          operations: [],
          description: `undo-${i}`,
          timestamp: i,
          seq: 0,
        });
        bigRedo.push({
          id: `r-${i}`,
          userId: USER_ID,
          operations: [],
          description: `redo-${i}`,
          timestamp: i,
          seq: 0,
        });
      }
      hm.restoreStacks(bigUndo, bigRedo);

      // Should only be able to undo MAX_HISTORY_SIZE times
      let undoCount = 0;
      while (hm.undo() !== null) {
        undoCount++;
      }
      expect(undoCount).toBe(MAX_HISTORY_SIZE);
    });
  });

  // ── create/delete inverse flipping through undo ──────────────────

  describe("create/delete undo round-trip", () => {
    it("should produce a delete_node inverse when undoing a create_node", () => {
      const nodeData = { uuid: "new-1", kind: { type: "rectangle" } };
      const op = createCreateNodeOp(USER_ID, nodeData);
      hm.apply(op, "Create rectangle");
      const inv = assertNonNull(hm.undo());
      expect(inv.operations[0].type).toBe("delete_node");
      expect(inv.operations[0].previousValue).toEqual(nodeData);
      // RF-002: nodeUuid should be extracted from create_node value
      expect(inv.operations[0].nodeUuid).toBe("new-1");
    });

    it("should produce create_node again when redoing after undo of create_node", () => {
      const nodeData = { uuid: "new-1", kind: { type: "rectangle" } };
      hm.apply(createCreateNodeOp(USER_ID, nodeData), "Create rectangle");
      hm.undo();
      const redo = assertNonNull(hm.redo());
      expect(redo.operations[0].type).toBe("create_node");
      expect(redo.operations[0].value).toEqual(nodeData);
    });
  });
});
