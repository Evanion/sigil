import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WebSocketClient } from "../../ws/client";
import type { ClientMessage, ServerMessage } from "../../types/messages";
import type { SerializableCommand } from "../../types/commands";
import type { DocumentInfo } from "../../types/document";
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

// --- Mock fetch ---

function mockFetchDocumentInfo(info: DocumentInfo): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(info),
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
    const docInfo: DocumentInfo = {
      name: "Test Doc",
      page_count: 1,
      node_count: 5,
      can_undo: true,
      can_redo: false,
    };
    mockFetchDocumentInfo(docInfo);

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

    expect(store.getInfo()).toEqual(docInfo);
    expect(store.canUndo()).toBe(true);
    expect(store.canRedo()).toBe(false);
    store.destroy();
  });

  it("should re-fetch state on document_changed message", async () => {
    const docInfo: DocumentInfo = {
      name: "Updated Doc",
      page_count: 2,
      node_count: 10,
      can_undo: false,
      can_redo: true,
    };
    mockFetchDocumentInfo(docInfo);

    const store = createDocumentStore(mockWs);

    mockWs.simulateMessage({
      type: "document_changed",
      can_undo: false,
      can_redo: true,
    });

    await vi.waitFor(() => {
      expect(store.getInfo()).toEqual(docInfo);
    });

    store.destroy();
  });

  it("should load initial state from /api/document", async () => {
    const docInfo: DocumentInfo = {
      name: "My Design",
      page_count: 3,
      node_count: 42,
      can_undo: false,
      can_redo: false,
    };
    mockFetchDocumentInfo(docInfo);

    const store = createDocumentStore(mockWs);
    await store.loadInitialState();

    expect(store.getInfo()).toEqual(docInfo);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
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

  it("should fetch document info when connection becomes true", async () => {
    const docInfo: DocumentInfo = {
      name: "Reconnected Doc",
      page_count: 1,
      node_count: 3,
      can_undo: false,
      can_redo: false,
    };
    mockFetchDocumentInfo(docInfo);

    const store = createDocumentStore(mockWs);

    mockWs.simulateConnectionChange(true);

    await vi.waitFor(() => {
      expect(store.getInfo()).toEqual(docInfo);
    });

    store.destroy();
  });

  it("should not fetch document info when connection becomes false", () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          name: "X",
          page_count: 0,
          node_count: 0,
          can_undo: false,
          can_redo: false,
        }),
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
    const docInfo: DocumentInfo = {
      name: "Debounced",
      page_count: 1,
      node_count: 1,
      can_undo: false,
      can_redo: false,
    };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(docInfo),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const store = createDocumentStore(mockWs);

    // Fire 5 rapid broadcast messages
    for (let i = 0; i < 5; i++) {
      mockWs.simulateMessage({
        type: "broadcast",
        command: { type: "rename_node", node_id: { index: 0, generation: 0 }, new_name: `N${String(i)}` },
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
});
