# Spec 11a — Viewport Interactions

## Overview

Adds interactive resize, smart guide snapping, multi-select, align/distribute, and group/ungroup to the canvas editor. Transforms the editor from a "create and color shapes" demo into a usable design tool.

**Depends on:** Spec 01 (core engine), Spec 04 (frontend editor + select tool), Spec 08 (panel system)

**Builds on existing:** Select tool with drag-to-move, selection handle rendering (8 handles drawn but non-interactive), `setTransform` mutation pipeline, hit-testing, viewport pan/zoom.

---

## 1. Handle Hit-Testing & Resize

### 1.1 Handle Identification

A new `handle-hit-test.ts` module identifies which resize handle the pointer is over. The 8 handles are:

| Handle | Position | Cursor | Resize Axes |
|--------|----------|--------|-------------|
| NW | top-left corner | `nwse-resize` | x, y, width, height |
| N | top-center edge | `ns-resize` | y, height |
| NE | top-right corner | `nesw-resize` | y, width, height |
| E | right-center edge | `ew-resize` | width |
| SE | bottom-right corner | `nwse-resize` | width, height |
| S | bottom-center edge | `ns-resize` | height |
| SW | bottom-left corner | `nesw-resize` | x, width, height |
| W | left-center edge | `ew-resize` | x, width |

Hit zone: 8×8 pixels in screen space (zoom-independent). When the pointer hovers over a handle, the cursor changes to the appropriate resize cursor.

### 1.2 Resize Behavior (Figma-style Free Resize)

Each handle has an **anchor point** — the opposite corner or edge. During drag, the new transform is computed by measuring from the anchor to the pointer position.

**Modifier keys:**
- **No modifier:** Free resize. Corner handles move both axes, edge handles move one axis.
- **Shift:** Lock aspect ratio. Width and height maintain their original ratio. Applied to corner handles only (edges are inherently single-axis).
- **Alt:** Resize from center. Both the handle and its opposite move equally, keeping the center fixed.
- **Shift + Alt:** Proportional resize from center.

**Minimum size:** 1×1 pixel in world space. The resize math clamps width and height to `>= 1` during drag.

### 1.3 Resize Math Module

A new `resize-math.ts` module exports:

```
computeResize(
  original: Transform,
  handle: HandleType,
  dragDelta: { dx: number; dy: number },
  modifiers: { shift: boolean; alt: boolean }
): Transform
```

Pure function — no side effects, fully testable in isolation. The select tool calls this on every pointer move during a handle drag.

### 1.4 Select Tool State Machine

The select tool's state expands from 2 states to 4:

```
idle
  → pointerdown on handle → resizing
  → pointerdown on node body → moving (existing)
  → pointerdown on empty canvas → marquee-selecting
  → click on node → select (existing)

resizing
  → pointermove → update previewTransform via resize-math
  → pointerup → commit setTransform, return to idle
  → escape → cancel, restore original transform, return to idle

moving (existing, unchanged)
  → pointermove → update previewTransform with delta
  → pointerup → commit setTransform, return to idle

marquee-selecting
  → pointermove → update marquee rectangle, highlight intersecting nodes
  → pointerup → set selection to intersecting nodes, return to idle
  → escape → cancel, return to idle
```

### 1.5 Preview During Drag

During resize (and move), a local `previewTransform` is updated on every pointer move for instant visual feedback. No network calls during drag. On pointerup, a single `setTransform` (or `batchSetTransform` for multi-select) mutation is sent.

---

## 2. Smart Guide Snapping

### 2.1 Snap Engine

A new `snap-engine.ts` module computes snap alignment during move and resize operations.

**Snap targets** (collected from all visible, non-dragged nodes):
- Left edge (x)
- Right edge (x + width)
- Horizontal center (x + width/2)
- Top edge (y)
- Bottom edge (y + height)
- Vertical center (y + height/2)

**Snap sources** (from the node being moved/resized):
- Same 6 points, recomputed on each pointer move based on the current preview transform.

**Algorithm:**
1. On drag start: collect all target snap points into two sorted arrays (X targets, Y targets). Skip the dragged node and its descendants.
2. On each pointer move: binary search each source point against the sorted target arrays. If the nearest match is within the snap threshold, snap to that coordinate.
3. X and Y axes snap independently — a node can snap horizontally without snapping vertically.

**Snap threshold:** 8 pixels in screen space. Divide by viewport zoom to get the world-space threshold: `threshold = 8 / viewport.zoom`.

