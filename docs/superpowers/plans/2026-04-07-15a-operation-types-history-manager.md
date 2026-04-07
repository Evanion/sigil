# Plan 15a — Operation Types + HistoryManager + IndexedDB Persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the standalone frontend operation model, HistoryManager, and IndexedDB persistence layer. These modules have zero integration with the existing document store or server -- everything is independently testable via Vitest.

**Architecture:** Three layers of pure, isolated modules: (1) Operation/Transaction type definitions, (2) pure helper functions for creating and inverting operations, (3) a HistoryManager class managing linear undo/redo stacks backed by IndexedDB persistence. No Solid.js reactivity, no GraphQL, no store coupling. Each module depends only on the one below it.

**Tech Stack:** TypeScript (strict mode), Vitest, `fake-indexeddb` (test dependency), raw IndexedDB API (no `idb` library -- not in current deps)

**Spec Reference:** Spec 15, sections 3 (Operation Model), 4 (Client History Manager), Phase 15a (section 9)

---

## Task 1: Operation Types

**Files:**
- Create: `frontend/src/operations/types.ts`

- [ ] **Step 1: Create the operation type definitions**

Create `frontend/src/operations/types.ts`:

```typescript
/**
 * Operation and Transaction types for the client-side undo/redo system.
 *
 * These types represent field-level mutations that flow through the system:
 * client → server → broadcast to other clients.
 *
 * See: Spec 15, section 3.
 */

/** Discriminant for the kind of mutation an operation represents. */
export type OperationType =
  | "set_field"
  | "create_node"
  | "delete_node"
  | "reparent"
  | "reorder";

/**
 * A single field-level mutation.
 *
 * The inverse of any operation is constructed by swapping `value` and
 * `previousValue`. For `create_node`, the inverse type is `delete_node`
 * and vice versa.
 */
export interface Operation {
  /** Unique operation ID (UUID). */
  readonly id: string;
  /** Who issued it (session ID). */
  readonly userId: string;
  /** Target node UUID. Empty string for create_node (node doesn't exist yet). */
  readonly nodeUuid: string;
  /** Kind of mutation. */
  readonly type: OperationType;
  /**
   * Field path for set_field operations: "transform", "style.fills", "name", etc.
   * Empty string for structural operations (create/delete/reparent/reorder use
   * value/previousValue to carry structured payloads).
   */
  readonly path: string;
  /** New value (full node data for create_node). */
  readonly value: unknown;
  /** Old value (full node snapshot for delete_node). */
  readonly previousValue: unknown;
  /**
   * Server-assigned sequence number. 0 until confirmed by the server.
   * Mutable because it is assigned after creation.
   */
  seq: number;
}

/**
 * A group of operations that form a single undo step.
 *
 * Undoing a transaction applies the inverse of every operation in reverse order.
 */
export interface Transaction {
  /** Unique transaction ID (UUID). */
  readonly id: string;
  /** Who issued it (session ID). */
  readonly userId: string;
  /** Ordered list of field changes. */
  readonly operations: readonly Operation[];
  /** Human-readable description: "Move Rectangle 1", "Align 4 nodes". */
  readonly description: string;
  /** Wall clock timestamp (Date.now()). */
  readonly timestamp: number;
  /**
   * Server-assigned sequence number for the transaction. 0 until confirmed.
   * Mutable because it is assigned after creation.
   */
  seq: number;
}

/**
 * Reparent operation value payload.
 * Stored in Operation.value for type="reparent".
 */
export interface ReparentValue {
  readonly parentUuid: string;
  readonly position: number;
}

/**
 * Reorder operation value payload.
 * Stored in Operation.value for type="reorder".
 */
export interface ReorderValue {
  readonly newPosition: number;
}

/**
 * Reorder operation previousValue payload.
 * Stored in Operation.previousValue for type="reorder".
 */
export interface ReorderPreviousValue {
  readonly oldPosition: number;
}

/** Maximum number of transactions in the undo or redo stack. */
export const MAX_HISTORY_SIZE = 500;
```

- [ ] **Step 2: Verify compilation**

```bash
pnpm --prefix frontend exec tsc --noEmit 2>&1 | grep -i "operations" || echo "No errors in operations"
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/operations/types.ts
git commit -m "feat(frontend): add Operation and Transaction types (Plan 15a, Task 1)"
```

---

## Task 2: Operation Helpers

