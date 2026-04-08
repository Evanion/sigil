use async_graphql::{InputObject, OneofObject, SimpleObject};

use agent_designer_core::{Document, NodeId};
use agent_designer_state::{MutationEvent, MutationEventKind, TransactionPayload};

// ── OneofObject input types for applyOperations ──────────────────────

/// Type-safe discriminated union for operation inputs.
///
/// Uses `@oneOf` — exactly one variant must be provided per input.
/// This replaces 16+ individual GraphQL mutations with a single endpoint.
#[derive(OneofObject)]
pub enum OperationInput {
    /// Set a field on an existing node (transform, name, style properties, etc.).
    SetField(SetFieldInput),
    /// Create a new node in the document.
    CreateNode(CreateNodeInput),
    /// Delete a node from the document.
    DeleteNode(DeleteNodeInput),
    /// Reparent a node under a new parent.
    Reparent(ReparentInput),
    /// Reorder a node within its parent's children list.
    Reorder(ReorderInput),
}

/// Input for setting a field on an existing node.
#[derive(InputObject)]
pub struct SetFieldInput {
    /// UUID of the target node.
    pub node_uuid: String,
    /// Field path: "transform", "name", "visible", "locked", "style.fills",
    /// `"style.strokes"`, `"style.effects"`, `"style.opacity"`, `"style.blend_mode"`, `"kind"`
    pub path: String,
    /// New value as JSON (shape depends on the field path).
    pub value: String,
}

/// Input for creating a new node.
#[derive(InputObject)]
pub struct CreateNodeInput {
    /// Pre-generated UUID for the new node.
    pub node_uuid: String,
    /// Node kind as JSON (e.g., `{"type": "rectangle", "corner_radii": [0,0,0,0]}`).
    pub kind: String,
    /// Display name for the new node.
    pub name: String,
    /// Optional initial transform as JSON.
    pub transform: Option<String>,
    /// Optional page UUID to add the node to.
    pub page_id: Option<String>,
}

/// Input for deleting a node.
#[derive(InputObject)]
pub struct DeleteNodeInput {
    /// UUID of the node to delete.
    pub node_uuid: String,
}

/// Input for reparenting a node.
#[derive(InputObject)]
pub struct ReparentInput {
    /// UUID of the node to reparent.
    pub node_uuid: String,
    /// UUID of the new parent node.
    pub new_parent_uuid: String,
    /// Position within the new parent's children list.
    pub position: i32,
}

/// Input for reordering a node within its parent.
#[derive(InputObject)]
pub struct ReorderInput {
    /// UUID of the node to reorder.
    pub node_uuid: String,
    /// Target position within the parent's children list.
    pub new_position: i32,
}

/// Result returned by `applyOperations`.
#[derive(SimpleObject)]
pub struct ApplyOperationsResult {
    /// Server-assigned sequence number (string because GraphQL Int is i32, seq is u64).
    pub seq: String,
}

/// Discriminator for document change events.
///
/// Used instead of raw strings to give GraphQL clients exhaustive matching
/// and to prevent typos in event filtering.
#[derive(async_graphql::Enum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocumentEventType {
    /// A new node was inserted into the document.
    NodeCreated,
    /// An existing node's properties changed.
    NodeUpdated,
    /// A node was removed from the document.
    NodeDeleted,
    /// A new page was created.
    PageCreated,
    /// A page's properties were updated.
    PageUpdated,
    /// A page was deleted.
    PageDeleted,
    /// A new design token was created.
    TokenCreated,
    /// A design token was updated.
    TokenUpdated,
    /// A design token was deleted.
    TokenDeleted,
}

/// A real-time event emitted when the document changes.
///
/// Sent to GraphQL subscription clients via the `documentChanged` stream.
/// The `event_type` field discriminates the kind of change, while `uuid` and
/// `data` carry optional context about the affected node.
#[derive(Clone, Debug, SimpleObject)]
pub struct DocumentEvent {
    /// Discriminator for the kind of change.
    pub event_type: DocumentEventType,
    /// UUID of the affected node, if applicable.
    pub uuid: Option<String>,
    /// Additional structured data about the event (e.g., changed fields).
    pub data: Option<async_graphql::Json<serde_json::Value>>,
    /// The connection ID of the client that originated this event.
    ///
    /// Currently always `None` — per-connection IDs are not yet assigned
    /// on the subscription context. The frontend can filter client-side
    /// once connection IDs are wired through.
    // TODO(RF-008): assign a per-connection ID from subscription context
    pub sender_id: Option<u64>,
}

