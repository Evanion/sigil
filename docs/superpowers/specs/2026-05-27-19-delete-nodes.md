# Spec 19 — Atomic Multi-Node Delete (DeleteNodes)

**Status:** Draft
**Author:** Mikael Pettersson (brainstormed 2026-05-27)
**Depends on:** Spec 15 (client-side HistoryManager + transaction support), existing FieldOperation infrastructure.
**Replaces:** the singular `DeleteNode` FieldOperation (this is a full migration; see §4).
**Estimated PR size:** 500-700 LOC including tests + spec/inventory updates.

---

## Overview

Multi-node delete in Sigil today loops individual `deleteNode` calls — N selected nodes produce N undo entries, N server roundtrips, and N broadcast events. The TODO at `frontend/src/shell/Canvas.tsx:611-636` flags this directly. This spec replaces the singular `DeleteNode` FieldOperation with `DeleteNodes` (atomic batch), updates every dispatch site, and removes the superseded singular path entirely.

The result: pressing Delete with N nodes selected produces one history transaction, one server roundtrip, one broadcast, and one Ctrl+Z restoration that brings every deleted node back at its original parent and sibling position.

---

## Motivation

- **History flooding.** Selecting 10 nodes and pressing Delete forces 10 Ctrl+Z presses to recover. Violates the "feels like Figma/Penpot" UX requirement in CLAUDE.md §1.
- **Server roundtrip storm.** N HTTP calls for one user action — measurable lag at the 100-node scale, and visible jitter as the canvas re-renders between each server response.
- **Cross-client broadcast asymmetry.** Other clients see N delete events arriving in sequence — a momentary partial-deletion state is visible.
- **Agent ergonomics.** MCP agents wanting to delete N nodes must compose N tool calls or build a multi-op `apply_operations` payload manually. A single `delete_nodes` tool is more token-efficient.

A previous "fix-this-from-the-frontend" approach (build a transaction client-side, send N delete ops in one apply_operations) was considered and rejected: it leaves the atomicity at the orchestration layer rather than the core, and keeps two redundant code paths (singular + plural) for the same operation. The right solution is one canonical multi-delete FieldOperation.

---

## Goals

1. **Atomic multi-delete at the core.** `DeleteNodes` is one `FieldOperation` with `validate()` that pre-checks every UUID and `apply()` that is all-or-nothing with explicit rollback on partial failure.
2. **Hierarchy-aware semantics.** Deduplicate ancestor/descendant pairs in the input; capture subtree snapshots; restore in sibling-index order on undo so the original layout is reconstructed exactly.
3. **Single transaction, single roundtrip, single broadcast.** Pressing Delete with N selected nodes produces exactly one of each.
4. **Full removal of the singular `DeleteNode`.** No half-migration. Every dispatch site updated; no `DeleteNode`/`delete_node`/`createDeleteNodeOp` references remain anywhere in the repo (excluding the spec/inventory tracking files).
5. **Cross-language parity.** Rust `crates/core/` and frontend `apply-remote.ts` agree on the wire format via a parity fixture.

---

## Non-goals

- **`CreateNodes` symmetric counterpart.** The inverse of DeleteNodes is N individual `CreateNode` ops bundled in a transaction. Adding a symmetric multi-create FieldOperation is a separate spec — YAGNI until an explicit use case beyond symmetry emerges.
- **Cross-page delete.** Selection is page-scoped; multi-page selection isn't reachable today.
- **Partial-success mode.** Deleting "the ones that exist; ignore the ones that don't" is rejected — masks bugs. Validation is strict-all-or-fail.
- **Operation grouping for non-delete ops.** This spec does not introduce a general "batch any operation" mechanism. Only delete gets a batch primitive in this PR because it's the only one with the demonstrated N-undo-step UX failure.

---

## §1 Storage / wire format

### Rust

`crates/core/src/commands/node_commands.rs`:

```rust
/// Atomic deletion of N nodes. Replaces the singular DeleteNode (Spec 19).
pub struct DeleteNodes {
    pub node_uuids: Vec<String>,
}

impl FieldOperation for DeleteNodes {
    fn validate(&self, doc: &Document) -> Result<(), ValidationError>;
    fn apply(&self, doc: &mut Document) -> Result<(), CoreError>;
}
```

The trait signature matches every other `FieldOperation` in `crates/core/src/commands/`. `apply` returns `Result<(), CoreError>` — it does NOT return undo snapshots. Per the existing Sigil convention (CLAUDE.md §1: "Undo is handled client-side"), undo snapshots are captured by the caller (frontend store) before invoking apply, not by the core.

Internally, `apply` still captures per-node snapshots — these are used for in-`apply` rollback on partial failure (CLAUDE.md §11 "Multi-Item Mutations Must Roll Back on Partial Failure"). They are NOT exposed outside `apply`. The rollback snapshot type is private to `node_commands.rs`:

```rust
// Private to the module — used only for in-apply rollback bookkeeping.
struct DeletedNodeSnapshot {
    uuid: String,
    parent_uuid: String,
    original_index: usize,
    subtree: NodeArenaFragment,  // serialized subtree (node + descendants)
}
```

The exact `NodeArenaFragment` shape follows the existing single-node deletion code path's internal representation. The contract is: whatever the existing arena's "remove a subtree, keep enough state to reinsert at the same parent and index" path uses, this spec reuses.

### Constants

`crates/core/src/validate.rs`:

```rust
/// Maximum number of nodes a single DeleteNodes operation may target.
/// Bounded to prevent runaway client requests. Beyond this limit the client
/// must split into multiple DeleteNodes operations (separate undo entries).
pub const MAX_NODES_PER_DELETE_BATCH: usize = 1000;
```

### GraphQL

`crates/server/src/graphql/types.rs`:

```rust
pub struct DeleteNodesInput {
    pub node_uuids: Vec<String>,
}

pub enum OperationInput {
    // existing variants minus DeleteNode
    DeleteNodes(DeleteNodesInput),  // REPLACES DeleteNode
    // …
}
```

### MCP tool

The existing `delete_node` MCP tool is renamed to `delete_nodes` with the new input schema:

```json
{
  "name": "delete_nodes",
  "input": { "node_uuids": ["uuid-a", "uuid-b", ...] }
}
```

Single-node delete is a trivial special case: `{ "node_uuids": ["only-uuid"] }`. Agents that previously called `delete_node` update to the new tool name + array form.

### Broadcast op_type

Frontend `apply-remote.ts` dispatches on `op_type === "delete_nodes"` with `value` shape `{ node_uuids: string[] }`.

---

## §2 Core FieldOperation behavior

### `DeleteNodes::validate(&self, doc) -> Result<(), ValidationError>`

In order:

1. **Empty batch:** if `node_uuids.is_empty()` → `Err(ValidationError::EmptyBatch)`.
2. **Oversized batch:** if `node_uuids.len() > MAX_NODES_PER_DELETE_BATCH` → `Err(ValidationError::BatchTooLarge { count, max })`.
3. **Duplicates:** if any UUID appears more than once in `node_uuids` → `Err(ValidationError::DuplicateUuid { uuid })`.
4. **Missing nodes:** for every UUID, verify the node exists in the document. Any missing → `Err(ValidationError::NodeNotFound { uuid })`. No mutation.

`validate()` is total — no side effects, no partial work.

### `DeleteNodes::apply(&self, doc: &mut Document) -> Result<(), CoreError>`

In order:

1. **Deduplicate ancestor/descendant pairs.** Compute the set of "top-most" UUIDs: a UUID `u` is retained iff no other UUID in `node_uuids` is an ancestor of `u`. Algorithm: for each UUID, walk up its ancestor chain; if any ancestor is also in the input set, drop this UUID. The resulting `retained: Vec<String>` is non-empty (proven by validate's empty-batch check) and contains only top-most representatives.

2. **Capture snapshots (BEFORE any mutation).** For each retained UUID, build a `DeletedNodeSnapshot` containing:
   - The UUID itself.
   - The full subtree (node + every descendant) serialized as a `NodeArenaFragment` suitable for re-insertion.
   - The `parent_uuid` at capture time.
   - The `original_index` within the parent's `children` array at capture time.

   Snapshots collected into `Vec<DeletedNodeSnapshot>`. No document mutation yet.

3. **Sort deletion order by `(parent_uuid, original_index DESCENDING)`.** Within a single parent, removing the highest-index sibling first ensures lower-index siblings retain stable indices throughout the loop. Across different parents, any order works — the sort key uses parent_uuid as a primary group, original_index as the secondary descending key.

4. **Delete loop with rollback tracking** (CLAUDE.md §11 "Multi-Item Mutations Must Roll Back on Partial Failure"):

   ```rust
   let mut completed: Vec<DeletedNodeSnapshot> = Vec::with_capacity(retained.len());
   for snap in &sorted_snapshots {
       match doc.remove_subtree(&snap.uuid) {
           Ok(()) => completed.push(snap.clone()),
           Err(e) => {
               // Roll back: re-insert every previously-removed subtree at its
               // original (parent_uuid, original_index). Use Vec::insert, not
               // push, so positions are restored exactly (CLAUDE.md §11
               // "Ordered Collection Mutations Must Preserve Position").
               for done in completed.iter().rev() {
                   doc.reinsert_subtree(
                       &done.parent_uuid,
                       done.original_index,
                       &done.subtree,
                   )?;
               }
               return Err(e);
           }
       }
   }
   ```

   The `doc.remove_subtree` method is the arena-level subtree removal primitive currently called from the singular delete path. It is preserved on the `Document` type; only its caller changes from `DeleteNode::apply` to `DeleteNodes::apply` — code reused, not duplicated.

5. **Return `Ok(())`.** Per the trait. Rollback snapshots are discarded on success.

### Inverse transaction construction (frontend responsibility)

Per CLAUDE.md §1, undo is handled client-side. The frontend store function performs its own dedup + snapshot pass (mirroring the algorithm `DeleteNodes::apply` uses internally) BEFORE issuing the operation. The frontend therefore knows everything needed to construct the inverse.

The forward `DeleteNodes` op's inverse is **N individual `CreateNode` ops bundled in a transaction** (not a symmetric `CreateNodes` op — see Non-goals).

**Inverse op order:** sort the snapshots by `(parent_uuid, original_index ASCENDING)`. The frontend HistoryManager applies the inverse in this order; each `CreateNode` performs `parent.children.insert(original_index, restored_node)`. Ascending order ensures `Vec::insert` calls produce the original sibling sequence regardless of how many siblings were deleted.

The transaction's `description` field is `"Delete N node{s}"` (N is the dedup-retained count, not the user's selection count).

---

## §3 Frontend store + apply-remote handler

### Store (`frontend/src/store/document-store-solid.tsx`)

Remove `function deleteNode(uuid: string)`. Add:

```typescript
function deleteNodes(uuids: readonly string[]): void {
  if (uuids.length === 0) return;

  // Captures snapshots (subtree + parent_uuid + original_index) for each
  // top-most UUID; dedup happens here.
  const snapshots = captureNodeSnapshots(state, uuids);
  if (snapshots.length === 0) return;

  // Local mutation: remove all retained subtrees in one produce() block.
  setState(produce((s) => {
    for (const snap of snapshots) {
      removeSubtreeFromArena(s, snap.uuid);
    }
  }));

  // History: one transaction. Forward = DeleteNodes op. Inverse = N CreateNode
  // ops sorted by (parent_uuid, original_index asc) per §2.
  const forwardOp = createDeleteNodesOp(
    clientSessionId,
    snapshots.map((s) => s.uuid),
  );
  const inverseOps = sortByParentThenIndex(snapshots).map((snap) =>
    createCreateNodeOp(clientSessionId, snap),
  );
  interceptor.pushTransaction({
    operations: [forwardOp],
    inverseOperations: inverseOps,
    description: `Delete ${snapshots.length} node${snapshots.length > 1 ? "s" : ""}`,
  });

  // Clear selection of any deleted node (use full deletedSet, not just
  // top-most UUIDs, since descendants disappear too).
  const deletedSet = new Set(snapshots.flatMap(collectSubtreeUuids));
  setSelectedNodeIds(selectedNodeIds().filter((id) => !deletedSet.has(id)));

  // Server: one roundtrip with one DeleteNodes op.
  sendOps([{ deleteNodes: { nodeUuids: snapshots.map((s) => s.uuid) } }]);
}
```

