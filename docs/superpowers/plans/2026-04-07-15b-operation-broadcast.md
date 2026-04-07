# Plan 15b — Operation Broadcast Subscription

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic "event notification then refetch" subscription with typed "operation broadcast then direct apply." The server broadcasts the actual operation data (field path, value, userId, sequence number) and the frontend applies it directly to the Solid store via `setState` -- no `fetchPages()` on every change.

**Architecture:** Three coordinated changes: (1) the state crate's `MutationEvent` gains an `operations` payload and `user_id`/`seq` fields, (2) the server subscription converts these into a new GraphQL `TransactionApplied` type, (3) the frontend subscription handler switches from `debouncedFetchPages()` to `applyRemoteTransaction()` which patches the Solid store directly. The existing `MutationEventKind`-based event system remains for backwards compatibility during the transition, coexisting with the new operation payload.

**Depends on:** Plan 15a (operation types must exist in `frontend/src/operations/types.ts` before the frontend subscription handler can import them). If 15a is not yet merged, Task 5 of this plan must be sequenced after 15a lands.

**Tech Stack:** Rust (state crate, server crate), TypeScript (Solid.js store, subscription handler), Vitest, async-graphql, serde_json

**Spec Reference:** Spec 15, sections 5 (Server Changes), 6 (Subscription Protocol), Phase 15b (section 9)

---

## Task 1: Add Sequence Counter and Operation Payload to State Crate

**Files:**
- Modify: `crates/state/src/lib.rs`

This task adds the server-side sequence counter and enriches `MutationEvent` with typed operation payloads. The counter is an `AtomicU64` on `AppState` that produces monotonically increasing sequence numbers for each broadcast.

- [ ] **Step 1: Define `OperationPayload` struct**

Add a new struct to `crates/state/src/lib.rs` that carries the operation data through the broadcast channel:

```rust
/// A single field-level operation payload for broadcast.
///
/// This is the transport-agnostic representation that flows through
/// the broadcast channel. The server converts it to GraphQL types;
/// the MCP crate can use it directly.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct OperationPayload {
    /// Unique operation ID (UUID string).
    pub id: String,
    /// Target node UUID.
    pub node_uuid: String,
    /// Operation type: "set_field", "create_node", "delete_node", "reparent", "reorder".
    pub op_type: String,
    /// Field path for set_field operations (e.g., "transform", "style.fills", "name").
    /// Empty for structural operations.
    pub path: String,
    /// New value as JSON. Full node data for create_node.
    pub value: Option<serde_json::Value>,
}
```

- [ ] **Step 2: Define `TransactionPayload` struct**

```rust
/// A complete transaction payload for broadcast.
///
/// Groups one or more operations into a single broadcast message.
/// Carries the userId and server-assigned sequence number.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TransactionPayload {
    /// Unique transaction ID (UUID string).
    pub transaction_id: String,
    /// Session ID of the user who originated this transaction.
    pub user_id: String,
    /// Server-assigned monotonically increasing sequence number.
    pub seq: u64,
    /// Ordered list of operations in this transaction.
    pub operations: Vec<OperationPayload>,
}
```

- [ ] **Step 3: Extend `MutationEvent` with optional transaction payload**

Add an optional `transaction` field to `MutationEvent` so the new payload coexists with the existing `kind`/`uuid`/`data` fields:

```rust
#[derive(Clone, Debug)]
pub struct MutationEvent {
    /// The kind of mutation that occurred (legacy, kept for backwards compat).
    pub kind: MutationEventKind,
    /// UUID of the affected entity, if applicable (legacy).
    pub uuid: Option<String>,
    /// Additional structured data about the event (legacy).
    pub data: Option<serde_json::Value>,
    /// Typed operation payload (new). When present, subscribers should use this
    /// instead of the legacy fields.
    pub transaction: Option<TransactionPayload>,
}
```

- [ ] **Step 4: Add `AtomicU64` sequence counter to `AppState`**

Add a sequence counter field and a method to increment-and-return:

```rust
use std::sync::atomic::{AtomicU64, Ordering};

// In AppState struct:
/// Monotonically increasing sequence counter for operation ordering.
/// Each transaction broadcast increments this counter.
seq_counter: Arc<AtomicU64>,

// In AppState::new() and new_with_persistence():
seq_counter: Arc::new(AtomicU64::new(1)),

// New method:
/// Returns the next sequence number, incrementing the counter atomically.
///
/// Sequence numbers start at 1 (0 is reserved as "unconfirmed" on the client).
pub fn next_seq(&self) -> u64 {
    self.seq_counter.fetch_add(1, Ordering::SeqCst)
}
```

