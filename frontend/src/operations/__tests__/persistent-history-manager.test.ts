import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { PersistentHistoryManager } from "../persistent-history-manager";
import { createSetFieldOp } from "../operation-helpers";
import type { Transaction } from "../types";

const USER_ID = "test-user";
const DOC_ID = "doc-1";

/**
 * Assert that a Transaction value is not null and return it narrowed.
 */
function assertNonNull(value: Transaction | null): Transaction {
  expect(value).not.toBeNull();
  if (value === null) {
    throw new Error("Unexpected null");
  }
  return value;
}

describe("PersistentHistoryManager", () => {
  let phm: PersistentHistoryManager;

  beforeEach(async () => {
    phm = new PersistentHistoryManager(USER_ID);
    await phm.init();
  });

  afterEach(async () => {
    phm.dispose();
    indexedDB.deleteDatabase("sigil-history");
  });

  describe("persist and restore", () => {
    it("should persist undo stack to IndexedDB and restore in a new instance", async () => {
      const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      phm.apply(op, "Rename");

      await phm.persist(DOC_ID);

      // Create a new instance and restore
      const phm2 = new PersistentHistoryManager(USER_ID);
      await phm2.init();
      await phm2.restore(DOC_ID);

      expect(phm2.canUndo()).toBe(true);
      const inv = assertNonNull(phm2.undo());
      expect(inv.operations[0].value).toBe("A");

      phm2.dispose();
    });

    it("should persist redo stack to IndexedDB after undo", async () => {
      const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      phm.apply(op, "Rename");
      phm.undo();

      await phm.persist(DOC_ID);

      const phm2 = new PersistentHistoryManager(USER_ID);
      await phm2.init();
      await phm2.restore(DOC_ID);

      expect(phm2.canRedo()).toBe(true);

      phm2.dispose();
    });

    it("should restore empty stacks for unknown document", async () => {
      await phm.restore("nonexistent-doc");
      expect(phm.canUndo()).toBe(false);
      expect(phm.canRedo()).toBe(false);
    });

    it("should clear persisted data from IndexedDB", async () => {
      phm.apply(createSetFieldOp(USER_ID, "node-1", "name", "B", "A"), "Rename");
      await phm.persist(DOC_ID);
      await phm.clearPersisted(DOC_ID);

      const phm2 = new PersistentHistoryManager(USER_ID);
      await phm2.init();
      await phm2.restore(DOC_ID);
      expect(phm2.canUndo()).toBe(false);

      phm2.dispose();
    });
  });

  describe("persistAsync debounce", () => {
    it("should debounce multiple persistAsync calls", async () => {
      vi.useFakeTimers();
      try {
        phm.apply(createSetFieldOp(USER_ID, "node-1", "name", "B", "A"), "Step 1");
        phm.persistAsync(DOC_ID);
        phm.persistAsync(DOC_ID);
        phm.persistAsync(DOC_ID);

        // Before the debounce fires, nothing should be persisted yet
        // Advance past the debounce delay (500ms) and flush promises
        await vi.advanceTimersByTimeAsync(600);

        vi.useRealTimers();

        // Now check the data was persisted
        const phm2 = new PersistentHistoryManager(USER_ID);
        await phm2.init();
        await phm2.restore(DOC_ID);
        expect(phm2.canUndo()).toBe(true);
        phm2.dispose();
      } finally {
        vi.useRealTimers();
      }
    });

    it("should not throw from persistAsync on error", async () => {
      // Close the underlying store to simulate an error
      phm.dispose();

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Re-init a new phm that we'll break
      phm = new PersistentHistoryManager(USER_ID);
      // Don't call init() — store is not open

      // This should not throw
      phm.persistAsync(DOC_ID);

      // Give the debounce + microtask time to settle
      await new Promise((resolve) => setTimeout(resolve, 600));

      consoleSpy.mockRestore();
    });
  });

  describe("delegated HistoryManager methods", () => {
    it("should delegate canUndo and canRedo correctly", () => {
      expect(phm.canUndo()).toBe(false);
      expect(phm.canRedo()).toBe(false);

      phm.apply(createSetFieldOp(USER_ID, "node-1", "name", "B", "A"), "Rename");

      expect(phm.canUndo()).toBe(true);
      expect(phm.canRedo()).toBe(false);

      phm.undo();
      expect(phm.canUndo()).toBe(false);
      expect(phm.canRedo()).toBe(true);
    });

    it("should delegate clear correctly", () => {
      phm.apply(createSetFieldOp(USER_ID, "node-1", "name", "B", "A"), "Rename");
      expect(phm.canUndo()).toBe(true);

      phm.clear();
      expect(phm.canUndo()).toBe(false);
      expect(phm.canRedo()).toBe(false);
    });

    it("should delegate transaction methods correctly", () => {
      phm.beginTransaction("Multi-op");
      phm.addOperation(createSetFieldOp(USER_ID, "node-1", "name", "B", "A"));
      phm.addOperation(createSetFieldOp(USER_ID, "node-2", "name", "D", "C"));
      phm.commitTransaction();

      expect(phm.canUndo()).toBe(true);
      const inv = assertNonNull(phm.undo());
      // Inverse transaction should have 2 operations in reverse order
      expect(inv.operations).toHaveLength(2);
    });

    it("should delegate cancelTransaction correctly", () => {
      phm.beginTransaction("Cancelled");
      phm.addOperation(createSetFieldOp(USER_ID, "node-1", "name", "B", "A"));
      phm.cancelTransaction();

      expect(phm.canUndo()).toBe(false);
    });

    it("should delegate drag methods correctly", () => {
      phm.beginDrag("node-1", "transform.x");
      phm.updateDrag(createSetFieldOp(USER_ID, "node-1", "transform.x", 10, 0));
      phm.updateDrag(createSetFieldOp(USER_ID, "node-1", "transform.x", 20, 10));
      phm.commitDrag();

      expect(phm.canUndo()).toBe(true);
    });

    it("should delegate cancelDrag correctly", () => {
      phm.beginDrag("node-1", "transform.x");
      phm.updateDrag(createSetFieldOp(USER_ID, "node-1", "transform.x", 10, 0));
      phm.cancelDrag();

      expect(phm.canUndo()).toBe(false);
    });
  });
});
