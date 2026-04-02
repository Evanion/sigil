use async_graphql::{Context, Subscription};
use futures_util::Stream;

use crate::state::AppState;

use super::types::DocumentEvent;

pub struct SubscriptionRoot;

#[Subscription]
impl SubscriptionRoot {
    /// Stream of document change events.
    ///
    /// Yields a [`DocumentEvent`] every time a mutation modifies the document.
    /// Clients that fall behind (lagged receivers) log a warning and continue
    /// receiving from the latest message rather than disconnecting.
    async fn document_changed(&self, ctx: &Context<'_>) -> impl Stream<Item = DocumentEvent> {
        let state = ctx.data_unchecked::<AppState>();
        let mut rx = state.graphql_tx.subscribe();
        async_stream::stream! {
            loop {
                match rx.recv().await {
                    Ok(event) => yield event,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("GraphQL subscription client lagged by {n} messages");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graphql::mutation::publish_event;
    use crate::graphql::types::DocumentEventType;

    #[tokio::test]
    async fn test_publish_event_delivers_to_subscriber() {
        let state = AppState::new();
        let mut rx = state.graphql_tx.subscribe();

        let event = DocumentEvent {
            event_type: DocumentEventType::NodeCreated,
            uuid: Some("abc-123".to_string()),
            data: None,
            sender_id: None,
        };

        publish_event(&state, event);

        let received = rx.recv().await.expect("should receive event");
        assert_eq!(received.event_type, DocumentEventType::NodeCreated);
        assert_eq!(received.uuid.as_deref(), Some("abc-123"));
        assert!(received.data.is_none());
    }

    #[tokio::test]
    async fn test_publish_event_without_listeners_does_not_panic() {
        let state = AppState::new();
        // No subscribers — publish_event should not panic.
        let event = DocumentEvent {
            event_type: DocumentEventType::NodeDeleted,
            uuid: Some("def-456".to_string()),
            data: None,
            sender_id: None,
        };
        publish_event(&state, event);
    }

    #[tokio::test]
    async fn test_multiple_subscribers_each_receive_event() {
        let state = AppState::new();
        let mut rx1 = state.graphql_tx.subscribe();
        let mut rx2 = state.graphql_tx.subscribe();

        let event = DocumentEvent {
            event_type: DocumentEventType::NodeUpdated,
            uuid: Some("ghi-789".to_string()),
            data: Some(async_graphql::Json(
                serde_json::json!({"field": "transform"}),
            )),
            sender_id: None,
        };

        publish_event(&state, event);

        let r1 = rx1.recv().await.expect("subscriber 1 should receive");
        let r2 = rx2.recv().await.expect("subscriber 2 should receive");
        assert_eq!(r1.event_type, DocumentEventType::NodeUpdated);
        assert_eq!(r2.event_type, DocumentEventType::NodeUpdated);
        assert_eq!(r1.uuid, r2.uuid);
    }

    #[tokio::test]
    async fn test_graphql_broadcast_capacity_matches_constant() {
        use crate::state::GRAPHQL_BROADCAST_CAPACITY;
        // Verify the constant is set to the expected value.
        assert_eq!(GRAPHQL_BROADCAST_CAPACITY, 256);
    }

    #[tokio::test]
    async fn test_subscriber_receives_events_in_order() {
        let state = AppState::new();
        let mut rx = state.graphql_tx.subscribe();

        let event_types = [
            DocumentEventType::NodeCreated,
            DocumentEventType::NodeUpdated,
            DocumentEventType::NodeDeleted,
            DocumentEventType::UndoRedo,
            DocumentEventType::NodeCreated,
        ];

        for event_type in &event_types {
            publish_event(
                &state,
                DocumentEvent {
                    event_type: *event_type,
                    uuid: None,
                    data: None,
                    sender_id: None,
                },
            );
        }

        for event_type in &event_types {
            let received = rx.recv().await.expect("should receive event");
            assert_eq!(received.event_type, *event_type);
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
            sender_id: Some(42),
        };

        let cloned = event.clone();
        assert_eq!(cloned.event_type, DocumentEventType::UndoRedo);
        assert!(cloned.uuid.is_none());
        assert!(cloned.data.is_some());
        assert_eq!(cloned.sender_id, Some(42));
    }
}
