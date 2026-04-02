# Tools & Interactions — Implementation Plan (04b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable creating and manipulating nodes on the canvas — tool state machine (select/frame/rect/ellipse), hit testing for selection, drag-to-create shapes, and drag-to-move selected nodes. Requires server-side document state endpoint and server-assigned NodeId for creation.

**Architecture:** The server gains a `/api/document/full` endpoint returning all pages, nodes, and transitions. Node creation is handled by the server: the client sends a `create_node_request` message (UUID + kind + name + page_id + transform), and the server creates the CreateNode command with the correct NodeId. The frontend adds a `ToolManager` that tracks the active tool and dispatches mouse events to tool-specific handlers. Each tool (Select, Frame, Rectangle, Ellipse) is a state machine handling mousedown → mousemove → mouseup. Selection state lives in the store.

**Tech Stack:** TypeScript 6, Vite 8, Vitest 4, HTML5 Canvas 2D, Axum (server endpoints)

**IMPORTANT:** Your FIRST action before writing ANY code must be to read `CLAUDE.md` in full. Rules in CLAUDE.md take precedence. Frontend: strict TS, no `any`, Vitest, accessibility. Server: `anyhow`, mutations through `Document::execute`. Security: no innerHTML, defensive JSON parsing.

---

## File Structure

```
# Server changes
crates/server/src/
├── routes/
│   ├── document.rs      # MODIFY: add /api/document/full endpoint
│   └── ws.rs            # MODIFY: add create_node_request message type
├── state.rs             # MODIFY: add active_page tracking

# Frontend changes
frontend/src/
├── tools/
│   ├── tool-manager.ts  # NEW: tool state machine, tool switching
│   ├── select-tool.ts   # NEW: click to select, drag to move
│   ├── shape-tool.ts    # NEW: drag to create rectangle/ellipse/frame
│   └── __tests__/
│       ├── tool-manager.test.ts
│       └── shape-tool.test.ts
├── canvas/
│   ├── hit-test.ts      # NEW: point-in-node testing
│   ├── renderer.ts      # MODIFY: draw selection handles, tool preview
│   └── __tests__/
│       └── hit-test.test.ts
├── store/
│   └── document-store.ts # MODIFY: populate nodes from full endpoint, selection state
├── shell/
│   └── app-shell.ts     # MODIFY: wire tool manager, tool switching shortcuts
├── types/
│   ├── commands.ts      # MODIFY: add createNodeRequest helper
│   └── messages.ts      # MODIFY: add create_node_request client message
```

---

## Task 1: Server — add full document state endpoint

**Files:**
- Modify: `crates/server/src/routes/document.rs`
- Modify: `crates/server/src/routes/mod.rs`
- Modify: `crates/server/src/lib.rs`

- [ ] 1. Read `CLAUDE.md` in full. Server uses `anyhow`.

- [ ] 2. Add a `/api/document/full` endpoint to `crates/server/src/routes/document.rs` that returns the full document state: pages with their nodes serialized as JSON. This endpoint acquires the document lock, iterates all pages, serializes each page's nodes using core's `page_to_serialized`, and returns the result as JSON.

The response shape:
```json
{
  "info": { "name": "...", "page_count": 1, "node_count": 5, "can_undo": false, "can_redo": false },
  "pages": [
    {
      "id": "uuid",
      "name": "Home",
      "nodes": [ /* SerializedNode objects */ ],
      "transitions": [ /* SerializedTransition objects */ ]
    }
  ]
}
```

Use `agent_designer_core::serialize::page_to_serialized` to get `SerializedPage` for each page, then serialize the whole response to JSON.

- [ ] 3. Add the route to the router in `lib.rs`: `.route("/api/document/full", get(routes::document::get_document_full))`

- [ ] 4. Add an integration test that starts the server and verifies the endpoint returns valid JSON with the expected shape.

- [ ] 5. Run tests, clippy, fmt. Commit: `feat(server): add /api/document/full endpoint returning pages + nodes (spec-04)`

---

## Task 2: Server — handle create_node_request from client

**Files:**
- Modify: `crates/server/src/routes/ws.rs`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Add a new `ClientMessage` variant for node creation where the server assigns the NodeId:

```rust
/// Client requests node creation. Server assigns the NodeId.
CreateNodeRequest {
    uuid: Uuid,
    kind: serde_json::Value, // NodeKind as JSON
    name: String,
    page_id: Option<Uuid>,
    transform: serde_json::Value, // Transform as JSON
},
```

