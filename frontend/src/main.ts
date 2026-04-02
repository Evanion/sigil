import "./styles/global.css";
import { createWebSocketClient } from "./ws/client";
import { createDocumentStore } from "./store/document-store";
import { mountAppShell } from "./shell/app-shell";

/**
 * Determine the WebSocket URL based on the current page location.
 * Uses wss:// for HTTPS and ws:// for HTTP.
 */
function getWebSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

/**
 * Bootstrap the Sigil editor application.
 */
function main(): void {
  const app = document.getElementById("app");
  if (!app) {
    return;
  }

  // Create WebSocket client and document store
  const wsClient = createWebSocketClient(getWebSocketUrl());
  const store = createDocumentStore(wsClient);

  // Mount the app shell into the DOM
  const cleanup = mountAppShell(app, store);

  // Load initial document state from the server
  void store.loadInitialState();

  // Clean up on page unload
  window.addEventListener("pagehide", () => {
    cleanup();
    store.destroy();
    wsClient.close();
  });
}

main();
