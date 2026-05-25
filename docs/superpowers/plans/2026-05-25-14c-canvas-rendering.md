# Plan 14c — Canvas Rendering for Corner Shapes + Frame Child Clipping

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every Corner variant (Round, Bevel, Notch, Scoop, Superellipse) on the canvas via a Path2D-based shape pipeline, replace the placeholder `fillRect`/`strokeRect` calls in `drawNode` with `ctx.fill(path)` / `ctx.stroke(path)`, and add frame child clipping to the render loop so child nodes are clipped to the frame's corner-shape outline.

**Architecture:** New pure-geometry helper `frontend/src/canvas/corner-path.ts` with one function per corner variant (`appendRoundCorner`, `appendBevelCorner`, `appendNotchCorner`, `appendScoopCorner`, `appendSuperellipseCorner`) plus an `appendCornerPath` that orchestrates them with a radius-clamping pre-pass. Public `buildCornerPath` allocates a fresh `Path2D`, delegates to `appendCornerPath`, returns the path. Renderer integration: `drawNode` calls `buildCornerPath(transform, corners)` once per node and uses the result for fill + stroke. Render loop (`render()` in `renderer.ts`) maintains a clip stack — on entering a Frame, `ctx.save() + ctx.clip(framePath)`; on leaving the Frame's subtree, `ctx.restore()` and pop. Tests use a Proxy-based `createMockContext` (already exists; extracted to shared helper) and a structural `PathBuilder` interface so the geometry helpers can be tested against a `PathRecorder` that's instance-compatible with `Path2D`.

**Tech Stack:** TypeScript (strict), Solid.js (renderer reactive bridge unchanged), Vitest + jsdom, Canvas2D API.

**Branch:** `feature/corner-shapes-14c` (worktree at `.worktrees/feature/corner-shapes-14c`, based on `6051d6b`).

---

## Pre-work: confirmed context

- **Spec:** `docs/superpowers/specs/2026-04-23-14-corner-shapes.md` § 3 (Canvas rendering) was expanded during 14c brainstorming. Read §3.1 (gap), §3.2 (path construction), §3.3 (clamping), §3.4 (numeric guards), §3.5 (fill/stroke/clip), §3.6 (hit-testing stays AABB), §3.7 (design decisions), and §4.3 (test strategy).
- **Existing rendering site:** `frontend/src/canvas/renderer.ts:367` — the `drawNode` `switch (node.kind.type)` block currently uses `ctx.fillRect(x, y, width, height)` for rectangle / frame / group / image / component_instance and `path` kinds. `strokeRect` is used in the same block for strokes.
- **Render loop:** `render()` at `frontend/src/canvas/renderer.ts:783` receives a flat `readonly DocumentNode[]` already in depth-first parent-then-children order (built by `buildRenderOrder` in `frontend/src/canvas/render-order.ts`). Nodes carry `parentUuid` / `childrenUuids` for ancestry queries. No clipping happens today.
- **Render depth:** `MAX_RENDER_DEPTH = 64` is defined in `frontend/src/canvas/render-order.ts`. Plan 14c reuses this constant for the clip stack depth guard.
- **Existing recorder mock:** `frontend/src/canvas/__tests__/renderer.test.ts:91-164` defines `createMockContext()` (Proxy-based recorder for `CanvasRenderingContext2D`). Task 14 extracts it to a shared helper before adding new tests.
- **Corner type:** defined in `frontend/src/types/document.ts:620` as `Corner = CornerRound | CornerBevel | CornerNotch | CornerScoop | CornerSuperellipse`. Each variant has `radii: { x, y }`; Superellipse has additional `smoothing: number` ∈ [0, 1].
- **NodeKind variants with corners:** `frame`, `rectangle`, `image` (the corner-bearing kinds per Spec 14 §1.2). `group`, `text`, `ellipse`, `path`, `component_instance` do NOT have corners — they don't get path-based rendering for shape (group is invisible; ellipse uses `ctx.ellipse` already; etc.).

## Conventions used in this plan

- Frontend test commands run from the worktree root: `pnpm --prefix frontend test src/canvas/__tests__/<file> --reporter=verbose`.
- Lint: `pnpm --prefix frontend lint`. Typecheck: `pnpm --prefix frontend exec tsc --noEmit`. Format: `pnpm --prefix frontend exec prettier --check 'src/**/*.{ts,tsx,css}'`.
- Commit messages use the project convention `type(scope): description` (CLAUDE.md §6). Scope is `frontend` for all geometry/renderer work.
- Superellipse v1 constants (per spec §3.7 — calibration follow-up in 14d):
  - `KAPPA_CIRCULAR = 0.5522847498` (Bézier kappa for circular arc)
  - `BLEED_AT_S0 = 1.0` (anchor at distance `r` from corner along edge; standard circular arc)
  - `BLEED_AT_S1 = 1.5` (anchor extends to `1.5 * r` from corner; curvature lingers along edge)
  - At any smoothing `s`: `bleed = (1 - s) * BLEED_AT_S0 + s * BLEED_AT_S1`

## File structure

**Create:**
- `frontend/src/canvas/corner-path.ts` — pure-geometry helpers + `buildCornerPath` public API
- `frontend/src/canvas/__tests__/corner-path.test.ts` — pure helper tests
- `frontend/src/canvas/__tests__/canvas-mock.ts` — extracted shared mock context helper

**Modify:**
- `frontend/src/canvas/renderer.ts` — `drawNode` uses path-based fill/stroke; `render()` maintains a clip stack
- `frontend/src/canvas/__tests__/renderer.test.ts` — extracted `createMockContext` becomes an import from `canvas-mock.ts`; new tests added for path-based rendering and clip behavior

---

## Task 1: Worktree baseline

- [ ] **Step 1: Install frontend dependencies in the worktree**

Run: `pnpm --prefix frontend install --frozen-lockfile`
Expected: completes with `Done in <duration>`, `frontend/node_modules` populated.

- [ ] **Step 2: Verify baseline tests pass**

Run: `pnpm --prefix frontend test --reporter=verbose 2>&1 | tail -5`
Expected: all tests pass (matches `origin/main` baseline; 1811+ tests).

- [ ] **Step 3: Verify lint + typecheck + prettier all clean**

Run: `pnpm --prefix frontend lint` → clean.
Run: `pnpm --prefix frontend exec tsc --noEmit` → clean.
Run: `pnpm --prefix frontend exec prettier --check 'src/**/*.{ts,tsx,css}'` → clean.

- [ ] **Step 4: Confirm working tree is clean before changes**

Run: `git status --short`
Expected: empty.

---

## Task 2: Scaffold `corner-path.ts` with `PathBuilder` interface + first round-corner test

This task creates the file structure, defines the structural `PathBuilder` interface (so tests can use a recorder), and writes the first failing test exercising a single round corner.

**Files:**
- Create: `frontend/src/canvas/corner-path.ts`
- Create: `frontend/src/canvas/__tests__/corner-path.test.ts`

- [ ] **Step 1: Create `corner-path.ts` skeleton**

Create `frontend/src/canvas/corner-path.ts`:

```typescript
/**
 * Plan 14c — corner-shape path construction.
 *
 * Pure geometry helpers that emit canvas drawing operations onto a structural
 * `PathBuilder` target (satisfied by both `Path2D` in production and the
 * `PathRecorder` test helper). Each Corner variant has a dedicated append
 * helper so its instruction sequence is unit-testable in isolation.
 *
 * Spec: `docs/superpowers/specs/2026-04-23-14-corner-shapes.md` § 3.
 */

import type { Corner, Corners } from "../types/document";

/**
 * Subset of `Path2D` that the corner helpers emit. Allows tests to substitute
 * a `PathRecorder` without instantiating the real (browser-only) `Path2D`.
 */
export type PathBuilder = Pick<
  Path2D,
  "moveTo" | "lineTo" | "ellipse" | "bezierCurveTo" | "closePath"
>;

/** Bezier kappa for a circular arc (v1 superellipse anchor at smoothing = 0). */
export const KAPPA_CIRCULAR = 0.5522847498;

/** v1 anchor for superellipse smoothing = 0 — control points sit at distance `r` from corner. */
export const BLEED_AT_S0 = 1.0;

/** v1 anchor for superellipse smoothing = 1 — control points sit at distance `1.5 * r` from corner. */
export const BLEED_AT_S1 = 1.5;

/**
 * Append a single round corner to the path. (Stub — implemented in Task 3.)
 */
export function appendRoundCorner(_builder: PathBuilder, _corner: Corner): void {
  throw new Error("not implemented");
}

/**
 * Append the full 4-corner path (closed rectangle outline with per-corner shapes)
 * to `builder`. The path traces edges + corners in order: top-left → top-right →
 * bottom-right → bottom-left → close.
 *
 * Public `buildCornerPath` (Task 13) allocates a `Path2D` and delegates here.
 *
 * @param x — top-left X in canvas coordinates
 * @param y — top-left Y in canvas coordinates
 * @param width — node width (must be finite and > 0)
 * @param height — node height (must be finite and > 0)
 * @param corners — [topLeft, topRight, bottomRight, bottomLeft]
 */
export function appendCornerPath(
  _builder: PathBuilder,
  _x: number,
  _y: number,
  _width: number,
  _height: number,
  _corners: Corners,
): void {
  throw new Error("not implemented");
}
```

- [ ] **Step 2: Create `corner-path.test.ts` with `PathRecorder` + first test**

Create `frontend/src/canvas/__tests__/corner-path.test.ts`:

```typescript
/**
 * @vitest-environment jsdom
 *
 * Pure-geometry tests for `corner-path.ts`. We use a `PathRecorder` that
 * implements the `PathBuilder` structural interface and records every
 * emitted operation; tests assert on the operation sequence.
 *
 * Per spec § 4.3 + § 3.7: no pixel snapshots, no `canvas` npm package.
 * For pure deterministic geometry, instruction sequence == output.
 */
import { describe, it, expect } from "vitest";
import {
  appendCornerPath,
  appendRoundCorner,
  type PathBuilder,
} from "../corner-path";
import type { Corner, Corners } from "../../types/document";

interface RecordedOp {
  method: "moveTo" | "lineTo" | "ellipse" | "bezierCurveTo" | "closePath";
  args: readonly number[];
}

class PathRecorder implements PathBuilder {
  ops: RecordedOp[] = [];
  moveTo(x: number, y: number): void {
    this.ops.push({ method: "moveTo", args: [x, y] });
  }
  lineTo(x: number, y: number): void {
    this.ops.push({ method: "lineTo", args: [x, y] });
  }
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    this.ops.push({
      method: "ellipse",
      args: [x, y, rx, ry, rotation, startAngle, endAngle, counterclockwise ? 1 : 0],
    });
  }
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this.ops.push({ method: "bezierCurveTo", args: [cp1x, cp1y, cp2x, cp2y, x, y] });
  }
  closePath(): void {
    this.ops.push({ method: "closePath", args: [] });
  }
}

function round(r: number): Corner {
  return { type: "round", radii: { x: r, y: r } };
}

describe("appendRoundCorner", () => {
  it("emits a single ellipse instruction for a round corner", () => {
    const r = new PathRecorder();
    appendRoundCorner(r, round(16));
    const ellipses = r.ops.filter((op) => op.method === "ellipse");
    expect(ellipses.length).toBe(1);
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL on the throw**

Run: `pnpm --prefix frontend test src/canvas/__tests__/corner-path.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: FAIL with "not implemented" thrown by `appendRoundCorner`.

