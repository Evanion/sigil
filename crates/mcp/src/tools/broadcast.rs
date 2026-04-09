//! Broadcast helpers for MCP tool implementations.
//!
//! Provides convenience functions to construct transaction payloads and
//! publish them through `AppState::publish_transaction`. All mutating MCP
//! tools use these helpers to ensure consistent broadcast + persistence
//! signaling.

use agent_designer_state::{AppState, MutationEventKind, OperationPayload, TransactionPayload};

/// User ID used for all MCP-originated transactions.
pub const MCP_USER_ID: &str = "mcp-agent";

/// Constructs a `TransactionPayload` containing a single operation.
///
/// The `seq` field is set to 0 and will be assigned by
/// `AppState::publish_transaction`.
#[must_use]
pub fn single_op_transaction(
    node_uuid: &str,
    op_type: &str,
    path: &str,
    value: Option<serde_json::Value>,
) -> TransactionPayload {
    TransactionPayload {
        transaction_id: uuid::Uuid::new_v4().to_string(),
        user_id: MCP_USER_ID.to_string(),
        seq: 0,
        operations: vec![OperationPayload {
            id: uuid::Uuid::new_v4().to_string(),
            node_uuid: node_uuid.to_string(),
            op_type: op_type.to_string(),
            path: path.to_string(),
            value,
        }],
    }
}

/// Constructs a `TransactionPayload` containing multiple operations.
///
/// The `seq` field is set to 0 and will be assigned by
/// `AppState::publish_transaction`.
#[must_use]
pub fn multi_op_transaction(operations: Vec<OperationPayload>) -> TransactionPayload {
    TransactionPayload {
        transaction_id: uuid::Uuid::new_v4().to_string(),
        user_id: MCP_USER_ID.to_string(),
        seq: 0,
        operations,
    }
}

/// Signals dirty state and publishes a single-operation transaction.
///
/// This is the standard "broadcast + persist" pattern used by all mutating
/// MCP tools. It:
/// 1. Signals dirty state so the persistence task will flush to disk.
/// 2. Constructs a single-operation transaction and publishes it via
///    `AppState::publish_transaction`, which assigns a sequence number
///    and broadcasts to all connected clients.
pub fn broadcast_and_persist(
    state: &AppState,
    kind: MutationEventKind,
    node_uuid: &str,
    op_type: &str,
    path: &str,
    value: Option<serde_json::Value>,
) {
    state.signal_dirty();
    state.publish_transaction(
        kind,
        Some(node_uuid.to_string()),
        single_op_transaction(node_uuid, op_type, path, value),
    );
}

/// Signals dirty state and publishes a transaction for token operations.
///
/// Token operations do not have a node UUID, so the `uuid` field on the
/// mutation event is set to `None`.
pub fn broadcast_token_and_persist(
    state: &AppState,
    kind: MutationEventKind,
    token_name: &str,
    op_type: &str,
    value: Option<serde_json::Value>,
) {
    state.signal_dirty();
    state.publish_transaction(
        kind,
        None,
        TransactionPayload {
            transaction_id: uuid::Uuid::new_v4().to_string(),
            user_id: MCP_USER_ID.to_string(),
            seq: 0,
            operations: vec![OperationPayload {
                id: uuid::Uuid::new_v4().to_string(),
                node_uuid: String::new(),
                op_type: op_type.to_string(),
                path: token_name.to_string(),
                value,
            }],
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_single_op_transaction_creates_valid_payload() {
        let tx = single_op_transaction(
            "node-123",
            "set_field",
            "name",
            Some(serde_json::json!("hello")),
        );
        assert_eq!(tx.user_id, MCP_USER_ID);
        assert_eq!(tx.seq, 0);
        assert_eq!(tx.operations.len(), 1);
        assert_eq!(tx.operations[0].node_uuid, "node-123");
        assert_eq!(tx.operations[0].op_type, "set_field");
        assert_eq!(tx.operations[0].path, "name");
    }

    #[test]
    fn test_multi_op_transaction_creates_valid_payload() {
        let ops = vec![
            OperationPayload {
                id: "op-1".to_string(),
                node_uuid: "node-a".to_string(),
                op_type: "set_field".to_string(),
                path: "name".to_string(),
                value: None,
            },
            OperationPayload {
                id: "op-2".to_string(),
                node_uuid: "node-b".to_string(),
                op_type: "delete_node".to_string(),
                path: String::new(),
                value: None,
            },
        ];
        let tx = multi_op_transaction(ops);
        assert_eq!(tx.user_id, MCP_USER_ID);
        assert_eq!(tx.seq, 0);
        assert_eq!(tx.operations.len(), 2);
    }

    #[test]
    fn test_broadcast_and_persist_signals_dirty_and_publishes() {
        use agent_designer_state::MUTATION_BROADCAST_CAPACITY;
        use tokio::sync::broadcast;

        let mut state = AppState::new();
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        let mut rx = tx.subscribe();
        state.set_event_tx(tx);

        broadcast_and_persist(
            &state,
            MutationEventKind::NodeUpdated,
            "node-xyz",
            "set_field",
            "name",
            Some(serde_json::json!("new name")),
        );

        let received = rx.try_recv().expect("should receive event");
        assert_eq!(received.kind, MutationEventKind::NodeUpdated);
        assert_eq!(received.uuid.as_deref(), Some("node-xyz"));
        let tx_payload = received.transaction.expect("should have transaction");
        assert!(tx_payload.seq > 0, "seq should be assigned");
        assert_eq!(tx_payload.user_id, MCP_USER_ID);
        assert_eq!(tx_payload.operations.len(), 1);
        assert_eq!(tx_payload.operations[0].op_type, "set_field");
        assert_eq!(tx_payload.operations[0].path, "name");
    }

    #[test]
    fn test_broadcast_token_and_persist_signals_dirty_and_publishes() {
        use agent_designer_state::MUTATION_BROADCAST_CAPACITY;
        use tokio::sync::broadcast;

        let mut state = AppState::new();
        let (tx, _) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
        let mut rx = tx.subscribe();
        state.set_event_tx(tx);

        broadcast_token_and_persist(
            &state,
            MutationEventKind::TokenCreated,
            "spacing.md",
            "create",
            Some(serde_json::json!({"name": "spacing.md"})),
        );

        let received = rx.try_recv().expect("should receive event");
        assert_eq!(received.kind, MutationEventKind::TokenCreated);
        assert!(received.uuid.is_none(), "token events have no node UUID");
        let tx_payload = received.transaction.expect("should have transaction");
        assert!(tx_payload.seq > 0);
        assert_eq!(tx_payload.user_id, MCP_USER_ID);
    }
}
