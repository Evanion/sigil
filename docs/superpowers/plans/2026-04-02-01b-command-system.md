# Command System — Implementation Plan (01b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Command trait, undo/redo history, CompoundCommand, SideEffect, and the core node/tree/style commands for the Sigil design engine.

**Architecture:** Commands are structs that capture both forward and reverse state. They implement a `Command` trait with `apply`/`undo`/`description`. The `History` struct on `Document` manages undo/redo stacks with FIFO eviction. `CompoundCommand` wraps multiple commands with atomic rollback on failure. All mutations to the document flow through `Document::execute()`.

**Tech Stack:** Rust 1.94.1 (edition 2024), serde, serde_json, uuid (no v4), thiserror

**Scope:** This plan covers the command infrastructure and node/tree/style commands. Component commands (`component_commands.rs`) and prototype commands (`prototype_commands.rs`) are deferred to Plan 01c because they depend on stubs (`OverrideMap`, `Transition`, `TokenContext`) that need full implementations first.

---

## File Structure

```
crates/core/src/
├── command.rs              # Command trait, SideEffect enum, CompoundCommand, SerializableCommand, BroadcastCommand
├── commands/
│   ├── mod.rs              # Re-exports all command types
│   ├── node_commands.rs    # CreateNode, DeleteNode, RenameNode, SetVisible, SetLocked
│   ├── tree_commands.rs    # ReparentNode, ReorderChildren
│   └── style_commands.rs   # SetTransform, SetFills, SetStrokes, SetOpacity, SetBlendMode, SetEffects
├── document.rs             # Modified: replace History stub, add execute/undo/redo
├── error.rs                # Modified: add NothingToUndo, NothingToRedo variants
└── lib.rs                  # Modified: add command module, re-exports
```

---

## Task 1: Add error variants for undo/redo

**Files:**
- Modify: `crates/core/src/error.rs`

- [ ] 1. Add the failing test for the new error variants:

Append to the `#[cfg(test)] mod tests` block in `crates/core/src/error.rs`:

```rust
#[test]
fn test_nothing_to_undo_error() {
    let err = CoreError::NothingToUndo;
    let msg = format!("{err}");
    assert!(msg.contains("nothing to undo"), "expected message: {msg}");
}

#[test]
fn test_nothing_to_redo_error() {
    let err = CoreError::NothingToRedo;
    let msg = format!("{err}");
    assert!(msg.contains("nothing to redo"), "expected message: {msg}");
}
```

- [ ] 2. Run the tests to verify they fail:

```bash
./dev.sh cargo test -p agent-designer-core test_nothing_to_undo_error test_nothing_to_redo_error
```

Expected: compilation error — `NothingToUndo` and `NothingToRedo` variants don't exist.

- [ ] 3. Add the error variants to `CoreError` in `crates/core/src/error.rs`:

Add these two variants to the `CoreError` enum, after the `PageNotFound` variant:

```rust
#[error("nothing to undo")]
NothingToUndo,

#[error("nothing to redo")]
NothingToRedo,
```

- [ ] 4. Run the tests to verify they pass:

```bash
./dev.sh cargo test -p agent-designer-core test_nothing_to_undo_error test_nothing_to_redo_error
```

Expected: both tests pass.

- [ ] 5. Commit:

```bash
git add crates/core/src/error.rs
git commit -m "feat(core): add NothingToUndo and NothingToRedo error variants (spec-01)"
```

---

## Task 2: Create the Command trait and SideEffect enum

**Files:**
- Create: `crates/core/src/command.rs`
- Modify: `crates/core/src/lib.rs`

- [ ] 1. Create `crates/core/src/command.rs` with the Command trait, SideEffect enum, and initial tests:

```rust
// crates/core/src/command.rs

use serde::{Deserialize, Serialize};

use crate::document::Document;
use crate::error::CoreError;
use crate::id::{ComponentId, TokenId};

/// Side effects that the server must execute after a command completes.
/// Core has no I/O, so these are returned to the caller for execution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SideEffect {
    MoveTokenToWorkfile {
        token_id: TokenId,
        target_workfile: String,
    },
    MoveComponentToWorkfile {
        component_id: ComponentId,
        target_workfile: String,
    },
}

/// A reversible mutation on a Document.
///
/// Commands capture everything needed to apply and reverse the operation.
/// No `Send + Sync` bounds — WASM targets don't support them.
pub trait Command: std::fmt::Debug {
    /// Apply this command to the document, returning any side effects.
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError>;

    /// Reverse this command, restoring the document to its prior state.
    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError>;

    /// A human-readable description of this command (for UI display).
    fn description(&self) -> &str;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_side_effect_serde_round_trip() {
        let effect = SideEffect::MoveTokenToWorkfile {
            token_id: TokenId::new(uuid::Uuid::nil()),
            target_workfile: "tokens/colors.sigil".to_string(),
        };
        let json = serde_json::to_string(&effect).expect("serialize");
        let deserialized: SideEffect = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(effect, deserialized);
    }

    #[test]
    fn test_side_effect_component_variant() {
        let effect = SideEffect::MoveComponentToWorkfile {
            component_id: ComponentId::new(uuid::Uuid::nil()),
            target_workfile: "components/buttons.sigil".to_string(),
        };
        let json = serde_json::to_string(&effect).expect("serialize");
        let deserialized: SideEffect = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(effect, deserialized);
    }
}
```

- [ ] 2. Add `pub mod command;` to `crates/core/src/lib.rs` after `pub mod arena;`:

```rust
pub mod command;
```

And add re-exports after the existing re-export blocks:

```rust
// ── Re-exports: Command ──────────────────────────────────────────────
pub use command::{Command, SideEffect};
```

- [ ] 3. Run the tests:

```bash
./dev.sh cargo test -p agent-designer-core command
```

Expected: both tests pass.

- [ ] 4. Commit:

```bash
git add crates/core/src/command.rs crates/core/src/lib.rs
git commit -m "feat(core): add Command trait and SideEffect enum (spec-01)"
```

---

## Task 3: Implement CompoundCommand

**Files:**
- Modify: `crates/core/src/command.rs`

- [ ] 1. Add tests for `CompoundCommand` to the test module in `crates/core/src/command.rs`:

