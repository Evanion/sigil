use async_graphql::Object;

use crate::state::AppState;

use super::types::DocumentEvent;

pub struct MutationRoot;

#[Object]
impl MutationRoot {
    /// Placeholder — mutations added in Task 2.
    async fn version(&self) -> &str {
        "0.1.0"
    }
}

/// Publishes a [`DocumentEvent`] to the GraphQL subscription broadcast channel.
///
/// If no subscription clients are listening the send will fail silently — this
/// is expected and logged at `debug` level.
pub fn publish_event(state: &AppState, event: DocumentEvent) {
    if state.graphql_tx.send(event).is_err() {
        tracing::debug!("no GraphQL subscription listeners");
    }
}
