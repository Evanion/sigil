use async_graphql::{Context, Result, Subscription};
use futures_util::Stream;
use sigil_state::sessions::SessionEvent;

use crate::session_header::RequestSession;
use crate::state::{ServerState, SessionId};

use super::types::{DocumentEvent, TransactionAppliedEvent};

pub struct SubscriptionRoot;

/// Resolve the session for a subscription stream.
///
/// HTTP subscriptions (rare; subscriptions typically arrive over WebSocket)
/// will see `RequestSession` populated by the
/// [`crate::session_header::middleware`]. WebSocket subscriptions land
/// without a `RequestSession` in the async-graphql context — Task 7 wires
/// `session_id` into the WS `connection_init` params. Until that lands, WS
/// subscriptions fall back to the registry's default session id.
fn resolve_subscription_session(ctx: &Context<'_>, state: &ServerState) -> Result<SessionId> {
    let header_session = ctx.data::<RequestSession>().map(|rs| rs.0).unwrap_or(None);
    if let Some(id) = header_session {
        return Ok(id);
    }
    state.app.default_session_id().ok_or_else(|| {
        async_graphql::Error::new(
            "SESSION_REQUIRED: provide X-Sigil-Session header or open a workfile session",
        )
    })
}

#[Subscription]
#[allow(clippy::unused_async)]
impl SubscriptionRoot {
    // TODO(Phase 15d): remove legacy document_changed subscription
    /// Stream of document change events (legacy).
    ///
    /// Yields a [`DocumentEvent`] every time a mutation modifies the document.
    /// Spec 20: subscribes to the per-session broadcast channel
    /// ([`sigil_state::sessions::DocumentSession::broadcast`]) rather than
    /// the legacy app-wide channel. Events from other sessions are never
    /// delivered to this subscriber.
    ///
    /// Clients that fall behind (lagged receivers) log a warning and continue
    /// receiving from the latest message rather than disconnecting.
    ///
    /// `SessionEvent::SessionFatal` events are dropped here — they signal an
    /// errored session and need a richer GraphQL type (added in a later task).
    ///
    /// **Deprecated:** Prefer `transaction_applied` for new clients. This
    /// subscription is retained for backwards compatibility during the transition
    /// period (Phase 15d will remove it).
    async fn document_changed(
        &self,
        ctx: &Context<'_>,
    ) -> Result<impl Stream<Item = DocumentEvent>> {
        let state = ctx.data::<ServerState>()?;
        let session_id = resolve_subscription_session(ctx, state)?;
        let session =
            state.app.sessions.get(session_id).ok_or_else(|| {
                async_graphql::Error::new(format!("SESSION_NOT_FOUND: {session_id}"))
            })?;
        let mut rx = session.broadcast.subscribe();
        Ok(async_stream::stream! {
            loop {
                match rx.recv().await {
                    Ok(SessionEvent::DocumentEvent(mutation_event)) => {
                        yield DocumentEvent::from_mutation_event(mutation_event);
                    }
                    Ok(SessionEvent::SessionFatal { reason }) => {
                        // Surface only to logs for now. A dedicated GraphQL
                        // event type lands with Task 6 (session operations).
                        tracing::warn!(session = %session_id, reason = %reason, "session marked errored");
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
    /// Spec 20: scoped to the requesting session's broadcast channel.
    ///
    /// Events without a transaction payload (legacy mutations not yet migrated)
    /// are converted to a synthetic single-operation transaction so the client
    /// always receives a consistent format (empty operations list, seq=0).
    async fn transaction_applied(
        &self,
        ctx: &Context<'_>,
    ) -> Result<impl Stream<Item = TransactionAppliedEvent>> {
        let state = ctx.data::<ServerState>()?;
        let session_id = resolve_subscription_session(ctx, state)?;
        let session =
            state.app.sessions.get(session_id).ok_or_else(|| {
                async_graphql::Error::new(format!("SESSION_NOT_FOUND: {session_id}"))
            })?;
        let mut rx = session.broadcast.subscribe();
        Ok(async_stream::stream! {
            loop {
                match rx.recv().await {
                    Ok(SessionEvent::DocumentEvent(mutation_event)) => {
                        yield TransactionAppliedEvent::from_mutation_event(mutation_event);
                    }
                    Ok(SessionEvent::SessionFatal { reason }) => {
                        tracing::warn!(session = %session_id, reason = %reason, "session marked errored");
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
    use sigil_state::{OperationPayload, TransactionPayload};

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
        use sigil_state::MutationEventKind;

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

    // ── Per-session subscription tests (Spec 20, Task 5) ───────────────

    /// Spec 20: `SessionEvent::DocumentEvent` published on a session's
    /// broadcast channel is what subscribers consume — confirms the
    /// migration off the legacy `event_tx` channel.
    #[tokio::test]
    async fn test_session_channel_delivers_document_event() {
        let state = ServerState::new();
        let id = state.app.default_session_id().expect("default");
        let session = state.app.sessions.get(id).expect("session");
        let mut rx = session.broadcast.subscribe();

        let _ = session
            .broadcast
            .send(SessionEvent::DocumentEvent(MutationEvent {
                kind: MutationEventKind::NodeCreated,
                uuid: Some("abc-123".to_string()),
                data: None,
                transaction: None,
            }));

        let event = rx.try_recv().expect("event delivered");
        match event {
            SessionEvent::DocumentEvent(me) => {
                let doc_event = DocumentEvent::from_mutation_event(me);
                assert_eq!(doc_event.event_type, DocumentEventType::NodeCreated);
                assert_eq!(doc_event.uuid.as_deref(), Some("abc-123"));
            }
            SessionEvent::SessionFatal { reason } => {
                panic!("expected DocumentEvent, got SessionFatal: {reason}");
            }
        }
    }

    /// Spec 20: two open sessions have independent broadcast channels —
    /// events published on one are NOT delivered to subscribers of the other.
    #[tokio::test]
    async fn test_sessions_have_independent_broadcast_channels() {
        let state = ServerState::new();
        let a = state.app.default_session_id().expect("default");
        let b = state
            .app
            .sessions
            .register_in_memory(sigil_core::Document::new("B".to_string()));

        let session_a = state.app.sessions.get(a).expect("a");
        let session_b = state.app.sessions.get(b).expect("b");
        let mut rx_a = session_a.broadcast.subscribe();
        let mut rx_b = session_b.broadcast.subscribe();

        // Publish only on A.
        let _ = session_a
            .broadcast
            .send(SessionEvent::DocumentEvent(MutationEvent {
                kind: MutationEventKind::NodeUpdated,
                uuid: Some("only-a".to_string()),
                data: None,
                transaction: None,
            }));

        // A receives it.
        let recv_a = rx_a.try_recv().expect("A receives its own event");
        match recv_a {
            SessionEvent::DocumentEvent(me) => {
                assert_eq!(me.uuid.as_deref(), Some("only-a"));
            }
            SessionEvent::SessionFatal { reason } => {
                panic!("unexpected SessionFatal: {reason}");
            }
        }

        // B does NOT receive it (different channel).
        assert!(
            rx_b.try_recv().is_err(),
            "session B must not receive session A's events"
        );
    }
}
