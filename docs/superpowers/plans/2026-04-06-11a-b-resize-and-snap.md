# Plan 11a-b: Single-Node Resize + Smart Guide Snapping

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 8 selection handles interactive -- pointer-down on a handle enters resize mode, drag computes a new transform via pure resize math, and pointer-up commits a single `setTransform` mutation. Add a snap engine that aligns moving/resizing nodes to other nodes' edges and centers, rendering pink guide lines when snapped.

**Architecture:** Three new pure-function modules (`handle-hit-test.ts`, `resize-math.ts`, `snap-engine.ts`) with zero side effects, fully testable in isolation via Vitest. The select tool's state machine gains a `resizing` state alongside the existing `moving` state. The renderer gains a `drawGuideLines` function. The Canvas component threads snap guide data from the tool to the renderer via a new signal.

**Tech Stack:** TypeScript, Solid.js 1.9, Vitest, HTML5 Canvas 2D

**Depends on:** Plan 11a-a (backend foundation) must be merged first -- it provides the multi-select store migration and `BatchSetTransform` command. However, the single-node resize path in this plan only uses the existing `setTransform` store method, so Tasks 1-5 can begin in parallel with 11a-a.

---

## Scope

**In scope:**
- Handle hit-test module: identify which of 8 handles the pointer is over
- Resize math module: compute new transforms for all 8 handle types with Shift (aspect lock) and Alt (resize from center) modifiers
- Snap engine module: collect snap targets, binary search for nearest match, return snapped transform + guide lines
- Select tool state machine expansion: `resizing` state with preview, commit, cancel
- Guide line rendering in the canvas renderer
- Canvas.tsx integration: threading snap guides, modifier keys, cursor changes
- Vitest configuration (first tests in the project)

**Deferred:**
- Multi-select resize (requires Plan 11a-a multi-select store)
- Marquee selection (Plan 11a-c)
- Align/distribute panel (Plan 11a-d)
- Rotation handle (Spec 11a, section 10.2)

---

## Task 1: Vitest Configuration + Handle Hit-Test Module

**Files:**
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/canvas/handle-hit-test.ts`
- Create: `frontend/src/canvas/__tests__/handle-hit-test.test.ts`

- [ ] **Step 1: Create Vitest configuration**

Create `frontend/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
```

This is the first test file in the frontend. The test environment is `node` because these are pure-function unit tests with no DOM dependency.

- [ ] **Step 2: Write failing tests for handle hit-test**

Create `frontend/src/canvas/__tests__/handle-hit-test.test.ts`:

```typescript
/**
 * Tests for handle hit-testing.
 *
 * Verifies that hitTestHandle correctly identifies which of the 8 resize
 * handles (NW, N, NE, E, SE, S, SW, W) the pointer is over, returns null
 * on miss, and maintains consistent hit zones regardless of zoom level.
 */

import { describe, it, expect } from "vitest";
import {
  hitTestHandle,
  getHandleCursor,
  HandleType,
} from "../handle-hit-test";
import type { Transform } from "../../types/document";

const TRANSFORM: Transform = {
  x: 100,
  y: 100,
  width: 200,
  height: 150,
  rotation: 0,
  scale_x: 1,
  scale_y: 1,
};

const ZOOM = 1;

describe("hitTestHandle", () => {
  it("returns NW when pointer is on the top-left corner", () => {
    expect(hitTestHandle(TRANSFORM, 100, 100, ZOOM)).toBe(HandleType.NW);
  });

  it("returns N when pointer is on the top-center edge", () => {
    expect(hitTestHandle(TRANSFORM, 200, 100, ZOOM)).toBe(HandleType.N);
  });

  it("returns NE when pointer is on the top-right corner", () => {
    expect(hitTestHandle(TRANSFORM, 300, 100, ZOOM)).toBe(HandleType.NE);
  });

  it("returns E when pointer is on the right-center edge", () => {
    expect(hitTestHandle(TRANSFORM, 300, 175, ZOOM)).toBe(HandleType.E);
  });

  it("returns SE when pointer is on the bottom-right corner", () => {
    expect(hitTestHandle(TRANSFORM, 300, 250, ZOOM)).toBe(HandleType.SE);
  });

  it("returns S when pointer is on the bottom-center edge", () => {
    expect(hitTestHandle(TRANSFORM, 200, 250, ZOOM)).toBe(HandleType.S);
  });

  it("returns SW when pointer is on the bottom-left corner", () => {
    expect(hitTestHandle(TRANSFORM, 100, 250, ZOOM)).toBe(HandleType.SW);
  });

  it("returns W when pointer is on the left-center edge", () => {
    expect(hitTestHandle(TRANSFORM, 100, 175, ZOOM)).toBe(HandleType.W);
  });

  it("returns null when pointer is inside the node but not on a handle", () => {
    expect(hitTestHandle(TRANSFORM, 200, 175, ZOOM)).toBeNull();
  });

  it("returns null when pointer is outside the node entirely", () => {
    expect(hitTestHandle(TRANSFORM, 500, 500, ZOOM)).toBeNull();
  });

  it("hit zone scales inversely with zoom (zoom-independent screen-space)", () => {
    // At zoom=2, hit zone in world space is 8/2 = 4px per side
    // Point at (104, 104) is 4px from corner — just inside at zoom=2
    expect(hitTestHandle(TRANSFORM, 104, 104, 2)).toBe(HandleType.NW);
    // Point at (106, 106) is 6px from corner — outside at zoom=2 (threshold=4)
    expect(hitTestHandle(TRANSFORM, 106, 106, 2)).toBeNull();
  });

  it("corners take priority over edges when both are within hit zone", () => {
    // At zoom=1, the NW handle center is at (100,100). A point at
    // (100, 100) is equidistant from NW corner and N/W edge midpoints.
    // Corners must win because they are checked first.
    expect(hitTestHandle(TRANSFORM, 100, 100, ZOOM)).toBe(HandleType.NW);
  });
});

describe("getHandleCursor", () => {
  it("returns nwse-resize for NW", () => {
    expect(getHandleCursor(HandleType.NW)).toBe("nwse-resize");
  });

  it("returns ns-resize for N", () => {
    expect(getHandleCursor(HandleType.N)).toBe("ns-resize");
  });

  it("returns nesw-resize for NE", () => {
    expect(getHandleCursor(HandleType.NE)).toBe("nesw-resize");
  });

  it("returns ew-resize for E", () => {
    expect(getHandleCursor(HandleType.E)).toBe("ew-resize");
  });

  it("returns nwse-resize for SE", () => {
    expect(getHandleCursor(HandleType.SE)).toBe("nwse-resize");
  });

  it("returns ns-resize for S", () => {
    expect(getHandleCursor(HandleType.S)).toBe("ns-resize");
  });

  it("returns nesw-resize for SW", () => {
    expect(getHandleCursor(HandleType.SW)).toBe("nesw-resize");
  });

  it("returns ew-resize for W", () => {
    expect(getHandleCursor(HandleType.W)).toBe("ew-resize");
  });
});
```

Run tests — all should fail (module does not exist yet):

```bash
pnpm --prefix frontend test
```

- [ ] **Step 3: Implement handle-hit-test module**

Create `frontend/src/canvas/handle-hit-test.ts`:

```typescript
/**
 * Handle hit-testing for resize handles on selected nodes.
 *
 * Identifies which of 8 resize handles (4 corners + 4 edge midpoints)
 * the pointer is over, using an 8px screen-space hit zone that scales
 * inversely with zoom to remain consistent at any zoom level.
 *
 * Handle positions are computed identically to how renderer.ts draws
 * them (see drawSelectionHandles).
 */

