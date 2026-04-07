# Plan 15c -- Refactor Frontend Mutations to Emit Operations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite all 18 store mutation methods in `document-store-solid.tsx` to create Operation objects, apply them locally to the Solid store (instant), track them in HistoryManager (for undo), and send them to the server. Wire Cmd+Z / Cmd+Shift+Z to HistoryManager instead of server UNDO/REDO mutations. Integrate drag coalescing for pointer-move operations and transactions for multi-node operations.

**Architecture:** The store factory gains a `HistoryManager` instance (from Plan 15a). Each mutation method follows a uniform pattern: (1) snapshot previousValue, (2) create Operation via helpers, (3) apply to Solid store via `setState`, (4) track in HistoryManager, (5) send to server. Undo/redo calls HistoryManager locally, applies the inverse transaction to the Solid store, then sends the inverse operations to the server. During this transition phase, the server still uses its existing per-mutation GraphQL resolvers -- we keep individual mutation strings but add operation tracking alongside. The server-side cleanup happens in Phase 15d.

**Tech Stack:** TypeScript (strict mode), Solid.js 1.9, Vitest, urql, fake-indexeddb (test dependency)

**Spec Reference:** Spec 15, sections 3 (Operation Model), 4.1 (HistoryManager API), 7 (Frontend Mutation Refactor), Phase 15c (section 9)

**Depends on:**
- Plan 15a (Operation types + HistoryManager + IndexedDB) -- MUST be merged first. Provides `Operation`, `Transaction`, `HistoryManager`, `createSetFieldOp`, `createCreateNodeOp`, `createDeleteNodeOp`, `createReparentOp`, `createReorderOp`, `createInverse`, `createInverseTransaction` in `frontend/src/operations/`.
- Plan 15b (Operation broadcast subscription) -- SHOULD be merged first. Provides `applyRemoteTransaction` / `applyRemoteOperation` in `frontend/src/operations/apply-remote.ts` and the new subscription handler. If 15b is not yet merged, the store continues using the existing `DOCUMENT_CHANGED_SUBSCRIPTION` + debounced refetch; the operation tracking in 15c still works correctly for local undo/redo.

---

## Scope

**In scope:**
- Refactor all 18 mutation methods to create + track Operations
- New `applyOperationToStore` function that applies a single Operation to the Solid store
- Wire undo/redo to HistoryManager (local-first, then send inverse to server)
- Drag coalescing in select-tool.ts via `beginDrag` / `updateDrag` / `commitDrag`
- Transaction grouping for batchSetTransform, groupNodes, ungroupNodes
- Remove `UNDO_MUTATION`, `REDO_MUTATION` imports and usage
- Remove `can_undo` / `can_redo` from `MutableDocumentInfo` (derived from HistoryManager)
- Update `DocumentStoreAPI` interface: `canUndo` / `canRedo` become HistoryManager-derived signals
- Remove debounced style mutation timers (fills, strokes, effects) -- drag coalescing replaces them
- Update `ToolStore` interface to expose `beginDrag` / `commitDrag` for select-tool integration

**Deferred:**
- APPLY_OPERATIONS_MUTATION (single unified GraphQL mutation) -- Phase 15d. During 15c, individual mutation strings are retained for server compatibility.
- Server-side undo/redo removal -- Phase 15d
- Reconnect protocol with sequence numbers -- Phase 15d
- IndexedDB persistence wiring (HistoryManager already supports it; wiring it to document lifecycle is a follow-up)

---

## Task 1: Store-Level Operation Application Function + Tests

**Files:**
- Create: `frontend/src/operations/__tests__/apply-to-store.test.ts`
- Create: `frontend/src/operations/apply-to-store.ts`

This task builds the pure function that takes an Operation and a Solid `setState` handle, and applies the operation to the store. This is the inverse of `applyRemoteOperation` (from 15b) but operates on the mutable store state. Both undo and redo paths use this function.

- [ ] **Step 1: Write failing tests**

Create `frontend/src/operations/__tests__/apply-to-store.test.ts`:

```typescript
/**
 * Tests for applyOperationToStore — the function that applies a single
 * Operation to the Solid store's setState.
 *
 * Uses a plain object + setter mock to avoid Solid runtime dependency in unit tests.
 */
import { describe, it, expect, vi } from "vitest";
import {
  applyOperationToStore,
  type StoreStateSetter,
  type StoreStateReader,
} from "../apply-to-store";
import type { Operation } from "../types";

function makeOp(overrides: Partial<Operation>): Operation {
  return {
    id: crypto.randomUUID(),
    userId: "user-1",
    nodeUuid: "node-1",
    type: "set_field",
    path: "transform",
    value: null,
    previousValue: null,
    seq: 0,
    ...overrides,
  };
}

describe("applyOperationToStore — set_field", () => {
  it("applies a transform set_field operation", () => {
    const setter = vi.fn();
    const reader: StoreStateReader = {
      getNode: () => ({
        uuid: "node-1",
        transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
        style: { fills: [], strokes: [], opacity: { type: "literal", value: 1 }, blend_mode: "normal", effects: [] },
        kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
        name: "Rect",
        visible: true,
        locked: false,
      }),
    };
    const newTransform = { x: 50, y: 50, width: 200, height: 200, rotation: 0, scale_x: 1, scale_y: 1 };
    const op = makeOp({ type: "set_field", path: "transform", nodeUuid: "node-1", value: newTransform });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalledWith("nodes", "node-1", "transform", newTransform);
  });

  it("applies a name set_field operation", () => {
    const setter = vi.fn();
    const reader: StoreStateReader = {
      getNode: () => ({ uuid: "node-1", name: "Old Name" }),
    };
    const op = makeOp({ type: "set_field", path: "name", value: "New Name" });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalledWith("nodes", "node-1", "name", "New Name");
  });

  it("applies a visible set_field operation", () => {
    const setter = vi.fn();
    const reader: StoreStateReader = { getNode: () => ({ uuid: "node-1", visible: true }) };
    const op = makeOp({ path: "visible", value: false });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalledWith("nodes", "node-1", "visible", false);
  });

  it("applies a locked set_field operation", () => {
    const setter = vi.fn();
    const reader: StoreStateReader = { getNode: () => ({ uuid: "node-1", locked: false }) };
    const op = makeOp({ path: "locked", value: true });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalledWith("nodes", "node-1", "locked", true);
  });

  it("applies style.opacity set_field operation via produce", () => {
    const setter = vi.fn();
    const reader: StoreStateReader = {
      getNode: () => ({
        uuid: "node-1",
        style: { opacity: { type: "literal", value: 1 }, fills: [], strokes: [], blend_mode: "normal", effects: [] },
      }),
    };
    const op = makeOp({ path: "style.opacity", value: { type: "literal", value: 0.5 } });

    applyOperationToStore(op, setter, reader);

    // For nested style fields, setter is called with a produce function
    expect(setter).toHaveBeenCalled();
  });

  it("applies style.fills set_field operation", () => {
    const setter = vi.fn();
    const reader: StoreStateReader = { getNode: () => ({ uuid: "node-1", style: { fills: [] } }) };
    const newFills = [{ type: "solid", color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } } }];
    const op = makeOp({ path: "style.fills", value: newFills });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalled();
  });

  it("applies style.strokes set_field operation", () => {
    const setter = vi.fn();
    const reader: StoreStateReader = { getNode: () => ({ uuid: "node-1", style: { strokes: [] } }) };
    const op = makeOp({ path: "style.strokes", value: [] });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalled();
  });

  it("applies style.effects set_field operation", () => {
    const setter = vi.fn();
    const reader: StoreStateReader = { getNode: () => ({ uuid: "node-1", style: { effects: [] } }) };
    const op = makeOp({ path: "style.effects", value: [] });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalled();
  });

  it("applies style.blend_mode set_field operation", () => {
    const setter = vi.fn();
    const reader: StoreStateReader = { getNode: () => ({ uuid: "node-1", style: { blend_mode: "normal" } }) };
    const op = makeOp({ path: "style.blend_mode", value: "multiply" });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalled();
  });

  it("applies kind set_field operation (corner radii)", () => {
    const setter = vi.fn();
    const reader: StoreStateReader = {
      getNode: () => ({ uuid: "node-1", kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] } }),
    };
    const op = makeOp({ path: "kind", value: { type: "rectangle", corner_radii: [8, 8, 8, 8] } });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalled();
  });
});

describe("applyOperationToStore — create_node", () => {
  it("inserts a new node into the store", () => {
    const setter = vi.fn();
    const reader: StoreStateReader = { getNode: () => undefined };
    const nodeData = {
      uuid: "new-uuid",
      name: "Rect 1",
      kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
      style: { fills: [], strokes: [], opacity: { type: "literal", value: 1 }, blend_mode: "normal", effects: [] },
      visible: true,
      locked: false,
    };
    const op = makeOp({ type: "create_node", nodeUuid: "", path: "", value: nodeData, previousValue: null });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalledWith("nodes", "new-uuid", expect.objectContaining({ uuid: "new-uuid" }));
  });
});

describe("applyOperationToStore — delete_node", () => {
  it("removes a node from the store", () => {
    const setter = vi.fn();
    const reader: StoreStateReader = { getNode: () => ({ uuid: "node-1", name: "Rect" }) };
    const op = makeOp({ type: "delete_node", nodeUuid: "node-1", path: "", value: null, previousValue: { uuid: "node-1" } });

    applyOperationToStore(op, setter, reader);

    // Should be called with produce to delete the key
    expect(setter).toHaveBeenCalled();
  });
});

describe("applyOperationToStore — reparent", () => {
  it("updates parentUuid and childrenUuids for reparent operations", () => {
    const setter = vi.fn();
    const nodes: Record<string, unknown> = {
      "node-1": { uuid: "node-1", parentUuid: "parent-a", childrenUuids: [] },
      "parent-a": { uuid: "parent-a", childrenUuids: ["node-1"] },
      "parent-b": { uuid: "parent-b", childrenUuids: [] },
    };
    const reader: StoreStateReader = { getNode: (uuid: string) => nodes[uuid] as never };
    const op = makeOp({
      type: "reparent",
      nodeUuid: "node-1",
      path: "",
      value: { parentUuid: "parent-b", position: 0 },
      previousValue: { parentUuid: "parent-a", position: 0 },
    });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalled();
  });
});

describe("applyOperationToStore — reorder", () => {
  it("reorders a node within its parent childrenUuids", () => {
    const setter = vi.fn();
    const nodes: Record<string, unknown> = {
      "node-1": { uuid: "node-1", parentUuid: "parent-a" },
      "parent-a": { uuid: "parent-a", childrenUuids: ["node-1", "node-2", "node-3"] },
    };
    const reader: StoreStateReader = { getNode: (uuid: string) => nodes[uuid] as never };
    const op = makeOp({
      type: "reorder",
      nodeUuid: "node-1",
      path: "",
      value: { newPosition: 2 },
      previousValue: { oldPosition: 0 },
    });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement applyOperationToStore**

Create `frontend/src/operations/apply-to-store.ts`:

```typescript
/**
 * Applies a single Operation to the Solid store.
 *
 * This function is the single point of truth for translating an Operation
 * into Solid setState calls. Used by:
 * - Mutation methods (forward application)
 * - Undo/redo (applying inverse operations)
 * - Remote operation application (from broadcast subscription)
 *
 * IMPORTANT: This function ONLY mutates the local Solid store. It does NOT
 * send anything to the server. Server communication is the caller's responsibility.
 */

import { produce } from "solid-js/store";
import type { Operation } from "./types";
import type { ReparentValue, ReorderValue } from "./types";

/** Minimal setter interface matching Solid's SetStoreFunction signature. */
export type StoreStateSetter = (...args: unknown[]) => void;

/** Minimal reader for looking up current node state. */
export interface StoreStateReader {
  getNode(uuid: string): Record<string, unknown> | undefined;
}

const PLACEHOLDER_NODE_ID = { index: 0, generation: 0 };

/**
 * Apply a single operation to the Solid store.
 *
 * The operation's `value` field contains the new state to apply.
 * For inverse operations (undo), the caller should have already swapped
 * value/previousValue before calling this.
 */
export function applyOperationToStore(
  op: Operation,
  setState: StoreStateSetter,
  reader: StoreStateReader,
): void {
  switch (op.type) {
    case "set_field":
      applySetField(op, setState);
      break;
    case "create_node":
      applyCreateNode(op, setState);
      break;
    case "delete_node":
      applyDeleteNode(op, setState);
      break;
    case "reparent":
      applyReparent(op, setState, reader);
      break;
    case "reorder":
      applyReorder(op, setState, reader);
      break;
  }
}

function applySetField(op: Operation, setState: StoreStateSetter): void {
  const { nodeUuid, path, value } = op;

  // Direct top-level fields
  switch (path) {
    case "transform":
      setState("nodes", nodeUuid, "transform", value);
      return;
    case "name":
      setState("nodes", nodeUuid, "name", value);
      return;
    case "visible":
      setState("nodes", nodeUuid, "visible", value);
      return;
    case "locked":
      setState("nodes", nodeUuid, "locked", value);
      return;
    case "kind":
      setState(
        produce((s: Record<string, Record<string, Record<string, unknown>>>) => {
          if (s["nodes"][nodeUuid]) {
            s["nodes"][nodeUuid]["kind"] = value as Record<string, unknown>;
          }
        }),
      );
      return;
  }

  // Nested style fields: "style.fills", "style.strokes", etc.
  if (path.startsWith("style.")) {
    const styleProp = path.slice(6); // "fills", "strokes", "opacity", "blend_mode", "effects"
    setState(
      produce((s: Record<string, Record<string, Record<string, Record<string, unknown>>>>) => {
        if (s["nodes"][nodeUuid]) {
          s["nodes"][nodeUuid]["style"] = {
            ...s["nodes"][nodeUuid]["style"],
            [styleProp]: value,
          };
        }
      }),
    );
    return;
  }

  // Fallback: attempt direct path assignment (for future field additions)
  console.warn(`applySetField: unknown path "${path}", attempting direct set`);
  setState("nodes", nodeUuid, path, value);
}

function applyCreateNode(op: Operation, setState: StoreStateSetter): void {
  const nodeData = op.value as Record<string, unknown>;
  const uuid = nodeData["uuid"] as string;
  if (!uuid) {
    console.error("applyCreateNode: missing uuid in node data");
    return;
  }

  setState("nodes", uuid, {
    id: PLACEHOLDER_NODE_ID,
    uuid,
    kind: nodeData["kind"],
    name: nodeData["name"] ?? "",
    parent: null,
    children: [],
    transform: nodeData["transform"],
    style: nodeData["style"] ?? {
      fills: [],
      strokes: [],
      opacity: { type: "literal", value: 1 },
      blend_mode: "normal",
      effects: [],
    },
    constraints: nodeData["constraints"] ?? { horizontal: "start", vertical: "start" },
    grid_placement: nodeData["grid_placement"] ?? null,
    visible: nodeData["visible"] ?? true,
    locked: nodeData["locked"] ?? false,
    parentUuid: (nodeData["parentUuid"] as string) ?? null,
    childrenUuids: (nodeData["childrenUuids"] as string[]) ?? [],
  });
}

