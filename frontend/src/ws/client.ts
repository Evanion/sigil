import type { ClientMessage, ServerMessage } from "../types/messages";

/**
 * Configuration constants for WebSocket reconnection behavior.
 */
const INITIAL_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

/** Normal WebSocket close code indicating intentional closure. */
const NORMAL_CLOSE_CODE = 1000;

export type MessageHandler = (message: ServerMessage) => void;
export type ConnectionHandler = (connected: boolean) => void;
export type Unsubscribe = () => void;

export interface WebSocketClient {
  /** Send a client message to the server. No-op if not connected. */
  send(message: ClientMessage): void;

  /** Subscribe to incoming server messages. Returns an unsubscribe function. */
  onMessage(handler: MessageHandler): Unsubscribe;

  /** Subscribe to connection state changes. Returns an unsubscribe function. */
  onConnectionChange(handler: ConnectionHandler): Unsubscribe;

  /** Returns true if the WebSocket is currently open. */
  isConnected(): boolean;

  /** Close the connection permanently. No auto-reconnect after this. */
  close(): void;
}

/**
 * Creates a WebSocket client that connects to the given URL with
 * auto-reconnect using exponential backoff.
 */
export function createWebSocketClient(url: string): WebSocketClient {
  const messageHandlers = new Set<MessageHandler>();
  const connectionHandlers = new Set<ConnectionHandler>();

  let ws: WebSocket | null = null;
  let closed = false;
  let backoffMs = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function notifyConnectionChange(connected: boolean): void {
    for (const handler of connectionHandlers) {
      handler(connected);
    }
  }

  function connect(): void {
    if (closed) return;

    ws = new WebSocket(url);

    ws.onopen = () => {
      backoffMs = INITIAL_BACKOFF_MS;
      notifyConnectionChange(true);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        console.error("Failed to parse WebSocket message");
        return;
      }
      // Basic shape check
      if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
        console.error("Invalid server message shape");
        return;
      }
      for (const handler of messageHandlers) {
        handler(parsed as ServerMessage);
      }
    };

    ws.onclose = (event: CloseEvent) => {
      notifyConnectionChange(false);

      if (closed || event.code === NORMAL_CLOSE_CODE) {
        return;
      }

      scheduleReconnect();
    };

    ws.onerror = () => {
      // The close event will fire after an error, so reconnect is handled there.
    };
  }

  function scheduleReconnect(): void {
    if (closed) return;

    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  // Start the initial connection
  connect();

  return {
    send(message: ClientMessage): void {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    },

    onMessage(handler: MessageHandler): Unsubscribe {
      messageHandlers.add(handler);
      return () => {
        messageHandlers.delete(handler);
      };
    },

    onConnectionChange(handler: ConnectionHandler): Unsubscribe {
      connectionHandlers.add(handler);
      return () => {
        connectionHandlers.delete(handler);
      };
    },

    isConnected(): boolean {
      return ws !== null && ws.readyState === WebSocket.OPEN;
    },

    close(): void {
      closed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.onopen = null;
        ws.close();
        ws = null;
      }
    },
  };
}
