# Plan 15d — Server Simplification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all server-side undo/redo infrastructure now that the frontend owns undo (Phases 15a-15c). Simplify the core crate's `Command` trait to a forward-only `FieldOperation` trait with just `validate()` + `apply()`. Remove all `old_*` snapshot fields from command structs, delete `BatchSetTransform`/`GroupNodes`/`UngroupNodes` (now handled by the operation model), and strip undo/redo mutation handlers from the server and MCP. Add a per-document sequence counter for operation ordering.

**Architecture:** This phase is predominantly deletion and simplification. The core crate loses its `History` struct, the `Command` trait's `undo()` method, and all undo-related snapshot fields. The server loses undo/redo GraphQL mutations. The MCP server loses undo/redo tools. What remains is a clean validate-then-apply pipeline that the server uses to process operations received from clients.

**Tech Stack:** Rust (Edition 2024, clippy pedantic), async-graphql, TDD

**Spec Reference:** Spec 15, sections 5.2 (Removed Server Components), 5.4 (Simplified Trait), Phase 15d (section 9)

**Depends on:** Phases 15a, 15b, 15c must be complete before starting this phase.

---

## Inventory of Items to Remove

### Core Crate (`crates/core/`)

**Structs/types to delete entirely:**
- `History` struct in `document.rs` (lines 64-102)
- `CompoundCommand` struct in `command.rs` (lines 79-167)
- `BatchSetTransform` in `commands/batch_commands.rs` (entire file)
- `GroupNodes` in `commands/group_commands.rs` (entire file)
- `UngroupNodes` in `commands/group_commands.rs` (entire file)
- `SerializableCommand` enum in `wire.rs` (entire file or the undo-related variants)
- `BroadcastCommand` enum in `wire.rs` (evaluate if still needed)

**Trait changes:**
- `Command` trait in `command.rs` -- rename to `FieldOperation`, remove `undo()` method, remove `description()` method, change `apply()` return from `Result<Vec<SideEffect>, CoreError>` to `Result<(), CoreError>`

**Fields to remove from command structs:**
- `SetTransform::old_transform`
- `SetFills::old_fills`
- `SetStrokes::old_strokes`
- `SetEffects::old_effects`
- `SetOpacity::old_opacity`
- `SetBlendMode::old_blend_mode`
- `SetCornerRadii::old_corner_radii`
- `RenameNode::old_name`
- `SetVisible::old_visible`
- `SetLocked::old_locked`
- `DeleteNode::snapshot`, `page_id`, `page_root_index`, `parent_id`, `parent_child_index`
- `ReparentNode::old_parent_id`, `old_position`
- `ReorderChildren::old_position`
- `DeletePage::snapshot`, `page_index`
- `RenamePage::old_name`
- `RemoveComponent::snapshot`
- `RemoveToken::snapshot`
- `RemoveTransition::snapshot`

**Methods to remove from `Document`:**
- `execute()`, `undo()`, `redo()`, `can_undo()`, `can_redo()`
- `restore_component()`, `restore_transition()` (only used by undo paths)

**Field to remove from `Document`:**
- `history: History`

**Error variants to remove from `CoreError`:**
- `NothingToUndo`
- `NothingToRedo`
- `RollbackFailed`

**Constants to remove from `validate.rs`:**
- `DEFAULT_MAX_HISTORY`

**Re-exports to update in `lib.rs`:**
- Remove `History` from `pub use document::{...}`
- Remove `Command`, `CompoundCommand` from `pub use command::{...}`
- Remove `BroadcastCommand`, `SerializableCommand` from `pub use wire::{...}`
- Add `FieldOperation` re-export

### Server Crate (`crates/server/`)

**Mutation handlers to remove from `mutation.rs`:**
- `undo()` handler (lines 1186-1207)
- `redo()` handler (lines 1209-1230)
- All tests for undo/redo (`test_undo_redo_mutations_round_trip`, `test_undo_on_empty_history_returns_error`)

**Types to remove from `types.rs`:**
- `UndoRedoResult` struct
- `DocumentEventType::UndoRedo` variant
- `can_undo` and `can_redo` fields from `DocumentInfoGql`

**Query changes in `query.rs`:**
- Remove `can_undo: doc.can_undo()` and `can_redo: doc.can_redo()` from `document()` resolver

**Subscription changes in `subscription.rs`:**
- Remove `MutationEventKind::UndoRedo` match arm

