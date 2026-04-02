import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Client } from "urql";
import type { DocumentNode, NodeKind, Transform } from "../../types/document";
import { createDocumentStore } from "../document-store";

// ── urql mock client ─────────────────────────────────────────────────

/** Callback type matching urql's subscription subscribe handler. */
type SubscriptionHandler = (result: { data: unknown }) => void;

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  mutation: ReturnType<typeof vi.fn>;
  subscription: ReturnType<typeof vi.fn>;
  /** Simulate a subscription event being delivered. */
  simulateSubscriptionEvent: (data: unknown) => void;
}

function createMockClient(): MockClient {
  let subscriptionHandler: SubscriptionHandler | null = null;

  const mockClient: MockClient = {
    simulateSubscriptionEvent: (data: unknown) => {
      if (subscriptionHandler) {
        subscriptionHandler({ data });
      }
    },
    query: vi.fn().mockReturnValue({
      toPromise: () => Promise.resolve({ data: null }),
    }),
    mutation: vi.fn().mockReturnValue({
      toPromise: () => Promise.resolve({ data: null }),
    }),
    subscription: vi.fn().mockReturnValue({
      subscribe: (handler: SubscriptionHandler) => {
        subscriptionHandler = handler;
        return { unsubscribe: vi.fn() };
      },
    }),
  };

  return mockClient;
}

/** Cast mock client to urql Client for the store constructor. */
function asClient(mock: MockClient): Client {
  return mock as unknown as Client;
}

// ── Helpers ──────────────────────────────────────────────────────────

const DEFAULT_STYLE = {
  fills: [],
  strokes: [],
  opacity: { type: "literal" as const, value: 1 },
  blend_mode: "normal" as const,
  effects: [],
};

function makeGqlNode(
  overrides: Partial<{
    uuid: string;
    name: string;
    kind: NodeKind;
    parent: string | null;
    children: readonly string[];
    transform: Transform;
    style: DocumentNode["style"];
    visible: boolean;
    locked: boolean;
  }> & { uuid: string },
): Record<string, unknown> {
  return {
    uuid: overrides.uuid,
    name: overrides.name ?? "Node",
    kind: overrides.kind ?? { type: "rectangle", corner_radii: [0, 0, 0, 0] },
    parent: overrides.parent ?? null,
    children: overrides.children ?? [],
    transform: overrides.transform ?? {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
    },
    style: overrides.style ?? DEFAULT_STYLE,
    visible: overrides.visible ?? true,
    locked: overrides.locked ?? false,
  };
}

function makePagesQueryData(
  pages: Array<{
    id: string;
    name: string;
    nodes: Array<Record<string, unknown>>;
  }>,
): { pages: typeof pages } {
  return { pages };
}

function mockQueryReturning(mock: MockClient, data: unknown): void {
  mock.query.mockReturnValue({
    toPromise: () => Promise.resolve({ data }),
  });
}