/// Converts a [`MutationEventKind`] to a [`DocumentEventType`].
///
/// Shared between [`DocumentEvent`] and [`TransactionAppliedEvent`] conversion
/// paths so the mapping is defined in one place.
#[must_use]
pub fn event_type_from_kind(kind: MutationEventKind) -> DocumentEventType {
    match kind {
        MutationEventKind::NodeCreated => DocumentEventType::NodeCreated,
        MutationEventKind::NodeUpdated => DocumentEventType::NodeUpdated,
        MutationEventKind::NodeDeleted => DocumentEventType::NodeDeleted,
        MutationEventKind::PageCreated => DocumentEventType::PageCreated,
        MutationEventKind::PageUpdated => DocumentEventType::PageUpdated,
        MutationEventKind::PageDeleted => DocumentEventType::PageDeleted,
        MutationEventKind::TokenCreated => DocumentEventType::TokenCreated,
        MutationEventKind::TokenUpdated => DocumentEventType::TokenUpdated,
        MutationEventKind::TokenDeleted => DocumentEventType::TokenDeleted,
    }
}

impl DocumentEvent {
    /// Converts a [`MutationEvent`] from the state crate into a GraphQL
    /// [`DocumentEvent`].
    #[must_use]
    pub fn from_mutation_event(event: MutationEvent) -> Self {
        Self {
            event_type: event_type_from_kind(event.kind),
            uuid: event.uuid,
            data: event.data.map(async_graphql::Json),
            sender_id: None,
        }
    }
}

/// GraphQL representation of a single operation in a broadcast transaction.
#[derive(Clone, Debug, SimpleObject)]
pub struct OperationPayloadGql {
    /// Unique operation ID.
    pub id: String,
    /// Target node UUID.
    pub node_uuid: String,
    /// Operation type: `set_field`, `create_node`, `delete_node`, `reparent`, `reorder`.
    #[graphql(name = "type")]
    pub op_type: String,
    /// Field path for `set_field` operations.
    pub path: Option<String>,
    /// New value as JSON.
    pub value: Option<async_graphql::Json<serde_json::Value>>,
}

/// GraphQL representation of a transaction broadcast event.
///
/// Sent to subscription clients when any mutation modifies the document.
/// Contains the full operation payload so clients can apply changes directly
/// without refetching.
#[derive(Clone, Debug, SimpleObject)]
pub struct TransactionAppliedEvent {
    /// Unique transaction ID.
    pub transaction_id: String,
    /// Session ID of the user who originated this transaction.
    pub user_id: String,
    /// Server-assigned sequence number (string because GraphQL Int is i32, seq is u64).
    pub seq: String,
    /// Ordered list of operations.
    pub operations: Vec<OperationPayloadGql>,
    /// Legacy event type for clients that haven't migrated yet.
    pub event_type: DocumentEventType,
    /// Legacy UUID field.
    pub uuid: Option<String>,
}

impl TransactionAppliedEvent {
    /// Converts a state-crate [`TransactionPayload`] into a GraphQL event.
    #[must_use]
    pub fn from_transaction(
        tx: &TransactionPayload,
        kind: DocumentEventType,
        uuid: Option<String>,
    ) -> Self {
        Self {
            transaction_id: tx.transaction_id.clone(),
            user_id: tx.user_id.clone(),
            seq: tx.seq.to_string(),
            operations: tx
                .operations
                .iter()
                .map(|op| OperationPayloadGql {
                    id: op.id.clone(),
                    node_uuid: op.node_uuid.clone(),
                    op_type: op.op_type.clone(),
                    path: if op.path.is_empty() {
                        None
                    } else {
                        Some(op.path.clone())
                    },
                    value: op.value.clone().map(async_graphql::Json),
                })
                .collect(),
            event_type: kind,
            uuid,
        }
    }

