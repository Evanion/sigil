# Spec 15 — Undo/Redo System Redesign

## Overview

Replaces the current server-side global undo stack with client-side per-user undo via field-level operations and operation broadcast. Fixes the fundamental bug where undo doesn't update the UI, and builds the correct foundation for multi-user collaboration (human + agent now, hosted multi-user later).

**Depends on:** Spec 02 (server), Spec 04 (frontend editor), Spec 08 (store)

---

## 1. Problem Statement

The current undo system is broken:

1. **Client state diverges from server after undo.** The server undoes correctly (reload proves it), but `fetchPages()` + Solid's `reconcile()` doesn't trigger re-renders. The UI shows stale state.
2. **Full-document refetch on every change.** Every mutation triggers `fetchPages()` which fetches all nodes. Doesn't scale to large documents.
3. **Global undo stack.** One stack for all users. Human's Cmd+Z undoes the agent's work. Incompatible with multi-user.
4. **Undo granularity mismatch.** Each mutation is a separate undo step. "Align 4 nodes" = 1 batchSetTransform = 1 undo step (correct), but "delete 3 nodes" = 3 deleteNode calls = 3 undo steps (wrong).
5. **can_undo flag out of sync.** Self-echo suppression skips the subscription refetch, so the flag is never updated after the client's own mutations.

## 2. Design Principles

- **Undo is a client concern.** The server processes operations. Undo reversal is computed and applied by the client, then sent to the server as a normal (inverse) operation.
- **Per-user undo stacks.** Each connected client (human session, agent session) maintains its own undo history. Your Cmd+Z undoes your changes, not someone else's.
- **Field-level operations.** Mutations describe individual field changes, not whole-object replacements. Minimizes conflict surface for concurrent editing.
- **Operation broadcast, not refetch.** The server broadcasts the actual operations to all other clients. Clients apply operations directly to their local store. No `fetchPages()` except on initial load.
- **Persistent undo stacks.** Client undo history survives page reload via IndexedDB.

## 3. Operation Model

### 3.1 Operation Type

Every mutation in the system is represented as an **Operation**:

```typescript
interface Operation {
  id: string;              // unique operation ID (UUID)
  userId: string;          // who issued it (session ID)
  nodeUuid: string;        // target node (empty for create)
  type: OperationType;     // "set_field" | "create_node" | "delete_node" | "reparent" | "reorder"
  path: string;            // field path for set_field: "transform", "style.fills", "name", etc.
  value: unknown;          // new value (full node data for create_node)
  previousValue: unknown;  // old value (full node snapshot for delete_node)
  seq: number;             // server-assigned sequence number (0 until confirmed)
}
```

The **inverse** of any operation is constructed by swapping `value` and `previousValue`. For `create_node`, the inverse is `delete_node` and vice versa.

### 3.2 Field Paths

Operations target specific fields at the sub-object level:

| Path | Value Type | Used By |
|------|-----------|---------|
| `transform` | Transform object | Move, resize, rotate |
| `style.fills` | Fill[] | Fill editing |
| `style.strokes` | Stroke[] | Stroke editing |
| `style.effects` | Effect[] | Effect editing |
| `style.opacity` | StyleValue<number> | Opacity slider |
| `style.blend_mode` | BlendMode | Blend mode select |
| `name` | string | Rename |
| `visible` | boolean | Toggle visibility |
| `locked` | boolean | Toggle lock |
| `kind` | NodeKind | Corner radii, arc angles, etc. |
| `constraints` | Constraints | Constraint editing |

Special operation types handle structural changes:
- `create_node` — value contains full node data, previousValue is null
- `delete_node` — value is null, previousValue contains full node snapshot
- `reparent` — value is `{ parentUuid, position }`, previousValue is `{ oldParentUuid, oldPosition }`
- `reorder` — value is `{ newPosition }`, previousValue is `{ oldPosition }`

### 3.3 Transactions

A **Transaction** groups operations into a single undo step:

```typescript
interface Transaction {
  id: string;              // unique transaction ID (UUID)
  userId: string;          // who issued it
  operations: Operation[]; // ordered list of field changes
  description: string;     // human-readable: "Move Rectangle 1", "Align 4 nodes"
  timestamp: number;       // wall clock
  seq: number;             // server-assigned sequence number for the transaction
}
```

**Grouping rules:**
- **Explicit transactions** — `beginTransaction()` / `commitTransaction()` wraps multi-node operations (align, distribute, group).
- **Drag coalescing** — continuous pointer-move operations on the same node + same path are merged. Transaction starts on pointerdown, commits on pointerup. Only first `previousValue` and last `value` kept.
- **Discrete operations** — single-field changes (rename, toggle visible) are auto-wrapped in a single-operation transaction.