import type { Transform } from "../types/document";

/** The 8 resize handle identifiers. */
export const enum HandleType {
  NW = "nw",
  N = "n",
  NE = "ne",
  E = "e",
  SE = "se",
  S = "s",
  SW = "sw",
  W = "w",
}

/**
 * Hit zone size in screen pixels. The world-space hit zone is
 * HANDLE_HIT_ZONE_PX / zoom, keeping handle sensitivity constant
 * regardless of viewport zoom.
 */
const HANDLE_HIT_ZONE_PX = 8;

/**
 * Test whether a world-space point is within the hit zone of any
 * resize handle on the given transform.
 *
 * Corners are tested before edges so that corners take priority when
 * the pointer is near a corner (where an edge midpoint might also be
 * within range on small nodes).
 *
 * @param transform - The selected node's transform.
 * @param worldX - Pointer X in world coordinates.
 * @param worldY - Pointer Y in world coordinates.
 * @param zoom - Current viewport zoom level.
 * @returns The handle under the pointer, or null if no handle is hit.
 */
export function hitTestHandle(
  transform: Transform,
  worldX: number,
  worldY: number,
  zoom: number,
): HandleType | null {
  const { x, y, width, height } = transform;
  const threshold = HANDLE_HIT_ZONE_PX / zoom;

  // Handle positions: [handleType, centerX, centerY]
  // Corners first (priority over edges)
  const handles: ReadonlyArray<readonly [HandleType, number, number]> = [
    [HandleType.NW, x, y],
    [HandleType.NE, x + width, y],
    [HandleType.SE, x + width, y + height],
    [HandleType.SW, x, y + height],
    [HandleType.N, x + width / 2, y],
    [HandleType.E, x + width, y + height / 2],
    [HandleType.S, x + width / 2, y + height],
    [HandleType.W, x, y + height / 2],
  ];

  for (const [handleType, hx, hy] of handles) {
    const dx = Math.abs(worldX - hx);
    const dy = Math.abs(worldY - hy);
    if (dx <= threshold && dy <= threshold) {
      return handleType;
    }
  }

  return null;
}

/**
 * Map a handle type to the appropriate CSS cursor string.
 *
 * Cursor names follow the CSS spec for resize cursors and match the
 * table in Spec 11a section 1.1.
 */
export function getHandleCursor(handle: HandleType): string {
  switch (handle) {
    case HandleType.NW:
      return "nwse-resize";
    case HandleType.N:
      return "ns-resize";
    case HandleType.NE:
      return "nesw-resize";
    case HandleType.E:
      return "ew-resize";
    case HandleType.SE:
      return "nwse-resize";
    case HandleType.S:
      return "ns-resize";
    case HandleType.SW:
      return "nesw-resize";
    case HandleType.W:
      return "ew-resize";
  }
}
```

Run tests — all should pass:

```bash
pnpm --prefix frontend test
```

- [ ] **Step 4: Commit**

```
git add frontend/vitest.config.ts frontend/src/canvas/handle-hit-test.ts frontend/src/canvas/__tests__/handle-hit-test.test.ts
git commit -m "feat(frontend): handle hit-test module with zoom-independent hit zones (Plan 11a-b, Task 1)"
```

---

## Task 2: Resize Math Module

**Files:**
- Create: `frontend/src/canvas/resize-math.ts`
- Create: `frontend/src/canvas/__tests__/resize-math.test.ts`

- [ ] **Step 1: Write failing tests for resize math**

Create `frontend/src/canvas/__tests__/resize-math.test.ts`:

```typescript
/**
 * Tests for the resize math module.
 *
 * Verifies that computeResize produces correct transforms for all 8 handle
 * types, with and without Shift (aspect lock) and Alt (resize from center)
 * modifiers, and that minimum size clamping works.
 */

import { describe, it, expect } from "vitest";
import { computeResize } from "../resize-math";
import { HandleType } from "../handle-hit-test";
import type { Transform } from "../../types/document";

const ORIGINAL: Transform = {
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  rotation: 0,
  scale_x: 1,
  scale_y: 1,
};

const NO_MODS = { shift: false, alt: false };

describe("computeResize — SE handle (simplest case)", () => {
  it("increases width and height with positive delta", () => {
    const result = computeResize(ORIGINAL, HandleType.SE, { dx: 50, dy: 30 }, NO_MODS);
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(result.width).toBe(250);
    expect(result.height).toBe(130);
  });

  it("decreases width and height with negative delta", () => {
    const result = computeResize(ORIGINAL, HandleType.SE, { dx: -50, dy: -30 }, NO_MODS);
    expect(result.width).toBe(150);
    expect(result.height).toBe(70);
  });
});

describe("computeResize — NW handle", () => {
  it("moves origin and adjusts size", () => {
    const result = computeResize(ORIGINAL, HandleType.NW, { dx: 20, dy: 10 }, NO_MODS);
    expect(result.x).toBe(120);
    expect(result.y).toBe(110);
    expect(result.width).toBe(180);
    expect(result.height).toBe(90);
  });
});

describe("computeResize — edge handles (single axis)", () => {
  it("N handle adjusts y and height only", () => {
    const result = computeResize(ORIGINAL, HandleType.N, { dx: 999, dy: -30 }, NO_MODS);
    expect(result.x).toBe(100);
    expect(result.y).toBe(70);
    expect(result.width).toBe(200);
    expect(result.height).toBe(130);
  });

  it("E handle adjusts width only", () => {
    const result = computeResize(ORIGINAL, HandleType.E, { dx: 40, dy: 999 }, NO_MODS);
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(result.width).toBe(240);
    expect(result.height).toBe(100);
  });

  it("S handle adjusts height only", () => {
    const result = computeResize(ORIGINAL, HandleType.S, { dx: 999, dy: 40 }, NO_MODS);
    expect(result.width).toBe(200);
    expect(result.height).toBe(140);
  });

  it("W handle adjusts x and width only", () => {
    const result = computeResize(ORIGINAL, HandleType.W, { dx: -20, dy: 999 }, NO_MODS);
    expect(result.x).toBe(80);
    expect(result.width).toBe(220);
    expect(result.height).toBe(100);
  });
});

