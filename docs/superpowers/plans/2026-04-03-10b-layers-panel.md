# Layers Panel Implementation Plan (Plan 10b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a functional layers panel with recursive tree view, selection sync with canvas, visibility/lock toggles, inline rename, expand/collapse, and full Figma-style DnD (reorder + reparent with indentation-aware depth control).

**Architecture:** The layers panel renders a flat list (virtualization-free) of `<TreeNode>` components at calculated depths. Each node row shows indent, expand toggle, kind icon, name, lock toggle, and visibility toggle. Selection syncs bidirectionally with the canvas via the document store's `selectedNodeId` signal. DnD uses `dnd-kit-solid` with `useDraggable`/`useDroppable` on each tree node, resolving drops through the `computeDropTarget` function from Plan 10a into `ReparentNode` or `ReorderChildren` mutations. New GraphQL mutations are added for reparent and reorder operations.

**Tech Stack:** Solid.js, dnd-kit-solid, @urql/solid, lucide-solid (icons), TypeScript

---

## Scope

**In scope:**
- GraphQL mutations: `reparentNode`, `reorderChildren` (server + frontend)
- Store methods: `reparentNode()`, `reorderChildren()` on `DocumentStoreAPI`
- `<TreeNode>` component with indent, expand, icon, name, toggles
- `<LayersTree>` recursive tree renderer
- `<LayersPanel>` replacing placeholder
- Selection sync (click tree node → select on canvas, canvas select → highlight in tree)
- Expand/collapse per node
- Inline rename on double-click
- DnD reorder within same parent
- DnD reparent to different parent
- Indentation-aware depth control on drop
- Keyboard navigation (arrow keys, Enter, F2, Delete)

**Deferred:**
- Multi-select (Spec 11)
- Context menu (Spec 11)

---

## Task 1: Add GraphQL mutations for reparent/reorder (server)

**Files:**
- Modify: `crates/server/src/graphql/mutation.rs`
- Modify: `crates/mcp/src/tools/nodes.rs` (add MCP tools)

- [ ] **Step 1: Add `reparentNode` GraphQL mutation to server**

Read `crates/server/src/graphql/mutation.rs` to see the pattern for existing mutations. Add a `reparent_node` mutation following the same pattern as `create_node`:

```rust
async fn reparent_node(
    &self,
    ctx: &Context<'_>,
    uuid: String,
    new_parent_uuid: String,
    position: i32,
) -> Result<NodeGql> {
    let state = ctx.data::<ServerState>()?;
    let parsed_uuid: uuid::Uuid = uuid.parse().map_err(|_| async_graphql::Error::new("invalid UUID"))?;
    let parent_uuid: uuid::Uuid = new_parent_uuid.parse().map_err(|_| async_graphql::Error::new("invalid parent UUID"))?;

    let node_gql = {
        let mut doc_guard = acquire_document_lock(state);
        let node_id = doc_guard.arena.id_by_uuid(&parsed_uuid)
            .ok_or_else(|| async_graphql::Error::new("node not found"))?;
        let parent_id = doc_guard.arena.id_by_uuid(&parent_uuid)
            .ok_or_else(|| async_graphql::Error::new("parent not found"))?;

        let old_parent_id = doc_guard.arena.get(node_id)
            .map_err(|_| async_graphql::Error::new("node lookup failed"))?.parent;
        let old_position = old_parent_id.and_then(|pid| {
            doc_guard.arena.get(pid).ok()
                .and_then(|p| p.children.iter().position(|&c| c == node_id))
        });

        let cmd = agent_designer_core::commands::tree_commands::ReparentNode {
            node_id,
            new_parent_id: parent_id,
            new_position: position.max(0) as usize,
            old_parent_id,
            old_position,
        };

        doc_guard.execute(Box::new(cmd)).map_err(|e| {
            tracing::warn!("reparentNode failed: {e}");
            async_graphql::Error::new("reparent failed")
        })?;

        node_to_gql(&doc_guard, node_id, parsed_uuid)?
    };

    state.app.signal_dirty();
    state.app.publish_event(MutationEvent {
        kind: MutationEventKind::NodeUpdated,
        uuid: Some(parsed_uuid.to_string()),
        data: Some(serde_json::json!({"field": "parent"})),
    });

    Ok(node_gql)
}
```

Add a similar `reorder_children` mutation that takes `uuid` and `new_position`, resolves the current position, and executes `ReorderChildren`.