function applyDeleteNode(op: Operation, setState: StoreStateSetter): void {
  setState(
    produce((s: Record<string, Record<string, unknown>>) => {
      Reflect.deleteProperty(s["nodes"], op.nodeUuid);
    }),
  );
}

function applyReparent(op: Operation, setState: StoreStateSetter, reader: StoreStateReader): void {
  const { nodeUuid } = op;
  const newParent = op.value as ReparentValue;
  const node = reader.getNode(nodeUuid);
  const oldParentUuid = (node as Record<string, unknown> | undefined)?.["parentUuid"] as string | null;

  setState(
    produce((s: Record<string, Record<string, Record<string, unknown>>>) => {
      // Remove from old parent
      if (oldParentUuid && s["nodes"][oldParentUuid]) {
        const oldChildren = s["nodes"][oldParentUuid]["childrenUuids"] as string[];
        s["nodes"][oldParentUuid]["childrenUuids"] = oldChildren.filter(
          (c: string) => c !== nodeUuid,
        );
      }
      // Insert into new parent
      if (s["nodes"][newParent.parentUuid]) {
        const children = (
          s["nodes"][newParent.parentUuid]["childrenUuids"] as string[]
        ).filter((c: string) => c !== nodeUuid);
        const insertAt = Math.min(newParent.position, children.length);
        children.splice(insertAt, 0, nodeUuid);
        s["nodes"][newParent.parentUuid]["childrenUuids"] = children;
      }
      // Update node's parent reference
      if (s["nodes"][nodeUuid]) {
        s["nodes"][nodeUuid]["parentUuid"] = newParent.parentUuid;
      }
    }),
  );
}

function applyReorder(op: Operation, setState: StoreStateSetter, reader: StoreStateReader): void {
  const { nodeUuid } = op;
  const reorder = op.value as ReorderValue;
  const node = reader.getNode(nodeUuid);
  const parentUuid = (node as Record<string, unknown> | undefined)?.["parentUuid"] as string | null;

  if (!parentUuid) return;

  setState(
    produce((s: Record<string, Record<string, Record<string, unknown>>>) => {
      if (s["nodes"][parentUuid]) {
        const children = (s["nodes"][parentUuid]["childrenUuids"] as string[]).filter(
          (c: string) => c !== nodeUuid,
        );
        const insertAt = Math.min(reorder.newPosition, children.length);
        children.splice(insertAt, 0, nodeUuid);
        s["nodes"][parentUuid]["childrenUuids"] = children;
      }
    }),
  );
}
```

- [ ] **Step 3: Run tests, verify all pass**

```bash
pnpm --prefix frontend test -- --run frontend/src/operations/__tests__/apply-to-store.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/operations/apply-to-store.ts frontend/src/operations/__tests__/apply-to-store.test.ts
git commit -m "feat(frontend): add applyOperationToStore for Solid store mutation (Plan 15c, Task 1)"
```

---

## Task 2: HistoryManager Integration Layer + Undo/Redo Apply

**Files:**
- Create: `frontend/src/operations/__tests__/store-history-integration.test.ts`
- Create: `frontend/src/operations/store-history.ts`

This task creates the bridge between HistoryManager and the Solid store. It provides `applyAndTrack` (for forward mutations), `undoAndApply`, and `redoAndApply` functions that compose HistoryManager with `applyOperationToStore`.

- [ ] **Step 1: Write failing tests**

Create `frontend/src/operations/__tests__/store-history-integration.test.ts`:

```typescript
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
import {
  createStoreHistoryBridge,
  type StoreHistoryBridge,
} from "../store-history";
import type { Operation } from "../types";
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
        style: { fills: [], strokes: [], opacity: { type: "literal", value: 1 }, blend_mode: "normal", effects: [] },
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

  it("beginTransaction + addOperation + commitTransaction creates single undo step", () => {
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
    expect(inverseTx!.operations).toHaveLength(2);
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
    // Coalesced: one operation with first previousValue and last value
    expect(inverseTx!.operations).toHaveLength(1);
  });

  it("cancelDrag discards the drag without creating an undo step", () => {
    bridge.beginDrag("node-1", "transform");
    const op = createSetFieldOp(USER_ID, "node-1", "transform", { x: 5 }, { x: 0 });
    bridge.updateDrag(op);
    bridge.cancelDrag();

    expect(historyManager.canUndo()).toBe(false);
  });
});
```

- [ ] **Step 2: Implement StoreHistoryBridge**

Create `frontend/src/operations/store-history.ts`:

```typescript
/**
 * Bridge between HistoryManager and the Solid store.
 *
 * Provides composed operations that:
 * 1. Apply operations to the Solid store (instant local feedback)
 * 2. Track them in HistoryManager (for undo/redo)
 *
 * The caller (document-store-solid.tsx) is responsible for sending
 * operations to the server after calling these methods.
 */

import { batch } from "solid-js";
import type { HistoryManager } from "./history-manager";
import type { Operation, Transaction } from "./types";
import { applyOperationToStore, type StoreStateSetter, type StoreStateReader } from "./apply-to-store";

export interface StoreHistoryBridge {
  /** Apply a single operation to the store and track it as a discrete undo step. */
  applyAndTrack(op: Operation, description: string): void;

  /** Begin an explicit transaction (multi-operation undo step). */
  beginTransaction(description: string): void;
  /** Apply an operation within the current transaction. */
  applyInTransaction(op: Operation): void;
  /** Commit the current transaction as a single undo step. */
  commitTransaction(): void;
  /** Cancel the current transaction (operations already applied remain in store -- caller must revert). */
  cancelTransaction(): void;

  /** Begin a drag operation for coalescing. */
  beginDrag(nodeUuid: string, path: string): void;
  /** Update the drag with a new operation (applies to store, coalesces in history). */
  updateDrag(op: Operation): void;
  /** Commit the drag as a single undo step. Returns the coalesced operation for server send. */
  commitDrag(): Operation | null;
  /** Cancel the drag without creating an undo step. */
  cancelDrag(): void;

  /** Undo: apply inverse transaction to store. Returns inverse transaction for server send. */
  undo(): Transaction | null;
  /** Redo: re-apply transaction to store. Returns transaction for server send. */
  redo(): Transaction | null;

  /** Whether undo is available. */
  canUndo(): boolean;
  /** Whether redo is available. */
  canRedo(): boolean;
}