**Mutation handler refactoring:**
- All mutation handlers currently call `doc_guard.execute(Box::new(cmd))` -- change to call `cmd.validate(&doc_guard)?; cmd.apply(&mut doc_guard)?;` directly (two-step: validate then apply, no history)
- Remove old-state capture code from every handler (the blocks that read `old_transform`, `old_name`, etc. before constructing the command)

### State Crate (`crates/state/`)

**Remove from `MutationEventKind` enum:**
- `UndoRedo` variant

### MCP Crate (`crates/mcp/`)

**Delete entirely:**
- `tools/history.rs` (undo_impl, redo_impl)

**Remove from `server.rs`:**
- `undo()` tool handler
- `redo()` tool handler

**Remove from `types.rs`:**
- `UndoRedoResult` struct
- `can_undo` and `can_redo` fields from document info type

**Refactor all tool implementations in `tools/nodes.rs`, `tools/pages.rs`, `tools/tokens.rs`:**
- Change `doc.execute(Box::new(cmd))` calls to `cmd.validate(&doc)?; cmd.apply(&mut doc)?;`
- Remove all old-state capture code (`old_name`, `old_transform`, `snapshot`, `old_position`, etc.)

---

## Task 1: Rename Command trait to FieldOperation, remove undo

**Files:**
- Modify: `crates/core/src/command.rs`
- Modify: `crates/core/src/lib.rs`
- Modify: `crates/core/src/error.rs`

This task creates the new `FieldOperation` trait and removes undo-related infrastructure from the trait layer.

- [ ] **Step 1: Define the new `FieldOperation` trait**

Replace the contents of `crates/core/src/command.rs`. The new trait has two methods:

```rust
/// A forward-only mutation on a Document.
///
/// Operations validate their inputs, then apply the mutation.
/// Undo is handled client-side (Spec 15) — the server never reverses operations.
pub trait FieldOperation: std::fmt::Debug {
    /// Validate this operation against the current document state.
    ///
    /// # Errors
    /// Returns `CoreError` if the operation's inputs are invalid or the
    /// document is not in a state that allows this operation.
    fn validate(&self, doc: &Document) -> Result<(), CoreError>;

    /// Apply this operation to the document.
    ///
    /// Callers MUST call `validate()` before `apply()`. Applying without
    /// validation may leave the document in an inconsistent state.
    ///
    /// # Errors
    /// Returns `CoreError` if the mutation cannot be performed.
    fn apply(&self, doc: &mut Document) -> Result<(), CoreError>;
}
```

Keep `SideEffect` enum and its `validate()` method -- these are still used by component/token workfile moves. However, `SideEffect` is no longer returned from apply; it will be computed separately if needed in a future phase. For now, the operations that previously returned side effects (component commands with workfile moves) should capture the side effect intent in a separate method or field -- but since no current code path actually processes `SideEffect` returns at the server level beyond validation, we can defer this.

Remove:
- `Command` trait (replaced by `FieldOperation`)
- `CompoundCommand` struct and its `impl Command` (batch operations now handled by the frontend transaction model)
- `MAX_COMPOUND_COMMANDS` constant
- `MAX_COMPOUND_DESCRIPTION_LEN` constant
- All tests for `CompoundCommand`

- [ ] **Step 2: Remove undo-related error variants**

In `crates/core/src/error.rs`, remove:
```rust
NothingToUndo,
NothingToRedo,
RollbackFailed { original: Box<CoreError>, rollback_errors: Vec<CoreError> },
```

And their corresponding tests: `test_nothing_to_undo_error`, `test_nothing_to_redo_error`.

- [ ] **Step 3: Update lib.rs re-exports**

In `crates/core/src/lib.rs`:
- Remove: `pub use command::{Command, CompoundCommand, SideEffect};`
- Remove: `pub use document::{..., History, ...};`
- Remove: `pub use wire::{BroadcastCommand, SerializableCommand};`
- Add: `pub use command::{FieldOperation, SideEffect};`
- Remove: `DEFAULT_MAX_HISTORY` from validate re-exports

- [ ] **Step 4: Write tests for the new trait**

Add a basic test in `command.rs` that verifies a struct implementing `FieldOperation` can be called with validate-then-apply. Use a simple test operation (e.g., a mock that sets a node name).

**TDD sequence:** Write the test expecting `FieldOperation` trait. Implement the trait. Compile. Green.

---