function mockMutationReturning(mock: MockClient, data: unknown): void {
  mock.mutation.mockReturnValue({
    toPromise: () => Promise.resolve({ data }),
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("DocumentStore", () => {
  let mockClient: MockClient;

  beforeEach(() => {
    mockClient = createMockClient();
    vi.restoreAllMocks();
  });

  it("should start with null document info", () => {
    const store = createDocumentStore(asClient(mockClient));
    expect(store.getInfo()).toBeNull();
    expect(store.getAllNodes().size).toBe(0);
    expect(store.getPages()).toEqual([]);
    store.destroy();
  });

  it("should report initial canUndo and canRedo as false", () => {
    const store = createDocumentStore(asClient(mockClient));
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    store.destroy();
  });

  it("should call undo mutation via urql", () => {
    const store = createDocumentStore(asClient(mockClient));
    store.undo();
    expect(mockClient.mutation).toHaveBeenCalledWith(expect.stringContaining("mutation Undo"), {});
    store.destroy();
  });

  it("should call redo mutation via urql", () => {
    const store = createDocumentStore(asClient(mockClient));
    store.redo();
    expect(mockClient.mutation).toHaveBeenCalledWith(expect.stringContaining("mutation Redo"), {});
    store.destroy();
  });

  it("should call setTransform mutation via urql", () => {
    const store = createDocumentStore(asClient(mockClient));
    const transform: Transform = {
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
    };
    store.setTransform("node-1", transform);
    expect(mockClient.mutation).toHaveBeenCalledWith(
      expect.stringContaining("mutation SetTransform"),
      { uuid: "node-1", transform },
    );
    store.destroy();
  });

  it("should call renameNode mutation via urql", () => {
    const store = createDocumentStore(asClient(mockClient));
    store.renameNode("node-1", "NewName");
    expect(mockClient.mutation).toHaveBeenCalledWith(
      expect.stringContaining("mutation RenameNode"),
      { uuid: "node-1", newName: "NewName" },
    );
    store.destroy();
  });

  it("should call deleteNode mutation via urql", () => {
    const store = createDocumentStore(asClient(mockClient));
    store.deleteNode("node-1");
    expect(mockClient.mutation).toHaveBeenCalledWith(
      expect.stringContaining("mutation DeleteNode"),
      { uuid: "node-1" },
    );
    store.destroy();
  });

  it("should call setVisible mutation via urql", () => {
    const store = createDocumentStore(asClient(mockClient));
    store.setVisible("node-1", false);
    expect(mockClient.mutation).toHaveBeenCalledWith(
      expect.stringContaining("mutation SetVisible"),
      { uuid: "node-1", visible: false },
    );
    store.destroy();
  });

  it("should call setLocked mutation via urql", () => {
    const store = createDocumentStore(asClient(mockClient));
    store.setLocked("node-1", true);
    expect(mockClient.mutation).toHaveBeenCalledWith(
      expect.stringContaining("mutation SetLocked"),
      { uuid: "node-1", locked: true },
    );
    store.destroy();
  });

  it("should report connection status as false initially", () => {
    const store = createDocumentStore(asClient(mockClient));
    expect(store.isConnected()).toBe(false);
    store.destroy();
  });

  it("should report connected after subscription receives first event", async () => {
    const pagesData = makePagesQueryData([]);
    mockQueryReturning(mockClient, pagesData);

    const store = createDocumentStore(asClient(mockClient));
    await store.loadInitialState();

    expect(store.isConnected()).toBe(false);

    // Simulate subscription delivering an event
    mockClient.simulateSubscriptionEvent({
      documentChanged: {
        eventType: "node_updated",
        uuid: "some-uuid",
        data: null,
        senderId: null,
      },
    });

    expect(store.isConnected()).toBe(true);
    store.destroy();
  });

  it("should load initial state via pages query", async () => {
    const pagesData = makePagesQueryData([
      {
        id: "page-1",
        name: "Home",
        nodes: [makeGqlNode({ uuid: "node-1", name: "Rect 1" })],
      },
    ]);
    mockQueryReturning(mockClient, pagesData);

    const store = createDocumentStore(asClient(mockClient));
    await store.loadInitialState();

    expect(store.getInfo()).not.toBeNull();
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
    const pagesData = makePagesQueryData([
      {
        id: "page-1",
        name: "Page 1",
        nodes: [
          makeGqlNode({ uuid: "node-a", name: "A" }),
          makeGqlNode({ uuid: "node-b", name: "B" }),
        ],
      },
      {
        id: "page-2",
        name: "Page 2",
        nodes: [makeGqlNode({ uuid: "node-c", name: "C" })],
      },
    ]);
    mockQueryReturning(mockClient, pagesData);

    const store = createDocumentStore(asClient(mockClient));
    await store.loadInitialState();

    expect(store.getAllNodes().size).toBe(3);
    expect(store.getNodeByUuid("node-a")?.name).toBe("A");
    expect(store.getNodeByUuid("node-b")?.name).toBe("B");
    expect(store.getNodeByUuid("node-c")?.name).toBe("C");
    expect(store.getPages()).toHaveLength(2);
    store.destroy();
  });

  it("should handle loadInitialState query failure gracefully", async () => {
    // Query returns null data (error case)
    const store = createDocumentStore(asClient(mockClient));
    await store.loadInitialState();

    expect(store.getInfo()).toBeNull();
    store.destroy();
  });

  it("should handle loadInitialState with unexpected data shape gracefully", async () => {
    mockQueryReturning(mockClient, { unexpected: "shape" });

    const store = createDocumentStore(asClient(mockClient));
    await store.loadInitialState();

    expect(store.getInfo()).toBeNull();
    store.destroy();
  });

  it("should allow unsubscribing from notifications", async () => {
    const pagesData = makePagesQueryData([]);
    mockQueryReturning(mockClient, pagesData);

    const store = createDocumentStore(asClient(mockClient));
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);

    // Trigger a change
    store.select("node-123");
    expect(subscriber).toHaveBeenCalledOnce();

    unsubscribe();

    store.select("node-456");
    // Should not have been called again
    expect(subscriber).toHaveBeenCalledOnce();
    store.destroy();
  });

  it("should clean up subscriptions on destroy", async () => {
    const store = createDocumentStore(asClient(mockClient));
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    store.destroy();

    // After destroy, state changes should not trigger subscribers
    // (select would normally notify, but destroy clears subscribers)
    store.select("node-123");
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("should return node by uuid after loading state", () => {
    const store = createDocumentStore(asClient(mockClient));
    // Initially no nodes
    expect(store.getNodeByUuid("some-uuid")).toBeUndefined();
    store.destroy();
  });

  it("should re-fetch pages on subscription event", async () => {
    vi.useFakeTimers();

    const pagesData = makePagesQueryData([{ id: "page-1", name: "Home", nodes: [] }]);
    mockQueryReturning(mockClient, pagesData);

    const store = createDocumentStore(asClient(mockClient));
    await store.loadInitialState();

    // Reset query mock to track re-fetch
    mockClient.query.mockClear();
    mockQueryReturning(mockClient, pagesData);

    // Simulate subscription event
    mockClient.simulateSubscriptionEvent({
      documentChanged: {
        eventType: "node_updated",
        uuid: "some-uuid",
        data: null,
        senderId: null,
      },
    });

    // Advance past debounce timer
    await vi.advanceTimersByTimeAsync(150);

    expect(mockClient.query).toHaveBeenCalledOnce();

    vi.useRealTimers();
    store.destroy();
  });

  it("should debounce rapid subscription events into a single re-fetch", async () => {
    vi.useFakeTimers();

    const pagesData = makePagesQueryData([]);
    mockQueryReturning(mockClient, pagesData);

    const store = createDocumentStore(asClient(mockClient));
    await store.loadInitialState();

    mockClient.query.mockClear();
    mockQueryReturning(mockClient, pagesData);

    // Fire 5 rapid subscription events
    for (let i = 0; i < 5; i++) {
      mockClient.simulateSubscriptionEvent({
        documentChanged: {
          eventType: "node_updated",
          uuid: `uuid-${String(i)}`,
          data: null,
          senderId: null,
        },
      });
    }

    // Before debounce fires, query should not have been called
    expect(mockClient.query).not.toHaveBeenCalled();

    // Advance timers past the 100ms debounce
    await vi.advanceTimersByTimeAsync(150);

    // Only one query should have been triggered
    expect(mockClient.query).toHaveBeenCalledOnce();

    vi.useRealTimers();
    store.destroy();
  });

  it("should return a ReadonlyMap from getAllNodes", () => {
    const store = createDocumentStore(asClient(mockClient));
    const nodesMap = store.getAllNodes();
    expect(nodesMap).toBeInstanceOf(Map);
    expect(nodesMap.size).toBe(0);
    store.destroy();
  });

  // --- Selection tests ---

  it("should start with no selection", () => {
    const store = createDocumentStore(asClient(mockClient));
    expect(store.getSelectedNodeId()).toBeNull();
    store.destroy();
  });

  it("should update selection when calling select", () => {
    const store = createDocumentStore(asClient(mockClient));
    store.select("node-123");
    expect(store.getSelectedNodeId()).toBe("node-123");
    store.destroy();
  });

  it("should clear selection when passing null to select", () => {
    const store = createDocumentStore(asClient(mockClient));
    store.select("node-123");
    store.select(null);
    expect(store.getSelectedNodeId()).toBeNull();
    store.destroy();
  });

  it("should notify subscribers when selection changes", () => {
    const store = createDocumentStore(asClient(mockClient));
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    store.select("node-abc");
    expect(subscriber).toHaveBeenCalledOnce();

    store.select(null);
    expect(subscriber).toHaveBeenCalledTimes(2);
    store.destroy();
  });

  it("should not notify subscribers when selecting the same node", () => {
    const store = createDocumentStore(asClient(mockClient));
    store.select("node-abc");

    const subscriber = vi.fn();
    store.subscribe(subscriber);

    store.select("node-abc");
    expect(subscriber).not.toHaveBeenCalled();
    store.destroy();
  });

  // --- createNode tests ---

  it("should call create node mutation via urql when calling createNode", () => {
    const store = createDocumentStore(asClient(mockClient));

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

    expect(mockClient.mutation).toHaveBeenCalledWith(
      expect.stringContaining("mutation CreateNode"),
      {
        kind,
        name: "Rectangle 1",
        pageId: null,
        transform,
      },
    );
    store.destroy();
  });

  it("should include active page id in create node mutation when pages exist", async () => {
    const pagesData = makePagesQueryData([{ id: "page-xyz", name: "Home", nodes: [] }]);
    mockQueryReturning(mockClient, pagesData);

    const store = createDocumentStore(asClient(mockClient));
    await store.loadInitialState();

    // Reset mock to track createNode mutation
    mockClient.mutation.mockClear();
    mockMutationReturning(mockClient, null);

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

    expect(mockClient.mutation).toHaveBeenCalledWith(
      expect.stringContaining("mutation CreateNode"),
      expect.objectContaining({ pageId: "page-xyz" }),
    );
    store.destroy();
  });

  // --- Optimistic insert tests ---

  it("should optimistically insert node into store on createNode", () => {
    const store = createDocumentStore(asClient(mockClient));

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
    const store = createDocumentStore(asClient(mockClient));
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

  it("should update optimistic node with server data on mutation result", async () => {
    const serverNode = makeGqlNode({
      uuid: "server-uuid",
      name: "Server Rect",
    });

    // Set up mutation to return server data
    mockClient.mutation.mockReturnValue({
      toPromise: () =>
        Promise.resolve({
          data: { createNode: { uuid: "server-uuid", node: serverNode } },
        }),
    });

    const store = createDocumentStore(asClient(mockClient));

    // We need to mock crypto.randomUUID to control the UUID
    const originalRandomUUID = crypto.randomUUID;
    crypto.randomUUID = () => "server-uuid" as ReturnType<typeof crypto.randomUUID>;

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
    expect(uuid).toBe("server-uuid");

    // Wait for mutation to resolve
    await vi.waitFor(() => {
      expect(store.getNodeByUuid("server-uuid")?.name).toBe("Server Rect");
    });

    crypto.randomUUID = originalRandomUUID;
    store.destroy();
  });

  // --- getActivePage tests ---

  it("should return undefined for getActivePage when no pages are loaded", () => {
    const store = createDocumentStore(asClient(mockClient));
    expect(store.getActivePage()).toBeUndefined();
    store.destroy();
  });

  it("should return the first page as the active page", async () => {
    const pagesData = makePagesQueryData([
      { id: "page-1", name: "First Page", nodes: [] },
      { id: "page-2", name: "Second Page", nodes: [] },
    ]);
    mockQueryReturning(mockClient, pagesData);

    const store = createDocumentStore(asClient(mockClient));
    await store.loadInitialState();

    const activePage = store.getActivePage();
    expect(activePage).toBeDefined();
    expect(activePage?.id).toBe("page-1");
    expect(activePage?.name).toBe("First Page");
    store.destroy();
  });

  // --- Undo/Redo result handling ---

  it("should update canUndo and canRedo from undo mutation result", async () => {
    mockClient.mutation.mockReturnValue({
      toPromise: () =>
        Promise.resolve({
          data: { undo: { canUndo: false, canRedo: true } },
        }),
    });
    // Also mock query for the re-fetch after undo
    mockQueryReturning(mockClient, makePagesQueryData([]));

    const store = createDocumentStore(asClient(mockClient));
    store.undo();

    await vi.waitFor(() => {
      expect(store.canRedo()).toBe(true);
    });
    expect(store.canUndo()).toBe(false);
    store.destroy();
  });

  it("should update canUndo and canRedo from redo mutation result", async () => {
    mockClient.mutation.mockReturnValue({
      toPromise: () =>
        Promise.resolve({
          data: { redo: { canUndo: true, canRedo: false } },
        }),
    });
    mockQueryReturning(mockClient, makePagesQueryData([]));

    const store = createDocumentStore(asClient(mockClient));
    store.redo();

    await vi.waitFor(() => {
      expect(store.canUndo()).toBe(true);
    });
    expect(store.canRedo()).toBe(false);
    store.destroy();
  });

  // --- Defensive parsing ---

  it("should handle query rejection gracefully", async () => {
    mockClient.query.mockReturnValue({
      toPromise: () => Promise.reject(new Error("Network failure")),
    });

    const store = createDocumentStore(asClient(mockClient));
    await store.loadInitialState();

    expect(store.getInfo()).toBeNull();
    store.destroy();
  });

  it("should start subscription on loadInitialState", async () => {
    const pagesData = makePagesQueryData([]);
    mockQueryReturning(mockClient, pagesData);

    const store = createDocumentStore(asClient(mockClient));
    await store.loadInitialState();

    expect(mockClient.subscription).toHaveBeenCalledOnce();
    store.destroy();
  });

  it("should ignore subscription events with unexpected shape", async () => {
    vi.useFakeTimers();

    const pagesData = makePagesQueryData([]);
    mockQueryReturning(mockClient, pagesData);

    const store = createDocumentStore(asClient(mockClient));
    await store.loadInitialState();

    mockClient.query.mockClear();
    mockQueryReturning(mockClient, pagesData);

    // Send a subscription event with unexpected shape
    mockClient.simulateSubscriptionEvent({ unexpected: "shape" });

    // Advance past debounce timer
    await vi.advanceTimersByTimeAsync(150);

    // Should NOT have re-fetched pages because the event shape was invalid
    expect(mockClient.query).not.toHaveBeenCalled();

    vi.useRealTimers();
    store.destroy();
  });
});