**Interceptor API extension.** The existing interceptor exposes `trackStructural(op)` which auto-wraps a single op in a transaction (verified at `frontend/src/store/document-store-solid.tsx:809+`). `HistoryManager.pushTransaction(tx)` already exists at `frontend/src/operations/history-manager.ts:46` and accepts a pre-built `Transaction`. This spec extends the interceptor to expose `pushTransaction(tx)` as a passthrough — the implementer should not introduce a new `trackStructuralBatch` name when `pushTransaction` already exists at the layer below.

### `apply-remote.ts` dispatcher

Drop the `case "delete_node":` handler. Add:

```typescript
case "delete_nodes": {
  // value: { node_uuids: string[] }
  if (typeof value !== "object" || value === null || !Array.isArray((value as { node_uuids?: unknown }).node_uuids)) {
    console.warn("apply_remote: delete_nodes payload missing node_uuids", { value, opType: op.op_type });
    return;
  }
  const nodeUuids = (value as { node_uuids: unknown }).node_uuids as string[];
  setState(produce((s) => {
    for (const uuid of nodeUuids) {
      removeSubtreeFromArena(s, uuid);
    }
  }));
  // Selection cleanup
  const deletedSet = new Set(nodeUuids.flatMap((u) => collectSubtreeUuidsFromState(state, u)));
  setSelectedNodeIds(selectedNodeIds().filter((id) => !deletedSet.has(id)));
  break;
}
```

Per CLAUDE.md frontend-defensive "Internal Mutation Entry Points Must Diagnose Their Own No-Ops": invalid payload shape emits a `console.warn` with structured payload.

### Call site updates

| Call site | Before | After |
|---|---|---|
| `Canvas.tsx:217` (drag-delete) | `store.deleteNode(uuid)` | `store.deleteNodes([uuid])` |
| `Canvas.tsx:621` (Delete key) | for-loop calling `store.deleteNode` | `store.deleteNodes(selectedNodeIds())` |
| `Canvas.tsx:633` (Backspace key) | for-loop calling `store.deleteNode` | `store.deleteNodes(selectedNodeIds())` |
| `LayersTree.tsx:598` (focused row delete) | `store.deleteNode(currentFocused)` | `store.deleteNodes([currentFocused])` |

The Delete/Backspace handler loop, and the explanatory comment naming "RF-007 TODO: implement batchDeleteNodes," are deleted.

---

## §4 Removal of DeleteNode (migration completeness)

Per CLAUDE.md §11 "Migrations Must Remove All Superseded Code → Completion claims require machine-verifiable receipts," removing `DeleteNode` requires a receipt that no references remain.

### Receipt #1 — CI sentinel guard

Add `.github/workflows/ci.yml` step `delete-node-removal-discipline`:

```yaml
delete-node-removal-discipline:
  name: DeleteNode Removal Discipline
  needs: detect-changes
  if: needs.detect-changes.outputs.frontend == 'true' || needs.detect-changes.outputs.rust == 'true'
  steps:
    - uses: actions/checkout@<sha-pinned>
    - name: Verify DeleteNode has no remaining references
      run: |
        set -euo pipefail
        BANNED='DeleteNode|delete_node|DeleteNodeInput|createDeleteNodeOp|store\.deleteNode\('
        # Allowlist: this rules file, the spec, and the migration tracker.
        ALLOWED='docs/superpowers/specs/2026-05-27-19-delete-nodes\.md|CLAUDE\.md|\.claude/rules/'
        if rg -E "$BANNED" --type rs --type ts --type tsx \
             | rg --invert-match -E "$ALLOWED" \
             | grep -q .; then
          echo "::error::DeleteNode/delete_node references remain. Per Spec 19, all singular delete-node references must be removed."
          rg -E "$BANNED" --type rs --type ts --type tsx | rg --invert-match -E "$ALLOWED"
          exit 1
        fi
        echo "✓ No DeleteNode references remain."
```