Undoing a transaction applies the inverse of every operation in reverse order.

## 4. Client History Manager

### 4.1 Transparent Undo Tracking

**Core principle:** Mutations MUST NOT know about the undo system. Undo tracking is a transparent layer that observes store changes and records them automatically. One user action = one undo step.

The store exposes a `set(nodeUuid, path, value)` method that:
1. Snapshots the current value at that path (the "before")
2. Applies the new value to the Solid store
3. Records the change for undo

Changes are **auto-coalesced**: all `set()` calls within the same animation frame become ONE undo step. This means:
- A rename (one `set` call) = one undo step
- A color picker drag (many `set` calls per frame, many frames) = one undo step per frame... unless an **edit session** is active

**Edit sessions** group all changes from open to close into one undo step:
- `beginEdit(description)` — starts an edit session (e.g., when color picker opens)
- `commitEdit()` — ends the session, commits all changes as one undo step
- `cancelEdit()` — ends the session, reverts all changes

Edit sessions are called by **UI components** (popover open/close, pointerDown/pointerUp), NOT by mutations. Mutations are completely unaware.

For multi-node operations (align, batch transform), use `beginBatch`/`commitBatch` — the only explicit grouping API mutations use.

```typescript
interface TrackedStore {
  /** Set a field on a node. Automatically tracked for undo. */
  set(nodeUuid: string, path: string, value: unknown): void;

  /** Begin a batch — all changes until commitBatch() become one undo step. */
  beginBatch(description: string): void;
  commitBatch(): void;
  cancelBatch(): void;
}

interface UndoTracker {
  tracked: TrackedStore;

  /** Begin an edit session (called by UI components, not mutations). */
  beginEdit(description: string): void;
  commitEdit(): void;
  cancelEdit(): void;

  undo(): void;
  redo(): void;
  canUndo(): boolean;   // reactive signal
  canRedo(): boolean;   // reactive signal
}
```

The HistoryManager (undo/redo stack management) remains internally but is not exposed to mutations.

### 4.2 IndexedDB Persistence

Undo/redo stacks stored in IndexedDB, keyed by `documentId + userId`:

```
Database: sigil-history
  Store: transactions
    Key: [documentId, userId, transactionId]
    Index: [documentId, userId, timestamp] (ordered retrieval)
    Value: Transaction
  Store: meta
    Key: [documentId, userId]
    Value: { undoIndex: number, stackSize: number }
```

On page load: restore from IndexedDB. On each transaction: write to IndexedDB (async, non-blocking). Max stack size: 500 transactions (matching current server history limit). FIFO eviction of oldest.

### 4.3 Stale Previous Values

After reload, the user's undo stack may contain `previousValue` entries that no longer match the current document state (because other users or agents changed the same fields). This is acceptable — the undo sets the field to what it was when the user made the change, which is the correct per-user undo semantic. It may overwrite concurrent changes from other users, which is the expected behavior (same as Figma).

## 5. Server Changes

### 5.1 Operation Processor

The server simplifies from "command executor with undo stack" to "operation validator + applier + broadcaster":

```
Receive Transaction from client
  → Assign sequence number
  → For each Operation: validate field value, verify node exists
  → For each Operation: apply to document state
  → Persist (signal_dirty)
  → Broadcast Transaction to all OTHER connected clients (excluding sender)
  → Return { seq, timestamp } to originating client
```

### 5.2 Removed Server Components

- `History` struct (undo/redo stacks)
- `Document::execute()`, `Document::undo()`, `Document::redo()`
- `Command` trait's `undo()` method
- All `old_*` snapshot fields on command structs
- `UNDO_MUTATION` / `REDO_MUTATION` from GraphQL schema
- `UndoRedoResult` type
- `can_undo()` / `can_redo()` on Document

### 5.3 Sequence Numbers

Server maintains a monotonically increasing sequence counter per document. Each transaction gets a sequence number on commit. This enables:

- **Self-echo suppression** — client ignores broadcasts with its own userId
- **Gap detection on reconnect** — client sends lastSeq, server returns missed transactions
- **Ordering guarantee** — operations applied in sequence order

### 5.4 Simplified Server Operation Trait

```rust
pub trait FieldOperation: Debug + Send + Sync {
    fn validate(&self, doc: &Document) -> Result<(), CoreError>;
    fn apply(&self, doc: &mut Document) -> Result<(), CoreError>;
}
```

