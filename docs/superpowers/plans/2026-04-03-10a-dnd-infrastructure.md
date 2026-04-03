# DnD Infrastructure Implementation Plan (Plan 10a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install `dnd-kit-solid` and create shared DnD types, tree insertion logic with Figma-style indentation-aware depth detection, and a visual drop indicator component.

**Architecture:** `dnd-kit-solid` provides the DnD primitives (DragDropProvider, useDraggable, useDroppable, useSortable). We add a thin layer on top: shared types for tree drop targets, a pure function that calculates drop position from cursor coordinates (vertical zone + horizontal indent), and a visual indicator component. The DragDropProvider wraps the entire app in App.tsx.

**Tech Stack:** `dnd-kit-solid`, Solid.js 1.9, TypeScript

---

## Task 1: Install dnd-kit-solid

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install the library**

```bash
pnpm --prefix frontend add dnd-kit-solid
```

- [ ] **Step 2: Verify build**

```bash
pnpm --prefix frontend build
```

Expected: Build succeeds (new dep not yet imported anywhere).

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml
git commit -m "chore(frontend): add dnd-kit-solid dependency (Plan 10a, Task 1)"
```

---

## Task 2: DnD shared types

**Files:**
- Create: `frontend/src/dnd/types.ts`

- [ ] **Step 1: Create the DnD types**

Create `frontend/src/dnd/types.ts`:

```typescript
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
}

/** Data attached to a draggable layer node. */
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
```

- [ ] **Step 2: Verify compilation**

```bash
pnpm --prefix frontend exec tsc --noEmit 2>&1 | grep "dnd" || echo "No errors in dnd"
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/dnd/types.ts
git commit -m "feat(frontend): add shared DnD types (Plan 10a, Task 2)"
```

---

## Task 3: Tree insertion logic

**Files:**
- Create: `frontend/src/dnd/tree-insertion.ts`
- Create: `frontend/src/dnd/__tests__/tree-insertion.test.ts`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/dnd/__tests__/tree-insertion.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeDropTarget, canDropInside } from "../tree-insertion";

describe("computeDropTarget", () => {
  const ROW_HEIGHT = 28;

  it("returns 'before' when cursor is in top 25% of row", () => {
    const result = computeDropTarget({
      targetUuid: "node-1",
      targetDepth: 2,
      targetCanHaveChildren: true,
      cursorY: 3,
      rowHeight: ROW_HEIGHT,
      cursorX: 60,
      treeLeftEdge: 0,
    });
    expect(result.position).toBe("before");
    expect(result.targetUuid).toBe("node-1");
  });

  it("returns 'after' when cursor is in bottom 25% of row", () => {
    const result = computeDropTarget({
      targetUuid: "node-1",
      targetDepth: 2,
      targetCanHaveChildren: true,
      cursorY: 25,
      rowHeight: ROW_HEIGHT,
      cursorX: 60,
      treeLeftEdge: 0,
    });
    expect(result.position).toBe("after");
  });

  it("returns 'inside' when cursor is in middle 50% of a container node", () => {
    const result = computeDropTarget({
      targetUuid: "frame-1",
      targetDepth: 1,
      targetCanHaveChildren: true,
      cursorY: 14,
      rowHeight: ROW_HEIGHT,
      cursorX: 60,
      treeLeftEdge: 0,
    });
    expect(result.position).toBe("inside");
    expect(result.depth).toBe(2); // inside = target depth + 1
  });

  it("returns 'before' instead of 'inside' for non-container nodes", () => {
    const result = computeDropTarget({
      targetUuid: "rect-1",
      targetDepth: 2,
      targetCanHaveChildren: false,
      cursorY: 14,
      rowHeight: ROW_HEIGHT,
      cursorX: 60,
      treeLeftEdge: 0,
    });
    // Middle zone on non-container falls back to nearest edge
    expect(result.position).not.toBe("inside");
  });

  it("calculates depth from horizontal cursor position", () => {
    // Cursor at 60px from tree left, INDENT_WIDTH=20 → depth 3
    const result = computeDropTarget({
      targetUuid: "node-1",
      targetDepth: 3,
      targetCanHaveChildren: false,
      cursorY: 3,
      rowHeight: ROW_HEIGHT,
      cursorX: 60,
      treeLeftEdge: 0,
    });
    expect(result.depth).toBe(3);
  });

  it("clamps depth to max valid depth for 'before' position", () => {
    // Target is at depth 2, cursor indicates depth 5 → clamped to 2
    const result = computeDropTarget({
      targetUuid: "node-1",
      targetDepth: 2,
      targetCanHaveChildren: false,
      cursorY: 3,
      rowHeight: ROW_HEIGHT,
      cursorX: 200,
      treeLeftEdge: 0,
    });
    expect(result.depth).toBeLessThanOrEqual(2);
  });

  it("allows depth = targetDepth + 1 for 'after' position", () => {
    const result = computeDropTarget({
      targetUuid: "node-1",
      targetDepth: 2,
      targetCanHaveChildren: false,
      cursorY: 25,
      rowHeight: ROW_HEIGHT,
      cursorX: 200,
      treeLeftEdge: 0,
    });
    expect(result.depth).toBeLessThanOrEqual(3);
  });

  it("clamps depth minimum to 0", () => {
    const result = computeDropTarget({
      targetUuid: "node-1",
      targetDepth: 1,
      targetCanHaveChildren: false,
      cursorY: 3,
      rowHeight: ROW_HEIGHT,
      cursorX: -10,
      treeLeftEdge: 0,
    });
    expect(result.depth).toBeGreaterThanOrEqual(0);
  });
});

describe("canDropInside", () => {
  it("returns true for frame nodes", () => {
    expect(canDropInside("frame")).toBe(true);
  });

  it("returns true for group nodes", () => {
    expect(canDropInside("group")).toBe(true);
  });

  it("returns false for rectangle nodes", () => {
    expect(canDropInside("rectangle")).toBe(false);
  });

  it("returns false for text nodes", () => {
    expect(canDropInside("text")).toBe(false);
  });

  it("returns false for ellipse nodes", () => {
    expect(canDropInside("ellipse")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --prefix frontend test -- --reporter=verbose src/dnd/__tests__/tree-insertion.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement tree insertion logic**

Create `frontend/src/dnd/tree-insertion.ts`:

```typescript
import { INDENT_WIDTH, type DropPosition, type TreeDropTarget } from "./types";