describe("computeResize — NE and SW handles", () => {
  it("NE handle: width increases, y moves up, height increases", () => {
    const result = computeResize(ORIGINAL, HandleType.NE, { dx: 30, dy: -20 }, NO_MODS);
    expect(result.x).toBe(100);
    expect(result.y).toBe(80);
    expect(result.width).toBe(230);
    expect(result.height).toBe(120);
  });

  it("SW handle: x moves left, width increases, height increases", () => {
    const result = computeResize(ORIGINAL, HandleType.SW, { dx: -30, dy: 20 }, NO_MODS);
    expect(result.x).toBe(70);
    expect(result.y).toBe(100);
    expect(result.width).toBe(230);
    expect(result.height).toBe(120);
  });
});

describe("computeResize — minimum size clamping", () => {
  it("clamps width to 1 when drag would make it zero or negative", () => {
    const result = computeResize(ORIGINAL, HandleType.SE, { dx: -300, dy: 0 }, NO_MODS);
    expect(result.width).toBe(1);
  });

  it("clamps height to 1 when drag would make it zero or negative", () => {
    const result = computeResize(ORIGINAL, HandleType.SE, { dx: 0, dy: -300 }, NO_MODS);
    expect(result.height).toBe(1);
  });

  it("clamps NW handle: x does not exceed right edge minus 1", () => {
    const result = computeResize(ORIGINAL, HandleType.NW, { dx: 500, dy: 500 }, NO_MODS);
    // Right edge is at 300. Max x = 300 - 1 = 299.
    expect(result.x).toBe(299);
    expect(result.width).toBe(1);
    expect(result.y).toBe(199);
    expect(result.height).toBe(1);
  });
});

describe("computeResize — Shift modifier (aspect ratio lock)", () => {
  it("SE corner locks aspect ratio (2:1 original)", () => {
    // Original is 200x100 = 2:1 aspect ratio.
    // Drag SE by (60, 60). Unconstrained would be 260x160.
    // Constrained: pick the larger dimension change.
    // dx=60 => new width 260 => height 260/2 = 130
    // dy=60 => new height 160 => width 160*2 = 320
    // We use the axis with the larger absolute delta to drive.
    // Both are equal (60), so use width-dominant: 260x130.
    const result = computeResize(ORIGINAL, HandleType.SE, { dx: 60, dy: 60 }, { shift: true, alt: false });
    // With aspect lock, the dominant axis drives.
    // Implementation detail: when equal, width drives.
    expect(result.width / result.height).toBeCloseTo(2, 5);
    expect(result.width).toBeGreaterThan(200);
  });

  it("Shift has no effect on edge handles (single-axis only)", () => {
    const result = computeResize(ORIGINAL, HandleType.E, { dx: 50, dy: 0 }, { shift: true, alt: false });
    expect(result.width).toBe(250);
    expect(result.height).toBe(100);
  });
});

describe("computeResize — Alt modifier (resize from center)", () => {
  it("SE corner with Alt: both sides move equally, center stays fixed", () => {
    // Original center: (200, 150). Drag SE by (40, 20).
    // Both sides expand by delta: width += 2*40 = 80, height += 2*20 = 40
    // New: x = 100-40=60, y = 100-20=80, width=280, height=140
    const result = computeResize(ORIGINAL, HandleType.SE, { dx: 40, dy: 20 }, { shift: false, alt: true });
    expect(result.x).toBe(60);
    expect(result.y).toBe(80);
    expect(result.width).toBe(280);
    expect(result.height).toBe(140);
    // Verify center is preserved
    expect(result.x + result.width / 2).toBeCloseTo(200, 5);
    expect(result.y + result.height / 2).toBeCloseTo(150, 5);
  });
});

describe("computeResize — Shift+Alt combined", () => {
  it("SE corner with Shift+Alt: proportional from center", () => {
    const result = computeResize(ORIGINAL, HandleType.SE, { dx: 60, dy: 60 }, { shift: true, alt: true });
    expect(result.width / result.height).toBeCloseTo(2, 5);
    // Center preserved
    expect(result.x + result.width / 2).toBeCloseTo(200, 5);
    expect(result.y + result.height / 2).toBeCloseTo(150, 5);
  });
});

describe("computeResize — preserves rotation and scale", () => {
  it("rotation and scale_x/scale_y are passed through unchanged", () => {
    const rotated: Transform = { ...ORIGINAL, rotation: 45, scale_x: 2, scale_y: 0.5 };
    const result = computeResize(rotated, HandleType.SE, { dx: 10, dy: 10 }, NO_MODS);
    expect(result.rotation).toBe(45);
    expect(result.scale_x).toBe(2);
    expect(result.scale_y).toBe(0.5);
  });
});
```

Run tests — all fail:

```bash
pnpm --prefix frontend test
```

- [ ] **Step 2: Implement resize-math module**

Create `frontend/src/canvas/resize-math.ts`:

```typescript
/**
 * Pure resize math for computing new transforms during handle drag.
 *
 * Each handle has an anchor point (the opposite corner/edge). The new
 * transform is computed by applying the drag delta to the handle's axes
 * while keeping the anchor fixed (or centering with Alt).
 *
 * This module has zero side effects — it takes inputs and returns a
 * new Transform. All modifier logic (Shift for aspect lock, Alt for
 * center resize) is handled here.
 */

import type { Transform } from "../types/document";
import { HandleType } from "./handle-hit-test";

/** Minimum width or height during resize (world-space pixels). */
const MIN_SIZE = 1;

/** Which axes each handle affects. */
interface HandleAxes {
  readonly affectsX: boolean;
  readonly affectsY: boolean;
  readonly affectsWidth: boolean;
  readonly affectsHeight: boolean;
  /** Sign of dx applied to x (-1 = handle moves origin, +1 = ignored). */
  readonly xSign: number;
  /** Sign of dy applied to y. */
  readonly ySign: number;
  /** Sign of dx applied to width. */
  readonly wSign: number;
  /** Sign of dy applied to height. */
  readonly hSign: number;
  /** Whether this is a corner handle (eligible for aspect lock). */
  readonly isCorner: boolean;
}

