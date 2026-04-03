import { INDENT_WIDTH, type DropPosition, type TreeDropTarget } from "./types";

/** Discriminant values for node kinds used in the design engine. */
export type NodeKindType =
  | "frame"
  | "group"
  | "rectangle"
  | "ellipse"
  | "text"
  | "image"
  | "path"
  | "component_instance";

/** Node kinds that can contain children. */
const CONTAINER_KINDS: ReadonlySet<NodeKindType> = new Set<NodeKindType>(["frame", "group"]);

/**
 * Returns whether a node of the given kind can accept children.
 */
export function canDropInside(kindType: NodeKindType): boolean {
  return CONTAINER_KINDS.has(kindType);
}

/** Input parameters for drop target computation. */
export interface DropTargetInput {
  /** UUID of the node the cursor is hovering over. */
  readonly targetUuid: string;
  /** Depth (indentation level) of the hovered node. */
  readonly targetDepth: number;
  /** Whether the hovered node can have children (frame/group). */
  readonly targetCanHaveChildren: boolean;
  /** Cursor Y position relative to the top of the hovered row. */
  readonly cursorY: number;
  /** Height of a single tree row in pixels. */
  readonly rowHeight: number;
  /** Cursor X position in the viewport. */
  readonly cursorX: number;
  /** X position of the tree's left edge in the viewport. */
  readonly treeLeftEdge: number;
}

/**
 * Computes the drop target from cursor position.
 *
 * Uses vertical zones (top 25% = before, bottom 25% = after, middle 50% = inside)
 * combined with horizontal position for indentation-aware depth calculation.
 */
export function computeDropTarget(input: DropTargetInput): TreeDropTarget {
  const {
    targetUuid,
    targetDepth,
    targetCanHaveChildren,
    cursorY,
    rowHeight,
    cursorX,
    treeLeftEdge,
  } = input;

  // Guard: non-finite or non-positive rowHeight would cause division-by-zero or NaN propagation.
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
    return { targetUuid, position: "after" as const, depth: Math.max(0, targetDepth) };
  }
  // Guard: non-finite cursor coordinates cannot produce meaningful zone detection.
  if (!Number.isFinite(cursorY) || !Number.isFinite(cursorX)) {
    return { targetUuid, position: "after" as const, depth: Math.max(0, targetDepth) };
  }

  // Vertical zone detection
  const relativeY = cursorY / rowHeight;
  let position: DropPosition;

  if (relativeY < 0.25) {
    position = "before";
  } else if (relativeY > 0.75) {
    position = "after";
  } else if (targetCanHaveChildren) {
    position = "inside";
  } else {
    // Non-container node: snap to nearest edge
    position = relativeY < 0.5 ? "before" : "after";
  }

  // Depth calculation
  let depth: number;

  if (position === "inside") {
    // Dropping inside a container: depth is always target + 1
    depth = targetDepth + 1;
  } else {
    // Calculate depth from horizontal cursor position
    const rawDepth = Math.floor((cursorX - treeLeftEdge) / INDENT_WIDTH);

    // Clamp based on position.
    // NOTE: This depth is a hint based on cursor indentation. Consumers (e.g., the layers panel)
    // MUST validate the computed depth against the actual tree structure to prevent reparenting
    // into non-container nodes. The depth here may exceed what the tree allows at a given position.
    const maxDepth =
      position === "before"
        ? targetDepth // Can't be deeper than what we're inserting before
        : targetDepth + 1; // After: can nest one level deeper as last child

    depth = Math.max(0, Math.min(rawDepth, maxDepth));
  }

  return { targetUuid, position, depth };
}
