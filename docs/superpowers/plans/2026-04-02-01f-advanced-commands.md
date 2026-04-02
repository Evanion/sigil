# Advanced Commands — Implementation Plan (01f)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement transition, token, and component commands that complete the core engine's mutation API, enabling all document operations to flow through the command/undo/redo pipeline.

**Architecture:** Three new command modules follow the established pattern: each command is a struct with `old_*` fields for undo, implements the `Command` trait, validates inputs in `apply`, and restores state in `undo`. Transition commands operate on `Document.transitions`, token commands on `Document.token_context`, and component commands on `Document.components` and `NodeKind::ComponentInstance` overrides. A `Document.add_transition` method is added for consistency with `add_component`.

**Tech Stack:** Rust 1.94.1 (edition 2024), serde, serde_json, uuid (no v4), thiserror

**Scope:** Command implementations with tests. SerializableCommand/BroadcastCommand wire format enums and boolean path operations are deferred to Plan 01g.

**IMPORTANT:** Your FIRST action before writing ANY code must be to read `CLAUDE.md` in full. Rules in CLAUDE.md take precedence over code in this plan if they conflict.

---

## File Structure

```
crates/core/src/
├── commands/
│   ├── mod.rs                   # MODIFY: add three new modules
│   ├── transition_commands.rs   # NEW: AddTransition, RemoveTransition, UpdateTransition
│   ├── token_commands.rs        # NEW: AddToken, RemoveToken, UpdateToken
│   └── component_commands.rs    # NEW: AddComponent, RemoveComponent, SetOverride, RemoveOverride
├── document.rs                  # MODIFY: add add_transition, remove_transition methods
├── validate.rs                  # MODIFY: add MAX_TRANSITIONS_PER_DOCUMENT enforcement
```

---

## Task 1: Add transition mutation API to Document

**Files:**
- Modify: `crates/core/src/document.rs`

- [ ] 1. Read `CLAUDE.md` in full. Identify all rules that apply.

- [ ] 2. Add tests for the new Document methods to the test module in `document.rs`:

```rust
#[test]
fn test_add_transition() {
    use crate::prototype::{Transition, TransitionTrigger, TransitionAnimation};

    let mut doc = Document::new("Test".to_string());
    let t = Transition {
        id: make_uuid(1),
        source_node: NodeId::new(0, 0),
        target_page: PageId::new(make_uuid(10)),
        target_node: None,
        trigger: TransitionTrigger::OnClick,
        animation: TransitionAnimation::Instant,
    };
    doc.add_transition(t).expect("add transition");
    assert_eq!(doc.transitions.len(), 1);
}

#[test]
fn test_add_transition_validates() {
    use crate::prototype::{Transition, TransitionTrigger, TransitionAnimation};

    let mut doc = Document::new("Test".to_string());
    let t = Transition {
        id: make_uuid(1),
        source_node: NodeId::new(0, 0),
        target_page: PageId::new(make_uuid(10)),
        target_node: None,
        trigger: TransitionTrigger::AfterDelay { seconds: -1.0 },
        animation: TransitionAnimation::Instant,
    };
    assert!(doc.add_transition(t).is_err());
}

#[test]
fn test_remove_transition() {
    use crate::prototype::{Transition, TransitionTrigger, TransitionAnimation};

    let mut doc = Document::new("Test".to_string());
    let id = make_uuid(1);
    let t = Transition {
        id,
        source_node: NodeId::new(0, 0),
        target_page: PageId::new(make_uuid(10)),
        target_node: None,
        trigger: TransitionTrigger::OnClick,
        animation: TransitionAnimation::Instant,
    };
    doc.add_transition(t).expect("add");
    let removed = doc.remove_transition(id);
    assert!(removed.is_some());
    assert!(doc.transitions.is_empty());
}

#[test]
fn test_remove_transition_not_found() {
    let mut doc = Document::new("Test".to_string());
    assert!(doc.remove_transition(make_uuid(99)).is_none());
}
```

- [ ] 3. Add `add_transition` and `remove_transition` methods to `Document`:

```rust
/// Adds a transition to the document.
///
/// # Errors
/// Returns `CoreError::ValidationError` if the transition is invalid or the document
/// is at capacity.
pub fn add_transition(
    &mut self,
    transition: crate::prototype::Transition,
) -> Result<(), CoreError> {
    crate::prototype::validate_transition(&transition)?;
    if self.transitions.len() >= crate::validate::MAX_TRANSITIONS_PER_DOCUMENT {
        return Err(CoreError::ValidationError(format!(
            "document already has {} transitions (maximum {})",
            self.transitions.len(),
            crate::validate::MAX_TRANSITIONS_PER_DOCUMENT
        )));
    }
    self.transitions.push(transition);
    Ok(())
}

/// Removes a transition by ID. Returns the removed transition if found.
pub fn remove_transition(&mut self, id: uuid::Uuid) -> Option<crate::prototype::Transition> {
    if let Some(pos) = self.transitions.iter().position(|t| t.id == id) {
        Some(self.transitions.remove(pos))
    } else {
        None
    }
}
```

- [ ] 4. Run tests and clippy:

```bash
cargo test -p agent-designer-core document::tests
cargo test -p agent-designer-core
cargo clippy -p agent-designer-core -- -D warnings
cargo fmt -p agent-designer-core
```

- [ ] 5. Commit:

```bash
git add crates/core/src/document.rs
git commit -m "feat(core): add Document transition mutation API (spec-01)"
```

---

## Task 2: Implement transition commands

**Files:**
- Create: `crates/core/src/commands/transition_commands.rs`
- Modify: `crates/core/src/commands/mod.rs`

- [ ] 1. Read `CLAUDE.md` in full. Identify all rules that apply.

- [ ] 2. Add `pub mod transition_commands;` to `crates/core/src/commands/mod.rs`.

- [ ] 3. Create `crates/core/src/commands/transition_commands.rs` with AddTransition, RemoveTransition, UpdateTransition and full tests:

```rust
// crates/core/src/commands/transition_commands.rs
#![allow(clippy::unnecessary_literal_bound)]
// The Command trait's description() returns &str (not &'static str) because
// CompoundCommand borrows from its String field. Literal returns in other impls
// trigger this lint unnecessarily.

use uuid::Uuid;

use crate::command::{Command, SideEffect};
use crate::document::Document;
use crate::error::CoreError;
use crate::prototype::Transition;

/// Adds a transition to the document.
#[derive(Debug)]
pub struct AddTransition {
    /// The transition to add.
    pub transition: Transition,
}

impl Command for AddTransition {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.add_transition(self.transition.clone())?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.remove_transition(self.transition.id).ok_or_else(|| {
            CoreError::ValidationError(format!(
                "cannot undo AddTransition: transition {} not found",
                self.transition.id
            ))
        })?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Add transition"
    }
}

/// Removes a transition from the document.
#[derive(Debug)]
pub struct RemoveTransition {
    /// The ID of the transition to remove.
    pub transition_id: Uuid,
    /// Snapshot of the removed transition for undo.
    pub snapshot: Transition,
}

impl Command for RemoveTransition {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.remove_transition(self.transition_id).ok_or_else(|| {
            CoreError::ValidationError(format!(
                "transition {} not found",
                self.transition_id
            ))
        })?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.add_transition(self.snapshot.clone())?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Remove transition"
    }
}

/// Updates a transition's trigger and animation.
#[derive(Debug)]
pub struct UpdateTransition {
    /// The ID of the transition to update.
    pub transition_id: Uuid,
    /// The new transition state.
    pub new_transition: Transition,
    /// The old transition state for undo.
    pub old_transition: Transition,
}

impl Command for UpdateTransition {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        crate::prototype::validate_transition(&self.new_transition)?;
        let pos = doc
            .transitions
            .iter()
            .position(|t| t.id == self.transition_id)
            .ok_or_else(|| {
                CoreError::ValidationError(format!(
                    "transition {} not found",
                    self.transition_id
                ))
            })?;
        doc.transitions[pos] = self.new_transition.clone();
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        crate::prototype::validate_transition(&self.old_transition)?;
        let pos = doc
            .transitions
            .iter()
            .position(|t| t.id == self.transition_id)
            .ok_or_else(|| {
                CoreError::ValidationError(format!(
                    "transition {} not found for undo",
                    self.transition_id
                ))
            })?;
        doc.transitions[pos] = self.old_transition.clone();
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Update transition"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::id::{NodeId, PageId};
    use crate::prototype::{TransitionAnimation, TransitionTrigger};

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn make_transition(id_byte: u8) -> Transition {
        Transition {
            id: make_uuid(id_byte),
            source_node: NodeId::new(0, 0),
            target_page: PageId::new(make_uuid(10)),
            target_node: None,
            trigger: TransitionTrigger::OnClick,
            animation: TransitionAnimation::Instant,
        }
    }

    #[test]
    fn test_add_transition_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let cmd = AddTransition {
            transition: make_transition(1),
        };
        cmd.apply(&mut doc).expect("apply");
        assert_eq!(doc.transitions.len(), 1);

        cmd.undo(&mut doc).expect("undo");
        assert!(doc.transitions.is_empty());
    }

    #[test]
    fn test_remove_transition_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let t = make_transition(1);
        doc.add_transition(t.clone()).expect("add");

        let cmd = RemoveTransition {
            transition_id: make_uuid(1),
            snapshot: t,
        };
        cmd.apply(&mut doc).expect("apply");
        assert!(doc.transitions.is_empty());

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(doc.transitions.len(), 1);
    }

    #[test]
    fn test_update_transition_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let old = make_transition(1);
        doc.add_transition(old.clone()).expect("add");

        let mut new = old.clone();
        new.trigger = TransitionTrigger::OnHover;
        new.animation = TransitionAnimation::Dissolve { duration: 0.3 };

        let cmd = UpdateTransition {
            transition_id: make_uuid(1),
            new_transition: new,
            old_transition: old,
        };
        cmd.apply(&mut doc).expect("apply");
        assert_eq!(doc.transitions[0].trigger, TransitionTrigger::OnHover);

        cmd.undo(&mut doc).expect("undo");
        assert_eq!(doc.transitions[0].trigger, TransitionTrigger::OnClick);
    }

    #[test]
    fn test_add_transition_validates_duration() {
        let mut doc = Document::new("Test".to_string());
        let mut t = make_transition(1);
        t.trigger = TransitionTrigger::AfterDelay { seconds: -1.0 };
        let cmd = AddTransition { transition: t };
        assert!(cmd.apply(&mut doc).is_err());
    }

    #[test]
    fn test_remove_nonexistent_transition() {
        let mut doc = Document::new("Test".to_string());
        let cmd = RemoveTransition {
            transition_id: make_uuid(99),
            snapshot: make_transition(99),
        };
        assert!(cmd.apply(&mut doc).is_err());
    }
}
```

- [ ] 4. Run tests and clippy:

```bash
cargo test -p agent-designer-core commands::transition_commands
cargo test -p agent-designer-core
cargo clippy -p agent-designer-core -- -D warnings
cargo fmt -p agent-designer-core
```

- [ ] 5. Commit:

```bash
git add crates/core/src/commands/
git commit -m "feat(core): add transition commands — AddTransition, RemoveTransition, UpdateTransition (spec-01)"
```

---

## Task 3: Implement token commands

**Files:**
- Create: `crates/core/src/commands/token_commands.rs`
- Modify: `crates/core/src/commands/mod.rs`

- [ ] 1. Read `CLAUDE.md` in full. Identify all rules that apply.

- [ ] 2. Add `pub mod token_commands;` to `crates/core/src/commands/mod.rs`.

- [ ] 3. Create `crates/core/src/commands/token_commands.rs` with AddToken, RemoveToken, UpdateToken:

```rust
// crates/core/src/commands/token_commands.rs
#![allow(clippy::unnecessary_literal_bound)]
// The Command trait's description() returns &str (not &'static str) because
// CompoundCommand borrows from its String field.

use crate::command::{Command, SideEffect};
use crate::document::Document;
use crate::error::CoreError;
use crate::token::Token;

/// Adds a token to the document's token context.
#[derive(Debug)]
pub struct AddToken {
    /// The token to add.
    pub token: Token,
}

impl Command for AddToken {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.token_context.insert(self.token.clone())?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.token_context.remove(self.token.name()).ok_or_else(|| {
            CoreError::ValidationError(format!(
                "cannot undo AddToken: token '{}' not found",
                self.token.name()
            ))
        })?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Add token"
    }
}

/// Removes a token from the document's token context.
#[derive(Debug)]
pub struct RemoveToken {
    /// The name of the token to remove.
    pub token_name: String,
    /// Snapshot of the removed token for undo.
    pub snapshot: Token,
}

impl Command for RemoveToken {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.token_context.remove(&self.token_name).ok_or_else(|| {
            CoreError::TokenNotFound(self.token_name.clone())
        })?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.token_context.insert(self.snapshot.clone())?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Remove token"
    }
}

/// Replaces a token with a new version (same name, different value/type/description).
#[derive(Debug)]
pub struct UpdateToken {
    /// The new token (must have the same name as the old one).
    pub new_token: Token,
    /// The old token for undo.
    pub old_token: Token,
}

impl Command for UpdateToken {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        if self.new_token.name() != self.old_token.name() {
            return Err(CoreError::ValidationError(format!(
                "UpdateToken: name mismatch — new='{}', old='{}'",
                self.new_token.name(),
                self.old_token.name()
            )));
        }
        // Token::new already validated the new token at construction time.
        // Re-insert replaces the existing entry.
        doc.token_context.insert(self.new_token.clone())?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.token_context.insert(self.old_token.clone())?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Update token"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::id::TokenId;
    use crate::node::Color;
    use crate::token::{TokenType, TokenValue};
    use uuid::Uuid;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn make_color_token(name: &str) -> Token {
        Token::new(
            TokenId::new(make_uuid(1)),
            name.to_string(),
            TokenValue::Color {
                value: Color::default(),
            },
            TokenType::Color,
            None,
        )
        .expect("valid token")
    }

    #[test]
    fn test_add_token_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let cmd = AddToken {
            token: make_color_token("color.primary"),
        };
        cmd.apply(&mut doc).expect("apply");
        assert!(doc.token_context.get("color.primary").is_some());

        cmd.undo(&mut doc).expect("undo");
        assert!(doc.token_context.get("color.primary").is_none());
    }

    #[test]
    fn test_remove_token_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let token = make_color_token("color.primary");
        doc.token_context.insert(token.clone()).expect("insert");

        let cmd = RemoveToken {
            token_name: "color.primary".to_string(),
            snapshot: token,
        };
        cmd.apply(&mut doc).expect("apply");
        assert!(doc.token_context.is_empty());

        cmd.undo(&mut doc).expect("undo");
        assert!(doc.token_context.get("color.primary").is_some());
    }

    #[test]
    fn test_remove_nonexistent_token() {
        let mut doc = Document::new("Test".to_string());
        let cmd = RemoveToken {
            token_name: "nonexistent".to_string(),
            snapshot: make_color_token("nonexistent"),
        };
        assert!(cmd.apply(&mut doc).is_err());
    }

    #[test]
    fn test_update_token_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let old = make_color_token("color.primary");
        doc.token_context.insert(old.clone()).expect("insert");

        let new = Token::new(
            TokenId::new(make_uuid(1)),
            "color.primary".to_string(),
            TokenValue::Number { value: 42.0 },
            TokenType::Number,
            Some("Updated".to_string()),
        )
        .expect("valid");

        let cmd = UpdateToken {
            new_token: new,
            old_token: old,
        };
        cmd.apply(&mut doc).expect("apply");
        let resolved = doc.token_context.get("color.primary").expect("get");
        assert!(matches!(resolved.value(), TokenValue::Number { .. }));

        cmd.undo(&mut doc).expect("undo");
        let resolved = doc.token_context.get("color.primary").expect("get");
        assert!(matches!(resolved.value(), TokenValue::Color { .. }));
    }

    #[test]
    fn test_update_token_name_mismatch() {
        let mut doc = Document::new("Test".to_string());
        let old = make_color_token("color.primary");
        doc.token_context.insert(old.clone()).expect("insert");

        let new = make_color_token("color.secondary");
        let cmd = UpdateToken {
            new_token: new,
            old_token: old,
        };
        assert!(cmd.apply(&mut doc).is_err());
    }
}
```

- [ ] 4. Run tests and clippy:

```bash
cargo test -p agent-designer-core commands::token_commands
cargo test -p agent-designer-core
cargo clippy -p agent-designer-core -- -D warnings
cargo fmt -p agent-designer-core
```

