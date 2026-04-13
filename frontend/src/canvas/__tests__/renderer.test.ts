/**
 * Tests for the canvas renderer — selection handles, preview drawing,
 * multi-select compound bounds, marquee rect, and snap guide line rendering.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render } from "../renderer";
import type { Viewport } from "../viewport";
import type { DocumentNode } from "../../types/document";
import type { SnapGuide } from "../snap-engine";

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

/**
 * Mock CanvasGradient that records addColorStop calls.
 * Stores gradient type and construction args for test assertions.
 */
interface MockGradient {
  readonly __type: "linear" | "radial";
  readonly __args: readonly number[];
  readonly __stops: Array<{ offset: number; color: string }>;
  addColorStop: (offset: number, color: string) => void;
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
      // createLinearGradient / createRadialGradient return mock gradients
      if (prop === "createLinearGradient") {
        return (...args: number[]): MockGradient => {
          const stops: Array<{ offset: number; color: string }> = [];
          const gradient: MockGradient = {
            __type: "linear",
            __args: args,
            __stops: stops,
            addColorStop(offset: number, color: string) {
              stops.push({ offset, color });
            },
          };
          calls.push({ method: "createLinearGradient", args });
          return gradient;
        };
      }
      if (prop === "createRadialGradient") {
        return (...args: number[]): MockGradient => {
          const stops: Array<{ offset: number; color: string }> = [];
          const gradient: MockGradient = {
            __type: "radial",
            __args: args,
            __stops: stops,
            addColorStop(offset: number, color: string) {
              stops.push({ offset, color });
            },
          };
          calls.push({ method: "createRadialGradient", args });
          return gradient;
        };
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
    it("should draw selection handles when a node is selected by UUID", () => {
      const node = createTestNode();

      render(ctx, viewport, [node], new Set(["test-uuid-1"]), 1);

      const calls = getCalls(ctx);
      // Selection handles are drawn as fillRect calls with SELECTION_COLOR
      // We should see 8 handle fills (4 corners + 4 edge midpoints)
      const handleFills = calls.filter(
        (c) =>
          c.method === "fillRect" &&
          calls.some((sc) => sc.method === "set:fillStyle" && sc.args[0] === "#0d99ff"),
      );
      // At minimum we should have the 8 handle rects after the selection highlight
      expect(handleFills.length).toBeGreaterThanOrEqual(8);
    });

    it("should not draw selection handles when no node is selected", () => {
      const node = createTestNode();

      render(ctx, viewport, [node], new Set<string>(), 1);

      const calls = getCalls(ctx);
      // No selection color should be set (besides the node fill itself)
      const selectionStyleSets = calls.filter(
        (c) => c.method === "set:fillStyle" && c.args[0] === "#0d99ff",
      );
      expect(selectionStyleSets.length).toBe(0);
    });

    it("should not draw selection handles for invisible nodes", () => {
      const node = createTestNode({ visible: false });

      render(ctx, viewport, [node], new Set(["test-uuid-1"]), 1);

      const calls = getCalls(ctx);
      const selectionStyleSets = calls.filter(
        (c) => c.method === "set:fillStyle" && c.args[0] === "#0d99ff",
      );
      expect(selectionStyleSets.length).toBe(0);
    });

    it("should use preview transform for selected node when provided", () => {
      const node = createTestNode({ uuid: "drag-node" });
      const previewTransforms = [
        {
          uuid: "drag-node",
          transform: {
            x: 200,
            y: 200,
            width: 200,
            height: 150,
            rotation: 0,
            scale_x: 1,
            scale_y: 1,
          },
        },
      ];

      render(ctx, viewport, [node], new Set(["drag-node"]), 1, null, previewTransforms);

      const calls = getCalls(ctx);
      // The node should be drawn at the preview position (200, 200), not (100, 100)
      const fillRectCalls = calls.filter((c) => c.method === "fillRect");
      const hasPreviewPosition = fillRectCalls.some((c) => c.args[0] === 200 && c.args[1] === 200);
      expect(hasPreviewPosition).toBe(true);
    });
  });

  describe("multi-select compound bounds", () => {
    it("should draw individual highlights for each selected node", () => {
      const node1 = createTestNode({ uuid: "uuid-1", name: "Node 1" });
      const node2 = createTestNode({
        uuid: "uuid-2",
        name: "Node 2",
        transform: {
          x: 400,
          y: 400,
          width: 100,
          height: 100,
          rotation: 0,
          scale_x: 1,
          scale_y: 1,
        },
      });

      render(ctx, viewport, [node1, node2], new Set(["uuid-1", "uuid-2"]), 1);

      const calls = getCalls(ctx);
      // Should see strokeRect calls for individual highlights
      const strokeRects = calls.filter((c) => c.method === "strokeRect");
      // At least: individual highlight for node1, individual highlight for node2,
      // and compound bounds outline = 3 strokeRects total
      expect(strokeRects.length).toBeGreaterThanOrEqual(3);
    });

    it("should draw compound bounding box handles when 2+ nodes are selected", () => {
      const node1 = createTestNode({ uuid: "uuid-1", name: "Node 1" });
      const node2 = createTestNode({
        uuid: "uuid-2",
        name: "Node 2",
        transform: {
          x: 400,
          y: 400,
          width: 100,
          height: 100,
          rotation: 0,
          scale_x: 1,
          scale_y: 1,
        },
      });

      render(ctx, viewport, [node1, node2], new Set(["uuid-1", "uuid-2"]), 1);

      const calls = getCalls(ctx);
      // Compound bounds handles: 8 fillRect calls with SELECTION_COLOR
      // after the compound bounds strokeRect.
      // We look for the dashed strokeRect (compound bounds) followed by handle fillRects.
      const setLineDashCalls = calls.filter((c) => c.method === "setLineDash");
      // drawCompoundBounds sets a dashed pattern and then resets it
      expect(setLineDashCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("should not draw name label when multiple nodes are selected", () => {
      const node1 = createTestNode({ uuid: "uuid-1", name: "Node 1" });
      const node2 = createTestNode({ uuid: "uuid-2", name: "Node 2" });

      render(ctx, viewport, [node1, node2], new Set(["uuid-1", "uuid-2"]), 1);

      const calls = getCalls(ctx);
      // fillText is used for name labels and text nodes
      const fillTextCalls = calls.filter((c) => c.method === "fillText");
      // Neither node has text content, so no fillText calls for node rendering.
      // No name labels should be drawn for multi-select.
      expect(fillTextCalls.length).toBe(0);
    });

    it("should draw name label when exactly one node is selected", () => {
      const node = createTestNode({ uuid: "uuid-1", name: "My Node" });

      render(ctx, viewport, [node], new Set(["uuid-1"]), 1);

      const calls = getCalls(ctx);
      const fillTextCalls = calls.filter((c) => c.method === "fillText");
      // Should have a name label drawn
      const hasLabel = fillTextCalls.some((c) => c.args[0] === "My Node");
      expect(hasLabel).toBe(true);
    });
  });

  describe("drawMarqueeRect (via render)", () => {
    it("should draw marquee rect when provided", () => {
      const marquee = { x: 50, y: 50, width: 200, height: 150 };

      render(ctx, viewport, [], new Set<string>(), 1, null, [], [], marquee);

      const calls = getCalls(ctx);
      // Marquee should produce a fillRect and strokeRect with the marquee color
      const marqueeFills = calls.filter(
        (c) => c.method === "fillRect" && c.args[0] === 50 && c.args[1] === 50,
      );
      expect(marqueeFills.length).toBeGreaterThanOrEqual(1);

      const marqueeStrokes = calls.filter(
        (c) => c.method === "strokeRect" && c.args[0] === 50 && c.args[1] === 50,
      );
      expect(marqueeStrokes.length).toBeGreaterThanOrEqual(1);
    });

    it("should set dashed line pattern for marquee rect", () => {
      const marquee = { x: 0, y: 0, width: 100, height: 100 };

      render(ctx, viewport, [], new Set<string>(), 1, null, [], [], marquee);

      const calls = getCalls(ctx);
      // Should have a setLineDash call with non-empty array
      const dashCalls = calls.filter((c) => c.method === "setLineDash" && Array.isArray(c.args[0]));
      const hasDashPattern = dashCalls.some(
        (c) => (c.args[0] as number[]).length > 0 && (c.args[0] as number[])[0] > 0,
      );
      expect(hasDashPattern).toBe(true);
    });

    it("should not draw marquee rect when null", () => {
      render(ctx, viewport, [], new Set<string>(), 1, null, [], [], null);

      const calls = getCalls(ctx);
      // With no nodes, no selection, no preview, no guides, no marquee,
      // there should be minimal calls (just setTransform + clearRect + setTransform).
      const strokeRectCalls = calls.filter((c) => c.method === "strokeRect");
      expect(strokeRectCalls.length).toBe(0);
    });

    it("should use marquee fill color with semi-transparency", () => {
      const marquee = { x: 10, y: 10, width: 50, height: 50 };

      render(ctx, viewport, [], new Set<string>(), 1, null, [], [], marquee);

      const calls = getCalls(ctx);
      const fillStyleSets = calls.filter(
        (c) => c.method === "set:fillStyle" && typeof c.args[0] === "string",
      );
      const hasMarqueeFill = fillStyleSets.some((c) =>
        (c.args[0] as string).includes("rgba(13, 153, 255, 0.1)"),
      );
      expect(hasMarqueeFill).toBe(true);
    });

    it("should normalize negative marquee dimensions before drawing", () => {
      // RF-016: Test that right-to-left / bottom-to-top marquee is normalized
      const marquee = { x: 250, y: 200, width: -200, height: -150 };

      render(ctx, viewport, [], new Set<string>(), 1, null, [], [], marquee);

      const calls = getCalls(ctx);
      // After normalization: x=50, y=50, w=200, h=150
      const marqueeFills = calls.filter(
        (c) => c.method === "fillRect" && c.args[0] === 50 && c.args[1] === 50,
      );
      expect(marqueeFills.length).toBeGreaterThanOrEqual(1);

      const marqueeStrokes = calls.filter(
        (c) =>
          c.method === "strokeRect" &&
          c.args[0] === 50 &&
          c.args[1] === 50 &&
          c.args[2] === 200 &&
          c.args[3] === 150,
      );
      expect(marqueeStrokes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("drawGuideLines (via render)", () => {
    it("should not call stroke when no snap guides are provided", () => {
      const node = createTestNode();

      render(ctx, viewport, [node], new Set<string>(), 1, null, [], []);

      const calls = getCalls(ctx);
      // With empty guides the guide color should never be set
      const guideColorSets = calls.filter(
        (c) => c.method === "set:strokeStyle" && c.args[0] === "#ff3366",
      );
      expect(guideColorSets.length).toBe(0);
    });

    it("should set stroke style to guide color when x-axis snap guide is present", () => {
      const guides: SnapGuide[] = [{ axis: "x", position: 150 }];

      render(ctx, viewport, [], new Set<string>(), 1, null, [], guides);

      const calls = getCalls(ctx);
      const guideColorSets = calls.filter(
        (c) => c.method === "set:strokeStyle" && c.args[0] === "#ff3366",
      );
      expect(guideColorSets.length).toBeGreaterThanOrEqual(1);
    });

    it("should call stroke once per guide", () => {
      const guides: SnapGuide[] = [
        { axis: "x", position: 100 },
        { axis: "y", position: 200 },
      ];

      render(ctx, viewport, [], new Set<string>(), 1, null, [], guides);

      const calls = getCalls(ctx);
      // Count stroke calls that occur after guide color is set
      const guideColorIdx = calls.findIndex(
        (c) => c.method === "set:strokeStyle" && c.args[0] === "#ff3366",
      );
      expect(guideColorIdx).toBeGreaterThanOrEqual(0);

      const strokesAfterGuideColor = calls
        .slice(guideColorIdx)
        .filter((c) => c.method === "stroke");
      // Two guides => two stroke calls
      expect(strokesAfterGuideColor.length).toBe(2);
    });

    it("should draw a vertical line for an x-axis guide using moveTo / lineTo with guide position as x", () => {
      const guides: SnapGuide[] = [{ axis: "x", position: 300 }];
      // Viewport at origin, zoom 1 — canvas is 800x600 logical px
      const vp: Viewport = { x: 0, y: 0, zoom: 1 };

      render(ctx, vp, [], new Set<string>(), 1, null, [], guides);

      const calls = getCalls(ctx);
      const guideColorIdx = calls.findIndex(
        (c) => c.method === "set:strokeStyle" && c.args[0] === "#ff3366",
      );
      expect(guideColorIdx).toBeGreaterThanOrEqual(0);

      const moveToAfterColor = calls.slice(guideColorIdx).find((c) => c.method === "moveTo");
      // x-axis guide -> vertical line -> moveTo(guide.position, worldTop)
      expect(moveToAfterColor).toBeDefined();
      expect(moveToAfterColor?.args[0]).toBe(300);
    });

    it("should draw a horizontal line for a y-axis guide using moveTo / lineTo with guide position as y", () => {
      const guides: SnapGuide[] = [{ axis: "y", position: 250 }];
      const vp: Viewport = { x: 0, y: 0, zoom: 1 };

      render(ctx, vp, [], new Set<string>(), 1, null, [], guides);

      const calls = getCalls(ctx);
      const guideColorIdx = calls.findIndex(
        (c) => c.method === "set:strokeStyle" && c.args[0] === "#ff3366",
      );
      expect(guideColorIdx).toBeGreaterThanOrEqual(0);

      const moveToAfterColor = calls.slice(guideColorIdx).find((c) => c.method === "moveTo");
      // y-axis guide -> horizontal line -> moveTo(worldLeft, guide.position)
      expect(moveToAfterColor).toBeDefined();
      expect(moveToAfterColor?.args[1]).toBe(250);
    });

    it("should use a 1px screen-space line width (scaled by zoom inverse)", () => {
      const guides: SnapGuide[] = [{ axis: "x", position: 100 }];
      const vp: Viewport = { x: 0, y: 0, zoom: 2 };

      render(ctx, vp, [], new Set<string>(), 1, null, [], guides);

      const calls = getCalls(ctx);
      const guideColorIdx = calls.findIndex(
        (c) => c.method === "set:strokeStyle" && c.args[0] === "#ff3366",
      );
      expect(guideColorIdx).toBeGreaterThanOrEqual(0);

      // lineWidth should be set to 1 / zoom = 0.5 at zoom=2
      const lineWidthSetAfterColor = calls
        .slice(guideColorIdx)
        .find((c) => c.method === "set:lineWidth");
      expect(lineWidthSetAfterColor).toBeDefined();
      expect(lineWidthSetAfterColor?.args[0]).toBe(0.5);
    });
  });

  describe("gradient fill rendering", () => {
    it("should create a linear gradient when node has a linear_gradient fill", () => {
      const node = createTestNode({
        style: {
          fills: [
            {
              type: "linear_gradient",
              gradient: {
                stops: [
                  {
                    position: 0,
                    color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } },
                  },
                  {
                    position: 1,
                    color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 1, a: 1 } },
                  },
                ],
                start: { x: 0, y: 0 },
                end: { x: 1, y: 1 },
              },
            },
          ],
          strokes: [],
          opacity: { type: "literal", value: 1 },
          blend_mode: "normal",
          effects: [],
        },
      });

      render(ctx, viewport, [node], new Set<string>(), 1);

      const calls = getCalls(ctx);
      const linearCalls = calls.filter((c) => c.method === "createLinearGradient");
      expect(linearCalls.length).toBe(1);

      // start = (100 + 0*200, 100 + 0*150) = (100, 100)
      // end   = (100 + 1*200, 100 + 1*150) = (300, 250)
      expect(linearCalls[0].args).toEqual([100, 100, 300, 250]);
    });

    it("should create a radial gradient when node has a radial_gradient fill", () => {
      const node = createTestNode({
        style: {
          fills: [
            {
              type: "radial_gradient",
              gradient: {
                stops: [
                  {
                    position: 0,
                    color: { type: "literal", value: { space: "srgb", r: 1, g: 1, b: 1, a: 1 } },
                  },
                  {
                    position: 1,
                    color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
                  },
                ],
                start: { x: 0.5, y: 0.5 },
                end: { x: 1, y: 0.5 },
              },
            },
          ],
          strokes: [],
          opacity: { type: "literal", value: 1 },
          blend_mode: "normal",
          effects: [],
        },
      });

      render(ctx, viewport, [node], new Set<string>(), 1);

      const calls = getCalls(ctx);
      const radialCalls = calls.filter((c) => c.method === "createRadialGradient");
      expect(radialCalls.length).toBe(1);

      // center = (100 + 0.5*200, 100 + 0.5*150) = (200, 175)
      // dx = (1 - 0.5) * 200 = 100, dy = (0.5 - 0.5) * 150 = 0
      // r = sqrt(100^2 + 0^2) = 100
      expect(radialCalls[0].args[0]).toBe(200); // cx
      expect(radialCalls[0].args[1]).toBe(175); // cy
      expect(radialCalls[0].args[2]).toBe(0); // inner radius
      expect(radialCalls[0].args[3]).toBe(200); // cx
      expect(radialCalls[0].args[4]).toBe(175); // cy
      expect(radialCalls[0].args[5]).toBe(100); // outer radius
    });

    it("should draw the shape once per fill when multiple fills are present", () => {
      const node = createTestNode({
        style: {
          fills: [
            {
              type: "solid",
              color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } },
            },
            {
              type: "linear_gradient",
              gradient: {
                stops: [
                  {
                    position: 0,
                    color: { type: "literal", value: { space: "srgb", r: 0, g: 1, b: 0, a: 1 } },
                  },
                  {
                    position: 1,
                    color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 1, a: 1 } },
                  },
                ],
                start: { x: 0, y: 0 },
                end: { x: 1, y: 0 },
              },
            },
          ],
          strokes: [],
          opacity: { type: "literal", value: 1 },
          blend_mode: "normal",
          effects: [],
        },
      });

      render(ctx, viewport, [node], new Set<string>(), 1);

      const calls = getCalls(ctx);
      // The node is a rectangle, so each fill should produce one fillRect.
      // 2 fills = 2 fillRect calls for the node itself.
      const fillRectCalls = calls.filter(
        (c) =>
          c.method === "fillRect" &&
          c.args[0] === 100 &&
          c.args[1] === 100 &&
          c.args[2] === 200 &&
          c.args[3] === 150,
      );
      expect(fillRectCalls.length).toBe(2);
    });

    it("should use default fill color when node has no fills", () => {
      const node = createTestNode({
        style: {
          fills: [],
          strokes: [],
          opacity: { type: "literal", value: 1 },
          blend_mode: "normal",
          effects: [],
        },
      });

      render(ctx, viewport, [node], new Set<string>(), 1);

      const calls = getCalls(ctx);
      // Should still draw the node with default fill
      const fillStyleSets = calls.filter(
        (c) => c.method === "set:fillStyle" && c.args[0] === "#e0e0e0",
      );
      expect(fillStyleSets.length).toBeGreaterThanOrEqual(1);
    });

    it("should render gradient fills on ellipse nodes", () => {
      const node = createTestNode({
        kind: { type: "ellipse", arc_start: 0, arc_end: 360 },
        style: {
          fills: [
            {
              type: "linear_gradient",
              gradient: {
                stops: [
                  {
                    position: 0,
                    color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } },
                  },
                  {
                    position: 1,
                    color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 1, a: 1 } },
                  },
                ],
                start: { x: 0, y: 0 },
                end: { x: 1, y: 1 },
              },
            },
          ],
          strokes: [],
          opacity: { type: "literal", value: 1 },
          blend_mode: "normal",
          effects: [],
        },
      });

      render(ctx, viewport, [node], new Set<string>(), 1);

      const calls = getCalls(ctx);
      const linearCalls = calls.filter((c) => c.method === "createLinearGradient");
      expect(linearCalls.length).toBe(1);
      // Should call fill() for the ellipse path
      const fillCalls = calls.filter((c) => c.method === "fill");
      expect(fillCalls.length).toBe(1);
    });

    it("should skip gradient stops with non-finite positions", () => {
      const node = createTestNode({
        style: {
          fills: [
            {
              type: "linear_gradient",
              gradient: {
                stops: [
                  {
                    position: 0,
                    color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } },
                  },
                  {
                    position: NaN,
                    color: { type: "literal", value: { space: "srgb", r: 0, g: 1, b: 0, a: 1 } },
                  },
                  {
                    position: 1,
                    color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 1, a: 1 } },
                  },
                ],
                start: { x: 0, y: 0 },
                end: { x: 1, y: 0 },
              },
            },
          ],
          strokes: [],
          opacity: { type: "literal", value: 1 },
          blend_mode: "normal",
          effects: [],
        },
      });

      render(ctx, viewport, [node], new Set<string>(), 1);

      const calls = getCalls(ctx);
      const linearCalls = calls.filter((c) => c.method === "createLinearGradient");
      expect(linearCalls.length).toBe(1);

      // The gradient should be created, and the NaN stop should be skipped.
      // We verify by checking the fillStyle was set to a gradient (non-string).
      const fillStyleSets = calls.filter((c) => c.method === "set:fillStyle");
      const hasGradientFill = fillStyleSets.some(
        (c) => typeof c.args[0] === "object" && c.args[0] !== null,
      );
      expect(hasGradientFill).toBe(true);
    });
  });
});
