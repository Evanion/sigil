# Transparent Undo Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace explicit undo wiring in every mutation with a transparent interceptor that automatically captures store changes, and replace 16+ individual GraphQL mutations with a single type-safe `applyOperations` endpoint.

**Architecture:** A setState interceptor captures before/after values for document state writes and coalesces rapid changes via idle frame detection into single undo steps. The server exposes one `applyOperations` mutation using async-graphql's `OneofObject` for type-safe discriminated union inputs. Mutations become simple: update store + send ops to server. No history awareness.

**Tech Stack:** Solid.js 1.9, TypeScript strict, async-graphql 7.2 (OneofObject), Rust Edition 2024, Vitest, TDD

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `frontend/src/operations/interceptor.ts` | setState wrapper, idle coalescing, structural tracking, undo/redo coordination |
| `frontend/src/operations/__tests__/interceptor.test.ts` | Interceptor unit tests |

### Major modifications
| File | Changes |
|------|---------|
| `crates/server/src/graphql/mutation.rs` | Add `applyOperations` handler, delete 16+ individual handlers |
| `crates/server/src/graphql/types.rs` | Add OneofObject input types |
| `frontend/src/store/document-store-solid.tsx` | Strip all history wiring from mutations, use interceptor |
| `frontend/src/graphql/mutations.ts` | Replace all mutation strings with single `APPLY_OPERATIONS_MUTATION` |
| `frontend/src/operations/history-manager.ts` | Simplify: remove drag/transaction/popLastUndo methods |
| `frontend/src/store/document-store-types.ts` | Remove drag lifecycle from ToolStore |
| `frontend/src/tools/select-tool.ts` | Remove beginDrag/commitDrag/cancelDrag calls |

### Files to delete
| File | Reason |
|------|--------|
| `frontend/src/operations/store-history.ts` | Replaced by interceptor |
| `frontend/src/operations/__tests__/store-history-integration.test.ts` | Tests for deleted bridge |

---

## Task 1: Server — `applyOperations` endpoint with OneofObject input types