```rust
#[test]
fn test_compound_command_applies_all_subcommands() {
    use crate::node::{Node, NodeKind};
    use crate::id::NodeId;

    let mut doc = Document::new("Test".to_string());
    let node = Node::new(
        NodeId::new(0, 0),
        uuid::Uuid::from_bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        NodeKind::Frame { layout: None },
        "Frame".to_string(),
    )
    .expect("create node");
    let node_id = doc.arena.insert(node).expect("insert");

    // Two rename commands in sequence
    let cmd1 = super::super::commands::node_commands::RenameNode {
        node_id,
        new_name: "Step 1".to_string(),
        old_name: "Frame".to_string(),
    };
    let cmd2 = super::super::commands::node_commands::RenameNode {
        node_id,
        new_name: "Step 2".to_string(),
        old_name: "Step 1".to_string(),
    };

    let compound = CompoundCommand::new(
        vec![Box::new(cmd1), Box::new(cmd2)],
        "Rename twice".to_string(),
    );

    compound.apply(&mut doc).expect("apply compound");
    assert_eq!(doc.arena.get(node_id).unwrap().name, "Step 2");

    compound.undo(&mut doc).expect("undo compound");
    assert_eq!(doc.arena.get(node_id).unwrap().name, "Frame");
}

#[test]
fn test_compound_command_description() {
    let compound = CompoundCommand::new(vec![], "Test compound".to_string());
    assert_eq!(compound.description(), "Test compound");
}

#[test]
fn test_compound_command_empty_is_noop() {
    let mut doc = Document::new("Test".to_string());
    let compound = CompoundCommand::new(vec![], "Empty".to_string());
    let effects = compound.apply(&mut doc).expect("apply empty");
    assert!(effects.is_empty());
    let effects = compound.undo(&mut doc).expect("undo empty");
    assert!(effects.is_empty());
}
```

- [ ] 2. Run tests to verify they fail:

```bash
./dev.sh cargo test -p agent-designer-core test_compound_command
```

Expected: compilation error — `CompoundCommand` doesn't exist.

- [ ] 3. Add `CompoundCommand` to `crates/core/src/command.rs`, above the `#[cfg(test)]` block:

```rust
/// A command that applies multiple sub-commands as one atomic unit.
///
/// If any sub-command fails during `apply`, all previously applied
/// sub-commands are undone in reverse order (rollback).
#[derive(Debug)]
pub struct CompoundCommand {
    commands: Vec<Box<dyn Command>>,
    description: String,
}

impl CompoundCommand {
    /// Creates a new compound command.
    #[must_use]
    pub fn new(commands: Vec<Box<dyn Command>>, description: String) -> Self {
        Self {
            commands,
            description,
        }
    }
}

impl Command for CompoundCommand {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let mut all_effects = Vec::new();
        for (i, cmd) in self.commands.iter().enumerate() {
            match cmd.apply(doc) {
                Ok(effects) => all_effects.extend(effects),
                Err(e) => {
                    // Rollback: undo commands 0..i in reverse order
                    for cmd_to_undo in self.commands[..i].iter().rev() {
                        // Best-effort rollback — if undo itself fails, we're in a bad state.
                        // The spec says "the original error is returned with rollback context."
                        let _ = cmd_to_undo.undo(doc);
                    }
                    return Err(e);
                }
            }
        }
        Ok(all_effects)
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let mut all_effects = Vec::new();
        for cmd in self.commands.iter().rev() {
            let effects = cmd.undo(doc)?;
            all_effects.extend(effects);
        }
        Ok(all_effects)
    }

    fn description(&self) -> &str {
        &self.description
    }
}
```

- [ ] 4. Add `CompoundCommand` to the re-exports in `crates/core/src/lib.rs`:

Update the Command re-export line:

```rust
pub use command::{Command, CompoundCommand, SideEffect};
```

- [ ] 5. These tests depend on `RenameNode` from Task 5, so we can't run them yet. Run the `test_compound_command_description` and `test_compound_command_empty_is_noop` tests only:

```bash
./dev.sh cargo test -p agent-designer-core test_compound_command_description test_compound_command_empty_is_noop
```

Expected: both pass. The `test_compound_command_applies_all_subcommands` test won't compile yet — that's fine, it will be enabled in Task 5.

**Note:** Comment out the `test_compound_command_applies_all_subcommands` test body for now. Add a `// TODO: uncomment after Task 5 (RenameNode)` comment. It will be uncommented in Task 5.

- [ ] 6. Commit:

```bash
git add crates/core/src/command.rs crates/core/src/lib.rs
git commit -m "feat(core): add CompoundCommand with atomic rollback (spec-01)"
```

---

## Task 4: Replace History stub and add execute/undo/redo to Document

**Files:**
- Modify: `crates/core/src/document.rs`

- [ ] 1. Add tests for the history system to the test module in `crates/core/src/document.rs`:

```rust
#[test]
fn test_execute_pushes_to_undo_stack() {
    use crate::command::Command;
    use crate::node::NodeKind;

    let mut doc = Document::new("Test".to_string());
    let node = Node::new(
        NodeId::new(0, 0),
        make_uuid(1),
        NodeKind::Frame { layout: None },
        "Frame".to_string(),
    )
    .expect("create node");
    let node_id = doc.arena.insert(node).expect("insert");

    // We'll use a simple test command — SetVisible
    let cmd = crate::commands::node_commands::SetVisible {
        node_id,
        new_visible: false,
        old_visible: true,
    };

    doc.execute(Box::new(cmd)).expect("execute");
    assert!(!doc.arena.get(node_id).unwrap().visible);
    assert!(doc.can_undo());
    assert!(!doc.can_redo());
}

#[test]
fn test_undo_reverses_command() {
    use crate::node::NodeKind;

    let mut doc = Document::new("Test".to_string());
    let node = Node::new(
        NodeId::new(0, 0),
        make_uuid(1),
        NodeKind::Frame { layout: None },
        "Frame".to_string(),
    )
    .expect("create node");
    let node_id = doc.arena.insert(node).expect("insert");

    let cmd = crate::commands::node_commands::SetVisible {
        node_id,
        new_visible: false,
        old_visible: true,
    };

    doc.execute(Box::new(cmd)).expect("execute");
    assert!(!doc.arena.get(node_id).unwrap().visible);

    doc.undo().expect("undo");
    assert!(doc.arena.get(node_id).unwrap().visible);
    assert!(!doc.can_undo());
    assert!(doc.can_redo());
}

#[test]
fn test_redo_reapplies_command() {
    use crate::node::NodeKind;

    let mut doc = Document::new("Test".to_string());
    let node = Node::new(
        NodeId::new(0, 0),
        make_uuid(1),
        NodeKind::Frame { layout: None },
        "Frame".to_string(),
    )
    .expect("create node");
    let node_id = doc.arena.insert(node).expect("insert");

    let cmd = crate::commands::node_commands::SetVisible {
        node_id,
        new_visible: false,
        old_visible: true,
    };

    doc.execute(Box::new(cmd)).expect("execute");
    doc.undo().expect("undo");
    doc.redo().expect("redo");
    assert!(!doc.arena.get(node_id).unwrap().visible);
    assert!(doc.can_undo());
    assert!(!doc.can_redo());
}

#[test]
fn test_execute_clears_redo_stack() {
    use crate::node::NodeKind;

    let mut doc = Document::new("Test".to_string());
    let node = Node::new(
        NodeId::new(0, 0),
        make_uuid(1),
        NodeKind::Frame { layout: None },
        "Frame".to_string(),
    )
    .expect("create node");
    let node_id = doc.arena.insert(node).expect("insert");

    let cmd1 = crate::commands::node_commands::SetVisible {
        node_id,
        new_visible: false,
        old_visible: true,
    };
    let cmd2 = crate::commands::node_commands::SetVisible {
        node_id,
        new_visible: true,
        old_visible: false,
    };

    doc.execute(Box::new(cmd1)).expect("execute cmd1");
    doc.undo().expect("undo cmd1");
    assert!(doc.can_redo());

    doc.execute(Box::new(cmd2)).expect("execute cmd2");
    assert!(!doc.can_redo()); // redo stack cleared
}

#[test]
fn test_undo_empty_returns_error() {
    let mut doc = Document::new("Test".to_string());
    let result = doc.undo();
    assert!(matches!(result, Err(CoreError::NothingToUndo)));
}

#[test]
fn test_redo_empty_returns_error() {
    let mut doc = Document::new("Test".to_string());
    let result = doc.redo();
    assert!(matches!(result, Err(CoreError::NothingToRedo)));
}

#[test]
fn test_history_eviction_fifo() {
    use crate::node::NodeKind;

    let mut doc = Document::new("Test".to_string());
    doc.history = History::new(2); // max 2 undo entries

    let node = Node::new(
        NodeId::new(0, 0),
        make_uuid(1),
        NodeKind::Frame { layout: None },
        "Frame".to_string(),
    )
    .expect("create node");
    let node_id = doc.arena.insert(node).expect("insert");

    // Execute 3 commands with max_history=2
    for i in 0..3u8 {
        let cmd = crate::commands::node_commands::RenameNode {
            node_id,
            new_name: format!("Name {i}"),
            old_name: if i == 0 {
                "Frame".to_string()
            } else {
                format!("Name {}", i - 1)
            },
        };
        doc.execute(Box::new(cmd)).expect("execute");
    }

    // Only 2 undos should be possible (oldest evicted)
    assert!(doc.undo().is_ok()); // undo "Name 2" -> "Name 1"
    assert!(doc.undo().is_ok()); // undo "Name 1" -> "Name 0"
    assert!(doc.undo().is_err()); // nothing left — "Name 0" -> "Frame" was evicted
}
```

- [ ] 2. Run tests to verify they fail:

```bash
./dev.sh cargo test -p agent-designer-core test_execute_pushes test_undo_reverses test_redo_reapplies test_execute_clears_redo test_undo_empty test_redo_empty test_history_eviction
```

Expected: compilation errors — `execute`, `undo`, `redo`, `can_undo`, `can_redo` don't exist.

- [ ] 3. Replace the `History` struct in `crates/core/src/document.rs`. First, add the import for Command at the top of the file:

```rust
use crate::command::{Command, SideEffect};
```

Then replace the entire `History` struct, its `impl` block, and its `Default` impl with:

```rust
/// Undo/redo history for the document.
///
/// Commands are pushed to the undo stack on execute. Undo pops from
/// undo and pushes to redo. Redo pops from redo and pushes to undo.
/// Executing a new command clears the redo stack.
/// FIFO eviction when undo stack exceeds `max_history`.
#[derive(Debug)]
pub struct History {
    undo_stack: Vec<Box<dyn Command>>,
    redo_stack: Vec<Box<dyn Command>>,
    max_history: usize,
}

impl History {
    #[must_use]
    pub fn new(max_history: usize) -> Self {
        Self {
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            max_history,
        }
    }

    #[must_use]
    pub fn max_history(&self) -> usize {
        self.max_history
    }

    #[must_use]
    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    #[must_use]
    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }
}

impl Default for History {
    fn default() -> Self {
        Self::new(crate::validate::DEFAULT_MAX_HISTORY)
    }
}
```

- [ ] 4. `History` previously derived `Clone`, but `Box<dyn Command>` is not `Clone`. Remove `Clone` from `Document`'s derive as well (it can't clone history). Remove `#[derive(Debug, Clone)]` from `Document` and replace with `#[derive(Debug)]`.

- [ ] 5. Add `execute`, `undo`, `redo`, `can_undo`, and `can_redo` methods to the `impl Document` block:

```rust
/// Executes a command, pushing it to the undo stack.
/// Clears the redo stack. Evicts oldest command if stack exceeds max_history.
pub fn execute(
    &mut self,
    cmd: Box<dyn Command>,
) -> Result<Vec<SideEffect>, CoreError> {
    let effects = cmd.apply(self)?;
    self.history.redo_stack.clear();
    self.history.undo_stack.push(cmd);
    if self.history.undo_stack.len() > self.history.max_history {
        self.history.undo_stack.remove(0);
    }
    Ok(effects)
}

/// Undoes the most recent command.
///
/// # Errors
/// Returns `CoreError::NothingToUndo` if the undo stack is empty.
pub fn undo(&mut self) -> Result<Vec<SideEffect>, CoreError> {
    let cmd = self
        .history
        .undo_stack
        .pop()
        .ok_or(CoreError::NothingToUndo)?;
    let effects = cmd.undo(self)?;
    self.history.redo_stack.push(cmd);
    Ok(effects)
}

/// Redoes the most recently undone command.
///
/// # Errors
/// Returns `CoreError::NothingToRedo` if the redo stack is empty.
pub fn redo(&mut self) -> Result<Vec<SideEffect>, CoreError> {
    let cmd = self
        .history
        .redo_stack
        .pop()
        .ok_or(CoreError::NothingToRedo)?;
    let effects = cmd.apply(self)?;
    self.history.undo_stack.push(cmd);
    Ok(effects)
}

/// Returns true if there are commands that can be undone.
#[must_use]
pub fn can_undo(&self) -> bool {
    self.history.can_undo()
}

/// Returns true if there are commands that can be redone.
#[must_use]
pub fn can_redo(&self) -> bool {
    self.history.can_redo()
}
```

