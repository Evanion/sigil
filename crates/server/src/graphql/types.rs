use async_graphql::SimpleObject;

/// A real-time event emitted when the document changes.
///
/// Sent to GraphQL subscription clients via the `documentChanged` stream.
/// The `event_type` field discriminates the kind of change, while `uuid` and
/// `data` carry optional context about the affected node.
#[derive(Clone, Debug, SimpleObject)]
pub struct DocumentEvent {
    /// Discriminator: `"node_created"`, `"node_updated"`, `"node_deleted"`, `"undo_redo"`.
    pub event_type: String,
    /// UUID of the affected node, if applicable.
    pub uuid: Option<String>,
    /// Additional structured data about the event (e.g., changed fields).
    pub data: Option<async_graphql::Json<serde_json::Value>>,
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
