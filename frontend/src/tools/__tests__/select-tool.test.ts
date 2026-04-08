import { describe, it, expect, beforeEach } from "vitest";
import { createSelectTool } from "../select-tool";
import type { ToolEvent } from "../tool-manager";
import type { ToolStore } from "../../store/document-store-types";
import type { DocumentNode, Transform } from "../../types/document";

/** Helper to create a minimal ToolEvent. */
function makeEvent(overrides?: Partial<ToolEvent>): ToolEvent {
  return {
    worldX: 0,
    worldY: 0,
    screenX: 0,
    screenY: 0,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    ...overrides,
  };
}

/** Helper to create a minimal Transform. */
function makeTransform(overrides?: Partial<Transform>): Transform {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    scale_x: 1,
    scale_y: 1,
    ...overrides,
  };
}

/** Helper to create a minimal DocumentNode. */
function makeNode(overrides?: Partial<DocumentNode>): DocumentNode {
  return {
    id: { index: 0, generation: 0 },
    uuid: "node-1",
    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
    name: "Rectangle 1",
    parent: null,
    children: [],
    transform: makeTransform(),
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

/** Helper to create a mock ToolStore with mutable nodes. */
function makeMockStore(initialNodes?: Map<string, DocumentNode>): ToolStore & {
  selectCalls: (string | null)[];
  setTransformCalls: Array<{ uuid: string; transform: Transform }>;
  batchSetTransformCalls: Array<Array<{ uuid: string; transform: Transform }>>;
  setSelectedNodeIdsCalls: string[][];
  nodes: Map<string, DocumentNode>;
} {
  const selectCalls: (string | null)[] = [];
  const setTransformCalls: Array<{ uuid: string; transform: Transform }> = [];
  const batchSetTransformCalls: Array<Array<{ uuid: string; transform: Transform }>> = [];
  const setSelectedNodeIdsCalls: string[][] = [];
  let selectedNodeId: string | null = null;
  let selectedNodeIds: string[] = [];
  const nodes: Map<string, DocumentNode> = initialNodes ?? new Map();

  return {
    selectCalls,
    setTransformCalls,
    batchSetTransformCalls,
    setSelectedNodeIdsCalls,
    nodes,
    getAllNodes: () => nodes,
    setTransform: (uuid: string, transform: Transform) => {
      setTransformCalls.push({ uuid, transform });
    },
    getSelectedNodeId: () => selectedNodeId,
    select: (uuid: string | null) => {
      selectedNodeId = uuid;
      selectCalls.push(uuid);
    },
    createNode: () => "mock-uuid",
    getViewportZoom: () => 1,
    getSelectedNodeIds: () => selectedNodeIds,
    setSelectedNodeIds: (ids: string[]) => {
      selectedNodeIds = ids;
      setSelectedNodeIdsCalls.push([...ids]);
    },
    batchSetTransform: (entries: Array<{ uuid: string; transform: Transform }>) => {
      batchSetTransformCalls.push(entries);
    },
  };
}

describe("createSelectTool", () => {
  let store: ReturnType<typeof makeMockStore>;

  beforeEach(() => {
    store = makeMockStore();
  });

  it("should return a Tool implementation with getPreviewTransforms, getMarqueeRect, and getSnapGuides", () => {
    const tool = createSelectTool(store);
    expect(tool.onPointerDown).toBeTypeOf("function");
    expect(tool.onPointerMove).toBeTypeOf("function");
    expect(tool.onPointerUp).toBeTypeOf("function");
    expect(tool.getCursor).toBeTypeOf("function");
    expect(tool.getPreviewTransforms).toBeTypeOf("function");
    expect(tool.getMarqueeRect).toBeTypeOf("function");
    expect(tool.getSnapGuides).toBeTypeOf("function");
  });

  it("should return 'default' cursor when idle", () => {
    const tool = createSelectTool(store);
    expect(tool.getCursor()).toBe("default");
  });

  it("should return empty preview transforms when idle", () => {
    const tool = createSelectTool(store);
    expect(tool.getPreviewTransforms()).toEqual([]);
  });

  it("should return null marquee rect when idle", () => {
    const tool = createSelectTool(store);
    expect(tool.getMarqueeRect()).toBeNull();
  });

  it("should return empty snap guides when idle", () => {
    const tool = createSelectTool(store);
    expect(tool.getSnapGuides()).toEqual([]);
  });
});

describe("select tool click to select", () => {
  it("should select a node when clicking on it", () => {
    const node = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 10, y: 10, width: 50, height: 50 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 30, worldY: 30 }));

    // RF-014: select() is no longer called — only setSelectedNodeIds
    expect(store.setSelectedNodeIdsCalls).toContainEqual(["rect-1"]);
  });

  it("should deselect when clicking on empty space", () => {
    const node = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 10, y: 10, width: 50, height: 50 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 200, worldY: 200 }));

    expect(store.setSelectedNodeIdsCalls[0]).toEqual([]);
  });

  it("should select the topmost node when multiple nodes overlap", () => {
    const bottomNode = makeNode({
      uuid: "bottom",
      transform: makeTransform({ x: 0, y: 0, width: 100, height: 100 }),
    });
    const topNode = makeNode({
      uuid: "top",
      transform: makeTransform({ x: 0, y: 0, width: 100, height: 100 }),
    });
    // Map insertion order determines z-order; last inserted is on top
    const nodes = new Map([
      ["bottom", bottomNode],
      ["top", topNode],
    ]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 50, worldY: 50 }));

    expect(store.setSelectedNodeIdsCalls[0]).toEqual(["top"]);
  });

  it("should skip invisible nodes during hit testing", () => {
    const invisibleNode = makeNode({
      uuid: "invisible",
      visible: false,
      transform: makeTransform({ x: 0, y: 0, width: 100, height: 100 }),
    });
    const nodes = new Map([["invisible", invisibleNode]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 50, worldY: 50 }));

    expect(store.setSelectedNodeIdsCalls[0]).toEqual([]);
  });

  it("should skip locked nodes during hit testing", () => {
    const lockedNode = makeNode({
      uuid: "locked",
      locked: true,
      transform: makeTransform({ x: 0, y: 0, width: 100, height: 100 }),
    });
    const nodes = new Map([["locked", lockedNode]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 50, worldY: 50 }));

    expect(store.setSelectedNodeIdsCalls[0]).toEqual([]);
  });
});

