import { describe, it, expect, vi } from "vitest";
import { createShapeTool, type PreviewRect } from "../shape-tool";
import type { ToolEvent } from "../tool-manager";
import type { ToolStore } from "../../store/document-store-types";
import type { NodeKind, Transform } from "../../types/document";

/** Helper to create a minimal ToolEvent at given world coordinates. */
function makeEvent(worldX: number, worldY: number): ToolEvent {
  return {
    worldX,
    worldY,
    screenX: worldX,
    screenY: worldY,
    shiftKey: false,
    altKey: false,
  };
}

/** Minimal mock of ToolStore that records createNode and select calls. */
function makeMockStore(): ToolStore & {
  createNodeCalls: Array<{ kind: NodeKind; name: string; transform: Transform }>;
  selectCalls: (string | null)[];
} {
  const createNodeCalls: Array<{ kind: NodeKind; name: string; transform: Transform }> = [];
  const selectCalls: (string | null)[] = [];
  let callCount = 0;

  return {
    createNodeCalls,
    selectCalls,
    createNode(kind: NodeKind, name: string, transform: Transform): string {
      createNodeCalls.push({ kind, name, transform });
      callCount++;
      return `uuid-${String(callCount)}`;
    },
    getAllNodes: () => new Map(),
    setTransform: () => undefined,
    getSelectedNodeId: () => null,
    select: (uuid: string | null) => {
      selectCalls.push(uuid);
    },
    getViewportZoom: () => 1,
  };
}

/** Rectangle kind factory matching the plan. */
function rectangleKindFactory(): NodeKind {
  return {
    type: "rectangle" as const,
    corner_radii: [0, 0, 0, 0] as [number, number, number, number],
  };
}

/** Frame kind factory matching the plan. */
function frameKindFactory(): NodeKind {
  return { type: "frame" as const, layout: null };
}

/** Ellipse kind factory matching the plan. */
function ellipseKindFactory(): NodeKind {
  return { type: "ellipse" as const, arc_start: 0, arc_end: 360 };
}