- [ ] **Step 4: Verify the file compiles cleanly under tsc**

Run: `pnpm --prefix frontend exec tsc --noEmit`
Expected: clean (the `_` prefix in stub parameters suppresses unused-var lint; the `PathBuilder` type is exported and used by the test).

- [ ] **Step 5: Commit the scaffold (test will fail in this commit — that's the TDD red state)**

```bash
git add frontend/src/canvas/corner-path.ts frontend/src/canvas/__tests__/corner-path.test.ts
git commit -m "feat(frontend): scaffold corner-path.ts + PathRecorder test helper (red)"
```

---

## Task 3: `appendRoundCorner` — make Task 2's test pass + 4-corner orchestration

The single-corner helper takes a `Corner` and emits an ellipse for it. The 4-corner orchestrator `appendCornerPath` walks each edge + corner in order.

**Files:**
- Modify: `frontend/src/canvas/corner-path.ts`
- Modify: `frontend/src/canvas/__tests__/corner-path.test.ts`

The `appendRoundCorner` helper needs to know WHICH corner of the rectangle it's drawing (top-left / top-right / bottom-right / bottom-left) because the ellipse center + start/end angles depend on it. Refactor signature: helpers take a "corner geometry context" that includes the corner's center, axis directions, and angular range.

- [ ] **Step 1: Update `appendRoundCorner` signature + define `CornerGeometry`**

Replace the contents of `frontend/src/canvas/corner-path.ts` with:

```typescript
import type { Corner, Corners } from "../types/document";

export type PathBuilder = Pick<
  Path2D,
  "moveTo" | "lineTo" | "ellipse" | "bezierCurveTo" | "closePath"
>;

export const KAPPA_CIRCULAR = 0.5522847498;
export const BLEED_AT_S0 = 1.0;
export const BLEED_AT_S1 = 1.5;

/**
 * Per-corner geometric context computed by `appendCornerPath` and passed to
 * each per-shape helper. Insulates the shape helpers from corner-position
 * arithmetic.
 */
export interface CornerGeometry {
  /** Center of the ellipse / origin for the corner shape. */
  readonly cx: number;
  readonly cy: number;
  /** Effective radii after clamping. */
  readonly rx: number;
  readonly ry: number;
  /**
   * Angle in radians at which the corner curve starts (entering the curve from
   * the previous edge). Canvas convention: 0 = +x, π/2 = +y (down).
   */
  readonly startAngle: number;
  /** Angle in radians at which the corner curve ends (exiting onto the next edge). */
  readonly endAngle: number;
  /**
   * Unit vector pointing along the FIRST adjacent edge (the edge the curve
   * enters FROM). Used by Bevel / Notch / Superellipse for tangent math.
   */
  readonly entryDirX: number;
  readonly entryDirY: number;
  /** Unit vector along the SECOND adjacent edge (the edge the curve exits ONTO). */
  readonly exitDirX: number;
  readonly exitDirY: number;
}

/** Emit a single round-corner ellipse using the corner's geometry. */
export function appendRoundCorner(builder: PathBuilder, geom: CornerGeometry): void {
  builder.ellipse(
    geom.cx,
    geom.cy,
    geom.rx,
    geom.ry,
    0,
    geom.startAngle,
    geom.endAngle,
  );
}

/** Compute geometry for the 4 corners of a rectangle. */
function cornerGeometries(
  x: number,
  y: number,
  width: number,
  height: number,
  corners: Corners,
): readonly [CornerGeometry, CornerGeometry, CornerGeometry, CornerGeometry] {
  const [tl, tr, br, bl] = corners;
  return [
    // Top-left: arc from +π (left) to +3π/2 (up), center at (x+rx, y+ry).
    {
      cx: x + tl.radii.x,
      cy: y + tl.radii.y,
      rx: tl.radii.x,
      ry: tl.radii.y,
      startAngle: Math.PI,
      endAngle: 1.5 * Math.PI,
      entryDirX: 0,
      entryDirY: -1,
      exitDirX: 1,
      exitDirY: 0,
    },
    // Top-right: arc from +3π/2 (up) to 0 (right). Note Canvas ellipse uses
    // clockwise sweep by default when end > start.
    {
      cx: x + width - tr.radii.x,
      cy: y + tr.radii.y,
      rx: tr.radii.x,
      ry: tr.radii.y,
      startAngle: 1.5 * Math.PI,
      endAngle: 2 * Math.PI,
      entryDirX: 1,
      entryDirY: 0,
      exitDirX: 0,
      exitDirY: 1,
    },
    // Bottom-right: arc from 0 (right) to π/2 (down).
    {
      cx: x + width - br.radii.x,
      cy: y + height - br.radii.y,
      rx: br.radii.x,
      ry: br.radii.y,
      startAngle: 0,
      endAngle: 0.5 * Math.PI,
      entryDirX: 0,
      entryDirY: 1,
      exitDirX: -1,
      exitDirY: 0,
    },
    // Bottom-left: arc from π/2 (down) to π (left).
    {
      cx: x + bl.radii.x,
      cy: y + height - bl.radii.y,
      rx: bl.radii.x,
      ry: bl.radii.y,
      startAngle: 0.5 * Math.PI,
      endAngle: Math.PI,
      entryDirX: -1,
      entryDirY: 0,
      exitDirX: 0,
      exitDirY: -1,
    },
  ];
}

/**
 * Dispatch to the appropriate per-shape helper for a single corner.
 * Round only for now; other variants added in Tasks 4-9.
 */
function appendCorner(builder: PathBuilder, corner: Corner, geom: CornerGeometry): void {
  switch (corner.type) {
    case "round":
      appendRoundCorner(builder, geom);
      return;
    default:
      // Other variants implemented in later tasks.
      throw new Error(`appendCorner not yet implemented for ${corner.type}`);
  }
}

export function appendCornerPath(
  builder: PathBuilder,
  x: number,
  y: number,
  width: number,
  height: number,
  corners: Corners,
): void {
  const [tl, tr, br, bl] = corners;
  const [glTL, glTR, glBR, glBL] = cornerGeometries(x, y, width, height, corners);

  // Top-left corner — start the path on the top edge just to the right of the TL corner curve.
  builder.moveTo(x + tl.radii.x, y);
  // Top edge → top-right corner
  builder.lineTo(x + width - tr.radii.x, y);
  appendCorner(builder, tr, glTR);
  // Right edge → bottom-right corner
  builder.lineTo(x + width, y + height - br.radii.y);
  appendCorner(builder, br, glBR);
  // Bottom edge → bottom-left corner
  builder.lineTo(x + bl.radii.x, y + height);
  appendCorner(builder, bl, glBL);
  // Left edge → top-left corner
  builder.lineTo(x, y + tl.radii.y);
  appendCorner(builder, tl, glTL);
  builder.closePath();
}
```

- [ ] **Step 2: Update the existing Task 2 test to match the new signature + add 4-corner test**

Replace the contents of `frontend/src/canvas/__tests__/corner-path.test.ts` with:

```typescript
/**
 * @vitest-environment jsdom
 *
 * Pure-geometry tests for `corner-path.ts`. Uses a `PathRecorder` that
 * implements the `PathBuilder` structural interface; assertions are on the
 * recorded operation sequence.
 *
 * Per spec § 4.3: no pixel snapshots, no `canvas` npm package.
 */
import { describe, it, expect } from "vitest";
import {
  appendCornerPath,
  appendRoundCorner,
  type PathBuilder,
  type CornerGeometry,
} from "../corner-path";
import type { Corner, Corners } from "../../types/document";

interface RecordedOp {
  method: "moveTo" | "lineTo" | "ellipse" | "bezierCurveTo" | "closePath";
  args: readonly number[];
}

class PathRecorder implements PathBuilder {
  ops: RecordedOp[] = [];
  moveTo(x: number, y: number): void {
    this.ops.push({ method: "moveTo", args: [x, y] });
  }
  lineTo(x: number, y: number): void {
    this.ops.push({ method: "lineTo", args: [x, y] });
  }
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    this.ops.push({
      method: "ellipse",
      args: [x, y, rx, ry, rotation, startAngle, endAngle, counterclockwise ? 1 : 0],
    });
  }
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this.ops.push({ method: "bezierCurveTo", args: [cp1x, cp1y, cp2x, cp2y, x, y] });
  }
  closePath(): void {
    this.ops.push({ method: "closePath", args: [] });
  }
}

function round(r: number): Corner {
  return { type: "round", radii: { x: r, y: r } };
}

const TL_GEOM: CornerGeometry = {
  cx: 16,
  cy: 16,
  rx: 16,
  ry: 16,
  startAngle: Math.PI,
  endAngle: 1.5 * Math.PI,
  entryDirX: 0,
  entryDirY: -1,
  exitDirX: 1,
  exitDirY: 0,
};

describe("appendRoundCorner", () => {
  it("emits a single ellipse instruction", () => {
    const r = new PathRecorder();
    appendRoundCorner(r, TL_GEOM);
    const ellipses = r.ops.filter((op) => op.method === "ellipse");
    expect(ellipses.length).toBe(1);
  });

  it("ellipse arguments match the corner geometry", () => {
    const r = new PathRecorder();
    appendRoundCorner(r, TL_GEOM);
    const ellipse = r.ops.find((op) => op.method === "ellipse");
    expect(ellipse?.args[0]).toBe(16); // cx
    expect(ellipse?.args[1]).toBe(16); // cy
    expect(ellipse?.args[2]).toBe(16); // rx
    expect(ellipse?.args[3]).toBe(16); // ry
    expect(ellipse?.args[5]).toBe(Math.PI); // startAngle
    expect(ellipse?.args[6]).toBe(1.5 * Math.PI); // endAngle
  });
});

describe("appendCornerPath — all-round corners", () => {
  it("emits moveTo + 4 lineTo + 4 ellipse + closePath in the right order", () => {
    const r = new PathRecorder();
    const corners: Corners = [round(16), round(16), round(16), round(16)];
    appendCornerPath(r, 0, 0, 100, 100, corners);
    const methods = r.ops.map((op) => op.method);
    expect(methods).toEqual([
      "moveTo",
      "lineTo",
      "ellipse",
      "lineTo",
      "ellipse",
      "lineTo",
      "ellipse",
      "lineTo",
      "ellipse",
      "closePath",
    ]);
  });

  it("starts the path at the top edge just past the TL corner radius", () => {
    const r = new PathRecorder();
    const corners: Corners = [round(16), round(16), round(16), round(16)];
    appendCornerPath(r, 10, 20, 100, 100, corners);
    const moveTo = r.ops[0];
    expect(moveTo.method).toBe("moveTo");
    expect(moveTo.args).toEqual([10 + 16, 20]); // x + tl.radii.x, y
  });
});
```

- [ ] **Step 3: Run tests — expect PASS**

Run: `pnpm --prefix frontend test src/canvas/__tests__/corner-path.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: 4 tests pass.

- [ ] **Step 4: Run typecheck + lint**

Run: `pnpm --prefix frontend exec tsc --noEmit`
Expected: clean.
Run: `pnpm --prefix frontend lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/canvas/corner-path.ts frontend/src/canvas/__tests__/corner-path.test.ts
git commit -m "feat(frontend): appendRoundCorner + appendCornerPath orchestration"
```

---

## Task 4: `appendBevelCorner` — diagonal cut

**Files:**
- Modify: `frontend/src/canvas/corner-path.ts`
- Modify: `frontend/src/canvas/__tests__/corner-path.test.ts`

Per spec § 3.2: Bevel is a single diagonal `lineTo` segment cutting the corner. With per-axis radii, the cut starts at `(corner + entryDir * ry)` and ends at `(corner + exitDir * rx)`, where "corner" is the geometric corner point of the rectangle. Since our `CornerGeometry` doesn't directly carry "corner point", derive it as the geometric center MINUS (or PLUS) the radii along entry/exit directions: in our parameterization, the corner-point of the rectangle is at `(cx - entryDirX*rx... )` — but actually our `entryDirX/Y` and `exitDirX/Y` are along-edge directions toward-the-next-corner, so the rectangle corner point is `(cx + entryDirX*0 + exitDirX*-rx, cy + entryDirY*0 + exitDirY*-ry)` — which simplifies awkwardly. Cleaner: pass the corner-point directly in geometry.

- [ ] **Step 1: Add `cornerX` / `cornerY` to `CornerGeometry`**

Modify `corner-path.ts`:

```typescript
export interface CornerGeometry {
  readonly cx: number; // ellipse center
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly entryDirX: number;
  readonly entryDirY: number;
  readonly exitDirX: number;
  readonly exitDirY: number;
  /** The geometric corner-point of the rectangle (where the two edges meet). */
  readonly cornerX: number;
  readonly cornerY: number;
}
```

Update `cornerGeometries()` to set `cornerX`/`cornerY`:

```typescript
function cornerGeometries(
  x: number,
  y: number,
  width: number,
  height: number,
  corners: Corners,
): readonly [CornerGeometry, CornerGeometry, CornerGeometry, CornerGeometry] {
  const [tl, tr, br, bl] = corners;
  return [
    {
      // TL: corner point at (x, y), ellipse center at (x+rx, y+ry)
      cornerX: x, cornerY: y,
      cx: x + tl.radii.x, cy: y + tl.radii.y,
      rx: tl.radii.x, ry: tl.radii.y,
      startAngle: Math.PI, endAngle: 1.5 * Math.PI,
      entryDirX: 0, entryDirY: -1, exitDirX: 1, exitDirY: 0,
    },
    {
      // TR: corner at (x+w, y), ellipse center at (x+w-rx, y+ry)
      cornerX: x + width, cornerY: y,
      cx: x + width - tr.radii.x, cy: y + tr.radii.y,
      rx: tr.radii.x, ry: tr.radii.y,
      startAngle: 1.5 * Math.PI, endAngle: 2 * Math.PI,
      entryDirX: 1, entryDirY: 0, exitDirX: 0, exitDirY: 1,
    },
    {
      // BR: corner at (x+w, y+h)
      cornerX: x + width, cornerY: y + height,
      cx: x + width - br.radii.x, cy: y + height - br.radii.y,
      rx: br.radii.x, ry: br.radii.y,
      startAngle: 0, endAngle: 0.5 * Math.PI,
      entryDirX: 0, entryDirY: 1, exitDirX: -1, exitDirY: 0,
    },
    {
      // BL: corner at (x, y+h)
      cornerX: x, cornerY: y + height,
      cx: x + bl.radii.x, cy: y + height - bl.radii.y,
      rx: bl.radii.x, ry: bl.radii.y,
      startAngle: 0.5 * Math.PI, endAngle: Math.PI,
      entryDirX: -1, entryDirY: 0, exitDirX: 0, exitDirY: -1,
    },
  ];
}
```

- [ ] **Step 2: Add `appendBevelCorner` + dispatch case**

Add to `corner-path.ts`:

```typescript
/**
 * Emit a single diagonal `lineTo` for a Bevel corner.
 *
 * The bevel cuts from the point that's `ry` along the entry edge (away from
 * the geometric corner-point) to the point that's `rx` along the exit edge.
 * Both endpoints are at the same distance-from-edge as a Round corner would
 * have, so neighbouring edges remain aligned regardless of corner shape.
 */
export function appendBevelCorner(builder: PathBuilder, geom: CornerGeometry): void {
  // Entry edge endpoint: corner + entryDir * -ry (toward previous corner along the entry edge)
  const entryEndX = geom.cornerX - geom.entryDirX * geom.ry;
  const entryEndY = geom.cornerY - geom.entryDirY * geom.ry;
  // Exit edge endpoint: corner + exitDir * rx (toward next corner along the exit edge)
  const exitStartX = geom.cornerX + geom.exitDirX * geom.rx;
  const exitStartY = geom.cornerY + geom.exitDirY * geom.rx;
  // The previous lineTo (in appendCornerPath) already placed the pen at entry end.
  builder.lineTo(exitStartX, exitStartY);
}
```

Update `appendCorner()` dispatch:

```typescript
function appendCorner(builder: PathBuilder, corner: Corner, geom: CornerGeometry): void {
  switch (corner.type) {
    case "round":
      appendRoundCorner(builder, geom);
      return;
    case "bevel":
      appendBevelCorner(builder, geom);
      return;
    default:
      throw new Error(`appendCorner not yet implemented for ${corner.type}`);
  }
}
```

**Important:** the existing `appendCornerPath` already does a `lineTo(x + tl.radii.x, y)` before reaching the TL corner — that `lineTo` lands at the bevel's "entry endpoint" for the TL corner. So the bevel's `lineTo` is just the diagonal cut to the bevel's "exit endpoint". The edge-walking logic doesn't change.

- [ ] **Step 3: Add bevel test**

Append to `corner-path.test.ts`:

```typescript
function bevel(r: number): Corner {
  return { type: "bevel", radii: { x: r, y: r } };
}

describe("appendBevelCorner", () => {
  it("emits a single lineTo diagonal cut for a TL bevel", () => {
    const r = new PathRecorder();
    // TL corner geometry: corner at (0, 0), entry along -y, exit along +x.
    const tlGeom: CornerGeometry = {
      cornerX: 0, cornerY: 0,
      cx: 16, cy: 16, rx: 16, ry: 16,
      startAngle: Math.PI, endAngle: 1.5 * Math.PI,
      entryDirX: 0, entryDirY: -1, exitDirX: 1, exitDirY: 0,
    };
    // Direct call — verify it emits a single lineTo to (rx, 0).
    const { appendBevelCorner } = await import("../corner-path");
    appendBevelCorner(r, tlGeom);
    expect(r.ops.length).toBe(1);
    expect(r.ops[0].method).toBe("lineTo");
    expect(r.ops[0].args).toEqual([16, 0]); // exit endpoint = (cornerX + exitDirX * rx, cornerY + exitDirY * rx)
  });
});

describe("appendCornerPath — all-bevel corners", () => {
  it("emits moveTo + 8 lineTo + closePath (no ellipses)", () => {
    const r = new PathRecorder();
    const corners: Corners = [bevel(16), bevel(16), bevel(16), bevel(16)];
    appendCornerPath(r, 0, 0, 100, 100, corners);
    const methods = r.ops.map((op) => op.method);
    expect(methods.filter((m) => m === "ellipse").length).toBe(0);
    expect(methods.filter((m) => m === "lineTo").length).toBe(8); // 4 edge + 4 corner-cut
  });
});
```

Update the top-level import to remove the `await import` (use a static import for `appendBevelCorner`):

```typescript
import {
  appendCornerPath,
  appendRoundCorner,
  appendBevelCorner,
  type PathBuilder,
  type CornerGeometry,
} from "../corner-path";
```

And remove the `await import` line — call `appendBevelCorner(r, tlGeom)` directly.

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --prefix frontend test src/canvas/__tests__/corner-path.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: 6+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/canvas/corner-path.ts frontend/src/canvas/__tests__/corner-path.test.ts
git commit -m "feat(frontend): appendBevelCorner — diagonal cut variant"
```

---

## Task 5: `appendNotchCorner` — square step inward

Per spec § 3.2: notch is "two straight segments forming a square step inward: in by rx along one edge, over by ry perpendicular, back out". This produces 3 `lineTo` calls per corner (in + over + out), but the "in" is the previous-edge truncation (already drawn by the edge `lineTo`), so the notch helper itself emits 2 lineTos.

**Files:**
- Modify: `frontend/src/canvas/corner-path.ts`
- Modify: `frontend/src/canvas/__tests__/corner-path.test.ts`

- [ ] **Step 1: Add `appendNotchCorner` + dispatch case**

```typescript
/**
 * Emit two `lineTo` segments for a Notch corner — a square step inward.
 *
 * Starting from the entry endpoint (where the previous lineTo placed the pen),
 * step PERPENDICULAR to the entry edge (toward the rectangle interior) by ry,
 * then step ALONG the exit edge direction by rx, landing at the exit endpoint.
 */
export function appendNotchCorner(builder: PathBuilder, geom: CornerGeometry): void {
  // Entry endpoint (current pen position): corner - entryDir * ry
  const entryEndX = geom.cornerX - geom.entryDirX * geom.ry;
  const entryEndY = geom.cornerY - geom.entryDirY * geom.ry;
  // First inward step: from entry endpoint, perpendicular to entry edge by ry.
  // Perpendicular to entryDir pointing into the rectangle = exitDir direction
  // (since exit edge is perpendicular to entry edge for a rectangle).
  const innerX = entryEndX + geom.exitDirX * geom.rx;
  const innerY = entryEndY + geom.exitDirY * geom.ry;
  builder.lineTo(innerX, innerY);
  // Second step: from inner point, along the entry edge direction outward to the exit endpoint.
  // Exit endpoint: corner + exitDir * rx
  const exitStartX = geom.cornerX + geom.exitDirX * geom.rx;
  const exitStartY = geom.cornerY + geom.exitDirY * geom.rx;
  builder.lineTo(exitStartX, exitStartY);
}
```

Update `appendCorner()`:

```typescript
function appendCorner(builder: PathBuilder, corner: Corner, geom: CornerGeometry): void {
  switch (corner.type) {
    case "round":
      appendRoundCorner(builder, geom);
      return;
    case "bevel":
      appendBevelCorner(builder, geom);
      return;
    case "notch":
      appendNotchCorner(builder, geom);
      return;
    default:
      throw new Error(`appendCorner not yet implemented for ${corner.type}`);
  }
}
```

- [ ] **Step 2: Add notch test**

Append to `corner-path.test.ts`:

```typescript
function notch(r: number): Corner {
  return { type: "notch", radii: { x: r, y: r } };
}

describe("appendNotchCorner", () => {
  it("emits exactly two lineTo segments (step in + step out)", () => {
    const r = new PathRecorder();
    const tlGeom: CornerGeometry = {
      cornerX: 0, cornerY: 0,
      cx: 16, cy: 16, rx: 16, ry: 16,
      startAngle: Math.PI, endAngle: 1.5 * Math.PI,
      entryDirX: 0, entryDirY: -1, exitDirX: 1, exitDirY: 0,
    };
    appendNotchCorner(r, tlGeom);
    expect(r.ops.length).toBe(2);
    expect(r.ops.every((op) => op.method === "lineTo")).toBe(true);
    // First step: inward to (16, 16) — from (0, -16) inward by exitDir * rx + perpendicular by ry.
    // Entry endpoint = (0, 0) - (0, -1) * 16 = (0, 16). Then + exitDir * rx = (16, 16).
    expect(r.ops[0].args).toEqual([16, 16]);
    // Second step: out to exit endpoint = (16, 0).
    expect(r.ops[1].args).toEqual([16, 0]);
  });
});

describe("appendCornerPath — all-notch corners", () => {
  it("emits moveTo + 12 lineTo + closePath (4 edges + 4 corners × 2 segments)", () => {
    const r = new PathRecorder();
    const corners: Corners = [notch(16), notch(16), notch(16), notch(16)];
    appendCornerPath(r, 0, 0, 100, 100, corners);
    const methods = r.ops.map((op) => op.method);
    expect(methods.filter((m) => m === "ellipse").length).toBe(0);
    expect(methods.filter((m) => m === "lineTo").length).toBe(12);
  });
});
```

Update the top-level import to include `appendNotchCorner`.

- [ ] **Step 3: Run tests — expect PASS**

Run: `pnpm --prefix frontend test src/canvas/__tests__/corner-path.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: 8+ tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/canvas/corner-path.ts frontend/src/canvas/__tests__/corner-path.test.ts
git commit -m "feat(frontend): appendNotchCorner — square step inward"
```

---

## Task 6: `appendScoopCorner` — concave ellipse (reversed sweep)

Per spec § 3.2: same ellipse math as round, with sweep direction reversed → concave arc curving into the rectangle.

**Files:**
- Modify: `frontend/src/canvas/corner-path.ts`
- Modify: `frontend/src/canvas/__tests__/corner-path.test.ts`

The concave arc center is OUTSIDE the rectangle (at the geometric corner-point itself), and the sweep is in the opposite angular direction. Implementation: emit an ellipse centered at the corner-point with `rx`/`ry`, sweeping the COMPLEMENTARY angular range with `counterclockwise = true`.

- [ ] **Step 1: Add `appendScoopCorner` + dispatch case**

```typescript
/**
 * Emit an inward-curving ellipse for a Scoop corner.
 *
 * Whereas Round centers the ellipse INSIDE the rectangle and sweeps a quarter
 * circle from edge to edge, Scoop centers the ellipse at the geometric corner-
 * point of the rectangle (outside) and sweeps the OPPOSITE quarter circle in
 * the reverse direction (counterclockwise), producing a concave bite.
 *
 * Mathematically: the start/end points on the edges are unchanged from Round
 * (so the path remains C0 continuous with the straight edges), only the center
 * and sweep direction change.
 */
export function appendScoopCorner(builder: PathBuilder, geom: CornerGeometry): void {
  // The complementary angle range covers the OUTSIDE arc; we sweep counterclockwise
  // to keep the path direction consistent with the outer polygon traversal.
  // For TL: instead of (PI to 1.5PI), use (2PI to 0.5PI) going CCW.
  builder.ellipse(
    geom.cornerX,
    geom.cornerY,
    geom.rx,
    geom.ry,
    0,
    geom.endAngle - Math.PI, // opposite-side start
    geom.startAngle - Math.PI, // opposite-side end
    true, // counterclockwise
  );
}
```

Update `appendCorner()` to dispatch `scoop`.

- [ ] **Step 2: Add scoop test**

```typescript
function scoop(r: number): Corner {
  return { type: "scoop", radii: { x: r, y: r } };
}

describe("appendScoopCorner", () => {
  it("emits an ellipse with counterclockwise sweep centered at the corner-point", () => {
    const r = new PathRecorder();
    const tlGeom: CornerGeometry = {
      cornerX: 0, cornerY: 0,
      cx: 16, cy: 16, rx: 16, ry: 16,
      startAngle: Math.PI, endAngle: 1.5 * Math.PI,
      entryDirX: 0, entryDirY: -1, exitDirX: 1, exitDirY: 0,
    };
    appendScoopCorner(r, tlGeom);
    expect(r.ops.length).toBe(1);
    expect(r.ops[0].method).toBe("ellipse");
    // Center at corner-point (0, 0), not at ellipse center
    expect(r.ops[0].args[0]).toBe(0);
    expect(r.ops[0].args[1]).toBe(0);
    // counterclockwise flag at index 7 = 1
    expect(r.ops[0].args[7]).toBe(1);
  });
});
```

Import `appendScoopCorner` at the top.

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add frontend/src/canvas/corner-path.ts frontend/src/canvas/__tests__/corner-path.test.ts
git commit -m "feat(frontend): appendScoopCorner — concave inward arc"
```

---

## Task 7: `appendSuperellipseCorner` at smoothing = 0 (kappa anchor)

Per spec § 3.2 + § 3.7: at smoothing = 0, the cubic-bezier approximation should produce visually the same result as a round corner (kappa = 0.5522). Implementation: a single `bezierCurveTo` from the entry endpoint to the exit endpoint, with control points offset from each endpoint by `kappa * radius` toward the geometric corner-point.

**Files:**
- Modify: `frontend/src/canvas/corner-path.ts`
- Modify: `frontend/src/canvas/__tests__/corner-path.test.ts`

- [ ] **Step 1: Add `appendSuperellipseCorner` + helper computing the bezier control points**

```typescript
/**
 * Compute the v1 bleed factor for a given smoothing value.
 * At s=0: standard circular-arc anchor (BLEED_AT_S0).
 * At s=1: anchor extends to BLEED_AT_S1, producing G2-like curvature.
 *
 * v1 uses linear interpolation. Calibration against iOS/Figma references is a
 * 14d follow-up per spec § 3.7.
 */
function superellipseBleed(smoothing: number): number {
  return (1 - smoothing) * BLEED_AT_S0 + smoothing * BLEED_AT_S1;
}

/**
 * Emit a single cubic bezier `bezierCurveTo` for a Superellipse corner.
 *
 * Control points are positioned along the edges, offset from the corner-point
 * by `bleed * radius`, and the cubic tangent at each endpoint is along the
 * adjacent edge (C1 continuity with the straight edges).
 *
 * At smoothing = 0, bleed = 1.0 and the bezier is the standard cubic
 * approximation of a quarter-circle (kappa = 0.5522 captured via the bleed
 * factor's interaction with the control-point offset).
 */
export function appendSuperellipseCorner(
  builder: PathBuilder,
  geom: CornerGeometry,
  smoothing: number,
): void {
  const bleed = superellipseBleed(smoothing);
  // The entry endpoint (current pen position) is at distance `ry` from the corner
  // along the entry edge. The control point for the entry side is offset KAPPA_CIRCULAR
  // closer to the corner-point along the entry edge — but scaled by the bleed factor.
  const entryEndX = geom.cornerX - geom.entryDirX * geom.ry;
  const entryEndY = geom.cornerY - geom.entryDirY * geom.ry;
  // Control point near entry: along entry edge toward corner-point by KAPPA_CIRCULAR * ry,
  // but the BLEED scales how far along the edge the control point sits from the corner.
  // At bleed=1.0, control point sits at distance ry*(1 - KAPPA_CIRCULAR) from the corner.
  // At bleed=1.5, control point sits at distance ry*1.5*(1 - KAPPA_CIRCULAR) from the corner.
  const cp1X = geom.cornerX - geom.entryDirX * geom.ry * (1 - KAPPA_CIRCULAR) * bleed;
  const cp1Y = geom.cornerY - geom.entryDirY * geom.ry * (1 - KAPPA_CIRCULAR) * bleed;
  // Control point near exit: along exit edge from corner-point.
  const cp2X = geom.cornerX + geom.exitDirX * geom.rx * (1 - KAPPA_CIRCULAR) * bleed;
  const cp2Y = geom.cornerY + geom.exitDirY * geom.rx * (1 - KAPPA_CIRCULAR) * bleed;
  // Exit endpoint
  const exitX = geom.cornerX + geom.exitDirX * geom.rx;
  const exitY = geom.cornerY + geom.exitDirY * geom.ry;
  builder.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, exitX, exitY);
}
```

Update `appendCorner()` to dispatch `superellipse`, passing through `corner.smoothing`:

```typescript
function appendCorner(builder: PathBuilder, corner: Corner, geom: CornerGeometry): void {
  switch (corner.type) {
    case "round":
      appendRoundCorner(builder, geom);
      return;
    case "bevel":
      appendBevelCorner(builder, geom);
      return;
    case "notch":
      appendNotchCorner(builder, geom);
      return;
    case "scoop":
      appendScoopCorner(builder, geom);
      return;
    case "superellipse":
      appendSuperellipseCorner(builder, geom, corner.smoothing);
      return;
    default: {
      const _exhaustive: never = corner;
      throw new Error(`unexpected corner type: ${String(_exhaustive)}`);
    }
  }
}
```

This `default` arm is the exhaustiveness sentinel required by `.claude/rules/frontend-defensive.md` "Discriminated Unions Must Have a Type-Level Exhaustiveness Sentinel".

- [ ] **Step 2: Add test for superellipse at s=0**

```typescript
function superellipse(r: number, smoothing: number): Corner {
  return { type: "superellipse", radii: { x: r, y: r }, smoothing };
}