describe("select tool drag to move (RF-005: single setTransform on pointerUp)", () => {
  it("should not call setTransform during drag (only update preview transforms)", () => {
    const node = makeNode({
      uuid: "rect-1",
      id: { index: 1, generation: 0 },
      transform: makeTransform({ x: 10, y: 20, width: 50, height: 50 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 30, worldY: 40 }));
    tool.onPointerMove(makeEvent({ worldX: 35, worldY: 50 }));

    // RF-005: No setTransform should be called during drag
    expect(store.setTransformCalls).toHaveLength(0);

    // But preview transforms should be available
    const previews = tool.getPreviewTransforms();
    expect(previews).toHaveLength(1);
    expect(previews[0].uuid).toBe("rect-1");
    expect(previews[0].transform.x).toBe(15); // 10 + (35-30)
    expect(previews[0].transform.y).toBe(30); // 20 + (50-40)
  });

  it("should call setTransform with uuid and new transform on pointer up", () => {
    const node = makeNode({
      uuid: "rect-1",
      id: { index: 1, generation: 0 },
      transform: makeTransform({ x: 10, y: 20, width: 50, height: 50 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 30, worldY: 40 }));
    tool.onPointerMove(makeEvent({ worldX: 35, worldY: 50 }));
    tool.onPointerMove(makeEvent({ worldX: 40, worldY: 60 }));
    tool.onPointerUp(makeEvent({ worldX: 40, worldY: 60 }));

    // RF-005: Exactly one setTransform on pointerUp
    expect(store.setTransformCalls).toHaveLength(1);
    const call = store.setTransformCalls[0];
    expect(call.uuid).toBe("rect-1");
    expect(call.transform.x).toBe(20); // 10 + (40-30)
    expect(call.transform.y).toBe(40); // 20 + (60-40)
    expect(call.transform.width).toBe(50);
    expect(call.transform.height).toBe(50);
  });

  it("should not call setTransform when moving without a prior click on a node", () => {
    const store = makeMockStore();
    const tool = createSelectTool(store);

    tool.onPointerMove(makeEvent({ worldX: 100, worldY: 100 }));

    expect(store.setTransformCalls).toHaveLength(0);
  });

  it("should accumulate deltas from the original drag start position", () => {
    const node = makeNode({
      uuid: "rect-1",
      id: { index: 1, generation: 0 },
      transform: makeTransform({ x: 0, y: 0, width: 50, height: 50 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 25, worldY: 25 }));

    // First move
    tool.onPointerMove(makeEvent({ worldX: 30, worldY: 30 }));
    // Second move -- delta should be from the original start, not the last move
    tool.onPointerMove(makeEvent({ worldX: 40, worldY: 45 }));

    const previews = tool.getPreviewTransforms();
    expect(previews).toHaveLength(1);
    expect(previews[0].transform.x).toBe(15); // 0 + (40-25)
    expect(previews[0].transform.y).toBe(20); // 0 + (45-25)
  });

  it("should return 'grabbing' cursor during drag", () => {
    const node = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 0, y: 0, width: 100, height: 100 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 50, worldY: 50 }));

    expect(tool.getCursor()).toBe("grabbing");
  });

  it("should clear drag state and preview on pointer up", () => {
    const node = makeNode({
      uuid: "rect-1",
      id: { index: 1, generation: 0 },
      transform: makeTransform({ x: 0, y: 0, width: 100, height: 100 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 50, worldY: 50 }));
    tool.onPointerMove(makeEvent({ worldX: 60, worldY: 60 }));
    tool.onPointerUp(makeEvent({ worldX: 60, worldY: 60 }));

    expect(tool.getCursor()).toBe("default");
    expect(tool.getPreviewTransforms()).toEqual([]);

    // Further moves should not call setTransform
    tool.onPointerMove(makeEvent({ worldX: 70, worldY: 70 }));
    expect(store.setTransformCalls).toHaveLength(1); // only the one from pointerUp
  });

  it("should enter marquee-selecting (not moving) when clicking on empty space", () => {
    const store = makeMockStore();
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 50, worldY: 50 }));
    tool.onPointerMove(makeEvent({ worldX: 60, worldY: 60 }));

    // Empty space click enters marquee-selecting, not moving
    expect(tool.getCursor()).toBe("crosshair");
    expect(store.setTransformCalls).toHaveLength(0);
  });

  it("should call setTransform even for nodes with placeholder NodeId", () => {
    // With urql, the store uses UUID-based mutations, so placeholder NodeIds
    // no longer block sending. The server resolves the UUID.
    const node = makeNode({
      uuid: "optimistic-1",
      id: { index: 0, generation: 0 },
      transform: makeTransform({ x: 10, y: 10, width: 50, height: 50 }),
    });
    const nodes = new Map([["optimistic-1", node]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 30, worldY: 30 }));
    tool.onPointerMove(makeEvent({ worldX: 40, worldY: 40 }));
    tool.onPointerUp(makeEvent({ worldX: 40, worldY: 40 }));

    // Should send because urql uses UUID-based addressing
    expect(store.setTransformCalls).toHaveLength(1);
    expect(store.setTransformCalls[0].uuid).toBe("optimistic-1");
  });

  it("should not call setTransform on pointer up without a prior move (click only)", () => {
    const node = makeNode({
      uuid: "rect-1",
      id: { index: 1, generation: 0 },
      transform: makeTransform({ x: 0, y: 0, width: 100, height: 100 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 50, worldY: 50 }));
    tool.onPointerUp(makeEvent({ worldX: 50, worldY: 50 }));

    // No move means no preview transform, so no setTransform
    expect(store.setTransformCalls).toHaveLength(0);
  });
});

