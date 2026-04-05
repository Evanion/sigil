import { createSignal, createMemo, createEffect, For, Show, type Component } from "solid-js";
import { useDragDropMonitor } from "dnd-kit-solid";
import { useDocument } from "../store/document-context";
import { useAnnounce } from "../shell/AnnounceProvider";
import { TreeNode, type TreeNodeProps } from "./TreeNode";
import { TreeDropIndicator } from "../dnd/TreeDropIndicator";
import { computeDropTarget, canDropInside, type NodeKindType } from "../dnd/tree-insertion";
import type { TreeDropTarget, LayerDragData } from "../dnd/types";
import type { DocumentState } from "../store/document-store-solid";

/**
 * Maximum depth for tree traversal to prevent runaway recursion
 * if the data contains cycles.
 */
const MAX_TREE_DEPTH = 64;

/** Height of a single tree row in pixels. */
const ROW_HEIGHT = 28;

/** Entry in the flattened rendering list. */
interface FlatEntry {
  readonly uuid: string;
  readonly depth: number;
}

/**
 * Builds a flat rendering list from the store's nodes by walking
 * the parent/children relationships. Uses an explicit stack to
 * avoid recursive function calls with a depth guard.
 */
function buildFlatList(
  nodes: DocumentState["nodes"],
  expandedNodes: ReadonlySet<string>,
): FlatEntry[] {
  const entries: FlatEntry[] = [];

  // Find root nodes: nodes without a parentUuid (or whose parentUuid is not in the store).
  const rootUuids: string[] = [];
  for (const uuid of Object.keys(nodes)) {
    const node = nodes[uuid];
    if (!node) continue;
    const parentUuid = node.parentUuid;
    if (parentUuid === null || !(parentUuid in nodes)) {
      rootUuids.push(uuid);
    }
  }

  // Walk tree using an explicit stack (DFS, children in reverse so first child is visited first).
  // Stack entries: [uuid, depth]
  const stack: Array<[string, number]> = [];
  for (let i = rootUuids.length - 1; i >= 0; i--) {
    stack.push([rootUuids[i], 0]);
  }

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    const [uuid, depth] = entry;

    if (depth >= MAX_TREE_DEPTH) continue;

    entries.push({ uuid, depth });

    const node = nodes[uuid];
    if (!node) continue;

    const childUuids = node.childrenUuids;
    if (childUuids.length > 0 && expandedNodes.has(uuid)) {
      // Push children in reverse order so the first child is processed first.
      for (let i = childUuids.length - 1; i >= 0; i--) {
        const childUuid = childUuids[i];
        if (childUuid in nodes) {
          stack.push([childUuid, depth + 1]);
        }
      }
    }
  }

  return entries;
}

/**
 * Checks if `ancestorUuid` is an ancestor of `nodeUuid` in the tree.
 * Prevents reparenting a node into its own subtree (cycle prevention).
 */
function isAncestor(
  nodes: DocumentState["nodes"],
  nodeUuid: string,
  ancestorUuid: string,
): boolean {
  let current = nodes[nodeUuid]?.parentUuid ?? null;
  let guard = 0;
  while (current !== null && guard < MAX_TREE_DEPTH) {
    if (current === ancestorUuid) return true;
    current = nodes[current]?.parentUuid ?? null;
    guard++;
  }
  return false;
}

/**
 * Resolves the parent UUID for a drop target based on position and depth.
 * When dropping "before" or "after" a target node, the parent depends on
 * the computed depth relative to the target node's depth.
 */
function resolveDropParent(
  nodes: DocumentState["nodes"],
  flatList: FlatEntry[],
  target: TreeDropTarget,
  targetIndex: number,
): string | null {
  if (target.position === "inside") {
    return target.targetUuid;
  }

  const targetEntry = flatList[targetIndex];
  if (!targetEntry) return null;

  const targetNode = nodes[target.targetUuid];
  if (!targetNode) return null;

  // If the drop depth matches the target depth, the parent is the same as the target's parent.
  if (target.depth === targetEntry.depth) {
    return targetNode.parentUuid;
  }

  // If depth is less than the target, walk up the ancestor chain.
  if (target.depth < targetEntry.depth) {
    let current = targetNode.parentUuid;
    let currentDepth = targetEntry.depth - 1;
    let guard = 0;
    while (current !== null && currentDepth > target.depth && guard < MAX_TREE_DEPTH) {
      current = nodes[current]?.parentUuid ?? null;
      currentDepth--;
      guard++;
    }
    // At this point, `current` is the parent at the desired depth.
    // The drop goes into current's parent.
    return current !== null ? (nodes[current]?.parentUuid ?? null) : null;
  }

  // Depth > target depth: dropping deeper = inside the target's parent chain.
  // The resolved parent is the target node itself (nest inside it).
  return target.targetUuid;
}

