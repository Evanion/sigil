# Frontend Foundation — Implementation Plan (04a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frontend foundation — TypeScript types mirroring core's wire format, a WebSocket client for real-time sync, a reactive document store, and a Canvas 2D renderer that displays the node tree with pan/zoom.

**Architecture:** Vanilla TypeScript (no framework) with a simple pub/sub store pattern. The WebSocket client connects to `/ws`, sends `ClientMessage` JSON, and receives `ServerMessage` JSON. A `DocumentStore` holds the local document state and notifies subscribers on change. The `CanvasRenderer` draws nodes onto an HTML5 Canvas 2D context with viewport transform (pan/zoom). The app shell provides the overall layout using safe DOM construction methods (no innerHTML — use document.createElement).

**Tech Stack:** TypeScript 6, Vite 8, Vitest 4, HTML5 Canvas 2D, native WebSocket API

**IMPORTANT:** Your FIRST action before writing ANY code must be to read `CLAUDE.md` in full. Rules in CLAUDE.md take precedence over code in this plan if they conflict. TypeScript: strict mode, no `any` types. Tests: Vitest, TDD. Security: NEVER use innerHTML — always use document.createElement and textContent for DOM construction.

---

## File Structure

```
frontend/src/
├── main.ts                  # MODIFY: mount app shell
├── types/
│   ├── document.ts          # NEW: Node, Page, Transform, Style types (mirrors core)
│   ├── commands.ts          # NEW: SerializableCommand, BroadcastCommand types
│   └── messages.ts          # NEW: ClientMessage, ServerMessage types
├── ws/
│   └── client.ts            # NEW: WebSocket client with auto-reconnect
├── store/
│   └── document-store.ts    # NEW: reactive document state store
├── canvas/
│   ├── renderer.ts          # NEW: Canvas 2D renderer
│   └── viewport.ts          # NEW: pan/zoom viewport transform
├── shell/
│   └── app-shell.ts         # NEW: app layout using safe DOM construction
└── styles/
    └── global.css           # NEW: base styles, layout grid
```

The plan contains 6 tasks covering types, WebSocket client, document store, canvas/viewport, app shell, and verification. Each task creates the files listed above with full code, tests, and commit instructions.

**NOTE TO IMPLEMENTERS:** The app shell (Task 5) MUST use `document.createElement` and `textContent` for all DOM construction. Do NOT use `innerHTML` — the project's security hooks will reject it. Build all DOM elements programmatically.

---

## Task 1: Define TypeScript types mirroring core wire format

**Files:**
- Create: `frontend/src/types/document.ts`
- Create: `frontend/src/types/commands.ts`
- Create: `frontend/src/types/messages.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create the three type files matching the core crate's wire format. See the core crate's `wire.rs` for `SerializableCommand`/`BroadcastCommand` variants, and `node.rs` for Node/Transform/Style types. Create TypeScript interfaces that mirror these Rust types. Include `DocumentInfo` matching the `/api/document` response. Use tagged union types for `NodeKind`, `ClientMessage`, and `ServerMessage`. Include helper functions for creating common commands (rename_node, set_visible, set_transform).

- [ ] 3. Run lint and format, commit: `feat(frontend): add TypeScript types mirroring core wire format (spec-04)`

---

## Task 2: Implement WebSocket client with auto-reconnect

**Files:**
- Create: `frontend/src/ws/client.ts`
- Create: `frontend/src/ws/__tests__/client.test.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create a WebSocket client that: connects to a URL, auto-reconnects with exponential backoff (2s initial, 30s max), provides `send(ClientMessage)`, `onMessage(handler)`, `onConnectionChange(handler)`, `close()`, `isConnected()`. Use the native WebSocket API. All handlers return unsubscribe functions.

- [ ] 3. Write tests using a MockWebSocket class (mock `globalThis.WebSocket`). Test: connect on creation, send JSON, notify message handlers, notify connection handlers, unsubscribe, report connection status.

- [ ] 4. Run tests, lint, commit: `feat(frontend): add WebSocket client with auto-reconnect (spec-04)`

---

## Task 3: Implement reactive document store