No `undo()`. No `SideEffect` return. Just validate and apply.

## 6. Subscription Protocol

### 6.1 Operation Broadcast

Replace the current generic `MutationEvent` with typed operation broadcast:

```graphql
subscription DocumentOperations($documentId: String!) {
  transactionApplied(documentId: $documentId) {
    transactionId: String!
    userId: String!
    seq: Int!
    operations: [OperationPayload!]!
  }
}

type OperationPayload {
  id: String!
  nodeUuid: String!
  type: String!           # "set_field" | "create_node" | "delete_node" | "reparent" | "reorder"
  path: String
  value: JSON
}
```

### 6.2 Client-Side Application

When receiving a broadcast from another user:

```typescript
function applyRemoteTransaction(tx: TransactionPayload): void {
  if (tx.userId === localUserId) return; // self-echo suppression

  batch(() => {
    for (const op of tx.operations) {
      applyRemoteOperation(op);
    }
  });

  lastSeq = tx.seq;
}

function applyRemoteOperation(op: OperationPayload): void {
  switch (op.type) {
    case "set_field":
      applyFieldSet(op.nodeUuid, op.path, op.value);
      break;
    case "create_node":
      addNodeToStore(op.value);
      break;
    case "delete_node":
      removeNodeFromStore(op.nodeUuid);
      break;
    case "reparent":
      reparentInStore(op.nodeUuid, op.value.parentUuid, op.value.position);
      break;
    case "reorder":
      reorderInStore(op.nodeUuid, op.value.newPosition);
      break;
  }
}
```

Direct Solid store updates via `setState()` — no reconcile, no refetch.

### 6.3 Reconnect Protocol

On reconnect (page reload, network recovery):

1. Client sends `lastSeq` (from IndexedDB or memory)
2. Server returns all transactions since `lastSeq`
3. Client replays them in order
4. If gap too large or no `lastSeq`: fall back to full `fetchPages()` (initial load only)

## 7. Frontend Mutation Refactor

### 7.1 Before (current)

```typescript
function setTransform(uuid: string, transform: Transform): void {
  const previous = deepClone(node.transform);
  setState("nodes", uuid, "transform", transform);  // optimistic
  client.mutation(SET_TRANSFORM_MUTATION, { uuid, transform })...  // server
}
```

### 7.2 After (new)

```typescript
function setTransform(uuid: string, transform: Transform): void {
  const previous = deepClone(node.transform);

  // Create operation
  const op: Operation = {
    id: crypto.randomUUID(),
    userId: sessionId,
    nodeUuid: uuid,
    type: "set_field",
    path: "transform",
    value: transform,
    previousValue: previous,
    seq: 0,
  };

  // Apply locally (instant)
  setState("nodes", uuid, "transform", transform);

  // Track in history (for undo)
  historyManager.apply(op);

  // Send to server
  client.mutation(APPLY_OPERATION_MUTATION, { operations: [op] })...
}
```

For drag operations:
```typescript
// pointerdown
historyManager.beginDrag(uuid, "transform");

// pointermove (60fps)
historyManager.updateDrag(op);
setState("nodes", uuid, "transform", newTransform);

// pointerup
historyManager.commitDrag();
client.mutation(APPLY_OPERATION_MUTATION, { operations: [coalescedOp] })...
```

### 7.3 Undo/Redo in Canvas.tsx

```typescript
"$mod+z": (e: KeyboardEvent) => {
  if (isTyping()) return;
  e.preventDefault();
  const inverseTx = historyManager.undo();
  if (!inverseTx) return;

  // Apply inverse locally (instant)
  batch(() => {
    for (const op of inverseTx.operations) {
      applyFieldSet(op.nodeUuid, op.path, op.value);
    }
  });

  // Send inverse to server (so other clients see the revert)
  client.mutation(APPLY_OPERATION_MUTATION, {
    operations: inverseTx.operations
  })...
}
```

Undo is instant — no server round-trip needed for visual feedback.

## 8. File Structure

### New files

```
frontend/src/operations/
  types.ts                  — Operation, Transaction, OperationType types
  history-manager.ts        — HistoryManager class
  history-store.ts          — IndexedDB persistence layer
  apply-remote.ts           — applyRemoteTransaction / applyRemoteOperation
  operation-helpers.ts      — createSetFieldOp, createInverse, etc.

frontend/src/operations/__tests__/
  history-manager.test.ts
  history-store.test.ts
  apply-remote.test.ts
  operation-helpers.test.ts
```

