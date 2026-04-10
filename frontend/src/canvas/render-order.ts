/**
 * Builds a flat array of nodes in depth-first tree order for correct
 * z-order rendering. Canvas 2D uses the painter's algorithm: nodes
 * drawn first appear behind nodes drawn later.
 *
 * Tree order: parent → children (parent renders behind children).
 * Sibling order: childrenUuids[0] renders first (behind),
 * childrenUuids[N-1] renders last (in front). This matches the core
 * arena's Vec ordering where push() adds to the end = front of z-stack.
 */

import type { DocumentNode } from "../types/document";

/**
 * Maximum depth for render-order tree traversal to prevent runaway
 * traversal if the data contains cycles (CLAUDE.md §11).
 */
export const MAX_RENDER_DEPTH = 64;

/** Node shape expected by buildRenderOrder — DocumentNode with optional tree fields. */
export interface RenderOrderNode extends DocumentNode {
  readonly parentUuid?: string | null;
  readonly childrenUuids?: readonly string[];
}

/**
 * Build a flat array of nodes in depth-first tree order for correct
 * z-order rendering via the painter's algorithm.
 *
 * @param nodes - The node store (Record<uuid, node>).
 * @param keys - Object.keys(nodes) — passed separately so the caller
 *   can ensure Solid.js reactive tracking on key additions/deletions.
 * @returns Nodes in painter's algorithm order (first = behind, last = front).
 */
export function buildRenderOrder(
  nodes: Record<string, RenderOrderNode>,
  keys: readonly string[],
): DocumentNode[] {
  // Find root nodes: nodes without a parentUuid or whose parent is not in the store.
  const rootUuids: string[] = [];
  for (const uuid of keys) {
    const node = nodes[uuid];
    if (!node) continue;
    const parentUuid = node.parentUuid;
    if (parentUuid === null || parentUuid === undefined || !(parentUuid in nodes)) {
      rootUuids.push(uuid);
    }
  }

  const result: DocumentNode[] = [];

  // Walk tree using explicit stack (DFS). Push children in reverse so
  // first child (childrenUuids[0]) is popped first → drawn first → behind.
  const stack: Array<[string, number]> = [];
  for (let i = rootUuids.length - 1; i >= 0; i--) {
    stack.push([rootUuids[i], 0]);
  }

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    const [uuid, depth] = entry;

    if (depth >= MAX_RENDER_DEPTH) {
      // RF-001: Log diagnostic when depth guard fires — likely a cycle in the node tree.
      console.warn(
        `[Canvas] MAX_RENDER_DEPTH (${MAX_RENDER_DEPTH}) exceeded for node ${uuid} — possible cycle`,
      );
      continue;
    }

    const node = nodes[uuid];
    if (!node) continue;

    result.push(node);

    const childUuids = node.childrenUuids;
    if (childUuids && childUuids.length > 0) {
      for (let i = childUuids.length - 1; i >= 0; i--) {
        const childUuid = childUuids[i];
        if (childUuid in nodes) {
          stack.push([childUuid, depth + 1]);
        }
      }
    }
  }

  return result;
}
