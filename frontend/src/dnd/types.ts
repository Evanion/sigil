/**
 * Shared drag-and-drop types used by the layers panel and pages panel.
 *
 * These types describe _where_ to drop, not _what_ is being dragged.
 * The "what" is carried in each draggable's `data` property via dnd-kit-solid.
 */

/** Where to drop relative to the target node in the tree. */
export type DropPosition = "before" | "after" | "inside";

/**
 * Full drop target description for tree DnD.
 *
 * Computed from the cursor's vertical zone (before/after/inside) and
 * horizontal position (indentation depth).
 */
export interface TreeDropTarget {
  /** UUID of the node being dropped on/near. */
  readonly targetUuid: string;
  /** Relative position to the target. */
  readonly position: DropPosition;
  /**
   * Target depth (indentation level) for the dropped node.
   * 0 = page root, 1 = direct child of a root frame, etc.
   */
  readonly depth: number;
  /**
   * Optional parent UUID resolved by the consumer from the flat list context.
   *
   * `computeDropTarget` does NOT populate this field -- it only computes
   * targetUuid, position, and depth from cursor geometry. The consumer
   * (e.g., the layers panel) must resolve the actual parent UUID from
   * the tree structure based on the computed position and depth.
   */
  readonly parentUuid?: string;
}

/**
 * Data attached to a draggable layer node.
 *
 * Consumer requirement: The drag handle element MUST be an interactive element
 * ({@link HTMLButtonElement} or `role="button"`) with `tabindex="0"` and
 * `aria-label` describing the node and its drag affordance.
 */
export interface LayerDragData {
  readonly type: "layer";
  readonly uuid: string;
}

/** Data attached to a draggable page item. */
export interface PageDragData {
  readonly type: "page";
  readonly pageId: string;
}

/** Union of all drag data types. */
export type DragData = LayerDragData | PageDragData;

/**
 * Width in pixels of one indentation level in the tree view.
 * Used for both rendering indent and calculating drop depth.
 */
export const INDENT_WIDTH = 20;
