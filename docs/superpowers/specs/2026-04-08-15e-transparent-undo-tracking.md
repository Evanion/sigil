# Spec 15e — Transparent Undo Tracking

## Overview

Replaces the explicit undo wiring from Plan 15c (where every mutation calls `createSetFieldOp` + `history.applyAndTrack`) with a transparent interceptor that automatically captures document state changes and records undo steps. Mutations do not know about undo. Adds a generic `applyOperations` GraphQL endpoint replacing all 16+ individual mutations.

**Depends on:** Spec 15 (phases 15a, 15b, 15d completed), Spec 08 (Solid store)

**Replaces:** Plan 15c's store-history integration approach (StoreHistoryBridge, explicit Operation creation in mutations, beginDrag/commitDrag)

---

## 1. Problem Statement

The current Plan 15c implementation has fundamental coupling issues:

1. **Every mutation explicitly wires into the history system.** All 18 mutations call `createSetFieldOp` + `history.applyAndTrack`. Adding a new mutation requires remembering to add undo wiring.
2. **Color picker floods the undo stack.** Each `setFills` call creates a discrete undo entry. The user must press Cmd+Z dozens of times to revert one color change.
3. **Drag coalescing requires explicit lifecycle calls.** `beginDrag`/`updateDrag`/`commitDrag` must be wired in UI components, breaking the transparency principle.
4. **16+ individual GraphQL mutations** require a mapping function (`sendSetFieldToServer`) to route undo operations back to the right endpoint.

## 2. Design Principles

- **Mutations must not know about undo.** They call `setState` and send to the server. Period.
- **Tools must not know about undo.** No `beginDrag`/`commitDrag` calls.
- **One user action = one undo step.** Idle coalescing groups rapid changes automatically.
- **Structural mutations register explicitly.** Create/delete/reparent/reorder call a lightweight `trackStructural(op)` — the only concession to transparency (~4 call sites vs current 18+).
- **One server endpoint.** `applyOperations` replaces all individual mutations.

## 3. Architecture

### 3.1 Three Layers

```
┌─────────────────────────────────────────────────┐
│ Mutation                                        │
│   setState("nodes", uuid, "transform", value)   │
│   applyOperations([...])  → server              │
└──────────────────┬──────────────────────────────┘
                   │ (intercepted)
┌──────────────────▼──────────────────────────────┐
│ Interceptor                                     │
│   • captures before/after for document state    │
│   • buffers changes                             │
│   • idle coalescing (rAF)                       │
│   • commits buffer → HistoryManager             │
│   • ignores writes during undo/redo             │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│ HistoryManager                                  │
│   • undo/redo stacks of Transactions            │
│   • IndexedDB persistence                       │
│   • canUndo/canRedo reactive signals            │
└─────────────────────────────────────────────────┘
```

### 3.2 Interceptor

Wraps the Solid `setState` function. Watches writes to `state.nodes` and `state.pages` (document state). Ignores writes to UI-only state (`state.info`).

**Field changes** (automatic): When `setState("nodes", uuid, field, value)` is called, the interceptor:
1. Reads the current value at that path (the "before" snapshot)
2. Passes the `setState` call through to Solid (store updates immediately)
3. Buffers `{nodeUuid, path, before, after}` in the current frame

**Structural changes** (explicit): Create/delete/reparent/reorder mutations call `interceptor.trackStructural(op)` after modifying the store. The interceptor adds the operation to the current buffer.

### 3.3 Idle Coalescing

- **First write** to a node+field: snapshot the "before" value, start buffering
- **Subsequent writes** to the same node+field: update only the "after" value (before stays from first write)
- **Idle detection**: schedule a `requestAnimationFrame` callback on first write. If no new writes arrive before the callback fires, commit the buffer as one Transaction to HistoryManager.
- **Reset on new write**: if a new write arrives before the rAF fires, cancel and reschedule. This extends the coalesce window for continuous interactions (color picker drag, slider drag).
- **All changes in one buffer** become one Transaction — handles multi-node align naturally since all writes happen synchronously before the rAF fires.

### 3.4 Side-Effect Context

When committing an undo step, the interceptor also snapshots:
- `selectedNodeIds` — current selection
- `activeTool` — current tool
- `viewport` — current pan/zoom

These are NOT undo steps on their own. They are restored as side effects when undoing/redoing a document change (Figma behavior).

### 3.5 Undo/Redo Data Flow

**Undo (Cmd+Z):**
1. If the interceptor has an uncommitted buffer, force-flush it first (commit as undo step)
2. `HistoryManager.undo()` returns the inverse Transaction
3. Set an `isUndoing` flag so the interceptor ignores the following writes
4. Apply inverse operations to the store via `applyOperationToStore`
5. Restore side-effect context (selection, tool, viewport)
6. Clear `isUndoing` flag
7. Send inverse operations to server via `applyOperations`
8. Update canUndo/canRedo reactive signals

**Redo (Cmd+Shift+Z):** Same flow with `HistoryManager.redo()`.