describe("select tool resize via handles", () => {
  it("should enter resize mode when clicking a handle on the selected node", () => {
    const node = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 100, y: 100, width: 200, height: 150 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    // Pre-select the node so handle hit-test is performed
    store.select("rect-1");
    const tool = createSelectTool(store);

    // Click on the SE corner handle (x + width, y + height) = (300, 250)
    tool.onPointerDown(makeEvent({ worldX: 300, worldY: 250 }));

    // Should show a resize cursor, not grabbing
    const cursorVal = tool.getCursor();
    expect(cursorVal).toContain("resize");
  });

  it("should update preview transforms when dragging a resize handle", () => {
    const node = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 100, y: 100, width: 200, height: 150 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    store.select("rect-1");
    const tool = createSelectTool(store);

    // Click SE handle at (300, 250)
    tool.onPointerDown(makeEvent({ worldX: 300, worldY: 250 }));
    // Drag 20px to the right and 10px down
    tool.onPointerMove(makeEvent({ worldX: 320, worldY: 260, shiftKey: false, altKey: false }));

    const previews = tool.getPreviewTransforms();
    expect(previews).toHaveLength(1);
    expect(previews[0].uuid).toBe("rect-1");
    // SE handle: x and y stay, width grows, height grows
    expect(previews[0].transform.width).toBe(220); // 200 + 20
    expect(previews[0].transform.height).toBe(160); // 150 + 10
    // Origin should not move for SE handle
    expect(previews[0].transform.x).toBe(100);
    expect(previews[0].transform.y).toBe(100);
  });

  it("should commit setTransform on pointer up after resize", () => {
    const node = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 100, y: 100, width: 200, height: 150 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    store.select("rect-1");
    const tool = createSelectTool(store);

    // Click SE handle
    tool.onPointerDown(makeEvent({ worldX: 300, worldY: 250 }));
    tool.onPointerMove(makeEvent({ worldX: 350, worldY: 300, shiftKey: false, altKey: false }));
    tool.onPointerUp(makeEvent({ worldX: 350, worldY: 300 }));

    expect(store.setTransformCalls).toHaveLength(1);
    const call = store.setTransformCalls[0];
    expect(call.uuid).toBe("rect-1");
    expect(call.transform.width).toBe(250); // 200 + 50
    expect(call.transform.height).toBe(200); // 150 + 50
  });

  it("should lock aspect ratio when shift is held during resize (corner handle)", () => {
    const node = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 0, y: 0, width: 200, height: 100 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    store.select("rect-1");
    const tool = createSelectTool(store);

    // Click SE handle at (200, 100)
    tool.onPointerDown(makeEvent({ worldX: 200, worldY: 100 }));
    // Drag with shift held — dominant axis is X (dx=40 > dy=5)
    tool.onPointerMove(makeEvent({ worldX: 240, worldY: 105, shiftKey: true, altKey: false }));

    const previews = tool.getPreviewTransforms();
    expect(previews).toHaveLength(1);
    // Aspect ratio is 2:1. Width grows by 40, so height should grow by 20.
    expect(previews[0].transform.width).toBe(240); // 200 + 40
    expect(previews[0].transform.height).toBe(120); // 100 + 20 (240/2)
  });

  it("should fall through to move when clicking inside node body (not on handle)", () => {
    const node = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 100, y: 100, width: 200, height: 150 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    store.select("rect-1");
    const tool = createSelectTool(store);

    // Click in the center of the node, well away from handles
    tool.onPointerDown(makeEvent({ worldX: 200, worldY: 175 }));

    // Should enter moving state (grabbing cursor)
    expect(tool.getCursor()).toBe("grabbing");

    // Move and verify it moves position, not resizes
    tool.onPointerMove(makeEvent({ worldX: 210, worldY: 185, shiftKey: false, altKey: false }));
    const previews = tool.getPreviewTransforms();
    expect(previews).toHaveLength(1);
    expect(previews[0].transform.x).toBe(110); // 100 + 10
    expect(previews[0].transform.y).toBe(110); // 100 + 10
    // Width and height should not change
    expect(previews[0].transform.width).toBe(200);
    expect(previews[0].transform.height).toBe(150);
  });

  it("should cancel resize and clear state on Escape", () => {
    const node = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 100, y: 100, width: 200, height: 150 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    store.select("rect-1");
    const tool = createSelectTool(store);

    // Start resize
    tool.onPointerDown(makeEvent({ worldX: 300, worldY: 250 }));
    tool.onPointerMove(makeEvent({ worldX: 350, worldY: 300, shiftKey: false, altKey: false }));

    // Escape
    expect(tool.onKeyDown).toBeTypeOf("function");
    if (tool.onKeyDown) {
      tool.onKeyDown("Escape");
    }

    // Should return to idle
    expect(tool.getCursor()).toBe("default");
    expect(tool.getPreviewTransforms()).toEqual([]);
    expect(tool.getSnapGuides()).toEqual([]);

    // Pointer up should not commit anything
    tool.onPointerUp(makeEvent({ worldX: 350, worldY: 300 }));
    expect(store.setTransformCalls).toHaveLength(0);
  });

  it("should show resize cursor when hovering over a handle while idle", () => {
    const node = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 100, y: 100, width: 200, height: 150 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    store.select("rect-1");
    const tool = createSelectTool(store);

    // Move over the E handle at (300, 175)
    tool.onPointerMove(makeEvent({ worldX: 300, worldY: 175, shiftKey: false, altKey: false }));

    expect(tool.getCursor()).toBe("ew-resize");
  });
});