export function createStoreHistoryBridge(
  historyManager: HistoryManager,
  setState: StoreStateSetter,
  reader: StoreStateReader,
): StoreHistoryBridge {
  return {
    applyAndTrack(op: Operation, description: string): void {
      applyOperationToStore(op, setState, reader);
      historyManager.apply(op);
    },

    beginTransaction(description: string): void {
      historyManager.beginTransaction(description);
    },

    applyInTransaction(op: Operation): void {
      applyOperationToStore(op, setState, reader);
      historyManager.addOperation(op);
    },

    commitTransaction(): void {
      historyManager.commitTransaction();
    },

    cancelTransaction(): void {
      historyManager.cancelTransaction();
    },

    beginDrag(nodeUuid: string, path: string): void {
      historyManager.beginDrag(nodeUuid, path);
    },

    updateDrag(op: Operation): void {
      applyOperationToStore(op, setState, reader);
      historyManager.updateDrag(op);
    },

    commitDrag(): Operation | null {
      historyManager.commitDrag();
      // The coalesced operation is in the last transaction on the undo stack.
      // Caller should construct the server payload from the operation they tracked.
      return null; // Caller manages server send separately
    },

    cancelDrag(): void {
      historyManager.cancelDrag();
    },

    undo(): Transaction | null {
      const inverseTx = historyManager.undo();
      if (!inverseTx) return null;

      batch(() => {
        for (const op of inverseTx.operations) {
          applyOperationToStore(op, setState, reader);
        }
      });

      return inverseTx;
    },

    redo(): Transaction | null {
      const redoTx = historyManager.redo();
      if (!redoTx) return null;

      batch(() => {
        for (const op of redoTx.operations) {
          applyOperationToStore(op, setState, reader);
        }
      });

      return redoTx;
    },

    canUndo(): boolean {
      return historyManager.canUndo();
    },

    canRedo(): boolean {
      return historyManager.canRedo();
    },
  };
}
```

- [ ] **Step 3: Run tests, verify all pass**

```bash
pnpm --prefix frontend test -- --run frontend/src/operations/__tests__/store-history-integration.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/operations/store-history.ts frontend/src/operations/__tests__/store-history-integration.test.ts
git commit -m "feat(frontend): add StoreHistoryBridge composing HistoryManager + store apply (Plan 15c, Task 2)"
```

---

## Task 3: Refactor Simple Field Mutations (setTransform, renameNode, setVisible, setLocked, setOpacity, setBlendMode, setCornerRadii)

**Files:**
- Modify: `frontend/src/store/document-store-solid.tsx`
- Create: `frontend/src/store/__tests__/mutation-operations.test.ts`

These are the "simple" mutations: one node, one field, no debouncing, no structural changes. Each follows the identical pattern: snapshot previousValue, create Operation, apply via bridge, send existing GraphQL mutation to server, rollback on error.

- [ ] **Step 1: Write integration tests for operation-emitting mutations**

Create `frontend/src/store/__tests__/mutation-operations.test.ts`. Test that each mutation:
1. Calls `applyOperationToStore` (verifiable via setState calls)
2. Creates an Operation with correct type/path/value/previousValue
3. Tracks in HistoryManager (canUndo becomes true)
4. Sends the existing GraphQL mutation to the server

Use a mock urql client and real HistoryManager. Focus on verifying the Operation shape, not re-testing applyOperationToStore (covered in Task 1).

```typescript
/**
 * Tests that mutation methods in document-store-solid create Operations,
 * track them in HistoryManager, and send to server.
 *
 * These tests use the real store factory with a mock urql client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Test structure: for each mutation method, verify:
// 1. setState was called (optimistic update)
// 2. HistoryManager.canUndo() is true after mutation
// 3. urql client.mutation was called with correct variables
// 4. After undo, setState is called with previousValue

// Detailed test implementations follow the pattern from Task 1 tests.
// Each mutation gets its own describe block:
//
// describe("setTransform — operation tracking", () => { ... });
// describe("renameNode — operation tracking", () => { ... });
// describe("setVisible — operation tracking", () => { ... });
// describe("setLocked — operation tracking", () => { ... });
// describe("setOpacity — operation tracking", () => { ... });
// describe("setBlendMode — operation tracking", () => { ... });
// describe("setCornerRadii — operation tracking", () => { ... });
//
// Each test:
// 1. Creates a store with a mock client
// 2. Seeds a node into state
// 3. Calls the mutation
// 4. Verifies operation was created with correct fields
// 5. Calls undo, verifies inverse was applied
```

- [ ] **Step 2: Add HistoryManager and StoreHistoryBridge to store factory**

Modify `frontend/src/store/document-store-solid.tsx`:

1. Import `HistoryManager` from `../operations/history-manager`
2. Import `createStoreHistoryBridge` from `../operations/store-history`
3. Import operation helper functions from `../operations/operation-helpers`
4. Inside `createDocumentStoreSolid()`, after the `setState` declaration:

```typescript
// ── History Manager ───────────────────────────────────────────────────
const historyManager = new HistoryManager(clientSessionId);
const storeReader: StoreStateReader = {
  getNode: (uuid: string) => state.nodes[uuid] as Record<string, unknown> | undefined,
};
const history = createStoreHistoryBridge(historyManager, setState, storeReader);
```

5. Replace `canUndo` and `canRedo` derived signals:

```typescript
// Derived from HistoryManager, not server state
const canUndo = () => history.canUndo();
const canRedo = () => history.canRedo();
```

6. Remove `can_undo` and `can_redo` from `MutableDocumentInfo` initial state (keep the fields for backward compat but stop reading them).

- [ ] **Step 3: Refactor setTransform**

Replace the current `setTransform` method:

```typescript
function setTransform(uuid: string, transform: Transform): void {
  const node = state.nodes[uuid];
  if (!node) return;
  const previous = deepClone(node.transform);

  const op = createSetFieldOp(clientSessionId, uuid, "transform", transform, previous);
  history.applyAndTrack(op, `Move ${node.name}`);

  // Send to server (existing mutation — server compat during transition)
  client
    .mutation(gql(SET_TRANSFORM_MUTATION), { uuid, transform: { ...transform } })
    .toPromise()
    .then((r) => {
      if (r.error) {
        console.error("setTransform error:", r.error.message);
        // Revert via undo (removes the operation from history too)
        history.undo();
      }
    })
    .catch((err: unknown) => {
      console.error("setTransform exception:", err);
      history.undo();
    });
}
```

- [ ] **Step 4: Refactor renameNode, setVisible, setLocked following same pattern**

Each follows the identical structure as setTransform but with different path and value types:

- `renameNode`: path `"name"`, value is `newName`, previousValue is `node.name`
- `setVisible`: path `"visible"`, value is `visible`, previousValue is `node.visible`
- `setLocked`: path `"locked"`, value is `locked`, previousValue is `node.locked`

- [ ] **Step 5: Refactor setOpacity, setBlendMode, setCornerRadii**

Style-based mutations use nested paths:

- `setOpacity`: path `"style.opacity"`, value is `{ type: "literal", value: opacity }`, previousValue is `deepClone(node.style.opacity)`
- `setBlendMode`: path `"style.blend_mode"`, value is `blendMode`, previousValue is `node.style.blend_mode`
- `setCornerRadii`: path `"kind"`, value is `{ ...node.kind, corner_radii: radii }`, previousValue is `deepClone(node.kind)`

Retain the validation guards at the top of each method (finite checks, range checks).

- [ ] **Step 6: Run all tests**

```bash
pnpm --prefix frontend test -- --run
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/store/document-store-solid.tsx frontend/src/store/__tests__/mutation-operations.test.ts
git commit -m "feat(frontend): refactor simple field mutations to emit Operations (Plan 15c, Task 3)"
```

---

## Task 4: Refactor Debounced Style Mutations (setFills, setStrokes, setEffects)

**Files:**
- Modify: `frontend/src/store/document-store-solid.tsx`
- Modify: `frontend/src/store/__tests__/mutation-operations.test.ts`

These three mutations currently use manual debounce timers to batch rapid changes (e.g., dragging a color picker). The debounce pattern is replaced by drag coalescing via the HistoryManager. The caller (panel component) will call `beginDrag` on pointerdown and `commitDrag` on pointerup. For non-drag changes (clicking a swatch), the mutation is a discrete operation.

**Key design decision:** The store methods `setFills`, `setStrokes`, `setEffects` themselves become simple discrete mutations (like Task 3). The drag coalescing responsibility moves to the calling component. This is correct because the store method doesn't know whether the caller is dragging or clicking -- that context belongs to the UI layer.

- [ ] **Step 1: Add tests for discrete fills/strokes/effects operations**

Add to `mutation-operations.test.ts`:

```typescript
describe("setFills — operation tracking", () => {
  it("creates a set_field operation with path style.fills", () => {
    // Setup store with node, call setFills, verify operation shape
  });

  it("tracks in HistoryManager and can undo", () => {
    // Call setFills, verify canUndo, call undo, verify previous fills restored
  });
});

// Same structure for setStrokes and setEffects
```

- [ ] **Step 2: Refactor setFills**

Replace the debounced implementation with a clean operation-based version:

```typescript
function setFills(uuid: string, fills: Fill[]): void {
  const node = state.nodes[uuid];
  if (!node) return;

  let clonedFills: Fill[];
  try {
    clonedFills = deepClone(fills);
  } catch {
    console.error("setFills: failed to clone fills");
    return;
  }

  const previousFills = node.style?.fills ? deepClone(node.style.fills) : [];
  const op = createSetFieldOp(clientSessionId, uuid, "style.fills", clonedFills, previousFills);
  history.applyAndTrack(op, `Update fills on ${node.name}`);

  client
    .mutation(gql(SET_FILLS_MUTATION), { uuid, fills: clonedFills })
    .toPromise()
    .then((r) => {
      if (r.error) {
        console.error("setFills error:", r.error.message);
        history.undo();
      }
    })
    .catch((err: unknown) => {
      console.error("setFills exception:", err);
      history.undo();
    });
}
```

- [ ] **Step 3: Refactor setStrokes and setEffects following same pattern**

Identical to setFills but with `"style.strokes"` and `"style.effects"` paths respectively.

- [ ] **Step 4: Remove debounce timer variables and cleanup**

Remove from `createDocumentStoreSolid()`:
- `fillsMutationTimer`, `fillsRollbackSnapshot`
- `strokesMutationTimer`, `strokesRollbackSnapshot`
- `effectsMutationTimer`, `effectsRollbackSnapshot`

Remove the timer cleanup from `destroy()`.

- [ ] **Step 5: Run all tests**

```bash
pnpm --prefix frontend test -- --run
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/document-store-solid.tsx frontend/src/store/__tests__/mutation-operations.test.ts
git commit -m "feat(frontend): refactor debounced style mutations to discrete Operations (Plan 15c, Task 4)"
```

---

## Task 5: Refactor Structural Mutations (createNode, deleteNode, reparentNode, reorderChildren)

**Files:**
- Modify: `frontend/src/store/document-store-solid.tsx`
- Modify: `frontend/src/store/__tests__/mutation-operations.test.ts`

These mutations use structural operation types (`create_node`, `delete_node`, `reparent`, `reorder`) instead of `set_field`. They require special handling for previousValue capture and optimistic UUID replacement.

- [ ] **Step 1: Add tests for structural operation tracking**

Add to `mutation-operations.test.ts`:

```typescript
describe("createNode — operation tracking", () => {
  it("creates a create_node operation with full node data as value", () => {});
  it("tracks in HistoryManager — undo removes the node", () => {});
  it("handles server UUID replacement by updating the operation", () => {});
});

describe("deleteNode — operation tracking", () => {
  it("creates a delete_node operation with full node snapshot as previousValue", () => {});
  it("tracks in HistoryManager — undo restores the node", () => {});
  it("clears selection if deleted node was selected", () => {});
});

describe("reparentNode — operation tracking", () => {
  it("creates a reparent operation with old and new parent info", () => {});
  it("tracks in HistoryManager — undo restores original parent", () => {});
});

describe("reorderChildren — operation tracking", () => {
  it("creates a reorder operation with old and new positions", () => {});
  it("tracks in HistoryManager — undo restores original position", () => {});
});
```

- [ ] **Step 2: Refactor createNode**

```typescript
function createNode(kind: NodeKind, name: string, transform: Transform): string {
  const optimisticUuid = crypto.randomUUID();
  const pageId = state.pages[0]?.id ?? null;

  const nodeData = {
    uuid: optimisticUuid,
    kind,
    name: name.slice(0, MAX_NODE_NAME_LENGTH),
    transform,
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal" as const, value: 1 },
      blend_mode: "normal" as const,
      effects: [],
    },
    visible: true,
    locked: false,
    parentUuid: null,
    childrenUuids: [],
  };

  const op = createCreateNodeOp(clientSessionId, nodeData);
  history.applyAndTrack(op, `Create ${name}`);

  client
    .mutation(gql(CREATE_NODE_MUTATION), {
      kind: deepClone(kind),
      name,
      pageId,
      transform: deepClone(transform),
    })
    .toPromise()
    .then((result) => {
      if (result.error) {
        console.error("createNode error:", result.error.message);
        history.undo();
        const filteredAfterError = selectedNodeIds().filter((id) => id !== optimisticUuid);
        if (filteredAfterError.length !== selectedNodeIds().length) {
          setSelectedNodeIds(filteredAfterError);
        }
        return;
      }
      const serverUuid = result.data?.createNode?.uuid as string | undefined;
      if (serverUuid && serverUuid !== optimisticUuid) {
        // Replace optimistic with server version
        batch(() => {
          const node = state.nodes[optimisticUuid];
          if (node) {
            setState(
              produce((s) => {
                Reflect.deleteProperty(s.nodes, optimisticUuid);
                s.nodes[serverUuid] = { ...node, uuid: serverUuid };
              }),
            );
          }
          if (selectedNodeIds().includes(optimisticUuid)) {
            setSelectedNodeIds(
              selectedNodeIds().map((id) => (id === optimisticUuid ? serverUuid : id)),
            );
          }
        });
      }
    })
    .catch((err: unknown) => {
      console.error("createNode exception:", err);
      history.undo();
      const filteredAfterCatch = selectedNodeIds().filter((id) => id !== optimisticUuid);
      if (filteredAfterCatch.length !== selectedNodeIds().length) {
        setSelectedNodeIds(filteredAfterCatch);
      }
    });

  return optimisticUuid;
}
```

- [ ] **Step 3: Refactor deleteNode**

```typescript
function deleteNode(uuid: string): void {
  const node = state.nodes[uuid];
  if (!node) return;

  const previousNode = deepClone(node);
  const previousSelectedId = selectedNodeId();

  const op = createDeleteNodeOp(clientSessionId, uuid, previousNode);
  history.applyAndTrack(op, `Delete ${node.name}`);

  // Clear selection if the deleted node was selected
  const filteredIds = selectedNodeIds().filter((id) => id !== uuid);
  if (filteredIds.length !== selectedNodeIds().length) {
    setSelectedNodeIds(filteredIds);
  }

  client
    .mutation(gql(DELETE_NODE_MUTATION), { uuid })
    .toPromise()
    .then((r) => {
      if (r.error) {
        console.error("deleteNode error:", r.error.message);
        history.undo();
        if (previousSelectedId === uuid) {
          setSelectedNodeId(previousSelectedId);
        }
      }
    })
    .catch((err: unknown) => {
      console.error("deleteNode exception:", err);
      history.undo();
      if (previousSelectedId === uuid) {
        setSelectedNodeId(previousSelectedId);
      }
    });
}
```

- [ ] **Step 4: Refactor reparentNode and reorderChildren**

`reparentNode`:
```typescript
function reparentNode(uuid: string, newParentUuid: string, position: number): void {
  if (!Number.isFinite(position)) return;
  const node = state.nodes[uuid];
  if (!node) return;

  const oldParentUuid = node.parentUuid;
  const clampedPos = Math.max(0, Math.round(position));

  // Determine old position within old parent
  const oldPosition = oldParentUuid
    ? (state.nodes[oldParentUuid]?.childrenUuids ?? []).indexOf(uuid)
    : 0;

  const op = createReparentOp(
    clientSessionId,
    uuid,
    { parentUuid: newParentUuid, position: clampedPos },
    { parentUuid: oldParentUuid ?? "", position: Math.max(0, oldPosition) },
  );
  history.applyAndTrack(op, `Move ${node.name}`);

  client
    .mutation(gql(REPARENT_NODE_MUTATION), { uuid, newParentUuid, position: clampedPos })
    .toPromise()
    .then((r) => {
      if (r.error) {
        console.error("reparentNode error:", r.error.message);
        history.undo();
      }
    })
    .catch((err: unknown) => {
      console.error("reparentNode exception:", err);
      history.undo();
    });
}
```

`reorderChildren` follows the same pattern with `createReorderOp`.

- [ ] **Step 5: Run all tests**

```bash
pnpm --prefix frontend test -- --run
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/document-store-solid.tsx frontend/src/store/__tests__/mutation-operations.test.ts
git commit -m "feat(frontend): refactor structural mutations to emit Operations (Plan 15c, Task 5)"
```

---

## Task 6: Refactor Multi-Node Mutations (batchSetTransform, groupNodes, ungroupNodes)

**Files:**
- Modify: `frontend/src/store/document-store-solid.tsx`
- Modify: `frontend/src/store/__tests__/mutation-operations.test.ts`

These are compound operations that affect multiple nodes. `batchSetTransform` wraps multiple set_field operations in a single transaction. `groupNodes` and `ungroupNodes` are complex structural operations that currently lack optimistic updates.

- [ ] **Step 1: Add tests**

```typescript
describe("batchSetTransform — transaction tracking", () => {
  it("wraps N transforms in a single transaction", () => {});
  it("single undo reverts all transforms", () => {});
});

describe("groupNodes — operation tracking", () => {
  it("tracks group creation for undo", () => {});
});

describe("ungroupNodes — operation tracking", () => {
  it("tracks ungroup for undo", () => {});
});
```

- [ ] **Step 2: Refactor batchSetTransform to use transactions**

```typescript
function batchSetTransform(entries: Array<{ uuid: string; transform: Transform }>): void {
  history.beginTransaction(`Align ${String(entries.length)} nodes`);

  for (const entry of entries) {
    const node = state.nodes[entry.uuid];
    if (!node) continue;
    const previous = deepClone(node.transform);
    const op = createSetFieldOp(clientSessionId, entry.uuid, "transform", entry.transform, previous);
    history.applyInTransaction(op);
  }

  history.commitTransaction();

  // Send batch to server
  client
    .mutation(gql(BATCH_SET_TRANSFORM_MUTATION), {
      entries: entries.map((e) => ({ uuid: e.uuid, transform: { ...e.transform } })),
    })
    .toPromise()
    .then((r) => {
      if (r.error) {
        console.error("batchSetTransform error:", r.error.message);
        history.undo();
      } else {
        // Reconcile with server-canonical values
        const data = r.data as Record<string, unknown> | undefined;
        const results = data?.batchSetTransform as Array<Record<string, unknown>> | undefined;
        if (results) {
          batch(() => {
            for (const node of results) {
              const uuid = node.uuid as string;
              const transform = node.transform as Transform | undefined;
              if (uuid && transform && state.nodes[uuid]) {
                setState("nodes", uuid, "transform", transform);
              }
            }
          });
        }
      }
    })
    .catch((err: unknown) => {
      console.error("batchSetTransform exception:", err);
      history.undo();
    });
}
```

- [ ] **Step 3: Refactor groupNodes and ungroupNodes**

`groupNodes` and `ungroupNodes` currently lack optimistic updates and rely on server response + refetch. For operation tracking, we record a minimal operation so undo can work:

```typescript
function groupNodes(uuids: string[], name: string): void {
  // NOTE: groupNodes cannot be fully optimistic because the server creates
  // the group node with a new UUID. We track a placeholder operation and
  // reconcile on server response. Full undo support deferred to Phase 15d
  // when the server accepts operation-based mutations.

  client
    .mutation(gql(GROUP_NODES_MUTATION), { uuids, name })
    .toPromise()
    .then((r) => {
      if (r.error) {
        console.error("groupNodes error:", r.error.message);
        return;
      }
      const data = r.data as Record<string, unknown> | undefined;
      const groupUuid = data?.groupNodes as string | undefined;
      if (groupUuid) {
        // After server response, refetch to get complete state, then track
        void fetchPages().then(() => {
          // Track a create_node operation for the group so undo knows about it
          const groupNode = state.nodes[groupUuid];
          if (groupNode) {
            const op = createCreateNodeOp(clientSessionId, deepClone(groupNode));
            history.applyAndTrack(op, `Group ${name}`);
          }
        });
        setSelectedNodeIds([groupUuid]);
      }
    })
    .catch((err: unknown) => {
      console.error("groupNodes exception:", err);
    });
}
```

`ungroupNodes` follows the same server-first pattern.

- [ ] **Step 4: Run all tests**

```bash
pnpm --prefix frontend test -- --run
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/document-store-solid.tsx frontend/src/store/__tests__/mutation-operations.test.ts
git commit -m "feat(frontend): refactor multi-node mutations to use transactions (Plan 15c, Task 6)"
```

---

## Task 7: Wire Undo/Redo to HistoryManager + Remove Server Undo

**Files:**
- Modify: `frontend/src/store/document-store-solid.tsx`
- Modify: `frontend/src/shell/Canvas.tsx`
- Modify: `frontend/src/graphql/mutations.ts`
- Create: `frontend/src/store/__tests__/undo-redo-integration.test.ts`

This is the critical cutover. Cmd+Z / Cmd+Shift+Z now call HistoryManager instead of sending UNDO_MUTATION to the server. The inverse transaction is applied locally (instant) and then sent to the server as normal forward operations.

- [ ] **Step 1: Write undo/redo integration tests**

Create `frontend/src/store/__tests__/undo-redo-integration.test.ts`:

```typescript
/**
 * Integration tests for the full undo/redo flow:
 * mutation → undo → redo, verifying store state at each step.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("undo/redo integration", () => {
  it("setTransform → undo restores previous transform → redo re-applies", () => {
    // 1. Set transform to new value
    // 2. Verify store has new value
    // 3. Call undo
    // 4. Verify store has previous value
    // 5. Call redo
    // 6. Verify store has new value again
  });

  it("renameNode → undo restores previous name", () => {});

  it("deleteNode → undo restores the node", () => {});

  it("batchSetTransform → single undo reverts all", () => {});

  it("multiple mutations → undo in reverse order", () => {
    // setTransform, renameNode, setVisible
    // undo → visible reverts
    // undo → name reverts
    // undo → transform reverts
  });

  it("undo clears redo stack on new mutation", () => {
    // mutate, undo, mutate again
    // redo should be empty
  });
});
```

- [ ] **Step 2: Rewrite undo() and redo() in store**

```typescript
function undo(): void {
  const inverseTx = history.undo();
  if (!inverseTx) return;

  // Send inverse operations to server (each operation maps to its corresponding mutation)
  sendTransactionToServer(inverseTx);
}

function redo(): void {
  const redoTx = history.redo();
  if (!redoTx) return;

  // Send redo operations to server
  sendTransactionToServer(redoTx);
}
```

- [ ] **Step 3: Implement sendTransactionToServer helper**

This function maps each operation in a transaction to the appropriate existing GraphQL mutation. During the transition period (before Phase 15d), we reuse the existing per-mutation GraphQL strings:

```typescript
/**
 * Send a transaction's operations to the server using existing GraphQL mutations.
 *
 * During the 15c→15d transition, the server still expects individual mutations.
 * This function maps each operation back to the appropriate mutation.
 * In Phase 15d, this will be replaced with a single APPLY_OPERATIONS_MUTATION.
 */