const HANDLE_AXES: Readonly<Record<HandleType, HandleAxes>> = {
  [HandleType.NW]: { affectsX: true, affectsY: true, affectsWidth: true, affectsHeight: true, xSign: 1, ySign: 1, wSign: -1, hSign: -1, isCorner: true },
  [HandleType.N]:  { affectsX: false, affectsY: true, affectsWidth: false, affectsHeight: true, xSign: 0, ySign: 1, wSign: 0, hSign: -1, isCorner: false },
  [HandleType.NE]: { affectsX: false, affectsY: true, affectsWidth: true, affectsHeight: true, xSign: 0, ySign: 1, wSign: 1, hSign: -1, isCorner: true },
  [HandleType.E]:  { affectsX: false, affectsY: false, affectsWidth: true, affectsHeight: false, xSign: 0, ySign: 0, wSign: 1, hSign: 0, isCorner: false },
  [HandleType.SE]: { affectsX: false, affectsY: false, affectsWidth: true, affectsHeight: true, xSign: 0, ySign: 0, wSign: 1, hSign: 1, isCorner: true },
  [HandleType.S]:  { affectsX: false, affectsY: false, affectsWidth: false, affectsHeight: true, xSign: 0, ySign: 0, wSign: 0, hSign: 1, isCorner: false },
  [HandleType.SW]: { affectsX: true, affectsY: false, affectsWidth: true, affectsHeight: true, xSign: 1, ySign: 0, wSign: -1, hSign: 1, isCorner: true },
  [HandleType.W]:  { affectsX: true, affectsY: false, affectsWidth: true, affectsHeight: false, xSign: 1, ySign: 0, wSign: -1, hSign: 0, isCorner: false },
};

/**
 * Compute a new transform for a resize operation.
 *
 * @param original - The node's transform at drag start.
 * @param handle - Which handle is being dragged.
 * @param dragDelta - World-space delta from drag start to current pointer.
 * @param modifiers - Active modifier keys.
 * @returns A new Transform with the resized dimensions.
 */
export function computeResize(
  original: Transform,
  handle: HandleType,
  dragDelta: { readonly dx: number; readonly dy: number },
  modifiers: { readonly shift: boolean; readonly alt: boolean },
): Transform {
  const axes = HANDLE_AXES[handle];
  let { dx, dy } = dragDelta;

  // Shift: lock aspect ratio (corner handles only)
  if (modifiers.shift && axes.isCorner) {
    const aspectRatio = original.width / original.height;
    // Determine which axis the user is dragging more aggressively
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx >= absDy) {
      // Width-dominant: derive height from width
      const newWidth = original.width + dx * axes.wSign;
      const newHeight = newWidth / aspectRatio;
      dy = (newHeight - original.height) * axes.hSign;
    } else {
      // Height-dominant: derive width from height
      const newHeight = original.height + dy * axes.hSign;
      const newWidth = newHeight * aspectRatio;
      dx = (newWidth - original.width) * axes.wSign;
    }
  }

  let newX = original.x;
  let newY = original.y;
  let newWidth = original.width;
  let newHeight = original.height;

  if (axes.affectsX) {
    newX = original.x + dx * axes.xSign;
  }
  if (axes.affectsY) {
    newY = original.y + dy * axes.ySign;
  }
  if (axes.affectsWidth) {
    newWidth = original.width + dx * axes.wSign;
  }
  if (axes.affectsHeight) {
    newHeight = original.height + dy * axes.hSign;
  }

  // Alt: resize from center — mirror the delta to the opposite side
  if (modifiers.alt) {
    const centerX = original.x + original.width / 2;
    const centerY = original.y + original.height / 2;

    if (axes.affectsWidth) {
      // Double the width change, re-center
      const widthDelta = newWidth - original.width;
      newWidth = original.width + widthDelta * 2;
      newX = centerX - newWidth / 2;
    }
    if (axes.affectsHeight) {
      const heightDelta = newHeight - original.height;
      newHeight = original.height + heightDelta * 2;
      newY = centerY - newHeight / 2;
    }
  }

  // Clamp minimum size
  if (newWidth < MIN_SIZE) {
    // Adjust x so the right/left edge stays pinned
    if (axes.affectsX && !modifiers.alt) {
      newX = original.x + original.width - MIN_SIZE;
    }
    newWidth = MIN_SIZE;
  }
  if (newHeight < MIN_SIZE) {
    if (axes.affectsY && !modifiers.alt) {
      newY = original.y + original.height - MIN_SIZE;
    }
    newHeight = MIN_SIZE;
  }

  return {
    x: newX,
    y: newY,
    width: newWidth,
    height: newHeight,
    rotation: original.rotation,
    scale_x: original.scale_x,
    scale_y: original.scale_y,
  };
}
```

Run tests — all should pass:

```bash
pnpm --prefix frontend test
```

- [ ] **Step 3: Commit**

```
git add frontend/src/canvas/resize-math.ts frontend/src/canvas/__tests__/resize-math.test.ts
git commit -m "feat(frontend): resize math module with aspect lock and center resize (Plan 11a-b, Task 2)"
```

---

## Task 3: Snap Engine Module

**Files:**
- Create: `frontend/src/canvas/snap-engine.ts`
- Create: `frontend/src/canvas/__tests__/snap-engine.test.ts`

- [ ] **Step 1: Write failing tests for the snap engine**

Create `frontend/src/canvas/__tests__/snap-engine.test.ts`:

```typescript
/**
 * Tests for the snap engine.
 *
 * Verifies that the engine collects snap targets from nodes, finds the
 * nearest match via binary search, snaps independently on X and Y,
 * and produces the correct guide lines for rendering.
 */

import { describe, it, expect } from "vitest";
import { SnapEngine, type SnapGuide } from "../snap-engine";
import type { Transform } from "../../types/document";

/** Helper to create a minimal node-like object for the snap engine. */
function makeNode(uuid: string, t: Transform): { uuid: string; transform: Transform } {
  return { uuid, transform: t };
}

const T = (x: number, y: number, w: number, h: number): Transform => ({
  x, y, width: w, height: h, rotation: 0, scale_x: 1, scale_y: 1,
});