- [ ] **Step 5: Add `publish_transaction` convenience method**

```rust
/// Publishes a transaction as a mutation event with the operation payload.
///
/// Assigns the next sequence number, wraps the transaction in a MutationEvent
/// with the appropriate legacy kind, and broadcasts to all subscribers.
pub fn publish_transaction(
    &self,
    kind: MutationEventKind,
    uuid: Option<String>,
    mut transaction: TransactionPayload,
) {
    transaction.seq = self.next_seq();
    self.publish_event(MutationEvent {
        kind,
        uuid,
        data: None,
        transaction: Some(transaction),
    });
}
```

- [ ] **Step 6: Add `serde` dependency to state crate**

The `OperationPayload` and `TransactionPayload` structs derive `Serialize`/`Deserialize`, so add `serde` to `crates/state/Cargo.toml`:

```toml
serde = { workspace = true }
```

- [ ] **Step 7: Write tests for sequence counter and transaction payload**

Tests in `crates/state/src/lib.rs`:

1. `test_next_seq_starts_at_one` -- first call returns 1.
2. `test_next_seq_monotonically_increases` -- 10 sequential calls return 1..=10.
3. `test_publish_transaction_assigns_seq` -- publish a transaction, verify the received event has `seq > 0`.
4. `test_publish_transaction_preserves_legacy_kind` -- verify the `kind` field is still set correctly alongside the transaction.
5. `test_mutation_event_without_transaction_is_backwards_compatible` -- verify existing `publish_event` calls with `transaction: None` still work.

---

## Task 2: Add GraphQL Types for Operation Broadcast

**Files:**
- Modify: `crates/server/src/graphql/types.rs`

Adds the GraphQL output types that the subscription will yield.

- [ ] **Step 1: Add `OperationPayloadGql` type**

```rust
/// GraphQL representation of a single operation in a broadcast transaction.
#[derive(Clone, Debug, SimpleObject)]
pub struct OperationPayloadGql {
    /// Unique operation ID.
    pub id: String,
    /// Target node UUID.
    pub node_uuid: String,
    /// Operation type: "set_field", "create_node", "delete_node", "reparent", "reorder".
    #[graphql(name = "type")]
    pub op_type: String,
    /// Field path for set_field operations.
    pub path: Option<String>,
    /// New value as JSON.
    pub value: Option<async_graphql::Json<serde_json::Value>>,
}
```

- [ ] **Step 2: Add `TransactionAppliedEvent` type**

```rust
/// GraphQL representation of a transaction broadcast event.
///
/// Sent to subscription clients when any mutation modifies the document.
/// Contains the full operation payload so clients can apply changes directly
/// without refetching.
#[derive(Clone, Debug, SimpleObject)]
pub struct TransactionAppliedEvent {
    /// Unique transaction ID.
    pub transaction_id: String,
    /// Session ID of the user who originated this transaction.
    pub user_id: String,
    /// Server-assigned sequence number.
    pub seq: String,  // String because GraphQL Int is i32, seq is u64
    /// Ordered list of operations.
    pub operations: Vec<OperationPayloadGql>,
    /// Legacy event type for clients that haven't migrated yet.
    pub event_type: DocumentEventType,
    /// Legacy UUID field.
    pub uuid: Option<String>,
}
```

- [ ] **Step 3: Add conversion from `TransactionPayload` to `TransactionAppliedEvent`**

```rust
impl TransactionAppliedEvent {
    /// Converts a state-crate TransactionPayload into a GraphQL event.
    #[must_use]
    pub fn from_transaction(
        tx: &agent_designer_state::TransactionPayload,
        kind: DocumentEventType,
        uuid: Option<String>,
    ) -> Self {
        Self {
            transaction_id: tx.transaction_id.clone(),
            user_id: tx.user_id.clone(),
            seq: tx.seq.to_string(),
            operations: tx.operations.iter().map(|op| OperationPayloadGql {
                id: op.id.clone(),
                node_uuid: op.node_uuid.clone(),
                op_type: op.op_type.clone(),
                path: if op.path.is_empty() { None } else { Some(op.path.clone()) },
                value: op.value.clone().map(async_graphql::Json),
            }).collect(),
            event_type: kind,
            uuid,
        }
    }
}
```