function sendTransactionToServer(tx: Transaction): void {
  for (const op of tx.operations) {
    sendOperationToServer(op);
  }
}

function sendOperationToServer(op: Operation): void {
  switch (op.type) {
    case "set_field":
      sendSetFieldToServer(op);
      break;
    case "create_node": {
      const nodeData = op.value as Record<string, unknown>;
      client
        .mutation(gql(CREATE_NODE_MUTATION), {
          kind: deepClone(nodeData["kind"]),
          name: nodeData["name"],
          pageId: state.pages[0]?.id ?? null,
          transform: deepClone(nodeData["transform"]),
        })
        .toPromise()
        .catch((err: unknown) => console.error("sendOperationToServer create_node:", err));
      break;
    }
    case "delete_node":
      client
        .mutation(gql(DELETE_NODE_MUTATION), { uuid: op.nodeUuid })
        .toPromise()
        .catch((err: unknown) => console.error("sendOperationToServer delete_node:", err));
      break;
    case "reparent": {
      const rv = op.value as ReparentValue;
      client
        .mutation(gql(REPARENT_NODE_MUTATION), {
          uuid: op.nodeUuid,
          newParentUuid: rv.parentUuid,
          position: rv.position,
        })
        .toPromise()
        .catch((err: unknown) => console.error("sendOperationToServer reparent:", err));
      break;
    }
    case "reorder": {
      const reorder = op.value as ReorderValue;
      client
        .mutation(gql(REORDER_CHILDREN_MUTATION), {
          uuid: op.nodeUuid,
          newPosition: reorder.newPosition,
        })
        .toPromise()
        .catch((err: unknown) => console.error("sendOperationToServer reorder:", err));
      break;
    }
  }
}

