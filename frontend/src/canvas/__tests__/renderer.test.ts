/**
 * Tests for the canvas renderer — selection handles, preview drawing,
 * and snap guide line rendering.
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
    it("should draw selection handles when a node is selected by UUID", () => {
      const node = createTestNode();

      render(ctx, viewport, [node], "test-uuid-1", 1);

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

      render(ctx, viewport, [node], "test-uuid-1", 1);

      const calls = getCalls(ctx);
      const selectionStyleSets = calls.filter(
        (c) => c.method === "set:fillStyle" && c.args[0] === "#0d99ff",
      );
      expect(selectionStyleSets.length).toBe(0);
    });

    it("should use preview transform for selected node when provided", () => {
      const node = createTestNode({ uuid: "drag-node" });
      const previewTransform = {
        uuid: "drag-node",
        transform: { x: 200, y: 200, width: 200, height: 150, rotation: 0, scale_x: 1, scale_y: 1 },
      };

      render(ctx, viewport, [node], "drag-node", 1, null, previewTransform);

      const calls = getCalls(ctx);
      // The node should be drawn at the preview position (200, 200), not (100, 100)
      const fillRectCalls = calls.filter((c) => c.method === "fillRect");
      const hasPreviewPosition = fillRectCalls.some((c) => c.args[0] === 200 && c.args[1] === 200);
      expect(hasPreviewPosition).toBe(true);
    });
  });

  describe("drawGuideLines (via render)", () => {
    it("should not call stroke when no snap guides are provided", () => {
      const node = createTestNode();

      render(ctx, viewport, [node], null, 1, null, null, []);

      const calls = getCalls(ctx);
      // With empty guides the guide color should never be set
      const guideColorSets = calls.filter(
        (c) => c.method === "set:strokeStyle" && c.args[0] === "#ff3366",
      );
      expect(guideColorSets.length).toBe(0);
    });

    it("should set stroke style to guide color when x-axis snap guide is present", () => {
      const guides: SnapGuide[] = [{ axis: "x", position: 150 }];

      render(ctx, viewport, [], null, 1, null, null, guides);

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

      render(ctx, viewport, [], null, 1, null, null, guides);

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

      render(ctx, vp, [], null, 1, null, null, guides);

      const calls = getCalls(ctx);
      const guideColorIdx = calls.findIndex(
        (c) => c.method === "set:strokeStyle" && c.args[0] === "#ff3366",
      );
      expect(guideColorIdx).toBeGreaterThanOrEqual(0);

      const moveToAfterColor = calls.slice(guideColorIdx).find((c) => c.method === "moveTo");
      // x-axis guide → vertical line → moveTo(guide.position, worldTop)
      expect(moveToAfterColor).toBeDefined();
      expect(moveToAfterColor?.args[0]).toBe(300);
    });

    it("should draw a horizontal line for a y-axis guide using moveTo / lineTo with guide position as y", () => {
      const guides: SnapGuide[] = [{ axis: "y", position: 250 }];
      const vp: Viewport = { x: 0, y: 0, zoom: 1 };

      render(ctx, vp, [], null, 1, null, null, guides);

      const calls = getCalls(ctx);
      const guideColorIdx = calls.findIndex(
        (c) => c.method === "set:strokeStyle" && c.args[0] === "#ff3366",
      );
      expect(guideColorIdx).toBeGreaterThanOrEqual(0);

      const moveToAfterColor = calls.slice(guideColorIdx).find((c) => c.method === "moveTo");
      // y-axis guide → horizontal line → moveTo(worldLeft, guide.position)
      expect(moveToAfterColor).toBeDefined();
      expect(moveToAfterColor?.args[1]).toBe(250);
    });

    it("should use a 1px screen-space line width (scaled by zoom inverse)", () => {
      const guides: SnapGuide[] = [{ axis: "x", position: 100 }];
      const vp: Viewport = { x: 0, y: 0, zoom: 2 };

      render(ctx, vp, [], null, 1, null, null, guides);

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
});