**Files:**
- Create: `frontend/src/operations/__tests__/operation-helpers.test.ts`
- Create: `frontend/src/operations/operation-helpers.ts`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/operations/__tests__/operation-helpers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  createSetFieldOp,
  createCreateNodeOp,
  createDeleteNodeOp,
  createReparentOp,
  createReorderOp,
  createInverse,
  createInverseTransaction,
} from "../operation-helpers";
import type { Operation, Transaction } from "../types";

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
    expect(op1.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
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
    expect(op.value).toEqual({ newPosition: 3 });
    expect(op.previousValue).toEqual({ oldPosition: 1 });
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

  it("flips create_node to delete_node", () => {
    const nodeData = { uuid: "new-node", kind: { type: "rectangle" } };
    const op = createCreateNodeOp(USER_ID, nodeData);
    const inv = createInverse(op);
    expect(inv.type).toBe("delete_node");
    expect(inv.value).toBeNull();
    expect(inv.previousValue).toEqual(nodeData);
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
    expect(inv.value).toEqual({ oldPosition: 1 });
    expect(inv.previousValue).toEqual({ newPosition: 3 });
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --prefix frontend test -- --reporter=verbose src/operations/__tests__/operation-helpers.test.ts
```

Expected: FAIL -- module not found.

- [ ] **Step 3: Implement operation helpers**

Create `frontend/src/operations/operation-helpers.ts`:

```typescript
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
  return {
    id: crypto.randomUUID(),
    userId: op.userId,
    nodeUuid: op.nodeUuid,
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --prefix frontend test -- --reporter=verbose src/operations/__tests__/operation-helpers.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/operations/operation-helpers.ts frontend/src/operations/__tests__/operation-helpers.test.ts
git commit -m "feat(frontend): add operation factory and inverse helpers (Plan 15a, Task 2)"
```

---

## Task 3: HistoryManager

**Files:**
- Create: `frontend/src/operations/__tests__/history-manager.test.ts`
- Create: `frontend/src/operations/history-manager.ts`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/operations/__tests__/history-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { HistoryManager } from "../history-manager";
import { createSetFieldOp, createCreateNodeOp, createDeleteNodeOp } from "../operation-helpers";
import { MAX_HISTORY_SIZE } from "../types";
import type { Transaction } from "../types";

const USER_ID = "test-user";

describe("HistoryManager", () => {
  let hm: HistoryManager;

  beforeEach(() => {
    hm = new HistoryManager(USER_ID);
  });

  // ── apply ────────────────────────────────────────────────────────

  describe("apply", () => {
    it("pushes a single operation as a transaction onto the undo stack", () => {
      const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      hm.apply(op, "Rename node");
      expect(hm.canUndo()).toBe(true);
      expect(hm.canRedo()).toBe(false);
    });

    it("clears the redo stack when a new operation is applied", () => {
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
    it("returns null when nothing to undo", () => {
      expect(hm.undo()).toBeNull();
    });

    it("returns the inverse transaction", () => {
      const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      hm.apply(op, "Rename");
      const inv = hm.undo();

      expect(inv).not.toBeNull();
      expect(inv!.operations).toHaveLength(1);
      expect(inv!.operations[0].value).toBe("A");
      expect(inv!.operations[0].previousValue).toBe("B");
    });

    it("moves transaction from undo to redo stack", () => {
      const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      hm.apply(op, "Rename");
      hm.undo();
      expect(hm.canUndo()).toBe(false);
      expect(hm.canRedo()).toBe(true);
    });
  });

  describe("redo", () => {
    it("returns null when nothing to redo", () => {
      expect(hm.redo()).toBeNull();
    });

    it("returns the original transaction (inverse of inverse)", () => {
      const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      hm.apply(op, "Rename");
      hm.undo();

      const redo = hm.redo();
      expect(redo).not.toBeNull();
      expect(redo!.operations).toHaveLength(1);
      expect(redo!.operations[0].value).toBe("B");
      expect(redo!.operations[0].previousValue).toBe("A");
    });

    it("moves transaction back to undo stack", () => {
      const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      hm.apply(op, "Rename");
      hm.undo();
      hm.redo();
      expect(hm.canUndo()).toBe(true);
      expect(hm.canRedo()).toBe(false);
    });
  });

  describe("multiple undo/redo", () => {
    it("supports multiple sequential undo/redo cycles", () => {
      hm.apply(createSetFieldOp(USER_ID, "n1", "name", "B", "A"), "Step 1");
      hm.apply(createSetFieldOp(USER_ID, "n2", "name", "D", "C"), "Step 2");
      hm.apply(createSetFieldOp(USER_ID, "n3", "name", "F", "E"), "Step 3");

      // Undo all three
      const inv3 = hm.undo();
      expect(inv3!.operations[0].nodeUuid).toBe("n3");
      const inv2 = hm.undo();
      expect(inv2!.operations[0].nodeUuid).toBe("n2");
      const inv1 = hm.undo();
      expect(inv1!.operations[0].nodeUuid).toBe("n1");
      expect(hm.undo()).toBeNull();

      // Redo all three
      const redo1 = hm.redo();
      expect(redo1!.operations[0].nodeUuid).toBe("n1");
      const redo2 = hm.redo();
      expect(redo2!.operations[0].nodeUuid).toBe("n2");
      const redo3 = hm.redo();
      expect(redo3!.operations[0].nodeUuid).toBe("n3");
      expect(hm.redo()).toBeNull();
    });
  });

  // ── canUndo / canRedo ────────────────────────────────────────────

  describe("canUndo / canRedo", () => {
    it("canUndo is false when empty", () => {
      expect(hm.canUndo()).toBe(false);
    });

    it("canRedo is false when empty", () => {
      expect(hm.canRedo()).toBe(false);
    });
  });

  // ── MAX_HISTORY_SIZE eviction ────────────────────────────────────

  describe("max history size", () => {
    it("evicts oldest transactions when undo stack exceeds MAX_HISTORY_SIZE", () => {
      for (let i = 0; i < MAX_HISTORY_SIZE + 10; i++) {
        hm.apply(
          createSetFieldOp(USER_ID, `node-${i}`, "name", `v${i + 1}`, `v${i}`),
          `Step ${i}`,
        );
      }

      // Should only be able to undo MAX_HISTORY_SIZE times
      let undoCount = 0;
      while (hm.undo() !== null) {
        undoCount++;
      }
      expect(undoCount).toBe(MAX_HISTORY_SIZE);
    });
  });

  // ── Explicit transactions ────────────────────────────────────────

  describe("explicit transactions", () => {
    it("groups multiple operations into a single undo step", () => {
      hm.beginTransaction("Align 3 nodes");
      hm.addOperation(createSetFieldOp(USER_ID, "n1", "transform", { x: 10 }, { x: 0 }));
      hm.addOperation(createSetFieldOp(USER_ID, "n2", "transform", { x: 10 }, { x: 5 }));
      hm.addOperation(createSetFieldOp(USER_ID, "n3", "transform", { x: 10 }, { x: 3 }));
      hm.commitTransaction();

      expect(hm.canUndo()).toBe(true);

      const inv = hm.undo();
      expect(inv).not.toBeNull();
      // All three operations reversed in one step
      expect(inv!.operations).toHaveLength(3);
      // Reversed order
      expect(inv!.operations[0].nodeUuid).toBe("n3");
      expect(inv!.operations[1].nodeUuid).toBe("n2");
      expect(inv!.operations[2].nodeUuid).toBe("n1");

      expect(hm.canUndo()).toBe(false);
    });

    it("cancelTransaction discards pending operations", () => {
      hm.beginTransaction("Will cancel");
      hm.addOperation(createSetFieldOp(USER_ID, "n1", "name", "B", "A"));
      hm.cancelTransaction();

      expect(hm.canUndo()).toBe(false);
    });

    it("clears redo stack on commit", () => {
      hm.apply(createSetFieldOp(USER_ID, "n1", "name", "B", "A"), "Step 1");
      hm.undo();
      expect(hm.canRedo()).toBe(true);

      hm.beginTransaction("New work");
      hm.addOperation(createSetFieldOp(USER_ID, "n2", "name", "D", "C"));
      hm.commitTransaction();
      expect(hm.canRedo()).toBe(false);
    });

    it("throws when calling addOperation without beginTransaction", () => {
      const op = createSetFieldOp(USER_ID, "n1", "name", "B", "A");
      expect(() => hm.addOperation(op)).toThrow();
    });

    it("throws when calling commitTransaction without beginTransaction", () => {
      expect(() => hm.commitTransaction()).toThrow();
    });

    it("throws when calling beginTransaction while one is active", () => {
      hm.beginTransaction("First");
      expect(() => hm.beginTransaction("Second")).toThrow();
    });
  });

  // ── Drag coalescing ──────────────────────────────────────────────

  describe("drag coalescing", () => {
    it("merges updates on the same node+path into a single transaction", () => {
      hm.beginDrag("node-1", "transform");

      // Simulate 3 pointermove events
      hm.updateDrag(createSetFieldOp(USER_ID, "node-1", "transform", { x: 1 }, { x: 0 }));
      hm.updateDrag(createSetFieldOp(USER_ID, "node-1", "transform", { x: 5 }, { x: 1 }));
      hm.updateDrag(createSetFieldOp(USER_ID, "node-1", "transform", { x: 10 }, { x: 5 }));

      hm.commitDrag();

      expect(hm.canUndo()).toBe(true);
      const inv = hm.undo();
      expect(inv).not.toBeNull();
      // Should be ONE operation: previousValue from first, value from last
      expect(inv!.operations).toHaveLength(1);
      // Inverse: value = original previousValue (x:0), previousValue = final value (x:10)
      expect(inv!.operations[0].value).toEqual({ x: 0 });
      expect(inv!.operations[0].previousValue).toEqual({ x: 10 });
    });

    it("cancelDrag discards all drag operations", () => {
      hm.beginDrag("node-1", "transform");
      hm.updateDrag(createSetFieldOp(USER_ID, "node-1", "transform", { x: 5 }, { x: 0 }));
      hm.cancelDrag();

      expect(hm.canUndo()).toBe(false);
    });

    it("throws when calling updateDrag without beginDrag", () => {
      const op = createSetFieldOp(USER_ID, "node-1", "transform", { x: 5 }, { x: 0 });
      expect(() => hm.updateDrag(op)).toThrow();
    });

    it("throws when calling commitDrag without beginDrag", () => {
      expect(() => hm.commitDrag()).toThrow();
    });

    it("throws when calling beginDrag while a drag is active", () => {
      hm.beginDrag("node-1", "transform");
      expect(() => hm.beginDrag("node-2", "name")).toThrow();
    });

    it("throws when calling beginDrag while a transaction is active", () => {
      hm.beginTransaction("Work");
      expect(() => hm.beginDrag("node-1", "transform")).toThrow();
    });

    it("throws when calling beginTransaction while a drag is active", () => {
      hm.beginDrag("node-1", "transform");
      expect(() => hm.beginTransaction("Work")).toThrow();
    });

    it("does not push anything if commitDrag with zero updates", () => {
      hm.beginDrag("node-1", "transform");
      hm.commitDrag();
      expect(hm.canUndo()).toBe(false);
    });
  });

  // ── clear ────────────────────────────────────────────────────────

  describe("clear", () => {
    it("empties both undo and redo stacks", () => {
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

  // ── create/delete inverse flipping through undo ──────────────────

  describe("create/delete undo round-trip", () => {
    it("undoing a create_node produces a delete_node inverse", () => {
      const nodeData = { uuid: "new-1", kind: { type: "rectangle" } };
      const op = createCreateNodeOp(USER_ID, nodeData);
      hm.apply(op, "Create rectangle");
      const inv = hm.undo();
      expect(inv).not.toBeNull();
      expect(inv!.operations[0].type).toBe("delete_node");
      expect(inv!.operations[0].previousValue).toEqual(nodeData);
    });

    it("redoing after undo of create_node produces create_node again", () => {
      const nodeData = { uuid: "new-1", kind: { type: "rectangle" } };
      hm.apply(createCreateNodeOp(USER_ID, nodeData), "Create rectangle");
      hm.undo();
      const redo = hm.redo();
      expect(redo).not.toBeNull();
      expect(redo!.operations[0].type).toBe("create_node");
      expect(redo!.operations[0].value).toEqual(nodeData);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --prefix frontend test -- --reporter=verbose src/operations/__tests__/history-manager.test.ts
```

Expected: FAIL -- module not found.

- [ ] **Step 3: Implement HistoryManager**

Create `frontend/src/operations/history-manager.ts`:

```typescript
/**
 * Client-side per-user undo/redo history manager.
 *
 * Manages linear undo/redo stacks of Transactions. Supports three modes
 * of operation entry:
 * - apply() — auto-wraps a single operation in a transaction
 * - beginTransaction/addOperation/commitTransaction — explicit grouping
 * - beginDrag/updateDrag/commitDrag — coalesces continuous pointer-move ops
 *
 * See: Spec 15, section 4.1.
 */

import type { Operation, Transaction } from "./types";
import { MAX_HISTORY_SIZE } from "./types";
import { createInverseTransaction } from "./operation-helpers";

/** State for an in-progress drag coalescing session. */
interface DragState {
  readonly nodeUuid: string;
  readonly path: string;
  firstPreviousValue: unknown;
  lastValue: unknown;
  lastOp: Operation | null;
  updateCount: number;
}

export class HistoryManager {
  private readonly userId: string;
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private pendingTxOps: Operation[] | null = null;
  private pendingTxDescription: string | null = null;
  private dragState: DragState | null = null;

  constructor(userId: string) {
    this.userId = userId;
  }

  // ── apply (single operation, auto-wrapped) ─────────────────────

  /**
   * Apply a single operation, auto-wrapped in a transaction.
   * Pushes to undo stack and clears redo stack.
   */
  apply(op: Operation, description: string): void {
    const tx: Transaction = {
      id: crypto.randomUUID(),
      userId: this.userId,
      operations: [op],
      description,
      timestamp: Date.now(),
      seq: 0,
    };
    this.pushUndo(tx);
    this.redoStack = [];
  }

  // ── Explicit transactions ──────────────────────────────────────

  /** Begin an explicit multi-operation transaction. */
  beginTransaction(description: string): void {
    if (this.pendingTxOps !== null) {
      throw new Error("Cannot begin transaction: a transaction is already active");
    }
    if (this.dragState !== null) {
      throw new Error("Cannot begin transaction: a drag is already active");
    }
    this.pendingTxOps = [];
    this.pendingTxDescription = description;
  }

  /** Add an operation to the current transaction. */
  addOperation(op: Operation): void {
    if (this.pendingTxOps === null) {
      throw new Error("Cannot add operation: no active transaction (call beginTransaction first)");
    }
    this.pendingTxOps.push(op);
  }

  /** Commit the current transaction to the undo stack. */
  commitTransaction(): void {
    if (this.pendingTxOps === null) {
      throw new Error("Cannot commit: no active transaction");
    }
    if (this.pendingTxOps.length > 0) {
      const tx: Transaction = {
        id: crypto.randomUUID(),
        userId: this.userId,
        operations: this.pendingTxOps,
        description: this.pendingTxDescription ?? "",
        timestamp: Date.now(),
        seq: 0,
      };
      this.pushUndo(tx);
      this.redoStack = [];
    }
    this.pendingTxOps = null;
    this.pendingTxDescription = null;
  }

  /** Cancel the current transaction, discarding all pending operations. */
  cancelTransaction(): void {
    this.pendingTxOps = null;
    this.pendingTxDescription = null;
  }

  // ── Drag coalescing ────────────────────────────────────────────

  /** Begin a drag coalescing session for a specific node+path. */
  beginDrag(nodeUuid: string, path: string): void {
    if (this.dragState !== null) {
      throw new Error("Cannot begin drag: a drag is already active");
    }
    if (this.pendingTxOps !== null) {
      throw new Error("Cannot begin drag: a transaction is already active");
    }
    this.dragState = {
      nodeUuid,
      path,
      firstPreviousValue: undefined,
      lastValue: undefined,
      lastOp: null,
      updateCount: 0,
    };
  }

  /**
   * Update the current drag with a new operation.
   * Only the first previousValue and the last value are kept.
   */
  updateDrag(op: Operation): void {
    if (this.dragState === null) {
      throw new Error("Cannot update drag: no active drag (call beginDrag first)");
    }
    if (this.dragState.updateCount === 0) {
      this.dragState.firstPreviousValue = op.previousValue;
    }
    this.dragState.lastValue = op.value;
    this.dragState.lastOp = op;
    this.dragState.updateCount++;
  }

  /** Commit the drag as a single coalesced transaction. */
  commitDrag(): void {
    if (this.dragState === null) {
      throw new Error("Cannot commit drag: no active drag");
    }
    if (this.dragState.updateCount > 0 && this.dragState.lastOp !== null) {
      const coalescedOp: Operation = {
        id: crypto.randomUUID(),
        userId: this.userId,
        nodeUuid: this.dragState.nodeUuid,
        type: this.dragState.lastOp.type,
        path: this.dragState.path,
        value: this.dragState.lastValue,
        previousValue: this.dragState.firstPreviousValue,
        seq: 0,
      };
      const tx: Transaction = {
        id: crypto.randomUUID(),
        userId: this.userId,
        operations: [coalescedOp],
        description: `Drag ${this.dragState.path}`,
        timestamp: Date.now(),
        seq: 0,
      };
      this.pushUndo(tx);
      this.redoStack = [];
    }
    this.dragState = null;
  }

  /** Cancel the drag, discarding all drag operations. */
  cancelDrag(): void {
    this.dragState = null;
  }

  // ── Undo / Redo ────────────────────────────────────────────────

  /**
   * Undo the most recent transaction.
   * Returns the inverse transaction to send to the server, or null if nothing to undo.
   */
  undo(): Transaction | null {
    const tx = this.undoStack.pop();
    if (tx === undefined) return null;

    const inverseTx = createInverseTransaction(tx);
    this.redoStack.push(tx);
    return inverseTx;
  }

  /**
   * Redo the most recently undone transaction.
   * Returns the original transaction (re-applied), or null if nothing to redo.
   */
  redo(): Transaction | null {
    const tx = this.redoStack.pop();
    if (tx === undefined) return null;

    // The redo should return the inverse of the inverse = original forward direction.
    // Since `tx` is the original transaction from the undo stack, we create
    // its inverse-of-inverse by inverting the inverse:
    const inverseTx = createInverseTransaction(tx);
    // inverseTx now has the ops in the forward direction again.
    this.undoStack.push(tx);
    return inverseTx;
  }

  /** Whether there are transactions to undo. */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Whether there are transactions to redo. */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ── Clear ──────────────────────────────────────────────────────

  /** Clear both undo and redo stacks. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingTxOps = null;
    this.pendingTxDescription = null;
    this.dragState = null;
  }

  // ── Persistence accessors (used by HistoryStore integration) ───

  /** Get the current undo stack (for persistence). */
  getUndoStack(): readonly Transaction[] {
    return this.undoStack;
  }

  /** Get the current redo stack (for persistence). */
  getRedoStack(): readonly Transaction[] {
    return this.redoStack;
  }

  /** Replace the undo and redo stacks (for restore from IndexedDB). */
  restoreStacks(undoStack: Transaction[], redoStack: Transaction[]): void {
    this.undoStack = undoStack;
    this.redoStack = redoStack;
  }

  // ── Internal ───────────────────────────────────────────────────

  private pushUndo(tx: Transaction): void {
    this.undoStack.push(tx);
    // FIFO eviction from bottom when exceeding max size
    while (this.undoStack.length > MAX_HISTORY_SIZE) {
      this.undoStack.shift();
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --prefix frontend test -- --reporter=verbose src/operations/__tests__/history-manager.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/operations/history-manager.ts frontend/src/operations/__tests__/history-manager.test.ts
git commit -m "feat(frontend): add HistoryManager with undo/redo, transactions, drag coalescing (Plan 15a, Task 3)"
```

---

## Task 4: IndexedDB Persistence (HistoryStore)

**Files:**
- Create: `frontend/src/operations/__tests__/history-store.test.ts`
- Create: `frontend/src/operations/history-store.ts`
- Modify: `frontend/package.json` (add `fake-indexeddb` dev dependency)

- [ ] **Step 1: Install fake-indexeddb test dependency**

```bash
pnpm --prefix frontend add -D fake-indexeddb
```

- [ ] **Step 2: Write failing tests**

Create `frontend/src/operations/__tests__/history-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { HistoryStore } from "../history-store";
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
    it("saves and loads undo and redo stacks", async () => {
      const undoStack = [makeTx("u1", "user-1", 1000), makeTx("u2", "user-1", 2000)];
      const redoStack = [makeTx("r1", "user-1", 3000)];

      await store.saveStack("doc-1", "user-1", undoStack, redoStack);
      const result = await store.loadStack("doc-1", "user-1");

      expect(result).not.toBeNull();
      expect(result!.undoStack).toHaveLength(2);
      expect(result!.redoStack).toHaveLength(1);
      expect(result!.undoStack[0].id).toBe("u1");
      expect(result!.undoStack[1].id).toBe("u2");
      expect(result!.redoStack[0].id).toBe("r1");
    });

    it("overwrites previous data on save", async () => {
      await store.saveStack("doc-1", "user-1", [makeTx("u1", "user-1", 1000)], []);
      await store.saveStack("doc-1", "user-1", [makeTx("u2", "user-1", 2000)], []);

      const result = await store.loadStack("doc-1", "user-1");
      expect(result!.undoStack).toHaveLength(1);
      expect(result!.undoStack[0].id).toBe("u2");
    });

    it("returns null for non-existent document/user pair", async () => {
      const result = await store.loadStack("nonexistent", "nobody");
      expect(result).toBeNull();
    });

    it("isolates data by documentId", async () => {
      await store.saveStack("doc-1", "user-1", [makeTx("u1", "user-1", 1000)], []);
      await store.saveStack("doc-2", "user-1", [makeTx("u2", "user-1", 2000)], []);

      const r1 = await store.loadStack("doc-1", "user-1");
      const r2 = await store.loadStack("doc-2", "user-1");
      expect(r1!.undoStack[0].id).toBe("u1");
      expect(r2!.undoStack[0].id).toBe("u2");
    });

    it("isolates data by userId", async () => {
      await store.saveStack("doc-1", "user-1", [makeTx("u1", "user-1", 1000)], []);
      await store.saveStack("doc-1", "user-2", [makeTx("u2", "user-2", 2000)], []);

      const r1 = await store.loadStack("doc-1", "user-1");
      const r2 = await store.loadStack("doc-1", "user-2");
      expect(r1!.undoStack[0].id).toBe("u1");
      expect(r2!.undoStack[0].id).toBe("u2");
    });
  });

  describe("clearStack", () => {
    it("removes all data for a document/user pair", async () => {
      await store.saveStack("doc-1", "user-1", [makeTx("u1", "user-1", 1000)], []);
      await store.clearStack("doc-1", "user-1");

      const result = await store.loadStack("doc-1", "user-1");
      expect(result).toBeNull();
    });

    it("does not affect other document/user pairs", async () => {
      await store.saveStack("doc-1", "user-1", [makeTx("u1", "user-1", 1000)], []);
      await store.saveStack("doc-1", "user-2", [makeTx("u2", "user-2", 2000)], []);

      await store.clearStack("doc-1", "user-1");

      const r1 = await store.loadStack("doc-1", "user-1");
      const r2 = await store.loadStack("doc-1", "user-2");
      expect(r1).toBeNull();
      expect(r2).not.toBeNull();
    });

    it("does not throw when clearing non-existent data", async () => {
      await expect(store.clearStack("nonexistent", "nobody")).resolves.not.toThrow();
    });
  });

  describe("handles empty stacks", () => {
    it("saves and loads empty stacks", async () => {
      await store.saveStack("doc-1", "user-1", [], []);
      const result = await store.loadStack("doc-1", "user-1");
      expect(result).not.toBeNull();
      expect(result!.undoStack).toHaveLength(0);
      expect(result!.redoStack).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm --prefix frontend test -- --reporter=verbose src/operations/__tests__/history-store.test.ts
```

Expected: FAIL -- module not found.

- [ ] **Step 4: Implement HistoryStore**

Create `frontend/src/operations/history-store.ts`:

```typescript
/**
 * IndexedDB persistence layer for undo/redo stacks.
 *
 * Stores Transaction arrays keyed by [documentId, userId].
 * Uses the raw IndexedDB API (no external library).
 *
 * Database: sigil-history
 *   Object store: stacks
 *     keyPath: key (compound string "documentId::userId")
 *     Value: { key, undoStack, redoStack }
 *
 * See: Spec 15, section 4.2.
 */

import type { Transaction } from "./types";

/** Database name. */
const DB_NAME = "sigil-history";

/** Database version. */
const DB_VERSION = 1;

/** Object store name for stack data. */
const STACKS_STORE = "stacks";

/** Result of loading a saved stack from IndexedDB. */
export interface LoadedStacks {
  readonly undoStack: Transaction[];
  readonly redoStack: Transaction[];
}

/** Internal record shape stored in IndexedDB. */
interface StackRecord {
  key: string;
  undoStack: Transaction[];
  redoStack: Transaction[];
}

/** Build the compound key string from document and user IDs. */
function makeKey(documentId: string, userId: string): string {
  return `${documentId}::${userId}`;
}

export class HistoryStore {
  private db: IDBDatabase | null = null;

  /**
   * Open the IndexedDB database. Must be called before any other method.
   */
  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STACKS_STORE)) {
          db.createObjectStore(STACKS_STORE, { keyPath: "key" });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB "${DB_NAME}": ${String(request.error)}`));
      };
    });
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Save undo and redo stacks for a document+user pair.
   * Overwrites any existing data for the same key.
   */
  async saveStack(
    documentId: string,
    userId: string,
    undoStack: readonly Transaction[],
    redoStack: readonly Transaction[],
  ): Promise<void> {
    const db = this.requireDb();
    const key = makeKey(documentId, userId);

    const record: StackRecord = {
      key,
      undoStack: [...undoStack],
      redoStack: [...redoStack],
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STACKS_STORE, "readwrite");
      const store = tx.objectStore(STACKS_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to save stack: ${String(request.error)}`));
    });
  }

  /**
   * Load undo and redo stacks for a document+user pair.
   * Returns null if no data exists for the given key.
   */
  async loadStack(
    documentId: string,
    userId: string,
  ): Promise<LoadedStacks | null> {
    const db = this.requireDb();
    const key = makeKey(documentId, userId);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STACKS_STORE, "readonly");
      const store = tx.objectStore(STACKS_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result as StackRecord | undefined;
        if (result === undefined) {
          resolve(null);
        } else {
          resolve({
            undoStack: result.undoStack,
            redoStack: result.redoStack,
          });
        }
      };

      request.onerror = () =>
        reject(new Error(`Failed to load stack: ${String(request.error)}`));
    });
  }

  /**
   * Clear all stored data for a document+user pair.
   */
  async clearStack(documentId: string, userId: string): Promise<void> {
    const db = this.requireDb();
    const key = makeKey(documentId, userId);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STACKS_STORE, "readwrite");
      const store = tx.objectStore(STACKS_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to clear stack: ${String(request.error)}`));
    });
  }

  /** Ensure the database is open, throw if not. */
  private requireDb(): IDBDatabase {
    if (this.db === null) {
      throw new Error("HistoryStore is not open. Call open() first.");
    }
    return this.db;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --prefix frontend test -- --reporter=verbose src/operations/__tests__/history-store.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/operations/history-store.ts frontend/src/operations/__tests__/history-store.test.ts frontend/package.json frontend/pnpm-lock.yaml
git commit -m "feat(frontend): add IndexedDB-backed HistoryStore for undo/redo persistence (Plan 15a, Task 4)"
```

---

## Task 5: HistoryManager + IndexedDB Integration

**Files:**
- Create: `frontend/src/operations/persistent-history-manager.ts`
- Create: `frontend/src/operations/__tests__/persistent-history-manager.test.ts`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/operations/__tests__/persistent-history-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { PersistentHistoryManager } from "../persistent-history-manager";
import { createSetFieldOp } from "../operation-helpers";

const USER_ID = "test-user";
const DOC_ID = "doc-1";

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
    it("persists undo stack to IndexedDB after apply", async () => {
      const op = createSetFieldOp(USER_ID, "node-1", "name", "B", "A");
      phm.apply(op, "Rename");

      // Wait for async persist
      await phm.persist(DOC_ID);

      // Create a new instance and restore
      const phm2 = new PersistentHistoryManager(USER_ID);
      await phm2.init();
      await phm2.restore(DOC_ID);

      expect(phm2.canUndo()).toBe(true);
      const inv = phm2.undo();
      expect(inv).not.toBeNull();
      expect(inv!.operations[0].value).toBe("A");

      phm2.dispose();
    });

    it("persists redo stack to IndexedDB after undo", async () => {
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

    it("restores empty stacks for unknown document", async () => {
      await phm.restore("nonexistent-doc");
      expect(phm.canUndo()).toBe(false);
      expect(phm.canRedo()).toBe(false);
    });

    it("clear removes persisted data", async () => {
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

  describe("persist errors are logged, not thrown", () => {
    it("persistAsync does not throw on error", async () => {
      // Close the underlying store to simulate an error
      phm.dispose();

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // This should not throw
      phm.persistAsync(DOC_ID);

      // Give the microtask time to settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      consoleSpy.mockRestore();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --prefix frontend test -- --reporter=verbose src/operations/__tests__/persistent-history-manager.test.ts
```

Expected: FAIL -- module not found.

- [ ] **Step 3: Implement PersistentHistoryManager**

Create `frontend/src/operations/persistent-history-manager.ts`:

```typescript
/**
 * PersistentHistoryManager wraps HistoryManager with IndexedDB persistence.
 *
 * All HistoryManager operations are delegated to the inner manager.
 * After each state-changing operation, persistAsync() can be called
 * to fire-and-forget save to IndexedDB.
 *
 * See: Spec 15, sections 4.1 and 4.2.
 */

import type { Operation, Transaction } from "./types";
import { HistoryManager } from "./history-manager";
import { HistoryStore } from "./history-store";

export class PersistentHistoryManager {
  private readonly manager: HistoryManager;
  private readonly store: HistoryStore;
  private readonly userId: string;

  constructor(userId: string) {
    this.userId = userId;
    this.manager = new HistoryManager(userId);
    this.store = new HistoryStore();
  }

  /** Open the IndexedDB database. Must be called before use. */
  async init(): Promise<void> {
    await this.store.open();
  }

  /** Close the IndexedDB database. */
  dispose(): void {
    this.store.close();
  }

  // ── Delegated HistoryManager methods ───────────────────────────

  apply(op: Operation, description: string): void {
    this.manager.apply(op, description);
  }

  beginTransaction(description: string): void {
    this.manager.beginTransaction(description);
  }

  addOperation(op: Operation): void {
    this.manager.addOperation(op);
  }

  commitTransaction(): void {
    this.manager.commitTransaction();
  }

  cancelTransaction(): void {
    this.manager.cancelTransaction();
  }

  beginDrag(nodeUuid: string, path: string): void {
    this.manager.beginDrag(nodeUuid, path);
  }

  updateDrag(op: Operation): void {
    this.manager.updateDrag(op);
  }

  commitDrag(): void {
    this.manager.commitDrag();
  }

  cancelDrag(): void {
    this.manager.cancelDrag();
  }

  undo(): Transaction | null {
    return this.manager.undo();
  }

  redo(): Transaction | null {
    return this.manager.redo();
  }

  canUndo(): boolean {
    return this.manager.canUndo();
  }

  canRedo(): boolean {
    return this.manager.canRedo();
  }

  clear(): void {
    this.manager.clear();
  }

  // ── Persistence ────────────────────────────────────────────────

  /**
   * Persist current stacks to IndexedDB (blocking/await).
   * Used when you need to guarantee the save completes.
   */
  async persist(documentId: string): Promise<void> {
    await this.store.saveStack(
      documentId,
      this.userId,
      this.manager.getUndoStack(),
      this.manager.getRedoStack(),
    );
  }

  /**
   * Fire-and-forget persist. Logs errors to console.error.
   * Called after every state-changing operation for non-blocking persistence.
   */
  persistAsync(documentId: string): void {
    this.persist(documentId).catch((err: unknown) => {
      console.error("Failed to persist history to IndexedDB:", err);
    });
  }

  /**
   * Restore stacks from IndexedDB for a given document.
   */
  async restore(documentId: string): Promise<void> {
    const loaded = await this.store.loadStack(documentId, this.userId);
    if (loaded !== null) {
      this.manager.restoreStacks(loaded.undoStack, loaded.redoStack);
    }
  }

  /**
   * Clear persisted data for a document from IndexedDB and reset in-memory stacks.
   */
  async clearPersisted(documentId: string): Promise<void> {
    this.manager.clear();
    await this.store.clearStack(documentId, this.userId);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --prefix frontend test -- --reporter=verbose src/operations/__tests__/persistent-history-manager.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/operations/persistent-history-manager.ts frontend/src/operations/__tests__/persistent-history-manager.test.ts
git commit -m "feat(frontend): add PersistentHistoryManager wiring HistoryManager to IndexedDB (Plan 15a, Task 5)"
```

---

## Task 6: Barrel Export + Final Verification

**Files:**
- Create: `frontend/src/operations/index.ts`

- [ ] **Step 1: Create barrel export**

Create `frontend/src/operations/index.ts`:

```typescript
/**
 * Operations module — client-side undo/redo system.
 *
 * Standalone module with zero integration to the document store or server.
 * See: Spec 15, Phase 15a.
 */

// Types
export type { Operation, Transaction, OperationType, ReparentValue, ReorderValue, ReorderPreviousValue } from "./types";
export { MAX_HISTORY_SIZE } from "./types";

// Helpers
export {
  createSetFieldOp,
  createCreateNodeOp,
  createDeleteNodeOp,
  createReparentOp,
  createReorderOp,
  createInverse,
  createInverseTransaction,
} from "./operation-helpers";

// HistoryManager
export { HistoryManager } from "./history-manager";

// IndexedDB persistence
export { HistoryStore } from "./history-store";
export type { LoadedStacks } from "./history-store";

// Persistent wrapper
export { PersistentHistoryManager } from "./persistent-history-manager";
```

- [ ] **Step 2: Run all operations tests**

```bash
pnpm --prefix frontend test -- --reporter=verbose src/operations/
```

Expected: All tests PASS.

- [ ] **Step 3: Run full test suite**

```bash
pnpm --prefix frontend test
```

Expected: All tests PASS (no regressions).

- [ ] **Step 4: Lint**

```bash
pnpm --prefix frontend lint
```

- [ ] **Step 5: Format**

```bash
pnpm --prefix frontend format
```

- [ ] **Step 6: Type check**

```bash
pnpm --prefix frontend exec tsc --noEmit
```

- [ ] **Step 7: Build**

```bash
pnpm --prefix frontend build
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/operations/index.ts
git commit -m "feat(frontend): add operations barrel export (Plan 15a, Task 6)"
```

- [ ] **Step 9: Commit any lint/format fixes if needed**

```bash
git add frontend/src/operations/
git commit -m "chore(frontend): lint and format operations module (Plan 15a, Task 6)"
```

---

## Summary

| Task | Description | Key Files | Tests |
|------|-------------|-----------|-------|
| 1 | Operation + Transaction types | `operations/types.ts` | Type-check only |
| 2 | Operation factory and inverse helpers | `operations/operation-helpers.ts` | ~15 tests |
| 3 | HistoryManager (undo/redo/transactions/drag) | `operations/history-manager.ts` | ~22 tests |
| 4 | IndexedDB HistoryStore | `operations/history-store.ts` | ~8 tests |
| 5 | PersistentHistoryManager integration | `operations/persistent-history-manager.ts` | ~5 tests |
| 6 | Barrel export + final verification | `operations/index.ts` | Full suite |

**New dev dependency:** `fake-indexeddb` (test-only, for IndexedDB mocking in Vitest)

**Exit criteria (from spec):** HistoryManager can create transactions, undo/redo, persist to IndexedDB, restore on load. All via unit tests.

After this plan, Phase 15b (operation broadcast subscription) builds on these types to wire server communication. Phase 15c wires the store mutations to emit operations through the HistoryManager.

---

### Critical Files for Implementation

- `/Volumes/projects/Personal/agent-designer/frontend/src/operations/types.ts` - Foundation types (Operation, Transaction) used by all other modules in this plan
- `/Volumes/projects/Personal/agent-designer/frontend/src/operations/history-manager.ts` - Core HistoryManager class with undo/redo stacks, transaction grouping, drag coalescing
- `/Volumes/projects/Personal/agent-designer/frontend/src/operations/history-store.ts` - IndexedDB persistence layer for surviving page reloads
- `/Volumes/projects/Personal/agent-designer/frontend/src/operations/operation-helpers.ts` - Pure factory functions for creating and inverting operations
- `/Volumes/projects/Personal/agent-designer/docs/superpowers/plans/2026-04-03-10a-dnd-infrastructure.md` - Reference plan for format conventions (TDD pattern, step structure, commit messages)