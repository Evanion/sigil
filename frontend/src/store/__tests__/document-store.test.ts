import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WebSocketClient } from "../../ws/client";
import type { ClientMessage, ServerMessage } from "../../types/messages";
import type { SerializableCommand } from "../../types/commands";
import type {
  DocumentInfo,
  FullDocumentResponse,
  NodeKind,
  SerializedNode,
  Transform,
} from "../../types/document";
import { createDocumentStore } from "../document-store";

// --- Mock WebSocket client ---

type MessageHandler = (message: ServerMessage) => void;
type ConnectionHandler = (connected: boolean) => void;

function createMockWebSocketClient(): WebSocketClient & {
  sentMessages: ClientMessage[];
  simulateMessage: (msg: ServerMessage) => void;
  simulateConnectionChange: (connected: boolean) => void;
} {
  const messageHandlers = new Set<MessageHandler>();
  const connectionHandlers = new Set<ConnectionHandler>();
  const sentMessages: ClientMessage[] = [];

  return {
    sentMessages,

    send(message: ClientMessage): void {
      sentMessages.push(message);
    },

    onMessage(handler: MessageHandler): () => void {
      messageHandlers.add(handler);
      return () => {
        messageHandlers.delete(handler);
      };
    },

    onConnectionChange(handler: ConnectionHandler): () => void {
      connectionHandlers.add(handler);
      return () => {
        connectionHandlers.delete(handler);
      };
    },

    isConnected(): boolean {
      return false;
    },

    close(): void {
      messageHandlers.clear();
      connectionHandlers.clear();
    },

    simulateMessage(msg: ServerMessage): void {
      for (const handler of messageHandlers) {
        handler(msg);
      }
    },

    simulateConnectionChange(connected: boolean): void {
      for (const handler of connectionHandlers) {
        handler(connected);
      }
    },
  };
}

// --- Helpers ---

const DEFAULT_STYLE = {
  fills: [],
  strokes: [],
  opacity: { type: "literal" as const, value: 1 },
  blend_mode: "normal" as const,
  effects: [],
};

const DEFAULT_CONSTRAINTS = {
  horizontal: "start" as const,
  vertical: "start" as const,
};

function makeSerializedNode(overrides: Partial<SerializedNode> & { id: string }): SerializedNode {
  return {
    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
    name: "Node",
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
    style: DEFAULT_STYLE,
    constraints: DEFAULT_CONSTRAINTS,
    grid_placement: null,
    visible: true,
    locked: false,
    ...overrides,
  };
}

function makeFullDocumentResponse(
  info: DocumentInfo,
  pages: FullDocumentResponse["pages"] = [],
): FullDocumentResponse {
  return { info, pages };
}

const DEFAULT_INFO: DocumentInfo = {
  name: "Test Doc",
  page_count: 1,
  node_count: 0,
  can_undo: false,
  can_redo: false,
};

// --- Mock fetch ---

function mockFetchFullDocument(response: FullDocumentResponse): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    }),
  );
}

function mockFetchFailure(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }),
  );
}

// --- Tests ---