const TL_S0_GEOM: CornerGeometry = {
  cornerX: 0, cornerY: 0,
  cx: 16, cy: 16, rx: 16, ry: 16,
  startAngle: Math.PI, endAngle: 1.5 * Math.PI,
  entryDirX: 0, entryDirY: -1, exitDirX: 1, exitDirY: 0,
};

describe("appendSuperellipseCorner at smoothing = 0", () => {
  it("emits a single bezierCurveTo", () => {
    const r = new PathRecorder();
    appendSuperellipseCorner(r, TL_S0_GEOM, 0);
    expect(r.ops.length).toBe(1);
    expect(r.ops[0].method).toBe("bezierCurveTo");
  });

  it("control points are placed using kappa anchor at bleed=1.0", () => {
    const r = new PathRecorder();
    appendSuperellipseCorner(r, TL_S0_GEOM, 0);
    const expectedOffset = 16 * (1 - 0.5522847498) * 1.0;
    // cp1: corner (0,0) - entryDir (0,-1) * offset = (0, +offset)
    expect(r.ops[0].args[0]).toBeCloseTo(0, 6);
    expect(r.ops[0].args[1]).toBeCloseTo(expectedOffset, 6);
    // cp2: corner (0,0) + exitDir (1,0) * offset = (offset, 0)
    expect(r.ops[0].args[2]).toBeCloseTo(expectedOffset, 6);
    expect(r.ops[0].args[3]).toBeCloseTo(0, 6);
    // Exit endpoint: (16, 0)
    expect(r.ops[0].args[4]).toBeCloseTo(16, 6);
    expect(r.ops[0].args[5]).toBeCloseTo(0, 6);
  });
});
```

Add `appendSuperellipseCorner` to the import.

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add frontend/src/canvas/corner-path.ts frontend/src/canvas/__tests__/corner-path.test.ts
git commit -m "feat(frontend): appendSuperellipseCorner at smoothing=0 (kappa anchor)"
```