- [ ] 6. These tests depend on `SetVisible` and `RenameNode` commands from Tasks 5 and 6. Comment them out for now with `// TODO: uncomment after Task 5/6`. Run the existing document tests to make sure nothing broke:

```bash
./dev.sh cargo test -p agent-designer-core document::tests
```

Expected: all existing tests pass. The `test_history_custom` and `test_history_default` tests should still pass unchanged.

- [ ] 7. Commit:

```bash
git add crates/core/src/document.rs
git commit -m "feat(core): replace History stub with full undo/redo stack (spec-01)"
```

---

## Task 5: Create commands module and implement node commands

**Files:**
- Create: `crates/core/src/commands/mod.rs`
- Create: `crates/core/src/commands/node_commands.rs`
- Modify: `crates/core/src/lib.rs`

- [ ] 1. Create `crates/core/src/commands/mod.rs`:

```rust
pub mod node_commands;
```

- [ ] 2. Create `crates/core/src/commands/node_commands.rs` with all node commands and their tests:

```rust
// crates/core/src/commands/node_commands.rs

use crate::command::{Command, SideEffect};
use crate::document::Document;
use crate::error::CoreError;
use crate::id::{NodeId, PageId};
use crate::node::{Node, NodeKind, Style, Transform};
use crate::validate::{validate_node_name, validate_text_content};
use uuid::Uuid;

/// Creates a new node and inserts it into the arena.
/// Optionally adds it as a root node on a page.
#[derive(Debug)]
pub struct CreateNode {
    pub node_id: NodeId,
    pub uuid: Uuid,
    pub kind: NodeKind,
    pub name: String,
    pub page_id: Option<PageId>,
}

impl Command for CreateNode {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let node = Node::new(self.node_id, self.uuid, self.kind.clone(), self.name.clone())?;
        let actual_id = doc.arena.insert(node)?;
        if let Some(page_id) = self.page_id {
            doc.add_root_node_to_page(page_id, actual_id)?;
        }
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let id = doc
            .arena
            .id_by_uuid(&self.uuid)
            .ok_or(CoreError::ValidationError(format!(
                "cannot undo CreateNode: node with uuid {} not found",
                self.uuid
            )))?;
        // Remove from page root_nodes if present
        if let Some(page_id) = self.page_id {
            if let Ok(page) = doc.page_mut(page_id) {
                page.root_nodes.retain(|nid| *nid != id);
            }
        }
        doc.arena.remove(id)?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Create node"
    }
}

/// Deletes a node from the arena, capturing its full state for undo.
#[derive(Debug)]
pub struct DeleteNode {
    pub node_id: NodeId,
    pub snapshot: Option<Node>,
    pub page_id: Option<PageId>,
    pub page_root_index: Option<usize>,
}

impl Command for DeleteNode {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        // Remove from page root_nodes if present
        if let Some(page_id) = self.page_id {
            if let Ok(page) = doc.page_mut(page_id) {
                page.root_nodes.retain(|nid| *nid != self.node_id);
            }
        }
        // Detach from parent
        crate::tree::remove_child(&mut doc.arena, self.node_id)?;
        doc.arena.remove(self.node_id)?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let snapshot = self.snapshot.as_ref().ok_or(CoreError::ValidationError(
            "cannot undo DeleteNode: no snapshot captured".to_string(),
        ))?;
        let actual_id = doc.arena.insert(snapshot.clone())?;
        // Restore page root position
        if let Some(page_id) = self.page_id {
            if let Ok(page) = doc.page_mut(page_id) {
                let idx = self.page_root_index.unwrap_or(page.root_nodes.len());
                let clamped = idx.min(page.root_nodes.len());
                page.root_nodes.insert(clamped, actual_id);
            }
        }
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Delete node"
    }
}

/// Renames a node.
#[derive(Debug)]
pub struct RenameNode {
    pub node_id: NodeId,
    pub new_name: String,
    pub old_name: String,
}

impl Command for RenameNode {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        validate_node_name(&self.new_name)?;
        let node = doc.arena.get_mut(self.node_id)?;
        node.name = self.new_name.clone();
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        node.name = self.old_name.clone();
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Rename node"
    }
}

/// Sets a node's visibility.
#[derive(Debug)]
pub struct SetVisible {
    pub node_id: NodeId,
    pub new_visible: bool,
    pub old_visible: bool,
}

impl Command for SetVisible {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.visible = self.new_visible;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.visible = self.old_visible;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set visibility"
    }
}

/// Sets a node's locked state.
#[derive(Debug)]
pub struct SetLocked {
    pub node_id: NodeId,
    pub new_locked: bool,
    pub old_locked: bool,
}

impl Command for SetLocked {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.locked = self.new_locked;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.locked = self.old_locked;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set locked"
    }
}

/// Updates the text content of a Text node.
#[derive(Debug)]
pub struct SetTextContent {
    pub node_id: NodeId,
    pub new_content: String,
    pub old_content: String,
}

impl Command for SetTextContent {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        validate_text_content(&self.new_content)?;
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            NodeKind::Text { content, .. } => {
                *content = self.new_content.clone();
            }
            _ => {
                return Err(CoreError::ValidationError(
                    "SetTextContent can only be applied to Text nodes".to_string(),
                ));
            }
        }
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            NodeKind::Text { content, .. } => {
                *content = self.old_content.clone();
            }
            _ => {
                return Err(CoreError::ValidationError(
                    "SetTextContent undo: node is not a Text node".to_string(),
                ));
            }
        }
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set text content"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Document, Page};
    use crate::id::{NodeId, PageId};
    use crate::node::{NodeKind, TextStyle};

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn setup_doc_with_frame() -> (Document, NodeId) {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Frame 1".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");
        (doc, node_id)
    }

    // ── CreateNode ──────────────────────────────────────────────────

    #[test]
    fn test_create_node_apply() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(10));
        doc.add_page(Page::new(page_id, "Home".to_string()))
            .expect("add page");

        let cmd = CreateNode {
            node_id: NodeId::new(0, 0),
            uuid: make_uuid(1),
            kind: NodeKind::Rectangle {
                corner_radii: [0.0; 4],
            },
            name: "Rect".to_string(),
            page_id: Some(page_id),
        };

        cmd.apply(&mut doc).expect("apply");
        let id = doc.arena.id_by_uuid(&make_uuid(1)).expect("find by uuid");
        assert_eq!(doc.arena.get(id).unwrap().name, "Rect");
        assert!(doc.page(page_id).unwrap().root_nodes.contains(&id));
    }

    #[test]
    fn test_create_node_undo() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(10));
        doc.add_page(Page::new(page_id, "Home".to_string()))
            .expect("add page");

        let cmd = CreateNode {
            node_id: NodeId::new(0, 0),
            uuid: make_uuid(1),
            kind: NodeKind::Frame { layout: None },
            name: "Frame".to_string(),
            page_id: Some(page_id),
        };

        cmd.apply(&mut doc).expect("apply");
        cmd.undo(&mut doc).expect("undo");
        assert!(doc.arena.id_by_uuid(&make_uuid(1)).is_none());
        assert!(doc.page(page_id).unwrap().root_nodes.is_empty());
    }

    // ── DeleteNode ──────────────────────────────────────────────────

    #[test]
    fn test_delete_node_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let page_id = PageId::new(make_uuid(10));
        doc.add_page(Page::new(page_id, "Home".to_string()))
            .expect("add page");

        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Frame".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");
        doc.add_root_node_to_page(page_id, node_id).expect("add root");

        let snapshot = doc.arena.get(node_id).unwrap().clone();
        let cmd = DeleteNode {
            node_id,
            snapshot: Some(snapshot),
            page_id: Some(page_id),
            page_root_index: Some(0),
        };

        cmd.apply(&mut doc).expect("apply delete");
        assert!(doc.arena.get(node_id).is_err());
        assert!(doc.page(page_id).unwrap().root_nodes.is_empty());

        cmd.undo(&mut doc).expect("undo delete");
        let restored_id = doc.arena.id_by_uuid(&make_uuid(1)).expect("find restored");
        assert_eq!(doc.arena.get(restored_id).unwrap().name, "Frame");
        assert!(doc.page(page_id).unwrap().root_nodes.contains(&restored_id));
    }

    // ── RenameNode ──────────────────────────────────────────────────

    #[test]
    fn test_rename_node_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_frame();

        let cmd = RenameNode {
            node_id,
            new_name: "Renamed".to_string(),
            old_name: "Frame 1".to_string(),
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().name, "Renamed");

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(doc.arena.get(node_id).unwrap().name, "Frame 1");
    }

    #[test]
    fn test_rename_node_validates_name() {
        let (mut doc, node_id) = setup_doc_with_frame();

        let cmd = RenameNode {
            node_id,
            new_name: "a".repeat(513), // exceeds MAX_NODE_NAME_LEN
            old_name: "Frame 1".to_string(),
        };

        assert!(cmd.apply(&mut doc).is_err());
    }

    // ── SetVisible ──────────────────────────────────────────────────

    #[test]
    fn test_set_visible_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_frame();
        assert!(doc.arena.get(node_id).unwrap().visible);

        let cmd = SetVisible {
            node_id,
            new_visible: false,
            old_visible: true,
        };

        cmd.apply(&mut doc).expect("apply");
        assert!(!doc.arena.get(node_id).unwrap().visible);

        cmd.undo(&mut doc).expect("undo");
        assert!(doc.arena.get(node_id).unwrap().visible);
    }

    // ── SetLocked ───────────────────────────────────────────────────

    #[test]
    fn test_set_locked_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_frame();
        assert!(!doc.arena.get(node_id).unwrap().locked);

        let cmd = SetLocked {
            node_id,
            new_locked: true,
            old_locked: false,
        };

        cmd.apply(&mut doc).expect("apply");
        assert!(doc.arena.get(node_id).unwrap().locked);

        cmd.undo(&mut doc).expect("undo");
        assert!(!doc.arena.get(node_id).unwrap().locked);
    }

    // ── SetTextContent ──────────────────────────────────────────────

    #[test]
    fn test_set_text_content_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Text {
                content: "Hello".to_string(),
                text_style: TextStyle::default(),
            },
            "Text 1".to_string(),
        )
        .expect("create text node");
        let node_id = doc.arena.insert(node).expect("insert");

        let cmd = SetTextContent {
            node_id,
            new_content: "World".to_string(),
            old_content: "Hello".to_string(),
        };

        cmd.apply(&mut doc).expect("apply");
        match &doc.arena.get(node_id).unwrap().kind {
            NodeKind::Text { content, .. } => assert_eq!(content, "World"),
            _ => panic!("expected Text node"),
        }

        cmd.undo(&mut doc).expect("undo");
        match &doc.arena.get(node_id).unwrap().kind {
            NodeKind::Text { content, .. } => assert_eq!(content, "Hello"),
            _ => panic!("expected Text node"),
        }
    }

    #[test]
    fn test_set_text_content_wrong_node_kind() {
        let (mut doc, node_id) = setup_doc_with_frame();

        let cmd = SetTextContent {
            node_id,
            new_content: "World".to_string(),
            old_content: "Hello".to_string(),
        };

        assert!(cmd.apply(&mut doc).is_err());
    }
}
```

