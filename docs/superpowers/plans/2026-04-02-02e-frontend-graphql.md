# Frontend GraphQL Migration — Implementation Plan (02e)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the frontend's fetch+WebSocket data layer with urql GraphQL client — queries for state, mutations for commands, subscriptions for real-time updates.

**Architecture:** urql client connects to `/graphql` (HTTP for queries/mutations) and `/graphql/ws` (WebSocket for subscriptions via `graphql-ws` protocol). The `DocumentStore` interface stays the same (components don't change). The implementation swaps from "REST fetch + raw WebSocket send" to "urql query + urql mutation + urql subscription". The old `ws/client.ts` and `types/messages.ts` become unused and are removed. The old REST+WebSocket server endpoints remain available but the frontend no longer uses them.

**Tech Stack:** urql 4.x, graphql 16.x, graphql-ws 5.x, Solid.js (store consumed via context in future)

**IMPORTANT:** Your FIRST action before writing ANY code must be to read `CLAUDE.md` in full. TypeScript strict, no `any`. Defensive JSON parsing (GOV-024). No innerHTML.

---

## File Structure

```
frontend/src/
├── graphql/
│   ├── client.ts            # NEW: urql client setup with graphql-ws subscription exchange
│   ├── queries.ts           # NEW: GraphQL query documents (document, pages, node)
│   ├── mutations.ts         # NEW: GraphQL mutation documents (createNode, setTransform, undo, etc.)
│   └── subscriptions.ts     # NEW: GraphQL subscription documents (documentChanged)
├── store/
│   └── document-store.ts    # REWRITE: urql-backed implementation, same interface
├── main.ts                  # MODIFY: create urql client instead of WS client
├── ws/                      # DELETE: no longer needed (graphql-ws handles transport)
│   ├── client.ts
│   └── __tests__/client.test.ts
├── types/
│   ├── messages.ts          # DELETE: old WS protocol types no longer used
│   ├── document.ts          # KEEP: domain types unchanged
│   └── commands.ts          # KEEP: command helpers still useful for building mutation variables
```

---

## Task 1: Add urql + graphql-ws dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Install dependencies:

```bash
cd frontend
pnpm add urql graphql graphql-ws
```

Note: we're NOT using `@urql/solid` — we'll use urql's framework-agnostic `Client` class imperatively. The store wraps it and exposes Solid-compatible reactivity in a future step. This keeps the migration focused.

- [ ] 3. Verify build still works:

```bash
pnpm build && pnpm test
```

- [ ] 4. Commit: `feat(frontend): add urql, graphql, graphql-ws dependencies (spec-02)`

---

## Task 2: Create GraphQL document definitions

**Files:**
- Create: `frontend/src/graphql/queries.ts`
- Create: `frontend/src/graphql/mutations.ts`
- Create: `frontend/src/graphql/subscriptions.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create `frontend/src/graphql/queries.ts` — typed query strings matching the server schema:

```typescript
export const DOCUMENT_QUERY = `
  query Document {
    document {
      name
      pageCount
      nodeCount
      canUndo
      canRedo
    }
  }
`;

export const PAGES_QUERY = `
  query Pages {
    pages {
      id
      name
      nodes {
        uuid
        name
        kind
        parent
        children
        transform
        style
        visible
        locked
      }
    }
  }
`;

export const NODE_QUERY = `
  query Node($uuid: String!) {
    node(uuid: $uuid) {
      uuid
      name
      kind
      parent
      children
      transform
      style
      visible
      locked
    }
  }
`;
```

- [ ] 3. Create `frontend/src/graphql/mutations.ts`:

```typescript
export const CREATE_NODE_MUTATION = `
  mutation CreateNode($kind: JSON!, $name: String!, $pageId: String, $transform: JSON) {
    createNode(kind: $kind, name: $name, pageId: $pageId, transform: $transform) {
      uuid
      node {
        uuid
        name
        kind
        parent
        children
        transform
        style
        visible
        locked
      }
    }
  }
`;

export const DELETE_NODE_MUTATION = `
  mutation DeleteNode($uuid: String!) {
    deleteNode(uuid: $uuid)
  }
`;

export const RENAME_NODE_MUTATION = `
  mutation RenameNode($uuid: String!, $newName: String!) {
    renameNode(uuid: $uuid, newName: $newName) { uuid name }
  }
`;

export const SET_TRANSFORM_MUTATION = `
  mutation SetTransform($uuid: String!, $transform: JSON!) {
    setTransform(uuid: $uuid, transform: $transform) { uuid transform }
  }
`;

export const SET_VISIBLE_MUTATION = `
  mutation SetVisible($uuid: String!, $visible: Boolean!) {
    setVisible(uuid: $uuid, visible: $visible) { uuid visible }
  }
`;

export const SET_LOCKED_MUTATION = `
  mutation SetLocked($uuid: String!, $locked: Boolean!) {
    setLocked(uuid: $uuid, locked: $locked) { uuid locked }
  }
`;

export const UNDO_MUTATION = `
  mutation Undo { undo { canUndo canRedo } }
`;

export const REDO_MUTATION = `
  mutation Redo { redo { canUndo canRedo } }
`;
```

- [ ] 4. Create `frontend/src/graphql/subscriptions.ts`:

```typescript
export const DOCUMENT_CHANGED_SUBSCRIPTION = `
  subscription DocumentChanged {
    documentChanged {
      eventType
      uuid
      data
      senderId
    }
  }
`;
```

- [ ] 5. Commit: `feat(frontend): add GraphQL query, mutation, and subscription documents (spec-02)`

---

## Task 3: Create urql client with graphql-ws transport

**Files:**
- Create: `frontend/src/graphql/client.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create `frontend/src/graphql/client.ts`:

```typescript
import { Client, cacheExchange, fetchExchange, subscriptionExchange } from "urql";
import { createClient as createWSClient } from "graphql-ws";

/**
 * Creates a urql GraphQL client configured for:
 * - HTTP POST for queries and mutations
 * - WebSocket (graphql-ws protocol) for subscriptions
 */
export function createGraphQLClient(): Client {
  const httpUrl = `${window.location.origin}/graphql`;
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${window.location.host}/graphql/ws`;

  const wsClient = createWSClient({ url: wsUrl });

  return new Client({
    url: httpUrl,
    exchanges: [
      cacheExchange,
      fetchExchange,
      subscriptionExchange({
        forwardSubscription(request) {
          const input = { ...request, query: request.query || "" };
          return {
            subscribe(sink) {
              const unsub = wsClient.subscribe(input, sink);
              return { unsubscribe: unsub };
            },
          };
        },
      }),
    ],
  });
}
```

- [ ] 3. Commit: `feat(frontend): add urql client with graphql-ws subscription transport (spec-02)`

---

## Task 4: Rewrite DocumentStore to use urql

**Files:**
- Modify: `frontend/src/store/document-store.ts`
- Modify: `frontend/src/store/__tests__/document-store.test.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Rewrite `document-store.ts`. The interface stays the same — components don't change. The implementation changes from fetch+WS to urql:

