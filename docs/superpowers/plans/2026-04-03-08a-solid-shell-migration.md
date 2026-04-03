# Solid Shell Migration Implementation Plan (Plan 08a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the frontend editor shell from vanilla TypeScript to Solid.js, replace the manual pub/sub document store with `@urql/solid` + Solid signals, and wrap the canvas in a Solid component with `createEffect`-driven rendering.

**Architecture:** The app root becomes a `<App>` Solid component with CSS grid layout. Document state lives in `createStore` populated by `@urql/solid` queries/subscriptions. UI state (selected node, active tool, viewport) uses `createSignal`. The canvas stays imperative but is wrapped in a Solid component where a `createEffect` reads all relevant signals and calls `renderer.render()`, guaranteeing no stale renders.

**Tech Stack:** Solid.js 1.9, `@urql/solid` 5.x, `graphql-ws` 6.x, Vite 8, TypeScript 6

---

## Scope

**In scope (this plan):**
- Add `@urql/solid` dependency
- Create `<App>` root component with CSS grid layout
- Migrate document store to Solid `createStore` + `@urql/solid`
- Create document context (Provider + `useDocument` hook)
- Migrate toolbar to Solid component
- Wrap canvas in Solid component with `createEffect` render trigger
- Migrate status bar to Solid component
- Delete vanilla shell (`app-shell.ts`, old `document-store.ts`)
- Preserve all existing accessibility features

**Deferred to Plan 08b:**
- Panel system (TabRegion, panel registry)
- SchemaPanel, FieldRenderer, schema types
- Placeholder panel components

---

## Task 1: Add `@urql/solid` dependency

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install `@urql/solid`**

Run from the project root:

```bash
pnpm --prefix frontend add @urql/solid
```

This replaces the vanilla `urql` package. `@urql/solid` re-exports everything from `@urql/core` plus Solid-specific primitives (`createQuery`, `createMutation`, `createSubscription`, `Provider`).

- [ ] **Step 2: Remove vanilla `urql` dependency**

```bash
pnpm --prefix frontend remove urql
```

- [ ] **Step 3: Verify the app still builds**

```bash
pnpm --prefix frontend build
```

Expected: Build succeeds. There will be runtime errors since `app-shell.ts` still imports the old store, but the build should complete (no TypeScript errors yet — the old code is still intact).

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml
git commit -m "chore(frontend): swap urql for @urql/solid (Plan 08a, Task 1)"
```

---

## Task 2: Create Solid document store + context

**Files:**
- Create: `frontend/src/store/document-context.tsx`
- Create: `frontend/src/store/document-store-solid.tsx`

This task creates the new Solid-based store alongside the old one. Both exist temporarily until the shell migration is complete.

- [ ] **Step 1: Create the document context**

Create `frontend/src/store/document-context.tsx`:

```tsx
import { createContext, useContext, type ParentComponent } from "solid-js";
import type { DocumentStoreAPI } from "./document-store-solid";

const DocumentContext = createContext<DocumentStoreAPI>();

export const DocumentProvider: ParentComponent<{ store: DocumentStoreAPI }> = (props) => {
  return (
    <DocumentContext.Provider value={props.store}>
      {props.children}
    </DocumentContext.Provider>
  );
};

export function useDocument(): DocumentStoreAPI {
  const ctx = useContext(DocumentContext);
  if (!ctx) {
    throw new Error("useDocument must be used within a <DocumentProvider>");
  }
  return ctx;
}
```

- [ ] **Step 2: Create the Solid document store**

Create `frontend/src/store/document-store-solid.tsx`:

```tsx
import { createSignal, createEffect, onCleanup, batch } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import {
  createClient,
  cacheExchange,
  fetchExchange,
  subscriptionExchange,
  type Client,
} from "@urql/solid";
import { createClient as createWSClient } from "graphql-ws";
import { gql } from "@urql/core";
import type {
  DocumentInfo,
  DocumentNode,
  Page,
  Transform,
  NodeKind,
  NodeId,
} from "../types/document";
import { PAGES_QUERY } from "../graphql/queries";
import {
  CREATE_NODE_MUTATION,
  DELETE_NODE_MUTATION,
  RENAME_NODE_MUTATION,
  SET_TRANSFORM_MUTATION,
  SET_VISIBLE_MUTATION,
  SET_LOCKED_MUTATION,
  UNDO_MUTATION,
  REDO_MUTATION,
} from "../graphql/mutations";
import { DOCUMENT_CHANGED_SUBSCRIPTION } from "../graphql/subscriptions";

// ── Types ──────────────────────────────────────────────────────────────

export interface DocumentState {
  info: DocumentInfo;
  pages: Page[];
  nodes: Record<string, DocumentNode>;
}

export type ToolType = "select" | "frame" | "rectangle" | "ellipse";

export interface DocumentStoreAPI {
  // Document state (reactive — read inside components/effects to track)
  readonly state: DocumentState;

  // UI signals
  readonly selectedNodeId: () => string | null;
  readonly setSelectedNodeId: (id: string | null) => void;
  readonly activeTool: () => ToolType;
  readonly setActiveTool: (tool: ToolType) => void;
  readonly viewport: () => import("../canvas/viewport").Viewport;
  readonly setViewport: (vp: import("../canvas/viewport").Viewport) => void;
  readonly connected: () => boolean;

  // Derived
  readonly canUndo: () => boolean;
  readonly canRedo: () => boolean;