- [ ] 3. Add `pub mod commands;` to `crates/core/src/lib.rs` after `pub mod command;`:

```rust
pub mod commands;
```

- [ ] 4. Run the node command tests:

```bash
./dev.sh cargo test -p agent-designer-core commands::node_commands
```

Expected: all tests pass.

- [ ] 5. Commit:

```bash
git add crates/core/src/commands/ crates/core/src/lib.rs
git commit -m "feat(core): add node commands — CreateNode, DeleteNode, RenameNode, SetVisible, SetLocked, SetTextContent (spec-01)"
```

---

## Task 6: Uncomment and run Document history tests

**Files:**
- Modify: `crates/core/src/document.rs`
- Modify: `crates/core/src/command.rs`

- [ ] 1. Uncomment all the history tests that were deferred in Task 4 (the ones that use `SetVisible` and `RenameNode`).

- [ ] 2. Uncomment the `test_compound_command_applies_all_subcommands` test in `crates/core/src/command.rs` from Task 3.

- [ ] 3. Run all tests:

```bash
./dev.sh cargo test -p agent-designer-core
```

Expected: all tests pass including history tests and compound command test.

- [ ] 4. Commit:

```bash
git add crates/core/src/document.rs crates/core/src/command.rs
git commit -m "test(core): enable history and compound command integration tests (spec-01)"
```

