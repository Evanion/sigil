import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWebSocketClient } from "../client";
import type { ClientMessage, ServerMessage } from "../../types/messages";

// --- MockWebSocket ---

type MockWSListener = (event: { data: string }) => void;
type MockWSCloseListener = (event: { code: number; reason: string }) => void;
type MockWSVoidListener = () => void;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readonly url: string;
  readyState: number = MockWebSocket.CONNECTING;

  onopen: MockWSVoidListener | null = null;
  onmessage: MockWSListener | null = null;
  onclose: MockWSCloseListener | null = null;
  onerror: MockWSVoidListener | null = null;

  sentMessages: string[] = [];

  constructor(url: string | URL) {
    this.url = typeof url === "string" ? url : url.toString();
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: _code ?? 1000, reason: _reason ?? "" });
    }
  }

  // Test helpers

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen();
    }
  }

  simulateMessage(data: ServerMessage): void {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  simulateClose(code = 1000, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror();
    }
  }

  static instances: MockWebSocket[] = [];
  static reset(): void {
    MockWebSocket.instances = [];
  }
  static latest(): MockWebSocket {
    const inst = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    if (!inst) {
      throw new Error("No MockWebSocket instances created");
    }
    return inst;
  }
}

// --- Test suite ---

describe("WebSocketClient", () => {
  const TEST_URL = "ws://localhost:4680/ws";

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.reset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as Record<string, any>).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should connect to the given URL on creation", () => {
    const client = createWebSocketClient(TEST_URL);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.latest().url).toBe(TEST_URL);
    client.close();
  });

  it("should send JSON-serialized messages when connected", () => {
    const client = createWebSocketClient(TEST_URL);
    const ws = MockWebSocket.latest();
    ws.simulateOpen();

    const msg: ClientMessage = { type: "undo" };
    client.send(msg);

    expect(ws.sentMessages).toHaveLength(1);
    const sent = ws.sentMessages[0];
    expect(sent).toBeDefined();
    expect(JSON.parse(sent as string)).toEqual({ type: "undo" });
    client.close();
  });

  it("should not send messages when not connected", () => {
    const client = createWebSocketClient(TEST_URL);
    // WebSocket is still CONNECTING, not OPEN
    const msg: ClientMessage = { type: "undo" };
    client.send(msg);

    expect(MockWebSocket.latest().sentMessages).toHaveLength(0);
    client.close();
  });

  it("should notify message handlers when a message is received", () => {
    const client = createWebSocketClient(TEST_URL);
    const ws = MockWebSocket.latest();
    ws.simulateOpen();

    const handler = vi.fn();
    client.onMessage(handler);

    const serverMsg: ServerMessage = {
      type: "undo_redo_state",
      can_undo: true,
      can_redo: false,
    };
    ws.simulateMessage(serverMsg);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(serverMsg);
    client.close();
  });

  it("should notify multiple message handlers", () => {
    const client = createWebSocketClient(TEST_URL);
    const ws = MockWebSocket.latest();
    ws.simulateOpen();

    const handler1 = vi.fn();
    const handler2 = vi.fn();
    client.onMessage(handler1);
    client.onMessage(handler2);

    const serverMsg: ServerMessage = { type: "document_changed" };
    ws.simulateMessage(serverMsg);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
    client.close();
  });

  it("should notify connection change handlers on open", () => {
    const client = createWebSocketClient(TEST_URL);
    const ws = MockWebSocket.latest();

    const handler = vi.fn();
    client.onConnectionChange(handler);

    ws.simulateOpen();

    expect(handler).toHaveBeenCalledWith(true);
    client.close();
  });

  it("should notify connection change handlers on close", () => {
    const client = createWebSocketClient(TEST_URL);
    const ws = MockWebSocket.latest();

    const handler = vi.fn();
    client.onConnectionChange(handler);

    ws.simulateOpen();
    handler.mockClear();

    ws.simulateClose();

    expect(handler).toHaveBeenCalledWith(false);
    client.close();
  });

  it("should return an unsubscribe function from onMessage", () => {
    const client = createWebSocketClient(TEST_URL);
    const ws = MockWebSocket.latest();
    ws.simulateOpen();

    const handler = vi.fn();
    const unsubscribe = client.onMessage(handler);

    const serverMsg: ServerMessage = { type: "document_changed" };
    ws.simulateMessage(serverMsg);
    expect(handler).toHaveBeenCalledOnce();

    unsubscribe();
    ws.simulateMessage(serverMsg);
    expect(handler).toHaveBeenCalledOnce(); // not called again
    client.close();
  });

  it("should return an unsubscribe function from onConnectionChange", () => {
    const client = createWebSocketClient(TEST_URL);
    const ws = MockWebSocket.latest();

    const handler = vi.fn();
    const unsubscribe = client.onConnectionChange(handler);

    ws.simulateOpen();
    expect(handler).toHaveBeenCalledOnce();

    unsubscribe();
    ws.simulateClose();
    expect(handler).toHaveBeenCalledOnce(); // not called again
    client.close();
  });

  it("should report connected status via isConnected", () => {
    const client = createWebSocketClient(TEST_URL);
    const ws = MockWebSocket.latest();

    expect(client.isConnected()).toBe(false);

    ws.simulateOpen();
    expect(client.isConnected()).toBe(true);

    ws.simulateClose();
    expect(client.isConnected()).toBe(false);
    client.close();
  });

  it("should auto-reconnect with exponential backoff after unexpected close", () => {
    const client = createWebSocketClient(TEST_URL);
    const ws1 = MockWebSocket.latest();
    ws1.simulateOpen();

    // Simulate unexpected close (not user-initiated)
    ws1.simulateClose(1006, "abnormal");

    expect(MockWebSocket.instances).toHaveLength(1);

    // Advance past the initial backoff (2000ms)
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(2);

    // Second connection also fails
    const ws2 = MockWebSocket.latest();
    ws2.simulateClose(1006, "abnormal");

    // Next backoff is 4000ms (doubled)
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(2); // not yet
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(3);

    client.close();
  });

  it("should cap reconnect backoff at 30 seconds", () => {
    const client = createWebSocketClient(TEST_URL);

    // Simulate many failures to push backoff past max
    for (let i = 0; i < 10; i++) {
      const ws = MockWebSocket.latest();
      ws.simulateOpen();
      ws.simulateClose(1006, "abnormal");
      vi.advanceTimersByTime(30_000);
    }

    // After many failures, backoff should be capped at 30s
    const wsBeforeLast = MockWebSocket.instances.length;
    const lastWs = MockWebSocket.latest();
    lastWs.simulateOpen();
    lastWs.simulateClose(1006, "abnormal");

    // At exactly 30s, should reconnect (not more)
    vi.advanceTimersByTime(30_000);
    expect(MockWebSocket.instances.length).toBe(wsBeforeLast + 1);

    client.close();
  });

  it("should reset backoff after a successful connection", () => {
    const client = createWebSocketClient(TEST_URL);

    // First failure
    const ws1 = MockWebSocket.latest();
    ws1.simulateOpen();
    ws1.simulateClose(1006, "abnormal");
    vi.advanceTimersByTime(2000); // initial backoff

    // Second attempt succeeds and stays open, then fails
    const ws2 = MockWebSocket.latest();
    ws2.simulateOpen(); // This should reset backoff
    ws2.simulateClose(1006, "abnormal");

    // Backoff should be reset to initial (2000ms), not 4000ms
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(3);

    client.close();
  });

  it("should not reconnect after close() is called", () => {
    const client = createWebSocketClient(TEST_URL);
    const ws = MockWebSocket.latest();
    ws.simulateOpen();

    client.close();

    vi.advanceTimersByTime(60_000);
    // Only the original instance should exist
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("should not reconnect on normal close (code 1000)", () => {
    const client = createWebSocketClient(TEST_URL);
    const ws = MockWebSocket.latest();
    ws.simulateOpen();

    ws.simulateClose(1000, "normal");

    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    client.close();
  });
});