  // Mutations
  createNode(kind: NodeKind, name: string, transform: Transform): string;
  setTransform(uuid: string, transform: Transform): void;
  renameNode(uuid: string, newName: string): void;
  deleteNode(uuid: string): void;
  setVisible(uuid: string, visible: boolean): void;
  setLocked(uuid: string, locked: boolean): void;
  undo(): void;
  redo(): void;

  // Lifecycle
  readonly client: Client;
}

// ── Placeholder NodeId ─────────────────────────────────────────────────

const PLACEHOLDER_NODE_ID: NodeId = { index: 0, generation: 0 };

// ── Debounce helper ────────────────────────────────────────────────────

const DEBOUNCE_MS = 100;

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

// ── Parse GraphQL response ────────────────────────────────────────────

function parseNode(raw: Record<string, unknown>): DocumentNode {
  return {
    id: PLACEHOLDER_NODE_ID,
    uuid: raw["uuid"] as string,
    kind: raw["kind"] as NodeKind,
    name: raw["name"] as string,
    parent: null,
    children: [],
    transform: raw["transform"] as Transform,
    style: raw["style"] as DocumentNode["style"],
    constraints: { horizontal: "fixed", vertical: "fixed" } as DocumentNode["constraints"],
    grid_placement: null,
    visible: raw["visible"] as boolean,
    locked: raw["locked"] as boolean,
  };
}

function parsePagesResponse(
  data: unknown,
): { pages: Page[]; nodes: Record<string, DocumentNode> } {
  const pages: Page[] = [];
  const nodes: Record<string, DocumentNode> = {};

  if (!data || typeof data !== "object") return { pages, nodes };
  const pagesRaw = (data as Record<string, unknown>)["pages"];
  if (!Array.isArray(pagesRaw)) return { pages, nodes };

  for (const pageRaw of pagesRaw) {
    if (!pageRaw || typeof pageRaw !== "object") continue;
    const p = pageRaw as Record<string, unknown>;
    const pageNodes = Array.isArray(p["nodes"]) ? p["nodes"] : [];
    const rootNodeIds: NodeId[] = [];

    for (const nodeRaw of pageNodes) {
      if (!nodeRaw || typeof nodeRaw !== "object") continue;
      const n = nodeRaw as Record<string, unknown>;
      const uuid = n["uuid"] as string;
      if (!uuid) continue;
      nodes[uuid] = parseNode(n);
      rootNodeIds.push(PLACEHOLDER_NODE_ID);
    }

    pages.push({
      id: p["id"] as string,
      name: p["name"] as string,
      root_nodes: rootNodeIds,
    });
  }

  return { pages, nodes };
}

// ── Store factory ─────────────────────────────────────────────────────