**Files:**
- Create: `frontend/src/store/document-store.ts`
- Create: `frontend/src/store/__tests__/document-store.test.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create a document store that: holds DocumentInfo + nodes + pages, provides `sendCommand`, `undo`, `redo`, `subscribe`, `loadInitialState` (fetches `/api/document`). On broadcast messages, re-fetch state. On undo_redo/document_changed, update can_undo/can_redo and re-fetch. Use a simple pub/sub pattern with a `Set<Subscriber>`.

- [ ] 3. Write tests with a mock WebSocket. Test: starts with null info, sends undo/redo/command, notifies on connection change, updates undo/redo state, unsubscribes cleanly.

- [ ] 4. Run tests, lint, commit: `feat(frontend): add reactive document store with WebSocket integration (spec-04)`

---

## Task 4: Implement viewport (pan/zoom) and canvas renderer

**Files:**
- Create: `frontend/src/canvas/viewport.ts`
- Create: `frontend/src/canvas/renderer.ts`
- Create: `frontend/src/canvas/__tests__/viewport.test.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create viewport with: `createViewport()`, `screenToWorld(vp, sx, sy)`, `worldToScreen(vp, wx, wy)`, `applyViewport(ctx, vp)`, `zoomAt(vp, sx, sy, delta)` with clamping (0.1-10x).

- [ ] 3. Create renderer with: `render(ctx, viewport, nodes, selectedNodeId)` that clears canvas, applies viewport, draws each visible node based on kind (frame/rect → fillRect, ellipse → arc, text → fillText), draws selection highlight, draws name labels.

- [ ] 4. Write viewport tests: default values, screen-to-world conversions with offset/zoom, round-trip, zoom in/out, clamp.

- [ ] 5. Run tests, lint, commit: `feat(frontend): add viewport pan/zoom and canvas renderer (spec-04)`

---

## Task 5: Create app shell and wire everything together

**Files:**
- Create: `frontend/src/shell/app-shell.ts`
- Create: `frontend/src/styles/global.css`
- Modify: `frontend/src/main.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create global CSS with: full-height layout, 4-column CSS grid (48px toolbar, 240px left panel, 1fr canvas, 280px right panel), dark theme colors, canvas container styles, status bar styles.

- [ ] 3. Create app shell using **ONLY `document.createElement` and `textContent`** — NO innerHTML. Build all DOM elements programmatically:
   - Toolbar div with "SIGIL" text
   - Left panel with "LAYERS" heading placeholder
   - Canvas container with `<canvas>` element
   - Status bar with connection indicator and text
   - Right panel with "PROPERTIES" heading placeholder
   - Wire up: wheel event for pan/zoom, mousedown/move/up for middle-click pan, keydown for Ctrl+Z/Ctrl+Shift+Z undo/redo
   - ResizeObserver on canvas container for responsive canvas sizing with devicePixelRatio
   - Store subscription for re-render on state change
   - requestAnimationFrame-based render batching

- [ ] 4. Update `main.ts` to import CSS, create WebSocket client, create store, mount app shell, load initial state.

- [ ] 5. Run lint, format, build: `cd frontend && pnpm lint && pnpm format:check && pnpm build`

- [ ] 6. Commit: `feat(frontend): add app shell with canvas, pan/zoom, status bar, and undo/redo shortcuts (spec-04)`

---

## Task 6: Full verification

- [ ] 1. Frontend tests: `cd frontend && pnpm test`
- [ ] 2. Frontend lint: `cd frontend && pnpm lint`
- [ ] 3. Frontend build: `cd frontend && pnpm build`
- [ ] 4. Workspace tests: `cargo test --workspace`
- [ ] 5. Fix any issues and commit.

---

## Deferred Items

### Plan 04b: Tools + Interactions
- Select tool (V) with click-to-select, drag-to-move
- Frame tool (F), Rectangle tool (R), Ellipse tool (O)
- Tool state machine, keyboard shortcuts for tool switching

### Plan 04c: Essential Panels
- Layer panel with tree view, drag reorder, visibility/lock toggles
- Properties panel with transform, style editors
- Pages panel with page list and navigation

### Plan 04d: Advanced Features
- Pen tool (P), Text tool (T), Components panel, Tokens panel, Inspect mode (I)

### Plan 04e: Responsive + Prototype
- Responsive breakpoints, Prototype panel