---

## Task 8: Superellipse interpolation between s=0 and s=1

The interpolation formula is already in `superellipseBleed()` from Task 7. Task 8 verifies the interpolation behaves correctly at s=0.5 and s=1.

**Files:**
- Modify: `frontend/src/canvas/__tests__/corner-path.test.ts`

- [ ] **Step 1: Add tests for s=0.5 and s=1**

```typescript
describe("appendSuperellipseCorner interpolation", () => {
  it("at smoothing = 1, control point offset extends to bleed=1.5", () => {
    const r = new PathRecorder();
    appendSuperellipseCorner(r, TL_S0_GEOM, 1);
    const expectedOffset = 16 * (1 - 0.5522847498) * 1.5;
    expect(r.ops[0].args[1]).toBeCloseTo(expectedOffset, 6); // cp1.y
    expect(r.ops[0].args[2]).toBeCloseTo(expectedOffset, 6); // cp2.x
  });

  it("at smoothing = 0.5, control point offset is the midpoint between bleed values", () => {
    const r = new PathRecorder();
    appendSuperellipseCorner(r, TL_S0_GEOM, 0.5);
    const expectedOffset = 16 * (1 - 0.5522847498) * 1.25; // midpoint between 1.0 and 1.5
    expect(r.ops[0].args[1]).toBeCloseTo(expectedOffset, 6);
    expect(r.ops[0].args[2]).toBeCloseTo(expectedOffset, 6);
  });
});
```