export function createDocumentStoreSolid(): DocumentStoreAPI {
  // urql client
  const httpUrl = `${window.location.origin}/graphql`;
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${window.location.host}/graphql/ws`;

  const wsClient = createWSClient({ url: wsUrl });

  const client = createClient({
    url: httpUrl,
    exchanges: [
      cacheExchange,
      subscriptionExchange({
        forwardSubscription(request) {
          const input = { ...request, query: request.query || "" };
          return {
            subscribe(sink) {
              const unsubscribe = wsClient.subscribe(input, sink);
              return { unsubscribe };
            },
          };
        },
      }),
      fetchExchange,
    ],
  });

  // Document state
  const [state, setState] = createStore<DocumentState>({
    info: { name: "", page_count: 0, node_count: 0, can_undo: false, can_redo: false },
    pages: [],
    nodes: {},
  });

  // UI signals
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [activeTool, setActiveTool] = createSignal<ToolType>("select");
  const [viewport, setViewport] = createSignal<import("../canvas/viewport").Viewport>({
    x: 0,
    y: 0,
    zoom: 1,
  });
  const [connected, setConnected] = createSignal(false);

  // Derived
  const canUndo = () => state.info.can_undo;
  const canRedo = () => state.info.can_redo;

  // ── Fetch pages ──────────────────────────────────────────────────────

  async function fetchPages(): Promise<void> {
    try {
      const result = await client.query(gql(PAGES_QUERY), {}).toPromise();
      if (result.error) {
        console.error("fetchPages error:", result.error.message);
        return;
      }
      if (!result.data) return;

      const { pages, nodes } = parsePagesResponse(result.data);
      batch(() => {
        setState("pages", reconcile(pages));
        setState("nodes", reconcile(nodes));
        setState("info", "node_count", Object.keys(nodes).length);
        setState("info", "page_count", pages.length);
      });
    } catch (err) {
      console.error("fetchPages exception:", err);
    }
  }

  const debouncedFetchPages = debounce(fetchPages, DEBOUNCE_MS);

  // ── Subscription ─────────────────────────────────────────────────────

  const subscription = client
    .subscription(gql(DOCUMENT_CHANGED_SUBSCRIPTION), {})
    .subscribe((result) => {
      if (result.error) {
        console.error("subscription error:", result.error.message);
        return;
      }
      setConnected(true);
      debouncedFetchPages();
    });

  // Initial load
  void fetchPages().then(() => setConnected(true));

  // ── Mutations ────────────────────────────────────────────────────────

  function createNode(kind: NodeKind, name: string, transform: Transform): string {
    const optimisticUuid = crypto.randomUUID();
    const pageId = state.pages[0]?.id ?? null;

    // Optimistic insert
    setState("nodes", optimisticUuid, {
      id: PLACEHOLDER_NODE_ID,
      uuid: optimisticUuid,
      kind,
      name,
      parent: null,
      children: [],
      transform,
      style: { fills: [], strokes: [], opacity: { type: "literal", value: 1 }, blend_mode: "normal", effects: [] },
      constraints: { horizontal: "fixed", vertical: "fixed" },
      grid_placement: null,
      visible: true,
      locked: false,
    } as DocumentNode);

    client
      .mutation(gql(CREATE_NODE_MUTATION), {
        kind: JSON.parse(JSON.stringify(kind)),
        name,
        pageId,
        transform: JSON.parse(JSON.stringify(transform)),
      })
      .toPromise()
      .then((result) => {
        if (result.error) {
          console.error("createNode error:", result.error.message);
          // Remove optimistic node
          setState(
            produce((s) => {
              delete s.nodes[optimisticUuid];
            }),
          );
          return;
        }
        const serverUuid = result.data?.createNode?.uuid as string | undefined;
        if (serverUuid && serverUuid !== optimisticUuid) {
          // Replace optimistic with server version
          batch(() => {
            const node = state.nodes[optimisticUuid];
            if (node) {
              setState(
                produce((s) => {
                  delete s.nodes[optimisticUuid];
                  s.nodes[serverUuid] = { ...node, uuid: serverUuid };
                }),
              );
              if (selectedNodeId() === optimisticUuid) {
                setSelectedNodeId(serverUuid);
              }
            }
          });
        }
      });

    return optimisticUuid;
  }

  function setTransform(uuid: string, transform: Transform): void {
    // Optimistic update
    setState("nodes", uuid, "transform", transform);
    client
      .mutation(gql(SET_TRANSFORM_MUTATION), { uuid, transform: JSON.parse(JSON.stringify(transform)) })
      .toPromise()
      .then((r) => {
        if (r.error) console.error("setTransform error:", r.error.message);
      });
  }

  function renameNode(uuid: string, newName: string): void {
    setState("nodes", uuid, "name", newName);
    client
      .mutation(gql(RENAME_NODE_MUTATION), { uuid, newName })
      .toPromise()
      .then((r) => {
        if (r.error) console.error("renameNode error:", r.error.message);
      });
  }

  function deleteNode(uuid: string): void {
    setState(
      produce((s) => {
        delete s.nodes[uuid];
      }),
    );
    if (selectedNodeId() === uuid) setSelectedNodeId(null);
    client
      .mutation(gql(DELETE_NODE_MUTATION), { uuid })
      .toPromise()
      .then((r) => {
        if (r.error) console.error("deleteNode error:", r.error.message);
      });
  }

  function setVisible(uuid: string, visible: boolean): void {
    setState("nodes", uuid, "visible", visible);
    client
      .mutation(gql(SET_VISIBLE_MUTATION), { uuid, visible })
      .toPromise()
      .then((r) => {
        if (r.error) console.error("setVisible error:", r.error.message);
      });
  }

  function setLocked(uuid: string, locked: boolean): void {
    setState("nodes", uuid, "locked", locked);
    client
      .mutation(gql(SET_LOCKED_MUTATION), { uuid, locked })
      .toPromise()
      .then((r) => {
        if (r.error) console.error("setLocked error:", r.error.message);
      });
  }

  function undo(): void {
    client
      .mutation(gql(UNDO_MUTATION), {})
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("undo error:", r.error.message);
          return;
        }
        const data = r.data?.undo as { canUndo: boolean; canRedo: boolean } | undefined;
        if (data) {
          setState("info", "can_undo", data.canUndo);
          setState("info", "can_redo", data.canRedo);
        }
        debouncedFetchPages();
      });
  }

  function redo(): void {
    client
      .mutation(gql(REDO_MUTATION), {})
      .toPromise()
      .then((r) => {
        if (r.error) {
          console.error("redo error:", r.error.message);
          return;
        }
        const data = r.data?.redo as { canUndo: boolean; canRedo: boolean } | undefined;
        if (data) {
          setState("info", "can_undo", data.canUndo);
          setState("info", "can_redo", data.canRedo);
        }
        debouncedFetchPages();
      });
  }

  return {
    state,
    selectedNodeId,
    setSelectedNodeId,
    activeTool,
    setActiveTool,
    viewport,
    setViewport,
    connected,
    canUndo,
    canRedo,
    createNode,
    setTransform,
    renameNode,
    deleteNode,
    setVisible,
    setLocked,
    undo,
    redo,
    client,
  };
}
```

- [ ] **Step 3: Verify compilation**

```bash
pnpm --prefix frontend build
```

Expected: Compiles with no errors. The new files are not yet imported by anything.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/store/document-context.tsx frontend/src/store/document-store-solid.tsx
git commit -m "feat(frontend): add Solid document store + context (Plan 08a, Task 2)"
```

---

## Task 3: Create `<App>` root component

**Files:**
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/App.css`

- [ ] **Step 1: Create App CSS**

Create `frontend/src/App.css`:

```css
.app-shell {
  display: grid;
  grid-template-columns: 48px 240px 1fr 280px;
  grid-template-rows: 1fr auto;
  height: 100vh;
  overflow: hidden;
  background: var(--surface-1, #1e1e2e);
  color: var(--text-1, #cdd6f4);
  font-family: system-ui, -apple-system, sans-serif;
}

.app-shell__toolbar {
  grid-row: 1 / -1;
  grid-column: 1;
}

.app-shell__left {
  grid-row: 1;
  grid-column: 2;
  border-right: 1px solid var(--surface-3, #313244);
  overflow-y: auto;
}

.app-shell__canvas {
  grid-row: 1;
  grid-column: 3;
  overflow: hidden;
  position: relative;
}

.app-shell__right {
  grid-row: 1;
  grid-column: 4;
  border-left: 1px solid var(--surface-3, #313244);
  overflow-y: auto;
}

.app-shell__status {
  grid-column: 2 / -1;
  grid-row: 2;
}

/* Placeholder panel styling */
.placeholder-panel {
  padding: 12px;
}

.placeholder-panel__heading {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-2, #a6adc8);
  margin: 0;
}
```

- [ ] **Step 2: Create App component**

Create `frontend/src/App.tsx`:

```tsx
import { type Component } from "solid-js";
import { DocumentProvider } from "./store/document-context";
import { createDocumentStoreSolid, type DocumentStoreAPI } from "./store/document-store-solid";
import { Toolbar } from "./shell/Toolbar";
import { Canvas } from "./shell/Canvas";
import { StatusBar } from "./shell/StatusBar";
import "./App.css";

const App: Component = () => {
  const store = createDocumentStoreSolid();

  return (
    <DocumentProvider store={store}>
      <div class="app-shell">
        <Toolbar />
        <div class="app-shell__left" role="complementary" aria-label="Left panel">
          <div class="placeholder-panel">
            <h2 class="placeholder-panel__heading">Layers</h2>
          </div>
        </div>
        <div class="app-shell__canvas">
          <Canvas />
        </div>
        <div class="app-shell__right" role="complementary" aria-label="Right panel">
          <div class="placeholder-panel">
            <h2 class="placeholder-panel__heading">Properties</h2>
          </div>
        </div>
        <StatusBar />
      </div>
    </DocumentProvider>
  );
};

export default App;
```

Note: `Toolbar`, `Canvas`, and `StatusBar` are created in Tasks 4-6. For now this file will have import errors — that's expected.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.css
git commit -m "feat(frontend): add App root component with grid layout (Plan 08a, Task 3)"
```

---

## Task 4: Migrate Toolbar to Solid component

**Files:**
- Create: `frontend/src/shell/Toolbar.tsx`
- Create: `frontend/src/shell/Toolbar.css`

- [ ] **Step 1: Create Toolbar CSS**

Create `frontend/src/shell/Toolbar.css`:

```css
.toolbar {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 4px;
  background: var(--surface-2, #181825);
  border-right: 1px solid var(--surface-3, #313244);
}

.toolbar__logo {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 16px;
  color: var(--brand, #cba6f7);
  margin-bottom: 8px;
}

.toolbar__btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2, #a6adc8);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.1s;
}

.toolbar__btn:hover {
  background: var(--surface-3, #313244);
}

.toolbar__btn:focus-visible {
  outline: 2px solid var(--brand, #cba6f7);
  outline-offset: -2px;
}

.toolbar__btn[aria-pressed="true"] {
  background: var(--brand, #cba6f7);
  color: var(--surface-1, #1e1e2e);
}
```

- [ ] **Step 2: Create Toolbar component**

Create `frontend/src/shell/Toolbar.tsx`:

```tsx
import { For, createSignal, createEffect, onMount, onCleanup, type Component } from "solid-js";
import { useDocument } from "../store/document-context";
import type { ToolType } from "../store/document-store-solid";
import tinykeys from "tinykeys";
import "./Toolbar.css";

interface ToolDef {
  id: ToolType;
  label: string;
  shortcut: string;
  icon: string;
}

const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", shortcut: "V", icon: "V" },
  { id: "frame", label: "Frame", shortcut: "F", icon: "F" },
  { id: "rectangle", label: "Rectangle", shortcut: "R", icon: "R" },
  { id: "ellipse", label: "Ellipse", shortcut: "O", icon: "O" },
];

export const Toolbar: Component = () => {
  const store = useDocument();
  let toolbarRef: HTMLDivElement | undefined;

  // Roving tabindex: only active tool button is tabbable
  const [focusedIndex, setFocusedIndex] = createSignal(0);

  // Keep focusedIndex in sync with activeTool
  createEffect(() => {
    const idx = TOOLS.findIndex((t) => t.id === store.activeTool());
    if (idx >= 0) setFocusedIndex(idx);
  });

  // Keyboard shortcuts for tool selection
  onMount(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      );
    };

    const unsubscribe = tinykeys(window, {
      v: (e) => { if (!isTyping()) { e.preventDefault(); store.setActiveTool("select"); } },
      f: (e) => { if (!isTyping()) { e.preventDefault(); store.setActiveTool("frame"); } },
      r: (e) => { if (!isTyping()) { e.preventDefault(); store.setActiveTool("rectangle"); } },
      o: (e) => { if (!isTyping()) { e.preventDefault(); store.setActiveTool("ellipse"); } },
    });

    onCleanup(unsubscribe);
  });

  function handleToolbarKeydown(e: KeyboardEvent) {
    const len = TOOLS.length;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = (focusedIndex() + 1) % len;
      setFocusedIndex(next);
      store.setActiveTool(TOOLS[next].id);
      (toolbarRef?.children[next + 1] as HTMLElement)?.focus(); // +1 for logo
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = (focusedIndex() - 1 + len) % len;
      setFocusedIndex(prev);
      store.setActiveTool(TOOLS[prev].id);
      (toolbarRef?.children[prev + 1] as HTMLElement)?.focus();
    }
  }

  return (
    <div
      ref={toolbarRef}
      class="toolbar"
      role="toolbar"
      aria-label="Design tools"
      aria-orientation="vertical"
      onKeyDown={handleToolbarKeydown}
    >
      <div class="toolbar__logo" aria-hidden="true">S</div>
      <For each={TOOLS}>
        {(tool, index) => (
          <button
            class="toolbar__btn"
            role="button"
            aria-pressed={store.activeTool() === tool.id}
            aria-label={`${tool.label} (${tool.shortcut})`}
            tabindex={focusedIndex() === index() ? 0 : -1}
            onClick={() => store.setActiveTool(tool.id)}
          >
            {tool.icon}
          </button>
        )}
      </For>
    </div>
  );
};
```

- [ ] **Step 3: Verify compilation**

```bash
pnpm --prefix frontend build
```

Expected: May have import errors from App.tsx (Canvas, StatusBar not yet created). That's fine — we'll fix in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shell/Toolbar.tsx frontend/src/shell/Toolbar.css
git commit -m "feat(frontend): add Solid Toolbar component (Plan 08a, Task 4)"
```

---

## Task 5: Create Solid Canvas wrapper

**Files:**
- Create: `frontend/src/shell/Canvas.tsx`
- Create: `frontend/src/shell/Canvas.css`

- [ ] **Step 1: Create Canvas CSS**

Create `frontend/src/shell/Canvas.css`:

```css
.canvas-container {
  width: 100%;
  height: 100%;
  position: relative;
}

.canvas-container__canvas {
  display: block;
  width: 100%;
  height: 100%;
}
```

- [ ] **Step 2: Create Canvas component**

Create `frontend/src/shell/Canvas.tsx`:

```tsx
import { createEffect, createSignal, onMount, onCleanup, type Component } from "solid-js";
import { useDocument } from "../store/document-context";
import { render as renderCanvas } from "../canvas/renderer";
import { hitTest } from "../canvas/hit-test";
import { screenToWorld, zoomAt, type Viewport } from "../canvas/viewport";
import { createToolManager } from "../tools/tool-manager";
import { createSelectTool } from "../tools/select-tool";
import { createShapeTool } from "../tools/shape-tool";
import type { ToolType } from "../store/document-store-solid";
import type { ToolEvent } from "../tools/tool-manager";
import tinykeys from "tinykeys";
import "./Canvas.css";

/** Minimum zoom factor. */
const MIN_ZOOM = 0.1;
/** Maximum zoom factor. */
const MAX_ZOOM = 10;
/** Sensitivity of scroll-wheel zoom. */
const ZOOM_SENSITIVITY = 0.002;

export const Canvas: Component = () => {
  let canvasRef: HTMLCanvasElement | undefined;
  const store = useDocument();

  // Preview state for tool feedback (signals so canvas effect re-triggers)
  const [previewTransform, setPreviewTransform] = createSignal<
    { uuid: string; transform: import("../types/document").Transform } | null
  >(null);
  const [previewRect, setPreviewRect] = createSignal<
    { x: number; y: number; width: number; height: number } | null
  >(null);
  const [cursor, setCursor] = createSignal("default");

  // Space key tracking for grab cursor
  const [spaceHeld, setSpaceHeld] = createSignal(false);

  onMount(() => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;

    // ── Tool setup ───────────────────────────────────────────────────

    // Create a store-compatible adapter for tools that expect the old API
    const storeAdapter = {
      getAllNodes: () => {
        const nodesObj = store.state.nodes;
        const map = new Map<string, import("../types/document").DocumentNode>();
        for (const [uuid, node] of Object.entries(nodesObj)) {
          map.set(uuid, node);
        }
        return map as ReadonlyMap<string, import("../types/document").DocumentNode>;
      },
      getSelectedNodeId: () => store.selectedNodeId(),
      select: (uuid: string | null) => store.setSelectedNodeId(uuid),
      setTransform: (uuid: string, t: import("../types/document").Transform) => store.setTransform(uuid, t),
      createNode: (kind: import("../types/document").NodeKind, name: string, t: import("../types/document").Transform) =>
        store.createNode(kind, name, t),
    };

    const selectTool = createSelectTool(storeAdapter as Parameters<typeof createSelectTool>[0]);

    const makeShapeTool = (kind: () => import("../types/document").NodeKind, prefix: string) =>
      createShapeTool(
        storeAdapter as Parameters<typeof createShapeTool>[0],
        kind,
        prefix,
        () => store.setActiveTool("select"),
      );

    const frameKind = () => ({ type: "frame" as const, layout: null });
    const rectKind = () => ({ type: "rectangle" as const, corner_radii: [0, 0, 0, 0] as [number, number, number, number] });
    const ellipseKind = () => ({ type: "ellipse" as const, arc_start: 0, arc_end: Math.PI * 2 });

    const toolImpls = new Map<ToolType, import("../tools/tool-manager").Tool>([
      ["select", selectTool],
      ["frame", makeShapeTool(frameKind, "Frame")],
      ["rectangle", makeShapeTool(rectKind, "Rectangle")],
      ["ellipse", makeShapeTool(ellipseKind, "Ellipse")],
    ]);

    const toolManager = createToolManager(toolImpls, "select");

    // Sync tool manager with store's active tool signal
    createEffect(() => {
      toolManager.setActiveTool(store.activeTool());
      setCursor(toolManager.getCursor());
    });

    // ── Pointer events ───────────────────────────────────────────────

    function makeToolEvent(e: PointerEvent): ToolEvent {
      const rect = canvasRef!.getBoundingClientRect();
      const vp = store.viewport();
      const [wx, wy] = screenToWorld(vp, e.clientX - rect.left, e.clientY - rect.top);
      return {
        worldX: wx,
        worldY: wy,
        screenX: e.clientX - rect.left,
        screenY: e.clientY - rect.top,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      };
    }

    canvasRef.addEventListener("pointerdown", (e) => {
      toolManager.onPointerDown(makeToolEvent(e));
      // Update previews
      if ("getPreviewTransform" in selectTool) {
        setPreviewTransform(selectTool.getPreviewTransform());
      }
    });

    canvasRef.addEventListener("pointermove", (e) => {
      toolManager.onPointerMove(makeToolEvent(e));
      // Update previews
      if ("getPreviewTransform" in selectTool) {
        setPreviewTransform(selectTool.getPreviewTransform());
      }
      const activeTool = toolImpls.get(store.activeTool());
      if (activeTool && "getPreviewRect" in activeTool) {
        setPreviewRect((activeTool as ReturnType<typeof createShapeTool>).getPreviewRect());
      }
      setCursor(toolManager.getCursor());
    });

    canvasRef.addEventListener("pointerup", (e) => {
      toolManager.onPointerUp(makeToolEvent(e));
      setPreviewTransform(null);
      setPreviewRect(null);
      setCursor(toolManager.getCursor());
    });

    // ── Viewport: pan & zoom ─────────────────────────────────────────

    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartVp: Viewport = { x: 0, y: 0, zoom: 1 };

    canvasRef.addEventListener("wheel", (e) => {
      e.preventDefault();
      const vp = store.viewport();
      if (e.ctrlKey || e.metaKey) {
        // Zoom at cursor
        const rect = canvasRef!.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        store.setViewport(zoomAt(vp, sx, sy, -e.deltaY * ZOOM_SENSITIVITY));
      } else {
        // Pan
        store.setViewport({ ...vp, x: vp.x - e.deltaX, y: vp.y - e.deltaY });
      }
    }, { passive: false });

    canvasRef.addEventListener("pointerdown", (e) => {
      if (e.button === 1 || (e.button === 0 && spaceHeld())) {
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panStartVp = store.viewport();
        canvasRef!.setPointerCapture(e.pointerId);
        setCursor("grabbing");
      }
    });

    window.addEventListener("pointermove", (e) => {
      if (isPanning) {
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        store.setViewport({
          ...panStartVp,
          x: panStartVp.x + dx,
          y: panStartVp.y + dy,
        });
      }
    });

    window.addEventListener("pointerup", () => {
      if (isPanning) {
        isPanning = false;
        setCursor(spaceHeld() ? "grab" : toolManager.getCursor());
      }
    });

    // ── Keyboard shortcuts ───────────────────────────────────────────

    const isTyping = () => {
      const el = document.activeElement;
      return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      );
    };

    const unbindKeys = tinykeys(window, {
      "$mod+z": (e) => { if (!isTyping()) { e.preventDefault(); store.undo(); } },
      "$mod+Shift+z": (e) => { if (!isTyping()) { e.preventDefault(); store.redo(); } },
      "$mod+y": (e) => { if (!isTyping()) { e.preventDefault(); store.redo(); } },
      "$mod+0": (e) => { e.preventDefault(); store.setViewport({ x: 0, y: 0, zoom: 1 }); },
      "$mod+Equal": (e) => {
        e.preventDefault();
        const vp = store.viewport();
        const rect = canvasRef!.getBoundingClientRect();
        store.setViewport(zoomAt(vp, rect.width / 2, rect.height / 2, 0.2));
      },
      "$mod+Minus": (e) => {
        e.preventDefault();
        const vp = store.viewport();
        const rect = canvasRef!.getBoundingClientRect();
        store.setViewport(zoomAt(vp, rect.width / 2, rect.height / 2, -0.2));
      },
    });

    // Space key for grab cursor
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Space" && !isTyping()) {
        e.preventDefault();
        setSpaceHeld(true);
        setCursor("grab");
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") {
        setSpaceHeld(false);
        setCursor(toolManager.getCursor());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // ── Resize observer ──────────────────────────────────────────────

    const observer = new ResizeObserver(([entry]) => {
      const dpr = window.devicePixelRatio || 1;
      canvasRef!.width = entry.contentRect.width * dpr;
      canvasRef!.height = entry.contentRect.height * dpr;
    });
    observer.observe(canvasRef);

    // ── THE KEY: createEffect reads signals → triggers render ────────

    createEffect(() => {
      const nodesObj = store.state.nodes;
      const pages = store.state.pages;
      const selected = store.selectedNodeId();
      const vp = store.viewport();
      const preview = previewTransform();
      const prevRect = previewRect();
      const dpr = window.devicePixelRatio || 1;

      // Convert nodes Record to array for renderer
      const nodesArray = Object.values(nodesObj);

      renderCanvas(
        ctx,
        vp,
        nodesArray,
        selected,
        dpr,
        prevRect,
        preview,
      );
    });

    // ── Cleanup ──────────────────────────────────────────────────────

    onCleanup(() => {
      observer.disconnect();
      unbindKeys();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    });
  });

  return (
    <canvas
      ref={canvasRef}
      class="canvas-container__canvas"
      role="main"
      aria-label="Design canvas"
      tabindex={0}
      style={{ cursor: cursor() }}
    />
  );
};
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/shell/Canvas.tsx frontend/src/shell/Canvas.css
git commit -m "feat(frontend): add Solid Canvas wrapper with createEffect render (Plan 08a, Task 5)"
```

---

## Task 6: Migrate StatusBar to Solid component

**Files:**
- Create: `frontend/src/shell/StatusBar.tsx`
- Create: `frontend/src/shell/StatusBar.css`

- [ ] **Step 1: Create StatusBar CSS**

Create `frontend/src/shell/StatusBar.css`:

```css
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  font-size: 11px;
  color: var(--text-2, #a6adc8);
  background: var(--surface-2, #181825);
  border-top: 1px solid var(--surface-3, #313244);
  user-select: none;
}

.status-bar__left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-bar__right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-bar__indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-bar__indicator--connected {
  background: #a6e3a1;
}

.status-bar__indicator--disconnected {
  background: #f38ba8;
}
```

- [ ] **Step 2: Create StatusBar component**

Create `frontend/src/shell/StatusBar.tsx`:

```tsx
import { Show, type Component } from "solid-js";
import { useDocument } from "../store/document-context";
import "./StatusBar.css";

export const StatusBar: Component = () => {
  const store = useDocument();

  const zoomPercent = () => Math.round(store.viewport().zoom * 100);

  return (
    <div class="status-bar" role="status" aria-live="polite">
      <div class="status-bar__left">
        <div
          class={`status-bar__indicator ${
            store.connected()
              ? "status-bar__indicator--connected"
              : "status-bar__indicator--disconnected"
          }`}
          aria-label={store.connected() ? "Connected" : "Disconnected"}
        />
        <span>{store.connected() ? "Connected" : "Disconnected"}</span>
      </div>
      <div class="status-bar__right">
        <Show when={store.state.info.name}>
          <span>{store.state.info.name}</span>
        </Show>
        <span>{store.state.info.node_count} nodes</span>
        <span>{store.state.info.page_count} pages</span>
        <span>{zoomPercent()}%</span>
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/shell/StatusBar.tsx frontend/src/shell/StatusBar.css
git commit -m "feat(frontend): add Solid StatusBar component (Plan 08a, Task 6)"
```

---

## Task 7: Wire up main.ts and delete vanilla shell

**Files:**
- Modify: `frontend/src/main.ts`
- Delete: `frontend/src/shell/app-shell.ts`
- Delete: `frontend/src/store/document-store.ts`
- Delete: `frontend/src/graphql/client.ts`

- [ ] **Step 1: Rewrite main.ts**

Replace `frontend/src/main.ts` with:

```typescript
import { render } from "solid-js/web";
import App from "./App";
import "./styles/global.css";

const root = document.getElementById("app");
if (!root) throw new Error("Root element #app not found");

render(() => <App />, root);
```

Note: `main.ts` needs to be renamed to `main.tsx` for JSX support, OR we keep it as `.ts` and import the component without JSX. Let's rename it:

```bash
mv frontend/src/main.ts frontend/src/main.tsx
```

Then update `frontend/index.html` (if it references `main.ts`):

Check `frontend/index.html` for the script tag and update if needed.

- [ ] **Step 2: Update Vite entry point if needed**

Read `frontend/index.html` to check the script src path. If it points to `/src/main.ts`, update to `/src/main.tsx`.

- [ ] **Step 3: Delete old files**

```bash
rm frontend/src/shell/app-shell.ts
rm frontend/src/store/document-store.ts
rm frontend/src/graphql/client.ts
```

- [ ] **Step 4: Delete old tests that reference deleted files**

The old tests in `frontend/src/shell/__tests__/` and `frontend/src/store/__tests__/` reference the deleted files. Remove them:

```bash
rm -r frontend/src/shell/__tests__/
rm -r frontend/src/store/__tests__/
```

These will be replaced with new tests in Task 8.

- [ ] **Step 5: Verify the app builds and runs**

```bash
pnpm --prefix frontend build
```

Expected: Build succeeds. If there are import errors, fix them (the old `document-store.ts` may be imported from tool files — update those imports to use the new store adapter pattern from Canvas.tsx).

- [ ] **Step 6: Fix any remaining imports**

The tool files (`select-tool.ts`, `shape-tool.ts`, `tool-manager.ts`) may import from the old `document-store.ts`. Check each and update if needed. The tools should work with their existing interface — the Canvas component creates a store adapter that satisfies their expected API.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(frontend): wire Solid App root, delete vanilla shell (Plan 08a, Task 7)"
```

---

## Task 8: Add tests for new components

**Files:**
- Create: `frontend/src/shell/__tests__/Toolbar.test.tsx`
- Create: `frontend/src/shell/__tests__/StatusBar.test.tsx`
- Create: `frontend/src/store/__tests__/document-store-solid.test.tsx`

- [ ] **Step 1: Create Toolbar test**

Create `frontend/src/shell/__tests__/Toolbar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { Toolbar } from "../Toolbar";
import { DocumentProvider } from "../../store/document-context";
import type { DocumentStoreAPI } from "../../store/document-store-solid";

function createMockStore(overrides?: Partial<DocumentStoreAPI>): DocumentStoreAPI {
  const [activeTool, setActiveTool] = (() => {
    let value: import("../../store/document-store-solid").ToolType = "select";
    return [
      () => value,
      (t: import("../../store/document-store-solid").ToolType) => { value = t; },
    ] as const;
  })();

  return {
    state: { info: { name: "", page_count: 0, node_count: 0, can_undo: false, can_redo: false }, pages: [], nodes: {} },
    selectedNodeId: () => null,
    setSelectedNodeId: vi.fn(),
    activeTool,
    setActiveTool,
    viewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: vi.fn(),
    connected: () => true,
    canUndo: () => false,
    canRedo: () => false,
    createNode: vi.fn(() => ""),
    setTransform: vi.fn(),
    renameNode: vi.fn(),
    deleteNode: vi.fn(),
    setVisible: vi.fn(),
    setLocked: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    client: {} as DocumentStoreAPI["client"],
    ...overrides,
  } as DocumentStoreAPI;
}

describe("Toolbar", () => {
  it("renders 4 tool buttons", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <Toolbar />
      </DocumentProvider>
    ));
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(4);
  });

  it("marks active tool as pressed", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <Toolbar />
      </DocumentProvider>
    ));
    const selectBtn = screen.getByLabelText(/Select/);
    expect(selectBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("has toolbar role with vertical orientation", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <Toolbar />
      </DocumentProvider>
    ));
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.getAttribute("aria-orientation")).toBe("vertical");
  });
});
```

- [ ] **Step 2: Create StatusBar test**

Create `frontend/src/shell/__tests__/StatusBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { StatusBar } from "../StatusBar";
import { DocumentProvider } from "../../store/document-context";
import type { DocumentStoreAPI } from "../../store/document-store-solid";