/**
 * Resolves the insertion position within the parent's children array.
 */
function resolveDropPosition(
  nodes: DocumentState["nodes"],
  target: TreeDropTarget,
  parentUuid: string | null,
  draggedUuid: string,
): number {
  if (target.position === "inside") {
    // Drop as last child of the target container.
    const parent = parentUuid ? nodes[parentUuid] : null;
    return parent ? parent.childrenUuids.length : 0;
  }

  // Find the position within the parent's children.
  const parentNode = parentUuid ? nodes[parentUuid] : null;
  if (!parentNode) return 0;

  const children = parentNode.childrenUuids;
  const targetIdx = children.indexOf(target.targetUuid);

  if (targetIdx === -1) {
    // Target is not a direct child of the resolved parent — append at end.
    return children.length;
  }

  // Account for whether the dragged node is already a child of this parent
  // and before the target position (which would shift indices).
  const dragIdx = children.indexOf(draggedUuid);
  const isMovingWithinSameParent = dragIdx !== -1;

  let pos = target.position === "before" ? targetIdx : targetIdx + 1;

  // If dragged node is before the target in the same parent, removing it
  // shifts the target index down by 1.
  if (isMovingWithinSameParent && dragIdx < pos) {
    pos = Math.max(0, pos - 1);
  }

  return pos;
}