/** Node kinds that can contain children. */
const CONTAINER_KINDS = new Set(["frame", "group"]);

/**
 * Returns whether a node of the given kind can accept children.
 */
export function canDropInside(kindType: string): boolean {
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

    // Clamp based on position
    const maxDepth =
      position === "before"
        ? targetDepth // Can't be deeper than what we're inserting before
        : targetDepth + 1; // After: can nest one level deeper as last child

    depth = Math.max(0, Math.min(rawDepth, maxDepth));
  }

  return { targetUuid, position, depth };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --prefix frontend test -- --reporter=verbose src/dnd/__tests__/tree-insertion.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/dnd/
git commit -m "feat(frontend): add tree insertion logic with depth-aware drop detection (Plan 10a, Task 3)"
```

---

## Task 4: TreeDropIndicator component

**Files:**
- Create: `frontend/src/dnd/TreeDropIndicator.tsx`
- Create: `frontend/src/dnd/TreeDropIndicator.css`

- [ ] **Step 1: Create the CSS**

Create `frontend/src/dnd/TreeDropIndicator.css`:

```css
.sigil-drop-indicator {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent, #cba6f7);
  pointer-events: none;
  z-index: 10;
}

.sigil-drop-indicator::before {
  content: "";
  position: absolute;
  left: 0;
  top: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent, #cba6f7);
}