describe("SnapEngine", () => {
  it("snaps source left edge to target left edge", () => {
    const engine = new SnapEngine();
    engine.prepare(
      [makeNode("target", T(100, 200, 50, 50))],
      new Set(["dragged"]),
      1,
    );

    // Source left edge at x=102 — within 8px threshold of target x=100
    const result = engine.snap(T(102, 300, 60, 40));
    expect(result.snappedTransform.x).toBe(100);
    expect(result.guides.length).toBeGreaterThanOrEqual(1);
    expect(result.guides.some((g: SnapGuide) => g.axis === "x" && g.position === 100)).toBe(true);
  });

  it("snaps source right edge to target right edge", () => {
    const engine = new SnapEngine();
    engine.prepare(
      [makeNode("target", T(100, 200, 50, 50))],
      new Set(["dragged"]),
      1,
    );

    // Source: x=88, width=60 => right edge=148. Target right=150. Delta=2.
    const result = engine.snap(T(88, 300, 60, 40));
    // Snap should shift x by +2 so right edge = 150
    expect(result.snappedTransform.x).toBe(90);
    expect(result.snappedTransform.width).toBe(60); // width unchanged
  });

  it("snaps source center-x to target center-x", () => {
    const engine = new SnapEngine();
    engine.prepare(
      [makeNode("target", T(100, 200, 50, 50))], // center-x = 125
      new Set(["dragged"]),
      1,
    );

    // Source: x=92, width=60 => center=122. Target center=125. Delta=3.
    const result = engine.snap(T(92, 300, 60, 40));
    expect(result.snappedTransform.x).toBe(95); // shifted by +3
  });

  it("snaps Y axis independently from X axis", () => {
    const engine = new SnapEngine();
    engine.prepare(
      [makeNode("target", T(100, 200, 50, 50))],
      new Set(["dragged"]),
      1,
    );

    // Source: x=500 (far from any snap), y=198 (within 8px of target y=200)
    const result = engine.snap(T(500, 198, 60, 40));
    expect(result.snappedTransform.x).toBe(500); // no X snap
    expect(result.snappedTransform.y).toBe(200); // Y snapped
  });

  it("does not snap when beyond threshold", () => {
    const engine = new SnapEngine();
    engine.prepare(
      [makeNode("target", T(100, 200, 50, 50))],
      new Set(["dragged"]),
      1,
    );

    // Source at x=120 — 20px away from nearest target edge (100). Beyond threshold.
    const result = engine.snap(T(120, 300, 60, 40));
    expect(result.snappedTransform.x).toBe(120);
    expect(result.guides.filter((g: SnapGuide) => g.axis === "x")).toHaveLength(0);
  });

  it("returns multiple guides when snapped on both axes", () => {
    const engine = new SnapEngine();
    engine.prepare(
      [makeNode("target", T(100, 200, 50, 50))],
      new Set(["dragged"]),
      1,
    );

    // Source: x=102 (snap to 100), y=198 (snap to 200)
    const result = engine.snap(T(102, 198, 60, 40));
    const xGuides = result.guides.filter((g: SnapGuide) => g.axis === "x");
    const yGuides = result.guides.filter((g: SnapGuide) => g.axis === "y");
    expect(xGuides.length).toBeGreaterThanOrEqual(1);
    expect(yGuides.length).toBeGreaterThanOrEqual(1);
  });

  it("excludes nodes in the exclude set from targets", () => {
    const engine = new SnapEngine();
    engine.prepare(
      [
        makeNode("self", T(100, 100, 50, 50)),
        makeNode("other", T(300, 300, 50, 50)),
      ],
      new Set(["self"]),
      1,
    );

    // Source at x=102 — near "self" at x=100, but self is excluded
    const result = engine.snap(T(102, 400, 60, 40));
    expect(result.snappedTransform.x).toBe(102); // no snap to excluded node
  });

  it("threshold scales inversely with zoom", () => {
    const engine = new SnapEngine();
    engine.prepare(
      [makeNode("target", T(100, 200, 50, 50))],
      new Set(["dragged"]),
      2, // zoom=2 => threshold = 8/2 = 4px
    );

    // Source at x=103 — 3px away, within threshold of 4
    expect(engine.snap(T(103, 300, 60, 40)).snappedTransform.x).toBe(100);

    // Source at x=106 — 6px away, beyond threshold of 4
    expect(engine.snap(T(106, 300, 60, 40)).snappedTransform.x).toBe(106);
  });
});
```

Run tests — all fail:

```bash
pnpm --prefix frontend test
```

- [ ] **Step 2: Implement the snap engine**

Create `frontend/src/canvas/snap-engine.ts`:

```typescript
/**
 * Smart guide snap engine for move and resize operations.
 *
 * Collects snap targets (left edge, right edge, center per axis) from
 * all visible, non-dragged nodes into sorted arrays. On each pointer
 * move, binary-searches for the nearest match within a screen-space
 * threshold. X and Y axes snap independently.
 *
 * Returns the snapped transform and an array of guide lines for
 * the renderer to draw.
 */

import type { Transform } from "../types/document";

/** Default snap threshold in screen pixels. */
const SNAP_THRESHOLD_PX = 8;

/** A guide line to render when snapping is active. */
export interface SnapGuide {
  /** Which axis this guide line runs along. */
  readonly axis: "x" | "y";
  /** World-coordinate position of the guide line. */
  readonly position: number;
}

/** Result of a snap operation. */
export interface SnapResult {
  /** The transform after snapping has been applied. */
  readonly snappedTransform: Transform;
  /** Guide lines to render. */
  readonly guides: readonly SnapGuide[];
}

/** Minimal node shape required by the snap engine. */
interface SnapNode {
  readonly uuid: string;
  readonly transform: Transform;
}

/**
 * Binary search for the index of the closest value in a sorted array.
 * Returns the index of the element with the smallest absolute difference.
 */
function findNearest(sorted: readonly number[], target: number): number {
  if (sorted.length === 0) return -1;

  let lo = 0;
  let hi = sorted.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  // lo is the insertion point. Check lo and lo-1 for closest.
  if (lo === 0) return 0;
  if (lo >= sorted.length) return sorted.length - 1;

  const diffLo = Math.abs(sorted[lo] - target);
  const diffPrev = Math.abs(sorted[lo - 1] - target);
  return diffPrev <= diffLo ? lo - 1 : lo;
}

export class SnapEngine {
  /** Sorted X snap targets (left edges, right edges, center-x). */
  private xTargets: number[] = [];
  /** Sorted Y snap targets (top edges, bottom edges, center-y). */
  private yTargets: number[] = [];
  /** World-space threshold for this prepare cycle. */
  private threshold = SNAP_THRESHOLD_PX;