    /// Converts a [`MutationEvent`] into a [`TransactionAppliedEvent`].
    ///
    /// When the event carries a transaction payload, uses it directly.
    /// When it doesn't (legacy path), synthesizes a minimal event with
    /// empty operations and seq=0 so the client falls back to refetch.
    #[must_use]
    pub fn from_mutation_event(event: MutationEvent) -> Self {
        let event_type = event_type_from_kind(event.kind);
        if let Some(ref tx) = event.transaction {
            Self::from_transaction(tx, event_type, event.uuid)
        } else {
            // Legacy fallback: no operation payload, client must refetch
            Self {
                transaction_id: String::new(),
                user_id: String::new(),
                seq: "0".to_string(),
                operations: vec![],
                event_type,
                uuid: event.uuid,
            }
        }
    }
}

/// GraphQL representation of document metadata.
#[derive(SimpleObject)]
pub struct DocumentInfoGql {
    pub name: String,
    pub page_count: usize,
    pub node_count: usize,
}

/// GraphQL representation of a serialized node.
#[derive(SimpleObject, serde::Serialize)]
pub struct NodeGql {
    pub uuid: String,
    pub name: String,
    pub kind: async_graphql::Json<serde_json::Value>,
    pub parent: Option<String>,
    pub children: Vec<String>,
    pub transform: async_graphql::Json<serde_json::Value>,
    pub style: async_graphql::Json<serde_json::Value>,
    pub visible: bool,
    pub locked: bool,
}

/// GraphQL representation of a page with its nodes.
#[derive(SimpleObject)]
pub struct PageGql {
    pub id: String,
    pub name: String,
    pub nodes: Vec<NodeGql>,
}

