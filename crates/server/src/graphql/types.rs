use async_graphql::SimpleObject;

use agent_designer_core::{Document, NodeId};

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
    /// An undo or redo operation was performed.
    UndoRedo,
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

/// GraphQL representation of document metadata.
#[derive(SimpleObject)]
pub struct DocumentInfoGql {
    pub name: String,
    pub page_count: usize,
    pub node_count: usize,
    pub can_undo: bool,
    pub can_redo: bool,
}

/// GraphQL representation of a serialized node.
#[derive(SimpleObject)]
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

/// Result of an undo/redo operation.
#[derive(SimpleObject)]
pub struct UndoRedoResult {
    pub can_undo: bool,
    pub can_redo: bool,
}

/// Result of node creation.
#[derive(SimpleObject)]
pub struct CreateNodeResult {
    pub uuid: String,
    pub node: NodeGql,
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
