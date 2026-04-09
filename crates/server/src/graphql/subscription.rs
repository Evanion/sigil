use async_graphql::{Context, Result, Subscription};
use futures_util::Stream;

use crate::state::ServerState;

use super::types::{DocumentEvent, TransactionAppliedEvent};

pub struct SubscriptionRoot;

#[Subscription]
#[allow(clippy::unused_async)]
impl SubscriptionRoot {
    // TODO(Phase 15d): remove legacy document_changed subscription
    /// Stream of document change events (legacy).
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
    ///
    /// **Deprecated:** Prefer `transaction_applied` for new clients. This
    /// subscription is retained for backwards compatibility during the transition
    /// period (Phase 15d will remove it).
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

    /// Stream of typed transaction events.
    ///
    /// Yields a [`TransactionAppliedEvent`] for every mutation that carries
    /// operation payloads. Clients use this to apply changes directly to their
    /// local store without refetching.
    ///
    /// Events without a transaction payload (legacy mutations not yet migrated)
    /// are converted to a synthetic single-operation transaction so the client
    /// always receives a consistent format (empty operations list, seq=0).
    async fn transaction_applied(
        &self,
        ctx: &Context<'_>,
    ) -> Result<impl Stream<Item = TransactionAppliedEvent>> {
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
                        yield TransactionAppliedEvent::from_mutation_event(mutation_event);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("transaction subscription client lagged by {n} messages");
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
    use agent_designer_state::{OperationPayload, TransactionPayload};

    #[tokio::test]
    async fn test_broadcast_delivers_to_subscriber() {
        let state = ServerState::new();
        let event_tx = state.app.event_tx().expect("event_tx configured");
        let mut rx = event_tx.subscribe();

        let _ = event_tx.send(MutationEvent {
            kind: MutationEventKind::NodeCreated,
            uuid: Some("abc-123".to_string()),
            data: None,
            transaction: None,
        });

        let received = rx.recv().await.expect("should receive event");
        let doc_event = DocumentEvent::from_mutation_event(received);
        assert_eq!(doc_event.event_type, DocumentEventType::NodeCreated);
        assert_eq!(doc_event.uuid.as_deref(), Some("abc-123"));
        assert!(doc_event.data.is_none());
        assert!(doc_event.sender_id.is_none());
    }

    #[tokio::test]
    async fn test_broadcast_without_listeners_does_not_panic() {
        let state = ServerState::new();
        let event_tx = state.app.event_tx().expect("event_tx configured");
        // No subscribers -- send should not panic.
        let _ = event_tx.send(MutationEvent {
            kind: MutationEventKind::NodeDeleted,
            uuid: Some("def-456".to_string()),
            data: None,
            transaction: None,
        });
    }

    #[tokio::test]
    async fn test_multiple_subscribers_each_receive_event() {
        let state = ServerState::new();
        let event_tx = state.app.event_tx().expect("event_tx configured");
        let mut rx1 = event_tx.subscribe();
        let mut rx2 = event_tx.subscribe();

        let _ = event_tx.send(MutationEvent {
            kind: MutationEventKind::NodeUpdated,
            uuid: Some("ghi-789".to_string()),
            data: Some(serde_json::json!({"field": "transform"})),
            transaction: None,
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
            MutationEventKind::NodeDeleted,
            MutationEventKind::NodeCreated,
        ];

        let expected_types = [
            DocumentEventType::NodeCreated,
            DocumentEventType::NodeUpdated,
            DocumentEventType::NodeDeleted,
            DocumentEventType::NodeDeleted,
            DocumentEventType::NodeCreated,
        ];

        for kind in &event_kinds {
            let _ = event_tx.send(MutationEvent {
                kind: *kind,
                uuid: None,
                data: None,
                transaction: None,
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
            event_type: DocumentEventType::NodeDeleted,
            uuid: None,
            data: Some(async_graphql::Json(serde_json::json!({"field": "test"}))),
            sender_id: None,
        };

        let cloned = event.clone();
        assert_eq!(cloned.event_type, DocumentEventType::NodeDeleted);
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
                transaction: None,
            };
            let doc_event = DocumentEvent::from_mutation_event(mutation_event);
            assert_eq!(doc_event.event_type, expected_type, "mismatch for {kind:?}");
        }
    }

    // --- Task 3 tests: transaction_applied subscription ---

    #[tokio::test]
    async fn test_transaction_applied_yields_full_payload() {
        let state = ServerState::new();
        let event_tx = state.app.event_tx().expect("event_tx configured");
        let mut rx = event_tx.subscribe();

        state.app.publish_transaction(
            MutationEventKind::NodeUpdated,
            Some("node-abc".to_string()),
            TransactionPayload {
                transaction_id: "tx-sub-1".to_string(),
                user_id: "user-sub-1".to_string(),
                seq: 0,
                operations: vec![OperationPayload {
                    id: "op-sub-1".to_string(),
                    node_uuid: "node-abc".to_string(),
                    op_type: "set_field".to_string(),
                    path: "transform".to_string(),
                    value: Some(serde_json::json!({"x": 42})),
                }],
            },
        );

        let received = rx.recv().await.expect("should receive event");
        let event = TransactionAppliedEvent::from_mutation_event(received);

        assert_eq!(event.transaction_id, "tx-sub-1");
        assert_eq!(event.user_id, "user-sub-1");
        assert_ne!(
            event.seq, "0",
            "seq should be assigned by publish_transaction"
        );
        assert_eq!(event.event_type, DocumentEventType::NodeUpdated);
        assert_eq!(event.uuid.as_deref(), Some("node-abc"));
        assert_eq!(event.operations.len(), 1);
        assert_eq!(event.operations[0].op_type, "set_field");
        assert_eq!(event.operations[0].path.as_deref(), Some("transform"));
    }

    #[tokio::test]
    async fn test_transaction_applied_legacy_fallback() {
        let state = ServerState::new();
        let event_tx = state.app.event_tx().expect("event_tx configured");
        let mut rx = event_tx.subscribe();

        // Send a legacy event without a transaction payload directly on the channel
        let _ = event_tx.send(MutationEvent {
            kind: MutationEventKind::NodeDeleted,
            uuid: None,
            data: Some(serde_json::json!({"field": "test"})),
            transaction: None,
        });

        let received = rx.recv().await.expect("should receive event");
        let event = TransactionAppliedEvent::from_mutation_event(received);

        assert!(
            event.transaction_id.is_empty(),
            "legacy fallback should have empty transaction_id"
        );
        assert_eq!(event.seq, "0", "legacy fallback should have seq 0");
        assert!(
            event.operations.is_empty(),
            "legacy fallback should have no operations"
        );
        assert_eq!(event.event_type, DocumentEventType::NodeDeleted);
    }

    #[tokio::test]
    async fn test_transaction_applied_preserves_order() {
        let state = ServerState::new();
        let event_tx = state.app.event_tx().expect("event_tx configured");
        let mut rx = event_tx.subscribe();

        // Publish three transactions
        for i in 1..=3 {
            state.app.publish_transaction(
                MutationEventKind::NodeUpdated,
                Some(format!("node-{i}")),
                TransactionPayload {
                    transaction_id: format!("tx-order-{i}"),
                    user_id: "user-order".to_string(),
                    seq: 0,
                    operations: vec![],
                },
            );
        }

        let mut seq_values = Vec::new();
        for _ in 0..3 {
            let received = rx.recv().await.expect("should receive event");
            let event = TransactionAppliedEvent::from_mutation_event(received);
            let seq: u64 = event.seq.parse().expect("seq should be a number");
            seq_values.push(seq);
        }

        // Verify monotonically increasing
        for window in seq_values.windows(2) {
            assert!(
                window[1] > window[0],
                "seq values should be monotonically increasing: {seq_values:?}"
            );
        }
    }

    #[tokio::test]
    async fn test_document_changed_still_works_alongside_transaction_applied() {
        let state = ServerState::new();
        let event_tx = state.app.event_tx().expect("event_tx configured");
        let mut rx = event_tx.subscribe();

        // Publish an event with a transaction payload
        state.app.publish_transaction(
            MutationEventKind::NodeCreated,
            Some("node-compat".to_string()),
            TransactionPayload {
                transaction_id: "tx-compat".to_string(),
                user_id: "user-compat".to_string(),
                seq: 0,
                operations: vec![OperationPayload {
                    id: "op-compat".to_string(),
                    node_uuid: "node-compat".to_string(),
                    op_type: "create_node".to_string(),
                    path: String::new(),
                    value: Some(serde_json::json!({"kind": "frame"})),
                }],
            },
        );

        let received = rx.recv().await.expect("should receive event");

        // The old subscription path still works
        let doc_event = DocumentEvent::from_mutation_event(received.clone());
        assert_eq!(doc_event.event_type, DocumentEventType::NodeCreated);
        assert_eq!(doc_event.uuid.as_deref(), Some("node-compat"));

        // The new subscription path also works
        let tx_event = TransactionAppliedEvent::from_mutation_event(received);
        assert_eq!(tx_event.event_type, DocumentEventType::NodeCreated);
        assert_eq!(tx_event.transaction_id, "tx-compat");
        assert_eq!(tx_event.operations.len(), 1);
    }
}