function createMockStore(overrides?: Partial<DocumentStoreAPI>): DocumentStoreAPI {
  return {
    state: { info: { name: "Test Doc", page_count: 2, node_count: 5, can_undo: false, can_redo: false }, pages: [], nodes: {} },
    selectedNodeId: () => null,
    setSelectedNodeId: vi.fn(),
    activeTool: () => "select" as const,
    setActiveTool: vi.fn(),
    viewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: vi.fn(),
    connected: () => true,
    canUndo: () => false,
    canRedo: () => false,
    createNode: vi.fn(() => ""),
    setTransform: vi.fn(),
    renameNode: vi.fn(),
    deleteNode: vi.fn(),
    setVisible: vi.fn(),
    setLocked: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    client: {} as DocumentStoreAPI["client"],
    ...overrides,
  } as DocumentStoreAPI;
}

describe("StatusBar", () => {
  it("shows connected status", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <StatusBar />
      </DocumentProvider>
    ));
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("shows document info", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <StatusBar />
      </DocumentProvider>
    ));
    expect(screen.getByText("Test Doc")).toBeTruthy();
    expect(screen.getByText("5 nodes")).toBeTruthy();
    expect(screen.getByText("2 pages")).toBeTruthy();
  });

  it("shows zoom percentage", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <StatusBar />
      </DocumentProvider>
    ));
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("has status role with aria-live", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <StatusBar />
      </DocumentProvider>
    ));
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm --prefix frontend test
```

Expected: All new tests pass. Some old tests may fail if they reference deleted files — remove those tests.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shell/__tests__/ frontend/src/store/__tests__/
git commit -m "test(frontend): add Toolbar and StatusBar component tests (Plan 08a, Task 8)"
```