- [ ] **Step 4: Write tests for the conversion**

Test that `from_transaction` correctly maps all fields, including the edge case where `path` is empty (should become `None`).

---

## Task 3: Update Subscription to Broadcast Operation Payloads

**Files:**
- Modify: `crates/server/src/graphql/subscription.rs`

The subscription now yields `TransactionAppliedEvent` when the `MutationEvent` carries a transaction payload, and falls back to the existing `DocumentEvent` format when it doesn't (backwards compatibility during transition).

- [ ] **Step 1: Add `transaction_applied` subscription**

Add a new subscription field alongside `document_changed`. The old `document_changed` remains for backwards compatibility:

```rust
/// Stream of typed transaction events.
///
/// Yields a [`TransactionAppliedEvent`] for every mutation that carries
/// operation payloads. Clients use this to apply changes directly to their
/// local store without refetching.
///
/// Events without a transaction payload (legacy mutations not yet migrated)
/// are converted to a synthetic single-operation transaction so the client
/// always receives a consistent format.
async fn transaction_applied(
    &self,
    ctx: &Context<'_>,
) -> Result<impl Stream<Item = TransactionAppliedEvent>> {
    let state = ctx.data::<ServerState>()?;
    let event_tx = state
        .app
        .event_tx()
        .ok_or_else(|| async_graphql::Error::new("event broadcast channel not configured"))?;
    let mut rx = event_tx.subscribe();
    Ok(async_stream::stream! {
        loop {
            match rx.recv().await {
                Ok(mutation_event) => {
                    yield TransactionAppliedEvent::from_mutation_event(mutation_event);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("transaction subscription client lagged by {n} messages");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    })
}
```

- [ ] **Step 2: Add `from_mutation_event` fallback conversion on `TransactionAppliedEvent`**

When a `MutationEvent` has a `transaction` field, use it directly. When it doesn't (legacy path), synthesize a minimal event with the legacy kind/uuid fields and an empty operations list:

```rust
impl TransactionAppliedEvent {
    #[must_use]
    pub fn from_mutation_event(event: MutationEvent) -> Self {
        let event_type = DocumentEvent::event_type_from_kind(event.kind);
        if let Some(tx) = event.transaction {
            Self::from_transaction(&tx, event_type, event.uuid)
        } else {
            // Legacy fallback: no operation payload, client must refetch
            Self {
                transaction_id: String::new(),
                user_id: String::new(),
                seq: "0".to_string(),
                operations: vec![],
                event_type,
                uuid: event.uuid,
            }
        }
    }
}
```

- [ ] **Step 3: Extract `event_type_from_kind` helper**

Refactor the existing `DocumentEvent::from_mutation_event` to expose the kind-to-type mapping as a reusable function, since both `DocumentEvent` and `TransactionAppliedEvent` need it.

- [ ] **Step 4: Write tests for the new subscription**

1. `test_transaction_applied_yields_full_payload` -- publish a `MutationEvent` with a `TransactionPayload`, verify the subscription yields a `TransactionAppliedEvent` with all fields populated.
2. `test_transaction_applied_legacy_fallback` -- publish a `MutationEvent` without a transaction, verify the subscription yields an event with empty operations and seq=0.
3. `test_transaction_applied_preserves_order` -- publish multiple events, verify they arrive in order with correct seq values.
4. `test_document_changed_still_works` -- verify the old subscription still yields `DocumentEvent` for backwards compatibility.

---

## Task 4: Enrich Existing Mutation Handlers with Operation Payloads

**Files:**
- Modify: `crates/server/src/graphql/mutation.rs`

Each existing mutation handler that calls `publish_event` is updated to also include a `TransactionPayload`. This is a mechanical change: after each `doc_guard.execute()`, construct an `OperationPayload` describing what changed, wrap it in a `TransactionPayload`, and pass it through `publish_transaction` instead of `publish_event`.

- [ ] **Step 1: Add a `userId` parameter to mutations**

Each mutation needs to know who is calling it for the broadcast's `user_id` field. Add an optional `user_id: Option<String>` parameter to each GraphQL mutation. If not provided, use `"anonymous"`. This allows the frontend to pass its `clientSessionId`:

