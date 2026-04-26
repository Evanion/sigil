//! Integration test verifying that the GraphQL `applyOperations` resolver
//! emits a canonical (post-apply) `NodeKind` JSON in the broadcast payload
//! when called with the `path = "kind"` shorthand corners input.
//!
//! Background (RF-001 / RF-004):
//!
//! The frontend `applyRemoteOperation` dispatcher (in
//! `frontend/src/operations/apply-remote.ts`, case `"kind"`) requires the
//! canonical 4-element `corners` array form. If the GraphQL broadcast
//! forwards the raw shorthand (`{shape:"round", radius:N}`), the dispatcher
//! silently rejects it via its 4-element-array guard. Connected clients
//! never see the change.
//!
//! Per `.claude/rules/rust-defensive.md` "Side-Effect Artifacts Must Be
//! Constructed After Precondition Verification": the broadcast payload for
//! the `"kind"` path MUST be built from the verified post-apply
//! `node.kind` — mirroring `set_corners_impl` in `crates/mcp/src/tools/nodes.rs`.
//!
//! See also: `crates/mcp/tests/integration_set_corners.rs` for the MCP-side
//! contract that this test parallels.

use agent_designer_core::commands::node_commands::CreateNode;
use agent_designer_core::commands::page_commands::CreatePage;
use agent_designer_core::id::PageId;
use agent_designer_core::node::NodeKind;
use agent_designer_core::{Document, FieldOperation};
use agent_designer_server::graphql::mutation::MutationRoot;
use agent_designer_server::graphql::query::QueryRoot;
use agent_designer_server::state::ServerState;
use agent_designer_state::{MUTATION_BROADCAST_CAPACITY, MutationEventKind};
use async_graphql::{EmptySubscription, Schema};
use tokio::sync::broadcast;

/// Builds a `ServerState` whose broadcast channel we control, plus a
/// receiver to assert against. Returns `(state, rx, page_uuid, rect_uuid)`.
fn make_state_with_rect() -> (
    ServerState,
    broadcast::Receiver<agent_designer_state::MutationEvent>,
    String,
) {
    // Create a state and wire up a fresh broadcast channel that we own a
    // receiver for. ServerState::new() also installs a tx, but we replace it
    // here so the test owns the rx end.
    let mut state = ServerState::new();
    let (tx, rx) = broadcast::channel(MUTATION_BROADCAST_CAPACITY);
    state.app.set_event_tx(tx);

    // Seed: one page + one rectangle, applied directly through the core
    // engine so the test does not depend on GraphQL CreateNode / CreatePage
    // shape (which requires escaping the kind JSON).
    let page_id = PageId::new(uuid::Uuid::new_v4());
    let rect_uuid = uuid::Uuid::new_v4();
    {
        let mut guard = state.app.document.lock().expect("document lock");
        let doc: &mut Document = &mut guard.0;

        let create_page = CreatePage {
            page_id,
            name: "Page 1".to_string(),
        };
        create_page.validate(doc).expect("create_page validate");
        create_page.apply(doc).expect("create_page apply");

        let create_rect = CreateNode {
            uuid: rect_uuid,
            kind: NodeKind::Rectangle {
                corners: agent_designer_core::node::default_corners(),
            },
            name: "Rect".to_string(),
            page_id: None, // defaults to current page
            initial_transform: None,
        };
        create_rect.validate(doc).expect("create_node validate");
        create_rect.apply(doc).expect("create_node apply");
    }

    (state, rx, rect_uuid.to_string())
}

fn test_schema(state: ServerState) -> Schema<QueryRoot, MutationRoot, EmptySubscription> {
    Schema::build(QueryRoot, MutationRoot, EmptySubscription)
        .data(state)
        .finish()
}

/// RF-001 / RF-004: when GraphQL `applyOperations` receives a `setField`
/// op with `path = "kind"` and a shorthand corners value, the broadcast
/// payload's `value` must be the canonical post-apply `NodeKind` JSON
/// (4-element corners array), NOT the raw shorthand.
#[tokio::test]
async fn test_apply_operations_set_field_kind_broadcasts_canonical_corners() {
    let (state, mut rx, rect_uuid) = make_state_with_rect();
    let schema = test_schema(state);

    // Shorthand input: { "type": "rectangle", "corners": { "shape": "round", "radius": 12 } }
    // The GraphQL `value` field is itself a JSON string, so we serialise the
    // outer JSON to a string and then escape its quotes for embedding inside
    // the GraphQL string literal.
    let kind_value = serde_json::json!({
        "type": "rectangle",
        "corners": { "shape": "round", "radius": 12.0 }
    });
    let kind_value_str = kind_value.to_string();
    let kind_value_escaped = kind_value_str.replace('"', "\\\"");

    let query = format!(
        r#"mutation {{
            applyOperations(
                operations: [
                    {{ setField: {{ nodeUuid: "{rect_uuid}", path: "kind", value: "{kind_value_escaped}" }} }}
                ],
                userId: "test-user"
            ) {{
                seq
            }}
        }}"#
    );

    let res = schema.execute(&query).await;
    assert!(
        res.errors.is_empty(),
        "applyOperations errors: {:?}",
        res.errors
    );

    let event = rx.try_recv().expect("should receive a broadcast event");
    assert_eq!(
        event.kind,
        MutationEventKind::NodeUpdated,
        "event kind must be NodeUpdated"
    );

    let tx_payload = event
        .transaction
        .as_ref()
        .expect("event must carry a transaction payload");

    assert_eq!(
        tx_payload.operations.len(),
        1,
        "transaction must contain exactly one operation"
    );

    let op = &tx_payload.operations[0];
    assert_eq!(op.op_type, "set_field", "op_type must be 'set_field'");
    assert_eq!(op.path, "kind", "path must be 'kind'");

    let value = op.value.as_ref().expect("operation must have a value");

    // Canonical post-apply shape — this is what apply-remote.ts case "kind" expects.
    assert_eq!(
        value["type"], "rectangle",
        "kind discriminator must be 'rectangle'"
    );

    let corners = value["corners"]
        .as_array()
        .expect("corners must be a JSON array (canonical 4-element form), not shorthand");
    assert_eq!(
        corners.len(),
        4,
        "corners array must have exactly 4 elements (canonical form)"
    );

    for (i, corner) in corners.iter().enumerate() {
        assert_eq!(corner["type"], "round", "corner {i} type must be 'round'");
        assert_eq!(
            corner["radii"]["x"], 12.0,
            "corner {i} radii.x must be 12.0"
        );
        assert_eq!(
            corner["radii"]["y"], 12.0,
            "corner {i} radii.y must be 12.0"
        );
    }
}