- [ ] **Step 2: Add MCP tools for reparent/reorder**

In `crates/mcp/src/tools/nodes.rs`, add `reparent_node_impl` and `reorder_children_impl` functions following the same pattern as `rename_node_impl`. Register in `crates/mcp/src/server.rs`.

- [ ] **Step 3: Run tests**

```bash
cargo test --workspace
cargo clippy --workspace -- -D warnings
```

- [ ] **Step 4: Commit**

```bash
git add crates/server/ crates/mcp/
git commit -m "feat(server,mcp): add reparentNode and reorderChildren GraphQL mutations + MCP tools (Plan 10b, Task 1)"
```

---

## Task 2: Add frontend GraphQL operations and store methods

**Files:**
- Modify: `frontend/src/graphql/mutations.ts`
- Modify: `frontend/src/store/document-store-solid.tsx`

- [ ] **Step 1: Add GraphQL mutation strings**

Add to `frontend/src/graphql/mutations.ts`:

```typescript
export const REPARENT_NODE_MUTATION = `
  mutation ReparentNode($uuid: String!, $newParentUuid: String!, $position: Int!) {
    reparentNode(uuid: $uuid, newParentUuid: $newParentUuid, position: $position) {
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

export const REORDER_CHILDREN_MUTATION = `
  mutation ReorderChildren($uuid: String!, $newPosition: Int!) {
    reorderChildren(uuid: $uuid, newPosition: $newPosition) {
      uuid
    }
  }
`;
```

- [ ] **Step 2: Add store methods**

In `frontend/src/store/document-store-solid.tsx`, add `reparentNode` and `reorderChildren` to the `DocumentStoreAPI` interface and implement them. Follow the same optimistic + rollback pattern as existing mutations. After the mutation, call `fetchPages()` directly (like undo/redo) since tree structure changes affect the page node hierarchy.

```typescript
// In DocumentStoreAPI interface:
reparentNode(uuid: string, newParentUuid: string, position: number): void;
reorderChildren(uuid: string, newPosition: number): void;
```

- [ ] **Step 3: Verify build**

```bash
pnpm --prefix frontend build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/graphql/mutations.ts frontend/src/store/document-store-solid.tsx
git commit -m "feat(frontend): add reparentNode and reorderChildren mutations + store methods (Plan 10b, Task 2)"
```

---

## Task 3: TreeNode component (static rendering only)

**Files:**
- Create: `frontend/src/panels/TreeNode.tsx`
- Create: `frontend/src/panels/TreeNode.css`

- [ ] **Step 1: Create TreeNode CSS**

Create `frontend/src/panels/TreeNode.css` with styles for the tree node row:
- Indentation via `padding-left` based on depth
- Row highlight for selected node
- Dimmed text for hidden nodes
- Icon, name, and toggle button layout
- Hover state
- `@media (prefers-reduced-motion: reduce)` for any transitions

- [ ] **Step 2: Create TreeNode component**

Create `frontend/src/panels/TreeNode.tsx`:

```tsx
import { createSignal, Show, type Component } from "solid-js";
import { useDocument } from "../store/document-context";
import { useAnnounce } from "../shell/AnnounceProvider";
import { INDENT_WIDTH, type LayerDragData } from "../dnd/types";
import { canDropInside, type NodeKindType } from "../dnd/tree-insertion";
import type { DocumentNode } from "../types/document";
import "./TreeNode.css";

interface TreeNodeProps {
  readonly node: DocumentNode;
  readonly depth: number;
  readonly isExpanded: boolean;
  readonly onToggleExpand: (uuid: string) => void;
  readonly hasChildren: boolean;
}

/** Maps node kind to a short icon label. */
function kindIcon(kind: string): string {
  switch (kind) {
    case "frame": return "▢";
    case "rectangle": return "■";
    case "ellipse": return "●";
    case "text": return "T";
    case "group": return "◫";
    case "path": return "✎";
    case "image": return "🖼";
    case "component_instance": return "◇";
    default: return "?";
  }
}

export const TreeNode: Component<TreeNodeProps> = (props) => {
  const store = useDocument();
  const announce = useAnnounce();
  const [isRenaming, setIsRenaming] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  const isSelected = () => store.selectedNodeId() === props.node.uuid;
  const indentPx = () => props.depth * INDENT_WIDTH;

  function handleClick() {
    store.setSelectedNodeId(props.node.uuid);
    announce(`${props.node.name} selected`);
  }

  function handleDoubleClick() {
    setIsRenaming(true);
    requestAnimationFrame(() => inputRef?.focus());
  }

  function handleRenameSubmit() {
    const value = inputRef?.value.trim();
    if (value && value !== props.node.name) {
      store.renameNode(props.node.uuid, value);
    }
    setIsRenaming(false);
  }

  function handleRenameKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      setIsRenaming(false);
    }
  }

  function handleVisibilityToggle(e: MouseEvent) {
    e.stopPropagation();
    store.setVisible(props.node.uuid, !props.node.visible);
  }

  function handleLockToggle(e: MouseEvent) {
    e.stopPropagation();
    store.setLocked(props.node.uuid, !props.node.locked);
  }

  return (
    <div
      class="sigil-tree-node"
      classList={{
        "sigil-tree-node--selected": isSelected(),
        "sigil-tree-node--hidden": !props.node.visible,
      }}
      style={{ "padding-left": `${indentPx()}px` }}
      role="treeitem"
      aria-selected={isSelected()}
      aria-expanded={props.hasChildren ? props.isExpanded : undefined}
      aria-level={props.depth + 1}
      tabindex={isSelected() ? 0 : -1}
      onClick={handleClick}
      onDblClick={handleDoubleClick}
    >
      {/* Expand toggle */}
      <Show when={props.hasChildren}>
        <button
          class="sigil-tree-node__expand"
          aria-label={props.isExpanded ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleExpand(props.node.uuid);
          }}
        >
          {props.isExpanded ? "▾" : "▸"}
        </button>
      </Show>
      <Show when={!props.hasChildren}>
        <span class="sigil-tree-node__expand-spacer" />
      </Show>

      {/* Kind icon */}
      <span class="sigil-tree-node__icon" aria-hidden="true">
        {kindIcon(props.node.kind.type)}
      </span>

      {/* Name */}
      <Show
        when={!isRenaming()}
        fallback={
          <input
            ref={(el) => { inputRef = el; }}
            class="sigil-tree-node__name-input"
            value={props.node.name}
            onBlur={handleRenameSubmit}
            onKeyDown={handleRenameKeyDown}
          />
        }
      >
        <span class="sigil-tree-node__name">{props.node.name}</span>
      </Show>

      {/* Spacer */}
      <span class="sigil-tree-node__spacer" />

      {/* Lock toggle */}
      <button
        class="sigil-tree-node__toggle"
        aria-label={props.node.locked ? "Unlock" : "Lock"}
        onClick={handleLockToggle}
      >
        {props.node.locked ? "🔒" : "🔓"}
      </button>

      {/* Visibility toggle */}
      <button
        class="sigil-tree-node__toggle"
        aria-label={props.node.visible ? "Hide" : "Show"}
        onClick={handleVisibilityToggle}
      >
        {props.node.visible ? "👁" : "👁‍🗨"}
      </button>
    </div>
  );
};
```

Note: The emoji icons are temporary — they should be replaced with `lucide-solid` icons in a follow-up. The structure is correct.

- [ ] **Step 3: Verify build**

```bash
pnpm --prefix frontend build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/panels/TreeNode.tsx frontend/src/panels/TreeNode.css
git commit -m "feat(frontend): add TreeNode component with selection, rename, toggles (Plan 10b, Task 3)"
```

---

## Task 4: LayersTree + LayersPanel (tree rendering without DnD)

**Files:**
- Create: `frontend/src/panels/LayersTree.tsx`
- Modify: `frontend/src/panels/LayersPanel.tsx`

- [ ] **Step 1: Create LayersTree component**

Create `frontend/src/panels/LayersTree.tsx`:

The tree needs to convert the store's flat `nodes` Record into a hierarchical rendering. The store provides `state.pages` (with `root_nodes`) and `state.nodes` (Record<uuid, node>). However, `DocumentNode.children` contains `NodeId[]` (arena-local IDs), not UUIDs. The GraphQL PAGES_QUERY returns nodes with a `children` field that contains UUIDs as strings.

Read the actual GraphQL response and `parseNode` in the store to understand how children are stored. The tree rendering should:

1. Get the active page's root node UUIDs (from `state.pages[0].root_nodes` — currently there's no `activePageId`, so use the first page)
2. For each root UUID, look up the node in `state.nodes`
3. The node's `children` field should have child UUIDs (check how `parseNode` handles this)
4. Recursively render `<TreeNode>` for each child

The expand/collapse state is managed via a `Set<string>` signal in the `LayersTree` component.

```tsx
import { createSignal, createMemo, For, type Component } from "solid-js";
import { useDocument } from "../store/document-context";
import { TreeNode } from "./TreeNode";
import type { DocumentNode } from "../types/document";