describe("select tool multi-select interactions", () => {
  it("should toggle node into selection on Shift+click", () => {
    const node1 = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 10, y: 10, width: 50, height: 50 }),
    });
    const node2 = makeNode({
      uuid: "rect-2",
      transform: makeTransform({ x: 100, y: 100, width: 50, height: 50 }),
    });
    const nodes = new Map([
      ["rect-1", node1],
      ["rect-2", node2],
    ]);
    const store = makeMockStore(nodes);
    store.setSelectedNodeIds(["rect-1"]);
    const tool = createSelectTool(store);

    // Shift+click on rect-2 should add it to selection
    tool.onPointerDown(makeEvent({ worldX: 120, worldY: 120, shiftKey: true }));

    // Should now have both selected
    const lastCall = store.setSelectedNodeIdsCalls[store.setSelectedNodeIdsCalls.length - 1];
    expect(lastCall).toContain("rect-1");
    expect(lastCall).toContain("rect-2");
  });

  it("should toggle node out of selection on Shift+click when already selected", () => {
    const node1 = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 10, y: 10, width: 50, height: 50 }),
    });
    const node2 = makeNode({
      uuid: "rect-2",
      transform: makeTransform({ x: 100, y: 100, width: 50, height: 50 }),
    });
    const nodes = new Map([
      ["rect-1", node1],
      ["rect-2", node2],
    ]);
    const store = makeMockStore(nodes);
    store.setSelectedNodeIds(["rect-1", "rect-2"]);
    const tool = createSelectTool(store);

    // Shift+click on rect-2 should remove it from selection
    tool.onPointerDown(makeEvent({ worldX: 120, worldY: 120, shiftKey: true }));

    const lastCall = store.setSelectedNodeIdsCalls[store.setSelectedNodeIdsCalls.length - 1];
    expect(lastCall).toEqual(["rect-1"]);
  });

  it("should toggle node into selection on Meta+click (Cmd)", () => {
    const node1 = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 10, y: 10, width: 50, height: 50 }),
    });
    const node2 = makeNode({
      uuid: "rect-2",
      transform: makeTransform({ x: 100, y: 100, width: 50, height: 50 }),
    });
    const nodes = new Map([
      ["rect-1", node1],
      ["rect-2", node2],
    ]);
    const store = makeMockStore(nodes);
    store.setSelectedNodeIds(["rect-1"]);
    const tool = createSelectTool(store);

    // Meta+click on rect-2 should add it to selection
    tool.onPointerDown(makeEvent({ worldX: 120, worldY: 120, metaKey: true }));

    const lastCall = store.setSelectedNodeIdsCalls[store.setSelectedNodeIdsCalls.length - 1];
    expect(lastCall).toContain("rect-1");
    expect(lastCall).toContain("rect-2");
  });

  it("should replace selection when clicking a node not in the current multi-selection", () => {
    const node1 = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 10, y: 10, width: 50, height: 50 }),
    });
    const node2 = makeNode({
      uuid: "rect-2",
      transform: makeTransform({ x: 100, y: 100, width: 50, height: 50 }),
    });
    const node3 = makeNode({
      uuid: "rect-3",
      transform: makeTransform({ x: 200, y: 200, width: 50, height: 50 }),
    });
    const nodes = new Map([
      ["rect-1", node1],
      ["rect-2", node2],
      ["rect-3", node3],
    ]);
    const store = makeMockStore(nodes);
    store.setSelectedNodeIds(["rect-1", "rect-2"]);
    const tool = createSelectTool(store);

    // Click rect-3 (not in selection) without modifiers should replace selection
    tool.onPointerDown(makeEvent({ worldX: 220, worldY: 220 }));

    const lastCall = store.setSelectedNodeIdsCalls[store.setSelectedNodeIdsCalls.length - 1];
    expect(lastCall).toEqual(["rect-3"]);
  });

  it("should keep multi-selection when clicking a node already in multi-selection (to allow multi-move)", () => {
    const node1 = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 10, y: 10, width: 50, height: 50 }),
    });
    const node2 = makeNode({
      uuid: "rect-2",
      transform: makeTransform({ x: 100, y: 100, width: 50, height: 50 }),
    });
    const nodes = new Map([
      ["rect-1", node1],
      ["rect-2", node2],
    ]);
    const store = makeMockStore(nodes);
    store.setSelectedNodeIds(["rect-1", "rect-2"]);
    const tool = createSelectTool(store);

    // Click rect-1 (already in selection) — should enter multi-move, not replace
    tool.onPointerDown(makeEvent({ worldX: 30, worldY: 30 }));

    // Should be in moving state (grabbing cursor) with both nodes
    expect(tool.getCursor()).toBe("grabbing");
  });

  it("should clear selection when clicking on empty space without modifier", () => {
    const node = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 10, y: 10, width: 50, height: 50 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    store.setSelectedNodeIds(["rect-1"]);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 200, worldY: 200 }));

    const lastCall = store.setSelectedNodeIdsCalls[store.setSelectedNodeIdsCalls.length - 1];
    expect(lastCall).toEqual([]);
  });
});