function sendSetFieldToServer(op: Operation): void {
  const { nodeUuid, path, value } = op;

  switch (path) {
    case "transform":
      client.mutation(gql(SET_TRANSFORM_MUTATION), { uuid: nodeUuid, transform: deepClone(value) }).toPromise()
        .catch((err: unknown) => console.error("sendSetField transform:", err));
      break;
    case "name":
      client.mutation(gql(RENAME_NODE_MUTATION), { uuid: nodeUuid, newName: value as string }).toPromise()
        .catch((err: unknown) => console.error("sendSetField name:", err));
      break;
    case "visible":
      client.mutation(gql(SET_VISIBLE_MUTATION), { uuid: nodeUuid, visible: value as boolean }).toPromise()
        .catch((err: unknown) => console.error("sendSetField visible:", err));
      break;
    case "locked":
      client.mutation(gql(SET_LOCKED_MUTATION), { uuid: nodeUuid, locked: value as boolean }).toPromise()
        .catch((err: unknown) => console.error("sendSetField locked:", err));
      break;
    case "style.opacity": {
      const opVal = value as { type: string; value: number };
      client.mutation(gql(SET_OPACITY_MUTATION), { uuid: nodeUuid, opacity: opVal.value }).toPromise()
        .catch((err: unknown) => console.error("sendSetField opacity:", err));
      break;
    }
    case "style.blend_mode":
      client.mutation(gql(SET_BLEND_MODE_MUTATION), { uuid: nodeUuid, blendMode: value as string }).toPromise()
        .catch((err: unknown) => console.error("sendSetField blend_mode:", err));
      break;
    case "style.fills":
      client.mutation(gql(SET_FILLS_MUTATION), { uuid: nodeUuid, fills: deepClone(value) }).toPromise()
        .catch((err: unknown) => console.error("sendSetField fills:", err));
      break;
    case "style.strokes":
      client.mutation(gql(SET_STROKES_MUTATION), { uuid: nodeUuid, strokes: deepClone(value) }).toPromise()
        .catch((err: unknown) => console.error("sendSetField strokes:", err));
      break;
    case "style.effects":
      client.mutation(gql(SET_EFFECTS_MUTATION), { uuid: nodeUuid, effects: deepClone(value) }).toPromise()
        .catch((err: unknown) => console.error("sendSetField effects:", err));
      break;
    case "kind":
      // For corner radii changes on rectangles
      if (value && typeof value === "object" && "corner_radii" in (value as Record<string, unknown>)) {
        const radii = (value as Record<string, unknown>)["corner_radii"] as [number, number, number, number];
        client.mutation(gql(SET_CORNER_RADII_MUTATION), { uuid: nodeUuid, radii: [...radii] }).toPromise()
          .catch((err: unknown) => console.error("sendSetField kind:", err));
      }
      break;
  }
}
```

- [ ] **Step 4: Remove UNDO_MUTATION and REDO_MUTATION**

In `frontend/src/graphql/mutations.ts`, remove:
```typescript
export const UNDO_MUTATION = `...`;
export const REDO_MUTATION = `...`;
```

In `frontend/src/store/document-store-solid.tsx`, remove the imports of `UNDO_MUTATION` and `REDO_MUTATION`.

- [ ] **Step 5: Canvas.tsx already works -- verify**

The Canvas.tsx keyboard handlers call `store.undo()` and `store.redo()`. Since we changed the implementation of those methods in the store (from server-call to HistoryManager), Canvas.tsx needs no changes. The interface is unchanged.

Verify by running the Canvas tests if any exist, and manually confirming the keyboard handler code at lines 290-306 of Canvas.tsx still calls `store.undo()` / `store.redo()`.

- [ ] **Step 6: Remove can_undo / can_redo from DOCUMENT_QUERY**

In `frontend/src/graphql/queries.ts`, remove `canUndo` and `canRedo` from the `DOCUMENT_QUERY` (the server still exposes them, but the frontend no longer reads them).

- [ ] **Step 7: Run all tests**

```bash
pnpm --prefix frontend test -- --run
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/store/document-store-solid.tsx frontend/src/shell/Canvas.tsx frontend/src/graphql/mutations.ts frontend/src/graphql/queries.ts frontend/src/store/__tests__/undo-redo-integration.test.ts
git commit -m "feat(frontend): wire undo/redo to HistoryManager, remove server UNDO/REDO (Plan 15c, Task 7)"
```

---

## Task 8: Drag Coalescing in Select Tool + ToolStore Interface Update

**Files:**
- Modify: `frontend/src/store/document-store-types.ts`
- Modify: `frontend/src/store/document-store-solid.tsx`
- Modify: `frontend/src/shell/Canvas.tsx`
- Modify: `frontend/src/tools/select-tool.ts`
- Modify: `frontend/src/tools/__tests__/select-tool.test.ts` (if exists)
- Create: `frontend/src/tools/__tests__/select-tool-drag-coalescing.test.ts`

The select tool currently sends a single `setTransform` on pointerup. With drag coalescing, the tool must call `beginDrag` on pointerdown, apply the transform locally on each pointermove (via `applyOperationToStore` for instant feedback), and `commitDrag` on pointerup. This ensures the entire drag is a single undo step, and only the final transform is sent to the server.

- [ ] **Step 1: Update ToolStore interface**

Add drag lifecycle methods to `frontend/src/store/document-store-types.ts`:

```typescript
export interface ToolStore {
  getAllNodes(): ReadonlyMap<string, DocumentNode>;
  select(uuid: string | null): void;
  setTransform(uuid: string, transform: Transform): void;
  createNode(kind: NodeKind, name: string, transform: Transform): string;
  getSelectedNodeId(): string | null;
  getViewportZoom(): number;

