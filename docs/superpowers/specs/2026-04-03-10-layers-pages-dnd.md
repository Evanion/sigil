# Spec 10: Layers Panel, Pages Panel, DnD Infrastructure

> Sub-spec of the [Agent Designer PDR](2026-04-01-agent-designer-design.md)

## Overview

Populate the left-region tabs with functional content: a layers tree with full Figma-style drag-and-drop (reorder, reparent, indentation-aware depth control), and a pages panel with thumbnail previews, CRUD, and DnD reorder. Both panels are powered by a shared DnD infrastructure built on `dnd-kit-solid`.

This spec is decomposed into three sub-plans:
- **Plan 10a** — DnD infrastructure (library, shared types, tree insertion logic)
- **Plan 10b** — Layers panel (tree view, selection, toggles, DnD)
- **Plan 10c** — Pages panel (list, thumbnails, CRUD, DnD reorder)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| DnD library | `dnd-kit-solid` | Solid-native, supports sortable + droppable + custom collision, `accept` types enable future dockable panels. Higher snippet count and reputation than `@thisbeyond/solid-dnd`. |
| Tree DnD behavior | Full Figma clone | Before/after/inside drops with indentation-aware depth control. Design tool users expect this. Horizontal drag position determines target depth. |
| Pages panel | List with thumbnails | Small canvas-rendered thumbnails per page aid visual identification. Establishes offscreen rendering pipeline reused by component library panel (future). |
| Pages CRUD | Core commands | `CreatePage`, `DeletePage`, `RenamePage` already exist from PR #22 remediation. `ReorderPages` needs a new command. |

## DnD Infrastructure (Plan 10a)

### Library Setup

Install `dnd-kit-solid` and wrap the app in a `<DragDropProvider>`.

```
<DragDropProvider>
  <App>
    <TabRegion region="left">
      <LayersPanel />   ← uses useSortable, useDraggable, useDroppable
      <PagesPanel />    ← uses useSortable
    </TabRegion>
    ...
  </App>
</DragDropProvider>
```

### Shared DnD Types

```typescript
/** Where to drop relative to the target node. */
type DropPosition = "before" | "after" | "inside";

/** Full drop target description for tree DnD. */
interface TreeDropTarget {
  /** UUID of the node being dropped on/near. */
  targetUuid: string;
  /** Relative position. */
  position: DropPosition;
  /** Target depth (indentation level) for the dropped node. */
  depth: number;
}
```

### Tree Insertion Logic

The indentation-aware drop detection works by combining vertical and horizontal cursor position:

**Vertical zones** (relative to the hovered node's row):
- Top 25% → `position: "before"`
- Bottom 25% → `position: "after"`
- Middle 50% → `position: "inside"` (only for nodes that can have children: frames, groups)

**Horizontal position** (for before/after drops):
- The cursor's X position relative to the tree's left edge determines the target depth
- Each indentation level is a fixed width (e.g., 20px)
- `depth = Math.floor((cursorX - treeLeftEdge) / INDENT_WIDTH)`
- Clamped between 0 and the maximum valid depth for that insertion point

**Depth clamping rules:**
- When dropping "before" node N: max depth = N's depth (can't be deeper than what you're inserting before)
- When dropping "after" node N: max depth = N's depth + 1 (can nest one level deeper as last child)
- When dropping "inside" node N: depth is N's depth + 1 (always becomes a child)
- Min depth is always 0 (page root level)

### Visual Indicator

A `<TreeDropIndicator>` component renders at the calculated drop position:
- Horizontal line at the correct indentation depth
- Small circle at the left end of the line
- Blue accent color matching selection highlight
- For "inside" drops: highlight the target node's background instead of showing a line

## Layers Panel (Plan 10b)

### Component Tree

```
<LayersPanel>
  <LayersTree page={activePage}>
    <For each={page.rootNodes}>
      <TreeNode node={node} depth={0}>
        <For each={node.children}>
          <TreeNode node={child} depth={1}>
            ...recursive
          </TreeNode>
        </For>
      </TreeNode>
    </For>
  </LayersTree>
</LayersPanel>
```

### TreeNode Component

Each tree node row contains:

```
[indent] [expand toggle] [kind icon] [name] [spacer] [lock toggle] [visibility toggle]
```

- **Indent:** `padding-left: depth * INDENT_WIDTH` (20px per level)
- **Expand toggle:** Chevron (▸/▾) for nodes with children, hidden for leaf nodes
- **Kind icon:** Small icon indicating frame/rectangle/ellipse/text/group/component
- **Name:** Text label, editable on double-click (inline rename via `renameNode`)
- **Lock toggle:** Lock/unlock icon, toggles `setLocked` mutation
- **Visibility toggle:** Eye icon, toggles `setVisible` mutation

### Selection

- Click a tree node → `store.setSelectedNodeId(uuid)` (syncs with canvas)
- Canvas selection → tree scrolls to and highlights the selected node
- Selected node has a highlighted background row

### Expand/Collapse

- Local signal per node: `expandedNodes: Set<string>` (stored as a signal in the panel)
- Click expand toggle → add/remove from set
- Default: root-level nodes expanded, deeper nodes collapsed
- Auto-expand: when a node is selected (via canvas click), expand all ancestors so it's visible

### DnD Behavior

Each `<TreeNode>` is both a drag source and a drop target:

```typescript
const { ref, isDragging } = useDraggable({ id: node.uuid, data: { type: "layer", uuid: node.uuid } });
const { ref: dropRef, isDropTarget } = useDroppable({ id: `drop-${node.uuid}`, accept: "layer" });
```

**On drag start:**
- Show a ghost/preview of the dragged node's name
- Dim the source node in the tree

**On drag over:**
- Calculate `TreeDropTarget` from cursor position (vertical zone + horizontal indent)
- Render `<TreeDropIndicator>` at the calculated position

**On drop:**
- Resolve `TreeDropTarget` to a `ReparentNode` or `ReorderChildren` mutation:
  - `position: "inside"` → `ReparentNode` (new parent = target, position = last child)
  - `position: "before"` at same depth → `ReorderChildren` (sibling reorder)
  - `position: "before"` at different depth → `ReparentNode` to the parent at the target depth
  - `position: "after"` follows similar logic

**Validation:**
- Cannot drop a node inside itself or its descendants (cycle prevention)
- Cannot drop on locked nodes
- Cannot reparent into non-container nodes (only frames and groups accept children)

### GraphQL Mutations Used

- `ReparentNode` (existing) — move node to a different parent at a specific position
- `ReorderChildren` (existing) — change a node's position within its current parent
- `SetVisible` (existing) — toggle visibility
- `SetLocked` (existing) — toggle lock
- `RenameNode` (existing) — inline rename

## Pages Panel (Plan 10c)

### Component Structure

```
<PagesPanel>
  <div class="pages-panel__header">
    <h3>Pages</h3>
    <button aria-label="Add page" onClick={createPage}>+</button>
  </div>
  <SortableList>
    <For each={pages}>
      <PageListItem page={page} isActive={page.id === activePageId} />
    </For>
  </SortableList>
</PagesPanel>
```

### PageListItem Component

Each page row contains:

```
[thumbnail] [name] [active indicator]
```

- **Thumbnail:** 64x48px canvas-rendered preview of the page's nodes
- **Name:** Text label, editable on double-click
- **Active indicator:** Highlight/bold for the currently viewed page
- Click → navigate to page (update `activePageId` signal)
- Double-click → inline rename
- Right-click → context menu (rename, duplicate, delete)
- Drag handle → DnD reorder

### Thumbnail Rendering

Thumbnails are rendered via an offscreen `<canvas>` element:

1. Create an `OffscreenCanvas` (or regular canvas, hidden) at 128x96 (2x for retina, displayed at 64x48)
2. Call the existing `render()` function with a viewport that fits all page nodes
3. Convert to data URL: `canvas.toDataURL("image/png")`
4. Cache the thumbnail per page, keyed by page ID
5. Invalidate when any node on the page changes (debounced, 500ms)
6. Show a placeholder (gray rectangle) while rendering

The renderer is already a pure function — it takes a canvas context, viewport, and nodes array. Reusing it for thumbnails requires only computing the right viewport to fit all page content.

### Page Navigation

- `activePageId` signal in the document store — identifies the currently viewed page
- Clicking a page updates `activePageId`
- The canvas reads `activePageId` to determine which page's nodes to render
- The layers tree reads `activePageId` to show that page's node hierarchy

**Store changes needed:**
- Add `activePageId: () => string | null` signal to `DocumentStoreAPI`
- Add `setActivePageId: (id: string | null) => void`
- Canvas `createEffect` reads `activePageId` to filter which nodes to render

### DnD Reorder

Pages use `useSortable` for simple list reordering:

```typescript
const { ref, isDragging } = useSortable({
  id: page.id,
  index: pageIndex,
  data: { type: "page" },
});
```

**On reorder:** Dispatch `ReorderPages` mutation (new — needs a core command).

### New Core Command: ReorderPages

Add to `crates/core/src/commands/page_commands.rs`:

```rust
pub struct ReorderPage {
    pub page_id: PageId,
    pub new_position: usize,
    pub old_position: usize,
}
```

- `apply`: remove page from `old_position`, insert at `new_position`
- `undo`: remove from `new_position`, insert at `old_position`
- Integration test: `test_reorder_page_execute_undo_redo_cycle`

Also needs a new GraphQL mutation (`reorderPage`) and a new MCP tool (`reorder_page`).

### Page CRUD

- **Create:** Click "+" button → `CreatePage` command (existing) → new page appears at end of list
- **Delete:** Context menu "Delete" → `DeletePage` command (existing) → if deleting active page, switch to first remaining page
- **Rename:** Double-click name → inline text input → `RenamePage` command (existing) on blur/Enter

## Accessibility

### Layers Panel

- `role="tree"` on the tree container
- `role="treeitem"` on each `<TreeNode>` row
- `aria-expanded` on expandable nodes
- `aria-selected` on the selected node
- `aria-level` indicating depth (1-based)
- `aria-setsize` and `aria-posinset` for tree navigation
- Keyboard: Arrow keys navigate the tree (Up/Down = prev/next visible, Left = collapse or go to parent, Right = expand or go to first child)
- Enter = select, F2 = rename, Delete = delete node
- DnD announcement via live region: "Grabbed [name]", "Over [target name], position [before/after/inside]", "Dropped [name] [inside/before/after] [target]"

### Pages Panel

- `role="listbox"` on the page list
- `role="option"` on each page item, `aria-selected` on active page
- Keyboard: Arrow keys navigate, Enter selects, F2 renames, Delete deletes
- DnD announcement: "Grabbed [page name]", "Position [N] of [total]", "Dropped at position [N]"

### DnD Accessibility

- All DnD operations must be achievable via keyboard
- Spacebar initiates drag, arrow keys move, Spacebar drops, Escape cancels
- Live region announces drag state changes
- `dnd-kit-solid` provides built-in keyboard support — wire it to the live region

## File Structure

### New files

```
frontend/src/
├── dnd/
│   ├── DragDropProvider.tsx       # App-level DnD context wrapper
│   ├── types.ts                   # TreeDropTarget, DropPosition
│   ├── tree-insertion.ts          # Indentation-aware drop position calculation
│   └── TreeDropIndicator.tsx      # Visual drop indicator line
├── panels/
│   ├── LayersPanel.tsx            # Replaces placeholder (full implementation)
│   ├── LayersTree.tsx             # Recursive tree renderer
│   ├── TreeNode.tsx               # Single tree node row
│   ├── TreeNode.css               # Tree node styling
│   ├── PagesPanel.tsx             # Replaces placeholder (full implementation)
│   ├── PageListItem.tsx           # Single page row with thumbnail
│   ├── PageListItem.css           # Page item styling
│   └── PageThumbnail.tsx          # Offscreen canvas thumbnail renderer
```

### Modified files

```
frontend/src/App.tsx               # Wrap in DragDropProvider
frontend/src/store/document-store-solid.tsx  # Add activePageId signal
frontend/src/shell/Canvas.tsx      # Filter nodes by activePageId
crates/core/src/commands/page_commands.rs    # Add ReorderPage command
crates/server/src/graphql/mutation.rs        # Add reorderPage mutation
crates/mcp/src/tools/pages.rs               # Add reorder_page tool
```

## Depends On

- Spec 08 (Solid Shell + Panel System — tab regions, panel registry)
- Spec 01 (Core Engine — node tree, arena, commands)
- Spec 02 (Server — GraphQL mutations)

## Depended On By

- Spec 09 (Properties Panel — fill/stroke list DnD reorder uses same DnD infra)
- Future: Component Library Panel (thumbnails reuse offscreen rendering)
- Future: Dockable Panels (DnD accept types enable panel dragging)

## WASM Compatibility

The `ReorderPage` command is added to `crates/core/`. No new dependencies — uses existing `PageId` and `Vec` operations. WASM safe.

## Input Validation

- Tree DnD: cycle detection prevents dropping a node inside its own subtree
- Tree DnD: only frames and groups accept children (non-container nodes reject "inside" drops)
- Page reorder: `new_position` clamped to `0..pages.len()`
- Page name: validated by `validate_page_name` (existing from PR #22)
- Thumbnail rendering: debounced (500ms) to prevent excessive offscreen canvas work

## PDR Traceability

**Implements:**
- PDR "Layers panel with tree view" — full implementation
- PDR "Pages panel with navigation" — full implementation with thumbnails
- PDR "Standard design tool conventions" — Figma-style tree DnD behavior

**Defers:**
- Component library panel → future spec
- Inspect mode → future spec

## Consistency Guarantees

- **DnD operations are atomic:** Each drop resolves to a single core command (`ReparentNode` or `ReorderChildren`). The command's undo/redo restores the exact previous state.
- **Selection survives reparent:** After a `ReparentNode`, the node's UUID is unchanged — `selectedNodeId` remains valid.
- **Thumbnail consistency:** Thumbnails are invalidated on any node change to the page. Debounce prevents stale renders during rapid edits.

## Recursion Safety

- Tree rendering: recursive `<TreeNode>` components are bounded by `MAX_TREE_DEPTH` (existing constant from MCP crate, same 100 limit). The Solid `<For>` loop terminates naturally when `node.children` is empty.
- Tree DnD cycle detection: `isAncestor(draggedUuid, targetUuid)` walks the tree upward. Bounded by tree depth.
- Thumbnail viewport calculation: iterates page root nodes (flat, not recursive).
