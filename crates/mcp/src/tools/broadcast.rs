//! Broadcast helpers for MCP tool implementations.
//!
//! Provides convenience functions to construct transaction payloads. The
//! session-scoped envelope in `crate::server` stamps the per-session sequence
//! number and publishes the resulting transaction on the session's broadcast
//! channel (which the 22a persistence task and the GraphQL `transactionApplied`
//! subscription both consume).

use sigil_state::{OperationPayload, TransactionPayload};

/// User ID used for all MCP-originated transactions.
pub const MCP_USER_ID: &str = "mcp-agent";

/// Constructs a `TransactionPayload` containing a single operation.
///
/// The `seq` field is set to 0 and will be assigned by `DocumentSession::publish`.
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
/// The `seq` field is set to 0 and will be assigned by `DocumentSession::publish`.
#[must_use]
pub fn multi_op_transaction(operations: Vec<OperationPayload>) -> TransactionPayload {
    TransactionPayload {
        transaction_id: uuid::Uuid::new_v4().to_string(),
        user_id: MCP_USER_ID.to_string(),
        seq: 0,
        operations,
    }
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
                node_uuid: String::new(),
                op_type: "delete_nodes".to_string(),
                path: String::new(),
                value: Some(serde_json::json!({ "node_uuids": ["node-b"] })),
            },
        ];
        let tx = multi_op_transaction(ops);
        assert_eq!(tx.user_id, MCP_USER_ID);
        assert_eq!(tx.seq, 0);
        assert_eq!(tx.operations.len(), 2);
    }
}
