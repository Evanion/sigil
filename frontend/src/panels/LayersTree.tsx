import { createSignal, createMemo, createEffect, For, Show, type Component } from "solid-js";
import { useDocument } from "../store/document-context";
import { TreeNode, type TreeNodeProps } from "./TreeNode";
import type { DocumentState } from "../store/document-store-solid";

/**
 * Maximum depth for tree traversal to prevent runaway recursion
 * if the data contains cycles.
 */
const MAX_TREE_DEPTH = 64;

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

export const LayersTree: Component = () => {
  const store = useDocument();
  const [expandedNodes, setExpandedNodes] = createSignal<ReadonlySet<string>>(new Set<string>());

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

  return (
    <div class="sigil-layers-tree" role="tree" aria-label="Layer hierarchy">
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
                />
              )}
            </Show>
          );
        }}
      </For>
    </div>
  );
};
