import { describe, it, expect, vi } from "vitest";
import { createTextTool } from "../text-tool";
import type { ToolEvent } from "../tool-manager";
import type { ToolStore } from "../../store/document-store-types";
import type { NodeKind, Transform, NodeKindText } from "../../types/document";
import type { PreviewRect } from "../shape-tool";

/** Helper to create a minimal ToolEvent at given world coordinates. */
function makeEvent(worldX: number, worldY: number): ToolEvent {
  return {
    worldX,
    worldY,
    screenX: worldX,
    screenY: worldY,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
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
    getSelectedNodeIds: () => [],
    setSelectedNodeIds: () => undefined,
    batchSetTransform: () => undefined,
  };
}

describe("createTextTool", () => {
  describe("getCursor", () => {
    it("should return text cursor", () => {
      const store = makeMockStore();
      const onEditRequest = vi.fn();
      const tool = createTextTool(store, onEditRequest);

      expect(tool.getCursor()).toBe("text");
    });
  });

  describe("click creates auto-width text node", () => {
    it("should create an auto-width text node on click without drag", () => {
      const store = makeMockStore();
      const onEditRequest = vi.fn();
      const tool = createTextTool(store, onEditRequest);

      tool.onPointerDown(makeEvent(50, 100));
      tool.onPointerUp(makeEvent(50, 100));

      expect(store.createNodeCalls).toHaveLength(1);
      const call = store.createNodeCalls[0];
      const kind = call.kind as NodeKindText;
      expect(kind.type).toBe("text");
      expect(kind.content).toBe("");
      expect(kind.sizing).toBe("auto_width");
      expect(call.transform.x).toBe(50);
      expect(call.transform.y).toBe(100);
      expect(call.transform.width).toBe(100); // DEFAULT_AUTO_WIDTH
      expect(call.transform.height).toBe(24); // DEFAULT_HEIGHT
      expect(call.transform.rotation).toBe(0);
      expect(call.transform.scale_x).toBe(1);
      expect(call.transform.scale_y).toBe(1);
    });

    it("should create an auto-width text node on small drag below threshold", () => {
      const store = makeMockStore();
      const onEditRequest = vi.fn();
      const tool = createTextTool(store, onEditRequest);

      tool.onPointerDown(makeEvent(50, 100));
      tool.onPointerMove(makeEvent(51, 101)); // 1px drag, below MIN_DRAG_DIMENSION
      tool.onPointerUp(makeEvent(51, 101));

      expect(store.createNodeCalls).toHaveLength(1);
      const kind = store.createNodeCalls[0].kind as NodeKindText;
      expect(kind.sizing).toBe("auto_width");
      // Position should be at the click start point
      expect(store.createNodeCalls[0].transform.x).toBe(50);
      expect(store.createNodeCalls[0].transform.y).toBe(100);
    });
  });

  describe("drag creates fixed-width text node", () => {
    it("should create a fixed-width text node when dragging beyond threshold", () => {
      const store = makeMockStore();
      const onEditRequest = vi.fn();
      const tool = createTextTool(store, onEditRequest);

      tool.onPointerDown(makeEvent(10, 20));
      tool.onPointerMove(makeEvent(210, 50));
      tool.onPointerUp(makeEvent(210, 50));

      expect(store.createNodeCalls).toHaveLength(1);
      const call = store.createNodeCalls[0];
      const kind = call.kind as NodeKindText;
      expect(kind.type).toBe("text");
      expect(kind.content).toBe("");
      expect(kind.sizing).toBe("fixed_width");
      expect(call.transform.x).toBe(10);
      expect(call.transform.y).toBe(20);
      expect(call.transform.width).toBe(200);
      expect(call.transform.height).toBe(30);
    });

    it("should handle negative drag direction by normalizing coordinates", () => {
      const store = makeMockStore();
      const onEditRequest = vi.fn();
      const tool = createTextTool(store, onEditRequest);

      tool.onPointerDown(makeEvent(200, 100));
      tool.onPointerMove(makeEvent(50, 50));
      tool.onPointerUp(makeEvent(50, 50));

      expect(store.createNodeCalls).toHaveLength(1);
      const call = store.createNodeCalls[0];
      expect(call.transform.x).toBe(50);
      expect(call.transform.y).toBe(50);
      expect(call.transform.width).toBe(150);
      expect(call.transform.height).toBe(50);
    });
  });

  describe("default text style", () => {
    it("should use Inter 16px weight 400 as default text style", () => {
      const store = makeMockStore();
      const onEditRequest = vi.fn();
      const tool = createTextTool(store, onEditRequest);

      tool.onPointerDown(makeEvent(50, 100));
      tool.onPointerUp(makeEvent(50, 100));

      const kind = store.createNodeCalls[0].kind as NodeKindText;
      expect(kind.text_style.font_family).toBe("Inter");
      expect(kind.text_style.font_size).toEqual({ type: "literal", value: 16 });
      expect(kind.text_style.font_weight).toBe(400);
      expect(kind.text_style.font_style).toBe("normal");
      expect(kind.text_style.line_height).toEqual({ type: "literal", value: 1.5 });
      expect(kind.text_style.letter_spacing).toEqual({ type: "literal", value: 0 });
      expect(kind.text_style.text_align).toBe("left");
      expect(kind.text_style.text_decoration).toBe("none");
      expect(kind.text_style.text_color).toEqual({
        type: "literal",
        value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 },
      });
    });
  });

  describe("preview rect during drag", () => {
    it("should return null preview rect before any interaction", () => {
      const store = makeMockStore();
      const tool = createTextTool(store, vi.fn());

      expect(tool.getPreviewRect()).toBeNull();
    });

    it("should provide preview rect during drag", () => {
      const store = makeMockStore();
      const tool = createTextTool(store, vi.fn());

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

    it("should clear preview rect after creation", () => {
      const store = makeMockStore();
      const tool = createTextTool(store, vi.fn());

      tool.onPointerDown(makeEvent(10, 20));
      tool.onPointerMove(makeEvent(60, 80));
      tool.onPointerUp(makeEvent(60, 80));

      expect(tool.getPreviewRect()).toBeNull();
    });
  });

  describe("callbacks", () => {
    it("should call onEditRequest with the created node UUID", () => {
      const store = makeMockStore();
      const onEditRequest = vi.fn();
      const tool = createTextTool(store, onEditRequest);

      tool.onPointerDown(makeEvent(50, 100));
      tool.onPointerUp(makeEvent(50, 100));

      expect(onEditRequest).toHaveBeenCalledTimes(1);
      expect(onEditRequest).toHaveBeenCalledWith("uuid-1");
    });

    // RF-001: onComplete was removed. The text tool no longer switches to
    // "select" immediately -- the overlay manages its own lifecycle.
  });

  describe("auto-select after creation", () => {
    it("should select the newly created node", () => {
      const store = makeMockStore();
      const tool = createTextTool(store, vi.fn());

      tool.onPointerDown(makeEvent(50, 100));
      tool.onPointerUp(makeEvent(50, 100));

      expect(store.selectCalls).toHaveLength(1);
      expect(store.selectCalls[0]).toBe("uuid-1");
    });
  });

  describe("name increments", () => {
    it("should increment the name counter for each created text node", () => {
      const store = makeMockStore();
      const tool = createTextTool(store, vi.fn());

      // First text
      tool.onPointerDown(makeEvent(0, 0));
      tool.onPointerUp(makeEvent(0, 0));

      // Second text
      tool.onPointerDown(makeEvent(100, 100));
      tool.onPointerUp(makeEvent(100, 100));

      expect(store.createNodeCalls).toHaveLength(2);
      expect(store.createNodeCalls[0].name).toBe("Text 1");
      expect(store.createNodeCalls[1].name).toBe("Text 2");
    });
  });

  describe("pointermove without pointerdown", () => {
    it("should not set preview rect when moving without prior pointerdown", () => {
      const store = makeMockStore();
      const tool = createTextTool(store, vi.fn());

      tool.onPointerMove(makeEvent(50, 50));

      expect(tool.getPreviewRect()).toBeNull();
    });
  });

  describe("pointerup without pointerdown", () => {
    it("should not create a node when pointerup fires without prior pointerdown", () => {
      const store = makeMockStore();
      const onEditRequest = vi.fn();
      const tool = createTextTool(store, onEditRequest);

      tool.onPointerUp(makeEvent(50, 50));

      expect(store.createNodeCalls).toHaveLength(0);
      expect(onEditRequest).not.toHaveBeenCalled();
    });
  });

  describe("click always creates a node (unlike shape tool)", () => {
    it("should create a node even on zero-distance click", () => {
      const store = makeMockStore();
      const tool = createTextTool(store, vi.fn());

      tool.onPointerDown(makeEvent(50, 50));
      tool.onPointerUp(makeEvent(50, 50));

      // Text tool always creates — unlike shape tool which requires minimum dimensions
      expect(store.createNodeCalls).toHaveLength(1);
    });
  });
});
