//! Cross-language parity test for the delete_nodes wire format (Spec 19).
//!
//! The TypeScript counterpart at `frontend/src/__tests__/parity-delete-nodes.test.ts`
//! reads the same fixture file and asserts the frontend side matches. Both sides
//! must agree on `op_type`, `value` shape, and the GraphQL/MCP input encoding.

use serde_json::Value;

fn load_fixture() -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/parity/delete-nodes-encoding.json");
    let raw = std::fs::read_to_string(&path).expect("read parity fixture");
    serde_json::from_str(&raw).expect("parse json")
}

#[test]
fn parity_graphql_delete_nodes_wire_op_type() {
    let fixture = load_fixture();
    let op_type = fixture["graphql_delete_nodes_input"]["wire_op_type"]
        .as_str()
        .expect("wire_op_type");
    assert_eq!(op_type, "delete_nodes");
}

#[test]
fn parity_graphql_delete_nodes_broadcast_value_shape() {
    let fixture = load_fixture();
    let broadcast = &fixture["graphql_delete_nodes_input"]["broadcast_value"];
    assert!(broadcast["node_uuids"].is_array());
    let uuids = broadcast["node_uuids"]
        .as_array()
        .expect("node_uuids array");
    assert_eq!(uuids.len(), 2);
}

#[test]
fn parity_graphql_delete_nodes_encoded_shape() {
    let fixture = load_fixture();
    let encoded = &fixture["graphql_delete_nodes_input"]["encoded"];
    let delete_nodes = encoded.get("deleteNodes").expect("encoded.deleteNodes");
    let node_uuids = delete_nodes
        .get("nodeUuids")
        .and_then(|v| v.as_array())
        .expect("encoded.deleteNodes.nodeUuids");
    assert_eq!(node_uuids.len(), 2);
}

#[test]
fn parity_mcp_delete_nodes_wire_op_type() {
    let fixture = load_fixture();
    let op_type = fixture["mcp_delete_nodes_input"]["wire_op_type"]
        .as_str()
        .expect("wire_op_type");
    assert_eq!(op_type, "delete_nodes");
}

#[test]
fn parity_mcp_tool_name() {
    let fixture = load_fixture();
    let tool_name = fixture["mcp_delete_nodes_input"]["tool_name"]
        .as_str()
        .expect("tool_name");
    assert_eq!(tool_name, "delete_nodes");
}

#[test]
fn parity_graphql_and_mcp_share_wire_op_type() {
    let fixture = load_fixture();
    let gql = fixture["graphql_delete_nodes_input"]["wire_op_type"]
        .as_str()
        .expect("graphql wire_op_type");
    let mcp = fixture["mcp_delete_nodes_input"]["wire_op_type"]
        .as_str()
        .expect("mcp wire_op_type");
    assert_eq!(gql, mcp);
}