- [ ] 3. In `process_client_message`, handle `CreateNodeRequest` by:
   - Acquiring the document lock
   - Creating a `Node` from the provided fields (deserialize kind and transform from JSON)
   - Inserting the node into the arena to get the assigned `NodeId`
   - If `page_id` is set, adding the node as a root node on that page
   - Setting the transform via a `SetTransform` command
   - Broadcasting the creation to other clients
   - Returning the assigned `NodeId` to the originating client in a new `ServerMessage::NodeCreated { uuid, node_id }` response

- [ ] 4. Add a test. Commit: `feat(server): handle create_node_request with server-assigned NodeId (spec-04)`

---

## Task 3: Frontend — populate store from full document endpoint

**Files:**
- Modify: `frontend/src/store/document-store.ts`
- Modify: `frontend/src/types/messages.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Update `loadInitialState()` in the store to fetch `/api/document/full` instead of `/api/document`. Parse the response and populate:
   - `pages` array from `response.pages`
   - `nodes` Map from all nodes across all pages (keyed by UUID)
   - `info` from `response.info`
   - Track `activePage` (default to first page)

- [ ] 3. Update the broadcast handler to re-fetch the full state (or apply the broadcast command incrementally — for now, re-fetch is fine since it's debounced).

- [ ] 4. Add `createNodeRequest(uuid, kind, name, pageId, transform)` message type and helper to `messages.ts`:

```typescript
| { type: "create_node_request"; uuid: string; kind: NodeKind; name: string; page_id: string | null; transform: Transform }
```

- [ ] 5. Add `ServerMessage` variant for node creation response:

```typescript
| { type: "node_created"; uuid: string; node_id: NodeId }
```

- [ ] 6. Add `createNode(kind, name, transform)` method to the store that:
   - Generates a UUID via `crypto.randomUUID()`
   - Sends a `create_node_request` message
   - Returns the UUID (the NodeId will come back asynchronously via `node_created`)

- [ ] 7. Add `selectedNodeId: string | null` to the store state with `select(uuid)` and `getSelectedNodeId()` methods.

- [ ] 8. Add tests. Commit: `feat(frontend): populate store from full document endpoint, add node creation and selection (spec-04)`

---

## Task 4: Frontend — hit testing

**Files:**
- Create: `frontend/src/canvas/hit-test.ts`
- Create: `frontend/src/canvas/__tests__/hit-test.test.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create `hit-test.ts` with a function that tests if a world-space point is inside a node's bounding box:

```typescript
export function hitTest(
  nodes: ReadonlyMap<string, DocumentNode>,
  worldX: number,
  worldY: number,
): DocumentNode | null
```

The function iterates nodes in reverse order (top-most first in z-order) and returns the first node whose transform bounding box contains the point. For rotated nodes, use an axis-aligned bounding box approximation. Skip invisible and locked nodes.

- [ ] 3. Write tests covering: hit inside a node, hit outside, hit with multiple overlapping nodes (returns top-most), invisible nodes skipped, locked nodes skipped.

- [ ] 4. Commit: `feat(frontend): add hit testing for canvas node selection (spec-04)`

---

## Task 5: Frontend — tool state machine

**Files:**
- Create: `frontend/src/tools/tool-manager.ts`
- Create: `frontend/src/tools/__tests__/tool-manager.test.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create the tool manager with:

```typescript
export type ToolType = "select" | "frame" | "rectangle" | "ellipse";

export interface ToolEvent {
  worldX: number;
  worldY: number;
  screenX: number;
  screenY: number;
  shiftKey: boolean;
  altKey: boolean;
}

export interface Tool {
  onPointerDown(event: ToolEvent): void;
  onPointerMove(event: ToolEvent): void;
  onPointerUp(event: ToolEvent): void;
  getCursor(): string;
}