  /**
   * Collect snap targets from all provided nodes, excluding the dragged
   * node(s). Call once at drag start.
   *
   * @param nodes - All visible nodes in the document.
   * @param excludeIds - UUIDs of the node(s) being dragged (skip these).
   * @param zoom - Current viewport zoom for threshold calculation.
   */
  prepare(nodes: readonly SnapNode[], excludeIds: ReadonlySet<string>, zoom: number): void {
    this.threshold = SNAP_THRESHOLD_PX / zoom;

    const xs: number[] = [];
    const ys: number[] = [];

    for (const node of nodes) {
      if (excludeIds.has(node.uuid)) continue;

      const { x, y, width, height } = node.transform;

      // Validate all values are finite before adding as snap targets
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
      ) {
        continue;
      }

      xs.push(x, x + width, x + width / 2);
      ys.push(y, y + height, y + height / 2);
    }

    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);

    this.xTargets = xs;
    this.yTargets = ys;
  }

  /**
   * Snap a source transform to the nearest targets.
   *
   * Tests 3 source points per axis (left/right/center for X, top/bottom/center
   * for Y) and picks the closest match within threshold. Returns the adjusted
   * transform and any active guide lines.
   *
   * @param source - The current preview transform (before snapping).
   * @param customThreshold - Optional override for the snap threshold (world-space).
   * @returns The snapped transform and guide lines to render.
   */
  snap(source: Transform, customThreshold?: number): SnapResult {
    const threshold = customThreshold ?? this.threshold;
    const { x, y, width, height } = source;
    const guides: SnapGuide[] = [];

    // --- X axis ---
    const sourceXPoints = [x, x + width, x + width / 2];
    let bestXDelta: number | null = null;
    let bestXDistance = Infinity;
    let bestXGuide = 0;

    for (const sx of sourceXPoints) {
      const idx = findNearest(this.xTargets, sx);
      if (idx < 0) continue;
      const target = this.xTargets[idx];
      const dist = Math.abs(target - sx);
      if (dist <= threshold && dist < bestXDistance) {
        bestXDistance = dist;
        bestXDelta = target - sx;
        bestXGuide = target;
      }
    }

    // --- Y axis ---
    const sourceYPoints = [y, y + height, y + height / 2];
    let bestYDelta: number | null = null;
    let bestYDistance = Infinity;
    let bestYGuide = 0;

    for (const sy of sourceYPoints) {
      const idx = findNearest(this.yTargets, sy);
      if (idx < 0) continue;
      const target = this.yTargets[idx];
      const dist = Math.abs(target - sy);
      if (dist <= threshold && dist < bestYDistance) {
        bestYDistance = dist;
        bestYDelta = target - sy;
        bestYGuide = target;
      }
    }

    // Build snapped transform
    const snappedX = bestXDelta !== null ? x + bestXDelta : x;
    const snappedY = bestYDelta !== null ? y + bestYDelta : y;

    if (bestXDelta !== null) {
      guides.push({ axis: "x", position: bestXGuide });
    }
    if (bestYDelta !== null) {
      guides.push({ axis: "y", position: bestYGuide });
    }

    return {
      snappedTransform: {
        x: snappedX,
        y: snappedY,
        width,
        height,
        rotation: source.rotation,
        scale_x: source.scale_x,
        scale_y: source.scale_y,
      },
      guides,
    };
  }
}
```

Run tests — all should pass:

```bash
pnpm --prefix frontend test
```

- [ ] **Step 3: Commit**

```
git add frontend/src/canvas/snap-engine.ts frontend/src/canvas/__tests__/snap-engine.test.ts
git commit -m "feat(frontend): snap engine with binary search and guide line output (Plan 11a-b, Task 3)"
```

---

## Task 4: Select Tool State Machine Expansion

**Files:**
- Modify: `frontend/src/tools/select-tool.ts`
- Modify: `frontend/src/store/document-store-types.ts`

- [ ] **Step 1: Add `getViewportZoom` to ToolStore interface**

The select tool needs the viewport zoom for handle hit-testing and snap threshold calculation. Add to `frontend/src/store/document-store-types.ts`:

```typescript
export interface ToolStore {
  getAllNodes(): ReadonlyMap<string, DocumentNode>;
  select(uuid: string | null): void;
  setTransform(uuid: string, transform: Transform): void;
  createNode(kind: NodeKind, name: string, transform: Transform): string;
  getSelectedNodeId(): string | null;
  /** Current viewport zoom level, needed for handle hit-testing and snapping. */
  getViewportZoom(): number;
}
```

- [ ] **Step 2: Update the store adapter in Canvas.tsx**

In `frontend/src/shell/Canvas.tsx`, add the new method to `createStoreAdapter`:

```typescript
function createStoreAdapter(
  store: ReturnType<typeof useDocument>,
  nodesMap: () => ReadonlyMap<string, DocumentNode>,
): ToolStore {
  return {
    getAllNodes(): ReadonlyMap<string, DocumentNode> {
      return nodesMap();
    },
    getSelectedNodeId(): string | null {
      return store.selectedNodeId();
    },
    select(uuid: string | null): void {
      store.setSelectedNodeId(uuid);
    },
    setTransform(uuid: string, transform: Transform): void {
      store.setTransform(uuid, transform);
    },
    createNode(kind: NodeKind, name: string, transform: Transform): string {
      return store.createNode(kind, name, transform);
    },
    getViewportZoom(): number {
      return store.viewport().zoom;
    },
  };
}
```

- [ ] **Step 3: Rewrite select-tool.ts with resizing state**

Replace `frontend/src/tools/select-tool.ts`:

```typescript
/**
 * Select tool implementation.
 *
 * Handles click-to-select, drag-to-move, and drag-to-resize interactions
 * on the canvas. Uses handle hit testing to determine if a resize handle
 * is under the pointer. Integrates with the snap engine for smart guide
 * alignment during move and resize.
 *
 * State machine:
 *   idle -> pointerdown on handle -> resizing
 *   idle -> pointerdown on node body -> moving
 *   idle -> pointerdown on empty canvas -> deselect
 *   resizing -> pointermove -> update preview via resize-math
 *   resizing -> pointerup -> commit setTransform
 *   resizing -> escape -> cancel, restore original
 *   moving -> pointermove -> update preview with delta
 *   moving -> pointerup -> commit setTransform
 */

import type { ToolStore } from "../store/document-store-types";
import type { Transform } from "../types/document";
import { hitTest } from "../canvas/hit-test";
import { hitTestHandle, getHandleCursor, HandleType } from "../canvas/handle-hit-test";
import { computeResize } from "../canvas/resize-math";
import { SnapEngine, type SnapGuide } from "../canvas/snap-engine";
import type { Tool, ToolEvent } from "./tool-manager";

/** Internal state discriminator. */
type SelectState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "moving";
      readonly draggedUuid: string;
      readonly startWorldX: number;
      readonly startWorldY: number;
      readonly originalTransform: Transform;
    }
  | {
      readonly kind: "resizing";
      readonly draggedUuid: string;
      readonly handle: HandleType;
      readonly startWorldX: number;
      readonly startWorldY: number;
      readonly originalTransform: Transform;
    };

/** Preview transform exposed to the renderer during drag. */
export interface PreviewTransform {
  readonly uuid: string;
  readonly transform: Transform;
}

/**
 * Create a select tool that uses the given document store for
 * hit testing, selection, and sending move/resize commands.
 *
 * @param store - The tool store providing node data and command dispatch.
 * @returns A Tool implementation with preview and guide accessors.
 */