- [ ] 5. Commit:

```bash
git add crates/core/src/commands/
git commit -m "feat(core): add token commands — AddToken, RemoveToken, UpdateToken (spec-01)"
```

---

## Task 4: Implement component commands

**Files:**
- Create: `crates/core/src/commands/component_commands.rs`
- Modify: `crates/core/src/commands/mod.rs`

- [ ] 1. Read `CLAUDE.md` in full. Identify all rules that apply.

- [ ] 2. Add `pub mod component_commands;` to `crates/core/src/commands/mod.rs`.

- [ ] 3. Create `crates/core/src/commands/component_commands.rs` with AddComponent, RemoveComponent, SetOverride, RemoveOverride:

```rust
// crates/core/src/commands/component_commands.rs
#![allow(clippy::unnecessary_literal_bound)]
// The Command trait's description() returns &str (not &'static str) because
// CompoundCommand borrows from its String field.

use crate::command::{Command, SideEffect};
use crate::component::{
    ComponentDef, OverrideKey, OverrideMap, OverrideSource, OverrideValue,
};
use crate::document::Document;
use crate::error::CoreError;
use crate::id::{ComponentId, NodeId};

/// Registers a component definition in the document.
#[derive(Debug)]
pub struct AddComponent {
    /// The component definition to add.
    pub component: ComponentDef,
}

impl Command for AddComponent {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.add_component(self.component.clone())?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.components
            .remove(&self.component.id())
            .ok_or(CoreError::ComponentNotFound(self.component.id()))?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Add component"
    }
}

/// Removes a component definition from the document.
#[derive(Debug)]
pub struct RemoveComponent {
    /// The ID of the component to remove.
    pub component_id: ComponentId,
    /// Snapshot of the removed component for undo.
    pub snapshot: ComponentDef,
}

impl Command for RemoveComponent {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.components
            .remove(&self.component_id)
            .ok_or(CoreError::ComponentNotFound(self.component_id))?;
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        doc.add_component(self.snapshot.clone())?;
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Remove component"
    }
}

/// Sets an override on a component instance node's OverrideMap.
#[derive(Debug)]
pub struct SetOverride {
    /// The node ID of the component instance.
    pub node_id: NodeId,
    /// The override key (node UUID + property path).
    pub key: OverrideKey,
    /// The new override value.
    pub new_value: OverrideValue,
    /// The new override source.
    pub new_source: OverrideSource,
    /// The old override value and source (None if this is a new override).
    pub old_entry: Option<(OverrideValue, OverrideSource)>,
}

impl Command for SetOverride {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            crate::node::NodeKind::ComponentInstance { overrides, .. } => {
                overrides.set(
                    self.key.clone(),
                    self.new_value.clone(),
                    self.new_source,
                )?;
            }
            _ => {
                return Err(CoreError::ValidationError(
                    "SetOverride: node is not a ComponentInstance".to_string(),
                ));
            }
        }
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            crate::node::NodeKind::ComponentInstance { overrides, .. } => {
                match &self.old_entry {
                    Some((val, src)) => {
                        overrides.set(self.key.clone(), val.clone(), *src)?;
                    }
                    None => {
                        overrides.remove(&self.key);
                    }
                }
            }
            _ => {
                return Err(CoreError::ValidationError(
                    "SetOverride undo: node is not a ComponentInstance".to_string(),
                ));
            }
        }
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Set override"
    }
}

/// Removes an override from a component instance node's OverrideMap.
#[derive(Debug)]
pub struct RemoveOverride {
    /// The node ID of the component instance.
    pub node_id: NodeId,
    /// The override key to remove.
    pub key: OverrideKey,
    /// The old value and source for undo.
    pub old_entry: (OverrideValue, OverrideSource),
}

impl Command for RemoveOverride {
    fn apply(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            crate::node::NodeKind::ComponentInstance { overrides, .. } => {
                overrides.remove(&self.key).ok_or_else(|| {
                    CoreError::ValidationError(format!(
                        "override not found for key {:?}",
                        self.key
                    ))
                })?;
            }
            _ => {
                return Err(CoreError::ValidationError(
                    "RemoveOverride: node is not a ComponentInstance".to_string(),
                ));
            }
        }
        Ok(vec![])
    }

    fn undo(&self, doc: &mut Document) -> Result<Vec<SideEffect>, CoreError> {
        let node = doc.arena.get_mut(self.node_id)?;
        match &mut node.kind {
            crate::node::NodeKind::ComponentInstance { overrides, .. } => {
                overrides.set(
                    self.key.clone(),
                    self.old_entry.0.clone(),
                    self.old_entry.1,
                )?;
            }
            _ => {
                return Err(CoreError::ValidationError(
                    "RemoveOverride undo: node is not a ComponentInstance".to_string(),
                ));
            }
        }
        Ok(vec![])
    }

    fn description(&self) -> &str {
        "Remove override"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::{OverrideKey, PropertyPath};
    use crate::id::NodeId;
    use crate::node::{Node, NodeKind};
    use std::collections::HashMap;
    use uuid::Uuid;

    fn make_uuid(n: u8) -> Uuid {
        Uuid::from_bytes([n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    }

    fn setup_doc_with_instance() -> (Document, NodeId) {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::ComponentInstance {
                component_id: ComponentId::new(make_uuid(50)),
                variant: None,
                overrides: OverrideMap::new(),
                property_values: HashMap::new(),
            },
            "Button 1".to_string(),
        )
        .expect("valid node");
        let node_id = doc.arena.insert(node).expect("insert");
        (doc, node_id)
    }

    // ── AddComponent / RemoveComponent ──────────────────────────────

    #[test]
    fn test_add_component_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let def = ComponentDef::new(
            ComponentId::new(make_uuid(50)),
            "Button".to_string(),
            NodeId::new(0, 0),
            vec![],
            vec![],
        )
        .expect("valid");

        let cmd = AddComponent {
            component: def.clone(),
        };
        cmd.apply(&mut doc).expect("apply");
        assert!(doc.components.contains_key(&ComponentId::new(make_uuid(50))));

        cmd.undo(&mut doc).expect("undo");
        assert!(doc.components.is_empty());
    }

    #[test]
    fn test_remove_component_apply_and_undo() {
        let mut doc = Document::new("Test".to_string());
        let def = ComponentDef::new(
            ComponentId::new(make_uuid(50)),
            "Button".to_string(),
            NodeId::new(0, 0),
            vec![],
            vec![],
        )
        .expect("valid");
        doc.add_component(def.clone()).expect("add");

        let cmd = RemoveComponent {
            component_id: ComponentId::new(make_uuid(50)),
            snapshot: def,
        };
        cmd.apply(&mut doc).expect("apply");
        assert!(doc.components.is_empty());

        cmd.undo(&mut doc).expect("undo");
        assert!(doc.components.contains_key(&ComponentId::new(make_uuid(50))));
    }

    // ── SetOverride / RemoveOverride ────────────────────────────────

    #[test]
    fn test_set_override_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_instance();
        let key = OverrideKey::new(make_uuid(10), PropertyPath::Visible);

        let cmd = SetOverride {
            node_id,
            key: key.clone(),
            new_value: OverrideValue::Bool { value: false },
            new_source: OverrideSource::User,
            old_entry: None,
        };
        cmd.apply(&mut doc).expect("apply");

        // Verify override was set
        let node = doc.arena.get(node_id).expect("get");
        match &node.kind {
            NodeKind::ComponentInstance { overrides, .. } => {
                assert!(overrides.get(&key).is_some());
            }
            _ => panic!("expected ComponentInstance"),
        }

        cmd.undo(&mut doc).expect("undo");
        let node = doc.arena.get(node_id).expect("get");
        match &node.kind {
            NodeKind::ComponentInstance { overrides, .. } => {
                assert!(overrides.get(&key).is_none());
            }
            _ => panic!("expected ComponentInstance"),
        }
    }

    #[test]
    fn test_set_override_replaces_existing() {
        let (mut doc, node_id) = setup_doc_with_instance();
        let key = OverrideKey::new(make_uuid(10), PropertyPath::Visible);

        // Set initial override
        let cmd1 = SetOverride {
            node_id,
            key: key.clone(),
            new_value: OverrideValue::Bool { value: false },
            new_source: OverrideSource::User,
            old_entry: None,
        };
        cmd1.apply(&mut doc).expect("apply first");

        // Replace it
        let cmd2 = SetOverride {
            node_id,
            key: key.clone(),
            new_value: OverrideValue::Bool { value: true },
            new_source: OverrideSource::Variant,
            old_entry: Some((OverrideValue::Bool { value: false }, OverrideSource::User)),
        };
        cmd2.apply(&mut doc).expect("apply second");

        // Undo should restore the first value
        cmd2.undo(&mut doc).expect("undo");
        let node = doc.arena.get(node_id).expect("get");
        match &node.kind {
            NodeKind::ComponentInstance { overrides, .. } => {
                let (val, src) = overrides.get(&key).expect("get");
                assert_eq!(*val, OverrideValue::Bool { value: false });
                assert_eq!(*src, OverrideSource::User);
            }
            _ => panic!("expected ComponentInstance"),
        }
    }

    #[test]
    fn test_remove_override_apply_and_undo() {
        let (mut doc, node_id) = setup_doc_with_instance();
        let key = OverrideKey::new(make_uuid(10), PropertyPath::Name);

        // Add an override first
        let set_cmd = SetOverride {
            node_id,
            key: key.clone(),
            new_value: OverrideValue::String {
                value: "Custom".to_string(),
            },
            new_source: OverrideSource::User,
            old_entry: None,
        };
        set_cmd.apply(&mut doc).expect("set");

        let cmd = RemoveOverride {
            node_id,
            key: key.clone(),
            old_entry: (
                OverrideValue::String {
                    value: "Custom".to_string(),
                },
                OverrideSource::User,
            ),
        };
        cmd.apply(&mut doc).expect("apply remove");

        // Verify removed
        let node = doc.arena.get(node_id).expect("get");
        match &node.kind {
            NodeKind::ComponentInstance { overrides, .. } => {
                assert!(overrides.get(&key).is_none());
            }
            _ => panic!("expected ComponentInstance"),
        }

        cmd.undo(&mut doc).expect("undo");
        let node = doc.arena.get(node_id).expect("get");
        match &node.kind {
            NodeKind::ComponentInstance { overrides, .. } => {
                assert!(overrides.get(&key).is_some());
            }
            _ => panic!("expected ComponentInstance"),
        }
    }

    #[test]
    fn test_set_override_wrong_node_kind() {
        let mut doc = Document::new("Test".to_string());
        let node = Node::new(
            NodeId::new(0, 0),
            make_uuid(1),
            NodeKind::Frame { layout: None },
            "Frame".to_string(),
        )
        .expect("valid");
        let node_id = doc.arena.insert(node).expect("insert");

        let cmd = SetOverride {
            node_id,
            key: OverrideKey::new(make_uuid(10), PropertyPath::Visible),
            new_value: OverrideValue::Bool { value: false },
            new_source: OverrideSource::User,
            old_entry: None,
        };
        assert!(cmd.apply(&mut doc).is_err());
    }
}
```

- [ ] 4. Run tests and clippy:

```bash
cargo test -p agent-designer-core commands::component_commands
cargo test -p agent-designer-core
cargo clippy -p agent-designer-core -- -D warnings
cargo fmt -p agent-designer-core
```

- [ ] 5. Commit:

```bash
git add crates/core/src/commands/
git commit -m "feat(core): add component commands — AddComponent, RemoveComponent, SetOverride, RemoveOverride (spec-01)"
```

---

## Task 5: Run full workspace verification

**Files:** None (verification only)

- [ ] 1. Run full workspace tests:

```bash
cargo test --workspace
```

- [ ] 2. Run clippy:

```bash
cargo clippy --workspace -- -D warnings
```

- [ ] 3. Run format check:

```bash
cargo fmt --check
```

- [ ] 4. If any issues, fix and commit.

---

## Deferred Items

### Plan 01g: Wire Formats + Boolean Path Operations

- `SerializableCommand` — tagged enum for local undo/redo persistence (includes `old_*` fields)
- `BroadcastCommand` — tagged enum for WebSocket sync (forward-only, omits `old_*` fields)
- Token serialization to W3C Design Tokens Format
- Component serialization to component files
- Boolean path operations (`boolean_op`: Union, Subtract, Intersect, Exclude)