export const LayersTree: Component = () => {
  const store = useDocument();
  const [expandedNodes, setExpandedNodes] = createSignal(new Set<string>());

  // Get root nodes from the first page
  const rootNodeUuids = createMemo(() => {
    const pages = store.state.pages;
    if (pages.length === 0) return [];
    // Get node UUIDs from the page's nodes
    // Since pages return all nodes, root nodes are those without parents
    const allNodes = store.state.nodes;
    return Object.values(allNodes)
      .filter((n) => !getParentUuid(n, allNodes))
      .map((n) => n.uuid);
  });

  function getChildUuids(node: DocumentNode): string[] {
    // Children are stored in the node from GraphQL — check the actual structure
    // The node.children field may be NodeId[] or string[] depending on how parseNode works
    // For now, find children by checking all nodes whose parent matches this node
    const allNodes = store.state.nodes;
    return Object.values(allNodes)
      .filter((n) => getParentUuid(n, allNodes) === node.uuid)
      .map((n) => n.uuid);
  }

  function getParentUuid(
    node: DocumentNode,
    allNodes: Record<string, DocumentNode>,
  ): string | null {
    // Check if the GraphQL response includes parent as a UUID string
    // The node.parent field is typed as NodeId | null
    // But the GraphQL response may return it as a UUID string
    const parent = node.parent as unknown;
    if (typeof parent === "string" && parent in allNodes) return parent;
    return null;
  }

  function toggleExpand(uuid: string) {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }

  function isExpanded(uuid: string): boolean {
    return expandedNodes().has(uuid);
  }

  function renderNode(uuid: string, depth: number) {
    const node = store.state.nodes[uuid];
    if (!node) return null;
    const childUuids = getChildUuids(node);
    const hasChildren = childUuids.length > 0;

    return (
      <>
        <TreeNode
          node={node as DocumentNode}
          depth={depth}
          isExpanded={isExpanded(uuid)}
          onToggleExpand={toggleExpand}
          hasChildren={hasChildren}
        />
        {hasChildren && isExpanded(uuid) && (
          <For each={childUuids}>
            {(childUuid) => renderNode(childUuid, depth + 1)}
          </For>
        )}
      </>
    );
  }

  return (
    <div class="sigil-layers-tree" role="tree" aria-label="Layer hierarchy">
      <For each={rootNodeUuids()}>
        {(uuid) => renderNode(uuid, 0)}
      </For>
    </div>
  );
};
```

**IMPORTANT NOTE FOR IMPLEMENTER:** The parent/children relationships from the GraphQL response need careful investigation. Read `parseNode` in `document-store-solid.tsx` and the `PAGES_QUERY` in `queries.ts` to understand exactly how `node.parent` and `node.children` are stored. The tree rendering logic above is a starting point — adapt based on the actual data shape. The GraphQL response likely returns `parent` as a UUID string and `children` as UUID strings, but `parseNode` may convert them to `NodeId` objects. You may need to adjust `parseNode` to preserve UUID strings for parent/children, or build a separate UUID-based parent/child lookup.

- [ ] **Step 2: Replace LayersPanel placeholder**

Replace `frontend/src/panels/LayersPanel.tsx`:

```tsx
import { type Component } from "solid-js";
import { LayersTree } from "./LayersTree";