---

## Task 7: Implement tree commands

**Files:**
- Create: `crates/core/src/commands/tree_commands.rs`
- Modify: `crates/core/src/commands/mod.rs`

- [ ] 1. Add `pub mod tree_commands;` to `crates/core/src/commands/mod.rs`:

```rust
pub mod node_commands;
pub mod tree_commands;
```

- [ ] 2. Create `crates/core/src/commands/tree_commands.rs`:

```rust
// crates/core/src/commands/tree_commands.rs

use crate::command::{Command, SideEffect};
use crate::document::Document;
use crate::error::CoreError;
use crate::id::NodeId;
use crate::tree;

/// Moves a node to a new parent at a specific position.
/// Captures the old parent and position for undo.
#[derive(Debug)]
pub struct ReparentNode {
    pub node_id: NodeId,
    pub new_parent_id: NodeId,
    pub new_position: usize,
    pub old_parent_id: Option<NodeId>,
    pub old_position: Option<usize>,
}

impl Command for ReparentNode {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        tree::rearrange(
            &mut doc.arena,
            self.node_id,
            self.new_parent_id,
            self.new_position,
        )?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        match self.old_parent_id {
            Some(old_parent) => {
                tree::rearrange(
                    &mut doc.arena,
                    self.node_id,
                    old_parent,
                    self.old_position.unwrap_or(0),
                )?;
            }
            None => {
                // Was a root node — detach from current parent
                tree::remove_child(&mut doc.arena, self.node_id)?;
            }
        }
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Reparent node"
    }
}

/// Reorders children within the same parent.
/// Moves `node_id` to `new_position` within its current parent.
#[derive(Debug)]
pub struct ReorderChildren {
    pub node_id: NodeId,
    pub new_position: usize,
    pub old_position: usize,
}

impl Command for ReorderChildren {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let parent_id = doc
            .arena
            .get(self.node_id)?
            .parent
            .ok_or(CoreError::ValidationError(
                "ReorderChildren: node has no parent".to_string(),
            ))?;
        tree::rearrange(&mut doc.arena, self.node_id, parent_id, self.new_position)?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let parent_id = doc
            .arena
            .get(self.node_id)?
            .parent
            .ok_or(CoreError::ValidationError(
                "ReorderChildren undo: node has no parent".to_string(),
            ))?;
        tree::rearrange(&mut doc.arena, self.node_id, parent_id, self.old_position)?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Reorder children"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::Document;
    use crate::id::NodeId;
    use crate::node::{Node, NodeKind};
    use uuid::Uuid;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn insert_frame(doc: &mut Document, uuid_byte: u8, name: &str) -> NodeId {
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(uuid_byte),
            NodeKind::Frame { layout: None },
            name.to_string(),
        )
        .expect("create node");
        doc.arena.insert(node).expect("insert")
    }

    // ── ReparentNode ────────────────────────────────────────────────

    #[test]
    fn test_reparent_node_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let parent_a = insert_frame(&mut doc, 1, "Parent A");
        let parent_b = insert_frame(&mut doc, 2, "Parent B");
        let child = insert_frame(&mut doc, 3, "Child");

        // Add child to parent_a first
        tree::add_child(&mut doc.arena, parent_a, child).expect("add child");
        assert_eq!(doc.arena.get(parent_a).unwrap().children, vec![child]);

        let cmd = ReparentNode {
            node_id: child,
            new_parent_id: parent_b,
            new_position: 0,
            old_parent_id: Some(parent_a),
            old_position: Some(0),
        };

        cmd.apply(&mut doc).expect("apply");
        assert!(doc.arena.get(parent_a).unwrap().children.is_empty());
        assert_eq!(doc.arena.get(parent_b).unwrap().children, vec![child]);

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(doc.arena.get(parent_a).unwrap().children, vec![child]);
        assert!(doc.arena.get(parent_b).unwrap().children.is_empty());
    }

    #[test]
    fn test_reparent_node_cycle_detection() {
        let mut doc = Document::new("Test".to_string());
        let parent = insert_frame(&mut doc, 1, "Parent");
        let child = insert_frame(&mut doc, 2, "Child");

        tree::add_child(&mut doc.arena, parent, child).expect("add child");

        let cmd = ReparentNode {
            node_id: parent,
            new_parent_id: child,
            new_position: 0,
            old_parent_id: None,
            old_position: None,
        };

        assert!(cmd.apply(&mut doc).is_err());
    }

    // ── ReorderChildren ─────────────────────────────────────────────

    #[test]
    fn test_reorder_children_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let parent = insert_frame(&mut doc, 1, "Parent");
        let child_a = insert_frame(&mut doc, 2, "A");
        let child_b = insert_frame(&mut doc, 3, "B");
        let child_c = insert_frame(&mut doc, 4, "C");

        tree::add_child(&mut doc.arena, parent, child_a).expect("add a");
        tree::add_child(&mut doc.arena, parent, child_b).expect("add b");
        tree::add_child(&mut doc.arena, parent, child_c).expect("add c");

        // Move A from position 0 to position 2
        let cmd = ReorderChildren {
            node_id: child_a,
            new_position: 2,
            old_position: 0,
        };

        cmd.apply(&mut doc).expect("apply");
        let children = &doc.arena.get(parent).unwrap().children;
        assert_eq!(children, &[child_b, child_c, child_a]);

        cmd.undo(&mut doc).expect("undo");
        let children = &doc.arena.get(parent).unwrap().children;
        assert_eq!(children, &[child_a, child_b, child_c]);
    }

    #[test]
    fn test_reorder_children_no_parent_fails() {
        let mut doc = Document::new("Test".to_string());
        let orphan = insert_frame(&mut doc, 1, "Orphan");

        let cmd = ReorderChildren {
            node_id: orphan,
            new_position: 0,
            old_position: 0,
        };

        assert!(cmd.apply(&mut doc).is_err());
    }
}
```