Per CLAUDE.md §11 "CI Guards Must Ship With a Violation-Fires Test": the new step ships with a sentinel test (a synthetic source containing one of the banned strings, asserting the grep fires).

### Receipt #2 — PR description grep proof

PR body quotes:

```
$ rg -E 'DeleteNode|delete_node|DeleteNodeInput|createDeleteNodeOp|store\.deleteNode\(' --type rs --type ts --type tsx \
    | rg --invert-match 'docs/superpowers/specs/2026-05-27-19-delete-nodes\.md|CLAUDE\.md|\.claude/rules/'
(no output)
```

### What gets deleted

| File | Removal |
|---|---|
| `crates/core/src/commands/node_commands.rs` | `pub struct DeleteNode` + `impl FieldOperation for DeleteNode` + all `test_delete_node_*` tests |
| `crates/core/src/commands/mod.rs` | `pub use ...DeleteNode` re-export |
| `crates/core/src/lib.rs` | `DeleteNode` re-export if present |
| `crates/server/src/graphql/types.rs` | `DeleteNodeInput` struct + `OperationInput::DeleteNode(...)` variant |
| `crates/server/src/graphql/mutation.rs` | `fn parse_delete_node` + dispatch arm + import |
| `crates/mcp/src/tools/*.rs` | `delete_node` tool registration |
| `frontend/src/operations/types.ts` (or equivalent) | `DeleteNode` variant of frontend mirror enum |
| `frontend/src/operations/operation-helpers.ts` | `createDeleteNodeOp` factory |
| `frontend/src/operations/apply-remote.ts` | `case "delete_node":` handler |
| `frontend/src/store/document-store-solid.tsx` | `deleteNode(uuid)` function + interface declaration |
| `frontend/src/store/__tests__/mutation-operations.test.ts` | `describe("deleteNode — operation tracking")` block |
| `frontend/src/store/__tests__/undo-redo-integration.test.ts` | `"should restore the node on undo after deleteNode"` test (rewritten as `"should restore N nodes on undo after deleteNodes"`) |

Every call site enumerated in §3's call-site table is migrated, not just renamed.

---

## §5 WASM Compatibility

Per CLAUDE.md §10 WASM Compatibility Checklist:

- **New external dependencies:** none. `DeleteNodes` uses only the same primitives `DeleteNode` already uses (`Vec`, `HashMap`, `String`, the existing arena type). All WASM-compatible.
- **Trait bounds:** `DeleteNodes` implements `FieldOperation` with the same bound surface (`Send + Sync` if the trait requires; otherwise nothing). No new bounds.
- **Randomness / syscalls:** none. The dedup algorithm is a pure tree walk.
- **Verdict:** Fully WASM-compatible. `cargo check --target wasm32-unknown-unknown -p agent-designer-core` passes.

---

## §6 Input Validation Inventory

| Field | Type | Validation |
|---|---|---|
| `DeleteNodes::node_uuids` | `Vec<String>` | Length: `[1, MAX_NODES_PER_DELETE_BATCH]`; no duplicates; every UUID must reference an existing node in the document; non-empty after deduplication (enforced indirectly — dedup never produces empty from non-empty input). |
| `DeleteNodesInput::node_uuids` (GraphQL) | `Vec<String>` | Same as core. Server-side validation mirrors core via `parse_delete_nodes`. |
| MCP tool `delete_nodes.node_uuids` | `string[]` | Same. Validated at MCP boundary before invoking the core operation. |
| Frontend `deleteNodes(uuids)` input | `readonly string[]` | Frontend validation is permissive (filter out unknown UUIDs in `captureNodeSnapshots` rather than reject) because the frontend is a transport boundary that may receive stale UUIDs from the user's selection. The server-side validation is authoritative. |