### 2.2 Guide Line Rendering

When snapping is active, the renderer draws guide lines:
- **Color:** `#ff3366` (pink/red), 1px screen-space width
- **Extent:** Full canvas height for vertical guides, full canvas width for horizontal guides
- **Rendering:** Drawn in screen space after all nodes, on top of everything
- **Multiple guides:** Can show 0–6 guides simultaneously (one per active snap axis match)

Guide lines are computed by the snap engine and passed to the renderer as an array of `{ axis: 'x' | 'y', position: number }` in world coordinates.

### 2.3 Snapping During Resize

The snap engine also works during resize — the edge or corner being dragged snaps to other nodes' edges. The anchor point stays fixed. Only the moving edges participate as snap sources.

---

## 3. Multi-Select

### 3.1 Selection Model Change

The store changes from single selection to multi-selection:

**Before:**
```
selectedNodeId: () => string | null
setSelectedNodeId: (id: string | null) => void
```

**After:**
```
selectedNodeIds: () => string[]
setSelectedNodeIds: (ids: string[]) => void
// Backwards compatibility — derived from selectedNodeIds
selectedNodeId: () => string | null  // returns first selected or null
```

All existing code that reads `selectedNodeId()` continues to work. Panels that should show properties for multiple nodes can read `selectedNodeIds()`.

### 3.2 Selection Interactions

| Action | Behavior |
|--------|----------|
| Click node | Replace selection with that node |
| Shift+click node | Toggle node in/out of selection |
| Cmd/Ctrl+click node | Same as Shift+click |
| Click empty canvas | Clear selection |
| Drag on empty canvas | Marquee select |
| Shift+marquee | Add intersecting nodes to existing selection |
| Cmd/Ctrl+A | Select all nodes on current page |
| Escape | Clear selection |

### 3.3 Marquee Selection

When the user clicks and drags on empty canvas (no node hit), a selection rectangle is drawn. On pointerup, all nodes whose bounding boxes intersect the rectangle are selected.

**Visual:** Dashed blue rectangle with semi-transparent blue fill, drawn in screen space.

**Intersection test:** AABB intersection between the marquee rectangle and each visible, unlocked node's bounding box (in world coordinates).

### 3.4 Multi-Select Bounding Box

When 2+ nodes are selected, the renderer draws:
- Blue selection outline on each individual node
- A compound bounding box (union of all selected bounds) with 8 resize handles
- Handles on the compound box resize all nodes proportionally

### 3.5 Multi-Move and Multi-Resize

**Multi-move:** Apply the same delta to each selected node's position. Preview all nodes during drag. On pointerup, call `batchSetTransform` with all new transforms.

**Multi-resize:** Each node's position and size within the compound bounding box is expressed as relative coordinates (0–1). When the compound box is resized, each node's transform is recomputed from its relative position within the new bounds. This preserves spatial relationships.

---

## 4. Align & Distribute

### 4.1 Alignment Operations

Require 2+ selected nodes. Align relative to the compound bounding box of the selection.

| Operation | Behavior |
|-----------|----------|
| Align left | Set each node's x to the minimum x of the selection |
| Align center | Center each node horizontally within the compound bounds |
| Align right | Set each node's right edge to the maximum right edge |
| Align top | Set each node's y to the minimum y |
| Align middle | Center each node vertically within the compound bounds |
| Align bottom | Set each node's bottom edge to the maximum bottom edge |

### 4.2 Distribute Operations

Require 3+ selected nodes. Distribute spacing evenly.

| Operation | Behavior |
|-----------|----------|
| Distribute horizontal | Equal gaps between nodes (sorted by x position) |
| Distribute vertical | Equal gaps between nodes (sorted by y position) |

Gap = (total available space − sum of node widths) / (count − 1) for horizontal. Same pattern for vertical with heights.

### 4.3 Undo Atomicity

All nodes are moved in a single `batchSetTransform` call → single undo step. Undoing an align reverts all nodes to their pre-align positions at once.

### 4.4 UI Location

**Primary:** "Alignment" section in the Design panel (Layout tab), visible when 2+ nodes are selected. 6 align buttons in a row, 2 distribute buttons below. Uses icon buttons with tooltips.

**Secondary:** Right-click context menu includes "Align" submenu when 2+ nodes are selected.