- [ ] 3. Run the tree command tests:

```bash
./dev.sh cargo test -p agent-designer-core commands::tree_commands
```

Expected: all tests pass.

- [ ] 4. Commit:

```bash
git add crates/core/src/commands/
git commit -m "feat(core): add tree commands — ReparentNode, ReorderChildren (spec-01)"
```

---

## Task 8: Implement style commands

**Files:**
- Create: `crates/core/src/commands/style_commands.rs`
- Modify: `crates/core/src/commands/mod.rs`

- [ ] 1. Add `pub mod style_commands;` to `crates/core/src/commands/mod.rs`:

```rust
pub mod node_commands;
pub mod style_commands;
pub mod tree_commands;
```

- [ ] 2. Create `crates/core/src/commands/style_commands.rs`:

```rust
// crates/core/src/commands/style_commands.rs

use crate::command::{Command, SideEffect};
use crate::document::Document;
use crate::error::CoreError;
use crate::id::NodeId;
use crate::node::{BlendMode, Constraints, Effect, Fill, Stroke, StyleValue, Transform};
use crate::validate::{MAX_EFFECTS_PER_STYLE, MAX_FILLS_PER_STYLE, MAX_STROKES_PER_STYLE};

/// Sets a node's transform (position, size, rotation, scale).
#[derive(Debug)]
pub struct SetTransform {
    pub node_id: NodeId,
    pub new_transform: Transform,
    pub old_transform: Transform,
}

impl Command for SetTransform {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.transform = self.new_transform;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.transform = self.old_transform;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set transform"
    }
}

/// Replaces a node's entire fills array.
#[derive(Debug)]
pub struct SetFills {
    pub node_id: NodeId,
    pub new_fills: Vec<Fill>,
    pub old_fills: Vec<Fill>,
}

impl Command for SetFills {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        if self.new_fills.len() > MAX_FILLS_PER_STYLE {
            return Err(CoreError::ValidationError(format!(
                "too many fills: {} (max {MAX_FILLS_PER_STYLE})",
                self.new_fills.len()
            )));
        }
        doc.arena.get_mut(self.node_id)?.style.fills = self.new_fills.clone();
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.style.fills = self.old_fills.clone();
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set fills"
    }
}

/// Replaces a node's entire strokes array.
#[derive(Debug)]
pub struct SetStrokes {
    pub node_id: NodeId,
    pub new_strokes: Vec<Stroke>,
    pub old_strokes: Vec<Stroke>,
}

impl Command for SetStrokes {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        if self.new_strokes.len() > MAX_STROKES_PER_STYLE {
            return Err(CoreError::ValidationError(format!(
                "too many strokes: {} (max {MAX_STROKES_PER_STYLE})",
                self.new_strokes.len()
            )));
        }
        doc.arena.get_mut(self.node_id)?.style.strokes = self.new_strokes.clone();
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.style.strokes = self.old_strokes.clone();
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set strokes"
    }
}

/// Sets a node's opacity.
#[derive(Debug)]
pub struct SetOpacity {
    pub node_id: NodeId,
    pub new_opacity: StyleValue<f64>,
    pub old_opacity: StyleValue<f64>,
}

impl Command for SetOpacity {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.style.opacity = self.new_opacity.clone();
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.style.opacity = self.old_opacity.clone();
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set opacity"
    }
}

/// Sets a node's blend mode.
#[derive(Debug)]
pub struct SetBlendMode {
    pub node_id: NodeId,
    pub new_blend_mode: BlendMode,
    pub old_blend_mode: BlendMode,
}

impl Command for SetBlendMode {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.style.blend_mode = self.new_blend_mode;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.style.blend_mode = self.old_blend_mode;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set blend mode"
    }
}

/// Replaces a node's entire effects array.
#[derive(Debug)]
pub struct SetEffects {
    pub node_id: NodeId,
    pub new_effects: Vec<Effect>,
    pub old_effects: Vec<Effect>,
}

impl Command for SetEffects {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        if self.new_effects.len() > MAX_EFFECTS_PER_STYLE {
            return Err(CoreError::ValidationError(format!(
                "too many effects: {} (max {MAX_EFFECTS_PER_STYLE})",
                self.new_effects.len()
            )));
        }
        doc.arena.get_mut(self.node_id)?.style.effects = self.new_effects.clone();
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.style.effects = self.old_effects.clone();
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set effects"
    }
}

/// Sets a node's constraints.
#[derive(Debug)]
pub struct SetConstraints {
    pub node_id: NodeId,
    pub new_constraints: Constraints,
    pub old_constraints: Constraints,
}

impl Command for SetConstraints {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.constraints = self.new_constraints;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.arena.get_mut(self.node_id)?.constraints = self.old_constraints;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set constraints"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::Document;
    use crate::id::NodeId;
    use crate::node::{Color, Node, NodeKind, PinConstraint};
    use uuid::Uuid;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn setup_doc_with_rect() -> (Document, NodeId) {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Rectangle {
                corner_radii: [0.0; 4],
            },
            "Rect".to_string(),
        )
        .expect("create node");
        let node_id = doc.arena.insert(node).expect("insert");
        (doc, node_id)
    }

    // ── SetTransform ────────────────────────────────────────────────

    #[test]
    fn test_set_transform_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let old = doc.arena.get(node_id).unwrap().transform;
        let new = Transform {
            x: 50.0,
            y: 100.0,
            width: 200.0,
            height: 300.0,
            rotation: 45.0,
            scale_x: 2.0,
            scale_y: 2.0,
        };

        let cmd = SetTransform {
            node_id,
            new_transform: new,
            old_transform: old,
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().transform.x, 50.0);
        assert_eq!(doc.arena.get(node_id).unwrap().transform.rotation, 45.0);

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(doc.arena.get(node_id).unwrap().transform.x, old.x);
    }

    // ── SetFills ────────────────────────────────────────────────────

    #[test]
    fn test_set_fills_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let old_fills = doc.arena.get(node_id).unwrap().style.fills.clone();
        let new_fills = vec![Fill::Solid {
            color: StyleValue::Literal {
                value: Color::Srgb {
                    r: 1.0,
                    g: 0.0,
                    b: 0.0,
                    a: 1.0,
                },
            },
        }];

        let cmd = SetFills {
            node_id,
            new_fills: new_fills.clone(),
            old_fills: old_fills.clone(),
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().style.fills.len(), 1);

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(doc.arena.get(node_id).unwrap().style.fills, old_fills);
    }

    #[test]
    fn test_set_fills_validates_max() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let too_many: Vec<Fill> = (0..MAX_FILLS_PER_STYLE + 1)
            .map(|_| Fill::Solid {
                color: StyleValue::Literal {
                    value: Color::default(),
                },
            })
            .collect();

        let cmd = SetFills {
            node_id,
            new_fills: too_many,
            old_fills: vec![],
        };

        assert!(cmd.apply(&mut doc).is_err());
    }

    // ── SetStrokes ──────────────────────────────────────────────────

    #[test]
    fn test_set_strokes_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let new_strokes = vec![Stroke::default()];

        let cmd = SetStrokes {
            node_id,
            new_strokes: new_strokes.clone(),
            old_strokes: vec![],
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().style.strokes.len(), 1);

        cmd.undo(&mut doc).expect("undo");
        assert!(doc.arena.get(node_id).unwrap().style.strokes.is_empty());
    }

    // ── SetOpacity ──────────────────────────────────────────────────

    #[test]
    fn test_set_opacity_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_rect();

        let cmd = SetOpacity {
            node_id,
            new_opacity: StyleValue::Literal { value: 0.5 },
            old_opacity: StyleValue::Literal { value: 1.0 },
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(
            doc.arena.get(node_id).unwrap().style.opacity,
            StyleValue::Literal { value: 0.5 }
        );

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(
            doc.arena.get(node_id).unwrap().style.opacity,
            StyleValue::Literal { value: 1.0 }
        );
    }

    // ── SetBlendMode ────────────────────────────────────────────────

    #[test]
    fn test_set_blend_mode_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_rect();

        let cmd = SetBlendMode {
            node_id,
            new_blend_mode: BlendMode::Multiply,
            old_blend_mode: BlendMode::Normal,
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(
            doc.arena.get(node_id).unwrap().style.blend_mode,
            BlendMode::Multiply
        );

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(
            doc.arena.get(node_id).unwrap().style.blend_mode,
            BlendMode::Normal
        );
    }

    // ── SetEffects ──────────────────────────────────────────────────

    #[test]
    fn test_set_effects_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let new_effects = vec![Effect::LayerBlur {
            radius: StyleValue::Literal { value: 10.0 },
        }];

        let cmd = SetEffects {
            node_id,
            new_effects: new_effects.clone(),
            old_effects: vec![],
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(doc.arena.get(node_id).unwrap().style.effects.len(), 1);

        cmd.undo(&mut doc).expect("undo");
        assert!(doc.arena.get(node_id).unwrap().style.effects.is_empty());
    }

    #[test]
    fn test_set_effects_validates_max() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let too_many: Vec<Effect> = (0..MAX_EFFECTS_PER_STYLE + 1)
            .map(|_| Effect::LayerBlur {
                radius: StyleValue::Literal { value: 1.0 },
            })
            .collect();

        let cmd = SetEffects {
            node_id,
            new_effects: too_many,
            old_effects: vec![],
        };

        assert!(cmd.apply(&mut doc).is_err());
    }

    // ── SetConstraints ──────────────────────────────────────────────

    #[test]
    fn test_set_constraints_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_rect();
        let old = doc.arena.get(node_id).unwrap().constraints;
        let new = Constraints {
            horizontal: PinConstraint::Center,
            vertical: PinConstraint::Scale,
        };

        let cmd = SetConstraints {
            node_id,
            new_constraints: new,
            old_constraints: old,
        };

        cmd.apply(&mut doc).expect("apply");
        assert_eq!(
            doc.arena.get(node_id).unwrap().constraints.horizontal,
            PinConstraint::Center
        );

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(
            doc.arena.get(node_id).unwrap().constraints.horizontal,
            PinConstraint::Start
        );
    }
}
```