**Files:**
- Modify: `crates/server/src/graphql/types.rs`
- Modify: `crates/server/src/graphql/mutation.rs`
- Test: `crates/server/src/graphql/mutation.rs` (inline #[cfg(test)])

This task adds the new endpoint alongside existing mutations (they'll be deleted in Task 2). This allows incremental testing.

- [ ] **Step 1: Write the failing test for applyOperations**

In `crates/server/src/graphql/mutation.rs`, add a test at the bottom of the `#[cfg(test)]` module:

```rust
#[tokio::test]
async fn test_apply_operations_set_field_renames_node() {
    let state = test_state();
    let schema = build_test_schema(state.clone());

    // Create a node first
    let create_res = schema.execute(r#"
        mutation {
            createNode(kind: "frame", name: "TestNode", userId: "test-user") {
                uuid
            }
        }
    "#).await;
    let uuid = create_res.data.to_value()["createNode"]["uuid"]
        .as_str().unwrap().to_string();

    // Use applyOperations to rename it
    let rename_query = format!(r#"
        mutation {{
            applyOperations(
                operations: [{{ setField: {{ nodeUuid: "{uuid}", path: "name", value: "\"NewName\"" }} }}],
                userId: "test-user"
            ) {{
                seq
            }}
        }}
    "#);
    let res = schema.execute(&rename_query).await;
    assert!(res.errors.is_empty(), "errors: {:?}", res.errors);

    // Verify the rename happened
    let query_res = schema.execute(r#"{ pages { nodes { name } } }"#).await;
    let nodes = &query_res.data.to_value()["pages"][0]["nodes"];
    assert!(nodes.to_string().contains("NewName"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/Cargo.toml -p agent-designer-server test_apply_operations -- --nocapture`
Expected: FAIL — `applyOperations` resolver does not exist.

- [ ] **Step 3: Add OneofObject input types to types.rs**

In `crates/server/src/graphql/types.rs`, add:

```rust
use async_graphql::{OneofObject, InputObject};

/// Type-safe discriminated union for operation inputs.
/// Uses @oneOf — exactly one variant must be provided per input.
#[derive(OneofObject)]
pub enum OperationInput {
    SetField(SetFieldInput),
    CreateNode(CreateNodeInput),
    DeleteNode(DeleteNodeInput),
    Reparent(ReparentInput),
    Reorder(ReorderInput),
}

#[derive(InputObject)]
pub struct SetFieldInput {
    pub node_uuid: String,
    /// Field path: "transform", "name", "visible", "locked", "style.fills",
    /// "style.strokes", "style.effects", "style.opacity", "style.blend_mode", "kind"
    pub path: String,
    pub value: async_graphql::Json<serde_json::Value>,
}

#[derive(InputObject)]
pub struct CreateNodeInput {
    pub node_uuid: String,
    pub kind: async_graphql::Json<serde_json::Value>,
    pub name: String,
    pub transform: async_graphql::Json<serde_json::Value>,
    pub page_id: Option<String>,
}

#[derive(InputObject)]
pub struct DeleteNodeInput {
    pub node_uuid: String,
}

#[derive(InputObject)]
pub struct ReparentInput {
    pub node_uuid: String,
    pub new_parent_uuid: String,
    pub position: i32,
}

#[derive(InputObject)]
pub struct ReorderInput {
    pub node_uuid: String,
    pub new_position: i32,
}

/// Result returned by applyOperations.
#[derive(SimpleObject)]
pub struct ApplyOperationsResult {
    pub seq: String, // u64 as string (GraphQL Int is i32)
}
```

- [ ] **Step 4: Implement the `applyOperations` handler in mutation.rs**

Add to the `impl MutationRoot` block:

```rust
/// Generic operation endpoint — replaces all individual mutations.
///
/// Accepts a batch of typed operations via @oneOf discriminated union.
/// Validates all operations first, then applies atomically.
/// Broadcasts the transaction to other clients.
async fn apply_operations(
    &self,
    ctx: &Context<'_>,
    operations: Vec<OperationInput>,
    user_id: String,
) -> Result<ApplyOperationsResult> {
    use agent_designer_core::validate::MAX_BATCH_SIZE;

    let state = ctx.data::<ServerState>()?;

    if operations.is_empty() {
        return Err(async_graphql::Error::new("operations list must not be empty"));
    }
    if operations.len() > MAX_BATCH_SIZE {
        return Err(async_graphql::Error::new(format!(
            "too many operations: {} (max {MAX_BATCH_SIZE})",
            operations.len()
        )));
    }

    // Parse and build FieldOperation structs + broadcast payloads
    let mut field_ops: Vec<Box<dyn FnOnce(&mut Document) -> Result<(), CoreError>>> = Vec::new();
    let mut broadcast_ops: Vec<OperationPayload> = Vec::new();

    // First pass: parse all inputs (no lock needed)
    let mut parsed: Vec<ParsedOp> = Vec::new();
    for op_input in &operations {
        parsed.push(parse_operation_input(op_input)?);
    }

    // Second pass: validate + apply under lock
    let seq = {
        let mut doc_guard = acquire_document_lock(state);

        // Validate all
        for p in &parsed {
            p.validate(&doc_guard).map_err(|e| {
                async_graphql::Error::new(format!("validation failed: {e}"))
            })?;
        }

        // Apply all
        for p in &parsed {
            p.apply(&mut doc_guard).map_err(|e| {
                async_graphql::Error::new(format!("apply failed: {e}"))
            })?;
        }

        state.app.next_seq()
    };

    // Build broadcast payload
    for (op_input, p) in operations.iter().zip(parsed.iter()) {
        broadcast_ops.push(p.to_broadcast_payload());
    }

    // Signal dirty + broadcast
    state.app.signal_dirty();
    state.app.publish_transaction(
        MutationEventKind::NodeUpdated, // generic — clients use the ops
        None,
        multi_op_transaction(Some(user_id), broadcast_ops),
    );

    Ok(ApplyOperationsResult {
        seq: seq.to_string(),
    })
}
```

The `ParsedOp` helper struct and `parse_operation_input` function handle the variant→FieldOperation mapping. Implement these as private helpers in `mutation.rs`:

```rust
/// A parsed operation ready for validate + apply.
struct ParsedOp {
    op: Box<dyn agent_designer_core::FieldOperation>,
    broadcast: OperationPayload,
}

impl ParsedOp {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        self.op.validate(doc)
    }
    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        self.op.apply(doc)
    }
    fn to_broadcast_payload(&self) -> OperationPayload {
        self.broadcast.clone()
    }
}

fn parse_operation_input(input: &OperationInput) -> Result<ParsedOp> {
    match input {
        OperationInput::SetField(sf) => parse_set_field(sf),
        OperationInput::CreateNode(cn) => parse_create_node(cn),
        OperationInput::DeleteNode(dn) => parse_delete_node(dn),
        OperationInput::Reparent(rp) => parse_reparent(rp),
        OperationInput::Reorder(ro) => parse_reorder(ro),
    }
}
```

Each `parse_*` function constructs the appropriate `FieldOperation` struct and an `OperationPayload` for broadcast. `parse_set_field` dispatches on `path`:

```rust
fn parse_set_field(sf: &SetFieldInput) -> Result<ParsedOp> {
    let uuid = uuid::Uuid::parse_str(&sf.node_uuid)
        .map_err(|_| async_graphql::Error::new("invalid node UUID"))?;

    let broadcast = OperationPayload {
        id: uuid::Uuid::new_v4().to_string(),
        node_uuid: sf.node_uuid.clone(),
        op_type: "set_field".to_string(),
        path: sf.path.clone(),
        value: Some(sf.value.0.clone()),
    };

    let op: Box<dyn FieldOperation> = match sf.path.as_str() {
        "transform" => {
            let t: Transform = serde_json::from_value(sf.value.0.clone())?;
            Box::new(SetTransform { node_id: NodeId::new(0, 0), new_transform: t })
            // NOTE: node_id resolved inside validate/apply via uuid lookup
        }
        "name" => {
            let name: String = serde_json::from_value(sf.value.0.clone())?;
            Box::new(RenameNode { node_id: NodeId::new(0, 0), new_name: name })
        }
        // ... other paths
        _ => return Err(async_graphql::Error::new(format!("unknown field path: {}", sf.path))),
    };

    Ok(ParsedOp { op, broadcast })
}
```

**IMPORTANT:** The current `FieldOperation` structs use `NodeId` (arena index), but the client sends UUIDs. The handler must resolve UUID→NodeId inside the lock scope. This means `ParsedOp` needs a `resolve` step. Adjust the pattern:

```rust
struct ParsedOp {
    /// Builds the FieldOperation after UUID resolution.
    builder: Box<dyn FnOnce(&Document) -> Result<Box<dyn FieldOperation>, CoreError>>,
    broadcast: OperationPayload,
}

impl ParsedOp {
    fn build(&self, doc: &Document) -> Result<Box<dyn FieldOperation>, CoreError> {
        (self.builder)(doc)
    }
}
```

Then in the lock scope:
```rust
let mut doc_guard = acquire_document_lock(state);

// Build (resolve UUIDs) + validate
let mut built: Vec<Box<dyn FieldOperation>> = Vec::new();
for p in &parsed {
    let op = p.build(&doc_guard)?;
    op.validate(&doc_guard)?;
    built.push(op);
}

// Apply all
for op in &built {
    op.apply(&mut doc_guard)?;
}
```

Implement `parse_set_field`, `parse_create_node`, `parse_delete_node`, `parse_reparent`, `parse_reorder` following this pattern. Each resolves UUID to NodeId via `doc.arena.id_by_uuid()`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/Cargo.toml -p agent-designer-server test_apply_operations -- --nocapture`
Expected: PASS

- [ ] **Step 6: Add more tests for applyOperations**

Add these tests:
- `test_apply_operations_multiple_ops_atomic` — send 2 ops, verify both applied
- `test_apply_operations_invalid_rejects_entire_batch` — one bad op rejects all
- `test_apply_operations_create_and_reparent` — structural ops work
- `test_apply_operations_empty_rejected` — empty operations list returns error
- `test_apply_operations_batch_size_limit` — exceeding MAX_BATCH_SIZE returns error

- [ ] **Step 7: Run all tests**

Run: `cargo test --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/Cargo.toml --workspace`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add crates/server/src/graphql/types.rs crates/server/src/graphql/mutation.rs
git commit -m "feat(server): add applyOperations endpoint with OneofObject type-safe inputs (Spec 15e, Task 1)"
```

---

## Task 2: Server — Delete individual mutation handlers

**Files:**
- Modify: `crates/server/src/graphql/mutation.rs`
- Modify: `crates/server/src/graphql/types.rs`

- [ ] **Step 1: Delete all individual mutation handlers from MutationRoot**

Remove these methods from `impl MutationRoot`:
- `create_node`, `delete_node`, `rename_node`, `set_transform`
- `set_fills`, `set_strokes`, `set_effects`, `set_opacity`, `set_blend_mode`
- `set_corner_radii`, `set_visible`, `set_locked`
- `reparent_node`, `reorder_children`
- `batch_set_transform`, `group_nodes`, `ungroup_nodes`

Keep: `apply_operations` (from Task 1), and any non-document mutations if they exist.

Also remove the helper functions that are only used by deleted handlers:
- `field_set_transaction()` — if only used by old handlers
- `build_ungroup_reparent_ops()` — group/ungroup moves to client

Keep: `acquire_document_lock()`, `multi_op_transaction()`, `node_to_gql()`.

- [ ] **Step 2: Remove dead result types from types.rs**

Remove types only used by deleted mutations:
- `CreateNodeResult`
- `NodeGql` (if only used by deleted mutations — check if subscription or query uses it too)
- Any other dead types

Keep: `OperationInput`, `SetFieldInput`, `CreateNodeInput`, `DeleteNodeInput`, `ReparentInput`, `ReorderInput`, `ApplyOperationsResult`, `DocumentInfoGql`, `OperationPayloadGql`, `TransactionAppliedEvent`, `DocumentEvent`, `DocumentEventType`.

- [ ] **Step 3: Remove dead tests**

Delete all tests that call the deleted mutation handlers. Keep tests for `apply_operations`.

- [ ] **Step 4: Run full workspace tests**

Run: `cargo test --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/Cargo.toml --workspace`
Run: `cargo clippy --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/Cargo.toml --workspace -- -D warnings`

Fix any dead import warnings or unused code.

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/graphql/mutation.rs crates/server/src/graphql/types.rs
git commit -m "refactor(server): delete 16 individual mutation handlers — applyOperations is the only endpoint (Spec 15e, Task 2)"
```

---

## Task 3: Frontend — Create the interceptor

**Files:**
- Create: `frontend/src/operations/interceptor.ts`
- Create: `frontend/src/operations/__tests__/interceptor.test.ts`

This is the core of the transparent undo system. No integration yet — pure unit-testable module.

- [ ] **Step 1: Write failing tests for the interceptor**

Create `frontend/src/operations/__tests__/interceptor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStore } from "solid-js/store";
import { createInterceptor, type Interceptor } from "../interceptor";
import { HistoryManager } from "../history-manager";

// Mock rAF for deterministic testing
let rafCallback: (() => void) | null = null;
const mockRaf = vi.fn((cb: FrameRequestCallback) => {
  rafCallback = cb as unknown as () => void;
  return 1;
});
const mockCancelRaf = vi.fn();

function flushFrame() {
  if (rafCallback) {
    const cb = rafCallback;
    rafCallback = null;
    cb();
  }
}

describe("Interceptor", () => {
  let setState: (...args: unknown[]) => void;
  let state: Record<string, unknown>;
  let historyManager: HistoryManager;
  let interceptor: Interceptor;

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", mockRaf);
    vi.stubGlobal("cancelAnimationFrame", mockCancelRaf);

    const [s, ss] = createStore({
      nodes: {} as Record<string, Record<string, unknown>>,
      pages: [] as unknown[],
      info: { name: "", page_count: 0, node_count: 0 },
    });
    state = s as unknown as Record<string, unknown>;
    setState = ss as unknown as (...args: unknown[]) => void;

    historyManager = new HistoryManager("test-user");
    interceptor = createInterceptor(state, setState, historyManager, "test-user");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("single field write creates one undo step after idle frame", () => {
    // Pre-populate a node
    setState("nodes", "node-1", {
      name: "OldName",
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
    });

    interceptor.set("node-1", "name", "NewName");
    expect(historyManager.canUndo()).toBe(false); // not committed yet

    flushFrame();
    expect(historyManager.canUndo()).toBe(true); // committed
  });

  it("rapid writes to same node+field coalesce into one step", () => {
    setState("nodes", "node-1", { name: "Original" });

    interceptor.set("node-1", "name", "A");
    interceptor.set("node-1", "name", "B");
    interceptor.set("node-1", "name", "C");

    flushFrame();
    expect(historyManager.canUndo()).toBe(true);

    // Undo should revert to "Original", not "B"
    const inverseTx = historyManager.undo();
    expect(inverseTx).not.toBeNull();
    expect(inverseTx!.operations).toHaveLength(1);
    expect(inverseTx!.operations[0].value).toBe("Original"); // before value
  });

  it("writes to different nodes in same frame become one step", () => {
    setState("nodes", "node-1", { name: "A" });
    setState("nodes", "node-2", { name: "B" });

    interceptor.set("node-1", "name", "A2");
    interceptor.set("node-2", "name", "B2");

    flushFrame();
    expect(historyManager.canUndo()).toBe(true);

    const inverseTx = historyManager.undo();
    expect(inverseTx!.operations).toHaveLength(2);
  });

  it("ignores writes during undo", () => {
    setState("nodes", "node-1", { name: "Original" });
    interceptor.set("node-1", "name", "Changed");
    flushFrame();

    // Undo — interceptor should ignore the writes it triggers
    interceptor.undo();

    // Should not have created a new undo step from the undo writes
    expect(historyManager.canUndo()).toBe(false);
  });

  it("trackStructural adds to buffer", () => {
    interceptor.trackStructural({
      id: "op-1",
      userId: "test-user",
      nodeUuid: "node-1",
      type: "create_node",
      path: "",
      value: { uuid: "node-1", name: "New" },
      previousValue: null,
      seq: 0,
    });

    flushFrame();
    expect(historyManager.canUndo()).toBe(true);
  });

  it("force-flushes buffer on undo if pending", () => {
    setState("nodes", "node-1", { name: "Original" });
    interceptor.set("node-1", "name", "Changed");
    // Don't flush — buffer is pending

    interceptor.undo(); // should force-flush first, then undo

    // The flush created one step, then undo popped it
    expect(historyManager.canUndo()).toBe(false);
    expect(historyManager.canRedo()).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --prefix /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/frontend vitest run src/operations/__tests__/interceptor.test.ts`
Expected: FAIL — `../interceptor` module does not exist.

- [ ] **Step 3: Implement the interceptor**

Create `frontend/src/operations/interceptor.ts`:

```typescript
/**
 * Transparent undo interceptor for Solid stores.
 *
 * Wraps setState to automatically capture before/after values for document
 * state changes (nodes, pages). UI state (info, selection, etc.) is not tracked.
 *
 * Idle coalescing: all changes within a single animation frame are grouped
 * into one undo step. If new writes arrive before the rAF fires, the frame
 * is rescheduled, extending the coalesce window.
 *
 * Structural operations (create/delete/reparent/reorder) must be registered
 * explicitly via trackStructural() — the only concession to transparency.
 */

import { batch } from "solid-js";
import type { Operation, Transaction } from "./types";
import type { HistoryManager } from "./history-manager";
import { createSetFieldOp, createInverseTransaction } from "./operation-helpers";
import { applyOperationToStore, type StoreStateSetter, type StoreStateReader } from "./apply-to-store";

/** Buffered change awaiting coalesce commit. */
interface BufferedChange {
  nodeUuid: string;
  path: string;
  beforeValue: unknown;
  afterValue: unknown;
}

/** Side-effect context snapshot (restored on undo/redo). */
interface SideEffectContext {
  selectedNodeIds: string[];
  activeTool: string;
  viewport: { x: number; y: number; zoom: number };
}

export interface Interceptor {
  /**
   * Set a field on a node. Automatically tracked for undo.
   * The interceptor reads the current value (before), applies via setState,
   * and buffers the change for coalescing.
   */
  set(nodeUuid: string, path: string, value: unknown): void;

  /**
   * Register a structural operation (create/delete/reparent/reorder).
   * Called by the ~4 structural mutations after they modify the store.
   */
  trackStructural(op: Operation): void;

  /** Undo the most recent undo step. Returns the inverse Transaction for server sync. */
  undo(): Transaction | null;

  /** Redo the most recently undone step. Returns the Transaction for server sync. */
  redo(): Transaction | null;

  /** Whether undo is available (reactive signal). */
  canUndo(): boolean;

  /** Whether redo is available (reactive signal). */
  canRedo(): boolean;

  /**
   * Force-flush the pending buffer into a committed undo step.
   * Called externally if needed (e.g., before navigation).
   */
  flush(): void;

  /** Set the side-effect context readers (called once during store init). */
  setSideEffectReaders(readers: {
    getSelectedNodeIds: () => string[];
    setSelectedNodeIds: (ids: string[]) => void;
    getActiveTool: () => string;
    setActiveTool: (tool: string) => void;
    getViewport: () => { x: number; y: number; zoom: number };
    setViewport: (vp: { x: number; y: number; zoom: number }) => void;
  }): void;
}

/**
 * Deep clone a value. Uses JSON round-trip because Solid store proxies
 * throw DataCloneError with structuredClone.
 */
function deepClone<T>(value: T): T {
  // JSON clone: Solid proxy not structuredClone-safe
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Read a value from the store at the given node+path.
 * Returns a deep clone (safe from Solid proxy issues).
 */
function readStorePath(
  state: Record<string, unknown>,
  nodeUuid: string,
  path: string,
): unknown {
  const nodes = state["nodes"] as Record<string, Record<string, unknown>> | undefined;
  if (!nodes) return undefined;
  const node = nodes[nodeUuid];
  if (!node) return undefined;

  if (path.startsWith("style.")) {
    const styleProp = path.slice(6);
    const style = node["style"] as Record<string, unknown> | undefined;
    return style ? deepClone(style[styleProp]) : undefined;
  }

  // Top-level field: "name", "transform", "visible", "locked", "kind"
  const value = node[path];
  if (value === undefined || value === null) return value;
  if (typeof value === "object") return deepClone(value);
  return value; // primitive — no clone needed
}

/**
 * Apply a value to the store at the given node+path.
 * Mirrors the logic in apply-to-store.ts for set_field operations.
 */
function writeStorePath(
  setState: StoreStateSetter,
  nodeUuid: string,
  path: string,
  value: unknown,
): void {
  if (path.startsWith("style.")) {
    const styleProp = path.slice(6);
    // Use produce for nested style fields
    const { produce } = require("solid-js/store");
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

  // Top-level field
  setState("nodes", nodeUuid, path, value);
}

export function createInterceptor(
  state: Record<string, unknown>,
  setState: StoreStateSetter,
  historyManager: HistoryManager,
  userId: string,
): Interceptor {
  /** Buffer of changes awaiting coalesce commit. */
  const buffer: Map<string, BufferedChange> = new Map(); // key: "nodeUuid::path"
  /** Structural operations in the current buffer. */
  const structuralBuffer: Operation[] = [];
  /** rAF handle for idle detection. */
  let rafHandle: number | null = null;
  /** Flag to suppress tracking during undo/redo application. */
  let isUndoing = false;
  /** Side-effect context before the current buffer started. */
  let contextSnapshot: SideEffectContext | null = null;
  /** Side-effect readers/writers — set during store init. */
  let sideEffectReaders: {
    getSelectedNodeIds: () => string[];
    setSelectedNodeIds: (ids: string[]) => void;
    getActiveTool: () => string;
    setActiveTool: (tool: string) => void;
    getViewport: () => { x: number; y: number; zoom: number };
    setViewport: (vp: { x: number; y: number; zoom: number }) => void;
  } | null = null;

  function captureContext(): SideEffectContext {
    if (!sideEffectReaders) {
      return { selectedNodeIds: [], activeTool: "select", viewport: { x: 0, y: 0, zoom: 1 } };
    }
    return {
      selectedNodeIds: [...sideEffectReaders.getSelectedNodeIds()],
      activeTool: sideEffectReaders.getActiveTool(),
      viewport: { ...sideEffectReaders.getViewport() },
    };
  }

  function restoreContext(ctx: SideEffectContext): void {
    if (!sideEffectReaders) return;
    sideEffectReaders.setSelectedNodeIds(ctx.selectedNodeIds);
    sideEffectReaders.setActiveTool(ctx.activeTool);
    sideEffectReaders.setViewport(ctx.viewport);
  }

  function scheduleFlush(): void {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
    }
    rafHandle = requestAnimationFrame(() => {
      rafHandle = null;
      commitBuffer();
    });
  }

  function commitBuffer(): void {
    if (buffer.size === 0 && structuralBuffer.length === 0) return;

    // Build operations from buffered field changes
    const ops: Operation[] = [];
    for (const change of buffer.values()) {
      ops.push(
        createSetFieldOp(userId, change.nodeUuid, change.path, change.afterValue, change.beforeValue),
      );
    }
    // Add structural operations
    ops.push(...structuralBuffer);

    if (ops.length === 0) return;

    // Create transaction and push to history
    const tx: Transaction = {
      id: crypto.randomUUID(),
      userId,
      operations: ops,
      description: "", // auto-generated, not shown to user
      timestamp: Date.now(),
      seq: 0,
    };

    // Store context snapshot WITH the transaction for undo/redo restoration
    // We attach it as metadata (extend Transaction type or use a side map)
    (tx as Transaction & { _context?: SideEffectContext })._context = contextSnapshot;

    historyManager.pushTransaction(tx);

    // Clear buffer
    buffer.clear();
    structuralBuffer.length = 0;
    contextSnapshot = null;
  }

  return {
    set(nodeUuid: string, path: string, value: unknown): void {
      if (isUndoing) return; // ignore writes during undo/redo

      const key = `${nodeUuid}::${path}`;
      const existing = buffer.get(key);

      if (!existing) {
        // First write to this path — capture before value and context
        if (buffer.size === 0 && structuralBuffer.length === 0) {
          contextSnapshot = captureContext();
        }
        const beforeValue = readStorePath(state, nodeUuid, path);
        buffer.set(key, { nodeUuid, path, beforeValue, afterValue: value });
      } else {
        // Subsequent write — only update afterValue (before stays from first write)
        existing.afterValue = value;
      }

      // Apply to store immediately (optimistic)
      writeStorePath(setState, nodeUuid, path, value);

      // Reschedule coalesce
      scheduleFlush();
    },

    trackStructural(op: Operation): void {
      if (isUndoing) return;

      if (buffer.size === 0 && structuralBuffer.length === 0) {
        contextSnapshot = captureContext();
      }
      structuralBuffer.push(op);
      scheduleFlush();
    },

    flush(): void {
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
      commitBuffer();
    },

    undo(): Transaction | null {
      // Force-flush pending buffer first
      if (buffer.size > 0 || structuralBuffer.length > 0) {
        this.flush();
      }

      const inverseTx = historyManager.undo();
      if (!inverseTx) return null;

      // Apply inverse to store without triggering interceptor
      isUndoing = true;
      const reader: StoreStateReader = {
        getNode: (uuid: string) =>
          (state as { nodes: Record<string, Record<string, unknown>> }).nodes[uuid],
      };
      batch(() => {
        for (const op of inverseTx.operations) {
          applyOperationToStore(op, setState, reader);
        }
      });

      // Restore side-effect context from the ORIGINAL transaction (not inverse)
      // The context was captured when the buffer started
      const originalTx = historyManager.peekRedo();
      const ctx = (originalTx as Transaction & { _context?: SideEffectContext })?._context;
      if (ctx) restoreContext(ctx);

      isUndoing = false;
      return inverseTx;
    },

    redo(): Transaction | null {
      const redoTx = historyManager.redo();
      if (!redoTx) return null;

      isUndoing = true;
      const reader: StoreStateReader = {
        getNode: (uuid: string) =>
          (state as { nodes: Record<string, Record<string, unknown>> }).nodes[uuid],
      };
      batch(() => {
        for (const op of redoTx.operations) {
          applyOperationToStore(op, setState, reader);
        }
      });
      isUndoing = false;
      return redoTx;
    },

    canUndo(): boolean {
      return historyManager.canUndo();
    },

    canRedo(): boolean {
      return historyManager.canRedo();
    },

    setSideEffectReaders(readers) {
      sideEffectReaders = readers;
    },
  };
}
```

**NOTE:** The `HistoryManager` needs a `pushTransaction(tx)` method that pushes directly to the undo stack (bypassing the auto-wrap that `apply()` does). Also needs a `peekRedo()` to get the context from the original transaction. These will be added in Task 5 when we simplify HistoryManager.

For now, use `historyManager.apply(ops[0], "")` for single-op transactions, or add a minimal `pushTransaction` if needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --prefix /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/frontend vitest run src/operations/__tests__/interceptor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/operations/interceptor.ts frontend/src/operations/__tests__/interceptor.test.ts
git commit -m "feat(frontend): add transparent undo interceptor with idle coalescing (Spec 15e, Task 3)"
```

---

## Task 4: Frontend — Replace mutations.ts with single APPLY_OPERATIONS_MUTATION

**Files:**
- Modify: `frontend/src/graphql/mutations.ts`

- [ ] **Step 1: Replace all mutation strings with single endpoint**

Replace the entire contents of `frontend/src/graphql/mutations.ts` with:

```typescript
/**
 * Single GraphQL mutation for all document operations.
 * Replaces 16+ individual mutations with one type-safe endpoint.
 *
 * Uses @oneOf input types — exactly one variant per OperationInput.
 */
export const APPLY_OPERATIONS_MUTATION = `
  mutation ApplyOperations($operations: [OperationInput!]!, $userId: String!) {
    applyOperations(operations: $operations, userId: $userId) {
      seq
    }
  }
`;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/graphql/mutations.ts
git commit -m "refactor(frontend): replace 16 mutation strings with single APPLY_OPERATIONS_MUTATION (Spec 15e, Task 4)"
```

---

## Task 5: Frontend — Simplify HistoryManager

**Files:**
- Modify: `frontend/src/operations/history-manager.ts`
- Modify: `frontend/src/operations/__tests__/history-manager.test.ts`

Remove drag coalescing, explicit transactions, and popLastUndo. Add `pushTransaction()` and `peekRedo()`.

- [ ] **Step 1: Simplify HistoryManager**

Remove these methods:
- `beginTransaction`, `addOperation`, `commitTransaction`, `cancelTransaction`
- `beginDrag`, `updateDrag`, `commitDrag`, `cancelDrag`
- `popLastUndo`

Remove the `DragState` interface and `pendingTxOps`/`pendingTxDescription`/`dragState` fields.

Add:
```typescript
/** Push a pre-built transaction to the undo stack. Clears redo. */
pushTransaction(tx: Transaction): void {
  this.pushUndo(tx);
  this.redoStack = [];
}

/** Peek at the top of the redo stack without popping (for context restoration). */
peekRedo(): Transaction | null {
  return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1] : null;
}
```

Keep: `apply()` (still useful as a convenience for single-op pushes), `undo()`, `redo()`, `canUndo()`, `canRedo()`, `clear()`, `getUndoStack()`, `getRedoStack()`, `restoreStacks()`.

- [ ] **Step 2: Update tests**

Remove tests for deleted methods. Add tests for `pushTransaction` and `peekRedo`.

- [ ] **Step 3: Run tests**

Run: `pnpm --prefix /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/frontend vitest run src/operations/__tests__/history-manager.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/operations/history-manager.ts frontend/src/operations/__tests__/history-manager.test.ts
git commit -m "refactor(frontend): simplify HistoryManager — remove drag/transaction/rollback methods (Spec 15e, Task 5)"
```

---

## Task 6: Frontend — Refactor document-store-solid.tsx to use interceptor

**Files:**
- Modify: `frontend/src/store/document-store-solid.tsx`
- Delete: `frontend/src/operations/store-history.ts`
- Delete: `frontend/src/operations/__tests__/store-history-integration.test.ts`
- Modify: `frontend/src/operations/index.ts`

This is the largest task — stripping all explicit history wiring from 18 mutations and replacing with the interceptor.

- [ ] **Step 1: Replace history bridge with interceptor**

In `document-store-solid.tsx`:

Remove:
- Import of `createStoreHistoryBridge`
- Import of `createSetFieldOp`, `createCreateNodeOp`, `createDeleteNodeOp`, `createReparentOp`, `createReorderOp`
- The `rawBridge` and wrapped `history` object
- The `syncHistorySignals()` function and `canUndoSignal`/`canRedoSignal` signals
- All `deepClone` for before-value capture in mutations

Add:
```typescript
import { createInterceptor } from "../operations/interceptor";
import { APPLY_OPERATIONS_MUTATION } from "../graphql/mutations";

// Interceptor — transparent undo tracking
const interceptor = createInterceptor(
  state as unknown as Record<string, unknown>,
  setState as unknown as StoreStateSetter,
  historyManager,
  clientSessionId,
);

// Wire side-effect context readers
interceptor.setSideEffectReaders({
  getSelectedNodeIds: selectedNodeIds,
  setSelectedNodeIds,
  getActiveTool: activeTool,
  setActiveTool,
  getViewport: viewport,
  setViewport,
});

// Reactive undo/redo signals driven by interceptor
const canUndo = () => interceptor.canUndo();
const canRedo = () => interceptor.canRedo();
```

**NOTE:** `canUndo`/`canRedo` reactivity — since HistoryManager is a plain class, these won't be reactive by themselves. The interceptor should update Solid signals after each commit/undo/redo. Add `createSignal` wrappers:

```typescript
const [canUndoSignal, setCanUndoSignal] = createSignal(false);
const [canRedoSignal, setCanRedoSignal] = createSignal(false);
// Interceptor calls these after commit/undo/redo
```

Wire the signal updates into the interceptor (add a callback parameter or call them after each interceptor operation).

- [ ] **Step 2: Refactor field mutations**

Transform every field mutation from:
```typescript
function setTransform(uuid: string, transform: Transform): void {
  const node = state.nodes[uuid];
  if (!node) return;
  const previous = { ...node.transform };
  const op = createSetFieldOp(clientSessionId, uuid, "transform", transform, previous);
  history.applyAndTrack(op, `Move ${node.name}`);
  client.mutation(gql(SET_TRANSFORM_MUTATION), { uuid, transform: { ...transform }, userId: clientSessionId })...
}
```

To:
```typescript
function setTransform(uuid: string, transform: Transform): void {
  const node = state.nodes[uuid];
  if (!node) return;
  interceptor.set(uuid, "transform", { ...transform });
  sendOps([{ setField: { nodeUuid: uuid, path: "transform", value: transform } }]);
}
```

Where `sendOps` is a helper that sends to the server:
```typescript
function sendOps(operations: OperationInput[]): void {
  client
    .mutation(gql(APPLY_OPERATIONS_MUTATION), {
      operations,
      userId: clientSessionId,
    })
    .toPromise()
    .then((r) => {
      if (r.error) {
        console.error("applyOperations error:", r.error.message);
        // TODO: revert optimistic state
      }
    })
    .catch((err: unknown) => {
      console.error("applyOperations exception:", err);
    });
}
```

Apply this transformation to ALL field mutations:
- `setTransform` — `interceptor.set(uuid, "transform", transform)`
- `renameNode` — `interceptor.set(uuid, "name", newName)`
- `setVisible` — `interceptor.set(uuid, "visible", visible)`
- `setLocked` — `interceptor.set(uuid, "locked", locked)`
- `setOpacity` — `interceptor.set(uuid, "style.opacity", { type: "literal", value: opacity })`
- `setBlendMode` — `interceptor.set(uuid, "style.blend_mode", blendMode)`
- `setFills` — `interceptor.set(uuid, "style.fills", deepClone(fills))`
- `setStrokes` — `interceptor.set(uuid, "style.strokes", deepClone(strokes))`
- `setEffects` — `interceptor.set(uuid, "style.effects", deepClone(effects))`
- `setCornerRadii` — `interceptor.set(uuid, "kind", newKind)`

- [ ] **Step 3: Refactor structural mutations**

`createNode`:
```typescript
function createNode(kind: NodeKind, name: string, transform: Transform): string {
  const uuid = crypto.randomUUID();
  const nodeData = { uuid, kind, name, transform, ... };

  // Apply to store (interceptor auto-tracks field sets, but this is a new key)
  setState("nodes", uuid, nodeData);

  // Register structural op
  interceptor.trackStructural(createCreateNodeOp(clientSessionId, nodeData));

  // Send to server
  sendOps([{ createNode: { nodeUuid: uuid, kind, name, transform, pageId } }]);

  return uuid;
}
```

Similarly for `deleteNode`, `reparentNode`, `reorderChildren`.

- [ ] **Step 4: Refactor undo/redo**

```typescript
function undo(): void {
  const inverseTx = interceptor.undo();
  if (!inverseTx) return;
  sendOps(transactionToServerOps(inverseTx));
  syncHistorySignals();
}

function redo(): void {
  const redoTx = interceptor.redo();
  if (!redoTx) return;
  sendOps(transactionToServerOps(redoTx));
  syncHistorySignals();
}
```

Where `transactionToServerOps` maps a Transaction's Operations to `OperationInput[]` for the server.

- [ ] **Step 5: Move group/ungroup to client-side**

`groupNodes` becomes pure client logic:
1. Compute union bounding box of selected nodes
2. Create group node with that transform
3. Reparent each child under the group, adjust transforms to group-relative
4. Send all as one `applyOperations` batch

`ungroupNodes` similarly.

- [ ] **Step 6: Remove drag lifecycle from store API**

Remove `beginDrag`, `commitDrag`, `cancelDrag` from `DocumentStoreAPI` interface and implementation.

- [ ] **Step 7: Delete store-history.ts and its tests**

Delete:
- `frontend/src/operations/store-history.ts`
- `frontend/src/operations/__tests__/store-history-integration.test.ts`

Update `frontend/src/operations/index.ts` to remove `store-history` exports and add `interceptor` export.

- [ ] **Step 8: Run all frontend tests**

Run: `pnpm --prefix /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/frontend test`
Fix any import errors, type errors, or test failures.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(frontend): transparent undo — mutations no longer know about history (Spec 15e, Task 6)"
```

---

## Task 7: Frontend — Update select-tool and ToolStore

**Files:**
- Modify: `frontend/src/store/document-store-types.ts`
- Modify: `frontend/src/tools/select-tool.ts`
- Modify: `frontend/src/tools/__tests__/select-tool.test.ts`

- [ ] **Step 1: Remove drag lifecycle from ToolStore**

In `document-store-types.ts`, remove:
```typescript
beginDrag(nodeUuid: string, path: string): void;
commitDrag(): void;
cancelDrag(): void;
```

- [ ] **Step 2: Remove drag calls from select-tool.ts**

Remove all `store.beginDrag(...)`, `store.commitDrag()`, `store.cancelDrag()` calls. The select tool already uses preview transforms during drag and only calls `store.setTransform()` on pointerUp — the interceptor handles coalescing automatically.

- [ ] **Step 3: Update test mocks**

Update `select-tool.test.ts` and any `.stories.tsx` files that mock the store to remove `beginDrag`/`commitDrag`/`cancelDrag`.

- [ ] **Step 4: Run tests**

Run: `pnpm --prefix /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/frontend test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(frontend): remove drag lifecycle from ToolStore and select-tool (Spec 15e, Task 7)"
```

---

## Task 8: Integration testing and cleanup

**Files:**
- Modify: `frontend/src/store/__tests__/undo-redo-integration.test.ts`
- Modify: `frontend/src/store/__tests__/mutation-operations.test.ts`
- Various `.stories.tsx` files

- [ ] **Step 1: Rewrite undo-redo integration tests**

Update to test the new interceptor-based flow:
- Create node → interceptor.set + trackStructural → flush → undo → node gone
- Rename → interceptor.set → flush → undo → name reverted
- Rapid setFills (simulate color picker) → flush → single Cmd+Z reverts all
- batchSetTransform (align) → flush → single Cmd+Z reverts all

- [ ] **Step 2: Update mutation-operations tests**

Remove references to `history.applyAndTrack`, `createSetFieldOp`, etc. Tests should verify mutations call `interceptor.set` or `sendOps`.

- [ ] **Step 3: Update story mocks**

Update all `.stories.tsx` files that mock the store to remove `beginDrag`/`commitDrag`/`cancelDrag` and add any new methods from the interceptor API.

- [ ] **Step 4: Run full test suite**

Run: `pnpm --prefix /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/frontend test`
Run: `pnpm --prefix /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/frontend lint`
Run: `pnpm --prefix /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/frontend format`

- [ ] **Step 5: Run Rust tests too**

Run: `cargo test --workspace --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/Cargo.toml`
Run: `cargo clippy --workspace --manifest-path /Volumes/projects/Personal/agent-designer/.worktrees/feature/server-simplification/Cargo.toml -- -D warnings`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(frontend): update integration tests for transparent undo (Spec 15e, Task 8)"
```

---

## Dependency Graph

```
Task 1 (Server: applyOperations endpoint)
  └─► Task 2 (Server: delete old mutations)
       └─► Task 4 (Frontend: APPLY_OPERATIONS_MUTATION string)

Task 3 (Frontend: interceptor module)  ← independent of server tasks
  └─► Task 5 (Frontend: simplify HistoryManager)
       └─► Task 6 (Frontend: refactor document-store)
            └─► Task 7 (Frontend: update select-tool/ToolStore)
                 └─► Task 8 (Integration tests + cleanup)
```

Tasks 1-2 (server) and Tasks 3+5 (frontend interceptor + HistoryManager) can be done in parallel. Task 6 needs both server endpoint (Task 2) and interceptor (Task 5) complete.