## Task 2: Simplify all command structs to FieldOperation

**Files:**
- Modify: `crates/core/src/commands/style_commands.rs`
- Modify: `crates/core/src/commands/node_commands.rs`
- Modify: `crates/core/src/commands/tree_commands.rs`
- Modify: `crates/core/src/commands/page_commands.rs`
- Modify: `crates/core/src/commands/component_commands.rs`
- Modify: `crates/core/src/commands/token_commands.rs`
- Modify: `crates/core/src/commands/transition_commands.rs`
- Delete: `crates/core/src/commands/batch_commands.rs`
- Delete: `crates/core/src/commands/group_commands.rs`
- Modify: `crates/core/src/commands/mod.rs`

This is the largest task -- converting every command struct from `impl Command` (with undo) to `impl FieldOperation` (validate + apply only), removing old_* fields.

- [ ] **Step 1: Convert style_commands.rs**

For each struct (`SetTransform`, `SetFills`, `SetStrokes`, `SetEffects`, `SetOpacity`, `SetBlendMode`, `SetCornerRadii`):
1. Remove the `old_*` field
2. Change `impl Command` to `impl FieldOperation`
3. Split the current `apply()` into `validate()` (the validation check) and `apply()` (the mutation)
4. Remove `undo()` and `description()` methods

Example for `SetTransform`:
```rust
#[derive(Debug)]
pub struct SetTransform {
    pub node_id: NodeId,
    pub new_transform: Transform,
}

impl FieldOperation for SetTransform {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        validate_transform(&self.new_transform)?;
        doc.arena.get(self.node_id)?; // verify node exists
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.arena.get_mut(self.node_id)?.transform = self.new_transform;
        Ok(())
    }
}
```

Keep `validate_transform()` as a public function -- it is used by the server for input validation.

Rewrite all execute/undo/redo cycle tests to be validate-then-apply tests. Tests should verify: (1) validate passes on valid input, (2) apply changes the document, (3) validate fails on invalid input (NaN transforms, too many fills, etc.).

- [ ] **Step 2: Convert node_commands.rs**

For `CreateNode`:
- Remove `undo()` method
- Split into `validate()` (check name, check kind, check page exists if provided) and `apply()` (insert node, add to page)
- The `node_id` field hint behavior stays the same

For `DeleteNode`:
- Remove `snapshot`, `page_id`, `page_root_index`, `parent_id`, `parent_child_index` fields -- these were only for undo
- The struct now only needs `node_id: NodeId`
- `validate()` checks node exists
- `apply()` removes from parent's children, removes from page root_nodes, removes from arena

For `RenameNode`:
- Remove `old_name` field
- `validate()` checks node exists and validates name
- `apply()` sets the name

For `SetVisible` and `SetLocked`:
- Remove `old_visible` / `old_locked`
- Simplify to just `node_id` + `new_visible`/`new_locked`

Also convert `SetTextContent` and `SetConstraints` if they exist (check the file).

- [ ] **Step 3: Convert tree_commands.rs**

For `ReparentNode`:
- Remove `old_parent_id` and `old_position`
- Keep `node_id`, `new_parent_id`, `new_position`

For `ReorderChildren`:
- Remove `old_position`
- Keep `node_id`, `new_position`

- [ ] **Step 4: Convert page_commands.rs**

For `CreatePage`: Remove undo, convert to FieldOperation.
For `DeletePage`: Remove `snapshot` and `page_index` fields. Just needs `page_id`.
For `RenamePage`: Remove `old_name`. Just needs `page_id` and `new_name`.

- [ ] **Step 5: Convert component_commands.rs**

For `AddComponent`: Remove undo, convert.
For `RemoveComponent`: Remove `snapshot` field.
For `RenameComponent`, `SetComponentOverride`, `RemoveComponentOverride`: Remove old_* fields, convert.

- [ ] **Step 6: Convert token_commands.rs**

For `AddToken`: Remove undo, convert.
For `RemoveToken`: Remove `snapshot` field.
For `UpdateToken`: Remove old_* fields, convert.

- [ ] **Step 7: Convert transition_commands.rs**

For `AddTransition`: Remove undo, convert.
For `RemoveTransition`: Remove `snapshot` field.

- [ ] **Step 8: Delete batch_commands.rs and group_commands.rs**

Delete `crates/core/src/commands/batch_commands.rs` entirely. The frontend transaction model handles batching.

