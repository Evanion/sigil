import { describe, it, expect, beforeEach } from "vitest";
import { createSelectTool } from "../select-tool";
import type { ToolEvent } from "../tool-manager";
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

/** Helper to create a mock DocumentStore with mutable nodes. */
function makeMockStore(initialNodes?: Map<string, DocumentNode>): DocumentStore & {
  selectCalls: (string | null)[];
  sendCommandCalls: SerializableCommand[];
  nodes: Map<string, DocumentNode>;
} {
  const selectCalls: (string | null)[] = [];
  const sendCommandCalls: SerializableCommand[] = [];
  let selectedNodeId: string | null = null;
  const nodes: Map<string, DocumentNode> = initialNodes ?? new Map();

  return {
    selectCalls,
    sendCommandCalls,
    nodes,
    getInfo: () => null,
    getAllNodes: () => nodes,
    getNodeByUuid: (uuid: string) => nodes.get(uuid),
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
  let store: ReturnType<typeof makeMockStore>;

  beforeEach(() => {
    store = makeMockStore();
  });

  it("should return a Tool implementation with getPreviewTransform", () => {
    const tool = createSelectTool(store);
    expect(tool.onPointerDown).toBeTypeOf("function");
    expect(tool.onPointerMove).toBeTypeOf("function");
    expect(tool.onPointerUp).toBeTypeOf("function");
    expect(tool.getCursor).toBeTypeOf("function");
    expect(tool.getPreviewTransform).toBeTypeOf("function");
  });

  it("should return 'default' cursor when idle", () => {
    const tool = createSelectTool(store);
    expect(tool.getCursor()).toBe("default");
  });

  it("should return null preview transform when idle", () => {
    const tool = createSelectTool(store);
    expect(tool.getPreviewTransform()).toBeNull();
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

describe("select tool drag to move (RF-005: single command on pointerUp)", () => {
  it("should not send commands during drag (only update preview transform)", () => {
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

    // RF-005: No command should be sent during drag
    expect(store.sendCommandCalls).toHaveLength(0);

    // But preview transform should be available
    const preview = tool.getPreviewTransform();
    expect(preview).not.toBeNull();
    expect(preview?.uuid).toBe("rect-1");
    expect(preview?.transform.x).toBe(15); // 10 + (35-30)
    expect(preview?.transform.y).toBe(30); // 20 + (50-40)
  });

  it("should send a single set_transform command on pointer up", () => {
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

    // RF-005: Exactly one command on pointerUp
    expect(store.sendCommandCalls).toHaveLength(1);
    const cmd = store.sendCommandCalls[0];
    expect(cmd.type).toBe("set_transform");
    if (cmd.type === "set_transform") {
      expect(cmd.node_id).toEqual({ index: 1, generation: 0 });
      expect(cmd.new_transform.x).toBe(20); // 10 + (40-30)
      expect(cmd.new_transform.y).toBe(40); // 20 + (60-40)
      expect(cmd.new_transform.width).toBe(50);
      expect(cmd.new_transform.height).toBe(50);
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

    const preview = tool.getPreviewTransform();
    expect(preview?.transform.x).toBe(15); // 0 + (40-25)
    expect(preview?.transform.y).toBe(20); // 0 + (45-25)
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
    expect(tool.getPreviewTransform()).toBeNull();

    // Further moves should not send commands
    tool.onPointerMove(makeEvent({ worldX: 70, worldY: 70 }));
    expect(store.sendCommandCalls).toHaveLength(1); // only the one from pointerUp
  });

  it("should not start drag when clicking on empty space", () => {
    const store = makeMockStore();
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 50, worldY: 50 }));
    tool.onPointerMove(makeEvent({ worldX: 60, worldY: 60 }));

    expect(tool.getCursor()).toBe("default");
    expect(store.sendCommandCalls).toHaveLength(0);
  });

  it("should not send command on pointer up if node still has placeholder NodeId", () => {
    // RF-002: Node with placeholder {0,0} means server hasn't assigned a real ID yet
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

    // Should not send because the node has a placeholder NodeId
    expect(store.sendCommandCalls).toHaveLength(0);
  });

  it("should send command using latest NodeId from store after server assigns it", () => {
    // RF-002: The store's node gets updated by node_created, so the tool
    // should read the latest id from the store when sending.
    const node = makeNode({
      uuid: "rect-1",
      id: { index: 0, generation: 0 }, // placeholder initially
      transform: makeTransform({ x: 10, y: 20, width: 50, height: 50 }),
    });
    const nodes = new Map([["rect-1", node]]);
    const store = makeMockStore(nodes);
    const tool = createSelectTool(store);

    tool.onPointerDown(makeEvent({ worldX: 30, worldY: 40 }));
    tool.onPointerMove(makeEvent({ worldX: 35, worldY: 50 }));

    // Simulate server assigning a real NodeId (store update)
    nodes.set("rect-1", { ...node, id: { index: 42, generation: 7 } });

    tool.onPointerUp(makeEvent({ worldX: 35, worldY: 50 }));

    expect(store.sendCommandCalls).toHaveLength(1);
    const cmd = store.sendCommandCalls[0];
    if (cmd.type === "set_transform") {
      expect(cmd.node_id).toEqual({ index: 42, generation: 7 });
    }
  });

  it("should not send command on pointer up without a prior move (click only)", () => {
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

    // No move means no preview transform, so no command
    expect(store.sendCommandCalls).toHaveLength(0);
  });
});
