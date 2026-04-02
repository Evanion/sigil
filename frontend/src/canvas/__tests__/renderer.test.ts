/**
 * Tests for the canvas renderer — selection handles and preview drawing.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render } from "../renderer";
import type { Viewport } from "../viewport";
import type { DocumentNode, NodeId } from "../../types/document";

/** Create a minimal DocumentNode for testing. */
function createTestNode(overrides?: Partial<DocumentNode>): DocumentNode {
  return {
    id: { index: 1, generation: 0 },
    uuid: "test-uuid-1",
    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
    name: "Test Node",
    parent: null,
    children: [],
    transform: { x: 100, y: 100, width: 200, height: 150, rotation: 0, scale_x: 1, scale_y: 1 },
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal", value: 1 },
      blend_mode: "normal",
      effects: [],
    },
    constraints: { horizontal: "start", vertical: "start" },
    grid_placement: null,
    visible: true,
    locked: false,
    ...overrides,
  };
}

/** Create a mock 2D canvas context that records calls. */
function createMockContext(): CanvasRenderingContext2D {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target: Record<string, unknown>, prop: string): unknown {
      if (prop === "__calls") {
        return calls;
      }
      if (prop === "canvas") {
        return { width: 800, height: 600 };
      }
      // Return a function that records the call
      if (typeof target[prop] === "undefined") {
        target[prop] = (...args: unknown[]) => {
          calls.push({ method: prop, args });
        };
      }
      return target[prop];
    },
    set(target: Record<string, unknown>, prop: string, value: unknown): boolean {
      calls.push({ method: `set:${prop}`, args: [value] });
      target[prop] = value;
      return true;
    },
  };

  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

/** Extract recorded calls from the mock context. */
function getCalls(ctx: CanvasRenderingContext2D): Array<{ method: string; args: unknown[] }> {
  return (ctx as unknown as { __calls: Array<{ method: string; args: unknown[] }> }).__calls;
}

describe("renderer", () => {
  let ctx: CanvasRenderingContext2D;
  let viewport: Viewport;

  beforeEach(() => {
    ctx = createMockContext();
    viewport = { x: 0, y: 0, zoom: 1 };
  });

  describe("selection handles", () => {
    it("should draw selection handles when a node is selected", () => {
      const node = createTestNode();
      const selectedId: NodeId = { index: 1, generation: 0 };

      render(ctx, viewport, [node], selectedId, 1);

      const calls = getCalls(ctx);
      // Selection handles are drawn as fillRect calls with SELECTION_COLOR
      // We should see 8 handle fills (4 corners + 4 edge midpoints)
      const handleFills = calls.filter(
        (c) => c.method === "fillRect" && calls.some(
          (sc) => sc.method === "set:fillStyle" && sc.args[0] === "#0d99ff",
        ),
      );
      // At minimum we should have the 8 handle rects after the selection highlight
      expect(handleFills.length).toBeGreaterThanOrEqual(8);
    });

    it("should not draw selection handles when no node is selected", () => {
      const node = createTestNode();

      render(ctx, viewport, [node], null, 1);

      const calls = getCalls(ctx);
      // No selection color should be set (besides the node fill itself)
      const selectionStyleSets = calls.filter(
        (c) => c.method === "set:fillStyle" && c.args[0] === "#0d99ff",
      );
      expect(selectionStyleSets.length).toBe(0);
    });

    it("should not draw selection handles for invisible nodes", () => {
      const node = createTestNode({ visible: false });
      const selectedId: NodeId = { index: 1, generation: 0 };

      render(ctx, viewport, [node], selectedId, 1);

      const calls = getCalls(ctx);
      const selectionStyleSets = calls.filter(
        (c) => c.method === "set:fillStyle" && c.args[0] === "#0d99ff",
      );
      expect(selectionStyleSets.length).toBe(0);
    });
  });
});