Delete `crates/core/src/commands/group_commands.rs` entirely. GroupNodes/UngroupNodes are now expressed as a series of individual operations in a transaction.

Update `crates/core/src/commands/mod.rs` to remove:
```rust
pub mod batch_commands;
pub mod group_commands;
```

- [ ] **Step 9: Rewrite all command tests**

Every command file has tests using the execute/undo/redo cycle pattern. Rewrite these as validate-then-apply tests:
```rust
#[test]
fn test_set_transform_validate_and_apply() {
    let mut doc = Document::new("Test".to_string());
    // ... setup node ...
    let op = SetTransform { node_id, new_transform: ... };
    op.validate(&doc).expect("validate");
    op.apply(&mut doc).expect("apply");
    assert_eq!(doc.arena.get(node_id).unwrap().transform, ...);
}

#[test]
fn test_set_transform_validate_rejects_nan() {
    let doc = Document::new("Test".to_string());
    // ... setup ...
    let op = SetTransform { node_id, new_transform: Transform { x: f64::NAN, ... } };
    assert!(op.validate(&doc).is_err());
}
```

---

## Task 3: Remove History from Document

**Files:**
- Modify: `crates/core/src/document.rs`
- Modify: `crates/core/src/validate.rs`
- Delete: `crates/core/src/wire.rs`

- [ ] **Step 1: Remove History struct and Document methods**

In `crates/core/src/document.rs`:
1. Delete the `History` struct entirely (lines 58-102)
2. Remove `history: History` field from `Document` struct
3. Remove `history: History::default()` from `Document::new()` and `Document::with_capacity()`
4. Delete `Document::execute()`, `Document::undo()`, `Document::redo()`, `Document::can_undo()`, `Document::can_redo()`
5. Delete `Document::restore_component()` and `Document::restore_transition()` -- these only existed for undo paths
6. Remove `use std::collections::VecDeque` (only used by History)
7. Remove `use crate::command::{Command, SideEffect}` import

- [ ] **Step 2: Add sequence counter to Document**

Add a monotonically increasing sequence counter per Spec 15, section 5.3:

```rust
pub struct Document {
    pub metadata: DocumentMetadata,
    pub arena: Arena,
    pub pages: Vec<Page>,
    pub components: HashMap<ComponentId, ComponentDef>,
    pub transitions: Vec<Transition>,
    pub token_context: TokenContext,
    pub layout_engine: LayoutEngine,
    /// Monotonically increasing sequence number for operation ordering.
    /// Incremented by the server each time a transaction is committed.
    seq: u64,
}

impl Document {
    /// Returns the current sequence number.
    #[must_use]
    pub fn seq(&self) -> u64 {
        self.seq
    }

    /// Increments and returns the next sequence number.
    /// Called by the server after committing a transaction.
    pub fn next_seq(&mut self) -> u64 {
        self.seq += 1;
        self.seq
    }
}
```

- [ ] **Step 3: Remove DEFAULT_MAX_HISTORY from validate.rs**

Delete the constant from `crates/core/src/validate.rs` and remove it from the re-exports in `lib.rs`.

- [ ] **Step 4: Delete wire.rs**

Delete `crates/core/src/wire.rs` entirely. The `SerializableCommand` and `BroadcastCommand` enums were designed for the old undo system. The new operation model (Spec 15, section 3) uses TypeScript `Operation` types on the frontend and simple field-level mutations on the backend. Remove the `pub mod wire;` declaration from `lib.rs`.

- [ ] **Step 5: Delete all History and execute/undo/redo tests from document.rs**

Remove these tests:
- `test_history_default`
- `test_history_custom`
- `test_undo_empty_returns_error`
- `test_redo_empty_returns_error`
- `test_execute_pushes_to_undo_stack`
- `test_undo_reverses_command`
- `test_redo_reapplies_command`
- `test_execute_clears_redo_stack`
- `test_history_eviction_fifo`
- `test_failed_undo_preserves_command`
- `test_failed_redo_preserves_command`
- `test_history_eviction_at_min_capacity_1`
- `test_history_min_capacity_enforced`

Add new tests:
- `test_document_seq_starts_at_zero`
- `test_document_next_seq_increments`

---

## Task 4: Simplify server and MCP mutation handlers