  // Drag coalescing for undo support
  beginDrag(nodeUuid: string, path: string): void;
  updateDragTransform(nodeUuid: string, transform: Transform, originalTransform: Transform): void;
  commitDrag(): void;
  cancelDrag(): void;
}
```

- [ ] **Step 2: Implement drag methods in store factory**

Add to `createDocumentStoreSolid()`:

```typescript
function beginDrag(nodeUuid: string, path: string): void {
  history.beginDrag(nodeUuid, path);
}

function updateDragTransform(
  nodeUuid: string,
  transform: Transform,
  originalTransform: Transform,
): void {
  const op = createSetFieldOp(clientSessionId, nodeUuid, "transform", transform, originalTransform);
  history.updateDrag(op);
  // Apply locally for instant visual feedback (applyOperationToStore handles this)
  setState("nodes", nodeUuid, "transform", transform);
}

function commitDrag(): void {
  history.commitDrag();
  // Send the final transform to the server
  // The HistoryManager has the coalesced operation; we send the current store value
  // This is handled by the select-tool calling setTransform on pointerup
}

function cancelDrag(): void {
  history.cancelDrag();
}
```

Add these to the returned API object and the `DocumentStoreAPI` interface.

- [ ] **Step 3: Update Canvas.tsx store adapter**

Add the new methods to the `createStoreAdapter` function:

```typescript
beginDrag(nodeUuid: string, path: string): void {
  store.beginDrag(nodeUuid, path);
},
updateDragTransform(nodeUuid: string, transform: Transform, originalTransform: Transform): void {
  store.updateDragTransform(nodeUuid, transform, originalTransform);
},
commitDrag(): void {
  store.commitDrag();
},
cancelDrag(): void {
  store.cancelDrag();
},
```

- [ ] **Step 4: Refactor select-tool.ts to use drag coalescing**

Modify the select tool's state machine:

**onPointerDown** (when starting a move or resize):
```typescript
// After entering "moving" or "resizing" state:
store.beginDrag(state.draggedUuid, "transform");
```

**onPointerMove** (during move/resize):
```typescript
// Instead of just setting previewTransform, also update the store:
store.updateDragTransform(state.draggedUuid, snapResult.snappedTransform, state.originalTransform);
previewTransform = { uuid: state.draggedUuid, transform: snapResult.snappedTransform };
```

**onPointerUp**:
```typescript
if ((state.kind === "moving" || state.kind === "resizing") && previewTransform !== null) {
  // Commit the drag (creates the undo step)
  store.commitDrag();
  // Send final transform to server
  store.setTransform(state.draggedUuid, previewTransform.transform);
}
```

**onKeyDown (Escape)**:
```typescript
if (key === "Escape" && state.kind !== "idle") {
  store.cancelDrag();
  // Restore original transform
  if (state.kind === "moving" || state.kind === "resizing") {
    store.setTransform(state.draggedUuid, state.originalTransform);
  }
  state = { kind: "idle" };
  previewTransform = null;
  snapGuides = [];
}
```

**IMPORTANT:** The `setTransform` call on pointerup now only sends to server (the local state was already updated during the drag via `updateDragTransform`). However, since the commitDrag already committed the undo step, the setTransform call should NOT create another undo step. To handle this, add a `skipHistory` parameter to `setTransform`:

```typescript
function setTransform(uuid: string, transform: Transform, skipHistory = false): void {
  const node = state.nodes[uuid];
  if (!node) return;

  if (skipHistory) {
    // Just send to server, don't track (drag already tracked via commitDrag)
    setState("nodes", uuid, "transform", transform);
    sendSetFieldToServer({
      id: crypto.randomUUID(), userId: clientSessionId, nodeUuid: uuid,
      type: "set_field", path: "transform", value: transform, previousValue: null, seq: 0,
    });
    return;
  }

  // ... existing operation-based implementation
}
```

Or, more cleanly: have `commitDrag` return the final operation and send it to the server directly, removing the need for a separate `setTransform` call on pointerup. The select tool changes to:

```typescript
onPointerUp(_event: ToolEvent): void {
  if ((state.kind === "moving" || state.kind === "resizing") && previewTransform !== null) {
    store.commitDrag();
    // Server send happens inside commitDrag
  }
  state = { kind: "idle" };
  // ...
}
```

And `commitDrag` in the store sends the final coalesced operation to the server.

- [ ] **Step 5: Write drag coalescing tests**

Create `frontend/src/tools/__tests__/select-tool-drag-coalescing.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