describe("select tool marquee selection", () => {
  it("should enter marquee-selecting state when clicking empty space", () => {
    const node = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 100, y: 100, width: 50, height: 50 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 0, worldY: 0 }));

    // Should be in marquee state — cursor should reflect crosshair
    expect(tool.getCursor()).toBe("crosshair");
  });

  it("should update marquee rect during drag", () => {
    const store = makeMockStore();
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 10, worldY: 20 }));
    tool.onPointerMove(makeEvent({ worldX: 50, worldY: 60 }));

    const rect = tool.getMarqueeRect();
    expect(rect).not.toBeNull();
    expect(rect?.x).toBe(10);
    expect(rect?.y).toBe(20);
    expect(rect?.width).toBe(40);
    expect(rect?.height).toBe(40);
  });

  it("should select intersecting nodes on pointerUp", () => {
    const node1 = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 20, y: 20, width: 30, height: 30 }),
    });
    const node2 = makeNode({
      uuid: "rect-2",
      transform: makeTransform({ x: 200, y: 200, width: 30, height: 30 }),
    });
    const nodes = new Map([
      ["rect-1", node1],
      ["rect-2", node2],
    ]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    // Marquee from (0,0) to (100,100) — should capture rect-1 but not rect-2
    tool.onPointerDown(makeEvent({ worldX: 0, worldY: 0 }));
    tool.onPointerMove(makeEvent({ worldX: 100, worldY: 100 }));
    tool.onPointerUp(makeEvent({ worldX: 100, worldY: 100 }));

    const lastCall = store.setSelectedNodeIdsCalls[store.setSelectedNodeIdsCalls.length - 1];
    expect(lastCall).toContain("rect-1");
    expect(lastCall).not.toContain("rect-2");
  });

  it("should add to existing selection with Shift+marquee", () => {
    const node1 = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 20, y: 20, width: 30, height: 30 }),
    });
    const node2 = makeNode({
      uuid: "rect-2",
      transform: makeTransform({ x: 200, y: 200, width: 30, height: 30 }),
    });
    const nodes = new Map([
      ["rect-1", node1],
      ["rect-2", node2],
    ]);
    const store = makeMockStore(nodes);
    // Pre-select rect-2
    store.setSelectedNodeIds(["rect-2"]);
    // Clear recorded calls so we only see the new one
    store.setSelectedNodeIdsCalls.length = 0;
    const tool = createSelectTool(store);

    // Shift+marquee from (0,0) to (100,100) — should add rect-1 to selection
    tool.onPointerDown(makeEvent({ worldX: 0, worldY: 0, shiftKey: true }));
    tool.onPointerMove(makeEvent({ worldX: 100, worldY: 100, shiftKey: true }));
    tool.onPointerUp(makeEvent({ worldX: 100, worldY: 100, shiftKey: true }));

    const lastCall = store.setSelectedNodeIdsCalls[store.setSelectedNodeIdsCalls.length - 1];
    expect(lastCall).toContain("rect-1");
    expect(lastCall).toContain("rect-2");
  });

  it("should cancel marquee and return to idle on Escape", () => {
    const store = makeMockStore();
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 10, worldY: 20 }));
    tool.onPointerMove(makeEvent({ worldX: 50, worldY: 60 }));

    expect(tool.getMarqueeRect()).not.toBeNull();

    if (tool.onKeyDown) {
      tool.onKeyDown("Escape");
    }

    expect(tool.getMarqueeRect()).toBeNull();
    expect(tool.getCursor()).toBe("default");
  });

  it("should clear marquee rect after pointerUp", () => {
    const store = makeMockStore();
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 10, worldY: 20 }));
    tool.onPointerMove(makeEvent({ worldX: 50, worldY: 60 }));
    tool.onPointerUp(makeEvent({ worldX: 50, worldY: 60 }));

    expect(tool.getMarqueeRect()).toBeNull();
  });

  it("should not select invisible or locked nodes during marquee", () => {
    const invisibleNode = makeNode({
      uuid: "invisible",
      visible: false,
      transform: makeTransform({ x: 20, y: 20, width: 30, height: 30 }),
    });
    const lockedNode = makeNode({
      uuid: "locked",
      locked: true,
      transform: makeTransform({ x: 40, y: 40, width: 30, height: 30 }),
    });
    const visibleNode = makeNode({
      uuid: "visible",
      transform: makeTransform({ x: 60, y: 60, width: 30, height: 30 }),
    });
    const nodes = new Map([
      ["invisible", invisibleNode],
      ["locked", lockedNode],
      ["visible", visibleNode],
    ]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    // Marquee captures all three node areas
    tool.onPointerDown(makeEvent({ worldX: 0, worldY: 0 }));
    tool.onPointerMove(makeEvent({ worldX: 200, worldY: 200 }));
    tool.onPointerUp(makeEvent({ worldX: 200, worldY: 200 }));

    const lastCall = store.setSelectedNodeIdsCalls[store.setSelectedNodeIdsCalls.length - 1];
    expect(lastCall).toEqual(["visible"]);
  });
});