## 4. `applyOperations` Endpoint

### 4.1 GraphQL Schema

Uses `@oneOf` input types for type-safe discriminated unions (async-graphql's `#[derive(OneofObject)]`):

```graphql
mutation ApplyOperations($operations: [OperationInput!]!, $userId: String!) {
  applyOperations(operations: $operations, userId: $userId) {
    seq
  }
}

input OperationInput @oneOf {
  setField: SetFieldInput
  createNode: CreateNodeInput
  deleteNode: DeleteNodeInput
  reparent: ReparentInput
  reorder: ReorderInput
}

input SetFieldInput {
  nodeUuid: String!
  path: String!          # "transform", "style.fills", "name", "visible", etc.
  value: JSON!
}

input CreateNodeInput {
  nodeUuid: String!
  kind: JSON!
  name: String!
  transform: JSON!
  pageId: String
}

input DeleteNodeInput {
  nodeUuid: String!
}

input ReparentInput {
  nodeUuid: String!
  newParentUuid: String!
  position: Int!
}

input ReorderInput {
  nodeUuid: String!
  newPosition: Int!
}
```

### 4.2 Server Implementation (Rust)

```rust
#[derive(OneofObject)]
enum OperationInput {
    SetField(SetFieldInput),
    CreateNode(CreateNodeInput),
    DeleteNode(DeleteNodeInput),
    Reparent(ReparentInput),
    Reorder(ReorderInput),
}
```

The server matches on enum variants directly — no stringly-typed dispatch.

The endpoint:
1. Acquires the document write lock
2. For each `OperationInput` variant, constructs the appropriate `FieldOperation` struct
3. Validates all operations first (reject entire batch if any fail)
4. Applies all operations
5. Increments sequence counter
6. Broadcasts the Transaction to other clients via `publish_transaction`
7. Persists (signal_dirty)
8. Returns `{seq}`

**Variant→FieldOperation mapping:**
| OperationInput variant | FieldOperation | path dispatch |
|----------------------|---------------|---------------|
| SetField | SetTransform, RenameNode, SetVisible, SetLocked, SetFills, SetStrokes, SetEffects, SetOpacity, SetBlendMode, SetCornerRadii | by `path` field |
| CreateNode | CreateNode | — |
| DeleteNode | DeleteNode | — |
| Reparent | ReparentNode | — |
| Reorder | ReorderChildren | — |

Only `SetField` requires secondary dispatch on `path`. All other variants map 1:1 to a `FieldOperation`.

### 4.3 Replaces

All 16+ individual GraphQL mutations are deleted:
- `setTransform`, `renameNode`, `setFills`, `setStrokes`, `setEffects`, `setOpacity`, `setBlendMode`, `setCornerRadii`, `setVisible`, `setLocked`, `reparentNode`, `reorderChildren`, `createNode`, `deleteNode`, `batchSetTransform`, `groupNodes`, `ungroupNodes`

`groupNodes` and `ungroupNodes` become client-side logic that computes individual operations (create + reparent + transform adjust for group; reparent + delete for ungroup) and sends them in one `applyOperations` call.

## 5. Mutation Refactor

### 5.1 Field Mutations (Transparent)

```typescript
// BEFORE (15c — explicit history wiring):
function setFills(uuid: string, fills: Fill[]): void {
  const node = state.nodes[uuid];
  if (!node) return;
  const previousFills = deepClone(node.style.fills);
  const op = createSetFieldOp(clientSessionId, uuid, "style.fills", fills, previousFills);
  history.applyAndTrack(op, `Update fills`);
  client.mutation(SET_FILLS_MUTATION, { uuid, fills, userId })...
}

// AFTER (15e — transparent):
function setFills(uuid: string, fills: Fill[]): void {
  const node = state.nodes[uuid];
  if (!node) return;
  setState("nodes", uuid, "style", "fills", deepClone(fills));
  sendOps([{ setField: { nodeUuid: uuid, path: "style.fills", value: fills } }]);
}
```

### 5.2 Structural Mutations (Lightweight Registration)

```typescript
// Create node — registers the structural operation
function createNode(kind: NodeKind, name: string, transform: Transform): string {
  const uuid = crypto.randomUUID();
  const nodeData = { uuid, kind, name, transform, ... };
  setState("nodes", uuid, nodeData);           // interceptor sees this as a field add
  interceptor.trackStructural({                // explicit: "this was a create"
    type: "create_node", nodeUuid: uuid, value: nodeData
  });
  sendOps([{ createNode: { nodeUuid: uuid, kind, name, transform, pageId } }]);
  return uuid;
}
```

### 5.3 Group/Ungroup (Client-Side Compound)

```typescript
function groupNodes(uuids: string[]): void {
  // Compute bounding box, create group, reparent children, adjust transforms
  // All via setState calls (intercepted automatically for field changes)
  // Structural ops registered via trackStructural
  // Send all operations in one applyOperations call
}
```

Group/ungroup logic moves from the server to the client. The server just processes the individual operations.

## 6. What Gets Removed

### From `document-store-solid.tsx`:
- All `createSetFieldOp` + `history.applyAndTrack` calls (18 mutations)
- All `deepClone` for before-value capture (interceptor handles this)
- `rollbackLast()` calls in error handlers (interceptor reverts on server error)
- `sendSetFieldToServer` / `sendOperationToServer` mapping functions
- `syncHistorySignals()` wrapper (interceptor updates signals on commit)
- `beginDrag`/`commitDrag`/`cancelDrag` from store API

### From `store-history.ts`:
- Entire file (`StoreHistoryBridge`) — replaced by interceptor

### From `history-manager.ts`:
- `beginDrag`/`updateDrag`/`commitDrag`/`cancelDrag` methods
- `beginTransaction`/`addOperation`/`commitTransaction`/`cancelTransaction` methods
- `popLastUndo` (rollbackLast) method
- Keep: `apply()`, `undo()`, `redo()`, `canUndo()`, `canRedo()`, persistence accessors

### From `document-store-types.ts` (ToolStore):
- `beginDrag`/`commitDrag`/`cancelDrag` methods

### From `select-tool.ts`:
- All `store.beginDrag()` / `store.commitDrag()` / `store.cancelDrag()` calls

### From server GraphQL:
- All 16+ individual mutation handlers — replaced by single `applyOperations`

### From `frontend/src/graphql/mutations.ts`:
- All individual mutation query strings — replaced by single `APPLY_OPERATIONS_MUTATION`

## 7. What Stays

- `HistoryManager` — undo/redo stack management (simplified API)
- `Operation` and `Transaction` types
- `applyOperationToStore` — used by undo/redo and remote transaction handler
- `applyRemoteTransaction` — subscription handler for other clients' changes
- `operation-helpers.ts` — `createInverse`, `createInverseTransaction`
- IndexedDB persistence layer (`history-store.ts`, `persistent-history-manager.ts`)
- `FieldOperation` trait and all command structs on the server (used by `applyOperations`)

## 8. Error Handling

- **Server rejection:** Interceptor has the "before" values in its buffer. On error, it applies them back to the store. The undo step is never committed — the failed operation never happened from the user's perspective.
- **Atomic batch:** `applyOperations` validates all operations before applying any. Partial failure is not possible.
- **Undo during active buffer:** Force-flush the buffer (commit it as an undo step) before processing the undo.

## 9. New Files

```
frontend/src/operations/
  interceptor.ts          — setState interceptor, idle coalescing, undo/redo coordination
  interceptor.test.ts     — unit tests for coalescing, undo, structural tracking
```

## 10. Testing Strategy

**Interceptor unit tests:**
- Single field write → one undo step after idle frame
- Rapid writes to same node+field → coalesced into one step
- Writes to different nodes in same synchronous call → one step
- Undo reverses the coalesced change
- Redo re-applies it
- Interceptor ignores writes during undo/redo
- Side-effect context captured and restored
- Force-flush on undo during active buffer
- Server error reverts optimistic state

**`applyOperations` endpoint tests:**
- Single set_field operation validates and applies
- Multiple operations atomic — one failure rejects all
- All path→FieldOperation mappings work
- Broadcasts transaction to other clients
- Returns sequence number

**Integration tests:**
- Create rectangle → undo removes it → redo restores it
- Rename → undo reverts name on client and server
- Rapid setFills (color picker simulation) → single Cmd+Z reverts to original
- Align 5 nodes → single Cmd+Z reverts all positions
- Remote client receives broadcast

## 11. Input Validation

- **OperationInput validation:** Server matches on `OneofObject` variant (type-safe — invalid variants are rejected by the GraphQL layer). For `SetField`, validates `path` is a known field path. Each variant's fields pass the corresponding `FieldOperation`'s validation.
- **Batch size:** Max 256 operations per call (reuse MAX_BATCH_SIZE).
- **Float validation:** All numeric values in `value` validated for NaN/Infinity.
- **Node existence:** Each operation's `nodeUuid` validated against the arena (except create_node).

## 12. Consistency Guarantees

- **Atomic batches:** All operations in one `applyOperations` call are validated then applied together. No partial state.
- **Coalesce integrity:** The interceptor's buffer always has valid before/after pairs. If the buffer is force-flushed, it produces a valid Transaction.
- **Undo isolation:** The `isUndoing` flag prevents the interceptor from recording undo/redo applications as new undo steps.

## 13. WASM Compatibility

No changes. The interceptor is frontend TypeScript. Server changes use the existing `FieldOperation` trait which is WASM-compatible.

## 14. Recursion Safety

No recursive algorithms. Buffer commit is a flat iteration. Server applies operations in a flat loop.

## 15. PDR Traceability

**Implements:**
- PDR §1.4 "Every operation must have undo/redo support — no exceptions" — transparently, without mutation awareness
- PDR §4.1 "Agents and humans see each other's changes in real time" — via `applyOperations` broadcast

**Defers:**
- Selective undo (undo a specific past operation) — research area
- Branching history — linear history is sufficient