**Files:**
- Modify: `crates/server/src/graphql/mutation.rs`
- Modify: `crates/server/src/graphql/types.rs`
- Modify: `crates/server/src/graphql/query.rs`
- Modify: `crates/server/src/graphql/subscription.rs`
- Modify: `crates/state/src/lib.rs`
- Delete: `crates/mcp/src/tools/history.rs`
- Modify: `crates/mcp/src/server.rs`
- Modify: `crates/mcp/src/types.rs`
- Modify: `crates/mcp/src/tools/nodes.rs`
- Modify: `crates/mcp/src/tools/pages.rs`
- Modify: `crates/mcp/src/tools/tokens.rs`

- [ ] **Step 1: Remove UndoRedo from state crate**

In `crates/state/src/lib.rs`, remove `UndoRedo` variant from `MutationEventKind`.

- [ ] **Step 2: Remove undo/redo from server GraphQL**

In `crates/server/src/graphql/mutation.rs`:
1. Delete the `undo()` handler (lines 1186-1207)
2. Delete the `redo()` handler (lines 1209-1230)
3. Remove `UndoRedoResult` import from `use super::types::{..., UndoRedoResult, ...}`
4. Remove all import of `BatchSetTransform`, `GroupNodes`, `UngroupNodes`
5. Delete tests `test_undo_redo_mutations_round_trip` and `test_undo_on_empty_history_returns_error`

In `crates/server/src/graphql/types.rs`:
1. Delete `UndoRedoResult` struct
2. Remove `UndoRedo` variant from `DocumentEventType`
3. Remove `can_undo` and `can_redo` from `DocumentInfoGql`
4. Remove the `MutationEventKind::UndoRedo => DocumentEventType::UndoRedo` match arm

In `crates/server/src/graphql/query.rs`:
1. Remove `can_undo: doc.can_undo()` and `can_redo: doc.can_redo()` from the `document()` resolver

In `crates/server/src/graphql/subscription.rs`:
1. Remove `MutationEventKind::UndoRedo` match arm
2. Remove associated test cases

- [ ] **Step 3: Refactor server mutation handlers to validate-then-apply**

Every mutation handler in `mutation.rs` currently follows this pattern:
```rust
let old_thing = doc_guard.arena.get(node_id)?.thing.clone();
let cmd = SomeCommand { node_id, new_thing, old_thing };
doc_guard.execute(Box::new(cmd)).map_err(|e| { ... })?;
```

Refactor to:
```rust
let op = SomeOperation { node_id, new_thing };
op.validate(&doc_guard).map_err(|e| { ... })?;
op.apply(&mut doc_guard).map_err(|e| { ... })?;
let seq = doc_guard.next_seq();
```

This removes the old-state capture that was only needed for undo. Each handler becomes shorter. The `seq` value should be included in the broadcast event data so clients can track ordering.

Apply this transformation to all handlers: `create_node`, `delete_node`, `rename_node`, `set_transform`, `set_fills`, `set_strokes`, `set_effects`, `set_opacity`, `set_blend_mode`, `set_corner_radii`, `set_visible`, `set_locked`, `reparent_node`, `reorder_children`, `batch_set_transform` (remove entirely -- clients send individual operations now), `group_nodes` (remove entirely), `ungroup_nodes` (remove entirely).

- [ ] **Step 4: Remove undo/redo from MCP**

Delete `crates/mcp/src/tools/history.rs` entirely.

In `crates/mcp/src/server.rs`:
1. Remove the `undo()` tool handler
2. Remove the `redo()` tool handler
3. Remove the `mod history;` declaration from `tools/mod.rs` if it exists, or the import in server.rs
4. Update the server description string to remove "undo/redo" mention

In `crates/mcp/src/types.rs`:
1. Delete the `UndoRedoResult` struct
2. Remove `can_undo` and `can_redo` from the document info type

- [ ] **Step 5: Refactor MCP tool implementations to validate-then-apply**

In `crates/mcp/src/tools/nodes.rs`, `pages.rs`, `tokens.rs`:
- Change all `doc.execute(Box::new(cmd))` calls to `op.validate(&doc)?; op.apply(&mut doc)?;`
- Remove all old-state capture code (the blocks that read `old_name`, `old_transform`, `snapshot`, `old_position`, etc.)
- The special rollback logic in `create_node` (nodes.rs line 245, `doc.undo()` fallback) should be replaced with manual cleanup: if reparent fails after node creation, remove the node from the arena directly