Key changes:
- `loadInitialState()` → `client.query(PAGES_QUERY)` — populates nodes + pages
- `createNode(kind, name, transform)` → `client.mutation(CREATE_NODE_MUTATION, variables)` — optimistic insert into local nodes map, then confirm from mutation result
- `undo()` / `redo()` → `client.mutation(UNDO_MUTATION)` / `client.mutation(REDO_MUTATION)` — update canUndo/canRedo from result, then re-fetch pages
- `sendCommand(cmd)` → replaced by specific mutation calls. The select tool calls `setTransform` — the store needs a `setTransform(uuid, transform)` method instead of generic `sendCommand`.
- Real-time updates: subscribe to `DOCUMENT_CHANGED_SUBSCRIPTION`. On each event, re-fetch the affected data (or re-fetch full pages for MVP).
- Connection state: track urql client connection status via subscription lifecycle.

New store interface additions:
```typescript
// Replace sendCommand with specific mutations
setTransform(uuid: string, transform: Transform): void;
renameNode(uuid: string, newName: string): void;
deleteNode(uuid: string): void;
setVisible(uuid: string, visible: boolean): void;
setLocked(uuid: string, locked: boolean): void;
```

The old `sendCommand(SerializableCommand)` is removed.

- [ ] 3. Update the select tool to call `store.setTransform(uuid, transform)` instead of `store.sendCommand(setTransformCommand(...))`.