- [ ] 3. Run the style command tests:

```bash
./dev.sh cargo test -p agent-designer-core commands::style_commands
```

Expected: all tests pass.

- [ ] 4. Commit:

```bash
git add crates/core/src/commands/
git commit -m "feat(core): add style commands — SetTransform, SetFills, SetStrokes, SetOpacity, SetBlendMode, SetEffects, SetConstraints (spec-01)"
```

---

## Task 9: Run full test suite and clippy

**Files:** None (verification only)

- [ ] 1. Run the full test suite:

```bash
./dev.sh cargo test --workspace
```

Expected: all tests pass.

- [ ] 2. Run clippy:

```bash
./dev.sh cargo clippy --workspace -- -D warnings
```

Expected: no warnings.

- [ ] 3. Run format check:

```bash
./dev.sh cargo fmt --check
```

Expected: all files formatted.

- [ ] 4. If any issues, fix them and commit:

```bash
git add -A
git commit -m "fix(core): address clippy and format issues"
```

---

## Deferred Items

### Plan 01c: Full Type Implementations

Replace stub types with complete implementations:

- **`Transition`** — full prototype model: `source_node`, `target_page`, `trigger`, `animation` (spec lines 322-357)
- **`TokenContext`** — design token model with alias resolution, cycle detection
- **`OverrideMap`** — `HashMap<(Uuid, PropertyPath), OverrideValue>` replacing the current `HashMap<String, Value>` stub
- **`PathData`** — full bezier segments (`MoveTo`, `LineTo`, `CubicTo`, `ClosePath`) replacing `Vec<Value>` stub
- **`ComponentDef`** — add `variants` and `properties` fields
- **`LayoutMode::Grid`** — grid layout variant

### Plan 01d: Advanced Commands & Wire Formats

Depends on 01c types being complete:

- **`component_commands.rs`** — component instance overrides, instantiation
- **`prototype_commands.rs`** — `AddTransition`, `RemoveTransition`, `UpdateTransition`
- **Token commands** — `RenameToken`, `PromoteToken`, `DemoteToken`
- **`SerializableCommand`** — tagged enum for local undo/redo persistence (includes `old_*` fields)
- **`BroadcastCommand`** — tagged enum for WebSocket sync (forward-only, omits `old_*` fields)