**New constants:** `MAX_NODES_PER_DELETE_BATCH = 1000` in `validate.rs`. Mirrored in `frontend/src/types/validation.ts`. Per CLAUDE.md §11 "Constants Must Be Enforced" + "Constant Enforcement Tests" (and the PR #67 amendment requiring real-rejection tests, not tautologies): the enforcement test `test_max_nodes_per_delete_batch_enforced` constructs a `DeleteNodes` with 1001 UUIDs and asserts `validate()` returns `Err(ValidationError::BatchTooLarge { .. })`.

---

## §7 PDR Traceability

**PDR features implemented:**
- "Multi-select delete with single undo step" — long-standing UX gap from PRs #33/#34/#35 (viewport interactions) noted as `RF-007 TODO` in Canvas.tsx.
- "Token-efficient MCP delete tool" — `delete_nodes` replaces the per-node `delete_node` tool; agents delete N nodes with one tool call.

**PDR features explicitly deferred:**
- `CreateNodes` symmetric counterpart — Non-goal #1. Inverse uses N `CreateNode` ops; the symmetric multi-create op is a future spec.
- General "batch any operation" mechanism — Non-goal #4.

---

## §8 Consistency Guarantees

- **Atomicity:** `DeleteNodes::apply` is all-or-nothing. If any subtree removal fails mid-loop, all previously-removed subtrees are restored to their original `(parent_uuid, original_index)` before the error propagates.
- **Pre-condition invariant:** at `validate()` time, every UUID in `node_uuids` references an existing node. Concurrent mutations between `validate()` and `apply()` are not a concern — both run under the same write lock (server's per-document `RwLock<Document>`).
- **Post-condition invariants:**
  - Every retained (top-most) UUID and its entire subtree is removed from the arena.
  - Sibling indices in every affected parent are compacted (no holes left by `Vec::remove`).
  - Selection state is updated by the caller (frontend store / apply-remote handler) — the core does not touch selection.
- **Partial failure semantics:** typed error variants identify which step failed (`EmptyBatch`, `BatchTooLarge`, `DuplicateUuid`, `NodeNotFound`, `RemoveSubtreeFailed { uuid, cause }`).
- **History / undo capacity:** the inverse transaction contains up to `MAX_NODES_PER_DELETE_BATCH = 1000` `CreateNode` ops. The existing `MAX_OPERATIONS_PER_TRANSACTION` (defined at `frontend/src/operations/types.ts:214`) is **also** 1000 — the two constants line up exactly. The two limits are coupled by intent: a `DeleteNodes` batch must fit in a single transaction. If `MAX_OPERATIONS_PER_TRANSACTION` ever changes, `MAX_NODES_PER_DELETE_BATCH` must change with it (or vice-versa). A compile-time assertion `const _: () = assert!(MAX_NODES_PER_DELETE_BATCH <= MAX_OPERATIONS_PER_TRANSACTION_MIRROR);` enforces this in Rust, mirrored by a vitest assertion in the frontend.

---

## §9 Recursion Safety

`DeleteNodes::apply` triggers two recursion-class operations:

1. **Ancestor walk during dedup.** For each UUID, walk up parents until reaching the root. Recursion depth is bounded by the document's tree depth.
2. **Subtree removal (`doc.remove_subtree`).** Walks down the tree, removing every descendant. Recursion depth is bounded by the subtree's depth.

Both walk the same arena traversal paths the existing single-node deletion path already uses. No `MAX_NODE_TREE_DEPTH` constant exists in `crates/core/src/validate.rs` today (verified via grep). This spec adds one:

```rust
/// Maximum node-tree nesting depth. Bounds recursion in subtree walks
/// (deletion, validation, snapshot capture). Mirrors MAX_JSON_NESTING_DEPTH
/// (38) in spirit but is keyed to user-authored tree depth, which is
/// expected to be much shallower than serialization nesting.
pub const MAX_NODE_TREE_DEPTH: usize = 64;
```

The constant is enforced at every recursive entry point (dedup ancestor walk, subtree removal, subtree snapshot) using `depth >= MAX_NODE_TREE_DEPTH` per CLAUDE.md §11 "Recursive Functions Require Depth Guards" (`>=` not `>`). A `MAX_NODE_TREE_DEPTH` enforcement test (`test_max_node_tree_depth_enforced`) constructs a 65-level-deep document and asserts the operation returns `Err(TreeDepthExceeded { .. })`.

A `BatchTooLarge` validation error before any recursion bounds the upper limit at 1000 nodes per batch. Combined with `MAX_NODE_TREE_DEPTH = 64`, the total recursive work per `DeleteNodes::apply` is `O(MAX_NODES_PER_DELETE_BATCH × MAX_NODE_TREE_DEPTH) = O(64,000)` operations worst-case — well within bounds.

**Scope note:** `MAX_NODE_TREE_DEPTH` is a new global constant introduced by this spec. Other operations that traverse the node tree (existing single-node delete, group/ungroup, reparent) MUST be retrofitted to use the same constant in the same PR, per CLAUDE.md §11 "Validation Must Be Symmetric Across All Transports." Adding the constant only to `DeleteNodes` would leave a hole in the existing operations.

---

## §10 Cross-Stack Transport Boundary Inventory

Per CLAUDE.md §10 (with the PR #67 amendment requiring machine-verifiable receipts for "Yes" entries).

| Site | File | Update | Receipt |
|---|---|---|---|
| Rust FieldOperation enum / match arms | every `match` on operation kind in `crates/core/`, `crates/server/`, `crates/mcp/`, `crates/state/` | **Yes** — drop `DeleteNode` arm, add `DeleteNodes` arm | `cargo clippy --workspace -- -D warnings` (exhaustiveness check) passes; no `_ =>` catch-all on the OperationInput-class enum |
| Rust GraphQL `OperationInput` enum | `crates/server/src/graphql/types.rs` | **Yes** — drop `DeleteNode(DeleteNodeInput)` variant + struct, add `DeleteNodes(DeleteNodesInput)` | Compiler proves exhaustiveness; CI sentinel grep proves no string-level references |
| GraphQL mutation parser | `crates/server/src/graphql/mutation.rs` — `parse_delete_node`, dispatch arm | **Yes** — `parse_delete_node` deleted; `parse_delete_nodes` added | CI sentinel grep |
| GraphQL response op_type strings | `crates/server/src/graphql/types.rs::ParsedOp::op_type()` | **Yes** — `"delete_node"` → `"delete_nodes"` | CI sentinel grep |
| MCP tool registration | `crates/mcp/src/tools/*.rs` | **Yes** — `delete_node` tool removed; `delete_nodes` tool added | CI sentinel grep |
| Server broadcast op_type emission | server's apply_operations → broadcast path | **Yes** — broadcasts `"delete_nodes"` with `{ node_uuids }` value, post-mutation canonicalized per CLAUDE.md §4 broadcast payload rules | CI sentinel grep + parity fixture |
| Frontend OperationInput mirror | `frontend/src/operations/types.ts` (or equivalent) | **Yes** — drop `DeleteNode` variant, add `DeleteNodes` | `.test-d.ts` exhaustiveness sentinel passes |
| Frontend op factory | `frontend/src/operations/operation-helpers.ts` | **Yes** — drop `createDeleteNodeOp`, add `createDeleteNodesOp` | CI sentinel grep |
| Frontend store API | `frontend/src/store/document-store-solid.tsx` | **Yes** — drop `deleteNode`, add `deleteNodes` | CI sentinel grep + tsc compile check |
| `DocumentStore` interface | same file | **Yes** — drop singular method, add plural | tsc compile check |
| `apply-remote.ts` dispatcher | `frontend/src/operations/apply-remote.ts` | **Yes** — `case "delete_node":` removed; `case "delete_nodes":` added | CI sentinel grep + parity fixture |
| Inverse builder | wherever `createInverseTransaction` dispatches | **Yes** — drop `delete_node` arm; add `delete_nodes` → N `create_node` ops arm | Code review + unit test |
| Discriminated-union exhaustiveness sentinel | `frontend/src/operations/__tests__/types.test-d.ts` (create if missing) | **Yes** — sentinel covers OperationInput variants including the new `DeleteNodes` and excluding `DeleteNode` | tsc compile check |
| Cross-language parity fixture | `tests/fixtures/parity/operation-encoding.json` (create if missing) | **Yes** — drop `delete_node` entry, add `delete_nodes` entry with both directions | Rust + TS parity test |
| All call sites of `store.deleteNode` | `Canvas.tsx:217,621,633`, `LayersTree.tsx:598` | **Yes** — migrated to `store.deleteNodes([…])` | CI sentinel grep |
| Rust core unit tests | `node_commands.rs` test module | **Yes** — drop all `test_delete_node_*` tests, add `test_delete_nodes_*` tests | grep matches new test names; old names absent |
| Frontend store tests | `mutation-operations.test.ts`, `undo-redo-integration.test.ts` | **Yes** — references updated | CI sentinel grep |

A "Yes" entry without an enforcement receipt would be an unverified claim. Every row above has either a compile-time check, a test, a parity fixture, or the CI sentinel grep guaranteeing the migration is total.

---

## §11 Done criteria

1. `cargo test --workspace` passes including new `DeleteNodes` tests and the parity fixture.
2. `pnpm --prefix frontend test --run` passes including new `deleteNodes` store tests and the `.test-d.ts` exhaustiveness sentinel.
3. `pnpm --prefix frontend lint` clean.
4. `cargo clippy --workspace --no-deps -- -D warnings` clean (no `_ =>` catch-all on OperationInput-class enums).
5. New CI job `delete-node-removal-discipline` passes; ships with a violation-fires test per CLAUDE.md §11.
6. `rg -E 'DeleteNode|delete_node|DeleteNodeInput|createDeleteNodeOp|store\.deleteNode\(' --type rs --type ts --type tsx` returns zero hits outside the allowed spec/rules files.
7. `MAX_NODES_PER_DELETE_BATCH` enforcement test rejects a 1001-node batch with `Err(BatchTooLarge { count: 1001, max: 1000 })`.
8. Manual smoke: select 5 sibling nodes in the canvas, press Delete → all 5 disappear, undo button shows ONE undoable action, press Ctrl+Z once → all 5 reappear at original positions, redo restores deletion.
9. Manual smoke: select an ancestor + one of its descendants, press Delete → both gone (descendant dropped by dedup), press Ctrl+Z → ancestor restored with descendant inside.
10. Manual smoke: with a collaborator client open, perform the 5-node delete; collaborator sees a SINGLE `delete_nodes` broadcast event, not 5 individual ones.

---

## §12 Open questions / deferred

- **Cross-batch transaction merge for rapid Delete presses.** If a user presses Delete twice in quick succession (e.g., two separate selections), should those two batches merge into one history entry? **Decided: no.** Each Delete keypress = one transaction. Merging would surprise users who expect the undo stack to mirror their keypresses.
- **`CreateNodes` symmetric multi-create.** Deferred per Non-goal #1. Reconsider when a use case beyond "be symmetric" emerges (e.g., a paste-from-clipboard feature that creates N nodes).
- **Selection clearing semantics.** When deleting includes nodes from a multi-select, what happens to the surviving selection? **Decided: filter the deleted UUIDs (and their descendants) from `selectedNodeIds`; preserve the rest.** Existing single-delete already does this for one UUID; the multi-delete extends to N.
- **MCP tool input shape validation.** The new `delete_nodes` MCP tool input accepts `node_uuids: string[]`. MCP tool input validation is handled at the MCP boundary (separate concern). Server-side validation (in `parse_delete_nodes` calling `DeleteNodes::validate`) is authoritative — MCP errors are surfaced via the tool's response.

---