describe("select-tool drag coalescing", () => {
  it("calls beginDrag on pointerdown on a node", () => {});
  it("calls updateDragTransform on each pointermove", () => {});
  it("calls commitDrag on pointerup", () => {});
  it("calls cancelDrag on Escape during drag", () => {});
  it("entire drag sequence creates exactly one undo step", () => {});
});
```

- [ ] **Step 6: Run all tests**

```bash
pnpm --prefix frontend test -- --run
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/store/document-store-types.ts frontend/src/store/document-store-solid.tsx frontend/src/shell/Canvas.tsx frontend/src/tools/select-tool.ts frontend/src/tools/__tests__/select-tool-drag-coalescing.test.ts
git commit -m "feat(frontend): add drag coalescing in select tool via HistoryManager (Plan 15c, Task 8)"
```

---

## Verification Checklist

After all 8 tasks are complete:

- [ ] All 18 store mutation methods create Operations
- [ ] Every operation is tracked in HistoryManager
- [ ] Cmd+Z / Cmd+Shift+Z / Cmd+Y work via HistoryManager (no server round-trip for visual feedback)
- [ ] Drag operations (move, resize) coalesce into a single undo step
- [ ] `batchSetTransform` uses transactions (single undo step for N transforms)
- [ ] `UNDO_MUTATION` and `REDO_MUTATION` are removed
- [ ] `canUndo` / `canRedo` derived from HistoryManager, not server `DocumentInfo`
- [ ] Debounce timers for fills/strokes/effects are removed
- [ ] All existing tests pass
- [ ] New tests cover operation creation, undo/redo, drag coalescing
- [ ] Server still receives individual mutations (backward compatible)
- [ ] Type check passes: `pnpm --prefix frontend exec tsc --noEmit`
- [ ] Lint passes: `pnpm --prefix frontend lint`
- [ ] Format passes: `pnpm --prefix frontend format:check`

---

### Critical Files for Implementation
- `/Volumes/projects/Personal/agent-designer/frontend/src/store/document-store-solid.tsx` - Core file: all 18 mutation methods must be rewritten to emit Operations
- `/Volumes/projects/Personal/agent-designer/frontend/src/operations/apply-to-store.ts` - New file: the single function translating Operations into Solid setState calls
- `/Volumes/projects/Personal/agent-designer/frontend/src/operations/store-history.ts` - New file: bridge composing HistoryManager + applyOperationToStore
- `/Volumes/projects/Personal/agent-designer/frontend/src/tools/select-tool.ts` - Drag coalescing: beginDrag/updateDrag/commitDrag integration
- `/Volumes/projects/Personal/agent-designer/frontend/src/store/document-store-types.ts` - Interface update: add drag lifecycle methods to ToolStore