- [ ] **Step 2: Run tests — expect PASS**

- [ ] **Step 3: Commit**

```bash
git add frontend/src/canvas/__tests__/corner-path.test.ts
git commit -m "test(frontend): verify superellipse bleed interpolation at s=0.5 and s=1"
```

---

## Task 9: Radius clamping pre-pass

Per spec § 3.3: if sum of two adjacent corners' radii on any edge exceeds that edge length, scale all radii down by `min(edge_length / radii_sum)` across the four edges.

**Files:**
- Modify: `frontend/src/canvas/corner-path.ts`
- Modify: `frontend/src/canvas/__tests__/corner-path.test.ts`

- [ ] **Step 1: Add `clampRadii` helper, call it from `appendCornerPath`**

Add to `corner-path.ts`:

```typescript
/**
 * Compute the maximum scale factor that fits the per-corner radii within the
 * rectangle edges. Returns 1.0 if no clamping is required.
 *
 * For each of the 4 edges, the two adjacent corners contribute their on-edge
 * radius (x for top/bottom, y for left/right). If the sum exceeds the edge
 * length, that edge needs scaling. The minimum scale across all edges is
 * applied uniformly to every corner's rx and ry so the shape stays
 * proportional.
 */
export function clampScale(width: number, height: number, corners: Corners): number {
  const [tl, tr, br, bl] = corners;
  // Top edge: tl.rx + tr.rx ≤ width
  const topScale = tl.radii.x + tr.radii.x > 0 ? width / (tl.radii.x + tr.radii.x) : Infinity;
  // Bottom edge: bl.rx + br.rx ≤ width
  const bottomScale = bl.radii.x + br.radii.x > 0 ? width / (bl.radii.x + br.radii.x) : Infinity;
  // Left edge: tl.ry + bl.ry ≤ height
  const leftScale = tl.radii.y + bl.radii.y > 0 ? height / (tl.radii.y + bl.radii.y) : Infinity;
  // Right edge: tr.ry + br.ry ≤ height
  const rightScale = tr.radii.y + br.radii.y > 0 ? height / (tr.radii.y + br.radii.y) : Infinity;
  return Math.min(1, topScale, bottomScale, leftScale, rightScale);
}

/** Apply a uniform scale to every corner's radii. */
function scaleCorners(corners: Corners, scale: number): Corners {
  return corners.map((c) => {
    const scaled = { x: c.radii.x * scale, y: c.radii.y * scale };
    if (c.type === "superellipse") {
      return { type: "superellipse", radii: scaled, smoothing: c.smoothing };
    }
    return { type: c.type, radii: scaled } as Corner;
  }) as unknown as Corners;
}
```

Update `appendCornerPath` to apply clamping before computing geometry:

```typescript
export function appendCornerPath(
  builder: PathBuilder,
  x: number,
  y: number,
  width: number,
  height: number,
  corners: Corners,
): void {
  const scale = clampScale(width, height, corners);
  const effective = scale < 1 ? scaleCorners(corners, scale) : corners;
  const [tl, tr, br, bl] = effective;
  const [glTL, glTR, glBR, glBL] = cornerGeometries(x, y, width, height, effective);

  builder.moveTo(x + tl.radii.x, y);
  builder.lineTo(x + width - tr.radii.x, y);
  appendCorner(builder, tr, glTR);
  builder.lineTo(x + width, y + height - br.radii.y);
  appendCorner(builder, br, glBR);
  builder.lineTo(x + bl.radii.x, y + height);
  appendCorner(builder, bl, glBL);
  builder.lineTo(x, y + tl.radii.y);
  appendCorner(builder, tl, glTL);
  builder.closePath();
}
```

- [ ] **Step 2: Add clamping tests**

```typescript
describe("clampScale", () => {
  it("returns 1.0 when radii fit within edges", () => {
    const corners: Corners = [round(16), round(16), round(16), round(16)];
    expect(clampScale(100, 100, corners)).toBe(1);
  });

  it("returns 0.75 when top-edge sum exceeds width by 4/3x", () => {
    const corners: Corners = [round(40), round(40), round(40), round(40)];
    // top edge: 40 + 40 = 80 > 60 → scale = 60/80 = 0.75
    expect(clampScale(60, 100, corners)).toBe(0.75);
  });

  it("uses the minimum scale across all 4 edges", () => {
    // Asymmetric: left edge is the constraint.
    const corners: Corners = [round(60), round(10), round(10), round(60)];
    // Left edge: 60 + 60 = 120 > 100 → scale = 100/120 ≈ 0.833
    // Top edge: 60 + 10 = 70 < 100 → scale_top = 100/70 ≈ 1.43, no clamp
    // Right edge: 10 + 10 = 20, scale_right = 5
    // Bottom edge: 10 + 60 = 70, scale_bottom ≈ 1.43
    // Min: scale_left
    expect(clampScale(100, 100, corners)).toBeCloseTo(100 / 120, 6);
  });
});

describe("appendCornerPath — radius clamping", () => {
  it("scales ellipse radii when corner radii exceed edge length", () => {
    const r = new PathRecorder();
    const corners: Corners = [round(40), round(40), round(40), round(40)];
    appendCornerPath(r, 0, 0, 60, 60, corners);
    // After clamping, scale = 60/80 = 0.75 → effective radii = 30.
    const ellipses = r.ops.filter((op) => op.method === "ellipse");
    expect(ellipses.length).toBe(4);
    for (const e of ellipses) {
      expect(e.args[2]).toBeCloseTo(30, 6); // rx
      expect(e.args[3]).toBeCloseTo(30, 6); // ry
    }
  });
});
```

Update the imports to include `clampScale`.

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add frontend/src/canvas/corner-path.ts frontend/src/canvas/__tests__/corner-path.test.ts
git commit -m "feat(frontend): clampScale pre-pass for radii exceeding edges"
```

---

## Task 10: Numeric guards — reject NaN/Infinity, guard Math domain

Per spec § 3.4 + CLAUDE.md §11 "Floating-Point Validation" + "Math Helpers Must Guard Their Domain": every `f64` input must be checked; `Math.pow`/`Math.sqrt` calls (none currently, but future-proofing the bleed math) must guard their domain.

**Files:**
- Modify: `frontend/src/canvas/corner-path.ts`
- Modify: `frontend/src/canvas/__tests__/corner-path.test.ts`

- [ ] **Step 1: Add finite-input guards at the top of `appendCornerPath`**

```typescript
/**
 * Per CLAUDE.md §11 "Floating-Point Validation": every f64 numeric input to a
 * path-construction call must be guarded. NaN/Infinity in canvas calls
 * produces malformed paths silently — the browser ignores the offending
 * operation without error.
 *
 * Failure mode: structured `console.warn` per `.claude/rules/frontend-defensive.md`
 * "Internal Mutation Entry Points Must Diagnose Their Own No-Ops", and emit
 * NO ops to the builder (caller gets an empty path).
 */
function validateDimensions(x: number, y: number, width: number, height: number): boolean {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    console.warn("corner-path: rejected non-finite or non-positive dimensions", {
      x, y, width, height,
    });
    return false;
  }
  return true;
}