export const LayersTree: Component = () => {
  const store = useDocument();
  const announce = useAnnounce();
  const [expandedNodes, setExpandedNodes] = createSignal<ReadonlySet<string>>(new Set<string>());
  const [dropTarget, setDropTarget] = createSignal<TreeDropTarget | null>(null);
  const [focusedUuid, setFocusedUuid] = createSignal<string | null>(null);
  let treeRef: HTMLDivElement | undefined;

  // Auto-expand root-level nodes on first load.
  let hasAutoExpanded = false;
  createEffect(() => {
    const nodes = store.state.nodes;
    const keys = Object.keys(nodes);
    if (keys.length === 0 || hasAutoExpanded) return;

    const roots: string[] = [];
    for (const uuid of keys) {
      const node = nodes[uuid];
      if (!node) continue;
      if (node.parentUuid === null || !(node.parentUuid in nodes)) {
        roots.push(uuid);
      }
    }

    if (roots.length > 0) {
      hasAutoExpanded = true;
      setExpandedNodes(new Set(roots));
    }
  });

  // Auto-expand ancestors of the selected node so it is always visible in the tree.
  createEffect(() => {
    const selectedId = store.selectedNodeId();
    if (!selectedId) return;

    const nodes = store.state.nodes;
    const ancestors: string[] = [];
    let current = nodes[selectedId]?.parentUuid ?? null;
    let guard = 0;

    while (current && current in nodes && guard < MAX_TREE_DEPTH) {
      ancestors.push(current);
      current = nodes[current]?.parentUuid ?? null;
      guard++;
    }

    if (ancestors.length === 0) return;

    setExpandedNodes((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const a of ancestors) {
        if (!next.has(a)) {
          next.add(a);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  });

  const flatList = createMemo(() => buildFlatList(store.state.nodes, expandedNodes()));

  function toggleExpand(uuid: string) {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) {
        next.delete(uuid);
      } else {
        next.add(uuid);
      }
      return next;
    });
  }

  // ── DnD Monitor ─────────────────────────────────────────────────────

  useDragDropMonitor({
    onDragStart(event) {
      const source = event.operation.source;
      if (!source) return;
      const data = source.data as LayerDragData | undefined;
      if (data?.type !== "layer") return;
      const node = store.state.nodes[data.uuid];
      if (node) {
        announce(`Grabbed ${node.name}`);
      }
    },

    onDragOver(event) {
      const source = event.operation.source;
      const target = event.operation.target;
      if (!source || !target) {
        setDropTarget(null);
        return;
      }

      const sourceData = source.data as LayerDragData | undefined;
      const targetData = target.data as { type: string; uuid: string } | undefined;
      if (sourceData?.type !== "layer" || targetData?.type !== "layer") {
        setDropTarget(null);
        return;
      }

      // Find the target row element and compute relative cursor position.
      const targetEl = target.element;
      if (!targetEl || !treeRef) {
        setDropTarget(null);
        return;
      }

      const targetRect = targetEl.getBoundingClientRect();
      const treeRect = treeRef.getBoundingClientRect();

      // Get cursor position from the drag event's native event if available,
      // or fallback to the center of the target.
      const nativeEvent = (event as unknown as { nativeEvent?: PointerEvent }).nativeEvent;
      const cursorY = nativeEvent ? nativeEvent.clientY - targetRect.top : targetRect.height / 2;
      const cursorX = nativeEvent ? nativeEvent.clientX : targetRect.left + targetRect.width / 2;

      const targetUuid = targetData.uuid;
      const targetNode = store.state.nodes[targetUuid];
      if (!targetNode) {
        setDropTarget(null);
        return;
      }

      const targetDepth = Number(targetEl.getAttribute("data-depth") ?? "0");
      const targetKind = targetEl.getAttribute("data-kind") ?? "";
      const targetCanHaveChildren = canDropInside(targetKind as NodeKindType);

      const computed = computeDropTarget({
        targetUuid,
        targetDepth,
        targetCanHaveChildren,
        cursorY,
        rowHeight: ROW_HEIGHT,
        cursorX,
        treeLeftEdge: treeRect.left,
      });

      // Cycle prevention: don't allow dropping a node into its own subtree.
      if (
        computed.position === "inside" &&
        isAncestor(store.state.nodes, targetUuid, sourceData.uuid)
      ) {
        setDropTarget(null);
        return;
      }

      // Also prevent dropping onto self.
      if (targetUuid === sourceData.uuid && computed.position === "inside") {
        setDropTarget(null);
        return;
      }

      setDropTarget(computed);

      // Announce the hover position.
      const targetNodeName = targetNode.name;
      announce(`Over ${targetNodeName}, ${computed.position}`);
    },

    onDragEnd(event) {
      const currentDrop = dropTarget();
      setDropTarget(null);

      const source = event.operation.source;
      if (!source) return;
      const sourceData = source.data as LayerDragData | undefined;
      if (sourceData?.type !== "layer") return;

      if (!currentDrop) {
        announce("Drop cancelled");
        return;
      }

      const draggedUuid = sourceData.uuid;
      const nodes = store.state.nodes;
      const list = flatList();

      // Find target index in flat list.
      const targetIndex = list.findIndex((e) => e.uuid === currentDrop.targetUuid);
      if (targetIndex === -1) {
        announce("Drop cancelled");
        return;
      }

      // Cycle prevention (double-check).
      if (
        currentDrop.targetUuid === draggedUuid ||
        isAncestor(nodes, currentDrop.targetUuid, draggedUuid)
      ) {
        announce("Cannot drop a layer into itself");
        return;
      }

      const parentUuid = resolveDropParent(nodes, list, currentDrop, targetIndex);
      const draggedNode = nodes[draggedUuid];

      if (currentDrop.position === "inside") {
        // Reparent into the target container.
        const targetNode = nodes[currentDrop.targetUuid];
        const childCount = targetNode?.childrenUuids.length ?? 0;
        store.reparentNode(draggedUuid, currentDrop.targetUuid, childCount);
        announce(`${draggedNode?.name ?? "Layer"} moved inside ${targetNode?.name ?? "container"}`);
        return;
      }

      // Check if this is a same-parent reorder or a reparent.
      const currentParent = draggedNode?.parentUuid ?? null;

      if (parentUuid === currentParent) {
        // Same parent — reorder.
        const position = resolveDropPosition(nodes, currentDrop, parentUuid, draggedUuid);
        store.reorderChildren(draggedUuid, position);
        announce(`${draggedNode?.name ?? "Layer"} reordered`);
      } else if (parentUuid !== null) {
        // Different parent — reparent.
        const position = resolveDropPosition(nodes, currentDrop, parentUuid, draggedUuid);
        store.reparentNode(draggedUuid, parentUuid, position);
        const parentNode = nodes[parentUuid];
        announce(`${draggedNode?.name ?? "Layer"} moved to ${parentNode?.name ?? "parent"}`);
      } else {
        // Moving to root level — reparent with root (no parent).
        // For now we cannot reparent to root via the current API,
        // so we just announce the failure.
        announce("Cannot move to root level");
      }
    },
  });

  // ── Keyboard Navigation ─────────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent) {
    const list = flatList();
    if (list.length === 0) return;

    const currentFocused = focusedUuid();
    const currentIndex = currentFocused
      ? list.findIndex((entry) => entry.uuid === currentFocused)
      : -1;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const nextIndex = currentIndex < list.length - 1 ? currentIndex + 1 : 0;
        const nextEntry = list[nextIndex];
        if (nextEntry) {
          setFocusedUuid(nextEntry.uuid);
          scrollToNode(nextEntry.uuid);
        }
        break;
      }

      case "ArrowUp": {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : list.length - 1;
        const prevEntry = list[prevIndex];
        if (prevEntry) {
          setFocusedUuid(prevEntry.uuid);
          scrollToNode(prevEntry.uuid);
        }
        break;
      }

      case "ArrowRight": {
        e.preventDefault();
        if (currentIndex === -1) break;
        const entry = list[currentIndex];
        if (!entry) break;
        const node = store.state.nodes[entry.uuid];
        if (!node) break;
        const hasChildren = node.childrenUuids.length > 0;
        if (hasChildren && !expandedNodes().has(entry.uuid)) {
          // Expand the node.
          toggleExpand(entry.uuid);
        } else if (hasChildren && expandedNodes().has(entry.uuid)) {
          // Move to first child.
          const nextIndex = currentIndex + 1;
          const nextEntry = list[nextIndex];
          if (nextEntry && nextEntry.depth > entry.depth) {
            setFocusedUuid(nextEntry.uuid);
            scrollToNode(nextEntry.uuid);
          }
        }
        break;
      }

      case "ArrowLeft": {
        e.preventDefault();
        if (currentIndex === -1) break;
        const entry = list[currentIndex];
        if (!entry) break;
        const node = store.state.nodes[entry.uuid];
        if (!node) break;
        const hasChildren = node.childrenUuids.length > 0;
        if (hasChildren && expandedNodes().has(entry.uuid)) {
          // Collapse the node.
          toggleExpand(entry.uuid);
        } else if (node.parentUuid && node.parentUuid in store.state.nodes) {
          // Move to parent.
          setFocusedUuid(node.parentUuid);
          scrollToNode(node.parentUuid);
        }
        break;
      }

      case "Enter": {
        e.preventDefault();
        if (currentFocused) {
          store.setSelectedNodeId(currentFocused);
          const node = store.state.nodes[currentFocused];
          if (node) {
            announce(`${node.name} selected`);
          }
        }
        break;
      }

      case "F2": {
        e.preventDefault();
        if (currentFocused) {
          // Find the DOM element and trigger rename via double-click.
          const el = treeRef?.querySelector(`[data-uuid="${currentFocused}"]`);
          if (el) {
            el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
          }
        }
        break;
      }

      case "Delete":
      case "Backspace": {
        e.preventDefault();
        if (currentFocused) {
          const node = store.state.nodes[currentFocused];
          if (node) {
            store.deleteNode(currentFocused);
            announce(`${node.name} deleted`);
            // Move focus to next or previous node.
            const list2 = flatList();
            const idx = list2.findIndex((entry) => entry.uuid === currentFocused);
            if (idx !== -1 && list2.length > 1) {
              const nextIdx = idx < list2.length - 1 ? idx + 1 : idx - 1;
              const nextEntry = list2[nextIdx];
              if (nextEntry) {
                setFocusedUuid(nextEntry.uuid);
              }
            } else {
              setFocusedUuid(null);
            }
          }
        }
        break;
      }

      default:
        // No-op for other keys.
        break;
    }
  }

  function scrollToNode(uuid: string) {
    const el = treeRef?.querySelector(`[data-uuid="${uuid}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }

  // Compute the drop indicator position.
  const dropIndicatorRowTop = createMemo(() => {
    const target = dropTarget();
    if (!target) return 0;
    const list = flatList();
    const idx = list.findIndex((e) => e.uuid === target.targetUuid);
    if (idx === -1) return 0;
    return idx * ROW_HEIGHT;
  });

  return (
    <div
      ref={(el) => {
        treeRef = el;
      }}
      class="sigil-layers-tree"
      role="tree"
      aria-label="Layer hierarchy"
      tabindex={0}
      onKeyDown={handleKeyDown}
      style={{ position: "relative" }}
    >
      <For each={flatList()}>
        {(entry) => {
          const node = () => store.state.nodes[entry.uuid];
          return (
            <Show when={node()}>
              {(n) => (
                <TreeNode
                  node={n() as unknown as TreeNodeProps["node"]}
                  depth={entry.depth}
                  isExpanded={expandedNodes().has(entry.uuid)}
                  onToggleExpand={toggleExpand}
                  hasChildren={(n().childrenUuids?.length ?? 0) > 0}
                  isFocused={focusedUuid() === entry.uuid}
                />
              )}
            </Show>
          );
        }}
      </For>
      <TreeDropIndicator
        target={dropTarget()}
        rowHeight={ROW_HEIGHT}
        rowTop={dropIndicatorRowTop()}
      />
    </div>
  );
};