**Keyboard shortcuts:**
- `Ctrl+Shift+L` — Align left
- `Ctrl+Shift+C` — Align center (horizontal)
- `Ctrl+Shift+R` — Align right
- `Ctrl+Shift+T` — Align top
- `Ctrl+Shift+M` — Align middle (vertical)
- `Ctrl+Shift+B` — Align bottom

---

## 5. Group / Ungroup

### 5.1 Group (Ctrl+G)

Requires 2+ selected nodes.

1. Compute the union bounding box of all selected nodes
2. Create a new node with `kind: { type: "group" }`
3. Set its transform to the union bounding box
4. Reparent all selected nodes into the group, adjusting each child's x/y to be group-relative (subtract group origin from each child's position)
5. Insert the group at the z-position of the topmost selected node
6. Select the new group node

### 5.2 Ungroup (Ctrl+Shift+G)

Requires selection to contain group node(s).

1. For each selected group: reparent its children back to the group's parent
2. Adjust each child's x/y from group-relative back to parent-relative (add group origin to each child's position)
3. Delete the now-empty group nodes
4. Select the ungrouped children

### 5.3 Core Commands

**`GroupNodes` command:**
- Input: list of node UUIDs to group
- Validates: all nodes exist, 2+ nodes
- If nodes have different parents, the group is created under the lowest common ancestor
- Creates group node, reparents children, captures full state for undo
- Single undo step

**`UngroupNodes` command:**
- Input: list of group node UUIDs to ungroup
- Validates: all nodes exist, all are groups
- Reparents children, deletes groups, captures full state for undo
- Single undo step

### 5.4 Nested Groups

Grouping nodes that are already inside a group creates a nested group. Ungrouping removes one level only (the selected group), not recursively.

---

## 6. New Core Commands

### 6.1 BatchSetTransform

```rust
pub struct BatchSetTransform {
    pub entries: Vec<(NodeId, Transform)>,
}
```

Applies all transforms atomically. Single undo step restores all previous transforms. Validates each transform (finite, non-negative dimensions).

### 6.2 GroupNodes

```rust
pub struct GroupNodes {
    pub node_ids: Vec<NodeId>,
    pub group_name: String,
}
```

Creates group, reparents nodes, computes bounding box. Single undo step.

### 6.3 UngroupNodes

```rust
pub struct UngroupNodes {
    pub group_ids: Vec<NodeId>,
}
```

Reparents children out, deletes groups. Single undo step.

All three commands follow the existing pattern: `apply()` → `undo()` → `description()`, return `Result<Vec<SideEffect>, CoreError>`.

---

## 7. GraphQL Mutations

Three new mutations:

```graphql
mutation BatchSetTransform($entries: [TransformEntry!]!) {
  batchSetTransform(entries: $entries) { uuid transform }
}

mutation GroupNodes($uuids: [String!]!, $name: String!) {
  groupNodes(uuids: $uuids, name: $name) { uuid }
}

mutation UngroupNodes($uuids: [String!]!) {
  ungroupNodes(uuids: $uuids) { uuid }
}
```

All mutations broadcast to connected clients and signal dirty for persistence, per CLAUDE.md §4 broadcast semantics.

---

## 8. File Structure

### New files

```
crates/core/src/commands/
  batch_commands.rs          — BatchSetTransform
  group_commands.rs          — GroupNodes, UngroupNodes

crates/server/src/graphql/
  (modify mutation.rs)       — add 3 new mutations

frontend/src/canvas/
  handle-hit-test.ts         — identify handle under pointer
  resize-math.ts             — pure transform computation
  snap-engine.ts             — smart guide computation
  multi-select.ts            — compound bounds, proportional scale

frontend/src/canvas/__tests__/
  handle-hit-test.test.ts
  resize-math.test.ts
  snap-engine.test.ts
  multi-select.test.ts

frontend/src/panels/
  AlignPanel.tsx             — align + distribute UI
  AlignPanel.css
  AlignPanel.test.tsx
  AlignPanel.stories.tsx

frontend/src/graphql/
  (modify mutations.ts)      — add 3 new mutation strings
```

### Modified files

```
frontend/src/tools/select-tool.ts  — handle drag, marquee, multi-move/resize
frontend/src/canvas/renderer.ts    — guide lines, marquee rect, multi-select bounds
frontend/src/canvas/hit-test.ts    — export node AABB computation for reuse
frontend/src/store/document-store-solid.tsx — selectedNodeIds[], batchSetTransform, group/ungroup
frontend/src/shell/Canvas.tsx      — keyboard shortcuts (Ctrl+G, Ctrl+A, etc.)
frontend/src/panels/DesignPanel.tsx — show AlignPanel in Layout tab when 2+ selected
```