Example for `set_transform`:
```rust
async fn set_transform(
    &self,
    ctx: &Context<'_>,
    uuid: String,
    transform: Json<serde_json::Value>,
    user_id: Option<String>,
) -> Result<NodeGql> {
```

The `user_id` parameter is optional to maintain backwards compatibility with existing clients and MCP tools that don't send it yet.

- [ ] **Step 2: Update `set_transform` to broadcast operation payload**

Replace the `publish_event` call with `publish_transaction`:

```rust
// After execute, still inside the lock scope, serialize the new value:
let transform_json = serde_json::to_value(new_transform)
    .map_err(|e| async_graphql::Error::new(format!("serialization failed: {e}")))?;

// After dropping the lock:
state.app.signal_dirty();
state.app.publish_transaction(
    MutationEventKind::NodeUpdated,
    Some(parsed_uuid.to_string()),
    TransactionPayload {
        transaction_id: uuid::Uuid::new_v4().to_string(),
        user_id: user_id.unwrap_or_else(|| "anonymous".to_string()),
        seq: 0, // assigned by publish_transaction
        operations: vec![OperationPayload {
            id: uuid::Uuid::new_v4().to_string(),
            node_uuid: parsed_uuid.to_string(),
            op_type: "set_field".to_string(),
            path: "transform".to_string(),
            value: Some(transform_json),
        }],
    },
);
```

- [ ] **Step 3: Update all remaining mutation handlers**

Apply the same pattern to every mutation handler. The mapping for each mutation:

| Mutation | op_type | path | value |
|----------|---------|------|-------|
| `create_node` | `create_node` | `""` | Full node JSON (use `node_to_gql` serialization) |
| `delete_node` | `delete_node` | `""` | `null` |
| `rename_node` | `set_field` | `name` | new name string |
| `set_transform` | `set_field` | `transform` | Transform JSON |
| `set_visible` | `set_field` | `visible` | boolean |
| `set_locked` | `set_field` | `locked` | boolean |
| `set_opacity` | `set_field` | `style.opacity` | StyleValue JSON |
| `set_blend_mode` | `set_field` | `style.blend_mode` | BlendMode string |
| `set_fills` | `set_field` | `style.fills` | Fill[] JSON |
| `set_strokes` | `set_field` | `style.strokes` | Stroke[] JSON |
| `set_effects` | `set_field` | `style.effects` | Effect[] JSON |
| `set_corner_radii` | `set_field` | `kind` | NodeKind JSON |
| `batch_set_transform` | `set_field` x N | `transform` per node | Transform JSON per node |
| `reparent_node` | `reparent` | `""` | `{ parentUuid, position }` |
| `reorder_children` | `reorder` | `""` | `{ newPosition }` per child |
| `group_nodes` | `create_node` + `reparent` x N | varies | varies |
| `ungroup_nodes` | `reparent` x N + `delete_node` | varies | varies |
| `undo` / `redo` | Keep as legacy (no transaction payload) | N/A | N/A |

Note: `undo` and `redo` mutations are left as legacy events (no transaction payload). They will be removed in Phase 15d when undo moves fully to the client.

- [ ] **Step 4: Add a helper function to reduce boilerplate**

```rust
/// Creates a single-operation transaction payload for a field set mutation.
fn field_set_transaction(
    user_id: Option<String>,
    node_uuid: &str,
    path: &str,
    value: serde_json::Value,
) -> TransactionPayload {
    TransactionPayload {
        transaction_id: uuid::Uuid::new_v4().to_string(),
        user_id: user_id.unwrap_or_else(|| "anonymous".to_string()),
        seq: 0,
        operations: vec![OperationPayload {
            id: uuid::Uuid::new_v4().to_string(),
            node_uuid: node_uuid.to_string(),
            op_type: "set_field".to_string(),
            path: path.to_string(),
            value: Some(value),
        }],
    }
}
```

- [ ] **Step 5: Write tests for enriched mutation broadcasts**

1. `test_set_transform_broadcasts_operation_payload` -- call `setTransform`, subscribe, verify the received event has a transaction with op_type "set_field", path "transform", and the correct value JSON.
2. `test_create_node_broadcasts_create_payload` -- verify op_type "create_node" with full node data.
3. `test_delete_node_broadcasts_delete_payload` -- verify op_type "delete_node".
4. `test_batch_set_transform_broadcasts_multiple_ops` -- verify the transaction contains N operations for N nodes.
5. `test_user_id_propagated_in_broadcast` -- pass a userId, verify it appears in the transaction.
6. `test_seq_assigned_and_increasing` -- call two mutations, verify seq values are monotonically increasing.

