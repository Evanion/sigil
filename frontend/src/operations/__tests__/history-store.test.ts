import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { HistoryStore } from "../history-store";
import type { LoadedStacks } from "../history-store";
import type { Transaction } from "../types";

function makeTx(id: string, userId: string, timestamp: number): Transaction {
  return {
    id,
    userId,
    operations: [],
    description: `tx-${id}`,
    timestamp,
    seq: 0,
  };
}

/**
 * Assert that a LoadedStacks value is not null and return it narrowed.
 */
function assertLoaded(value: LoadedStacks | null): LoadedStacks {
  expect(value).not.toBeNull();
  if (value === null) {
    throw new Error("Unexpected null");
  }
  return value;
}

describe("HistoryStore", () => {
  let store: HistoryStore;

  beforeEach(async () => {
    store = new HistoryStore();
    await store.open();
  });

  afterEach(async () => {
    store.close();
    // Clean up the database between tests
    indexedDB.deleteDatabase("sigil-history");
  });

  describe("saveStack / loadStack", () => {
    it("should save and load undo and redo stacks", async () => {
      const undoStack = [
        makeTx("u1", "user-1", 1000),
        makeTx("u2", "user-1", 2000),
      ];
      const redoStack = [makeTx("r1", "user-1", 3000)];

      await store.saveStack("doc-1", "user-1", undoStack, redoStack);
      const result = assertLoaded(await store.loadStack("doc-1", "user-1"));

      expect(result.undoStack).toHaveLength(2);
      expect(result.redoStack).toHaveLength(1);
      expect(result.undoStack[0].id).toBe("u1");
      expect(result.undoStack[1].id).toBe("u2");
      expect(result.redoStack[0].id).toBe("r1");
    });

    it("should overwrite previous data on save", async () => {
      await store.saveStack(
        "doc-1",
        "user-1",
        [makeTx("u1", "user-1", 1000)],
        [],
      );
      await store.saveStack(
        "doc-1",
        "user-1",
        [makeTx("u2", "user-1", 2000)],
        [],
      );

      const result = assertLoaded(await store.loadStack("doc-1", "user-1"));
      expect(result.undoStack).toHaveLength(1);
      expect(result.undoStack[0].id).toBe("u2");
    });

    it("should return null for non-existent document/user pair", async () => {
      const result = await store.loadStack("nonexistent", "nobody");
      expect(result).toBeNull();
    });

    it("should isolate data by documentId", async () => {
      await store.saveStack(
        "doc-1",
        "user-1",
        [makeTx("u1", "user-1", 1000)],
        [],
      );
      await store.saveStack(
        "doc-2",
        "user-1",
        [makeTx("u2", "user-1", 2000)],
        [],
      );

      const r1 = assertLoaded(await store.loadStack("doc-1", "user-1"));
      const r2 = assertLoaded(await store.loadStack("doc-2", "user-1"));
      expect(r1.undoStack[0].id).toBe("u1");
      expect(r2.undoStack[0].id).toBe("u2");
    });

    it("should isolate data by userId", async () => {
      await store.saveStack(
        "doc-1",
        "user-1",
        [makeTx("u1", "user-1", 1000)],
        [],
      );
      await store.saveStack(
        "doc-1",
        "user-2",
        [makeTx("u2", "user-2", 2000)],
        [],
      );

      const r1 = assertLoaded(await store.loadStack("doc-1", "user-1"));
      const r2 = assertLoaded(await store.loadStack("doc-1", "user-2"));
      expect(r1.undoStack[0].id).toBe("u1");
      expect(r2.undoStack[0].id).toBe("u2");
    });
  });

  describe("clearStack", () => {
    it("should remove all data for a document/user pair", async () => {
      await store.saveStack(
        "doc-1",
        "user-1",
        [makeTx("u1", "user-1", 1000)],
        [],
      );
      await store.clearStack("doc-1", "user-1");

      const result = await store.loadStack("doc-1", "user-1");
      expect(result).toBeNull();
    });

    it("should not affect other document/user pairs", async () => {
      await store.saveStack(
        "doc-1",
        "user-1",
        [makeTx("u1", "user-1", 1000)],
        [],
      );
      await store.saveStack(
        "doc-1",
        "user-2",
        [makeTx("u2", "user-2", 2000)],
        [],
      );

      await store.clearStack("doc-1", "user-1");

      const r1 = await store.loadStack("doc-1", "user-1");
      const r2 = await store.loadStack("doc-1", "user-2");
      expect(r1).toBeNull();
      expect(r2).not.toBeNull();
    });

    it("should not throw when clearing non-existent data", async () => {
      await expect(
        store.clearStack("nonexistent", "nobody"),
      ).resolves.not.toThrow();
    });
  });

  describe("handles empty stacks", () => {
    it("should save and load empty stacks", async () => {
      await store.saveStack("doc-1", "user-1", [], []);
      const result = assertLoaded(await store.loadStack("doc-1", "user-1"));
      expect(result.undoStack).toHaveLength(0);
      expect(result.redoStack).toHaveLength(0);
    });
  });

  describe("requireDb guard", () => {
    it("should throw when calling saveStack before open", async () => {
      const unopened = new HistoryStore();
      await expect(
        unopened.saveStack("doc-1", "user-1", [], []),
      ).rejects.toThrow("HistoryStore is not open");
    });

    it("should throw when calling loadStack before open", async () => {
      const unopened = new HistoryStore();
      await expect(unopened.loadStack("doc-1", "user-1")).rejects.toThrow(
        "HistoryStore is not open",
      );
    });
  });
});