### Modified files

```
frontend/src/store/document-store-solid.tsx  — all mutations refactored to emit Operations
frontend/src/shell/Canvas.tsx                — undo/redo via HistoryManager, no UNDO_MUTATION
frontend/src/tools/select-tool.ts            — drag operations use beginDrag/commitDrag
frontend/src/graphql/mutations.ts            — APPLY_OPERATION_MUTATION replaces individual mutations
frontend/src/graphql/subscriptions.ts        — operation broadcast subscription

crates/core/src/document.rs                  — remove History, undo(), redo()
crates/core/src/operations/                  — new FieldOperation trait + implementations
crates/server/src/graphql/mutation.rs        — single applyOperations mutation replaces all others
crates/server/src/graphql/subscription.rs    — broadcast operations, not events
```

## 9. Implementation Phases

### Phase 15a: Operation types + HistoryManager + IndexedDB

Create the operation model, HistoryManager, and IndexedDB persistence as standalone modules. Fully testable in isolation. No integration with the store or server yet.

**Exit criteria:** HistoryManager can create transactions, undo/redo, persist to IndexedDB, restore on load. All via unit tests.

### Phase 15b: Operation broadcast subscription

Change the server subscription from generic `MutationEvent` to typed operation broadcast. Change the client subscription handler from "refetch on event" to "apply operations directly." Server assigns sequence numbers.

**Exit criteria:** When a mutation happens (via current GraphQL mutations), the subscription broadcasts the operation and other clients apply it directly without refetch.

### Phase 15c: Refactor frontend mutations to emit Operations

Rewrite all 16+ store mutation methods to create Operations, apply locally, track in HistoryManager, and send to server. Wire Cmd+Z/Cmd+Shift+Z to HistoryManager. This is the big task.

**Exit criteria:** All mutations work via Operations. Undo/redo works for all operations. Drag coalescing works. Multi-node operations (align, group) are single undo steps.

### Phase 15d: Server simplification

Remove server-side History, undo/redo, Command trait's undo method. Simplify to validate+apply+broadcast. Clean up old snapshot fields. Add sequence-based reconnect protocol.

**Exit criteria:** Server has no undo concept. All undo is client-side. Reconnect replays missed operations.

## 10. Input Validation

- **Operation field values:** Validated by the server's FieldOperation::validate() before apply. Same validation rules as current (finite transforms, non-negative dimensions, valid fill counts, etc.).
- **Sequence numbers:** Monotonically increasing u64. Overflow not a concern (2^64 operations).
- **Transaction size:** Max operations per transaction: 256 (reuse MAX_BATCH_SIZE). Reject larger transactions.
- **IndexedDB storage:** Max 500 transactions per document+user. FIFO eviction.
- **Operation IDs:** UUIDs, validated format on both client and server.

## 11. Consistency Guarantees

- **Per-user undo is always consistent with the user's own history.** Undoing sets the field to what it was when the user changed it.
- **Cross-user conflicts are last-writer-wins at the field level.** If user A changes transform and user B changes transform, the last operation to reach the server wins. The other user's undo stack still has the correct inverse for their change.
- **Transaction atomicity:** All operations in a transaction are applied together on the server. If any operation fails validation, the entire transaction is rejected.
- **Sequence ordering:** Operations are applied in sequence order. Clients that receive operations out of order (network) buffer and reorder before applying.

## 12. WASM Compatibility

No changes to the core crate's WASM compatibility. The FieldOperation trait uses the same types (Transform, Fill, Stroke, etc.) that already compile to WASM. The HistoryManager is frontend-only (TypeScript + IndexedDB).

## 13. Recursion Safety

No recursive algorithms. Transaction replay is a flat iteration. IndexedDB operations are async but non-recursive.

## 14. PDR Traceability

**Implements:**
- PDR §1.4 "Every operation must have undo/redo support — no exceptions"
- PDR §4.1 "Agents and humans see each other's changes in real time"

**Defers:**
- Selective undo (undo a specific past operation, not just the most recent) — research area, not needed for MVP
- Branching history (Vim-style undo tree) — linear history is sufficient

## 15. Migration Strategy

The four phases (15a through 15d) are designed so that:
- Each phase produces a mergeable PR with working tests
- The system works in a hybrid state between phases (old mutations + new operations coexist)
- Phase 15c is the cutover — after it merges, the old undo is dead code
- Phase 15d cleans up the dead code

No feature flags needed. No data migration needed. The IndexedDB store is created fresh on first use.