describe("select tool multi-move", () => {
  it("should move all selected nodes by the same delta and call batchSetTransform", () => {
    const node1 = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 10, y: 20, width: 50, height: 50 }),
    });
    const node2 = makeNode({
      uuid: "rect-2",
      transform: makeTransform({ x: 100, y: 100, width: 60, height: 40 }),
    });
    const nodes = new Map([
      ["rect-1", node1],
      ["rect-2", node2],
    ]);
    const store = makeMockStore(nodes);
    store.setSelectedNodeIds(["rect-1", "rect-2"]);
    const tool = createSelectTool(store);

    // Click on rect-1 body to start moving (without modifiers, so it would
    // normally replace selection — but since we click a node that is already
    // selected, it should enter multi-move)
    tool.onPointerDown(makeEvent({ worldX: 30, worldY: 40 }));
    tool.onPointerMove(makeEvent({ worldX: 40, worldY: 50 }));

    // Preview should have 2 entries
    const previews = tool.getPreviewTransforms();
    expect(previews).toHaveLength(2);

    // Commit
    tool.onPointerUp(makeEvent({ worldX: 40, worldY: 50 }));

    expect(store.batchSetTransformCalls).toHaveLength(1);
    const batch = store.batchSetTransformCalls[0];
    expect(batch).toHaveLength(2);

    const r1 = batch.find((e) => e.uuid === "rect-1");
    const r2 = batch.find((e) => e.uuid === "rect-2");
    expect(r1?.transform.x).toBe(20); // 10 + 10
    expect(r1?.transform.y).toBe(30); // 20 + 10
    expect(r2?.transform.x).toBe(110); // 100 + 10
    expect(r2?.transform.y).toBe(110); // 100 + 10
  });

  it("should not use batchSetTransform for single node move", () => {
    const node = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 10, y: 20, width: 50, height: 50 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 30, worldY: 40 }));
    tool.onPointerMove(makeEvent({ worldX: 40, worldY: 50 }));
    tool.onPointerUp(makeEvent({ worldX: 40, worldY: 50 }));

    // Single node uses setTransform, not batchSetTransform
    expect(store.setTransformCalls).toHaveLength(1);
    expect(store.batchSetTransformCalls).toHaveLength(0);
  });
});

