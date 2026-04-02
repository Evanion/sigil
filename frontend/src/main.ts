import "./styles/global.css";
import { createGraphQLClient } from "./graphql/client";
import { createDocumentStore } from "./store/document-store";
import { mountAppShell } from "./shell/app-shell";

/**
 * Bootstrap the Sigil editor application.
 */
async function main(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) {
    return;
  }

  // Create urql GraphQL client and document store
  const graphqlClient = createGraphQLClient();
  const store = createDocumentStore(graphqlClient);

  // Mount the app shell into the DOM
  const cleanup = mountAppShell(app, store);

  // Load initial document state from the server
  await store.loadInitialState();

  // Clean up on page unload
  window.addEventListener("pagehide", () => {
    cleanup();
    store.destroy();
  });
}

void main();