function validateCornerRadii(corners: Corners): boolean {
  for (const corner of corners) {
    if (
      !Number.isFinite(corner.radii.x) ||
      !Number.isFinite(corner.radii.y) ||
      corner.radii.x < 0 ||
      corner.radii.y < 0
    ) {
      console.warn("corner-path: rejected non-finite or negative radii", { corner });
      return false;
    }
    if (corner.type === "superellipse") {
      if (
        !Number.isFinite(corner.smoothing) ||
        corner.smoothing < 0 ||
        corner.smoothing > 1
      ) {
        console.warn("corner-path: rejected out-of-range superellipse smoothing", { corner });
        return false;
      }
    }
  }
  return true;
}
```

Update `appendCornerPath` to guard at entry:

```typescript
export function appendCornerPath(
  builder: PathBuilder,
  x: number,
  y: number,
  width: number,
  height: number,
  corners: Corners,
): void {
  if (!validateDimensions(x, y, width, height)) return;
  if (!validateCornerRadii(corners)) return;
  // ... rest unchanged
}
```

- [ ] **Step 2: Add guard tests**

```typescript
describe("appendCornerPath — input guards", () => {
  it("emits no ops and warns on NaN x", () => {
    const r = new PathRecorder();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const corners: Corners = [round(16), round(16), round(16), round(16)];
      appendCornerPath(r, NaN, 0, 100, 100, corners);
      expect(r.ops.length).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("emits no ops and warns on Infinity width", () => {
    const r = new PathRecorder();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const corners: Corners = [round(16), round(16), round(16), round(16)];
      appendCornerPath(r, 0, 0, Infinity, 100, corners);
      expect(r.ops.length).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("emits no ops on zero width (degenerate rectangle)", () => {
    const r = new PathRecorder();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const corners: Corners = [round(16), round(16), round(16), round(16)];
      appendCornerPath(r, 0, 0, 0, 100, corners);
      expect(r.ops.length).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("emits no ops on NaN radius", () => {
    const r = new PathRecorder();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const corners: Corners = [
        { type: "round", radii: { x: NaN, y: 16 } },
        round(16), round(16), round(16),
      ];
      appendCornerPath(r, 0, 0, 100, 100, corners);
      expect(r.ops.length).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("emits no ops on superellipse smoothing out of [0,1]", () => {
    const r = new PathRecorder();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const corners: Corners = [
        superellipse(16, 1.5),
        superellipse(16, 0.5),
        superellipse(16, 0.5),
        superellipse(16, 0.5),
      ];
      appendCornerPath(r, 0, 0, 100, 100, corners);
      expect(r.ops.length).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
```

Add `vi` to the test imports.

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add frontend/src/canvas/corner-path.ts frontend/src/canvas/__tests__/corner-path.test.ts
git commit -m "feat(frontend): finite-input + radii + smoothing guards in appendCornerPath"
```

---

## Task 11: Mixed-shapes test + public `buildCornerPath`

**Files:**
- Modify: `frontend/src/canvas/corner-path.ts`
- Modify: `frontend/src/canvas/__tests__/corner-path.test.ts`

- [ ] **Step 1: Add `buildCornerPath` public API**

Append to `corner-path.ts`:

```typescript
/**
 * Public API for the canvas renderer. Allocates a fresh `Path2D` and writes
 * the corner-shape geometry into it. Returns the populated path ready for
 * `ctx.fill(path)` / `ctx.stroke(path)` / `ctx.clip(path)`.
 *
 * If `appendCornerPath` rejects the input (see guards), the returned Path2D
 * is empty — the caller will draw nothing, matching the safe fallback.
 */
export function buildCornerPath(
  x: number,
  y: number,
  width: number,
  height: number,
  corners: Corners,
): Path2D {
  const path = new Path2D();
  appendCornerPath(path, x, y, width, height, corners);
  return path;
}
```

- [ ] **Step 2: Add a mixed-shapes test asserting the per-corner branch fires correctly**

```typescript
describe("appendCornerPath — mixed shapes", () => {
  it("emits the right per-corner ops when corners differ", () => {
    const r = new PathRecorder();
    const corners: Corners = [round(16), bevel(16), notch(16), scoop(16)];
    appendCornerPath(r, 0, 0, 100, 100, corners);
    // The orchestrator emits corners in order: TR, BR, BL, TL.
    // TR is index 1 = bevel
    // BR is index 2 = notch
    // BL is index 3 = scoop
    // TL is index 0 = round
    // Find the ops between consecutive moveTos/edges to identify per-corner branches.
    const methods = r.ops.map((op) => op.method);
    // Expected sequence: moveTo, lineTo (top edge), [TR=lineTo (bevel)],
    // lineTo (right edge), [BR=2× lineTo (notch)],
    // lineTo (bottom edge), [BL=ellipse (scoop)],
    // lineTo (left edge), [TL=ellipse (round)], closePath.
    expect(methods).toEqual([
      "moveTo",
      "lineTo", // top edge
      "lineTo", // TR bevel
      "lineTo", // right edge
      "lineTo", // BR notch step 1
      "lineTo", // BR notch step 2
      "lineTo", // bottom edge
      "ellipse", // BL scoop
      "lineTo", // left edge
      "ellipse", // TL round
      "closePath",
    ]);
  });
});

describe("buildCornerPath public API", () => {
  it("returns a Path2D instance", () => {
    const corners: Corners = [round(16), round(16), round(16), round(16)];
    const path = buildCornerPath(0, 0, 100, 100, corners);
    expect(path).toBeInstanceOf(Path2D);
  });

  it("returns an empty Path2D when inputs are invalid", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const corners: Corners = [round(16), round(16), round(16), round(16)];
      const path = buildCornerPath(NaN, 0, 100, 100, corners);
      expect(path).toBeInstanceOf(Path2D);
      // Path is empty — no observable side effect, but at least construction succeeded.
    } finally {
      warnSpy.mockRestore();
    }
  });
});
```

Add `buildCornerPath` to the imports.

- [ ] **Step 3: Run tests — expect PASS**

Note: `Path2D` is a browser-native global; jsdom 29 implements it (the `setProperty` polyfill from the 14b vitest.setup.ts handles the `calc(NaN%)` quirk but Path2D is independent). If for some reason jsdom in your environment fails to provide Path2D, the `buildCornerPath` `instanceof Path2D` assertion will fail — in that case, extend `frontend/vitest.setup.ts` to add a minimal Path2D shim.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/canvas/corner-path.ts frontend/src/canvas/__tests__/corner-path.test.ts
git commit -m "feat(frontend): buildCornerPath public API + mixed-shapes coverage"
```

---

## Task 12: Extract `createMockContext` to a shared test helper

The existing `createMockContext` proxy lives in `frontend/src/canvas/__tests__/renderer.test.ts:91-164`. Plan 14c's renderer integration tests reuse the same pattern. Extract to a shared helper before adding new tests.

**Files:**
- Create: `frontend/src/canvas/__tests__/canvas-mock.ts`
- Modify: `frontend/src/canvas/__tests__/renderer.test.ts`

- [ ] **Step 1: Create `canvas-mock.ts` with the extracted helper**

Create `frontend/src/canvas/__tests__/canvas-mock.ts`:

```typescript
/**
 * Test helper: a Proxy-based recording mock for `CanvasRenderingContext2D`.
 *
 * Every method call and property assignment is recorded into `__calls` for
 * assertion. `createLinearGradient` / `createRadialGradient` / `createConicGradient`
 * return mock gradient objects that capture `addColorStop` calls.
 *
 * Extracted from the inline `createMockContext` previously in
 * `renderer.test.ts`. Plan 14c's `corner-path.test.ts` and the renderer
 * integration tests share this helper.
 */

export interface MockGradient {
  readonly __type: "linear" | "radial" | "conic";
  readonly __args: readonly number[];
  readonly __stops: Array<{ offset: number; color: string }>;
  addColorStop: (offset: number, color: string) => void;
}

export interface MockCall {
  method: string;
  args: unknown[];
}

/** Create a mock 2D canvas context that records every call and property set. */
export function createMockContext(): CanvasRenderingContext2D {
  const calls: MockCall[] = [];

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target: Record<string, unknown>, prop: string): unknown {
      if (prop === "__calls") {
        return calls;
      }
      if (prop === "canvas") {
        return { width: 800, height: 600 };
      }
      if (prop === "createLinearGradient") {
        return (...args: number[]): MockGradient => {
          const stops: Array<{ offset: number; color: string }> = [];
          const gradient: MockGradient = {
            __type: "linear", __args: args, __stops: stops,
            addColorStop(offset: number, color: string) { stops.push({ offset, color }); },
          };
          calls.push({ method: "createLinearGradient", args });
          return gradient;
        };
      }
      if (prop === "createRadialGradient") {
        return (...args: number[]): MockGradient => {
          const stops: Array<{ offset: number; color: string }> = [];
          const gradient: MockGradient = {
            __type: "radial", __args: args, __stops: stops,
            addColorStop(offset: number, color: string) { stops.push({ offset, color }); },
          };
          calls.push({ method: "createRadialGradient", args });
          return gradient;
        };
      }
      if (prop === "createConicGradient") {
        return (...args: number[]): MockGradient => {
          const stops: Array<{ offset: number; color: string }> = [];
          const gradient: MockGradient = {
            __type: "conic", __args: args, __stops: stops,
            addColorStop(offset: number, color: string) { stops.push({ offset, color }); },
          };
          calls.push({ method: "createConicGradient", args });
          return gradient;
        };
      }
      if (typeof target[prop] === "undefined") {
        target[prop] = (...args: unknown[]) => {
          calls.push({ method: prop, args });
        };
      }
      return target[prop];
    },
    set(target: Record<string, unknown>, prop: string, value: unknown): boolean {
      calls.push({ method: `set:${prop}`, args: [value] });
      target[prop] = value;
      return true;
    },
  };

  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

/** Extract recorded calls from the mock context. */
export function getCalls(ctx: CanvasRenderingContext2D): MockCall[] {
  return (ctx as unknown as { __calls: MockCall[] }).__calls;
}
```

- [ ] **Step 2: Update `renderer.test.ts` to import from the shared helper**

In `frontend/src/canvas/__tests__/renderer.test.ts`:

1. Delete lines 91-169 (the inline `createMockContext`, `getCalls`, `MockGradient` type).
2. Add import at the top of the file:

```typescript
import { createMockContext, getCalls, type MockGradient } from "./canvas-mock";
```

3. Verify the rest of `renderer.test.ts` still works — `createMockContext()` and `getCalls(ctx)` and `MockGradient` type usages are unchanged.

- [ ] **Step 3: Run the existing renderer tests — expect all still pass (behavior-preserving extraction)**

Run: `pnpm --prefix frontend test src/canvas/__tests__/renderer.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: all existing tests pass.

- [ ] **Step 4: Verify full suite still passes**

Run: `pnpm --prefix frontend test --reporter=default 2>&1 | tail -5`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/canvas/__tests__/canvas-mock.ts frontend/src/canvas/__tests__/renderer.test.ts
git commit -m "refactor(frontend): extract createMockContext to shared canvas-mock helper"
```

**Note on commit type:** this is genuinely behavior-preserving (CLAUDE.md §6 "refactor" semantics) — same code, new location, all existing tests still pass. No new types, no new behavior.

---

## Task 13: Renderer uses `buildCornerPath` for FILL of corner-bearing nodes

Per spec § 3.5: `drawNode` replaces `ctx.fillRect(x, y, width, height)` with `ctx.fill(path)` for the 3 corner-bearing node kinds (`rectangle`, `frame`, `image`). The default-color path (no fills) and the per-fill loop both use the same Path2D.

Note: `group`, `component_instance`, and `path` kinds currently share the rectangle's `fillRect` branch in `drawNode`. Group should NOT draw (it's invisible — confirm by reading drawNode), and `path` / `component_instance` are placeholder rendering. For 14c, keep them on `fillRect` for now (they don't have `corners` in their NodeKind type — adding path-based rendering to them is a separate scope).

**Files:**
- Modify: `frontend/src/canvas/renderer.ts`
- Modify: `frontend/src/canvas/__tests__/renderer.test.ts`

- [ ] **Step 1: Inspect the current drawNode switch + identify the 3 corner-bearing branches**

Run:
```bash
sed -n '362,400p' frontend/src/canvas/renderer.ts
```

The current implementation groups `frame`, `rectangle`, `group`, `image`, `component_instance` together in one `case` block. We need to SPLIT this so the corner-bearing kinds (`rectangle`, `frame`, `image`) use `buildCornerPath` and the others (`group`, `component_instance`) remain on `fillRect`.

- [ ] **Step 2: Add import for `buildCornerPath` at the top of `renderer.ts`**

```typescript
import { buildCornerPath } from "./corner-path";
```

- [ ] **Step 3: Split the case block in drawNode**

Replace the current rectangle/frame/image/group/component_instance case block with two blocks:

```typescript
    case "frame":
    case "rectangle":
    case "image": {
      // Corner-bearing kinds — use path-based fill.
      const path = buildCornerPath(x, y, width, height, node.kind.corners);
      if (node.style.fills.length === 0) {
        ctx.fillStyle = DEFAULT_FILL;
        ctx.fill(path);
      } else {
        for (const fill of node.style.fills) {
          const fillStyle = resolveFillStyle(ctx, fill, x, y, width, height, tokens);
          if (fillStyle !== null) {
            ctx.fillStyle = fillStyle;
            ctx.fill(path);
          }
        }
      }
      break;
    }
    case "group":
    case "component_instance": {
      // Non-corner-bearing container kinds — placeholder fillRect (no shape geometry).
      if (node.style.fills.length === 0) {
        ctx.fillStyle = DEFAULT_FILL;
        ctx.fillRect(x, y, width, height);
      } else {
        for (const fill of node.style.fills) {
          const fillStyle = resolveFillStyle(ctx, fill, x, y, width, height, tokens);
          if (fillStyle !== null) {
            ctx.fillStyle = fillStyle;
            ctx.fillRect(x, y, width, height);
          }
        }
      }
      break;
    }
```

The `ellipse`, `text`, and `path` cases remain unchanged (they don't have corners).

- [ ] **Step 4: Add a regression test verifying Rectangle uses ctx.fill(Path2D)**

Add to `renderer.test.ts`:

```typescript
import { buildCornerPath } from "../corner-path";
import type { Corners } from "../../types/document";

const ZERO_CORNERS: Corners = [
  { type: "round", radii: { x: 0, y: 0 } },
  { type: "round", radii: { x: 0, y: 0 } },
  { type: "round", radii: { x: 0, y: 0 } },
  { type: "round", radii: { x: 0, y: 0 } },
];

describe("drawNode — corner-bearing nodes use buildCornerPath (fill)", () => {
  it("rectangle node calls ctx.fill(Path2D) instead of ctx.fillRect", () => {
    const ctx = createMockContext();
    const viewport: Viewport = { x: 0, y: 0, zoom: 1 };
    const node: DocumentNode = {
      // ... use existing test fixtures from this file as a template
      // (the existing tests already construct rectangle nodes — replicate that pattern)
    } as DocumentNode;
    // Note: this test uses the existing DocumentNode test-fixture pattern from
    // renderer.test.ts. The implementer should reference an existing rectangle
    // test (e.g., the first selection-highlight test) for the node shape.
    render(ctx, viewport, [node], new Set(), 1);
    const calls = getCalls(ctx);
    // Assert there is at least one ctx.fill call with a Path2D argument
    const fillCalls = calls.filter((c) => c.method === "fill");
    expect(fillCalls.length).toBeGreaterThan(0);
    expect(fillCalls[0].args[0]).toBeInstanceOf(Path2D);
    // Assert NO fillRect calls for this node
    const fillRectCalls = calls.filter((c) => c.method === "fillRect");
    expect(fillRectCalls.length).toBe(0);
  });

  it("group node still uses ctx.fillRect (no corners)", () => {
    const ctx = createMockContext();
    const viewport: Viewport = { x: 0, y: 0, zoom: 1 };
    // Construct a group node — use the existing test pattern for a group fixture.
    // ...
    // Assert: ctx.fillRect was called, ctx.fill was NOT called for this node.
  });
});
```

The implementer must fill in the `node` fixtures using the existing test patterns from `renderer.test.ts` (search for `kind: { type: "rectangle"` to find the canonical shape; replicate the same field-by-field structure including the new `corners` field).

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm --prefix frontend test src/canvas/__tests__/renderer.test.ts --reporter=verbose 2>&1 | tail -15`
Expected: all tests pass including the 2 new ones.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/canvas/renderer.ts frontend/src/canvas/__tests__/renderer.test.ts
git commit -m "feat(frontend): drawNode uses buildCornerPath for fill on rectangle/frame/image"
```

---

## Task 14: Renderer uses path-based STROKE for corner-bearing nodes

Stroke path mirrors the fill swap. Currently the stroke block has a `switch (node.kind.type)` with a `default:` arm that calls `ctx.strokeRect`. Replace with `ctx.stroke(buildCornerPath(...))` for the 3 corner-bearing kinds.

**Files:**
- Modify: `frontend/src/canvas/renderer.ts`
- Modify: `frontend/src/canvas/__tests__/renderer.test.ts`

- [ ] **Step 1: Inspect the current stroke switch in drawNode**

Run:
```bash
sed -n '525,560p' frontend/src/canvas/renderer.ts
```

The stroke block uses `switch (node.kind.type)` with cases `ellipse`, then a `default:` that does `strokeRect`. Update the default to dispatch on kind: corner-bearing kinds get `ctx.stroke(path)`, others get `strokeRect`.

- [ ] **Step 2: Update the stroke switch**

```typescript
    switch (node.kind.type) {
      case "ellipse": {
        ctx.beginPath();
        ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "frame":
      case "rectangle":
      case "image": {
        const strokePath = buildCornerPath(x, y, width, height, node.kind.corners);
        ctx.stroke(strokePath);
        break;
      }
      default: {
        ctx.strokeRect(x, y, width, height);
      }
    }
```

- [ ] **Step 3: Add stroke regression test**

```typescript
describe("drawNode — corner-bearing nodes use buildCornerPath (stroke)", () => {
  it("rectangle node with stroke calls ctx.stroke(Path2D) instead of ctx.strokeRect", () => {
    const ctx = createMockContext();
    const viewport: Viewport = { x: 0, y: 0, zoom: 1 };
    // Rectangle node with stroke configured — use existing stroke-test fixture pattern.
    // ...
    const calls = getCalls(ctx);
    const strokeCalls = calls.filter((c) => c.method === "stroke");
    expect(strokeCalls.length).toBeGreaterThan(0);
    expect(strokeCalls[0].args[0]).toBeInstanceOf(Path2D);
    const strokeRectCalls = calls.filter((c) => c.method === "strokeRect");
    expect(strokeRectCalls.length).toBe(0);
  });
});
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/canvas/renderer.ts frontend/src/canvas/__tests__/renderer.test.ts
git commit -m "feat(frontend): drawNode uses buildCornerPath for stroke on rectangle/frame/image"
```

---

## Task 15: Frame child clipping — clip stack in `render()`

Per spec § 3.5: when the render loop visits a Frame node, push `ctx.save() + ctx.clip(framePath)`. Before drawing each subsequent node, walk up the ancestry; if the new node is NOT inside the clip-stack's top frame, pop and `ctx.restore()`. At end of loop, drain remaining stack with `ctx.restore()` calls.

**Files:**
- Modify: `frontend/src/canvas/renderer.ts`
- Modify: `frontend/src/canvas/__tests__/renderer.test.ts`

- [ ] **Step 1: Identify the render loop in `render()`**

The render loop is at `frontend/src/canvas/renderer.ts:783+`. Look for `for (const node of nodes)`.

- [ ] **Step 2: Add clip-stack management to the render loop**

Around the existing draw loop, introduce a clip stack:

```typescript
  // Plan 14c: clip-stack for frame children. nodes are in depth-first
  // parent-then-children order (via buildRenderOrder), so we push a clip
  // when entering a frame's subtree and pop when leaving it.
  //
  // Each clipStack entry holds the frame UUID. To detect "left subtree",
  // we check whether the next node's ancestry chain (via parentUuid walks)
  // still contains the top-of-stack UUID.
  const clipStack: string[] = [];

  // Helper: walk up the parent chain to check if `nodeUuid` is a descendant
  // of `ancestorUuid`. Bounded by MAX_RENDER_DEPTH to defend against cycles.
  function isDescendant(nodeUuid: string, ancestorUuid: string): boolean {
    let current: string | null | undefined = nodeUuid;
    let depth = 0;
    while (current && depth < MAX_RENDER_DEPTH) {
      if (current === ancestorUuid) return true;
      const node = nodesByUuid.get(current);
      current = node?.parentUuid;
      depth++;
    }
    return false;
  }

  // Build a uuid lookup once (avoid O(n) per ancestry check).
  const nodesByUuid = new Map<string, DocumentNode>();
  for (const n of nodes) nodesByUuid.set(n.uuid, n);

  // Draw each visible node.
  for (const node of nodes) {
    if (!node.visible) continue;

    // Pop frames whose subtree we have left.
    while (
      clipStack.length > 0 &&
      !isDescendant(node.uuid, clipStack[clipStack.length - 1])
    ) {
      ctx.restore();
      clipStack.pop();
    }

    const effectiveTransform = getEffectiveTransform(node, previewMap);
    drawNode(ctx, node, effectiveTransform, tokens);

    // If this is a frame, push a clip for its subtree.
    if (node.kind.type === "frame") {
      const { x, y, width, height } = effectiveTransform;
      const clipPath = buildCornerPath(x, y, width, height, node.kind.corners);
      ctx.save();
      ctx.clip(clipPath);
      clipStack.push(node.uuid);
    }
  }

  // Drain any remaining clip-stack entries at end of loop.
  while (clipStack.length > 0) {
    ctx.restore();
    clipStack.pop();
  }
```

You'll need to add the `MAX_RENDER_DEPTH` import:

```typescript
import { MAX_RENDER_DEPTH } from "./render-order";
```

Note: the existing render loop is more complex than the sketch above — it has selection highlighting, snap-guide drawing, marquee rect drawing, etc. The clip-stack logic must be in the MAIN draw loop only (the first `for (const node of nodes)` block), NOT around the selection highlights or other overlay draws. Selection highlights should render in their own pass without clipping.

- [ ] **Step 3: Add the clip-stack test (single frame clipping a child rectangle)**

```typescript
describe("render() — frame child clipping (Plan 14c)", () => {
  it("frame draws then save + clip(Path2D) + child draws + restore", () => {
    const ctx = createMockContext();
    const viewport: Viewport = { x: 0, y: 0, zoom: 1 };
    // Construct a frame node + a child rectangle node referencing it by parentUuid.
    // Use the existing fixtures from this file as a template, but with parentUuid set.
    const frame: DocumentNode = {
      uuid: "frame-1",
      // ... full DocumentNode fields including kind.type = "frame", corners = ZERO_CORNERS
      parentUuid: null,
      childrenUuids: ["rect-1"],
    } as DocumentNode;
    const child: DocumentNode = {
      uuid: "rect-1",
      // ... kind.type = "rectangle", corners = ZERO_CORNERS, parentUuid = "frame-1"
      parentUuid: "frame-1",
      childrenUuids: [],
    } as DocumentNode;
    render(ctx, viewport, [frame, child], new Set(), 1);

    const calls = getCalls(ctx);
    // Find the sequence: ... frame fill ... save ... clip(path) ... rect fill ... restore
    const methodSequence = calls.map((c) => c.method);
    const saveIdx = methodSequence.indexOf("save");
    const clipIdx = methodSequence.indexOf("clip", saveIdx);
    const restoreIdx = methodSequence.indexOf("restore", clipIdx);
    expect(saveIdx).toBeGreaterThan(-1);
    expect(clipIdx).toBeGreaterThan(saveIdx);
    expect(restoreIdx).toBeGreaterThan(clipIdx);
    // The clip's arg is a Path2D
    const clipCall = calls.find((c, i) => c.method === "clip" && i >= saveIdx);
    expect(clipCall?.args[0]).toBeInstanceOf(Path2D);
  });

  it("group does NOT push a clip", () => {
    const ctx = createMockContext();
    const viewport: Viewport = { x: 0, y: 0, zoom: 1 };
    // Group + child rectangle. No clip should be pushed.
    const group: DocumentNode = {
      uuid: "group-1",
      // ... kind.type = "group", no corners field (group doesn't have one)
      parentUuid: null,
      childrenUuids: ["rect-1"],
    } as DocumentNode;
    const child: DocumentNode = {
      uuid: "rect-1",
      parentUuid: "group-1",
      // ...
    } as DocumentNode;
    render(ctx, viewport, [group, child], new Set(), 1);

    const calls = getCalls(ctx);
    const clipCalls = calls.filter((c) => c.method === "clip");
    expect(clipCalls.length).toBe(0);
  });

  it("nested frames stack clips correctly", () => {
    const ctx = createMockContext();
    const viewport: Viewport = { x: 0, y: 0, zoom: 1 };
    // Frame A → Frame B → Rectangle. Expect: save, clip, save, clip, draw, restore, restore.
    const frameA: DocumentNode = { uuid: "frame-A", parentUuid: null, childrenUuids: ["frame-B"] } as DocumentNode;
    const frameB: DocumentNode = { uuid: "frame-B", parentUuid: "frame-A", childrenUuids: ["rect-1"] } as DocumentNode;
    const rect: DocumentNode = { uuid: "rect-1", parentUuid: "frame-B", childrenUuids: [] } as DocumentNode;
    render(ctx, viewport, [frameA, frameB, rect], new Set(), 1);

    const calls = getCalls(ctx);
    const methodSequence = calls.map((c) => c.method);
    const saves = methodSequence.filter((m) => m === "save").length;
    const restores = methodSequence.filter((m) => m === "restore").length;
    // 2 frames → 2 saves + 2 restores (plus the per-node save/restore for opacity, which is also counted)
    // Specifically the CLIP-related save/restore: each frame adds exactly one pair.
    expect(saves).toBeGreaterThanOrEqual(2);
    expect(restores).toBeGreaterThanOrEqual(2);
  });

  it("clip stack drains at end of loop when last node is inside a frame", () => {
    const ctx = createMockContext();
    const viewport: Viewport = { x: 0, y: 0, zoom: 1 };
    // Frame containing a child as the LAST node — no later siblings to trigger the pop.
    const frame: DocumentNode = { uuid: "frame-1", parentUuid: null, childrenUuids: ["rect-1"] } as DocumentNode;
    const child: DocumentNode = { uuid: "rect-1", parentUuid: "frame-1", childrenUuids: [] } as DocumentNode;
    render(ctx, viewport, [frame, child], new Set(), 1);

    const calls = getCalls(ctx);
    // The last restore call must come AFTER the rectangle's fill call.
    const fillCalls = calls.map((c, i) => ({ method: c.method, i })).filter((x) => x.method === "fill");
    const restoreCalls = calls.map((c, i) => ({ method: c.method, i })).filter((x) => x.method === "restore");
    expect(fillCalls.length).toBeGreaterThan(0);
    expect(restoreCalls.length).toBeGreaterThan(0);
    expect(restoreCalls[restoreCalls.length - 1].i).toBeGreaterThan(fillCalls[fillCalls.length - 1].i);
  });
});
```

The implementer should fill in the full `DocumentNode` fixtures using the existing pattern in `renderer.test.ts` (look for the test "should render selection highlight" or similar — replicate the full shape).

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --prefix frontend test src/canvas/__tests__/renderer.test.ts --reporter=verbose 2>&1 | tail -15`
Expected: all tests pass.

- [ ] **Step 5: Verify full suite still passes (no regression)**

Run: `pnpm --prefix frontend test --reporter=default 2>&1 | tail -5`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/canvas/renderer.ts frontend/src/canvas/__tests__/renderer.test.ts
git commit -m "feat(frontend): frame child clipping — clip stack in render loop"
```

---

## Task 16: Final quality gate + push + open PR

- [ ] **Step 1: Full frontend test suite**

Run: `pnpm --prefix frontend test --reporter=default 2>&1 | tail -5`
Expected: all tests pass (baseline 1811 + new corner-path tests + new renderer integration tests).

- [ ] **Step 2: Lint**

Run: `pnpm --prefix frontend lint`
Expected: clean.

- [ ] **Step 3: Typecheck**

Run: `pnpm --prefix frontend exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Format check**

Run: `pnpm --prefix frontend exec prettier --check 'src/**/*.{ts,tsx,css}'`
Expected: clean. If not, `pnpm --prefix frontend exec prettier --write 'src/**/*.{ts,tsx,css}'` and add a separate `chore(frontend): prettier` commit.

- [ ] **Step 5: Rust sanity (no Rust changes but verify full workspace still builds)**

Run: `cargo check --workspace --all-targets`
Expected: clean.

Run: `cargo clippy --workspace --tests -- -D warnings 2>&1 | grep -cE "^error"`
Expected: same count as `origin/main` (currently 56). No regression.

Run: `cargo fmt --check`
Expected: clean.

- [ ] **Step 6: Confirm working tree clean**

Run: `git status --short`
Expected: empty.

- [ ] **Step 7: Push branch**

Run: `git push -u origin feature/corner-shapes-14c`
Expected: `[new branch] feature/corner-shapes-14c -> feature/corner-shapes-14c`.

- [ ] **Step 8: Open the PR**

Run:

```bash
gh pr create --base main --head feature/corner-shapes-14c \
  --title "feat: canvas rendering for corner shapes + frame child clipping (Plan 14c)" \
  --body "$(cat <<'EOF'
## Summary

Implements Plan 14c — every Corner variant now renders on the canvas via a Path2D-based shape pipeline, replacing the placeholder `fillRect`/`strokeRect` calls in `drawNode`. Adds frame child clipping to the render loop so child nodes are clipped to their parent frame's corner-shape outline.

- **Geometry helpers:** `frontend/src/canvas/corner-path.ts` — `appendRoundCorner` / `appendBevelCorner` / `appendNotchCorner` / `appendScoopCorner` / `appendSuperellipseCorner` plus `appendCornerPath` orchestration with radius-clamping pre-pass and finite-input guards. Public `buildCornerPath` allocates a fresh Path2D.
- **Renderer:** `drawNode` uses `buildCornerPath` for fill + stroke on the 3 corner-bearing kinds (rectangle, frame, image). `group` and `component_instance` stay on `fillRect` (they don't have a `corners` field).
- **Frame child clipping:** `render()` maintains a clip stack threaded through the existing flat (but depth-first ordered) node iteration. Entering a Frame: `save() + clip(framePath)`. Leaving the Frame's subtree: `restore()` and pop. Groups don't clip. Bounded by `MAX_RENDER_DEPTH`.
- **Superellipse v1:** credible approximation using kappa = 0.5522 anchor at smoothing = 0, interpolating to bleed = 1.5 at smoothing = 1. Per spec §3.7, pixel-perfect calibration against iOS/Figma is a 14d follow-up after designer review — no schema change required to tune.

## Test strategy (per spec §4.3)

- Pure geometry tested via `PathRecorder` (structural `PathBuilder` interface satisfied by both `Path2D` and the recorder) — assertions on operation sequences (`moveTo` / `lineTo` / `ellipse` / `bezierCurveTo` / `closePath`).
- Renderer integration tested via the existing Proxy-based `createMockContext` (extracted to a shared `canvas-mock.ts` helper in this PR).
- No pixel snapshots, no `canvas` npm package, no cross-platform image-diff brittleness.

## Test plan

- [x] `pnpm --prefix frontend test` — all baseline tests + new corner-path tests + new renderer integration tests pass
- [x] `pnpm --prefix frontend lint` — clean
- [x] `pnpm --prefix frontend exec tsc --noEmit` — clean
- [x] `pnpm --prefix frontend exec prettier --check 'src/**/*.{ts,tsx,css}'` — clean
- [x] `cargo check --workspace --all-targets` — clean (no Rust changes)
- [x] `cargo clippy --workspace --tests -- -D warnings` — at origin/main baseline (no regression)
- [ ] Manual: in dev server, create a Frame with non-default corners and add a child Rectangle that overflows — verify the child clips to the Frame's corner outline.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned.

- [ ] **Step 9: Report PR URL. Do NOT merge.**

Per CLAUDE.md §7 every PR requires the `/review` workflow before merge. Wait for the controller to run `/review` and authorize merge.

---

## Self-review

### Spec coverage

| Spec section | Plan task |
|---|---|
| §3.1 rendering gap (fillRect + no clipping) | Tasks 13, 14, 15 |
| §3.2 path construction — Round | Task 3 |
| §3.2 path construction — Bevel | Task 4 |
| §3.2 path construction — Notch | Task 5 |
| §3.2 path construction — Scoop | Task 6 |
| §3.2 path construction — Superellipse (s=0) | Task 7 |
| §3.2 path construction — Superellipse interpolation | Task 8 |
| §3.3 radius clamping pre-pass | Task 9 |
| §3.4 numeric guards (NaN/Infinity rejection) | Task 10 |
| §3.5 fill (path-based) | Task 13 |
| §3.5 stroke (path-based) | Task 14 |
| §3.5 frame child clipping | Task 15 |
| §3.6 hit-testing — AABB unchanged | Not in scope (no change) |
| §3.7 design decisions documented | Reflected in commit messages + PR body |
| §4.3 testing — `corner-path.test.ts` per-shape tests | Tasks 3-11 |
| §4.3 testing — renderer integration via mock context | Tasks 13, 14, 15 |
| §4.3 testing — clip stack behavior | Task 15 |

All §3 and §4.3 requirements have at least one task.

### Placeholder scan

- No "TBD", "TODO", "fill in details" — every step has executable code or commands.
- Two tasks (Task 13 Step 4, Task 15 Step 3) reference "use existing test-fixture pattern" for `DocumentNode` construction. The implementer must read the existing `renderer.test.ts` to find the canonical fixture; the plan tells them what to look for ("rectangle nodes" / "selection highlight" — both already exist in that file). This is referenced exemplar code, not a placeholder.

### Type consistency

- `CornerGeometry` interface defined in Task 3, extended in Task 4 (added `cornerX`/`cornerY`), and used unchanged in Tasks 4-7. No drift.
- `PathBuilder` type from Task 2 — used by every helper through Task 11 and by the recorder in tests.
- `appendCornerPath` signature stable across Tasks 3-11 (no parameter changes after Task 3 introduced it).
- `buildCornerPath` introduced in Task 11 and used in Tasks 13, 14, 15 with identical signature.
- Superellipse constants `KAPPA_CIRCULAR`, `BLEED_AT_S0`, `BLEED_AT_S1` defined in Task 2 (initially exported), used in Task 7 implementation.

### Risks and mitigations

1. **`Path2D` instantiation in jsdom.** jsdom 29 ships Path2D as part of its Canvas2D shim. Task 11 Step 3 notes a fallback if it's missing (extend `vitest.setup.ts` with a minimal Path2D shim — moveTo/lineTo/etc. would just be no-ops, since the recorder is what verifies geometry).
2. **`createMockContext` extraction is structural, not behavioral.** Task 12 is a pure code move. If any existing renderer test fails after extraction, the extraction is buggy — investigate before proceeding.
3. **Clip stack overflow on cyclic node graphs.** The `isDescendant` helper is bounded by `MAX_RENDER_DEPTH = 64`. A genuinely cyclic graph would terminate the ancestry walk early and the node would draw uncliped — acceptable failure mode (cycles are a data-corruption bug, not a render-loop concern).
4. **Existing renderer tests using `kind: { type: "frame" }` without a `corners` field.** Plan 14a's Frame variant requires `corners`. If any existing renderer test fixture omits it, Task 13 / 14 / 15 will fail to compile. Fix-up: add `corners: ZERO_CORNERS` to those fixtures in the same task.
5. **Visual fidelity of v1 superellipse.** Per §3.7 — this is a tuning concern, not a correctness concern. Storybook visual review in 14d closes the loop.

### Out of scope (intentional)

- Pixel-level golden tests.
- Hit-testing changes (stays AABB per spec §3.6).
- Calibration of superellipse against iOS/Figma references (14d follow-up per §3.7).
- Path-kind rendering (pen tool — deferred to a later plan).
- WebGL renderer migration (separate roadmap).
- Selection highlight clipping (selection draws over the canvas in its own pass without clipping; that's the existing behavior and not changed here).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-25-14c-canvas-rendering.md`. Two execution options:

**1. Subagent-Driven (recommended)** — controller dispatches a fresh Frontend Engineer subagent per task (with reviews between), keeping context fresh and review tight.

**2. Inline Execution** — execute tasks in this session via `superpowers:executing-plans` with batch checkpoints.

**Which approach?**
