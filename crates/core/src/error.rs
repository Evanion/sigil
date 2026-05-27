use uuid::Uuid;

use crate::id::{ComponentId, NodeId, PageId};

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("node not found: {0}")]
    NodeNotFound(NodeId),

    #[error("stale node reference: {0}")]
    StaleNodeId(NodeId),

    #[error("arena capacity exceeded (max {0} nodes)")]
    CapacityExceeded(usize),

    #[error("component not found: {0:?}")]
    ComponentNotFound(ComponentId),

    #[error("token not found: {0}")]
    TokenNotFound(String),

    #[error("token alias cycle detected: {0}")]
    TokenCycleDetected(String),

    #[error("invalid token name: {0}")]
    InvalidTokenName(String),

    #[error("invalid parent: {0} cannot be a parent")]
    InvalidParent(NodeId),

    #[error("cycle detected: cannot make {0} a child of {1}")]
    CycleDetected(NodeId, NodeId),

    #[error("name conflict: {0} already exists in target")]
    NameConflict(String),

    #[error("boolean operation failed: {0}")]
    BooleanOpFailed(String),

    #[error("serialization error: {0}")]
    SerializationError(String),

    #[error("unsupported schema version: {0} (max supported: {1})")]
    UnsupportedSchemaVersion(u32, u32),

    #[error("validation error: {0}")]
    ValidationError(String),

    #[error("input too large: {0}")]
    InputTooLarge(String),

    #[error("duplicate uuid: {0}")]
    DuplicateUuid(Uuid),

    #[error("transition not found: {0}")]
    TransitionNotFound(Uuid),

    #[error("page not found: {0:?}")]
    PageNotFound(PageId),

    /// Tree-walk depth exceeded the configured limit (Spec 19 §9).
    #[error("tree depth limit exceeded: limit {limit}, at node {node_id:?}")]
    TreeDepthExceeded { limit: usize, node_id: NodeId },

    /// A multi-item mutation failed mid-loop AND its rollback also failed.
    /// Carries the primary failure plus every per-item rollback failure for
    /// diagnostic completeness. Per CLAUDE.md §11 "No Silent Error Suppression".
    #[error("rollback failed: primary error: {primary:?}; rollback errors: {rollback_errors:?}")]
    RollbackFailed {
        primary: Box<CoreError>,
        rollback_errors: Vec<CoreError>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_node_not_found_error_displays_id() {
        let id = NodeId {
            index: 42,
            generation: 7,
        };
        let err = CoreError::NodeNotFound(id);
        let msg = format!("{err}");
        assert!(msg.contains("42"), "expected index in message: {msg}");
        assert!(msg.contains("node not found"), "expected prefix: {msg}");
    }

    #[test]
    fn test_stale_node_id_error_displays_id() {
        let id = NodeId {
            index: 3,
            generation: 99,
        };
        let err = CoreError::StaleNodeId(id);
        let msg = format!("{err}");
        assert!(
            msg.contains("stale node reference"),
            "expected prefix: {msg}"
        );
    }

    #[test]
    fn test_capacity_exceeded_error_displays_max() {
        let err = CoreError::CapacityExceeded(100_000);
        let msg = format!("{err}");
        assert!(msg.contains("100000"), "expected max in message: {msg}");
    }

    #[test]
    fn test_unsupported_schema_version_displays_versions() {
        let err = CoreError::UnsupportedSchemaVersion(5, 1);
        let msg = format!("{err}");
        assert!(msg.contains('5'), "expected file version: {msg}");
        assert!(msg.contains('1'), "expected max version: {msg}");
    }

    #[test]
    fn test_cycle_detected_displays_both_nodes() {
        let parent = NodeId {
            index: 1,
            generation: 0,
        };
        let child = NodeId {
            index: 2,
            generation: 0,
        };
        let err = CoreError::CycleDetected(parent, child);
        let msg = format!("{err}");
        assert!(msg.contains("cycle detected"), "expected prefix: {msg}");
    }

    #[test]
    fn test_validation_error_displays_message() {
        let err = CoreError::ValidationError("name too long".to_string());
        let msg = format!("{err}");
        assert!(msg.contains("name too long"), "expected detail: {msg}");
    }

    #[test]
    fn test_duplicate_uuid_displays_uuid() {
        let uuid = Uuid::nil();
        let err = CoreError::DuplicateUuid(uuid);
        let msg = format!("{err}");
        assert!(msg.contains("duplicate uuid"), "expected prefix: {msg}");
    }

    #[test]
    fn test_transition_not_found_displays_uuid() {
        let uuid = Uuid::nil();
        let err = CoreError::TransitionNotFound(uuid);
        let msg = format!("{err}");
        assert!(
            msg.contains("transition not found"),
            "expected prefix: {msg}"
        );
    }

    #[test]
    fn test_page_not_found_displays_id() {
        let id = PageId(Uuid::nil());
        let err = CoreError::PageNotFound(id);
        let msg = format!("{err}");
        assert!(msg.contains("page not found"), "expected prefix: {msg}");
    }

    #[test]
    fn test_error_is_send_not_required() {
        // CoreError intentionally does NOT require Send — WASM compat
        fn assert_debug<T: std::fmt::Debug>() {}
        assert_debug::<CoreError>();
    }

    #[test]
    fn test_node_id_equality() {
        let a = NodeId {
            index: 1,
            generation: 5,
        };
        let b = NodeId {
            index: 1,
            generation: 5,
        };
        let c = NodeId {
            index: 1,
            generation: 6,
        };
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn test_tree_depth_exceeded_displays_limit_and_node() {
        let id = NodeId {
            index: 7,
            generation: 1,
        };
        let err = CoreError::TreeDepthExceeded {
            limit: 64,
            node_id: id,
        };
        let msg = format!("{err}");
        assert!(msg.contains("tree depth"), "expected prefix: {msg}");
        assert!(msg.contains("64"), "expected limit in message: {msg}");
    }

    #[test]
    fn test_rollback_failed_carries_primary_and_rollback_errors() {
        let primary = CoreError::ValidationError("primary".to_string());
        let rb_err = CoreError::ValidationError("rollback".to_string());
        let compound = CoreError::RollbackFailed {
            primary: Box::new(primary),
            rollback_errors: vec![rb_err],
        };
        match compound {
            CoreError::RollbackFailed {
                primary,
                rollback_errors,
            } => {
                assert!(matches!(*primary, CoreError::ValidationError(_)));
                assert_eq!(rollback_errors.len(), 1);
                assert!(matches!(rollback_errors[0], CoreError::ValidationError(_)));
            }
            _ => panic!("expected RollbackFailed"),
        }
    }

    #[test]
    fn test_node_id_copy() {
        let a = NodeId {
            index: 1,
            generation: 0,
        };
        let b = a;
        assert_eq!(a, b); // a is still usable — Copy
    }
}