export const LayersPanel: Component = () => {
  return <LayersTree />;
};
```

- [ ] **Step 3: Verify build and test**

```bash
pnpm --prefix frontend build
pnpm --prefix frontend test
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/panels/
git commit -m "feat(frontend): add LayersTree with expand/collapse, selection, toggles (Plan 10b, Task 4)"
```

---

## Task 5: DnD wiring on TreeNode

**Files:**
- Modify: `frontend/src/panels/TreeNode.tsx`
- Modify: `frontend/src/panels/LayersTree.tsx`

- [ ] **Step 1: Add DnD to TreeNode**

Add `useDraggable` and `useDroppable` from `dnd-kit-solid` to each TreeNode. The drag data should be `{ type: "layer", uuid: node.uuid }`. The drop target should compute the `TreeDropTarget` from cursor position using `computeDropTarget`.

- [ ] **Step 2: Add drop indicator to LayersTree**

Import `TreeDropIndicator` from `../dnd/TreeDropIndicator` and render it positioned above the tree, driven by a `dropTarget` signal that updates on `onDragOver`.

- [ ] **Step 3: Add drop handler**

Wire the `onDragEnd` callback on the DragDropProvider (in App.tsx or via `useDragDropMonitor` in LayersTree) to dispatch `reparentNode` or `reorderChildren` based on the computed `TreeDropTarget`.

Logic:
- `position === "inside"` → `reparentNode(draggedUuid, targetUuid, lastChildPosition)`
- `position === "before"` or `"after"` at same parent → `reorderChildren(draggedUuid, newPosition)`
- `position === "before"` or `"after"` at different parent → `reparentNode(draggedUuid, resolvedParentUuid, position)`

- [ ] **Step 4: Add cycle detection**

Before executing the drop, verify that the target is not a descendant of the dragged node. Walk up from the target node's parent chain checking against the dragged UUID.

- [ ] **Step 5: Announce DnD operations**

Wire `announce()` calls:
- On drag start: `"Grabbed {name}"`
- On drag over: `"Over {targetName}, {position}"`
- On drop: `"{name} moved to {destination}"`

- [ ] **Step 6: Verify build and test**

```bash
pnpm --prefix frontend build
pnpm --prefix frontend test
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): add DnD to layers tree with reparent/reorder (Plan 10b, Task 5)"
```

---

## Task 6: Keyboard navigation

**Files:**
- Modify: `frontend/src/panels/LayersTree.tsx`

- [ ] **Step 1: Add keyboard handler**

Add a `keydown` handler on the tree container that implements:
- **ArrowDown** — move to next visible node
- **ArrowUp** — move to previous visible node
- **ArrowRight** — expand node (if collapsed and has children) or move to first child (if expanded)
- **ArrowLeft** — collapse node (if expanded) or move to parent (if collapsed)
- **Enter** — select node
- **F2** — start inline rename
- **Delete** — delete selected node

The "visible nodes" are the flattened list of nodes considering expand/collapse state. Maintain a `flattenedNodes` memo that computes the ordered list of visible UUIDs.

- [ ] **Step 2: Auto-expand to selected node**

Add a `createEffect` that watches `store.selectedNodeId()` and auto-expands all ancestors of the selected node so it's visible in the tree. This handles the case where the user clicks a nested node on the canvas — the tree should scroll to and show it.

- [ ] **Step 3: Verify and commit**

```bash
pnpm --prefix frontend build && pnpm --prefix frontend test
git add frontend/src/panels/
git commit -m "feat(frontend): add keyboard navigation and auto-expand to layers tree (Plan 10b, Task 6)"
```

---

## Task 7: Tests and final verification

**Files:**
- Create: `frontend/src/panels/__tests__/TreeNode.test.tsx`
- Create: `frontend/src/panels/__tests__/LayersTree.test.tsx`

- [ ] **Step 1: TreeNode tests**

Test:
- Renders node name
- Shows selected state when selectedNodeId matches
- Dimmed style when node is not visible
- Clicking calls setSelectedNodeId
- Double-click enables rename input
- Visibility toggle calls setVisible
- Lock toggle calls setLocked

- [ ] **Step 2: LayersTree tests**

Test:
- Renders root nodes
- Shows expand toggle for nodes with children
- Expanding a node shows its children
- Collapsing hides children

- [ ] **Step 3: Lint, format, build**

```bash
pnpm --prefix frontend lint
pnpm --prefix frontend format
pnpm --prefix frontend test
pnpm --prefix frontend build
```

Also run backend tests:
```bash
cargo test --workspace
cargo clippy --workspace -- -D warnings
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/panels/__tests__/
git commit -m "test(frontend): add TreeNode and LayersTree tests (Plan 10b, Task 7)"
```

---

## Summary

| Task | Description | Scope |
|------|-------------|-------|
| 1 | GraphQL mutations for reparent/reorder | Server + MCP (Rust) |
| 2 | Frontend mutation strings + store methods | Frontend store |
| 3 | TreeNode component (static) | Frontend UI |
| 4 | LayersTree + LayersPanel (tree rendering) | Frontend UI |
| 5 | DnD wiring | Frontend DnD |
| 6 | Keyboard navigation + auto-expand | Frontend a11y |
| 7 | Tests + verification | Testing |

After this plan, users can see the document's node hierarchy, select nodes, toggle visibility/lock, rename inline, reorder via DnD, and reparent with indentation-aware depth control.
