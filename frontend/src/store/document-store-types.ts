/**
 * ToolStore interface -- the narrow contract that canvas tools use to
 * interact with the document state.
 *
 * Extracted so that tool implementations (select-tool, shape-tool) and
 * adapters (Canvas.tsx) can depend on the interface without depending on
 * a concrete store implementation.
 */

import type {
  Color,
  DocumentNode,
  FontStyle,
  NodeKind,
  StyleValue,
  TextAlign,
  TextDecoration,
  TextShadow,
  Transform,
} from "../types/document";

/**
 * Discriminated union for type-safe text style updates.
 *
 * Replaces the untyped `(field: string, value: unknown)` signature on
 * `setTextStyle` so that each field's value type is statically checked.
 */
export type TextStylePatch =
  | { field: "font_family"; value: string }
  | { field: "font_size"; value: StyleValue<number> }
  | { field: "font_weight"; value: number }
  | { field: "font_style"; value: FontStyle }
  | { field: "line_height"; value: StyleValue<number> }
  | { field: "letter_spacing"; value: StyleValue<number> }
  | { field: "text_align"; value: TextAlign }
  | { field: "text_decoration"; value: TextDecoration }
  | { field: "text_color"; value: StyleValue<Color> }
  | { field: "text_shadow"; value: TextShadow | null };

/**
 * Narrow interface exposing only the methods that canvas tools actually call.
 *
 * Tools should depend on this instead of the full DocumentStoreAPI to keep
 * coupling minimal and make testing straightforward.
 */
export interface ToolStore {
  getAllNodes(): ReadonlyMap<string, DocumentNode>;
  /** @deprecated Use setSelectedNodeIds() instead. Retained for single-select backward compat. */
  select(uuid: string | null): void;
  setTransform(uuid: string, transform: Transform): void;
  createNode(kind: NodeKind, name: string, transform: Transform): string;
  /** @deprecated Use getSelectedNodeIds() instead. Returns the first selected node or null. */
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