describe("select tool multi-resize", () => {
  it("should proportionally resize all selected nodes via compound bounds", () => {
    const node1 = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 0, y: 0, width: 100, height: 100 }),
    });
    const node2 = makeNode({
      uuid: "rect-2",
      transform: makeTransform({ x: 100, y: 0, width: 100, height: 100 }),
    });
    const nodes = new Map([
      ["rect-1", node1],
      ["rect-2", node2],
    ]);
    const store = makeMockStore(nodes);
    store.setSelectedNodeIds(["rect-1", "rect-2"]);
    // Need to set the selected node id to one of them for handle hit test
    store.select("rect-1");
    const tool = createSelectTool(store);

    // Compound bounds: x=0, y=0, w=200, h=100
    // SE handle at (200, 100)
    tool.onPointerDown(makeEvent({ worldX: 200, worldY: 100 }));
    tool.onPointerMove(makeEvent({ worldX: 250, worldY: 100, shiftKey: false, altKey: false }));

    // Preview should have 2 entries
    const previews = tool.getPreviewTransforms();
    expect(previews).toHaveLength(2);

    // Commit
    tool.onPointerUp(makeEvent({ worldX: 250, worldY: 100 }));

    expect(store.batchSetTransformCalls).toHaveLength(1);
    const batch = store.batchSetTransformCalls[0];
    expect(batch).toHaveLength(2);
  });
});
