import { describe, it, expect } from "vitest";
import { hitTest } from "../hit-test";
import type { DocumentNode, Transform, Style, Constraints } from "../../types/document";

/** Helper to create a minimal DocumentNode for hit testing. */
function makeNode(
  uuid: string,
  transform: Partial<Transform>,
  overrides?: Partial<Pick<DocumentNode, "visible" | "locked">>,
): DocumentNode {
  const defaultTransform: Transform = {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    scale_x: 1,
    scale_y: 1,
  };

  const defaultStyle: Style = {
    fills: [],
    strokes: [],
    opacity: { type: "literal", value: 1 },
    blend_mode: "normal",
    effects: [],
  };

  const defaultConstraints: Constraints = {
    horizontal: "start",
    vertical: "start",
  };

  return {
    id: { index: 0, generation: 0 },
    uuid,
    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
    name: `Node ${uuid}`,
    parent: null,
    children: [],
    transform: { ...defaultTransform, ...transform },
    style: defaultStyle,
    constraints: defaultConstraints,
    grid_placement: null,
    visible: overrides?.visible ?? true,
    locked: overrides?.locked ?? false,
  };
}

/** Helper to build a Map from an array of nodes (preserving insertion order). */
function buildNodeMap(nodes: DocumentNode[]): ReadonlyMap<string, DocumentNode> {
  const map = new Map<string, DocumentNode>();
  for (const node of nodes) {
    map.set(node.uuid, node);
  }
  return map;
}

describe("hitTest", () => {
  it("should return null when there are no nodes", () => {
    const nodes = buildNodeMap([]);
    const result = hitTest(nodes, 50, 50);
    expect(result).toBeNull();
  });

  it("should return the node when the point is inside its bounds", () => {
    const node = makeNode("a", { x: 10, y: 10, width: 100, height: 100 });
    const nodes = buildNodeMap([node]);

    const result = hitTest(nodes, 50, 50);
    expect(result).not.toBeNull();
    expect(result?.uuid).toBe("a");
  });

  it("should return null when the point is outside all nodes", () => {
    const node = makeNode("a", { x: 10, y: 10, width: 100, height: 100 });
    const nodes = buildNodeMap([node]);

    const result = hitTest(nodes, 200, 200);
    expect(result).toBeNull();
  });

  it("should return the node when the point is on the edge", () => {
    const node = makeNode("a", { x: 0, y: 0, width: 100, height: 100 });
    const nodes = buildNodeMap([node]);

    expect(hitTest(nodes, 0, 0)?.uuid).toBe("a");
    expect(hitTest(nodes, 100, 100)?.uuid).toBe("a");
    expect(hitTest(nodes, 100, 0)?.uuid).toBe("a");
    expect(hitTest(nodes, 0, 100)?.uuid).toBe("a");
  });

  it("should return the top-most node when multiple nodes overlap", () => {
    const bottom = makeNode("bottom", { x: 0, y: 0, width: 200, height: 200 });
    const top = makeNode("top", { x: 50, y: 50, width: 100, height: 100 });
    // 'top' is inserted last so it has higher z-order
    const nodes = buildNodeMap([bottom, top]);

    const result = hitTest(nodes, 75, 75);
    expect(result).not.toBeNull();
    expect(result?.uuid).toBe("top");
  });

  it("should return the next node if the top-most is invisible", () => {
    const bottom = makeNode("bottom", { x: 0, y: 0, width: 200, height: 200 });
    const top = makeNode("top", { x: 50, y: 50, width: 100, height: 100 }, { visible: false });
    const nodes = buildNodeMap([bottom, top]);

    const result = hitTest(nodes, 75, 75);
    expect(result).not.toBeNull();
    expect(result?.uuid).toBe("bottom");
  });

  it("should skip invisible nodes entirely", () => {
    const node = makeNode("a", { x: 0, y: 0, width: 100, height: 100 }, { visible: false });
    const nodes = buildNodeMap([node]);

    const result = hitTest(nodes, 50, 50);
    expect(result).toBeNull();
  });

  it("should skip locked nodes entirely", () => {
    const node = makeNode("a", { x: 0, y: 0, width: 100, height: 100 }, { locked: true });
    const nodes = buildNodeMap([node]);

    const result = hitTest(nodes, 50, 50);
    expect(result).toBeNull();
  });

  it("should return visible node underneath a locked node", () => {
    const bottom = makeNode("bottom", { x: 0, y: 0, width: 200, height: 200 });
    const top = makeNode("top", { x: 0, y: 0, width: 200, height: 200 }, { locked: true });
    const nodes = buildNodeMap([bottom, top]);

    const result = hitTest(nodes, 100, 100);
    expect(result).not.toBeNull();
    expect(result?.uuid).toBe("bottom");
  });

  it("should handle nodes with negative position coordinates", () => {
    const node = makeNode("a", { x: -50, y: -50, width: 100, height: 100 });
    const nodes = buildNodeMap([node]);

    expect(hitTest(nodes, -25, -25)?.uuid).toBe("a");
    expect(hitTest(nodes, 0, 0)?.uuid).toBe("a");
    expect(hitTest(nodes, 49, 49)?.uuid).toBe("a");
    expect(hitTest(nodes, 51, 51)).toBeNull();
  });

  it("should handle a rotated node using AABB approximation", () => {
    // A 100x100 node at (0,0) rotated 45 degrees.
    // The AABB of a rotated square is larger than the original.
    // For a 100x100 square centered at (50,50) rotated 45deg,
    // the AABB extends roughly from (50 - 70.7, 50 - 70.7) to (50 + 70.7, 50 + 70.7)
    const node = makeNode("rotated", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 45,
    });
    const nodes = buildNodeMap([node]);

    // Center should always hit
    expect(hitTest(nodes, 50, 50)?.uuid).toBe("rotated");

    // A point that is outside the original bounds but inside the rotated AABB
    // At 45 degrees, the top corner of the rotated square extends above y=0
    expect(hitTest(nodes, 50, -15)?.uuid).toBe("rotated");
  });

  it("should return null for a point outside the rotated AABB", () => {
    const node = makeNode("rotated", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 45,
    });
    const nodes = buildNodeMap([node]);

    // Far outside
    expect(hitTest(nodes, 200, 200)).toBeNull();
  });

  it("should handle many overlapping nodes and return the top-most hit", () => {
    const nodesArray: DocumentNode[] = [];
    for (let i = 0; i < 10; i++) {
      nodesArray.push(makeNode(`node-${i}`, { x: i * 5, y: i * 5, width: 100, height: 100 }));
    }
    const nodes = buildNodeMap(nodesArray);

    // Point at (50, 50) is inside all nodes.
    // The last inserted (node-9) should be returned since it's top-most.
    const result = hitTest(nodes, 50, 50);
    expect(result).not.toBeNull();
    expect(result?.uuid).toBe("node-9");
  });

  it("should handle zero-size nodes (point nodes)", () => {
    const node = makeNode("point", { x: 50, y: 50, width: 0, height: 0 });
    const nodes = buildNodeMap([node]);

    // Exact point should hit
    expect(hitTest(nodes, 50, 50)?.uuid).toBe("point");
    // Anything else should miss
    expect(hitTest(nodes, 50.1, 50)).toBeNull();
  });
});