export function createSelectTool(store: ToolStore): Tool & {
  getPreviewTransform(): PreviewTransform | null;
  getSnapGuides(): readonly SnapGuide[];
} {
  let state: SelectState = { kind: "idle" };
  let previewTransform: PreviewTransform | null = null;
  let snapGuides: readonly SnapGuide[] = [];
  let hoverHandle: HandleType | null = null;

  const snapEngine = new SnapEngine();

  /** Prepare the snap engine with all nodes except the dragged one. */
  function prepareSnap(excludeUuid: string): void {
    const nodes = Array.from(store.getAllNodes().values());
    const snapNodes = nodes
      .filter((n) => n.visible && !n.locked)
      .map((n) => ({ uuid: n.uuid, transform: n.transform }));
    snapEngine.prepare(snapNodes, new Set([excludeUuid]), store.getViewportZoom());
  }

  return {
    onPointerDown(event: ToolEvent): void {
      const zoom = store.getViewportZoom();
      const selectedId = store.getSelectedNodeId();

      // If a node is selected, first check if we're clicking a resize handle
      if (selectedId !== null) {
        const selectedNode = store.getAllNodes().get(selectedId);
        if (selectedNode) {
          const handle = hitTestHandle(selectedNode.transform, event.worldX, event.worldY, zoom);
          if (handle !== null) {
            state = {
              kind: "resizing",
              draggedUuid: selectedId,
              handle,
              startWorldX: event.worldX,
              startWorldY: event.worldY,
              originalTransform: selectedNode.transform,
            };
            previewTransform = null;
            snapGuides = [];
            prepareSnap(selectedId);
            return;
          }
        }
      }

      // Fall through to node body hit test
      const hit = hitTest(store.getAllNodes(), event.worldX, event.worldY);

      if (hit) {
        store.select(hit.uuid);
        state = {
          kind: "moving",
          draggedUuid: hit.uuid,
          startWorldX: event.worldX,
          startWorldY: event.worldY,
          originalTransform: hit.transform,
        };
        previewTransform = null;
        snapGuides = [];
        prepareSnap(hit.uuid);
      } else {
        store.select(null);
        state = { kind: "idle" };
        previewTransform = null;
        snapGuides = [];
      }
    },

    onPointerMove(event: ToolEvent): void {
      if (state.kind === "idle") {
        // Update hover cursor for handles
        const selectedId = store.getSelectedNodeId();
        if (selectedId !== null) {
          const selectedNode = store.getAllNodes().get(selectedId);
          if (selectedNode) {
            const zoom = store.getViewportZoom();
            hoverHandle = hitTestHandle(selectedNode.transform, event.worldX, event.worldY, zoom);
          } else {
            hoverHandle = null;
          }
        } else {
          hoverHandle = null;
        }
        return;
      }

      if (state.kind === "moving") {
        const deltaX = event.worldX - state.startWorldX;
        const deltaY = event.worldY - state.startWorldY;

        const movedTransform: Transform = {
          ...state.originalTransform,
          x: state.originalTransform.x + deltaX,
          y: state.originalTransform.y + deltaY,
        };

        // Apply snapping
        const snapResult = snapEngine.snap(movedTransform);

        previewTransform = {
          uuid: state.draggedUuid,
          transform: snapResult.snappedTransform,
        };
        snapGuides = snapResult.guides;
        return;
      }

      if (state.kind === "resizing") {
        const dx = event.worldX - state.startWorldX;
        const dy = event.worldY - state.startWorldY;

        const resizedTransform = computeResize(
          state.originalTransform,
          state.handle,
          { dx, dy },
          { shift: event.shiftKey, alt: event.altKey },
        );

        // Apply snapping to the resized transform
        const snapResult = snapEngine.snap(resizedTransform);

        previewTransform = {
          uuid: state.draggedUuid,
          transform: snapResult.snappedTransform,
        };
        snapGuides = snapResult.guides;
      }
    },

    onPointerUp(): void {
      if (state.kind !== "idle" && previewTransform !== null) {
        store.setTransform(
          (state as { draggedUuid: string }).draggedUuid,
          previewTransform.transform,
        );
      }
      state = { kind: "idle" };
      previewTransform = null;
      snapGuides = [];
    },

    getCursor(): string {
      if (state.kind === "moving") {
        return "grabbing";
      }
      if (state.kind === "resizing") {
        return getHandleCursor((state as { handle: HandleType }).handle);
      }
      if (hoverHandle !== null) {
        return getHandleCursor(hoverHandle);
      }
      return "default";
    },

    getPreviewTransform(): PreviewTransform | null {
      return previewTransform;
    },

    getSnapGuides(): readonly SnapGuide[] {
      return snapGuides;
    },
  };
}
```

- [ ] **Step 4: Add Escape key handling for resize cancel in Canvas.tsx**

In `frontend/src/shell/Canvas.tsx`, inside the `tinykeys` block, add an Escape handler. The select tool needs a `cancel` method. Add to the tool interface in `tool-manager.ts`:

In `frontend/src/tools/tool-manager.ts`, add `onKeyDown` to the `Tool` interface as an optional method:

```typescript
export interface Tool {
  onPointerDown(event: ToolEvent): void;
  onPointerMove(event: ToolEvent): void;
  onPointerUp(event: ToolEvent): void;
  getCursor(): string;
  /** Optional: handle keyboard events (e.g., Escape to cancel). */
  onKeyDown?(key: string): void;
}
```

Add to `ToolManager`:

```typescript
onKeyDown(key: string): void {
  const impl = getImpl();
  if (impl.onKeyDown) {
    impl.onKeyDown(key);
  }
}
```

Add `onKeyDown` to the select tool (inside the return object in `select-tool.ts`):

```typescript
onKeyDown(key: string): void {
  if (key === "Escape" && state.kind !== "idle") {
    state = { kind: "idle" };
    previewTransform = null;
    snapGuides = [];
  }
},
```

In `Canvas.tsx`, add Escape to the tinykeys bindings:

```typescript
"Escape": (e: KeyboardEvent) => {
  if (!isTyping()) {
    e.preventDefault();
    toolManager.onKeyDown("Escape");
    setPreviewTransform(null);
    setSnapGuides([]);
    setCursor(toolManager.getCursor());
  }
},
```

- [ ] **Step 5: Commit**

```
git add frontend/src/tools/select-tool.ts frontend/src/tools/tool-manager.ts frontend/src/store/document-store-types.ts frontend/src/shell/Canvas.tsx
git commit -m "feat(frontend): expand select tool with resize state and snap integration (Plan 11a-b, Task 4)"
```

---

## Task 5: Guide Line Rendering

**Files:**
- Modify: `frontend/src/canvas/renderer.ts`

- [ ] **Step 1: Add the drawGuideLines function**

Add to `frontend/src/canvas/renderer.ts`, after the `drawPreviewRect` function:

```typescript
/** Smart guide line color (pink/red). */
const GUIDE_COLOR = "#ff3366";

/** Smart guide line width in screen pixels. */
const GUIDE_LINE_WIDTH = 1;

/**
 * Draw smart guide lines when snapping is active.
 *
 * Each guide is drawn as a full-extent line across the canvas:
 * - X guides are vertical lines (full canvas height).
 * - Y guides are horizontal lines (full canvas width).
 *
 * Lines are drawn in world coordinates but with a 1px screen-space width.
 */
