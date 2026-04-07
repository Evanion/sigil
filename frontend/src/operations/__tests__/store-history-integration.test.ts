/**
 * Integration tests for store-history bridge.
 *
 * Tests that operations flow correctly through:
 * HistoryManager → applyOperationToStore → setState
 *
 * Uses mocked setState and real HistoryManager.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HistoryManager } from "../history-manager";
import { createStoreHistoryBridge, type StoreHistoryBridge } from "../store-history";
import { createSetFieldOp } from "../operation-helpers";

const USER_ID = "test-user";

describe("StoreHistoryBridge", () => {
  let historyManager: HistoryManager;
  let setState: ReturnType<typeof vi.fn>;
  let reader: { getNode: ReturnType<typeof vi.fn> };
  let bridge: StoreHistoryBridge;

  beforeEach(() => {
    historyManager = new HistoryManager(USER_ID);
    setState = vi.fn();
    reader = {
      getNode: vi.fn().mockReturnValue({
        uuid: "node-1",
        transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
        name: "Rect",
        visible: true,
        locked: false,
        style: {
          fills: [],
          strokes: [],
          opacity: { type: "literal", value: 1 },
          blend_mode: "normal",
          effects: [],
        },
        kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
      }),
    };
    bridge = createStoreHistoryBridge(historyManager, setState, reader);
  });

  it("applyAndTrack applies operation to store and tracks in history", () => {
    const op = createSetFieldOp(USER_ID, "node-1", "name", "New Name", "Old Name");
    bridge.applyAndTrack(op, "Rename to New Name");

    expect(setState).toHaveBeenCalledWith("nodes", "node-1", "name", "New Name");
    expect(historyManager.canUndo()).toBe(true);
  });

  it("undo applies inverse operation to store", () => {
    const op = createSetFieldOp(USER_ID, "node-1", "name", "New Name", "Old Name");
    bridge.applyAndTrack(op, "Rename");

    setState.mockClear();
    const inverseTx = bridge.undo();

    expect(inverseTx).not.toBeNull();
    // Inverse should set name back to "Old Name"
    expect(setState).toHaveBeenCalledWith("nodes", "node-1", "name", "Old Name");
    expect(historyManager.canUndo()).toBe(false);
    expect(historyManager.canRedo()).toBe(true);
  });

  it("redo re-applies the operation to store", () => {
    const op = createSetFieldOp(USER_ID, "node-1", "name", "New Name", "Old Name");
    bridge.applyAndTrack(op, "Rename");
    bridge.undo();

    setState.mockClear();
    const redoTx = bridge.redo();

    expect(redoTx).not.toBeNull();
    expect(setState).toHaveBeenCalledWith("nodes", "node-1", "name", "New Name");
  });

  it("undo returns null when history is empty", () => {
    const inverseTx = bridge.undo();
    expect(inverseTx).toBeNull();
    expect(setState).not.toHaveBeenCalled();
  });

  it("redo returns null when redo stack is empty", () => {
    const redoTx = bridge.redo();
    expect(redoTx).toBeNull();
    expect(setState).not.toHaveBeenCalled();
  });

  it("beginTransaction + applyInTransaction + commitTransaction creates single undo step", () => {
    const op1 = createSetFieldOp(USER_ID, "node-1", "transform", { x: 10 }, { x: 0 });
    const op2 = createSetFieldOp(USER_ID, "node-2", "transform", { x: 20 }, { x: 0 });

    bridge.beginTransaction("Align 2 nodes");
    bridge.applyInTransaction(op1);
    bridge.applyInTransaction(op2);
    bridge.commitTransaction();

    expect(setState).toHaveBeenCalledTimes(2);
    expect(historyManager.canUndo()).toBe(true);

    // Single undo reverts both
    setState.mockClear();
    const inverseTx = bridge.undo();
    expect(inverseTx).not.toBeNull();
    if (inverseTx === null) return;
    expect(inverseTx.operations).toHaveLength(2);
  });

  it("canUndo returns false before any operation", () => {
    expect(bridge.canUndo()).toBe(false);
  });

  it("canUndo returns true after applyAndTrack", () => {
    const op = createSetFieldOp(USER_ID, "node-1", "name", "New Name", "Old Name");
    bridge.applyAndTrack(op, "Rename");
    expect(bridge.canUndo()).toBe(true);
  });

  it("canRedo returns false before undo", () => {
    const op = createSetFieldOp(USER_ID, "node-1", "name", "New Name", "Old Name");
    bridge.applyAndTrack(op, "Rename");
    expect(bridge.canRedo()).toBe(false);
  });

  it("canRedo returns true after undo", () => {
    const op = createSetFieldOp(USER_ID, "node-1", "name", "New Name", "Old Name");
    bridge.applyAndTrack(op, "Rename");
    bridge.undo();
    expect(bridge.canRedo()).toBe(true);
  });

  it("cancelTransaction discards pending operations without undo step", () => {
    const op = createSetFieldOp(USER_ID, "node-1", "transform", { x: 10 }, { x: 0 });

    bridge.beginTransaction("Should be cancelled");
    bridge.applyInTransaction(op);
    bridge.cancelTransaction();

    // setState was called (store already updated), but no undo step
    expect(setState).toHaveBeenCalledTimes(1);
    expect(historyManager.canUndo()).toBe(false);
  });

  it("beginDrag + updateDrag + commitDrag coalesces into single undo step", () => {
    bridge.beginDrag("node-1", "transform");

    const op1 = createSetFieldOp(USER_ID, "node-1", "transform", { x: 5 }, { x: 0 });
    bridge.updateDrag(op1);

    const op2 = createSetFieldOp(USER_ID, "node-1", "transform", { x: 10 }, { x: 0 });
    bridge.updateDrag(op2);

    const op3 = createSetFieldOp(USER_ID, "node-1", "transform", { x: 15 }, { x: 0 });
    bridge.updateDrag(op3);

    bridge.commitDrag();

    // setState called once per updateDrag for instant feedback
    expect(setState).toHaveBeenCalledTimes(3);

    // But only ONE undo step
    expect(historyManager.canUndo()).toBe(true);
    setState.mockClear();
    const inverseTx = bridge.undo();
    expect(inverseTx).not.toBeNull();
    if (inverseTx === null) return;
    // Coalesced: one operation with first previousValue and last value
    expect(inverseTx.operations).toHaveLength(1);
  });

  it("cancelDrag discards the drag without creating an undo step", () => {
    bridge.beginDrag("node-1", "transform");
    const op = createSetFieldOp(USER_ID, "node-1", "transform", { x: 5 }, { x: 0 });
    bridge.updateDrag(op);
    bridge.cancelDrag();

    expect(historyManager.canUndo()).toBe(false);
  });

  it("commitDrag with no updates creates no undo step", () => {
    bridge.beginDrag("node-1", "transform");
    bridge.commitDrag();

    expect(historyManager.canUndo()).toBe(false);
    expect(setState).not.toHaveBeenCalled();
  });

  it("undo applies operations in reverse order for multi-op transaction", () => {
    const calls: string[] = [];
    setState.mockImplementation((...args: unknown[]) => {
      // Track which field was set
      if (typeof args[2] === "string") {
        calls.push(args[2] as string);
      }
    });

    // op1 changes "name", op2 changes "visible"
    const op1 = createSetFieldOp(USER_ID, "node-1", "name", "New", "Old");
    const op2 = createSetFieldOp(USER_ID, "node-1", "visible", false, true);

    bridge.beginTransaction("Multi-field update");
    bridge.applyInTransaction(op1);
    bridge.applyInTransaction(op2);
    bridge.commitTransaction();

    calls.length = 0; // reset tracking after forward apply
    bridge.undo();

    // Inverse should be: [inverse(op2), inverse(op1)] — reversed order
    expect(calls[0]).toBe("visible"); // inverse of op2 first
    expect(calls[1]).toBe("name"); // inverse of op1 second
  });

  // ── rollbackLast (RF-001) ─────────────────────────────────────

  describe("rollbackLast", () => {
    it("should revert the last operation in the store without pushing to redo", () => {
      const op = createSetFieldOp(USER_ID, "node-1", "name", "New Name", "Old Name");
      bridge.applyAndTrack(op, "Rename");

      setState.mockClear();
      bridge.rollbackLast();

      // Should have applied the inverse (set name back to "Old Name")
      expect(setState).toHaveBeenCalledWith("nodes", "node-1", "name", "Old Name");
      // Undo stack should be empty
      expect(bridge.canUndo()).toBe(false);
      // Redo stack should be empty — this is the key difference from undo()
      expect(bridge.canRedo()).toBe(false);
    });

    it("should be a no-op when undo stack is empty", () => {
      bridge.rollbackLast();
      expect(setState).not.toHaveBeenCalled();
      expect(bridge.canUndo()).toBe(false);
      expect(bridge.canRedo()).toBe(false);
    });

    it("should not pollute redo stack even after multiple rollbacks", () => {
      const op1 = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      const op2 = createSetFieldOp(USER_ID, "node-1", "name", "C", "B");
      bridge.applyAndTrack(op1, "Step 1");
      bridge.applyAndTrack(op2, "Step 2");

      bridge.rollbackLast(); // Reverts "C" -> "B"
      bridge.rollbackLast(); // Reverts "B" -> "A"

      expect(bridge.canUndo()).toBe(false);
      expect(bridge.canRedo()).toBe(false);
    });

    it("should not affect existing redo stack entries from prior undo()", () => {
      const op1 = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      bridge.applyAndTrack(op1, "Step 1");
      bridge.undo(); // Pushes to redo
      expect(bridge.canRedo()).toBe(true);

      // Apply a new operation then rollback
      const op2 = createSetFieldOp(USER_ID, "node-1", "name", "C", "A");
      bridge.applyAndTrack(op2, "Step 2"); // Clears redo (normal behavior)

      bridge.rollbackLast();
      // Redo was already cleared by applyAndTrack, so still empty
      expect(bridge.canRedo()).toBe(false);
    });
  });
});
