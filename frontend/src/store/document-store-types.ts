/**
 * ToolStore interface -- the narrow contract that canvas tools use to
 * interact with the document state.
 *
 * Extracted so that tool implementations (select-tool, shape-tool) and
 * adapters (Canvas.tsx) can depend on the interface without depending on
 * a concrete store implementation.
 */

import type { DocumentNode, NodeKind, Transform } from "../types/document";

/**
 * Narrow interface exposing only the methods that canvas tools actually call.
 *
 * Tools should depend on this instead of the full DocumentStoreAPI to keep
 * coupling minimal and make testing straightforward.
 */
export interface ToolStore {
  getAllNodes(): ReadonlyMap<string, DocumentNode>;
  select(uuid: string | null): void;
  setTransform(uuid: string, transform: Transform): void;
  createNode(kind: NodeKind, name: string, transform: Transform): string;
  getSelectedNodeId(): string | null;
  /** Current viewport zoom level, needed for handle hit-testing and snapping. */
  getViewportZoom(): number;
  /** Multi-select: returns all currently selected node UUIDs. */
  getSelectedNodeIds(): string[];
  /** Multi-select: replaces the entire selection set. */
  setSelectedNodeIds(ids: string[]): void;
  /** Multi-select: commits transforms for multiple nodes in a single batch operation. */
  batchSetTransform(entries: Array<{ uuid: string; transform: Transform }>): void;
}