function drawGuideLines(
  ctx: CanvasRenderingContext2D,
  guides: readonly SnapGuide[],
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (guides.length === 0) return;

  const lineWidth = GUIDE_LINE_WIDTH / viewport.zoom;
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.lineWidth = lineWidth;

  // Compute the world-space extent visible on screen.
  // screenX = worldX * zoom + offsetX => worldX = (screenX - offsetX) / zoom
  const worldLeft = -viewport.x / viewport.zoom;
  const worldTop = -viewport.y / viewport.zoom;
  const worldRight = (canvasWidth - viewport.x) / viewport.zoom;
  const worldBottom = (canvasHeight - viewport.y) / viewport.zoom;

  for (const guide of guides) {
    ctx.beginPath();
    if (guide.axis === "x") {
      // Vertical line at world x = guide.position
      ctx.moveTo(guide.position, worldTop);
      ctx.lineTo(guide.position, worldBottom);
    } else {
      // Horizontal line at world y = guide.position
      ctx.moveTo(worldLeft, guide.position);
      ctx.lineTo(worldRight, guide.position);
    }
    ctx.stroke();
  }
}
```

- [ ] **Step 2: Add SnapGuide import and extend the render function signature**

At the top of `renderer.ts`, add the import:

```typescript
import type { SnapGuide } from "./snap-engine";
```

Update the `render` function signature to accept guide lines and canvas dimensions:

```typescript
export function render(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  nodes: readonly DocumentNode[],
  selectedUuid: string | null,
  dpr = 1,
  previewRect: PreviewRect | null = null,
  previewTransform: PreviewTransform | null = null,
  snapGuides: readonly SnapGuide[] = [],
): void {
```

At the end of the function, before the `ctx.setTransform(1, 0, 0, 1, 0, 0)` reset, add the guide rendering call. We need the DPR-scaled canvas dimensions:

```typescript
  // Draw smart guide lines (after nodes and selection, before transform reset).
  if (snapGuides.length > 0) {
    drawGuideLines(ctx, snapGuides, viewport, ctx.canvas.width / dpr, ctx.canvas.height / dpr);
  }

  // Reset transform to identity.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
```

- [ ] **Step 3: Commit**

```
git add frontend/src/canvas/renderer.ts
git commit -m "feat(frontend): guide line rendering for smart snap alignment (Plan 11a-b, Task 5)"
```

---

## Task 6: Canvas Integration — Threading Snap Guides

**Files:**
- Modify: `frontend/src/shell/Canvas.tsx`

- [ ] **Step 1: Add snap guides signal**

In `Canvas.tsx`, add a signal for snap guides alongside the existing preview signals:

```typescript
import type { SnapGuide } from "../canvas/snap-engine";

// Inside the component, after previewRect signal:
const [snapGuides, setSnapGuides] = createSignal<readonly SnapGuide[]>([]);
```

- [ ] **Step 2: Update pointer handlers to read snap guides from select tool**

In `handlePointerMove`, after the existing preview updates, add:

```typescript
// Update snap guides from select tool
if (store.activeTool() === "select") {
  setSnapGuides(selectTool.getSnapGuides());
} else {
  setSnapGuides([]);
}
```

In `handlePointerUp`, clear snap guides:

```typescript
setSnapGuides([]);
```

- [ ] **Step 3: Pass snap guides to the render effect**

In the `createEffect` that calls `renderCanvas`, read the snap guides signal and pass it:

```typescript
createEffect(() => {
  const nodesObj = store.state.nodes;
  const selected = store.selectedNodeId();
  const vp = store.viewport();
  const preview = previewTransform();
  const prevRect = previewRect();
  const guides = snapGuides(); // NEW: read snap guides signal
  const size = canvasSize();
  const dpr = size.dpr;

  const keys = Object.keys(nodesObj);
  const nodesArray = keys.map((k) => nodesObj[k]).filter((n) => n != null) as DocumentNode[];

  renderCanvas(ctx, vp, nodesArray, selected, dpr, prevRect, preview, guides);
});
```

- [ ] **Step 4: Verify build and manual test**

```bash
pnpm --prefix frontend build
```

Manual verification checklist:
1. Select a node -- 8 handles appear (existing behavior).
2. Hover over a handle -- cursor changes to the appropriate resize cursor.
3. Drag a corner handle -- node resizes from the opposite corner.
4. Hold Shift while dragging a corner handle -- aspect ratio is locked.
5. Hold Alt while dragging a corner handle -- resize from center.
6. Drag a node near another node's edge -- pink guide line appears and node snaps.
7. Press Escape during resize -- operation cancels, node reverts.

- [ ] **Step 5: Commit**

```
git add frontend/src/shell/Canvas.tsx
git commit -m "feat(frontend): thread snap guides through Canvas to renderer (Plan 11a-b, Task 6)"
```

---

## Keyboard Accessibility Note

Per CLAUDE.md "Pointer-Only Operations Must Have Keyboard Equivalents": resize via handle drag is a pointer-only operation. The keyboard equivalent is the existing numeric transform inputs in the properties panel (width, height, x, y fields), which allow precise resizing without a mouse. This is the standard pattern in Figma and Penpot -- resize handles are a pointer affordance, while the properties panel provides keyboard access. No additional keyboard shortcuts are needed for this plan.

---

## Summary of Files

### New files
| File | Purpose |
|------|---------|
| `frontend/vitest.config.ts` | Vitest test runner configuration |
| `frontend/src/canvas/handle-hit-test.ts` | Identify which resize handle is under the pointer |
| `frontend/src/canvas/resize-math.ts` | Pure function: compute resized transform |
| `frontend/src/canvas/snap-engine.ts` | Smart guide snap computation with binary search |
| `frontend/src/canvas/__tests__/handle-hit-test.test.ts` | Tests for handle hit-testing |
| `frontend/src/canvas/__tests__/resize-math.test.ts` | Tests for resize math |
| `frontend/src/canvas/__tests__/snap-engine.test.ts` | Tests for snap engine |

### Modified files
| File | Changes |
|------|---------|
| `frontend/src/tools/select-tool.ts` | New `resizing` state, snap integration, hover cursor |
| `frontend/src/tools/tool-manager.ts` | Add optional `onKeyDown` to Tool interface, delegate in ToolManager |
| `frontend/src/store/document-store-types.ts` | Add `getViewportZoom()` to ToolStore |
| `frontend/src/canvas/renderer.ts` | Add `drawGuideLines`, extend `render` signature with snap guides |
| `frontend/src/shell/Canvas.tsx` | Snap guide signal, store adapter update, Escape key, render threading |

---

### Critical Files for Implementation
- `/Volumes/projects/Personal/agent-designer/.worktrees/feature/viewport-resize/frontend/src/tools/select-tool.ts` - Central state machine that orchestrates all resize and snap behavior
- `/Volumes/projects/Personal/agent-designer/.worktrees/feature/viewport-resize/frontend/src/canvas/resize-math.ts` - Core pure-function module for computing resize transforms (new file)
- `/Volumes/projects/Personal/agent-designer/.worktrees/feature/viewport-resize/frontend/src/canvas/snap-engine.ts` - Snap target collection and binary search matching (new file)
- `/Volumes/projects/Personal/agent-designer/.worktrees/feature/viewport-resize/frontend/src/canvas/renderer.ts` - Must be extended with guide line rendering and new render signature
- `/Volumes/projects/Personal/agent-designer/.worktrees/feature/viewport-resize/frontend/src/shell/Canvas.tsx` - Integration point threading all signals between tools and renderer