- [ ] 4. Rewrite tests to mock the urql client instead of the WebSocket client. Use urql's `fromValue` test utility.

- [ ] 5. Run tests and lint.

- [ ] 6. Commit: `feat(frontend): rewrite DocumentStore with urql — queries, mutations, subscriptions (spec-02)`

---

## Task 5: Update main.ts and remove old WS code

**Files:**
- Modify: `frontend/src/main.ts`
- Delete: `frontend/src/ws/client.ts`
- Delete: `frontend/src/ws/__tests__/client.test.ts`
- Delete: `frontend/src/types/messages.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Update `main.ts` to create the urql client and pass it to the store:

```typescript
import "./styles/global.css";
import { createGraphQLClient } from "./graphql/client";
import { createDocumentStore } from "./store/document-store";
import { mountAppShell } from "./shell/app-shell";

async function main(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  const graphqlClient = createGraphQLClient();
  const store = createDocumentStore(graphqlClient);

  const cleanup = mountAppShell(app, store);
  await store.loadInitialState();

  window.addEventListener("pagehide", () => {
    cleanup();
    store.destroy();
  });
}

void main();
```

- [ ] 3. Delete `frontend/src/ws/client.ts` and `frontend/src/ws/__tests__/client.test.ts`.

- [ ] 4. Delete `frontend/src/types/messages.ts` (the WS protocol types are no longer used).

- [ ] 5. Update any imports that referenced the deleted files. Check `shell/app-shell.ts` and `tools/select-tool.ts` for references.

- [ ] 6. Run tests and lint — verify no broken imports.

- [ ] 7. Commit: `refactor(frontend): remove old WebSocket client and message types, use urql exclusively (spec-02)`

---

## Task 6: Update tools to use store mutations directly

**Files:**
- Modify: `frontend/src/tools/select-tool.ts`
- Modify: `frontend/src/tools/__tests__/select-tool.test.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. The select tool currently calls `store.sendCommand(setTransform(...))` on pointer up. Replace with `store.setTransform(uuid, newTransform)`.

- [ ] 3. Update tests to mock the new `setTransform` method instead of `sendCommand`.

- [ ] 4. Commit: `refactor(frontend): select tool uses store.setTransform instead of sendCommand (spec-02)`

---

## Task 7: Full verification

- [ ] 1. Frontend tests: `cd frontend && pnpm test`
- [ ] 2. Frontend lint: `cd frontend && pnpm lint`
- [ ] 3. Frontend build: `cd frontend && pnpm build`
- [ ] 4. Workspace: `cargo test --workspace && cargo clippy --workspace -- -D warnings`
- [ ] 5. Manual test: start server, open browser, verify:
   - Canvas loads nodes via GraphQL query
   - Drawing a shape creates via GraphQL mutation
   - Undo/redo works via GraphQL mutations
   - Another browser tab sees changes via subscription
- [ ] 6. Fix any issues, commit.

---

## Deferred Items

### Plan 02f: Remove old server endpoints
- Remove `/ws` WebSocket route and handler
- Remove `/api/document`, `/api/document/full` REST endpoints
- Remove `dispatch.rs`
- Remove `ClientMessage`/`ServerMessage` types from server
- Clean up old broadcast channel (keep only GraphQL broadcast)

### Future: Solid.js store integration
- Wrap urql client in Solid context provider
- Convert store methods to Solid signals for reactive components
- Components consume store via `useContext` instead of prop drilling
