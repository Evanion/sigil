/**
 * Shared alignment execution helper.
 *
 * Extracts the common pattern of reading selected node transforms,
 * applying an alignment/distribution function, and committing the
 * results via batchSetTransform. Used by both Canvas.tsx keyboard
 * shortcuts and AlignPanel button handlers.
 */

import type { AlignEntry } from "./align-math";
import type { Transform } from "../types/document";

/**
 * A minimal interface for reading selected nodes and committing batch transforms.
 * Both Canvas.tsx and AlignPanel.tsx provide objects that satisfy this shape.
 */
export interface AlignableStore {
  readonly selectedNodeIds: () => string[];
  readonly state: { readonly nodes: Record<string, { transform: Transform } | undefined> };
  batchSetTransform(entries: Array<{ uuid: string; transform: Transform }>): void;
}

/**
 * Execute an alignment or distribution function on the currently selected nodes.
 *
 * Reads transforms from the store for all selected node IDs, applies the
 * alignment function, and commits the resulting transforms via batchSetTransform.
 *
 * @param store - Store providing selection, node data, and batch mutation.
 * @param alignFn - Pure alignment/distribution function from align-math.ts.
 * @param minCount - Minimum number of valid entries required (2 for align, 3 for distribute).
 * @returns true if the operation was applied, false if skipped (insufficient nodes).
 */
export function executeAlign(
  store: AlignableStore,
  alignFn: (nodes: readonly AlignEntry[]) => readonly AlignEntry[],
  minCount = 2,
): boolean {
  const ids = store.selectedNodeIds();
  if (ids.length < minCount) return false;

  const entries: AlignEntry[] = [];
  for (const id of ids) {
    const node = store.state.nodes[id];
    if (node?.transform) {
      entries.push({ uuid: id, transform: node.transform });
    }
  }
  if (entries.length < minCount) return false;

  const result = alignFn(entries);
  try {
    store.batchSetTransform(result.map((r) => ({ uuid: r.uuid, transform: r.transform })));
  } catch (err: unknown) {
    // RF-020: Log alignment errors. Toast notification deferred until toast system exists.
    console.error("Alignment operation failed:", err);
    return false;
  }
  return true;
}