In `crates/mcp/src/tools/pages.rs`:
- Remove undo-participation tests (`test_create_page_participates_in_undo`, `test_delete_page_participates_in_undo`, `test_rename_page_participates_in_undo`)
- Replace with validate-then-apply tests

In `crates/mcp/src/tools/document.rs`:
- Remove `can_undo` and `can_redo` from the document info response

---

## Task 5: Verify compilation and run full test suite

**Files:** None new -- verification only.

- [ ] **Step 1: Cargo build --workspace**

Run `cargo build --workspace` and fix any compilation errors. Common issues:
- Missing imports where `Command` was used but now `FieldOperation` is needed
- Struct field count mismatches where old_* fields were removed
- Dead code warnings for `restore_component`/`restore_transition` if they were not removed
- Test files still referencing deleted types

- [ ] **Step 2: Cargo clippy --workspace -- -D warnings**

Fix all clippy warnings. Expect:
- Unused imports from removed modules
- Possibly `clippy::unnecessary_literal_bound` lint overrides that are no longer needed if `description()` is gone

- [ ] **Step 3: Cargo test --workspace**

Run the full test suite. All tests should pass. The deleted tests should be replaced by their validate-then-apply equivalents from Task 2.

- [ ] **Step 4: Frontend build + test**

Run `pnpm --prefix frontend build` and `pnpm --prefix frontend test`. The frontend should still work because:
- Phases 15a-15c already moved undo to the client
- The GraphQL mutations the frontend calls still exist (create_node, set_transform, etc.) -- they just no longer maintain a server-side history
- The undo/redo mutations are no longer called by the frontend (removed in Phase 15c)

Verify that the GraphQL schema no longer exposes `undo`, `redo`, `canUndo`, `canRedo`. If the frontend introspects the schema, update any schema type definitions.

- [ ] **Step 5: Verify dead code removal is complete**

Search for orphaned references per CLAUDE.md Migration rule:
1. Grep for `old_name`, `old_transform`, `old_visible`, `old_locked`, `old_opacity`, `old_blend_mode`, `old_fills`, `old_strokes`, `old_effects`, `old_corner_radii`, `old_position`, `old_parent_id` -- should return zero results
2. Grep for `Command` trait usage (not `FieldOperation`) -- should return zero results in production code
3. Grep for `History` struct usage -- should return zero results
4. Grep for `can_undo`, `can_redo` -- should return zero results in Rust code (frontend may still have these in the client-side HistoryManager)
5. Grep for `execute(Box::new` -- should return zero results (replaced by validate-then-apply)
6. Grep for `NothingToUndo`, `NothingToRedo`, `RollbackFailed` -- should return zero results

---

## Dependency Graph

```
Task 1 (FieldOperation trait)
  └─► Task 2 (convert all commands)
       └─► Task 3 (remove History from Document, add seq)
            └─► Task 4 (server + MCP cleanup)
                 └─► Task 5 (verification)
```

Tasks 1-3 are core crate changes. Task 4 is server/MCP changes that depend on the core API being stable. Task 5 is end-to-end verification.

---

## Risk Assessment

**Low risk:** This phase is predominantly deletion of dead code. Phases 15a-15c already transitioned the system to client-side undo, so the server-side undo code is unused.

**Medium risk areas:**
- MCP tools that use `doc.execute()` with rollback on failure (e.g., `create_node` with reparent in `nodes.rs`) need manual cleanup logic to replace the undo-based rollback
- The `SideEffect` type is still used by component/token workfile moves -- verify these paths still work without the Command trait's `apply() -> Vec<SideEffect>` return

**Mitigation:** TDD for every change. Run the full workspace test suite after each task.

### Critical Files for Implementation
- `/Volumes/projects/Personal/agent-designer/crates/core/src/command.rs` - Core trait to replace (Command -> FieldOperation)
- `/Volumes/projects/Personal/agent-designer/crates/core/src/document.rs` - Remove History struct, execute/undo/redo methods, add seq counter
- `/Volumes/projects/Personal/agent-designer/crates/server/src/graphql/mutation.rs` - Remove undo/redo handlers, refactor all handlers from execute() to validate+apply
- `/Volumes/projects/Personal/agent-designer/crates/mcp/src/tools/nodes.rs` - Largest MCP file with ~20 execute() calls to refactor
- `/Volumes/projects/Personal/agent-designer/crates/core/src/commands/style_commands.rs` - Pattern to follow for converting command structs (most field types represented here)