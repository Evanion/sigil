// crates/core/src/commands/transition_commands.rs
// The Command trait's description() returns &str (not &'static str) because
// CompoundCommand borrows from its String field. Literal returns in other impls
// trigger this lint unnecessarily.
#![allow(clippy::unnecessary_literal_bound)]

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
            CoreError::ValidationError(format!("transition {} not found", self.transition_id))
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
                CoreError::ValidationError(format!("transition {} not found", self.transition_id))
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
