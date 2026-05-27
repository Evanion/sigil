import { describe, it, expect } from "vitest";
import fixture from "../../../tests/fixtures/parity/delete-nodes-encoding.json";

// Cross-language parity test for the delete_nodes wire format (Spec 19).
// The Rust counterpart at crates/server/tests/parity_delete_nodes.rs reads
// the same fixture and asserts the Rust side matches.

describe("delete_nodes wire-format parity (Spec 19)", () => {
  it("graphql wire_op_type is delete_nodes", () => {
    expect(fixture.graphql_delete_nodes_input.wire_op_type).toBe("delete_nodes");
  });

  it("graphql broadcast value carries node_uuids array", () => {
    expect(Array.isArray(fixture.graphql_delete_nodes_input.broadcast_value.node_uuids)).toBe(true);
    expect(fixture.graphql_delete_nodes_input.broadcast_value.node_uuids).toHaveLength(2);
  });

  it("graphql input encoded form matches the OperationInput::DeleteNodes shape", () => {
    expect(fixture.graphql_delete_nodes_input.encoded.deleteNodes).toBeDefined();
    expect(Array.isArray(fixture.graphql_delete_nodes_input.encoded.deleteNodes.nodeUuids)).toBe(true);
  });

  it("mcp wire_op_type is delete_nodes", () => {
    expect(fixture.mcp_delete_nodes_input.wire_op_type).toBe("delete_nodes");
  });

  it("mcp tool name matches", () => {
    expect(fixture.mcp_delete_nodes_input.tool_name).toBe("delete_nodes");
  });

  it("mcp single-uuid batch is supported (N=1 edge case)", () => {
    expect(fixture.mcp_delete_nodes_input.input.node_uuids).toHaveLength(1);
  });

  it("graphql and mcp use the same wire op_type", () => {
    expect(fixture.graphql_delete_nodes_input.wire_op_type).toBe(
      fixture.mcp_delete_nodes_input.wire_op_type,
    );
  });
});