describe("createShapeTool", () => {
  describe("getCursor", () => {
    it("should return crosshair", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      expect(tool.getCursor()).toBe("crosshair");
    });
  });

  describe("drag creates correct transform", () => {
    it("should create a node with correct transform when dragging top-left to bottom-right", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(10, 20));
      tool.onPointerMove(makeEvent(110, 120));
      tool.onPointerUp(makeEvent(110, 120));

      expect(store.createNodeCalls).toHaveLength(1);
      const call = store.createNodeCalls[0];
      expect(call.transform.x).toBe(10);
      expect(call.transform.y).toBe(20);
      expect(call.transform.width).toBe(100);
      expect(call.transform.height).toBe(100);
      expect(call.transform.rotation).toBe(0);
      expect(call.transform.scale_x).toBe(1);
      expect(call.transform.scale_y).toBe(1);
    });

    it("should handle negative width/height by using Math.min/Math.abs when dragging bottom-right to top-left", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(200, 300));
      tool.onPointerMove(makeEvent(50, 100));
      tool.onPointerUp(makeEvent(50, 100));

      expect(store.createNodeCalls).toHaveLength(1);
      const call = store.createNodeCalls[0];
      expect(call.transform.x).toBe(50);
      expect(call.transform.y).toBe(100);
      expect(call.transform.width).toBe(150);
      expect(call.transform.height).toBe(200);
    });
  });

  describe("zero-area drag creates nothing", () => {
    it("should not create a node when width is zero", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(10, 20));
      tool.onPointerMove(makeEvent(10, 120));
      tool.onPointerUp(makeEvent(10, 120));

      expect(store.createNodeCalls).toHaveLength(0);
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("should not create a node when height is zero", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(10, 20));
      tool.onPointerMove(makeEvent(110, 20));
      tool.onPointerUp(makeEvent(110, 20));

      expect(store.createNodeCalls).toHaveLength(0);
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("should not create a node when both dimensions are below minimum size", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(10, 20));
      tool.onPointerMove(makeEvent(10.5, 20.5));
      tool.onPointerUp(makeEvent(10.5, 20.5));

      expect(store.createNodeCalls).toHaveLength(0);
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("should not create a node when pointer up without any move", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(10, 20));
      tool.onPointerUp(makeEvent(10, 20));

      expect(store.createNodeCalls).toHaveLength(0);
    });
  });

  describe("preview rect during drag", () => {
    it("should return null preview rect before any interaction", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      expect(tool.getPreviewRect()).toBeNull();
    });

    it("should provide preview rect during drag", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(10, 20));
      tool.onPointerMove(makeEvent(60, 80));

      const preview = tool.getPreviewRect();
      expect(preview).not.toBeNull();
      const rect = preview as PreviewRect;
      expect(rect.x).toBe(10);
      expect(rect.y).toBe(20);
      expect(rect.width).toBe(50);
      expect(rect.height).toBe(60);
    });

    it("should normalize preview rect when dragging in negative direction", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(100, 200));
      tool.onPointerMove(makeEvent(50, 80));

      const preview = tool.getPreviewRect();
      expect(preview).not.toBeNull();
      const rect = preview as PreviewRect;
      expect(rect.x).toBe(50);
      expect(rect.y).toBe(80);
      expect(rect.width).toBe(50);
      expect(rect.height).toBe(120);
    });
  });

  describe("preview cleared after create", () => {
    it("should clear preview rect after successful creation", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(10, 20));
      tool.onPointerMove(makeEvent(60, 80));
      tool.onPointerUp(makeEvent(60, 80));

      expect(tool.getPreviewRect()).toBeNull();
    });

    it("should clear preview rect after zero-area drag", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(10, 20));
      tool.onPointerMove(makeEvent(10, 20));
      tool.onPointerUp(makeEvent(10, 20));

      expect(tool.getPreviewRect()).toBeNull();
    });
  });

  describe("name increments", () => {
    it("should increment the name counter for each created node", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      // First shape
      tool.onPointerDown(makeEvent(0, 0));
      tool.onPointerMove(makeEvent(50, 50));
      tool.onPointerUp(makeEvent(50, 50));

      // Second shape
      tool.onPointerDown(makeEvent(100, 100));
      tool.onPointerMove(makeEvent(200, 200));
      tool.onPointerUp(makeEvent(200, 200));

      expect(store.createNodeCalls).toHaveLength(2);
      expect(store.createNodeCalls[0].name).toBe("Rectangle 1");
      expect(store.createNodeCalls[1].name).toBe("Rectangle 2");
    });

    it("should not increment counter when creation is skipped due to zero area", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      // Zero-area drag
      tool.onPointerDown(makeEvent(0, 0));
      tool.onPointerUp(makeEvent(0, 0));

      // Valid drag
      tool.onPointerDown(makeEvent(0, 0));
      tool.onPointerMove(makeEvent(50, 50));
      tool.onPointerUp(makeEvent(50, 50));

      expect(store.createNodeCalls).toHaveLength(1);
      expect(store.createNodeCalls[0].name).toBe("Rectangle 1");
    });
  });

  describe("onComplete callback", () => {
    it("should call onComplete after successful node creation", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(10, 20));
      tool.onPointerMove(makeEvent(60, 80));
      tool.onPointerUp(makeEvent(60, 80));

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("should not call onComplete when drag produces zero area", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(10, 20));
      tool.onPointerUp(makeEvent(10, 20));

      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  describe("kind factory variants", () => {
    it("should pass frame kind to store.createNode", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, frameKindFactory, "Frame", onComplete);

      tool.onPointerDown(makeEvent(0, 0));
      tool.onPointerMove(makeEvent(100, 100));
      tool.onPointerUp(makeEvent(100, 100));

      expect(store.createNodeCalls).toHaveLength(1);
      expect(store.createNodeCalls[0].kind).toEqual({ type: "frame", layout: null });
      expect(store.createNodeCalls[0].name).toBe("Frame 1");
    });

    it("should pass ellipse kind to store.createNode", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, ellipseKindFactory, "Ellipse", onComplete);

      tool.onPointerDown(makeEvent(0, 0));
      tool.onPointerMove(makeEvent(100, 100));
      tool.onPointerUp(makeEvent(100, 100));

      expect(store.createNodeCalls).toHaveLength(1);
      expect(store.createNodeCalls[0].kind).toEqual({
        type: "ellipse",
        arc_start: 0,
        arc_end: 360,
      });
      expect(store.createNodeCalls[0].name).toBe("Ellipse 1");
    });

    it("should pass rectangle kind to store.createNode", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(0, 0));
      tool.onPointerMove(makeEvent(100, 100));
      tool.onPointerUp(makeEvent(100, 100));

      expect(store.createNodeCalls).toHaveLength(1);
      expect(store.createNodeCalls[0].kind).toEqual({
        type: "rectangle",
        corner_radii: [0, 0, 0, 0],
      });
    });
  });

  describe("pointermove without pointerdown", () => {
    it("should not set preview rect when moving without prior pointerdown", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerMove(makeEvent(50, 50));

      expect(tool.getPreviewRect()).toBeNull();
    });
  });

  describe("pointerup without pointerdown", () => {
    it("should not create a node when pointerup fires without prior pointerdown", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerUp(makeEvent(50, 50));

      expect(store.createNodeCalls).toHaveLength(0);
      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  describe("RF-009: auto-select after creation", () => {
    it("should select the newly created node after creation", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(10, 20));
      tool.onPointerMove(makeEvent(60, 80));
      tool.onPointerUp(makeEvent(60, 80));

      expect(store.selectCalls).toHaveLength(1);
      expect(store.selectCalls[0]).toBe("uuid-1");
    });

    it("should not select when creation is skipped due to zero area", () => {
      const store = makeMockStore();
      const onComplete = vi.fn();
      const tool = createShapeTool(store, rectangleKindFactory, "Rectangle", onComplete);

      tool.onPointerDown(makeEvent(10, 20));
      tool.onPointerUp(makeEvent(10, 20));

      expect(store.selectCalls).toHaveLength(0);
    });
  });
});