describe("DocumentStore", () => {
  let mockWs: ReturnType<typeof createMockWebSocketClient>;

  beforeEach(() => {
    mockWs = createMockWebSocketClient();
    vi.restoreAllMocks();
  });

  it("should start with null document info", () => {
    const store = createDocumentStore(mockWs);
    expect(store.getInfo()).toBeNull();
    expect(store.getAllNodes().size).toBe(0);
    expect(store.getPages()).toEqual([]);
    store.destroy();
  });

  it("should report initial canUndo and canRedo as false", () => {
    const store = createDocumentStore(mockWs);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    store.destroy();
  });

  it("should send undo command via WebSocket", () => {
    const store = createDocumentStore(mockWs);
    store.undo();
    expect(mockWs.sentMessages).toHaveLength(1);
    expect(mockWs.sentMessages[0]).toEqual({ type: "undo" });
    store.destroy();
  });

  it("should send redo command via WebSocket", () => {
    const store = createDocumentStore(mockWs);
    store.redo();
    expect(mockWs.sentMessages).toHaveLength(1);
    expect(mockWs.sentMessages[0]).toEqual({ type: "redo" });
    store.destroy();
  });

  it("should send command via WebSocket", () => {
    const store = createDocumentStore(mockWs);
    const cmd: SerializableCommand = {
      type: "rename_node",
      node_id: { index: 0, generation: 0 },
      new_name: "NewName",
      old_name: "OldName",
    };
    store.sendCommand(cmd);

    expect(mockWs.sentMessages).toHaveLength(1);
    expect(mockWs.sentMessages[0]).toEqual({
      type: "command",
      command: cmd,
    });
    store.destroy();
  });

  it("should notify subscribers on connection change", () => {
    const store = createDocumentStore(mockWs);
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    mockWs.simulateConnectionChange(true);

    expect(subscriber).toHaveBeenCalledOnce();
    store.destroy();
  });

  it("should report connection status", () => {
    const store = createDocumentStore(mockWs);
    expect(store.isConnected()).toBe(false);
    store.destroy();
  });

  it("should update canUndo and canRedo on undo_redo message", () => {
    const store = createDocumentStore(mockWs);

    mockWs.simulateMessage({
      type: "undo_redo",
      can_undo: true,
      can_redo: false,
    });

    expect(store.canUndo()).toBe(true);
    expect(store.canRedo()).toBe(false);
    store.destroy();
  });

  it("should notify subscribers on undo_redo message", () => {
    const store = createDocumentStore(mockWs);
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    mockWs.simulateMessage({
      type: "undo_redo",
      can_undo: true,
      can_redo: true,
    });

    expect(subscriber).toHaveBeenCalledOnce();
    store.destroy();
  });

  it("should update canUndo and canRedo on document_changed message", () => {
    const store = createDocumentStore(mockWs);

    mockWs.simulateMessage({
      type: "document_changed",
      can_undo: false,
      can_redo: true,
    });

    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(true);
    store.destroy();
  });

  it("should re-fetch state on broadcast message", async () => {
    const fullResponse = makeFullDocumentResponse({
      ...DEFAULT_INFO,
      name: "Test Doc",
      node_count: 5,
      can_undo: true,
    });
    mockFetchFullDocument(fullResponse);

    const store = createDocumentStore(mockWs);
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    mockWs.simulateMessage({
      type: "broadcast",
      command: { type: "rename_node", node_id: { index: 0, generation: 0 }, new_name: "Foo" },
    });

    // Wait for the async fetch to complete
    await vi.waitFor(() => {
      expect(subscriber).toHaveBeenCalled();
    });

    expect(store.getInfo()).toEqual(fullResponse.info);
    expect(store.canUndo()).toBe(true);
    expect(store.canRedo()).toBe(false);
    store.destroy();
  });

  it("should re-fetch state on document_changed message", async () => {
    const fullResponse = makeFullDocumentResponse({
      ...DEFAULT_INFO,
      name: "Updated Doc",
      page_count: 2,
      node_count: 10,
      can_redo: true,
    });
    mockFetchFullDocument(fullResponse);

    const store = createDocumentStore(mockWs);

    mockWs.simulateMessage({
      type: "document_changed",
      can_undo: false,
      can_redo: true,
    });

    await vi.waitFor(() => {
      expect(store.getInfo()).toEqual(fullResponse.info);
    });

    store.destroy();
  });

  it("should load initial state from /api/document/full", async () => {
    const fullResponse = makeFullDocumentResponse(
      { ...DEFAULT_INFO, name: "My Design", page_count: 1, node_count: 1 },
      [
        {
          id: "page-1",
          name: "Home",
          nodes: [makeSerializedNode({ id: "node-1", name: "Rect 1" })],
          transitions: [],
        },
      ],
    );
    mockFetchFullDocument(fullResponse);

    const store = createDocumentStore(mockWs);
    await store.loadInitialState();

    expect(store.getInfo()).toEqual(fullResponse.info);
    expect(store.getPages()).toHaveLength(1);
    expect(store.getPages()[0]).toEqual({
      id: "page-1",
      name: "Home",
      root_nodes: [],
    });
    expect(store.getAllNodes().size).toBe(1);
    expect(store.getNodeByUuid("node-1")).toBeDefined();
    expect(store.getNodeByUuid("node-1")?.name).toBe("Rect 1");
    store.destroy();
  });

  it("should populate nodes from multiple pages", async () => {
    const fullResponse = makeFullDocumentResponse(
      { ...DEFAULT_INFO, page_count: 2, node_count: 3 },
      [
        {
          id: "page-1",
          name: "Page 1",
          nodes: [
            makeSerializedNode({ id: "node-a", name: "A" }),
            makeSerializedNode({ id: "node-b", name: "B" }),
          ],
          transitions: [],
        },
        {
          id: "page-2",
          name: "Page 2",
          nodes: [makeSerializedNode({ id: "node-c", name: "C" })],
          transitions: [],
        },
      ],
    );
    mockFetchFullDocument(fullResponse);

    const store = createDocumentStore(mockWs);
    await store.loadInitialState();

    expect(store.getAllNodes().size).toBe(3);
    expect(store.getNodeByUuid("node-a")?.name).toBe("A");
    expect(store.getNodeByUuid("node-b")?.name).toBe("B");
    expect(store.getNodeByUuid("node-c")?.name).toBe("C");
    expect(store.getPages()).toHaveLength(2);
    store.destroy();
  });

  it("should handle loadInitialState fetch failure gracefully", async () => {
    mockFetchFailure();

    const store = createDocumentStore(mockWs);
    // Should not throw
    await store.loadInitialState();

    expect(store.getInfo()).toBeNull();
    store.destroy();
  });

  it("should allow unsubscribing from notifications", () => {
    const store = createDocumentStore(mockWs);
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);

    mockWs.simulateMessage({
      type: "undo_redo",
      can_undo: true,
      can_redo: true,
    });
    expect(subscriber).toHaveBeenCalledOnce();

    unsubscribe();

    mockWs.simulateMessage({
      type: "undo_redo",
      can_undo: false,
      can_redo: false,
    });
    // Should not have been called again
    expect(subscriber).toHaveBeenCalledOnce();
    store.destroy();
  });

  it("should clean up subscriptions on destroy", () => {
    const store = createDocumentStore(mockWs);
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    store.destroy();

    // After destroy, messages should not trigger subscribers
    mockWs.simulateMessage({
      type: "undo_redo",
      can_undo: true,
      can_redo: true,
    });
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("should return node by uuid after loading state", () => {
    const store = createDocumentStore(mockWs);
    // Initially no nodes
    expect(store.getNodeByUuid("some-uuid")).toBeUndefined();
    store.destroy();
  });

  it("should fetch full document when connection becomes true", async () => {
    const fullResponse = makeFullDocumentResponse({
      ...DEFAULT_INFO,
      name: "Reconnected Doc",
      node_count: 3,
    });
    mockFetchFullDocument(fullResponse);

    const store = createDocumentStore(mockWs);

    mockWs.simulateConnectionChange(true);

    await vi.waitFor(() => {
      expect(store.getInfo()).toEqual(fullResponse.info);
    });

    store.destroy();
  });

  it("should not fetch document when connection becomes false", () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          makeFullDocumentResponse({
            ...DEFAULT_INFO,
            name: "X",
          }),
        ),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const store = createDocumentStore(mockWs);

    mockWs.simulateConnectionChange(false);

    // fetch should not have been called for a disconnect event
    expect(fetchSpy).not.toHaveBeenCalled();
    store.destroy();
  });

  it("should debounce rapid broadcast messages into a single fetch", async () => {
    vi.useFakeTimers();
    const fullResponse = makeFullDocumentResponse({
      ...DEFAULT_INFO,
      name: "Debounced",
    });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fullResponse),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const store = createDocumentStore(mockWs);

    // Fire 5 rapid broadcast messages
    for (let i = 0; i < 5; i++) {
      mockWs.simulateMessage({
        type: "broadcast",
        command: {
          type: "rename_node",
          node_id: { index: 0, generation: 0 },
          new_name: `N${String(i)}`,
        },
      });
    }

    // Before debounce fires, fetch should not have been called
    expect(fetchSpy).not.toHaveBeenCalled();

    // Advance timers past the 100ms debounce
    await vi.advanceTimersByTimeAsync(150);

    // Only one fetch should have been triggered
    expect(fetchSpy).toHaveBeenCalledOnce();

    vi.useRealTimers();
    store.destroy();
  });

  it("should return a ReadonlyMap from getAllNodes", () => {
    const store = createDocumentStore(mockWs);
    const nodesMap = store.getAllNodes();
    // ReadonlyMap should not have set/delete/clear at the type level,
    // but at runtime the underlying Map is returned. Verify it is a Map instance.
    expect(nodesMap).toBeInstanceOf(Map);
    expect(nodesMap.size).toBe(0);
    store.destroy();
  });

  // --- Selection tests ---

  it("should start with no selection", () => {
    const store = createDocumentStore(mockWs);
    expect(store.getSelectedNodeId()).toBeNull();
    store.destroy();
  });

  it("should update selection when calling select", () => {
    const store = createDocumentStore(mockWs);
    store.select("node-123");
    expect(store.getSelectedNodeId()).toBe("node-123");
    store.destroy();
  });

  it("should clear selection when passing null to select", () => {
    const store = createDocumentStore(mockWs);
    store.select("node-123");
    store.select(null);
    expect(store.getSelectedNodeId()).toBeNull();
    store.destroy();
  });

  it("should notify subscribers when selection changes", () => {
    const store = createDocumentStore(mockWs);
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    store.select("node-abc");
    expect(subscriber).toHaveBeenCalledOnce();

    store.select(null);
    expect(subscriber).toHaveBeenCalledTimes(2);
    store.destroy();
  });

  it("should not notify subscribers when selecting the same node", () => {
    const store = createDocumentStore(mockWs);
    store.select("node-abc");

    const subscriber = vi.fn();
    store.subscribe(subscriber);

    store.select("node-abc");
    expect(subscriber).not.toHaveBeenCalled();
    store.destroy();
  });

  // --- createNode tests ---

  it("should send create_node_request via WebSocket when calling createNode", () => {
    const store = createDocumentStore(mockWs);

    const kind: NodeKind = { type: "rectangle", corner_radii: [0, 0, 0, 0] };
    const transform: Transform = {
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
    };

    const uuid = store.createNode(kind, "Rectangle 1", transform);

    expect(typeof uuid).toBe("string");
    expect(uuid.length).toBeGreaterThan(0);

    expect(mockWs.sentMessages).toHaveLength(1);
    const msg = mockWs.sentMessages[0];
    expect(msg).toEqual({
      type: "create_node_request",
      uuid,
      kind,
      name: "Rectangle 1",
      page_id: null,
      transform,
    });
    store.destroy();
  });

  it("should include active page id in create_node_request when pages exist", async () => {
    const fullResponse = makeFullDocumentResponse({ ...DEFAULT_INFO, page_count: 1 }, [
      { id: "page-xyz", name: "Home", nodes: [], transitions: [] },
    ]);
    mockFetchFullDocument(fullResponse);

    const store = createDocumentStore(mockWs);
    await store.loadInitialState();

    const kind: NodeKind = { type: "frame", layout: null };
    const transform: Transform = {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
    };

    store.createNode(kind, "Frame 1", transform);

    expect(mockWs.sentMessages).toHaveLength(1);
    const msg = mockWs.sentMessages[0];
    expect(msg).toHaveProperty("type", "create_node_request");
    if (msg.type === "create_node_request") {
      expect(msg.page_id).toBe("page-xyz");
    }
    store.destroy();
  });

  // --- RF-001: Optimistic insert tests ---

  it("should optimistically insert node into store on createNode", () => {
    const store = createDocumentStore(mockWs);

    const kind: NodeKind = { type: "rectangle", corner_radii: [0, 0, 0, 0] };
    const transform: Transform = {
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
    };

    const uuid = store.createNode(kind, "Rectangle 1", transform);

    // Node should be immediately available in the store
    const node = store.getNodeByUuid(uuid);
    expect(node).toBeDefined();
    expect(node?.uuid).toBe(uuid);
    expect(node?.kind).toEqual(kind);
    expect(node?.name).toBe("Rectangle 1");
    expect(node?.transform).toEqual(transform);
    // Placeholder NodeId
    expect(node?.id).toEqual({ index: 0, generation: 0 });
    store.destroy();
  });

  it("should notify subscribers when optimistic node is inserted", () => {
    const store = createDocumentStore(mockWs);
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    const kind: NodeKind = { type: "rectangle", corner_radii: [0, 0, 0, 0] };
    const transform: Transform = {
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
    };

    store.createNode(kind, "Rect", transform);

    expect(subscriber).toHaveBeenCalledOnce();
    store.destroy();
  });

  it("should update optimistic node with real NodeId on node_created", () => {
    const store = createDocumentStore(mockWs);

    const kind: NodeKind = { type: "rectangle", corner_radii: [0, 0, 0, 0] };
    const transform: Transform = {
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
    };

    const uuid = store.createNode(kind, "Rect", transform);

    // Verify placeholder id
    expect(store.getNodeByUuid(uuid)?.id).toEqual({ index: 0, generation: 0 });

    // Simulate server response
    mockWs.simulateMessage({
      type: "node_created",
      uuid,
      node_id: { index: 5, generation: 3 },
    });

    // Now the node should have the real id
    expect(store.getNodeByUuid(uuid)?.id).toEqual({ index: 5, generation: 3 });
    store.destroy();
  });

  // --- getActivePage tests ---

  it("should return undefined for getActivePage when no pages are loaded", () => {
    const store = createDocumentStore(mockWs);
    expect(store.getActivePage()).toBeUndefined();
    store.destroy();
  });

  it("should return the first page as the active page", async () => {
    const fullResponse = makeFullDocumentResponse({ ...DEFAULT_INFO, page_count: 2 }, [
      { id: "page-1", name: "First Page", nodes: [], transitions: [] },
      { id: "page-2", name: "Second Page", nodes: [], transitions: [] },
    ]);
    mockFetchFullDocument(fullResponse);

    const store = createDocumentStore(mockWs);
    await store.loadInitialState();

    const activePage = store.getActivePage();
    expect(activePage).toBeDefined();
    expect(activePage?.id).toBe("page-1");
    expect(activePage?.name).toBe("First Page");
    store.destroy();
  });

  // --- node_created server message ---

  it("should update node id when receiving node_created message", async () => {
    const fullResponse = makeFullDocumentResponse({ ...DEFAULT_INFO, node_count: 1 }, [
      {
        id: "page-1",
        name: "Home",
        nodes: [makeSerializedNode({ id: "node-uuid-1", name: "Rect" })],
        transitions: [],
      },
    ]);
    mockFetchFullDocument(fullResponse);

    const store = createDocumentStore(mockWs);
    await store.loadInitialState();

    // Verify node has placeholder id
    const nodeBefore = store.getNodeByUuid("node-uuid-1");
    expect(nodeBefore?.id).toEqual({ index: 0, generation: 0 });

    // Simulate server sending the real NodeId
    mockWs.simulateMessage({
      type: "node_created",
      uuid: "node-uuid-1",
      node_id: { index: 42, generation: 7 },
    });

    const nodeAfter = store.getNodeByUuid("node-uuid-1");
    expect(nodeAfter?.id).toEqual({ index: 42, generation: 7 });
    store.destroy();
  });

  it("should notify subscribers when node_created message is received for existing node", async () => {
    const fullResponse = makeFullDocumentResponse({ ...DEFAULT_INFO, node_count: 1 }, [
      {
        id: "page-1",
        name: "Home",
        nodes: [makeSerializedNode({ id: "node-uuid-1", name: "Rect" })],
        transitions: [],
      },
    ]);
    mockFetchFullDocument(fullResponse);

    const store = createDocumentStore(mockWs);
    await store.loadInitialState();

    const subscriber = vi.fn();
    store.subscribe(subscriber);

    mockWs.simulateMessage({
      type: "node_created",
      uuid: "node-uuid-1",
      node_id: { index: 1, generation: 1 },
    });

    expect(subscriber).toHaveBeenCalledOnce();
    store.destroy();
  });

  it("should ignore node_created message for unknown uuid", () => {
    const store = createDocumentStore(mockWs);
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    mockWs.simulateMessage({
      type: "node_created",
      uuid: "nonexistent-uuid",
      node_id: { index: 1, generation: 1 },
    });

    // Should not notify because nothing changed
    expect(subscriber).not.toHaveBeenCalled();
    store.destroy();
  });

  // --- Defensive JSON parsing ---

  it("should handle malformed JSON from /api/document/full gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error("Invalid JSON")),
      }),
    );

    const store = createDocumentStore(mockWs);
    await store.loadInitialState();

    expect(store.getInfo()).toBeNull();
    store.destroy();
  });

  it("should handle unexpected response shape from /api/document/full gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ unexpected: "shape" }),
      }),
    );

    const store = createDocumentStore(mockWs);
    await store.loadInitialState();

    expect(store.getInfo()).toBeNull();
    store.destroy();
  });
});