export interface ToolManager {
  getActiveTool(): ToolType;
  setActiveTool(tool: ToolType): void;
  onPointerDown(event: ToolEvent): void;
  onPointerMove(event: ToolEvent): void;
  onPointerUp(event: ToolEvent): void;
  getCursor(): string;
  subscribe(fn: () => void): () => void;
}
```

The tool manager holds the active tool type and delegates pointer events to the active tool implementation. Tool switching notifies subscribers (for cursor and toolbar updates).

- [ ] 3. Write tests: tool switching, event delegation, cursor changes, subscriber notification.

- [ ] 4. Commit: `feat(frontend): add tool state machine with select/frame/rect/ellipse (spec-04)`

---

## Task 6: Frontend — select tool (click to select, drag to move)

**Files:**
- Create: `frontend/src/tools/select-tool.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create the select tool that:
   - On pointerdown: performs hit test at world coordinates. If a node is hit, select it in the store and begin drag tracking. If no node is hit, deselect.
   - On pointermove (during drag): compute the delta from the drag start, create a `set_transform` command with the new position, send it via the store.
   - On pointerup: finalize the move.
   - getCursor: returns `"default"` normally, `"move"` when hovering a node, `"grabbing"` during drag.

The select tool needs access to: the document store (for hit testing nodes, selection, and sending commands), and the viewport (for coordinate conversion).

- [ ] 3. Commit: `feat(frontend): add select tool — click to select, drag to move (spec-04)`

---

## Task 7: Frontend — shape tools (drag to create frame/rect/ellipse)

**Files:**
- Create: `frontend/src/tools/shape-tool.ts`
- Create: `frontend/src/tools/__tests__/shape-tool.test.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. Create a generic shape tool factory that:
   - On pointerdown: record the start world position.
   - On pointermove: compute the rectangle from start to current (handle negative width/height by swapping). Store the preview rectangle for rendering.
   - On pointerup: if the rectangle has non-zero area, call `store.createNode(kind, name, transform)` with the computed transform. Switch to select tool and select the new node.
   - getCursor: returns `"crosshair"`.
   - The factory takes the `NodeKind` generator and name prefix as parameters:
     - Frame: `{ type: "frame", layout: null }`, "Frame N"
     - Rectangle: `{ type: "rectangle", corner_radii: [0,0,0,0] }`, "Rectangle N"
     - Ellipse: `{ type: "ellipse", arc_start: 0, arc_end: 360 }`, "Ellipse N"

- [ ] 3. Add a `getPreviewRect()` method that returns the in-progress draw rectangle (or null), so the renderer can show a preview outline during drag.

- [ ] 4. Write tests: drag start/move/end creates correct transform, zero-area drag creates nothing, shift for constrained proportions (future).

- [ ] 5. Commit: `feat(frontend): add shape tools — drag to create frame/rect/ellipse (spec-04)`

---

## Task 8: Frontend — wire tools into app shell

**Files:**
- Modify: `frontend/src/shell/app-shell.ts`
- Modify: `frontend/src/canvas/renderer.ts`

- [ ] 1. Read `CLAUDE.md` in full.

- [ ] 2. In `app-shell.ts`:
   - Create the tool manager with all tool implementations
   - Wire pointerdown/move/up through the tool manager (when not panning)
   - Add keyboard shortcuts: V for select, F for frame, R for rectangle, O for ellipse
   - Update the cursor based on the active tool
   - Add tool indicator to the toolbar (highlight active tool)
   - Pass `store.getSelectedNodeId()` to the renderer instead of `null`

- [ ] 3. In `renderer.ts`:
   - Draw the shape tool's preview rectangle during drag (dashed outline)
   - Draw selection handles (small squares at corners/edges) on the selected node

- [ ] 4. Run full frontend test suite, lint, build. Commit: `feat(frontend): wire tools into app shell — keyboard shortcuts, selection, drag preview (spec-04)`

---

## Task 9: Full verification

- [ ] 1. Frontend: `cd frontend && pnpm test && pnpm lint && pnpm build`
- [ ] 2. Server: `cargo test -p agent-designer-server`
- [ ] 3. Workspace: `cargo test --workspace && cargo clippy --workspace -- -D warnings && cargo fmt --check`
- [ ] 4. Manual test: start server + open browser, verify:
   - Canvas shows nodes if a workfile is loaded
   - V/F/R/O switch tools (cursor changes)
   - Drag with rectangle tool creates a rectangle
   - Click on a node selects it (blue highlight)
   - Drag a selected node moves it
- [ ] 5. Fix any issues, commit.

---

## Deferred Items

### Plan 04c: Essential Panels
- Layer panel with tree view, drag reorder, visibility/lock toggles
- Properties panel with transform editors, style editors
- Pages panel with page navigation

### Plan 04d: Advanced Features
- Pen tool (P), Text tool (T), Components panel, Tokens panel, Inspect mode (I)

### Plan 04e: Responsive + Prototype
- Responsive breakpoints, Prototype panel