---

## Task 9: Final verification and cleanup

**Files:**
- Various (lint fixes, import cleanup)

- [ ] **Step 1: Run full lint**

```bash
pnpm --prefix frontend lint
```

Fix any ESLint errors.

- [ ] **Step 2: Run format**

```bash
pnpm --prefix frontend format
```

- [ ] **Step 3: Run tests**

```bash
pnpm --prefix frontend test
```

Expected: All tests pass.

- [ ] **Step 4: Run build**

```bash
pnpm --prefix frontend build
```

Expected: Production build succeeds.

- [ ] **Step 5: Manual smoke test**

Start the dev server and verify in the browser:

```bash
pnpm --prefix frontend dev
```

Check:
- [ ] Grid layout renders correctly (toolbar | left panel | canvas | right panel | status bar)
- [ ] Tool buttons work (click to select, keyboard shortcuts V/F/R/O)
- [ ] Canvas renders nodes (if connected to server)
- [ ] Canvas pan/zoom works (scroll, ctrl+scroll, middle-click, space+drag)
- [ ] Status bar shows connection state, document info, zoom %
- [ ] Undo/redo shortcuts work (Ctrl+Z, Ctrl+Shift+Z)
- [ ] Creating shapes works (select frame/rect/ellipse tool, drag on canvas)
- [ ] Selecting nodes works (click on node)
- [ ] Moving nodes works (drag selected node)

- [ ] **Step 6: Final commit if any fixes**

```bash
git add -A
git commit -m "chore(frontend): lint fixes and cleanup (Plan 08a, Task 9)"
```

---

## Summary

This plan migrates the frontend shell in 9 tasks:

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Add `@urql/solid`, remove `urql` | `package.json` |
| 2 | Create Solid document store + context | `document-store-solid.tsx`, `document-context.tsx` |
| 3 | Create `<App>` root component | `App.tsx`, `App.css` |
| 4 | Migrate Toolbar | `Toolbar.tsx`, `Toolbar.css` |
| 5 | Create Canvas wrapper | `Canvas.tsx`, `Canvas.css` |
| 6 | Migrate StatusBar | `StatusBar.tsx`, `StatusBar.css` |
| 7 | Wire main.tsx, delete vanilla shell | `main.tsx`, delete `app-shell.ts`, `document-store.ts`, `client.ts` |
| 8 | Add tests | Toolbar + StatusBar tests |
| 9 | Final verification | Lint, format, build, smoke test |

After this plan completes, Plan 08b adds the panel system (TabRegion, panel registry, SchemaPanel, FieldRenderer).
