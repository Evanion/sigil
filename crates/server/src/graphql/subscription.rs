use async_graphql::{Context, Result, Subscription};
use futures_util::Stream;

use crate::state::ServerState;

use super::types::DocumentEvent;

pub struct SubscriptionRoot;

#[Subscription]
#[allow(clippy::unused_async)]
impl SubscriptionRoot {
    /// Stream of document change events.
    ///
    /// Yields a [`DocumentEvent`] every time a mutation modifies the document.
    /// Subscribes to the [`MutationEvent`](agent_designer_state::MutationEvent)
    /// broadcast channel on `AppState` and converts each event to a GraphQL
    /// `DocumentEvent`. This means events published by MCP tools also appear
    /// in the subscription stream.
    ///
    /// Clients that fall behind (lagged receivers) log a warning and continue
    /// receiving from the latest message rather than disconnecting.
    ///
    /// RF-011: The `GraphQLSubscription` service from async-graphql-axum does
    /// not expose message size configuration easily. If RF-002's fix switches
    /// to `GraphQLWebSocket` directly, message size can be configured there.
    // TODO(RF-011): configure max WS message size when switching to GraphQLWebSocket
    async fn document_changed(
        &self,
        ctx: &Context<'_>,
    ) -> Result<impl Stream<Item = DocumentEvent>> {
        // RF-013: use fallible `data()` instead of `data_unchecked()`
        let state = ctx.data::<ServerState>()?;
        let event_tx = state
            .app
            .event_tx()
            .ok_or_else(|| async_graphql::Error::new("event broadcast channel not configured"))?;
        let mut rx = event_tx.subscribe();
        Ok(async_stream::stream! {
            loop {
                match rx.recv().await {
                    Ok(mutation_event) => {
                        yield DocumentEvent::from_mutation_event(mutation_event);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("GraphQL subscription client lagged by {n} messages");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graphql::types::DocumentEventType;
    use crate::state::{MutationEvent, MutationEventKind};

    #[tokio::test]
    async fn test_publish_event_delivers_to_subscriber() {
        let state = ServerState::new();
        let event_tx = state.app.event_tx().expect("event_tx configured");
        let mut rx = event_tx.subscribe();

        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeCreated,
            uuid: Some("abc-123".to_string()),
            data: None,
        });

        let received = rx.recv().await.expect("should receive event");
        let doc_event = DocumentEvent::from_mutation_event(received);
        assert_eq!(doc_event.event_type, DocumentEventType::NodeCreated);
        assert_eq!(doc_event.uuid.as_deref(), Some("abc-123"));
        assert!(doc_event.data.is_none());
        assert!(doc_event.sender_id.is_none());
    }

    #[tokio::test]
    async fn test_publish_event_without_listeners_does_not_panic() {
        let state = ServerState::new();
        // No subscribers -- publish_event should not panic.
        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeDeleted,
            uuid: Some("def-456".to_string()),
            data: None,
        });
    }

    #[tokio::test]
    async fn test_multiple_subscribers_each_receive_event() {
        let state = ServerState::new();
        let event_tx = state.app.event_tx().expect("event_tx configured");
        let mut rx1 = event_tx.subscribe();
        let mut rx2 = event_tx.subscribe();

        state.app.publish_event(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some("ghi-789".to_string()),
            data: Some(serde_json::json!({"field": "transform"})),
        });

        let r1 = DocumentEvent::from_mutation_event(
            rx1.recv().await.expect("subscriber 1 should receive"),
        );
        let r2 = DocumentEvent::from_mutation_event(
            rx2.recv().await.expect("subscriber 2 should receive"),
        );
        assert_eq!(r1.event_type, DocumentEventType::NodeUpdated);
        assert_eq!(r2.event_type, DocumentEventType::NodeUpdated);
        assert_eq!(r1.uuid, r2.uuid);
    }

    #[tokio::test]
    async fn test_broadcast_capacity_matches_constant() {
        use crate::state::MUTATION_BROADCAST_CAPACITY;
        // Verify the constant is set to the expected value.
        assert_eq!(MUTATION_BROADCAST_CAPACITY, 256);
    }

    #[tokio::test]
    async fn test_subscriber_receives_events_in_order() {
        let state = ServerState::new();
        let event_tx = state.app.event_tx().expect("event_tx configured");
        let mut rx = event_tx.subscribe();

        let event_kinds = [
            MutationEventKind::NodeCreated,
            MutationEventKind::NodeUpdated,
            MutationEventKind::NodeDeleted,
            MutationEventKind::UndoRedo,
            MutationEventKind::NodeCreated,
        ];

        let expected_types = [
            DocumentEventType::NodeCreated,
            DocumentEventType::NodeUpdated,
            DocumentEventType::NodeDeleted,
            DocumentEventType::UndoRedo,
            DocumentEventType::NodeCreated,
        ];

        for kind in &event_kinds {
            state.app.publish_event(MutationEvent {
                kind: *kind,
                uuid: None,
                data: None,
            });
        }

        for et in &expected_types {
            let received =
                DocumentEvent::from_mutation_event(rx.recv().await.expect("should receive event"));
            assert_eq!(received.event_type, *et);
        }
    }

    #[tokio::test]
    async fn test_document_event_clone_preserves_fields() {
        let event = DocumentEvent {
            event_type: DocumentEventType::UndoRedo,
            uuid: None,
            data: Some(async_graphql::Json(
                serde_json::json!({"can_undo": true, "can_redo": false}),
            )),
            sender_id: None,
        };

        let cloned = event.clone();
        assert_eq!(cloned.event_type, DocumentEventType::UndoRedo);
        assert!(cloned.uuid.is_none());
        assert!(cloned.data.is_some());
        assert!(cloned.sender_id.is_none());
    }

    #[tokio::test]
    async fn test_from_mutation_event_converts_all_kinds() {
        use agent_designer_state::MutationEventKind;

        let test_cases = [
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
            (MutationEventKind::UndoRedo, DocumentEventType::UndoRedo),
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

        for (kind, expected_type) in test_cases {
            let mutation_event = MutationEvent {
                kind,
                uuid: Some("test-uuid".to_string()),
                data: None,
            };
            let doc_event = DocumentEvent::from_mutation_event(mutation_event);
            assert_eq!(doc_event.event_type, expected_type, "mismatch for {kind:?}");
        }
    }
}
