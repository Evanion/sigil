/**
 * Hit testing for canvas node selection.
 *
 * Tests if a world-space point is inside any node's axis-aligned bounding box.
 * Iterates nodes in reverse insertion order (top-most first in z-order) and
 * returns the first hit node. Invisible and locked nodes are skipped.
 */

import type { DocumentNode, Transform } from "../types/document";

/**
 * Compute the axis-aligned bounding box for a node's transform.
 *
 * For rotated nodes, this computes the AABB of the four rotated corners.
 * Returns [minX, minY, maxX, maxY].
 */
export function computeAABB(t: Transform): [number, number, number, number] {
  if (t.rotation === 0) {
    return [t.x, t.y, t.x + t.width, t.y + t.height];
  }

  // Compute rotated corners around the node's origin (top-left)
  const cx = t.x + t.width / 2;
  const cy = t.y + t.height / 2;
  const cos = Math.cos((t.rotation * Math.PI) / 180);
  const sin = Math.sin((t.rotation * Math.PI) / 180);

  // Four corners relative to center
  const hw = t.width / 2;
  const hh = t.height / 2;
  const corners: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [lx, ly] of corners) {
    const rx = cx + lx * cos - ly * sin;
    const ry = cy + lx * sin + ly * cos;
    minX = Math.min(minX, rx);
    minY = Math.min(minY, ry);
    maxX = Math.max(maxX, rx);
    maxY = Math.max(maxY, ry);
  }

  return [minX, minY, maxX, maxY];
}

/**
 * Test if a world-space point is inside any node's bounding box.
 *
 * Iterates nodes in reverse order (top-most first in z-order) and returns
 * the first node whose AABB contains the point. Invisible and locked nodes
 * are skipped.
 *
 * @param nodes - Map of UUID to DocumentNode, iterated in insertion order
 * @param worldX - World-space X coordinate of the test point
 * @param worldY - World-space Y coordinate of the test point
 * @returns The first hit node, or null if no node is hit
 */
export function hitTest(
  nodes: ReadonlyMap<string, DocumentNode>,
  worldX: number,
  worldY: number,
): DocumentNode | null {
  // Convert to array and reverse to test top-most (last-inserted) first
  const nodeList = Array.from(nodes.values()).reverse();

  for (const node of nodeList) {
    if (!node.visible) {
      continue;
    }
    if (node.locked) {
      continue;
    }

    const [minX, minY, maxX, maxY] = computeAABB(node.transform);

    if (worldX >= minX && worldX <= maxX && worldY >= minY && worldY <= maxY) {
      return node;
    }
  }

  return null;
}
