// crates/core/src/commands/transition_commands.rs

use uuid::Uuid;

use crate::command::FieldOperation;
use crate::document::Document;
use crate::error::CoreError;
use crate::prototype::Transition;

/// Adds a transition to the document.
#[derive(Debug)]
pub struct AddTransition {
    /// The transition to add.
    pub transition: Transition,
}

impl FieldOperation for AddTransition {
    fn validate(&self, _doc: &Document) -> Result<(), CoreError> {
        crate::prototype::validate_transition(&self.transition)?;
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.add_transition(self.transition.clone())?;
        Ok(())
    }
}

/// Removes a transition from the document.
#[derive(Debug)]
pub struct RemoveTransition {
    /// The ID of the transition to remove.
    pub transition_id: Uuid,
}

impl FieldOperation for RemoveTransition {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        if !doc.transitions.iter().any(|t| t.id == self.transition_id) {
            return Err(CoreError::TransitionNotFound(self.transition_id));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        doc.remove_transition(self.transition_id)
            .ok_or(CoreError::TransitionNotFound(self.transition_id))?;
        Ok(())
    }
}

/// Updates a transition's trigger and animation.
#[derive(Debug)]
pub struct UpdateTransition {
    /// The ID of the transition to update.
    pub transition_id: Uuid,
    /// The new transition state.
    pub new_transition: Transition,
}

impl FieldOperation for UpdateTransition {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        if self.new_transition.id != self.transition_id {
            return Err(CoreError::ValidationError(
                "UpdateTransition: transition_id must match new transition ID".to_string(),
            ));
        }
        crate::prototype::validate_transition(&self.new_transition)?;
        if !doc.transitions.iter().any(|t| t.id == self.transition_id) {
            return Err(CoreError::TransitionNotFound(self.transition_id));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let pos = doc
            .transitions
            .iter()
            .position(|t| t.id == self.transition_id)
            .ok_or(CoreError::TransitionNotFound(self.transition_id))?;
        doc.transitions[pos] = self.new_transition.clone();
        Ok(())
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
    fn test_add_transition_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let op = AddTransition {
            transition: make_transition(1),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert_eq!(doc.transitions.len(), 1);
    }

    #[test]
    fn test_remove_transition_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let t = make_transition(1);
        doc.add_transition(t).expect("add");

        let op = RemoveTransition {
            transition_id: make_uuid(1),
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert!(doc.transitions.is_empty());
    }

    #[test]
    fn test_update_transition_validate_and_apply() {
        let mut doc = Document::new("Test".to_string());
        let old = make_transition(1);
        doc.add_transition(old).expect("add");

        let mut new = make_transition(1);
        new.trigger = TransitionTrigger::OnHover;
        new.animation = TransitionAnimation::Dissolve { duration: 0.3 };

        let op = UpdateTransition {
            transition_id: make_uuid(1),
            new_transition: new,
        };
        op.validate(&doc).expect("validate");
        op.apply(&mut doc).expect("apply");
        assert_eq!(doc.transitions[0].trigger, TransitionTrigger::OnHover);
    }

    #[test]
    fn test_add_transition_validates_duration() {
        let doc = Document::new("Test".to_string());
        let mut t = make_transition(1);
        t.trigger = TransitionTrigger::AfterDelay { seconds: -1.0 };
        let op = AddTransition { transition: t };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_update_transition_id_mismatch_rejected() {
        let mut doc = Document::new("Test".to_string());
        let old = make_transition(1);
        doc.add_transition(old).expect("add");

        let mut new = make_transition(1);
        new.id = make_uuid(2); // ID mismatch

        let op = UpdateTransition {
            transition_id: make_uuid(1),
            new_transition: new,
        };
        assert!(op.validate(&doc).is_err());
    }

    #[test]
    fn test_remove_nonexistent_transition_returns_transition_not_found() {
        let doc = Document::new("Test".to_string());
        let op = RemoveTransition {
            transition_id: make_uuid(99),
        };
        assert!(matches!(
            op.validate(&doc),
            Err(CoreError::TransitionNotFound(_))
        ));
    }
}
