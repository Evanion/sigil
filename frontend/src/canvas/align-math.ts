/**
 * Pure alignment and distribution functions for multi-selected nodes.
 *
 * Each function takes an array of `{ uuid, transform }` entries and returns
 * a new array with updated transforms. The original array is never mutated.
 *
 * Guards: all functions validate Number.isFinite on x, y, width, height of
 * every input transform per CLAUDE.md §11 Floating-Point Validation. If any
 * value is non-finite, the input is returned unchanged.
 */

import type { Transform } from "../types/document";

// ── Types ────────────────────────────────────────────────────────────────

export interface AlignEntry {
  readonly uuid: string;
  readonly transform: Transform;
}

// ── Validation ───────────────────────────────────────────────────────────

/**
 * Returns true if all positional fields (x, y, width, height) of every
 * entry's transform are finite numbers.
 */
function allFinite(entries: readonly AlignEntry[]): boolean {
  for (const entry of entries) {
    const t = entry.transform;
    if (
      !Number.isFinite(t.x) ||
      !Number.isFinite(t.y) ||
      !Number.isFinite(t.width) ||
      !Number.isFinite(t.height)
    ) {
      return false;
    }
  }
  return true;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function withX(entry: AlignEntry, x: number): AlignEntry {
  return { uuid: entry.uuid, transform: { ...entry.transform, x } };
}

function withY(entry: AlignEntry, y: number): AlignEntry {
  return { uuid: entry.uuid, transform: { ...entry.transform, y } };
}

// ── Alignment functions ──────────────────────────────────────────────────

/**
 * Align all nodes' left edges to the minimum x.
 * Requires 2+ nodes; returns input unchanged otherwise.
 */
export function alignLeft(nodes: readonly AlignEntry[]): readonly AlignEntry[] {
  if (nodes.length < 2 || !allFinite(nodes)) return nodes;
  const minX = Math.min(...nodes.map((n) => n.transform.x));
  return nodes.map((n) => withX(n, minX));
}

/**
 * Center each node horizontally within the compound bounding box.
 * Requires 2+ nodes; returns input unchanged otherwise.
 */
export function alignCenter(nodes: readonly AlignEntry[]): readonly AlignEntry[] {
  if (nodes.length < 2 || !allFinite(nodes)) return nodes;
  const minX = Math.min(...nodes.map((n) => n.transform.x));
  const maxRight = Math.max(...nodes.map((n) => n.transform.x + n.transform.width));
  const centerX = (minX + maxRight) / 2;
  return nodes.map((n) => withX(n, centerX - n.transform.width / 2));
}

/**
 * Align all nodes' right edges to the maximum right edge.
 * Requires 2+ nodes; returns input unchanged otherwise.
 */
export function alignRight(nodes: readonly AlignEntry[]): readonly AlignEntry[] {
  if (nodes.length < 2 || !allFinite(nodes)) return nodes;
  const maxRight = Math.max(...nodes.map((n) => n.transform.x + n.transform.width));
  return nodes.map((n) => withX(n, maxRight - n.transform.width));
}

/**
 * Align all nodes' top edges to the minimum y.
 * Requires 2+ nodes; returns input unchanged otherwise.
 */
export function alignTop(nodes: readonly AlignEntry[]): readonly AlignEntry[] {
  if (nodes.length < 2 || !allFinite(nodes)) return nodes;
  const minY = Math.min(...nodes.map((n) => n.transform.y));
  return nodes.map((n) => withY(n, minY));
}

/**
 * Center each node vertically within the compound bounding box.
 * Requires 2+ nodes; returns input unchanged otherwise.
 */
export function alignMiddle(nodes: readonly AlignEntry[]): readonly AlignEntry[] {
  if (nodes.length < 2 || !allFinite(nodes)) return nodes;
  const minY = Math.min(...nodes.map((n) => n.transform.y));
  const maxBottom = Math.max(...nodes.map((n) => n.transform.y + n.transform.height));
  const centerY = (minY + maxBottom) / 2;
  return nodes.map((n) => withY(n, centerY - n.transform.height / 2));
}

/**
 * Align all nodes' bottom edges to the maximum bottom edge.
 * Requires 2+ nodes; returns input unchanged otherwise.
 */
export function alignBottom(nodes: readonly AlignEntry[]): readonly AlignEntry[] {
  if (nodes.length < 2 || !allFinite(nodes)) return nodes;
  const maxBottom = Math.max(...nodes.map((n) => n.transform.y + n.transform.height));
  return nodes.map((n) => withY(n, maxBottom - n.transform.height));
}

// ── Distribution functions ───────────────────────────────────────────────

/**
 * Distribute nodes horizontally with equal gaps between them.
 * Sorts by x, then spaces evenly from leftmost to rightmost position.
 * Requires 3+ nodes; returns input unchanged otherwise.
 */
export function distributeHorizontal(nodes: readonly AlignEntry[]): readonly AlignEntry[] {
  if (nodes.length < 3 || !allFinite(nodes)) return nodes;

  // Sort a mutable copy by x position
  const sorted = [...nodes].sort((a, b) => a.transform.x - b.transform.x);

  // Safe access: length >= 3 guaranteed by guard above
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return nodes;

  // Total span from left of first to right of last
  const totalSpan = last.transform.x + last.transform.width - first.transform.x;
  const totalNodeWidths = sorted.reduce((sum, n) => sum + n.transform.width, 0);
  const gap = (totalSpan - totalNodeWidths) / (sorted.length - 1);

  // Build a uuid->new-x map so we can return results in original order
  const newXMap = new Map<string, number>();
  let cursor = first.transform.x;
  for (const entry of sorted) {
    newXMap.set(entry.uuid, cursor);
    cursor += entry.transform.width + gap;
  }

  return nodes.map((n) => {
    const newX = newXMap.get(n.uuid);
    if (newX === undefined) return n;
    return withX(n, newX);
  });
}

/**
 * Distribute nodes vertically with equal gaps between them.
 * Sorts by y, then spaces evenly from topmost to bottommost position.
 * Requires 3+ nodes; returns input unchanged otherwise.
 */
export function distributeVertical(nodes: readonly AlignEntry[]): readonly AlignEntry[] {
  if (nodes.length < 3 || !allFinite(nodes)) return nodes;

  const sorted = [...nodes].sort((a, b) => a.transform.y - b.transform.y);

  // Safe access: length >= 3 guaranteed by guard above
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return nodes;

  const totalSpan = last.transform.y + last.transform.height - first.transform.y;
  const totalNodeHeights = sorted.reduce((sum, n) => sum + n.transform.height, 0);
  const gap = (totalSpan - totalNodeHeights) / (sorted.length - 1);

  const newYMap = new Map<string, number>();
  let cursor = first.transform.y;
  for (const entry of sorted) {
    newYMap.set(entry.uuid, cursor);
    cursor += entry.transform.height + gap;
  }

  return nodes.map((n) => {
    const newY = newYMap.get(n.uuid);
    if (newY === undefined) return n;
    return withY(n, newY);
  });
}