---

## Task 5: Frontend `applyRemoteTransaction` Function

**Files:**
- Create: `frontend/src/operations/apply-remote.ts`
- Create: `frontend/src/operations/__tests__/apply-remote.test.ts`

**Depends on:** Plan 15a (for `OperationType` type from `frontend/src/operations/types.ts`). If 15a hasn't merged, define a minimal local type alias in this file.

This task builds the pure function that takes a transaction payload from the subscription and applies it directly to the Solid store.

- [ ] **Step 1: Define the `RemoteTransactionPayload` type**

This is the shape of data arriving from the GraphQL subscription (matches the server's `TransactionAppliedEvent`):

```typescript
/**
 * Shape of a transaction event received from the GraphQL subscription.
 * Matches the server's TransactionAppliedEvent GraphQL type.
 */
export interface RemoteTransactionPayload {
  readonly transactionId: string;
  readonly userId: string;
  readonly seq: string; // string because GraphQL sends u64 as string
  readonly operations: readonly RemoteOperationPayload[];
  readonly eventType: string; // legacy event type for fallback
  readonly uuid: string | null;
}

export interface RemoteOperationPayload {
  readonly id: string;
  readonly nodeUuid: string;
  readonly type: string;
  readonly path: string | null;
  readonly value: unknown;
}
```

- [ ] **Step 2: Implement `applyRemoteTransaction`**

```typescript
import { batch } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import type { DocumentNode } from "../types/document";

/**
 * Applies a remote transaction's operations directly to the Solid store.
 *
 * This replaces the old debouncedFetchPages() pattern. Instead of refetching
 * all pages from the server, we patch individual fields in the store.
 *
 * Self-echo suppression: transactions with userId matching localUserId are
 * ignored (the originating client already applied these optimistically).
 *
 * @returns The seq number from the transaction, for tracking.
 */
export function applyRemoteTransaction(
  tx: RemoteTransactionPayload,
  localUserId: string,
  setState: SetStoreFunction<{ nodes: Record<string, DocumentNode>; pages: Page[] }>,
  fetchPages: () => Promise<void>,
): number {
  const seq = parseInt(tx.seq, 10);

  // Self-echo suppression
  if (tx.userId === localUserId) {
    return seq;
  }

  // Legacy fallback: if no operations, fall back to refetch
  if (tx.operations.length === 0) {
    void fetchPages();
    return seq;
  }

  batch(() => {
    for (const op of tx.operations) {
      applyRemoteOperation(op, setState);
    }
  });

  return seq;
}
```

- [ ] **Step 3: Implement `applyRemoteOperation`**

```typescript
function applyRemoteOperation(
  op: RemoteOperationPayload,
  setState: SetStoreFunction<{ nodes: Record<string, DocumentNode>; pages: Page[] }>,
): void {
  switch (op.type) {
    case "set_field":
      applyFieldSet(op.nodeUuid, op.path, op.value, setState);
      break;
    case "create_node":
      applyCreateNode(op.value, setState);
      break;
    case "delete_node":
      applyDeleteNode(op.nodeUuid, setState);
      break;
    case "reparent":
      applyReparent(op.nodeUuid, op.value, setState);
      break;
    case "reorder":
      applyReorder(op.nodeUuid, op.value, setState);
      break;
    default:
      console.warn(`Unknown remote operation type: ${op.type}`);
  }
}
```

- [ ] **Step 4: Implement field-level patching functions**

Each function maps a field path to the correct `setState` call:

```typescript
function applyFieldSet(
  nodeUuid: string,
  path: string | null,
  value: unknown,
  setState: SetStoreFunction<{ nodes: Record<string, DocumentNode> }>,
): void {
  if (!path) return;

  // Validate nodeUuid exists in store before patching
  // (the node may have been deleted locally before this broadcast arrived)

  switch (path) {
    case "transform":
      setState("nodes", nodeUuid, "transform", value as Transform);
      break;
    case "name":
      setState("nodes", nodeUuid, "name", value as string);
      break;
    case "visible":
      setState("nodes", nodeUuid, "visible", value as boolean);
      break;
    case "locked":
      setState("nodes", nodeUuid, "locked", value as boolean);
      break;
    case "style.fills":
      setState("nodes", nodeUuid, "style", "fills", value as Fill[]);
      break;
    case "style.strokes":
      setState("nodes", nodeUuid, "style", "strokes", value as Stroke[]);
      break;
    case "style.effects":
      setState("nodes", nodeUuid, "style", "effects", value as Effect[]);
      break;
    case "style.opacity":
      setState("nodes", nodeUuid, "style", "opacity", value as StyleValue<number>);
      break;
    case "style.blend_mode":
      setState("nodes", nodeUuid, "style", "blend_mode", value as BlendMode);
      break;
    case "kind":
      setState("nodes", nodeUuid, "kind", value as NodeKind);
      break;
    default:
      console.warn(`Unknown field path in remote operation: ${path}`);
  }
}
```

For `create_node`, `delete_node`, `reparent`, and `reorder`: implement minimal versions that add/remove/move nodes in the store. `create_node` inserts the full node into `state.nodes[uuid]` and appends to the appropriate page's root_nodes. `delete_node` removes from `state.nodes` and from parent's children. Reparent and reorder update parent/children arrays.

- [ ] **Step 5: Write tests**

Tests in `frontend/src/operations/__tests__/apply-remote.test.ts`:

1. `test_self_echo_suppressed` -- transaction with matching userId returns seq but does not call setState.
2. `test_set_field_transform_patches_store` -- verify setState called with correct path.
3. `test_set_field_name_patches_store` -- verify name field updated.
4. `test_set_field_style_fills_patches_nested_path` -- verify nested style.fills path works.
5. `test_create_node_adds_to_store` -- verify new node appears in nodes record.
6. `test_delete_node_removes_from_store` -- verify node removed.
7. `test_empty_operations_triggers_fetchPages` -- legacy fallback when operations array is empty.
8. `test_unknown_op_type_logs_warning` -- verify console.warn for unknown types, no crash.
9. `test_unknown_field_path_logs_warning` -- verify console.warn for unknown paths.
10. `test_missing_node_in_store_does_not_crash` -- set_field on a non-existent node should not throw.

Use mock `setState` function that records calls for assertion.

---

## Task 6: Wire Subscription Handler in Document Store

**Files:**
- Modify: `frontend/src/store/document-store-solid.tsx`
- Modify: `frontend/src/graphql/subscriptions.ts`
- Modify: `frontend/src/graphql/mutations.ts`

This task replaces the subscription wiring and adds `userId` to mutation calls.

- [ ] **Step 1: Add the new subscription query string**

In `frontend/src/graphql/subscriptions.ts`, add the new subscription alongside the existing one:

```typescript
export const TRANSACTION_APPLIED_SUBSCRIPTION = `
  subscription TransactionApplied {
    transactionApplied {
      transactionId
      userId
      seq
      operations {
        id
        nodeUuid
        type
        path
        value
      }
      eventType
      uuid
    }
  }
`;
```

Keep `DOCUMENT_CHANGED_SUBSCRIPTION` -- it will be removed in Phase 15d.

- [ ] **Step 2: Update mutation strings to pass userId**

In `frontend/src/graphql/mutations.ts`, add `$userId: String` parameter to each mutation. Example for `SET_TRANSFORM_MUTATION`:

```typescript
export const SET_TRANSFORM_MUTATION = `
  mutation SetTransform($uuid: String!, $transform: JSON!, $userId: String) {
    setTransform(uuid: $uuid, transform: $transform, userId: $userId) { uuid transform }
  }
`;
```

Apply the same pattern to all 17 mutation strings.

- [ ] **Step 3: Replace subscription handler in document store**

In `frontend/src/store/document-store-solid.tsx`, replace the subscription block (lines ~314-333):

```typescript
import { applyRemoteTransaction } from "../operations/apply-remote";
import { TRANSACTION_APPLIED_SUBSCRIPTION } from "../graphql/subscriptions";

// Track last received sequence number for future reconnect protocol
let lastSeq = 0;

const subscriptionHandle = client
  .subscription(gql(TRANSACTION_APPLIED_SUBSCRIPTION), {})
  .subscribe((result) => {
    if (result.error) {
      console.error("subscription error:", result.error.message);
      return;
    }

    const data = result.data as Record<string, unknown> | undefined;
    if (!data?.transactionApplied) return;

    let payload: RemoteTransactionPayload;
    try {
      payload = data.transactionApplied as RemoteTransactionPayload;
    } catch {
      console.error("Failed to parse transaction payload");
      return;
    }

    lastSeq = applyRemoteTransaction(
      payload,
      clientSessionId,
      setState,
      fetchPages,
    );
  });
```

- [ ] **Step 4: Pass `clientSessionId` as `userId` in all mutation calls**

In every mutation call inside `document-store-solid.tsx`, add the userId variable. Example:

```typescript
// Before:
void client.mutation(gql(SET_TRANSFORM_MUTATION), { uuid, transform }).toPromise()...

// After:
void client.mutation(gql(SET_TRANSFORM_MUTATION), {
  uuid,
  transform,
  userId: clientSessionId,
}).toPromise()...
```

Apply to all ~17 mutation call sites.

- [ ] **Step 5: Keep `fetchPages()` for initial load only**

`fetchPages()` remains and is still called on line ~336 for the initial load. The `debouncedFetchPages` variable can be removed since nothing calls it anymore. Remove the `debounce` import if it's no longer used elsewhere.

- [ ] **Step 6: Write integration tests**

If the project has E2E or integration tests that verify subscription behavior, update them to expect the new subscription format. At minimum, add a test note documenting that manual testing should verify:

1. Open two browser tabs to the same document.
2. Create a node in tab A -- it appears in tab B without a full refetch (verify via network inspector: no `pages` query after the subscription fires).
3. Rename a node in tab B -- tab A updates the name in the layers panel.
4. Delete a node in tab A -- it disappears from tab B.

---

## Sequencing and Dependencies

```
Task 1 (state crate)
    ↓
Task 2 (GraphQL types)  ←  depends on Task 1 types
    ↓
Task 3 (subscription)   ←  depends on Task 2 types
    ↓
Task 4 (mutation handlers) ← depends on Task 1 types
    ↓
Task 5 (frontend apply-remote)  ←  depends on Plan 15a types (soft dep, can use local types)
    ↓
Task 6 (wire everything)  ←  depends on Tasks 3, 4, 5
```

Tasks 1-4 are backend (Rust). Task 5 is frontend-only. Task 6 is the integration point. Tasks 2 and 3 can be done in a single commit. Task 4 is the largest (mechanical changes to 17 mutation handlers).

---

## Risk Notes

1. **Plan 15a dependency.** Task 5 imports from `frontend/src/operations/types.ts` which is created by Plan 15a. If 15a hasn't merged, Task 5 must define its own minimal types or be deferred until 15a lands. The types defined in Step 1 of Task 5 (`RemoteTransactionPayload`, `RemoteOperationPayload`) are self-contained and don't depend on 15a's types, so this task is safe to implement independently. The later Phase 15c integration will unify the types.

2. **GraphQL schema backwards compatibility.** The old `documentChanged` subscription is kept. Clients can subscribe to either `documentChanged` (legacy refetch) or `transactionApplied` (new direct-apply). Phase 15d removes the old subscription.

3. **MCP broadcast.** MCP mutation handlers in `crates/mcp/` also call `publish_event`. They need to be updated to call `publish_transaction` as well, but this can be done in a follow-up since MCP events will still work via the legacy fallback path (empty operations -> fetchPages). Add a TODO comment.

4. **GraphQL complexity limit.** The `TransactionAppliedEvent` with nested `operations` array may push queries past the `MAX_QUERY_COMPLEXITY = 500` limit. The subscription likely bypasses this (subscriptions use a different execution path in async-graphql), but verify during implementation.

---

### Critical Files for Implementation
- `/Volumes/projects/Personal/agent-designer/crates/state/src/lib.rs` - Core change: add AtomicU64 seq counter, TransactionPayload, OperationPayload structs, publish_transaction method
- `/Volumes/projects/Personal/agent-designer/crates/server/src/graphql/mutation.rs` - Largest change by line count: every mutation handler enriched with operation payload broadcast
- `/Volumes/projects/Personal/agent-designer/crates/server/src/graphql/subscription.rs` - New transactionApplied subscription stream alongside legacy documentChanged
- `/Volumes/projects/Personal/agent-designer/crates/server/src/graphql/types.rs` - New GraphQL types: OperationPayloadGql, TransactionAppliedEvent
- `/Volumes/projects/Personal/agent-designer/frontend/src/store/document-store-solid.tsx` - Wire new subscription handler, replace debouncedFetchPages with applyRemoteTransaction, pass userId to mutations