/// Reads a node from the arena and converts it to a [`NodeGql`] representation.
///
/// Requires that the node has already been verified to exist. Returns a
/// sanitized GraphQL error if any lookup or serialization fails.
///
/// RF-012: shared between query.rs and mutation.rs.
///
/// # Errors
///
/// Returns an `async_graphql::Error` if the node cannot be found in the arena
/// or if serialization of the node's kind, transform, or style fails.
pub fn node_to_gql(
    doc: &Document,
    node_id: NodeId,
    node_uuid: uuid::Uuid,
) -> async_graphql::Result<NodeGql> {
    let node = doc
        .arena
        .get(node_id)
        .map_err(|_| async_graphql::Error::new("node lookup failed"))?;

    // Resolve parent UUID
    let parent_uuid = match node.parent {
        Some(pid) => doc.arena.uuid_of(pid).ok().map(|u| u.to_string()),
        None => None,
    };

    // Resolve children UUIDs
    let children_uuids: Vec<String> = node
        .children
        .iter()
        .filter_map(|cid| doc.arena.uuid_of(*cid).ok())
        .map(|u| u.to_string())
        .collect();

    // RF-007: propagate serialization errors instead of swallowing them
    let kind_json = serde_json::to_value(&node.kind)
        .map_err(|e| async_graphql::Error::new(format!("serialization failed: {e}")))?;
    let transform_json = serde_json::to_value(node.transform)
        .map_err(|e| async_graphql::Error::new(format!("serialization failed: {e}")))?;
    let style_json = serde_json::to_value(&node.style)
        .map_err(|e| async_graphql::Error::new(format!("serialization failed: {e}")))?;

    Ok(NodeGql {
        uuid: node_uuid.to_string(),
        name: node.name.clone(),
        kind: async_graphql::Json(kind_json),
        parent: parent_uuid,
        children: children_uuids,
        transform: async_graphql::Json(transform_json),
        style: async_graphql::Json(style_json),
        visible: node.visible,
        locked: node.locked,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_designer_state::OperationPayload;

    #[test]
    fn test_from_transaction_maps_all_fields() {
        let tx = TransactionPayload {
            transaction_id: "tx-abc".to_string(),
            user_id: "user-1".to_string(),
            seq: 42,
            operations: vec![OperationPayload {
                id: "op-1".to_string(),
                node_uuid: "node-xyz".to_string(),
                op_type: "set_field".to_string(),
                path: "transform".to_string(),
                value: Some(serde_json::json!({"x": 100})),
            }],
        };

        let event = TransactionAppliedEvent::from_transaction(
            &tx,
            DocumentEventType::NodeUpdated,
            Some("node-xyz".to_string()),
        );

        assert_eq!(event.transaction_id, "tx-abc");
        assert_eq!(event.user_id, "user-1");
        assert_eq!(event.seq, "42");
        assert_eq!(event.event_type, DocumentEventType::NodeUpdated);
        assert_eq!(event.uuid.as_deref(), Some("node-xyz"));
        assert_eq!(event.operations.len(), 1);

        let op = &event.operations[0];
        assert_eq!(op.id, "op-1");
        assert_eq!(op.node_uuid, "node-xyz");
        assert_eq!(op.op_type, "set_field");
        assert_eq!(op.path.as_deref(), Some("transform"));
        assert!(op.value.is_some());
    }

    #[test]
    fn test_from_transaction_empty_path_becomes_none() {
        let tx = TransactionPayload {
            transaction_id: "tx-def".to_string(),
            user_id: "user-2".to_string(),
            seq: 1,
            operations: vec![OperationPayload {
                id: "op-2".to_string(),
                node_uuid: "node-abc".to_string(),
                op_type: "create_node".to_string(),
                path: String::new(),
                value: Some(serde_json::json!({"kind": "frame"})),
            }],
        };

        let event = TransactionAppliedEvent::from_transaction(
            &tx,
            DocumentEventType::NodeCreated,
            Some("node-abc".to_string()),
        );

        assert!(
            event.operations[0].path.is_none(),
            "empty path should map to None"
        );
    }

    #[test]
    fn test_from_mutation_event_with_transaction_uses_payload() {
        let mutation = MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some("node-123".to_string()),
            data: None,
            transaction: Some(TransactionPayload {
                transaction_id: "tx-ghi".to_string(),
                user_id: "user-3".to_string(),
                seq: 7,
                operations: vec![OperationPayload {
                    id: "op-3".to_string(),
                    node_uuid: "node-123".to_string(),
                    op_type: "set_field".to_string(),
                    path: "name".to_string(),
                    value: Some(serde_json::json!("New Name")),
                }],
            }),
        };

        let event = TransactionAppliedEvent::from_mutation_event(mutation);

        assert_eq!(event.transaction_id, "tx-ghi");
        assert_eq!(event.seq, "7");
        assert_eq!(event.operations.len(), 1);
        assert_eq!(event.event_type, DocumentEventType::NodeUpdated);
    }

    #[test]
    fn test_from_mutation_event_without_transaction_falls_back() {
        let mutation = MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: None,
            data: Some(serde_json::json!({"field": "transform"})),
            transaction: None,
        };

        let event = TransactionAppliedEvent::from_mutation_event(mutation);

        assert!(
            event.transaction_id.is_empty(),
            "legacy fallback should have empty transaction_id"
        );
        assert_eq!(event.seq, "0", "legacy fallback should have seq 0");
        assert!(
            event.operations.is_empty(),
            "legacy fallback should have no operations"
        );
        assert_eq!(event.event_type, DocumentEventType::NodeUpdated);
        assert!(event.uuid.is_none());
    }

    #[test]
    fn test_event_type_from_kind_maps_all_variants() {
        let cases = [
            (
                MutationEventKind::NodeCreated,
                DocumentEventType::NodeCreated,
            ),
            (
                MutationEventKind::NodeUpdated,
                DocumentEventType::NodeUpdated,
            ),
            (
                MutationEventKind::NodeDeleted,
                DocumentEventType::NodeDeleted,
            ),
            (
                MutationEventKind::PageCreated,
                DocumentEventType::PageCreated,
            ),
            (
                MutationEventKind::PageUpdated,
                DocumentEventType::PageUpdated,
            ),
            (
                MutationEventKind::PageDeleted,
                DocumentEventType::PageDeleted,
            ),
            (
                MutationEventKind::TokenCreated,
                DocumentEventType::TokenCreated,
            ),
            (
                MutationEventKind::TokenUpdated,
                DocumentEventType::TokenUpdated,
            ),
            (
                MutationEventKind::TokenDeleted,
                DocumentEventType::TokenDeleted,
            ),
        ];

        for (kind, expected) in cases {
            assert_eq!(
                event_type_from_kind(kind),
                expected,
                "mismatch for {kind:?}"
            );
        }
    }
}