---

## 9. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd + G | Group selected nodes |
| Ctrl/Cmd + Shift + G | Ungroup |
| Ctrl/Cmd + A | Select all on page |
| Escape | Clear selection |
| Delete / Backspace | Delete selected nodes |
| Shift + drag handle | Aspect-ratio lock |
| Alt + drag handle | Resize from center |
| Ctrl+Shift + L | Align left |
| Ctrl+Shift + C | Align center |
| Ctrl+Shift + R | Align right |
| Ctrl+Shift + T | Align top |
| Ctrl+Shift + M | Align middle |
| Ctrl+Shift + B | Align bottom |

---

## 10. Future Enhancements (Documented, Not Implemented)

### 10.1 Individual Transform Within Multi-Selection

Click a single node within a multi-selection to enter per-node resize mode. The multi-select bounding box is replaced with handles on just that node. Click outside the node (but inside the selection) to return to multi-select mode. Matches Figma's "click within selection" behavior.

### 10.2 Rotation Handle

A rotation handle offset from the top-center of the selection. Drag to rotate. Shift constrains to 15-degree increments. Currently rotation is controlled via the number input in the properties panel.

### 10.3 Constraint-Based Resize Propagation

When a parent frame is resized, children resize according to their constraint settings (start/end/center/stretch per axis). Requires the constraint system to be fully wired.

### 10.4 Grid Snapping

Per-frame or per-page visible grid with configurable spacing. Nodes snap to grid lines in addition to smart guides. Toggle via a toolbar button.

### 10.5 Keybind Manager

UI to explore and remap all keyboard shortcuts. Persisted to `keybindings.json`. Searchable list of actions with current bindings. Click to remap.

---

## Input Validation

- **Transform fields:** All `f64` values validated as finite and non-negative (width, height) by core's `validate_transform()`. Applied to every entry in `BatchSetTransform`.
- **Node UUIDs:** Validated against the document's node arena. Invalid UUIDs return typed errors.
- **Group membership:** `GroupNodes` validates all nodes exist and there are 2+. If nodes have different parents, the group is created under the lowest common ancestor and all nodes are reparented into it. `UngroupNodes` validates all targets are group-type nodes.
- **Minimum node count:** `GroupNodes` requires 2+ nodes. `UngroupNodes` requires 1+ group.
- **Snap threshold:** Hardcoded constant (8px screen-space). No user input.
- **Selection bounds:** Computed from node transforms, no external input.

---

## Consistency Guarantees

- **BatchSetTransform atomicity:** All transforms apply or none do. On partial validation failure, the entire batch is rejected. Undo reverts all transforms.
- **GroupNodes atomicity:** Group creation + reparenting is a single command. Undo removes the group and restores children to original parent at original positions.
- **UngroupNodes atomicity:** Child reparenting + group deletion is a single command. Undo recreates the group and reparents children back.
- **Multi-select + delete:** Deleting multiple nodes is currently sequential `deleteNode` calls. A `BatchDeleteNodes` command could be added for atomicity but is not in scope — individual deletes work and each is independently undoable.

---

## WASM Compatibility

No new external dependencies in the core crate. `BatchSetTransform`, `GroupNodes`, and `UngroupNodes` use only existing arena operations, `Transform`, and `NodeKind` types — all already WASM-compatible. No `Send`/`Sync` bounds, no I/O, no system calls.

---

## Recursion Safety

No new recursive algorithms. Multi-select bounding box computation iterates a flat list. Snap engine uses sorted arrays with binary search. Group/ungroup operates on a flat list of node IDs with single-level reparenting.

---

## PDR Traceability

**Implements:**
- PDR §4.1 "Canvas rendering with viewport transforms" — extends with interactive resize
- PDR §4.2 "Selection and multi-selection" — full implementation
- PDR §4.3 "Alignment and distribution tools" — full implementation
- PDR §4.4 "Smart guides" — full implementation
- PDR §4.5 "Grouping" — full implementation

**Defers:**
- PDR §4.6 "Boolean operations UI" — core engine supports boolean ops (Spec 01g) but no canvas UI yet
- PDR §4.7 "Pen tool" — separate spec
- PDR §4.8 "Text tool" — Spec 11b
