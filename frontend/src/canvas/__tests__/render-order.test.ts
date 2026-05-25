/**
 * Tests for buildRenderOrder — depth-first tree traversal for canvas z-order.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRenderOrder, MAX_RENDER_DEPTH, type RenderOrderNode } from "../render-order";
import type { Transform } from "../../types/document";

const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  scale_x: 1,
  scale_y: 1,
};

function makeNode(
  uuid: string,
  parentUuid: string | null,
  childrenUuids: string[],
): RenderOrderNode {
  return {
    id: { index: 0, generation: 0 },
    uuid,
    name: uuid,
    kind: { type: "rectangle" },
    transform: DEFAULT_TRANSFORM,
    style: { fills: [], strokes: [], effects: [], opacity: 1, blend_mode: "normal" },
    visible: true,
    locked: false,
    parent: parentUuid,
    children: childrenUuids.map(() => ({ index: 0, generation: 0 })),
    constraints: { horizontal: "start", vertical: "start" },
    grid_placement: null,
    parentUuid,
    childrenUuids,
  } as unknown as RenderOrderNode;
}

describe("buildRenderOrder", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("should return empty arrays for empty store", () => {
    const result = buildRenderOrder({}, []);
    expect(result.nodes).toEqual([]);
    expect(result.depths).toEqual([]);
  });

  it("should return single root node at depth 0", () => {
    const nodes: Record<string, RenderOrderNode> = {
      a: makeNode("a", null, []),
    };
    const result = buildRenderOrder(nodes, ["a"]);
    expect(result.nodes.map((n) => n.uuid)).toEqual(["a"]);
    expect(result.depths).toEqual([0]);
  });

  it("should render parent before children (parent behind) and report depths", () => {
    const nodes: Record<string, RenderOrderNode> = {
      parent: makeNode("parent", null, ["child"]),
      child: makeNode("child", "parent", []),
    };
    const result = buildRenderOrder(nodes, ["parent", "child"]);
    expect(result.nodes.map((n) => n.uuid)).toEqual(["parent", "child"]);
    expect(result.depths).toEqual([0, 1]);
  });

  it("should render first sibling before last sibling (first behind)", () => {
    const nodes: Record<string, RenderOrderNode> = {
      parent: makeNode("parent", null, ["a", "b", "c"]),
      a: makeNode("a", "parent", []),
      b: makeNode("b", "parent", []),
      c: makeNode("c", "parent", []),
    };
    const result = buildRenderOrder(nodes, ["parent", "a", "b", "c"]);
    // parent first, then a (behind), b, c (front)
    expect(result.nodes.map((n) => n.uuid)).toEqual(["parent", "a", "b", "c"]);
    expect(result.depths).toEqual([0, 1, 1, 1]);
  });

  it("should handle nested children in depth-first order with correct depths", () => {
    // parent -> [a -> [a1, a2], b]
    const nodes: Record<string, RenderOrderNode> = {
      parent: makeNode("parent", null, ["a", "b"]),
      a: makeNode("a", "parent", ["a1", "a2"]),
      a1: makeNode("a1", "a", []),
      a2: makeNode("a2", "a", []),
      b: makeNode("b", "parent", []),
    };
    const result = buildRenderOrder(nodes, ["parent", "a", "a1", "a2", "b"]);
    // DFS: parent (0), a (1), a1 (2), a2 (2), b (1)
    expect(result.nodes.map((n) => n.uuid)).toEqual(["parent", "a", "a1", "a2", "b"]);
    expect(result.depths).toEqual([0, 1, 2, 2, 1]);
  });

  it("should treat nodes with missing parent as roots", () => {
    const nodes: Record<string, RenderOrderNode> = {
      orphan: makeNode("orphan", "missing-parent", []),
      root: makeNode("root", null, []),
    };
    const result = buildRenderOrder(nodes, ["orphan", "root"]);
    // Both treated as roots
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((n) => n.uuid)).toContain("orphan");
    expect(result.nodes.map((n) => n.uuid)).toContain("root");
    expect(result.depths).toEqual([0, 0]);
  });

  it("should handle multiple root nodes", () => {
    const nodes: Record<string, RenderOrderNode> = {
      root1: makeNode("root1", null, []),
      root2: makeNode("root2", null, []),
      root3: makeNode("root3", null, []),
    };
    const result = buildRenderOrder(nodes, ["root1", "root2", "root3"]);
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.map((n) => n.uuid)).toEqual(["root1", "root2", "root3"]);
    expect(result.depths).toEqual([0, 0, 0]);
  });

  it("should skip nodes whose childrenUuids reference missing nodes", () => {
    const nodes: Record<string, RenderOrderNode> = {
      parent: makeNode("parent", null, ["exists", "missing"]),
      exists: makeNode("exists", "parent", []),
    };
    const result = buildRenderOrder(nodes, ["parent", "exists"]);
    expect(result.nodes.map((n) => n.uuid)).toEqual(["parent", "exists"]);
    expect(result.depths).toEqual([0, 1]);
  });
});

describe("MAX_RENDER_DEPTH enforcement", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("test_max_render_depth_enforced", () => {
    // Build a chain of MAX_RENDER_DEPTH + 5 nodes
    const chainLength = MAX_RENDER_DEPTH + 5;
    const nodes: Record<string, RenderOrderNode> = {};
    const keys: string[] = [];

    for (let i = 0; i < chainLength; i++) {
      const uuid = `node-${i}`;
      const parentUuid = i === 0 ? null : `node-${i - 1}`;
      const childUuid = i < chainLength - 1 ? `node-${i + 1}` : undefined;
      nodes[uuid] = makeNode(uuid, parentUuid, childUuid ? [childUuid] : []);
      keys.push(uuid);
    }

    const result = buildRenderOrder(nodes, keys);

    // Should include exactly MAX_RENDER_DEPTH nodes (depth 0 through MAX_RENDER_DEPTH-1)
    expect(result.nodes).toHaveLength(MAX_RENDER_DEPTH);
    // Should NOT include nodes beyond the depth limit
    expect(result.nodes.map((n) => n.uuid)).not.toContain(`node-${MAX_RENDER_DEPTH}`);
    // Should have logged a warning
    expect(console.warn).toHaveBeenCalled();
  });

  it("should terminate on cyclic references", () => {
    // A -> B -> A (cycle)
    const nodes: Record<string, RenderOrderNode> = {
      a: makeNode("a", null, ["b"]),
      b: makeNode("b", "a", ["a"]),
    };

    const result = buildRenderOrder(nodes, ["a", "b"]);

    // Should terminate (not infinite loop) and produce some nodes
    expect(result.nodes.length).toBeGreaterThan(0);
    // Should have hit the depth guard eventually
    expect(console.warn).toHaveBeenCalled();
  });
});
