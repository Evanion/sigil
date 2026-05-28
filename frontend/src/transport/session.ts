/**
 * Session globals reader (spec-20).
 *
 * The Tauri shell injects `__SIGIL_SESSION_ID__` and `__SIGIL_SERVER_PORT__`
 * onto `window` before the Vite bundle boots (Task 15). The frontend reads
 * these here to:
 *   1. Attach the `X-Sigil-Session` header to every urql HTTP request.
 *   2. Forward the sessionId to graphql-ws via `connectionParams`.
 *   3. Compute the absolute HTTP/WS URLs against the dynamic sidecar port.
 *
 * Browser / dev mode (no Tauri) — the globals are absent, and the URL helpers
 * fall back to `window.location.origin` / `window.location.host`, which the
 * Vite dev proxy forwards to the locally-running sigil-server.
 *
 * Defensive guards per frontend-defensive.md "Floating-Point Validation":
 *   `getServerPort` rejects NaN, Infinity, non-positive values, and
 *   out-of-range values (> 65535).
 */

declare global {
  interface Window {
    __SIGIL_SESSION_ID__?: string;
    __SIGIL_SERVER_PORT__?: number;
  }
}

/**
 * Returns the sessionId injected by the Tauri shell, or null when running
 * outside Tauri (browser dev mode, vitest).
 */
export function getSessionId(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.__SIGIL_SESSION_ID__;
  if (typeof raw === "string" && raw.length > 0) return raw;
  return null;
}

/**
 * Returns the sidecar server port injected by the Tauri shell, or null when
 * running outside Tauri. Validates: integer-ish finite, > 0, < 65536.
 */
export function getServerPort(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.__SIGIL_SERVER_PORT__;
  if (typeof raw !== "number") return null;
  if (!Number.isFinite(raw)) return null;
  if (raw <= 0 || raw >= 65536) return null;
  return raw;
}

/**
 * Returns the absolute GraphQL HTTP endpoint.
 *
 * Tauri mode (port present): `http://127.0.0.1:<port>/graphql`.
 * Browser/dev mode: `${window.location.origin}/graphql` — relies on the Vite
 * proxy to forward to the local sigil-server.
 */
export function getGraphqlHttpUrl(): string {
  const port = getServerPort();
  if (port !== null) return `http://127.0.0.1:${port}/graphql`;
  return `${window.location.origin}/graphql`;
}

/**
 * Returns the absolute GraphQL WebSocket endpoint.
 *
 * Tauri mode (port present): `ws://127.0.0.1:<port>/graphql/ws`.
 * Browser/dev mode: `ws(s)://${window.location.host}/graphql/ws` matching
 * the page protocol.
 */
export function getGraphqlWsUrl(): string {
  const port = getServerPort();
  if (port !== null) return `ws://127.0.0.1:${port}/graphql/ws`;
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${window.location.host}/graphql/ws`;
}

/**
 * Writes both session globals onto `window`. Used by the Tauri shell
 * indirectly through `session-replaced` event handling, and directly by
 * unit tests.
 */
export function setSessionGlobals(sessionId: string, serverPort: number): void {
  if (typeof window === "undefined") return;
  window.__SIGIL_SESSION_ID__ = sessionId;
  window.__SIGIL_SERVER_PORT__ = serverPort;
}
