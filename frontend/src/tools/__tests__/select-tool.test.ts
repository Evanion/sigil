import { describe, it, expect, beforeEach } from "vitest";
import { createSelectTool } from "../select-tool";
import type { Tool, ToolEvent } from "../tool-manager";
import type { DocumentStore } from "../../store/document-store";
import type { DocumentNode, Transform } from "../../types/document";
import type { SerializableCommand } from "../../types/commands";

/** Helper to create a minimal ToolEvent. */
function makeEvent(overrides?: Partial<ToolEvent>): ToolEvent {
  return {
    worldX: 0,
    worldY: 0,
    screenX: 0,
    screenY: 0,
    shiftKey: false,
    altKey: false,
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

/** Helper to create a mock DocumentStore. */
function makeMockStore(nodes?: ReadonlyMap<string, DocumentNode>): DocumentStore & {
  selectCalls: (string | null)[];
  sendCommandCalls: SerializableCommand[];
} {
  const selectCalls: (string | null)[] = [];
  const sendCommandCalls: SerializableCommand[] = [];
  let selectedNodeId: string | null = null;

  return {
    selectCalls,
    sendCommandCalls,
    getInfo: () => null,
    getAllNodes: () => nodes ?? new Map(),
    getNodeByUuid: (uuid: string) => nodes?.get(uuid),
    getPages: () => [],
    isConnected: () => true,
    canUndo: () => false,
    canRedo: () => false,
    sendCommand: (cmd: SerializableCommand) => {
      sendCommandCalls.push(cmd);
    },
    undo: () => {},
    redo: () => {},
    getSelectedNodeId: () => selectedNodeId,
    select: (uuid: string | null) => {
      selectedNodeId = uuid;
      selectCalls.push(uuid);
    },
    getActivePage: () => undefined,
    createNode: () => "mock-uuid",
    subscribe: () => () => {},
    loadInitialState: () => Promise.resolve(),
    destroy: () => {},
  };
}

describe("createSelectTool", () => {
  let tool: Tool;
  let store: ReturnType<typeof makeMockStore>;

  beforeEach(() => {
    store = makeMockStore();
    tool = createSelectTool(store);
  });

  it("should return a Tool implementation", () => {
    expect(tool.onPointerDown).toBeTypeOf("function");
    expect(tool.onPointerMove).toBeTypeOf("function");
    expect(tool.onPointerUp).toBeTypeOf("function");
    expect(tool.getCursor).toBeTypeOf("function");
  });

  it("should return 'default' cursor when idle", () => {
    expect(tool.getCursor()).toBe("default");
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

    expect(store.selectCalls).toContain("rect-1");
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

    expect(store.selectCalls).toContain(null);
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

    expect(store.selectCalls[0]).toBe("top");
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

    expect(store.selectCalls).toContain(null);
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

    expect(store.selectCalls).toContain(null);
  });
});

describe("select tool drag to move", () => {
  it("should send set_transform command when dragging a selected node", () => {
    const node = makeNode({
      uuid: "rect-1",
      id: { index: 1, generation: 0 },
      transform: makeTransform({ x: 10, y: 20, width: 50, height: 50 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    // Click on the node to start drag
    tool.onPointerDown(makeEvent({ worldX: 30, worldY: 40 }));

    // Drag by (5, 10) in world space
    tool.onPointerMove(makeEvent({ worldX: 35, worldY: 50 }));

    expect(store.sendCommandCalls).toHaveLength(1);
    const cmd = store.sendCommandCalls[0];
    expect(cmd.type).toBe("set_transform");
    if (cmd.type === "set_transform") {
      expect(cmd.node_id).toEqual({ index: 1, generation: 0 });
      expect(cmd.new_transform.x).toBe(15); // 10 + (35-30)
      expect(cmd.new_transform.y).toBe(30); // 20 + (50-40)
      // Width/height/rotation/scale should be preserved
      expect(cmd.new_transform.width).toBe(50);
      expect(cmd.new_transform.height).toBe(50);
      expect(cmd.new_transform.rotation).toBe(0);
      expect(cmd.old_transform).toEqual(node.transform);
    }
  });

  it("should not send commands when moving without a prior click on a node", () => {
    const store = makeMockStore();
    const tool = createSelectTool(store);

    tool.onPointerMove(makeEvent({ worldX: 100, worldY: 100 }));

    expect(store.sendCommandCalls).toHaveLength(0);
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
    // Second move — delta should be from the original start, not the last move
    tool.onPointerMove(makeEvent({ worldX: 40, worldY: 45 }));

    expect(store.sendCommandCalls).toHaveLength(2);
    const cmd2 = store.sendCommandCalls[1];
    if (cmd2.type === "set_transform") {
      expect(cmd2.new_transform.x).toBe(15); // 0 + (40-25)
      expect(cmd2.new_transform.y).toBe(20); // 0 + (45-25)
    }
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

  it("should clear drag state on pointer up", () => {
    const node = makeNode({
      uuid: "rect-1",
      transform: makeTransform({ x: 0, y: 0, width: 100, height: 100 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 50, worldY: 50 }));
    tool.onPointerUp(makeEvent({ worldX: 60, worldY: 60 }));

    expect(tool.getCursor()).toBe("default");

    // Further moves should not send commands
    tool.onPointerMove(makeEvent({ worldX: 70, worldY: 70 }));
    expect(store.sendCommandCalls).toHaveLength(0);
  });

  it("should not start drag when clicking on empty space", () => {
    const store = makeMockStore();
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 50, worldY: 50 }));
    tool.onPointerMove(makeEvent({ worldX: 60, worldY: 60 }));

    expect(tool.getCursor()).toBe("default");
    expect(store.sendCommandCalls).toHaveLength(0);
  });
});
