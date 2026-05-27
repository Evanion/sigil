/**
 * GraphQL URL construction for the sigil-server sidecar.
 *
 * In Tauri mode, the shell injects `window.__SIGIL_SIDECAR_PORT__` before
 * the SPA bootstraps. We bind to 127.0.0.1:<port>. In browser/dev mode,
 * the URL derives from `window.location` (Vite proxies /graphql to the
 * dev server on port 4680).
 */

declare global {
  interface Window {
    __SIGIL_SIDECAR_PORT__?: number;
  }
}

function getSidecarPort(): number | null {
  const raw = window.__SIGIL_SIDECAR_PORT__;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0 && raw < 65536) {
    return raw;
  }
  return null;
}

export function getGraphqlHttpUrl(): string {
  const port = getSidecarPort();
  if (port !== null) {
    return `http://127.0.0.1:${port}/graphql`;
  }
  return `${window.location.origin}/graphql`;
}

export function getGraphqlWsUrl(): string {
  const port = getSidecarPort();
  if (port !== null) {
    return `ws://127.0.0.1:${port}/graphql/ws`;
  }
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${window.location.host}/graphql/ws`;
}
