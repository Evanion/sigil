//! History tools — undo and redo.
//!
//! Both operations follow the same pattern:
//!   lock → call `doc.undo()` or `doc.redo()` → capture `can_undo`/`can_redo` →
//!   drop lock → `signal_dirty` → return result.
//!
//! Errors from the core engine (e.g. `NothingToUndo`, `NothingToRedo`) are
//! propagated as `McpToolError::CoreError`.

use agent_designer_server::state::AppState;

use crate::error::McpToolError;
use crate::server::acquire_document_lock;
use crate::types::UndoRedoResult;

// ── Tool implementations ─────────────────────────────────────────────────────

/// Undoes the most recent command and returns updated undo/redo availability.
///
/// # Errors
///
/// Returns `McpToolError::CoreError(CoreError::NothingToUndo)` if the undo
/// stack is empty.
pub fn undo_impl(state: &AppState) -> Result<UndoRedoResult, McpToolError> {
    let result = {
        let mut doc = acquire_document_lock(state);
        doc.undo()?;
        UndoRedoResult {
            can_undo: doc.can_undo(),
            can_redo: doc.can_redo(),
        }
    };

    state.signal_dirty();
    Ok(result)
}

/// Redoes the most recently undone command and returns updated undo/redo
/// availability.
///
/// # Errors
///
/// Returns `McpToolError::CoreError(CoreError::NothingToRedo)` if the redo
/// stack is empty.
pub fn redo_impl(state: &AppState) -> Result<UndoRedoResult, McpToolError> {
    let result = {
        let mut doc = acquire_document_lock(state);
        doc.redo()?;
        UndoRedoResult {
            can_undo: doc.can_undo(),
            can_redo: doc.can_redo(),
        }
    };

    state.signal_dirty();
    Ok(result)
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use agent_designer_core::CoreError;
    use agent_designer_server::state::AppState;

    use super::*;
    use crate::error::McpToolError;
    use crate::tools::nodes::create_node_impl;
    use crate::tools::pages::create_page_impl;

    #[test]
    fn test_undo_on_empty_history_returns_error() {
        let state = AppState::new();
        let result = undo_impl(&state);
        assert!(result.is_err(), "expected error on empty undo stack");
        let err = result.unwrap_err();
        assert!(
            matches!(err, McpToolError::CoreError(CoreError::NothingToUndo)),
            "expected NothingToUndo, got: {err}"
        );
    }

    #[test]
    fn test_redo_on_empty_history_returns_error() {
        let state = AppState::new();
        let result = redo_impl(&state);
        assert!(result.is_err(), "expected error on empty redo stack");
        let err = result.unwrap_err();
        assert!(
            matches!(err, McpToolError::CoreError(CoreError::NothingToRedo)),
            "expected NothingToRedo, got: {err}"
        );
    }

    #[test]
    fn test_undo_redo_round_trip() {
        let state = AppState::new();

        // Create a page via the direct API (does not push to undo stack),
        // then create a node via execute (pushes to undo stack).
        let page = create_page_impl(&state, "Page 1").expect("create page");
        create_node_impl(&state, "frame", "My Frame", Some(&page.id), None, None)
            .expect("create node");

        // Only create_node went through doc.execute(); the undo stack has one entry.
        {
            let doc = crate::server::acquire_document_lock(&state);
            assert!(
                doc.can_undo(),
                "expected undo to be available after create_node"
            );
            assert!(!doc.can_redo(), "expected redo to be empty before any undo");
        }

        // Undo the create_node command — stack is now empty.
        let after_undo = undo_impl(&state).expect("undo create_node");
        assert!(
            !after_undo.can_undo,
            "undo stack should be empty after undoing the only command"
        );
        assert!(
            after_undo.can_redo,
            "create_node should be on the redo stack after undo"
        );

        // Redo the create_node command — undo stack has one entry again.
        let after_redo = redo_impl(&state).expect("redo create_node");
        assert!(
            after_redo.can_undo,
            "undo stack should be non-empty after redo"
        );
        assert!(
            !after_redo.can_redo,
            "redo stack should be empty after redoing the only undone command"
        );
    }
}