.sigil-drop-indicator--inside {
  height: 100%;
  background: color-mix(in srgb, var(--accent, #cba6f7) 15%, transparent);
  border: 1px solid var(--accent, #cba6f7);
  border-radius: 4px;
}

.sigil-drop-indicator--inside::before {
  display: none;
}
```

- [ ] **Step 2: Create the component**

Create `frontend/src/dnd/TreeDropIndicator.tsx`:

```tsx
import { Show, type Component } from "solid-js";
import type { TreeDropTarget } from "./types";
import { INDENT_WIDTH } from "./types";
import "./TreeDropIndicator.css";

interface TreeDropIndicatorProps {
  /** The computed drop target, or null if not showing. */
  readonly target: TreeDropTarget | null;
  /** Height of a single tree row in pixels. */
  readonly rowHeight: number;
  /**
   * Y offset of the target row from the top of the tree container.
   * Used to position the indicator absolutely.
   */
  readonly rowTop: number;
}

export const TreeDropIndicator: Component<TreeDropIndicatorProps> = (props) => {
  return (
    <Show when={props.target}>
      {(target) => {
        const isInside = () => target().position === "inside";
        const indentPx = () => target().depth * INDENT_WIDTH;

        const style = () => {
          if (isInside()) {
            return {
              top: `${props.rowTop}px`,
              left: `${indentPx()}px`,
              height: `${props.rowHeight}px`,
            };
          }

          const y =
            target().position === "before"
              ? props.rowTop
              : props.rowTop + props.rowHeight;

          return {
            top: `${y - 1}px`,
            left: `${indentPx()}px`,
          };
        };

        return (
          <div
            class={`sigil-drop-indicator ${isInside() ? "sigil-drop-indicator--inside" : ""}`}
            style={style()}
            aria-hidden="true"
          />
        );
      }}
    </Show>
  );
};
```

- [ ] **Step 3: Verify compilation**

```bash
pnpm --prefix frontend build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/dnd/
git commit -m "feat(frontend): add TreeDropIndicator component (Plan 10a, Task 4)"
```

---

## Task 5: Wrap App in DragDropProvider

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Read current App.tsx**

Read `frontend/src/App.tsx` to understand the current wrapper structure.

- [ ] **Step 2: Add DragDropProvider**

Import and wrap the app-shell div:

```tsx
import { DragDropProvider } from "dnd-kit-solid";
```

Wrap inside the existing `<AnnounceProvider>`:

```tsx
<DocumentProvider store={store}>
  <AnnounceProvider announce={announce}>
    <DragDropProvider>
      <div class="app-shell">
        {/* ... existing children unchanged ... */}
      </div>
    </DragDropProvider>
  </AnnounceProvider>
</DocumentProvider>
```

- [ ] **Step 3: Verify build and tests**

```bash
pnpm --prefix frontend build && pnpm --prefix frontend test
```

Expected: Build succeeds, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): wrap App in DragDropProvider (Plan 10a, Task 5)"
```

---

## Task 6: Final verification

- [ ] **Step 1: Lint**

```bash
pnpm --prefix frontend lint
```

- [ ] **Step 2: Format**

```bash
pnpm --prefix frontend format
```

- [ ] **Step 3: Tests**

```bash
pnpm --prefix frontend test
```

- [ ] **Step 4: Build**

```bash
pnpm --prefix frontend build
```

- [ ] **Step 5: Commit if fixes needed**

```bash
git add -A
git commit -m "chore(frontend): lint and format (Plan 10a, Task 6)"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Install `dnd-kit-solid` | `package.json` |
| 2 | Shared DnD types | `dnd/types.ts` |
| 3 | Tree insertion logic + tests | `dnd/tree-insertion.ts`, 11 tests |
| 4 | TreeDropIndicator component | `dnd/TreeDropIndicator.tsx` |
| 5 | Wrap App in DragDropProvider | `App.tsx` |
| 6 | Final verification | Lint, format, build |

After this plan, the DnD infrastructure is ready. Plan 10b (Layers panel) and Plan 10c (Pages panel) build on it.
