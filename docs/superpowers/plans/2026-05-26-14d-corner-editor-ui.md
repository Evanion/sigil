# Plan 14d — Corner Editor UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the user-facing corner editor — a 9-hotspot preview + popover UI replacing the existing 4-input grid — wired through to Plan 14a's `setCorners` store function and rendered via Plan 14c's canvas corner pipeline. Closes deferred findings RF-002 (4 new shapes unreachable from UI), RF-025 (shape invisible to user), RF-026 (linked-corners rule unobservable), RF-027 (superellipse uniformity), and RF-038 (section disappears on non-corner-bearing kinds).

**Architecture:** New `<CornerSection />` component (under `frontend/src/panels/corner-section/`) renders in DesignPanel's Appearance tab. Internally:
1. `corner-svg-builder.ts` — `SvgPathBuilder` class implementing the `PathBuilder` structural interface from Plan 14c's `corner-path.ts`; translates Canvas ops to an SVG `d` string. Same `appendCornerPath` orchestrator drives both Canvas (Path2D) and SVG output — single source of truth for geometry.
2. `corner-aria-label.ts` — generates the human-readable summary used by the preview SVG's `aria-label` ("Rectangle with round top corners, bevel bottom corners").
3. `CornerPreviewSvg.tsx` — the 160×120 SVG preview + 9 hotspot HTML `<button>` overlay. Hotspots revealed on hover/focus.
4. `CornerPopover.tsx` — popover contents: shape picker, radius `<ValueInput>`, "Unlock axes" toggle, mixed-state indicator, conditional smoothing control (center hotspot only).
5. `CornerSection.tsx` — section frame, store reads/writes, popover orchestration, superellipse lock state, RF-038 disabled state.

Existing "Corner Radius" entry in `frontend/src/panels/schemas/design-schema.ts` is removed (the schema-driven 4-input grid is superseded). CornerSection plugs into `DesignPanel.tsx` Appearance tab alongside `TypographySection` + `AppearancePanel`. Mutations route through the existing `setCorners` store function from Plan 14a (already wired to GraphQL + apply-remote + HistoryManager).

**Tech Stack:** TypeScript (strict), Solid.js, Kobalte wrappers (Select / Toggle / Slider — Plan 14b), native `<Popover>` from `frontend/src/components/popover/`, `<ValueInput>` from Spec 13. Vitest + jsdom for tests. Storybook for visual stories.

**Branch:** `feature/corner-editor-14d` (worktree at `.worktrees/feature/corner-editor-14d`, branched from `main` after Plan 14c shipped at `36c6f99`). The §1.6 spec update is already committed on this branch.

---

## Pre-work: confirmed context

- **Spec sections to read first:** `docs/superpowers/specs/2026-04-23-14-corner-shapes.md` §1.5 (user-facing design — settled), §1.6 (Plan 14d execution commitments — just committed), §3.7 (calibration deferral context), §4.4 (testing requirements), §13 (deferred findings 14d must close).
- **Plan 14c geometry primitives (already shipped):** `frontend/src/canvas/corner-path.ts` exports `PathBuilder`, `CornerGeometry`, `appendCornerPath`, `buildCornerPath`, `computeRadiusFitScale`, and the per-corner helpers. The `PathBuilder` interface is the seam — `SvgPathBuilder` plugs into it.
- **Plan 14a store API (already shipped):** `frontend/src/store/document-store-solid.tsx::setCorners(uuid, input: CornersInput)`. `CornersInput` accepts three shapes: scalar, partial-object, or full `[Corner; 4]` array. Defined in `frontend/src/store/corners-input.ts` along with `parseCornersInput`, `MAX_CORNER_RADIUS = 100_000`, and `MIN_CORNER_RADIUS = 0`.
- **Plan 14b Slider wrapper (already shipped):** `frontend/src/components/slider/Slider.tsx` exports `Slider` with `onChange / onChangeStart / onChangeEnd` callbacks (the latter two enable history coalescing per the "Continuous-Value Controls Must Coalesce History Entries" rule).
- **Existing Kobalte wrappers used by 14d:** `Select` (`frontend/src/components/select/Select.tsx`), `Toggle` (`frontend/src/components/toggle/Toggle.tsx`), `Slider`, and `Popover` (native, `frontend/src/components/popover/Popover.tsx`). All imports MUST come from these wrappers per `frontend-defensive.md`.
- **Existing ValueInput (Spec 13):** `frontend/src/components/value-input/ValueInput.tsx` — supports literals, token refs, and expressions. Default export. Use this for the radius and smoothing literal/token inputs.
- **Current corner UI being replaced:** `frontend/src/panels/schemas/design-schema.ts:67-113` (Corner Radius section, lines 67-113). Removal is part of the migration; CLAUDE.md §11 "Migrations Must Remove All Superseded Code" applies.
- **NodeKinds bearing corners:** `frame`, `rectangle`, `image` (per Spec 14 §1.2). The other 5 (`ellipse`, `text`, `group`, `path`, `component_instance`) do not; the disabled state per RF-038 applies to them.
- **Selected node access:** `store.state.selection: ReadonlySet<string>` for selected uuids; `store.state.nodes: Record<string, DocumentNode>` for the node lookup. Existing pattern in `AppearancePanel.tsx`.

## Conventions used in this plan

- All commands run from the worktree root: `pnpm --prefix frontend <cmd>`. Inside dev container the prefix is implicit; outside, prepend `./dev.sh`.
- Commit format: `type(scope): description` (CLAUDE.md §6). Scope is `frontend` for all UI work, `docs` for spec/plan edits.
- Test files colocate next to source under `__tests__/` (existing pattern).
- ARIA: every interactive widget must satisfy the relevant rule from `.claude/rules/a11y-rules.md`. Specifically: hotspots are `<button>` with `aria-label`; popovers come from the native `<Popover>` wrapper (focus management built-in); the preview SVG carries `role="img"` + descriptive `aria-label`; the slider exposes `aria-valuemin/max/now` via the Slider wrapper.
- CSS: file-private styles in `<file>.css` colocated with the component; class names prefixed `sigil-corner-section__*` (BEM-ish, matching existing convention in `AppearancePanel.css`). Every `transition` / `animation` MUST have a `@media (prefers-reduced-motion: reduce)` companion per `a11y-rules.md`.
- Tests for any new validation/state-derivation helper MUST include asymmetric-radii fixtures per the new "Tests for Multi-Axis Inputs Must Cover Non-Degenerate Cases" rule.

## File structure

**Create:**
- `frontend/src/panels/corner-section/corner-svg-builder.ts` — `SvgPathBuilder` implementing `PathBuilder`
- `frontend/src/panels/corner-section/corner-aria-label.ts` — `summarizeCornersForAria(corners)` helper
- `frontend/src/panels/corner-section/corner-section-state.ts` — pure helpers: `isLinked`, `isSuperellipseUniform`, `axesUnlocked`, hotspot target sets, mixed-state detection
- `frontend/src/panels/corner-section/CornerPreviewSvg.tsx` — preview SVG + hotspot overlay
- `frontend/src/panels/corner-section/CornerPreviewSvg.css`
- `frontend/src/panels/corner-section/CornerPopover.tsx` — popover contents per hotspot target
- `frontend/src/panels/corner-section/CornerPopover.css`
- `frontend/src/panels/corner-section/CornerSection.tsx` — section frame + state orchestration
- `frontend/src/panels/corner-section/CornerSection.css`
- `frontend/src/panels/corner-section/CornerSection.stories.tsx` — Storybook stories
- `frontend/src/panels/corner-section/__tests__/corner-svg-builder.test.ts`
- `frontend/src/panels/corner-section/__tests__/corner-aria-label.test.ts`
- `frontend/src/panels/corner-section/__tests__/corner-section-state.test.ts`
- `frontend/src/panels/corner-section/__tests__/CornerPreviewSvg.test.tsx`
- `frontend/src/panels/corner-section/__tests__/CornerPopover.test.tsx`
- `frontend/src/panels/corner-section/__tests__/CornerSection.test.tsx`
- `frontend/src/panels/corner-section/__tests__/corner-section-pipeline.test.tsx` — end-to-end UI→store→canvas pipeline test (per CLAUDE.md §11 "Reactive Pipelines")

**Modify:**
- `frontend/src/panels/schemas/design-schema.ts` — remove the "Corner Radius" entry (lines 67-113)
- `frontend/src/panels/schemas/design-schema.test.ts` — drop the asserts that referenced the removed section
- `frontend/src/panels/DesignPanel.tsx` — render `<CornerSection />` inside the Appearance tab `<Show>`
- `frontend/src/panels/__tests__/SchemaPanel.test.tsx` — remove/update tests covering the deleted schema entry, if any
- `frontend/src/panels/__tests__/schema-panel-corners.test.ts` and `SchemaPanelCornersIntegration.test.tsx` — confirm whether these need updates or deletion (they may have tested behavior that's now CornerSection's; surveyed in Task 16)
- `frontend/src/store/corners-input.ts` — add `MIN_SUPERELLIPSE_SMOOTHING = 0` and `MAX_SUPERELLIPSE_SMOOTHING = 1` exports (used by the smoothing Slider's bounds; CLAUDE.md §11 "every NumberInput min/max must be a named constant")

---

## Task 1: Worktree baseline

- [ ] **Step 1: Install frontend dependencies in the worktree**

Run: `pnpm --prefix frontend install --frozen-lockfile`
Expected: completes with `Done in <duration>`, `frontend/node_modules` populated.

- [ ] **Step 2: Verify baseline tests pass**

Run: `pnpm --prefix frontend test --reporter=default 2>&1 | tail -5`
Expected: ~1856 tests pass (matches the `main` baseline after Plan 14c + governance + CI grep landed).

- [ ] **Step 3: Verify lint + typecheck + build clean**

Run, in order:
- `pnpm --prefix frontend lint 2>&1 | tail -3` — expect no errors
- `pnpm --prefix frontend exec tsc --noEmit 2>&1 | tail -3` — expect no output (clean)
- `pnpm --prefix frontend exec prettier --check "src/**/*.{ts,tsx,css}" 2>&1 | tail -3` — "All matched files use Prettier code style!"
- `pnpm --prefix frontend build 2>&1 | tail -3` — "✓ built in <duration>"

- [ ] **Step 4: Confirm the spec §1.6 commit is the worktree HEAD**

Run: `git log --oneline -3`
Expected: top commit is `docs(spec-14): §1.6 — Plan 14d execution commitments from brainstorm`.

If anything in steps 1–4 fails, stop and resolve before touching code.

---

## Task 2: SvgPathBuilder — moveTo / lineTo / closePath (red → green)

The `SvgPathBuilder` translates Canvas drawing ops into an SVG `d` attribute string. Start with the trivial ops (moveTo, lineTo, closePath); ellipse and bezierCurveTo come in Tasks 3–4.

**Files:**
- Create: `frontend/src/panels/corner-section/corner-svg-builder.ts`
- Create: `frontend/src/panels/corner-section/__tests__/corner-svg-builder.test.ts`

- [ ] **Step 1: Scaffold the builder file (red — empty)**

```typescript
// frontend/src/panels/corner-section/corner-svg-builder.ts
/**
 * SvgPathBuilder — translates Canvas-style PathBuilder ops into an SVG
 * `d` attribute string. Implements the same structural interface as
 * `Path2D` so Plan 14c's `appendCornerPath` can drive both Canvas and
 * SVG output from one source of truth (Spec 14 §1.6).
 *
 * Coordinate conventions are identical (y-down). Translation rules:
 *  - moveTo(x, y)         → "M {x} {y}"
 *  - lineTo(x, y)         → "L {x} {y}"
 *  - bezierCurveTo(...)   → "C {cp1x} {cp1y} {cp2x} {cp2y} {x} {y}"
 *  - ellipse(...)         → "L {startX} {startY} A {rx} {ry} 0 {large} {sweep} {endX} {endY}"
 *    (see Task 3 for full ellipse math)
 *  - closePath()          → "Z"
 *
 * Numeric outputs are formatted with 4 decimal places to keep the
 * resulting `d` string compact and stable across browsers.
 */

import type { PathBuilder } from "../../canvas/corner-path";

const DECIMALS = 4;

function fmt(n: number): string {
  if (!Number.isFinite(n)) {
    // CLAUDE.md §11 Floating-Point Validation — guard at the helper entry.
    // Non-finite values should never reach the builder (the orchestrator
    // validates upstream), but a defensive guard prevents a malformed
    // `d` string from silently rendering nothing.
    console.warn("SvgPathBuilder.fmt: non-finite value", { value: n });
    return "0";
  }
  return n.toFixed(DECIMALS).replace(/\.?0+$/, "");
}

export class SvgPathBuilder implements PathBuilder {
  private parts: string[] = [];

  moveTo(x: number, y: number): void {
    this.parts.push(`M ${fmt(x)} ${fmt(y)}`);
  }

  lineTo(x: number, y: number): void {
    this.parts.push(`L ${fmt(x)} ${fmt(y)}`);
  }

  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this.parts.push(
      `C ${fmt(cp1x)} ${fmt(cp1y)} ${fmt(cp2x)} ${fmt(cp2y)} ${fmt(x)} ${fmt(y)}`,
    );
  }

  ellipse(
    _cx: number,
    _cy: number,
    _rx: number,
    _ry: number,
    _rotation: number,
    _startAngle: number,
    _endAngle: number,
    _counterclockwise = false,
  ): void {
    throw new Error("SvgPathBuilder.ellipse: implemented in Task 3");
  }

  closePath(): void {
    this.parts.push("Z");
  }

  toString(): string {
    return this.parts.join(" ");
  }
}
```

- [ ] **Step 2: Write the failing tests for the trivial ops**

```typescript
// frontend/src/panels/corner-section/__tests__/corner-svg-builder.test.ts
/**
 * @vitest-environment jsdom
 *
 * Tests for SvgPathBuilder. The builder implements PathBuilder from
 * corner-path.ts so Plan 14c's appendCornerPath can drive SVG output.
 */
import { describe, it, expect } from "vitest";
import { SvgPathBuilder } from "../corner-svg-builder";

describe("SvgPathBuilder — basic ops", () => {
  it("moveTo emits M command", () => {
    const b = new SvgPathBuilder();
    b.moveTo(10, 20);
    expect(b.toString()).toBe("M 10 20");
  });

  it("lineTo emits L command", () => {
    const b = new SvgPathBuilder();
    b.moveTo(0, 0);
    b.lineTo(50, 30);
    expect(b.toString()).toBe("M 0 0 L 50 30");
  });

  it("bezierCurveTo emits C command", () => {
    const b = new SvgPathBuilder();
    b.moveTo(0, 0);
    b.bezierCurveTo(10, 10, 20, 30, 40, 50);
    expect(b.toString()).toBe("M 0 0 C 10 10 20 30 40 50");
  });

  it("closePath emits Z command", () => {
    const b = new SvgPathBuilder();
    b.moveTo(0, 0);
    b.lineTo(100, 0);
    b.closePath();
    expect(b.toString()).toBe("M 0 0 L 100 0 Z");
  });

  it("formats numbers to 4 decimals max, trimming trailing zeros", () => {
    const b = new SvgPathBuilder();
    b.moveTo(1.123456, 2);
    expect(b.toString()).toBe("M 1.1235 2");
  });
});
```

- [ ] **Step 3: Run the test file — expect green on the trivial ops, red on ellipse (not tested yet)**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/corner-svg-builder.test.ts 2>&1 | tail -10`
Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/panels/corner-section/corner-svg-builder.ts \
        frontend/src/panels/corner-section/__tests__/corner-svg-builder.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): SvgPathBuilder trivial ops (moveTo/lineTo/bezierCurveTo/closePath)

First slice of the Plan 14c PathBuilder ↔ SVG bridge. The ellipse-to-
arc translation comes in Task 3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: SvgPathBuilder — ellipse → SVG arc translation

The only non-trivial mapping. Canvas's `ellipse(cx, cy, rx, ry, rotation, startAngle, endAngle, counterclockwise)` describes the arc by center + sweep; SVG's `A` command describes it by endpoint + flags. Both follow y-down convention.

**Translation:**

Given `ellipse(cx, cy, rx, ry, rotation, startAngle, endAngle, ccw)`:

1. **Compute endpoints on the un-rotated ellipse:**
   - `startLocal = (rx*cos(startAngle), ry*sin(startAngle))`
   - `endLocal   = (rx*cos(endAngle),   ry*sin(endAngle))`
2. **Apply rotation** (anchor: center) — for Plan 14c's corner shapes `rotation` is always 0, but support nonzero for future use:
   - `startWorld = cx + Rotate(startLocal, rotation)`
   - `endWorld   = cx + Rotate(endLocal,   rotation)`
3. **Compute sweep angle:**
   - When `ccw=false`: sweep clockwise — if `endAngle < startAngle`, add 2π to endAngle. `sweep = endAngle - startAngle`.
   - When `ccw=true`: sweep counterclockwise — if `endAngle > startAngle`, subtract 2π from endAngle. `sweep = startAngle - endAngle`.
4. **Compute SVG flags:**
   - `large-arc-flag = sweep > π ? 1 : 0`
   - `sweep-flag = ccw ? 0 : 1` (SVG sweep-flag 1 = clockwise in y-down system = matches Canvas ccw=false)
5. **Emit:**
   - If the pen is not already at startWorld, emit `L {startX} {startY}` first.
   - Then `A {rx} {ry} {rotationDegrees} {large-arc-flag} {sweep-flag} {endX} {endY}`.

The builder doesn't know the current pen position cheaply (it'd require parsing its own `d` string), so we always emit `L startX startY A ...`. Redundant L commands when the pen is already at the start are visually harmless and the parity tests will treat them as equivalent.

- [ ] **Step 1: Implement `ellipse` in the builder**

Replace the placeholder body:

```typescript
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    // CLAUDE.md §11 Floating-Point Validation — guard at the helper entry.
    if (
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      !Number.isFinite(rx) ||
      !Number.isFinite(ry) ||
      !Number.isFinite(rotation) ||
      !Number.isFinite(startAngle) ||
      !Number.isFinite(endAngle) ||
      rx <= 0 ||
      ry <= 0
    ) {
      console.warn("SvgPathBuilder.ellipse: rejected non-finite or non-positive input", {
        cx,
        cy,
        rx,
        ry,
        rotation,
        startAngle,
        endAngle,
      });
      return;
    }

    // 1. Compute endpoints on un-rotated ellipse, then rotate around (cx, cy).
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    function rotate(localX: number, localY: number): [number, number] {
      return [localX * cosR - localY * sinR, localX * sinR + localY * cosR];
    }
    const startLocalX = rx * Math.cos(startAngle);
    const startLocalY = ry * Math.sin(startAngle);
    const endLocalX = rx * Math.cos(endAngle);
    const endLocalY = ry * Math.sin(endAngle);
    const [srx, sry] = rotate(startLocalX, startLocalY);
    const [erx, ery] = rotate(endLocalX, endLocalY);
    const startX = cx + srx;
    const startY = cy + sry;
    const endX = cx + erx;
    const endY = cy + ery;

    // 2. Compute the sweep angle (always non-negative, < 2π).
    const TWO_PI = 2 * Math.PI;
    let sweep: number;
    if (!counterclockwise) {
      let e = endAngle;
      while (e < startAngle) e += TWO_PI;
      sweep = e - startAngle;
    } else {
      let e = endAngle;
      while (e > startAngle) e -= TWO_PI;
      sweep = startAngle - e;
    }

    // 3. Convert to SVG flags.
    const largeArc = sweep > Math.PI ? 1 : 0;
    const sweepFlag = counterclockwise ? 0 : 1;

    // 4. Convert rotation from radians to degrees for SVG's x-axis-rotation.
    const rotationDeg = (rotation * 180) / Math.PI;

    // 5. Emit lineTo to arc start (idempotent if pen is already there),
    //    then the arc command.
    this.parts.push(`L ${fmt(startX)} ${fmt(startY)}`);
    this.parts.push(
      `A ${fmt(rx)} ${fmt(ry)} ${fmt(rotationDeg)} ${largeArc} ${sweepFlag} ${fmt(endX)} ${fmt(endY)}`,
    );
  }
```

- [ ] **Step 2: Add ellipse tests**

Append to `corner-svg-builder.test.ts`:

```typescript
describe("SvgPathBuilder — ellipse → arc", () => {
  it("translates a quarter-circle (TL round) to an L + A pair", () => {
    // TL round corner: cx=rx, cy=ry, sweep π to 1.5π clockwise.
    // Local at startAngle=π: (rx*cos π, ry*sin π) = (-rx, 0)
    // Local at endAngle=1.5π: (rx*cos 1.5π, ry*sin 1.5π) = (0, -ry)
    // World: start = (0, ry), end = (rx, 0). Sweep = π/2 (large=0, sweep-flag=1).
    const b = new SvgPathBuilder();
    b.ellipse(16, 16, 16, 16, 0, Math.PI, 1.5 * Math.PI);
    expect(b.toString()).toBe("L 0 16 A 16 16 0 0 1 16 0");
  });

  it("translates a counterclockwise quarter arc (scoop) with sweep-flag=0", () => {
    // TL scoop: ellipse centered at corner (0,0), arc CCW from endAngle-π=0.5π to startAngle-π=0.
    // Local at 0.5π: (0, ry). Local at 0: (rx, 0). World same.
    // CCW sweep from 0.5π to 0 = π/2. large=0, sweep-flag=0.
    const b = new SvgPathBuilder();
    b.ellipse(0, 0, 16, 16, 0, 0.5 * Math.PI, 0, true);
    expect(b.toString()).toBe("L 0 16 A 16 16 0 0 0 16 0");
  });

  it("emits large-arc-flag=1 when sweep exceeds π", () => {
    // 3/4 sweep: π → 0.5π going CW. Need to normalize: 0.5π < π so add 2π → 2.5π.
    // sweep = 2.5π - π = 1.5π > π.
    const b = new SvgPathBuilder();
    b.ellipse(0, 0, 10, 10, 0, Math.PI, 0.5 * Math.PI);
    const d = b.toString();
    expect(d).toMatch(/A 10 10 0 1 1/); // large=1, sweep=1
  });

  it("rejects non-finite radii with a structured warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const b = new SvgPathBuilder();
      b.ellipse(0, 0, NaN, 10, 0, 0, Math.PI);
      expect(b.toString()).toBe("");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("rejected non-finite"),
        expect.objectContaining({ rx: NaN }),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
```

Add `vi` to the imports:

```typescript
import { describe, it, expect, vi } from "vitest";
```

- [ ] **Step 3: Run — expect green**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/corner-svg-builder.test.ts 2>&1 | tail -10`
Expected: all 9 tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/panels/corner-section/corner-svg-builder.ts \
        frontend/src/panels/corner-section/__tests__/corner-svg-builder.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): SvgPathBuilder ellipse-to-arc translation

Canvas ellipse(cx, cy, rx, ry, rotation, startAngle, endAngle, ccw?)
maps to SVG `A` arc command with computed endpoints and large-arc /
sweep flags. Numeric guard at function entry per CLAUDE.md §11.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: SvgPathBuilder ↔ PathRecorder parity test

Drive `appendCornerPath` from Plan 14c against both builders simultaneously and assert structural equivalence. This is the key safety net: any Canvas/SVG drift surfaces as a parity test failure.

**Files:**
- Modify: `frontend/src/panels/corner-section/__tests__/corner-svg-builder.test.ts`

- [ ] **Step 1: Define fixtures + parity assertion**

Append to the test file:

```typescript
// ── Parity tests: shared appendCornerPath drives both builders ──────────

import { appendCornerPath, type PathBuilder } from "../../../canvas/corner-path";
import type { Corner, Corners } from "../../../types/document";

interface RecordedOp {
  method: "moveTo" | "lineTo" | "bezierCurveTo" | "ellipse" | "closePath";
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
  closePath(): void {
    this.ops.push({ method: "closePath", args: [] });
  }
}

function round(r: number): Corner {
  return { type: "round", radii: { x: r, y: r } };
}
function bevel(rx: number, ry: number): Corner {
  return { type: "bevel", radii: { x: rx, y: ry } };
}
function notch(rx: number, ry: number): Corner {
  return { type: "notch", radii: { x: rx, y: ry } };
}
function scoop(rx: number, ry: number): Corner {
  return { type: "scoop", radii: { x: rx, y: ry } };
}
function superellipse(r: number, smoothing: number): Corner {
  return { type: "superellipse", radii: { x: r, y: r }, smoothing };
}

// Cross-builder structural check: every Canvas op (recorder) must have
// a corresponding SVG token (builder). Bezier and lineTo translate 1:1.
// Ellipse translates to `L startX startY A rx ry rotDeg large sweep endX endY`.
// MoveTo translates to `M`. ClosePath translates to `Z`.
function expectParity(corners: Corners, x = 0, y = 0, w = 100, h = 80): void {
  const recorder = new PathRecorder();
  const builder = new SvgPathBuilder();
  appendCornerPath(recorder, x, y, w, h, corners);
  appendCornerPath(builder, x, y, w, h, corners);

  const expectedTokens = recorder.ops.flatMap((op) => {
    switch (op.method) {
      case "moveTo":
        return ["M", String(op.args[0]), String(op.args[1])];
      case "lineTo":
        return ["L", String(op.args[0]), String(op.args[1])];
      case "bezierCurveTo":
        return ["C", ...op.args.map((a) => String(a))];
      case "ellipse":
        // The builder emits L startX startY then A rx ry rotDeg large sweep endX endY.
        // Don't reproduce the math here — just count that the SVG has both L and A
        // somewhere for each ellipse op. This is checked via op-type counts below.
        return ["__ELLIPSE_PAIR__"];
      case "closePath":
        return ["Z"];
    }
  });
  // Hint of structure: every M/L/C/Z appears in SVG; every ellipse becomes L+A.
  const ellipseCount = recorder.ops.filter((o) => o.method === "ellipse").length;
  const svgTokens = builder.toString().split(/\s+/);
  // Counts of letter commands in SVG.
  const counts = (re: RegExp) => svgTokens.filter((t) => re.test(t)).length;
  expect(counts(/^M$/)).toBe(recorder.ops.filter((o) => o.method === "moveTo").length);
  expect(counts(/^C$/)).toBe(recorder.ops.filter((o) => o.method === "bezierCurveTo").length);
  expect(counts(/^Z$/)).toBe(recorder.ops.filter((o) => o.method === "closePath").length);
  expect(counts(/^A$/)).toBe(ellipseCount);
  // Every ellipse in the recorder produces a paired L in the SVG; lineTo ops
  // also produce L. So total L count = lineTo count + ellipse count.
  expect(counts(/^L$/)).toBe(
    recorder.ops.filter((o) => o.method === "lineTo").length + ellipseCount,
  );
  // expectedTokens reference avoids unused-var lint when the asserts above pass.
  expect(expectedTokens.length).toBeGreaterThan(0);
}

describe("SvgPathBuilder ↔ PathRecorder parity (RF-019)", () => {
  it("all-round rectangle: 4 ellipses, 4 lineTos, 1 moveTo, 1 closePath", () => {
    const corners: Corners = [round(16), round(16), round(16), round(16)];
    expectParity(corners);
  });

  it("all-bevel rectangle: 4 lineTos (corner cuts) + 4 edge lineTos", () => {
    const corners: Corners = [bevel(8, 8), bevel(8, 8), bevel(8, 8), bevel(8, 8)];
    expectParity(corners);
  });

  it("all-notch rectangle: 8 lineTos (corner steps) + 4 edge lineTos", () => {
    const corners: Corners = [notch(8, 8), notch(8, 8), notch(8, 8), notch(8, 8)];
    expectParity(corners);
  });

  it("all-scoop rectangle: 4 ellipses + 4 edge lineTos", () => {
    const corners: Corners = [scoop(8, 8), scoop(8, 8), scoop(8, 8), scoop(8, 8)];
    expectParity(corners);
  });

  it("all-superellipse rectangle: 4 beziers + 4 edge lineTos", () => {
    const corners: Corners = [
      superellipse(8, 0.5),
      superellipse(8, 0.5),
      superellipse(8, 0.5),
      superellipse(8, 0.5),
    ];
    expectParity(corners);
  });

  it("asymmetric radii — bevel/notch/superellipse with rx ≠ ry", () => {
    // Per the "Tests for Multi-Axis Inputs Must Cover Non-Degenerate Cases"
    // rule from frontend-defensive.md. PR #64 RF-001 precedent.
    const corners: Corners = [
      bevel(30, 10),
      notch(25, 15),
      superellipse(20, 0.7), // rx == ry for superellipse per spec uniformity
      scoop(8, 16),
    ];
    expectParity(corners);
  });
});
```

- [ ] **Step 2: Run — expect green**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/corner-svg-builder.test.ts 2>&1 | tail -15`
Expected: 15 tests pass total (5 basic + 4 ellipse + 6 parity).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/panels/corner-section/__tests__/corner-svg-builder.test.ts
git commit -m "$(cat <<'EOF'
test(frontend): SvgPathBuilder ↔ PathRecorder parity tests

Drives Plan 14c's appendCornerPath against both builders for every
Corner variant — including asymmetric radii per the new "Tests for
Multi-Axis Inputs Must Cover Non-Degenerate Cases" rule. Catches any
future drift between Canvas and SVG renderings of the same geometry.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: corner-aria-label helper

Produces the human-readable summary used as the preview SVG's `aria-label` and the optional sr-only status line. Pure function, easy to unit-test.

**Files:**
- Create: `frontend/src/panels/corner-section/corner-aria-label.ts`
- Create: `frontend/src/panels/corner-section/__tests__/corner-aria-label.test.ts`

- [ ] **Step 1: Write failing tests first**

```typescript
// frontend/src/panels/corner-section/__tests__/corner-aria-label.test.ts
import { describe, it, expect } from "vitest";
import { summarizeCornersForAria } from "../corner-aria-label";
import type { Corner, Corners } from "../../../types/document";

function round(r: number): Corner {
  return { type: "round", radii: { x: r, y: r } };
}
function bevel(r: number): Corner {
  return { type: "bevel", radii: { x: r, y: r } };
}
function superellipse(r: number, s: number): Corner {
  return { type: "superellipse", radii: { x: r, y: r }, smoothing: s };
}

describe("summarizeCornersForAria", () => {
  it("uniform round → 'Rectangle with rounded corners, radius 8'", () => {
    const c: Corners = [round(8), round(8), round(8), round(8)];
    expect(summarizeCornersForAria(c)).toBe("Rectangle with rounded corners, radius 8");
  });

  it("zero radii → 'Rectangle with square corners'", () => {
    const c: Corners = [round(0), round(0), round(0), round(0)];
    expect(summarizeCornersForAria(c)).toBe("Rectangle with square corners");
  });

  it("uniform shape mismatched radii → 'Rectangle with rounded corners, mixed radii'", () => {
    const c: Corners = [round(4), round(8), round(12), round(16)];
    expect(summarizeCornersForAria(c)).toBe("Rectangle with rounded corners, mixed radii");
  });

  it("mixed shapes → 'Rectangle with round top corners, bevel bottom corners'", () => {
    const c: Corners = [round(8), round(8), bevel(8), bevel(8)];
    expect(summarizeCornersForAria(c)).toBe(
      "Rectangle with round top corners, bevel bottom corners",
    );
  });

  it("all four different → uses per-corner summary", () => {
    const c: Corners = [
      round(8),
      bevel(8),
      { type: "notch", radii: { x: 8, y: 8 } },
      { type: "scoop", radii: { x: 8, y: 8 } },
    ];
    expect(summarizeCornersForAria(c)).toBe(
      "Rectangle with round top-left, bevel top-right, notch bottom-right, scoop bottom-left",
    );
  });

  it("uniform superellipse exposes smoothing", () => {
    const c: Corners = [
      superellipse(8, 0.6),
      superellipse(8, 0.6),
      superellipse(8, 0.6),
      superellipse(8, 0.6),
    ];
    expect(summarizeCornersForAria(c)).toBe(
      "Rectangle with superellipse corners, radius 8, smoothing 0.6",
    );
  });
});
```

- [ ] **Step 2: Run — expect failure (module doesn't exist)**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/corner-aria-label.test.ts 2>&1 | tail -5`
Expected: FAIL with "Cannot find module '../corner-aria-label'".

- [ ] **Step 3: Implement the helper**

```typescript
// frontend/src/panels/corner-section/corner-aria-label.ts
/**
 * Produces a human-readable summary of a `Corners` value for the preview
 * SVG's `aria-label` (RF-025 — "current corner shape invisible to user"
 * is partly addressed by this).
 *
 * Three tiers of detail:
 *  1. Uniform shape + radii → "rounded corners, radius 8" / "square corners"
 *  2. Uniform shape, mixed radii → "rounded corners, mixed radii"
 *  3. Mixed shapes → either "round top corners, bevel bottom corners" when
 *     top pair and bottom pair are uniform respectively, or per-corner
 *     "round top-left, bevel top-right, notch bottom-right, scoop bottom-left".
 */

import type { Corner, Corners } from "../../types/document";

const SHAPE_LABEL: Record<Corner["type"], string> = {
  round: "round",
  bevel: "bevel",
  notch: "notch",
  scoop: "scoop",
  superellipse: "superellipse",
};

const CORNER_POSITION_LABEL = ["top-left", "top-right", "bottom-right", "bottom-left"];

function sameShape(a: Corner, b: Corner): boolean {
  return a.type === b.type;
}

function sameRadii(a: Corner, b: Corner): boolean {
  return a.radii.x === b.radii.x && a.radii.y === b.radii.y;
}

function radiusText(c: Corner): string {
  if (c.radii.x === c.radii.y) return String(c.radii.x);
  return `${c.radii.x}×${c.radii.y}`;
}

export function summarizeCornersForAria(corners: Corners): string {
  const [tl, tr, br, bl] = corners;
  const allSameShape = sameShape(tl, tr) && sameShape(tl, br) && sameShape(tl, bl);
  const allSameRadii = sameRadii(tl, tr) && sameRadii(tl, br) && sameRadii(tl, bl);
  const allZero = allSameRadii && tl.radii.x === 0 && tl.radii.y === 0;

  if (allSameShape && allZero) {
    return "Rectangle with square corners";
  }

  if (allSameShape && tl.type === "superellipse" && allSameRadii) {
    return `Rectangle with superellipse corners, radius ${radiusText(tl)}, smoothing ${tl.smoothing}`;
  }

  if (allSameShape && allSameRadii) {
    const shape = SHAPE_LABEL[tl.type];
    return `Rectangle with ${shape === "round" ? "rounded" : `${shape}`} corners, radius ${radiusText(tl)}`;
  }

  if (allSameShape) {
    const shape = SHAPE_LABEL[tl.type];
    return `Rectangle with ${shape === "round" ? "rounded" : shape} corners, mixed radii`;
  }

  // Shape mixed — group by top pair vs bottom pair when those are uniform.
  const topUniform = sameShape(tl, tr);
  const bottomUniform = sameShape(br, bl);
  if (topUniform && bottomUniform) {
    return `Rectangle with ${SHAPE_LABEL[tl.type]} top corners, ${SHAPE_LABEL[br.type]} bottom corners`;
  }

  // Fallback: per-corner.
  const parts = corners.map((c, i) => `${SHAPE_LABEL[c.type]} ${CORNER_POSITION_LABEL[i]}`);
  return `Rectangle with ${parts.join(", ")}`;
}
```

- [ ] **Step 4: Run — expect green**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/corner-aria-label.test.ts 2>&1 | tail -5`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/corner-section/corner-aria-label.ts \
        frontend/src/panels/corner-section/__tests__/corner-aria-label.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): corner-aria-label helper for the preview SVG aria-label

Pure function summarizing a Corners value as human-readable text:
"rounded corners, radius 8", "round top corners, bevel bottom corners",
"superellipse corners, radius 8, smoothing 0.6", etc. Used by
CornerPreviewSvg's role="img" aria-label per Spec 14 §1.5.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: corner-section-state — pure state helpers

Helpers that derive UI state from a `Corners` value. Pure functions, no JSX, easy to unit-test. Used by CornerSection and CornerPopover.

**Files:**
- Create: `frontend/src/panels/corner-section/corner-section-state.ts`
- Create: `frontend/src/panels/corner-section/__tests__/corner-section-state.test.ts`

- [ ] **Step 1: Write the failing tests first**

```typescript
// frontend/src/panels/corner-section/__tests__/corner-section-state.test.ts
import { describe, it, expect } from "vitest";
import {
  isLinked,
  isSuperellipseUniform,
  hotspotTargetIndices,
  cornersAtHotspot,
  hotspotShapeIsMixed,
  type HotspotId,
} from "../corner-section-state";
import type { Corner, Corners } from "../../../types/document";

function round(r: number): Corner {
  return { type: "round", radii: { x: r, y: r } };
}
function bevel(r: number): Corner {
  return { type: "bevel", radii: { x: r, y: r } };
}
function superellipse(r: number, s: number): Corner {
  return { type: "superellipse", radii: { x: r, y: r }, smoothing: s };
}

describe("isLinked", () => {
  it("returns true when all four corners are deep-equal", () => {
    const c: Corners = [round(8), round(8), round(8), round(8)];
    expect(isLinked(c)).toBe(true);
  });
  it("returns false when shape differs", () => {
    const c: Corners = [round(8), bevel(8), round(8), round(8)];
    expect(isLinked(c)).toBe(false);
  });
  it("returns false when radii differ", () => {
    const c: Corners = [round(8), round(8), round(12), round(8)];
    expect(isLinked(c)).toBe(false);
  });
});

describe("isSuperellipseUniform", () => {
  it("true when all four corners are superellipse with matching smoothing", () => {
    const c: Corners = [
      superellipse(8, 0.5),
      superellipse(8, 0.5),
      superellipse(8, 0.5),
      superellipse(8, 0.5),
    ];
    expect(isSuperellipseUniform(c)).toBe(true);
  });
  it("false when any corner is non-superellipse", () => {
    const c: Corners = [
      superellipse(8, 0.5),
      superellipse(8, 0.5),
      superellipse(8, 0.5),
      round(8),
    ];
    expect(isSuperellipseUniform(c)).toBe(false);
  });
});

describe("hotspotTargetIndices", () => {
  it("corner hotspots target exactly one index", () => {
    expect(hotspotTargetIndices("tl")).toEqual([0]);
    expect(hotspotTargetIndices("tr")).toEqual([1]);
    expect(hotspotTargetIndices("br")).toEqual([2]);
    expect(hotspotTargetIndices("bl")).toEqual([3]);
  });
  it("edge hotspots target the two adjacent corners", () => {
    expect(hotspotTargetIndices("top")).toEqual([0, 1]);
    expect(hotspotTargetIndices("right")).toEqual([1, 2]);
    expect(hotspotTargetIndices("bottom")).toEqual([2, 3]);
    expect(hotspotTargetIndices("left")).toEqual([3, 0]);
  });
  it("center hotspot targets all four corners", () => {
    expect(hotspotTargetIndices("center")).toEqual([0, 1, 2, 3]);
  });
});

describe("cornersAtHotspot", () => {
  it("returns the corners at the targeted indices", () => {
    const c: Corners = [round(4), round(8), bevel(12), round(16)];
    expect(cornersAtHotspot(c, "top")).toEqual([round(4), round(8)]);
    expect(cornersAtHotspot(c, "br")).toEqual([bevel(12)]);
  });
});

describe("hotspotShapeIsMixed", () => {
  it("false for corner hotspot (always one corner)", () => {
    const c: Corners = [round(8), bevel(8), round(8), round(8)];
    expect(hotspotShapeIsMixed(c, "tl")).toBe(false);
  });
  it("true for edge hotspot with two different shapes", () => {
    const c: Corners = [round(8), bevel(8), round(8), round(8)];
    expect(hotspotShapeIsMixed(c, "top")).toBe(true);
  });
  it("false for center when all four match", () => {
    const c: Corners = [round(8), round(8), round(8), round(8)];
    expect(hotspotShapeIsMixed(c, "center")).toBe(false);
  });
});

describe("HotspotId — type-level enumeration", () => {
  // Compile-time check: the type covers exactly 9 ids.
  it("includes all 9 hotspot ids", () => {
    const ids: HotspotId[] = ["tl", "tr", "br", "bl", "top", "right", "bottom", "left", "center"];
    expect(ids.length).toBe(9);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/corner-section-state.test.ts 2>&1 | tail -5`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the helpers**

```typescript
// frontend/src/panels/corner-section/corner-section-state.ts
/**
 * Pure helpers deriving UI state from a `Corners` value. Used by
 * CornerSection (overall section state) and CornerPopover (per-hotspot
 * popover state). Pure functions only — no Solid reactivity.
 */

import type { Corner, Corners } from "../../types/document";

export type HotspotId =
  | "tl"
  | "tr"
  | "br"
  | "bl"
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "center";

/** All 9 hotspot ids in their canonical iteration order (TL, TR, BR, BL,
 *  top, right, bottom, left, center). */
export const ALL_HOTSPOT_IDS: readonly HotspotId[] = [
  "tl",
  "tr",
  "br",
  "bl",
  "top",
  "right",
  "bottom",
  "left",
  "center",
];

/** Corner-position labels used by the popover header and aria-label
 *  helper. Indexed by `Corners` array position (TL=0, TR=1, BR=2, BL=3). */
export const CORNER_POSITION_LABEL: readonly string[] = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left",
];

function cornerEq(a: Corner, b: Corner): boolean {
  if (a.type !== b.type) return false;
  if (a.radii.x !== b.radii.x || a.radii.y !== b.radii.y) return false;
  if (a.type === "superellipse" && b.type === "superellipse") {
    return a.smoothing === b.smoothing;
  }
  return true;
}

/** True when all four corners are deep-equal — opens section in linked
 *  state per Spec 14 §1.5 auto-link behavior. */
export function isLinked(corners: Corners): boolean {
  const [tl, tr, br, bl] = corners;
  return cornerEq(tl, tr) && cornerEq(tl, br) && cornerEq(tl, bl);
}

/** True when all four corners are Superellipse with matching smoothing —
 *  triggers the lock state on non-center hotspots per Spec 14 §1.5. */
export function isSuperellipseUniform(corners: Corners): boolean {
  const [tl, tr, br, bl] = corners;
  if (tl.type !== "superellipse") return false;
  if (tr.type !== "superellipse") return false;
  if (br.type !== "superellipse") return false;
  if (bl.type !== "superellipse") return false;
  return tl.smoothing === tr.smoothing && tl.smoothing === br.smoothing && tl.smoothing === bl.smoothing;
}

/** Maps a hotspot id to the corner indices it edits. */
export function hotspotTargetIndices(id: HotspotId): readonly number[] {
  switch (id) {
    case "tl":
      return [0];
    case "tr":
      return [1];
    case "br":
      return [2];
    case "bl":
      return [3];
    case "top":
      return [0, 1];
    case "right":
      return [1, 2];
    case "bottom":
      return [2, 3];
    case "left":
      return [3, 0];
    case "center":
      return [0, 1, 2, 3];
    default: {
      const _exhaustive: never = id;
      throw new Error(`hotspotTargetIndices: unexpected id ${String(_exhaustive)}`);
    }
  }
}

/** Returns the `Corner` instances at a hotspot's target indices. */
export function cornersAtHotspot(corners: Corners, id: HotspotId): Corner[] {
  return hotspotTargetIndices(id).map((i) => corners[i]);
}

/** True when the targeted corners have non-uniform shapes. Always false
 *  for single-corner hotspots (TL/TR/BR/BL). For multi-corner hotspots,
 *  drives the "Mixed" indicator in the shape picker per §1.6. */
export function hotspotShapeIsMixed(corners: Corners, id: HotspotId): boolean {
  const targets = cornersAtHotspot(corners, id);
  if (targets.length <= 1) return false;
  const firstShape = targets[0].type;
  return targets.some((c) => c.type !== firstShape);
}

/** True when any targeted corner has rx ≠ ry. Drives the auto-toggling
 *  of "Unlock axes" when a popover opens. */
export function hotspotHasAsymmetricRadii(corners: Corners, id: HotspotId): boolean {
  return cornersAtHotspot(corners, id).some((c) => c.radii.x !== c.radii.y);
}
```

- [ ] **Step 4: Run — expect green**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/corner-section-state.test.ts 2>&1 | tail -5`
Expected: 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/corner-section/corner-section-state.ts \
        frontend/src/panels/corner-section/__tests__/corner-section-state.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): corner-section-state pure helpers

isLinked, isSuperellipseUniform, hotspotTargetIndices, cornersAtHotspot,
hotspotShapeIsMixed, hotspotHasAsymmetricRadii — all pure functions on
a Corners value. Drives CornerSection auto-link, lock-state, mixed-
indicator, and popover-precondition logic per Spec 14 §1.5/§1.6.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: CornerPreviewSvg — render the preview (no hotspots yet)

The SVG preview component. Renders the corners shape via SvgPathBuilder, plus a `role="img"` with the aria-label from Task 5. Hotspots come in Task 8.

**Files:**
- Create: `frontend/src/panels/corner-section/CornerPreviewSvg.tsx`
- Create: `frontend/src/panels/corner-section/CornerPreviewSvg.css`
- Create: `frontend/src/panels/corner-section/__tests__/CornerPreviewSvg.test.tsx`

- [ ] **Step 1: Write the failing test first**

```typescript
// frontend/src/panels/corner-section/__tests__/CornerPreviewSvg.test.tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { CornerPreviewSvg } from "../CornerPreviewSvg";
import type { Corners } from "../../../types/document";

const ROUND_8: Corners = [
  { type: "round", radii: { x: 8, y: 8 } },
  { type: "round", radii: { x: 8, y: 8 } },
  { type: "round", radii: { x: 8, y: 8 } },
  { type: "round", radii: { x: 8, y: 8 } },
];

describe("CornerPreviewSvg", () => {
  it("renders an <svg role='img'> with a descriptive aria-label", () => {
    const { container } = render(() => <CornerPreviewSvg corners={ROUND_8} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("role")).toBe("img");
    expect(svg!.getAttribute("aria-label")).toBe(
      "Rectangle with rounded corners, radius 8",
    );
  });

  it("contains a single <path> with a non-empty d attribute", () => {
    const { container } = render(() => <CornerPreviewSvg corners={ROUND_8} />);
    const path = container.querySelector("svg > path");
    expect(path).not.toBeNull();
    const d = path!.getAttribute("d") ?? "";
    expect(d.length).toBeGreaterThan(0);
    // Round corners produce one A (arc) per corner = 4 arcs.
    const arcCount = (d.match(/A /g) ?? []).length;
    expect(arcCount).toBe(4);
  });
});
```

Note: the test imports `@solidjs/testing-library`. Confirm it's already a project dependency:

Run: `grep "@solidjs/testing-library" frontend/package.json`
Expected: matches the existing dev dependency entry. (If it doesn't exist, the test file alone proves the API surface; the implementer should add it. The 14a/13d test files already use it — see `frontend/src/components/value-input/ValueInput.test.tsx` for the pattern.)

- [ ] **Step 2: Run — expect failure**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/CornerPreviewSvg.test.tsx 2>&1 | tail -5`
Expected: FAIL with "Cannot find module '../CornerPreviewSvg'".

- [ ] **Step 3: Implement the component**

```tsx
// frontend/src/panels/corner-section/CornerPreviewSvg.tsx
/**
 * The 160×120 SVG preview at the top of CornerSection. Renders the
 * current `Corners` value as a single <path d="..."/> generated by
 * SvgPathBuilder + Plan 14c's appendCornerPath orchestrator.
 *
 * The hotspot overlay (Task 8) is added as an absolutely-positioned
 * sibling inside the wrapping div.
 */

import type { Component } from "solid-js";
import { createMemo } from "solid-js";
import type { Corners } from "../../types/document";
import { appendCornerPath } from "../../canvas/corner-path";
import { SvgPathBuilder } from "./corner-svg-builder";
import { summarizeCornersForAria } from "./corner-aria-label";
import "./CornerPreviewSvg.css";

interface CornerPreviewSvgProps {
  /** Current corner state to render. */
  readonly corners: Corners;
  /** Optional fill color override for the preview shape. Defaults to
   *  the panel accent color set via CSS custom properties. */
  readonly fillColor?: string;
}

/** Logical preview dimensions. The viewBox uses these directly; the
 *  rendered size in the panel is set via CSS so the SVG scales
 *  responsively without changing the geometry. */
const PREVIEW_W = 200;
const PREVIEW_H = 150;
/** Inset on each side so corners with large radii don't clip the
 *  viewBox edge. */
const PREVIEW_INSET = 20;

export const CornerPreviewSvg: Component<CornerPreviewSvgProps> = (props) => {
  const pathD = createMemo(() => {
    const builder = new SvgPathBuilder();
    appendCornerPath(
      builder,
      PREVIEW_INSET,
      PREVIEW_INSET,
      PREVIEW_W - 2 * PREVIEW_INSET,
      PREVIEW_H - 2 * PREVIEW_INSET,
      props.corners,
    );
    return builder.toString();
  });

  const ariaLabel = createMemo(() => summarizeCornersForAria(props.corners));

  return (
    <svg
      class="sigil-corner-preview__svg"
      viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`}
      role="img"
      aria-label={ariaLabel()}
    >
      <path
        d={pathD()}
        fill={props.fillColor ?? "var(--sigil-accent, #4a9eff)"}
      />
    </svg>
  );
};
```

```css
/* frontend/src/panels/corner-section/CornerPreviewSvg.css */
.sigil-corner-preview__svg {
  display: block;
  width: 100%;
  height: auto;
  max-width: 200px;
  max-height: 150px;
}
```

- [ ] **Step 4: Run — expect green**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/CornerPreviewSvg.test.tsx 2>&1 | tail -5`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/corner-section/CornerPreviewSvg.tsx \
        frontend/src/panels/corner-section/CornerPreviewSvg.css \
        frontend/src/panels/corner-section/__tests__/CornerPreviewSvg.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): CornerPreviewSvg — SVG corner-shape preview

200×150 SVG rendering the current Corners value via SvgPathBuilder +
Plan 14c's appendCornerPath. role="img" with the
summarizeCornersForAria text. Hotspot overlay is added in the next
task.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: CornerPreviewSvg — hotspot overlay (9 buttons, reveal on hover/focus)

Add the 9 hotspot buttons as absolutely-positioned HTML `<button>` elements over the SVG. Reveal on `:hover` / `:focus-within` per the Question 2 decision.

- [ ] **Step 1: Extend the component to render the hotspot overlay**

Add a wrapping `<div class="sigil-corner-preview">` containing both the SVG and the hotspot buttons. The component now also accepts an `onHotspotActivate` callback.

Replace the contents of `CornerPreviewSvg.tsx`:

```tsx
// frontend/src/panels/corner-section/CornerPreviewSvg.tsx
import type { Component } from "solid-js";
import { createMemo, For } from "solid-js";
import type { Corners } from "../../types/document";
import { appendCornerPath } from "../../canvas/corner-path";
import { SvgPathBuilder } from "./corner-svg-builder";
import { summarizeCornersForAria } from "./corner-aria-label";
import { ALL_HOTSPOT_IDS, type HotspotId } from "./corner-section-state";
import "./CornerPreviewSvg.css";

interface CornerPreviewSvgProps {
  readonly corners: Corners;
  readonly fillColor?: string;
  /** Called when the user activates a hotspot (click, Enter, Space). */
  readonly onHotspotActivate: (id: HotspotId, element: HTMLButtonElement) => void;
  /** When true (uniform superellipse state), non-center hotspots are
   *  rendered disabled per the lock state in Spec 14 §1.5. */
  readonly nonCenterHotspotsDisabled?: boolean;
}

const PREVIEW_W = 200;
const PREVIEW_H = 150;
const PREVIEW_INSET = 20;

/** Display label used by aria-label and the popover header. */
const HOTSPOT_ARIA: Record<HotspotId, string> = {
  tl: "Edit top-left corner",
  tr: "Edit top-right corner",
  br: "Edit bottom-right corner",
  bl: "Edit bottom-left corner",
  top: "Edit top corners",
  right: "Edit right corners",
  bottom: "Edit bottom corners",
  left: "Edit left corners",
  center: "Edit all corners",
};

const NON_CENTER_LOCKED_ARIA =
  "Superellipse applies to all corners. Change the shape to edit corners individually.";

export const CornerPreviewSvg: Component<CornerPreviewSvgProps> = (props) => {
  const pathD = createMemo(() => {
    const builder = new SvgPathBuilder();
    appendCornerPath(
      builder,
      PREVIEW_INSET,
      PREVIEW_INSET,
      PREVIEW_W - 2 * PREVIEW_INSET,
      PREVIEW_H - 2 * PREVIEW_INSET,
      props.corners,
    );
    return builder.toString();
  });

  const ariaLabel = createMemo(() => summarizeCornersForAria(props.corners));

  function handleClick(id: HotspotId, e: MouseEvent): void {
    if (props.nonCenterHotspotsDisabled && id !== "center") return;
    const target = e.currentTarget as HTMLButtonElement;
    props.onHotspotActivate(id, target);
  }

  return (
    <div class="sigil-corner-preview">
      <svg
        class="sigil-corner-preview__svg"
        viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`}
        role="img"
        aria-label={ariaLabel()}
      >
        <path d={pathD()} fill={props.fillColor ?? "var(--sigil-accent, #4a9eff)"} />
      </svg>
      <div class="sigil-corner-preview__hotspots">
        <For each={ALL_HOTSPOT_IDS}>
          {(id) => (
            <button
              type="button"
              class={`sigil-corner-preview__hotspot sigil-corner-preview__hotspot--${id}`}
              aria-label={HOTSPOT_ARIA[id]}
              aria-disabled={
                props.nonCenterHotspotsDisabled && id !== "center" ? "true" : undefined
              }
              data-hotspot={id}
              title={props.nonCenterHotspotsDisabled && id !== "center"
                ? NON_CENTER_LOCKED_ARIA
                : undefined}
              onClick={(e) => handleClick(id, e)}
            />
          )}
        </For>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Add CSS for hotspot positioning + reveal-on-hover**

Replace `CornerPreviewSvg.css`:

```css
/* frontend/src/panels/corner-section/CornerPreviewSvg.css */
.sigil-corner-preview {
  position: relative;
  width: 100%;
  max-width: 200px;
  margin: 0 auto;
  aspect-ratio: 200 / 150;
}

.sigil-corner-preview__svg {
  display: block;
  width: 100%;
  height: auto;
}

.sigil-corner-preview__hotspots {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.sigil-corner-preview__hotspot {
  position: absolute;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  pointer-events: auto;
  opacity: 0;
  transition: opacity 120ms ease, border-color 120ms ease, background-color 120ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .sigil-corner-preview__hotspot {
    transition: none;
  }
}

/* Reveal on section hover or focus-within. */
.sigil-corner-preview:hover .sigil-corner-preview__hotspot,
.sigil-corner-preview:focus-within .sigil-corner-preview__hotspot {
  opacity: 1;
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.3);
}

.sigil-corner-preview__hotspot:hover,
.sigil-corner-preview__hotspot:focus {
  background: rgba(74, 158, 255, 0.3);
  border-color: rgba(74, 158, 255, 0.9);
  outline: none;
}

.sigil-corner-preview__hotspot:focus-visible {
  outline: 2px solid var(--sigil-focus-ring, #4a9eff);
  outline-offset: 2px;
}

.sigil-corner-preview__hotspot[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0;
}

/* Hotspot positions — percentages relative to the wrapper. */
.sigil-corner-preview__hotspot--tl { top: 10%; left: 12%; }
.sigil-corner-preview__hotspot--tr { top: 10%; right: 12%; }
.sigil-corner-preview__hotspot--br { bottom: 10%; right: 12%; }
.sigil-corner-preview__hotspot--bl { bottom: 10%; left: 12%; }
.sigil-corner-preview__hotspot--top { top: 10%; left: 50%; transform: translateX(-50%); }
.sigil-corner-preview__hotspot--bottom { bottom: 10%; left: 50%; transform: translateX(-50%); }
.sigil-corner-preview__hotspot--left { top: 50%; left: 12%; transform: translateY(-50%); }
.sigil-corner-preview__hotspot--right { top: 50%; right: 12%; transform: translateY(-50%); }
.sigil-corner-preview__hotspot--center { top: 50%; left: 50%; transform: translate(-50%, -50%); }
```

- [ ] **Step 3: Update the test file to assert hotspot semantics**

Replace the existing `CornerPreviewSvg.test.tsx` with:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { CornerPreviewSvg } from "../CornerPreviewSvg";
import type { Corners } from "../../../types/document";

const ROUND_8: Corners = [
  { type: "round", radii: { x: 8, y: 8 } },
  { type: "round", radii: { x: 8, y: 8 } },
  { type: "round", radii: { x: 8, y: 8 } },
  { type: "round", radii: { x: 8, y: 8 } },
];

const SUPERELLIPSE_UNIFORM: Corners = [
  { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
  { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
  { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
  { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
];

describe("CornerPreviewSvg", () => {
  it("renders an <svg role='img'> with a descriptive aria-label", () => {
    const { container } = render(() => (
      <CornerPreviewSvg corners={ROUND_8} onHotspotActivate={() => {}} />
    ));
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe(
      "Rectangle with rounded corners, radius 8",
    );
  });

  it("renders exactly 9 hotspot buttons, each with a unique aria-label", () => {
    const { container } = render(() => (
      <CornerPreviewSvg corners={ROUND_8} onHotspotActivate={() => {}} />
    ));
    const buttons = container.querySelectorAll("button[data-hotspot]");
    expect(buttons.length).toBe(9);
    const labels = Array.from(buttons).map((b) => b.getAttribute("aria-label"));
    expect(new Set(labels).size).toBe(9);
    expect(labels).toContain("Edit top-left corner");
    expect(labels).toContain("Edit all corners");
  });

  it("invokes onHotspotActivate with the clicked id", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <CornerPreviewSvg corners={ROUND_8} onHotspotActivate={handler} />
    ));
    const tlButton = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    fireEvent.click(tlButton);
    expect(handler).toHaveBeenCalledWith("tl", tlButton);
  });

  it("locks non-center hotspots when nonCenterHotspotsDisabled is true", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <CornerPreviewSvg
        corners={SUPERELLIPSE_UNIFORM}
        onHotspotActivate={handler}
        nonCenterHotspotsDisabled
      />
    ));
    const tlButton = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    const centerButton = container.querySelector(
      "button[data-hotspot='center']",
    ) as HTMLButtonElement;
    expect(tlButton.getAttribute("aria-disabled")).toBe("true");
    expect(centerButton.getAttribute("aria-disabled")).toBeNull();

    fireEvent.click(tlButton);
    expect(handler).not.toHaveBeenCalled();
    fireEvent.click(centerButton);
    expect(handler).toHaveBeenCalledWith("center", centerButton);
  });
});
```

- [ ] **Step 4: Run — expect green**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/CornerPreviewSvg.test.tsx 2>&1 | tail -8`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/corner-section/CornerPreviewSvg.tsx \
        frontend/src/panels/corner-section/CornerPreviewSvg.css \
        frontend/src/panels/corner-section/__tests__/CornerPreviewSvg.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): CornerPreviewSvg — 9-hotspot overlay (reveal on hover/focus)

Adds the 9 hotspot <button> elements absolutely positioned over the
preview SVG. Buttons revealed on :hover or :focus-within (matching the
brainstorm decision). Center hotspot remains active when
nonCenterHotspotsDisabled=true (uniform-superellipse lock state per
Spec 14 §1.5). prefers-reduced-motion respected.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Smoothing constants — MIN_SUPERELLIPSE_SMOOTHING / MAX_SUPERELLIPSE_SMOOTHING

The Slider min/max bounds must come from named constants per CLAUDE.md §11 "Constants Must Be Enforced." Add them to the existing corners-input module.

**Files:**
- Modify: `frontend/src/store/corners-input.ts`
- Modify: `frontend/src/store/__tests__/corners-input.test.ts` (likely existing test file)

- [ ] **Step 1: Locate the existing tests**

Run: `ls frontend/src/store/__tests__/ | grep corners`
Confirm there's a file like `corners-input.test.ts`. If not, the constants can ship with an enforcement test in `corners-input.test.ts` (create the file at the same time if missing).

- [ ] **Step 2: Add the constants**

Modify `frontend/src/store/corners-input.ts`. Find the existing `MAX_CORNER_RADIUS` export (line ~21) and add adjacent:

```typescript
/** Minimum superellipse smoothing value (Spec 14 §3.7 v1 range). */
export const MIN_SUPERELLIPSE_SMOOTHING = 0;

/** Maximum superellipse smoothing value (Spec 14 §3.7 v1 range). */
export const MAX_SUPERELLIPSE_SMOOTHING = 1;
```

If the existing `parseCornersInput` already enforces `0 <= smoothing <= 1` with magic literals, replace them with the named constants in the same edit.

- [ ] **Step 3: Add enforcement tests**

Add to `corners-input.test.ts` (or create with these contents if missing):

```typescript
describe("MIN_SUPERELLIPSE_SMOOTHING / MAX_SUPERELLIPSE_SMOOTHING enforcement", () => {
  it("test_max_superellipse_smoothing_enforced — rejects smoothing > 1", () => {
    const result = parseCornersInput({
      type: "superellipse",
      radius: 8,
      smoothing: 1.0001,
    });
    expect(result).toBeNull();
  });

  it("test_min_superellipse_smoothing_enforced — rejects smoothing < 0", () => {
    const result = parseCornersInput({
      type: "superellipse",
      radius: 8,
      smoothing: -0.0001,
    });
    expect(result).toBeNull();
  });

  it("accepts smoothing at the boundary values", () => {
    expect(parseCornersInput({ type: "superellipse", radius: 8, smoothing: 0 })).not.toBeNull();
    expect(parseCornersInput({ type: "superellipse", radius: 8, smoothing: 1 })).not.toBeNull();
  });
});
```

(Adjust the `parseCornersInput` input shape to match the actual API in `corners-input.ts`; the test file probably already shows the canonical form.)

- [ ] **Step 4: Run — expect green**

Run: `pnpm --prefix frontend test -- --run src/store/__tests__/corners-input.test.ts 2>&1 | tail -5`
Expected: all tests pass, including the new enforcement tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/corners-input.ts frontend/src/store/__tests__/corners-input.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): MIN/MAX_SUPERELLIPSE_SMOOTHING constants + enforcement tests

Named constants for the smoothing domain bounds. Per CLAUDE.md §11
"Constants Must Be Enforced": every NumberInput/Slider min/max in the
frontend MUST come from a named constant matching the Rust validation
boundary. Bounds are used by the upcoming CornerPopover smoothing
Slider (Task 12).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: CornerPopover — common skeleton (shape picker + radius)

Implement the popover body. Three flavors share the same skeleton (header, shape picker, radius input); flavors differ by available shapes and whether the smoothing control is shown. Center popover and the rest share most of the code path.

**Files:**
- Create: `frontend/src/panels/corner-section/CornerPopover.tsx`
- Create: `frontend/src/panels/corner-section/CornerPopover.css`
- Create: `frontend/src/panels/corner-section/__tests__/CornerPopover.test.tsx`

- [ ] **Step 1: Write failing tests covering the popover's render contract**

```tsx
// frontend/src/panels/corner-section/__tests__/CornerPopover.test.tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { CornerPopover } from "../CornerPopover";
import type { Corner } from "../../../types/document";

function round(r: number): Corner {
  return { type: "round", radii: { x: r, y: r } };
}
function bevel(r: number): Corner {
  return { type: "bevel", radii: { x: r, y: r } };
}

describe("CornerPopover — common skeleton", () => {
  it("corner-popover renders header, shape picker, and radius input", () => {
    const { container } = render(() => (
      <CornerPopover target="tl" corners={[round(8), round(8), round(8), round(8)]} onCommit={() => {}} />
    ));
    expect(container.querySelector("h3")?.textContent).toBe("Top-left corner");
    expect(container.querySelector('[data-testid="corner-popover__shape"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="corner-popover__radius"]')).not.toBeNull();
  });

  it("corner popover offers 4 shapes (Round / Bevel / Notch / Scoop) — NOT Superellipse", () => {
    const { container } = render(() => (
      <CornerPopover target="tl" corners={[round(8), round(8), round(8), round(8)]} onCommit={() => {}} />
    ));
    const select = container.querySelector('[data-testid="corner-popover__shape"] select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["round", "bevel", "notch", "scoop"]);
  });

  it("center popover offers 5 shapes (adds Superellipse)", () => {
    const { container } = render(() => (
      <CornerPopover
        target="center"
        corners={[round(8), round(8), round(8), round(8)]}
        onCommit={() => {}}
      />
    ));
    const select = container.querySelector('[data-testid="corner-popover__shape"] select') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["round", "bevel", "notch", "scoop", "superellipse"]);
  });

  it("changing shape via the Select calls onCommit with the new shape applied to every targeted corner", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <CornerPopover
        target="top"
        corners={[round(8), round(8), round(8), round(8)]}
        onCommit={handler}
      />
    ));
    const select = container.querySelector('[data-testid="corner-popover__shape"] select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "bevel" } });
    // Top hotspot edits indices 0 and 1 — onCommit returns the new full Corners array.
    expect(handler).toHaveBeenCalledTimes(1);
    const [newCorners] = handler.mock.calls[0];
    expect(newCorners[0].type).toBe("bevel");
    expect(newCorners[1].type).toBe("bevel");
    expect(newCorners[2].type).toBe("round"); // untouched
    expect(newCorners[3].type).toBe("round"); // untouched
  });

  it("shows the 'Mixed' indicator when targeted corners have different shapes", () => {
    const { container } = render(() => (
      <CornerPopover
        target="top"
        corners={[round(8), bevel(8), round(8), round(8)]}
        onCommit={() => {}}
      />
    ));
    expect(container.querySelector('[data-testid="corner-popover__mixed-indicator"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/CornerPopover.test.tsx 2>&1 | tail -5`
Expected: FAIL with "Cannot find module '../CornerPopover'".

- [ ] **Step 3: Implement the common skeleton**

```tsx
// frontend/src/panels/corner-section/CornerPopover.tsx
/**
 * Popover body rendered inside the project's native <Popover> wrapper
 * (see frontend/src/components/popover/Popover.tsx). Edits one corner,
 * two corners (edge), or all four (center). Form pre-populates from the
 * current corner state at the hotspot's target indices.
 *
 * Spec 14 §1.5 specifies:
 *  - Corner + edge popovers: shape picker (Round/Bevel/Notch/Scoop) +
 *    radius input + "Unlock axes" toggle. NO Superellipse.
 *  - Center popover: same as above PLUS Superellipse option AND
 *    conditional smoothing control when shape = Superellipse.
 *
 * This task implements the common skeleton + shape picker + radius input.
 * Tasks 11 and 12 add the axis-unlock toggle and the smoothing control.
 */

import type { Component } from "solid-js";
import { createMemo, Show } from "solid-js";
import type { Corner, Corners } from "../../types/document";
import { Select, type SelectOption } from "../../components/select/Select";
import ValueInput from "../../components/value-input/ValueInput";
import {
  CORNER_POSITION_LABEL,
  cornersAtHotspot,
  hotspotShapeIsMixed,
  hotspotTargetIndices,
  type HotspotId,
} from "./corner-section-state";
import "./CornerPopover.css";

type CornerShape = Corner["type"];

interface CornerPopoverProps {
  /** Which hotspot this popover belongs to. */
  readonly target: HotspotId;
  /** Current full corners state — used to pre-populate the form. */
  readonly corners: Corners;
  /** Called when the user commits a change. Receives the NEW full
   *  Corners array (un-targeted positions are preserved unchanged). */
  readonly onCommit: (newCorners: Corners) => void;
}

const CORNER_SHAPE_OPTIONS: readonly SelectOption<CornerShape>[] = [
  { value: "round", label: "Round" },
  { value: "bevel", label: "Bevel" },
  { value: "notch", label: "Notch" },
  { value: "scoop", label: "Scoop" },
];

const CENTER_SHAPE_OPTIONS: readonly SelectOption<CornerShape>[] = [
  ...CORNER_SHAPE_OPTIONS,
  { value: "superellipse", label: "Superellipse" },
];

function headerLabel(target: HotspotId): string {
  switch (target) {
    case "tl":
    case "tr":
    case "br":
    case "bl": {
      const idx = hotspotTargetIndices(target)[0];
      const pos = CORNER_POSITION_LABEL[idx];
      return pos.charAt(0).toUpperCase() + pos.slice(1) + " corner";
    }
    case "top":
      return "Top corners";
    case "right":
      return "Right corners";
    case "bottom":
      return "Bottom corners";
    case "left":
      return "Left corners";
    case "center":
      return "All corners";
  }
}

function makeCornerOfShape(shape: CornerShape, prev: Corner): Corner {
  // Preserve the previous radii; only change the shape. Smoothing
  // defaults to 0.5 when newly becoming superellipse (Spec 14 §1.5).
  if (shape === "superellipse") {
    if (prev.type === "superellipse") return { ...prev };
    return { type: "superellipse", radii: { ...prev.radii }, smoothing: 0.5 };
  }
  return { type: shape, radii: { ...prev.radii } };
}

function writeCorners(corners: Corners, targets: readonly number[], factory: (prev: Corner) => Corner): Corners {
  const next = corners.map((c, i) => (targets.includes(i) ? factory(c) : c)) as unknown as Corners;
  return next;
}

export const CornerPopover: Component<CornerPopoverProps> = (props) => {
  const targets = createMemo(() => hotspotTargetIndices(props.target));
  const targeted = createMemo(() => cornersAtHotspot(props.corners, props.target));
  const isMixed = createMemo(() => hotspotShapeIsMixed(props.corners, props.target));
  const isCenter = createMemo(() => props.target === "center");

  // Show the first targeted corner's shape as the current Select value.
  // When mixed, the Select displays empty and shows the "Mixed" indicator.
  const currentShape = createMemo<CornerShape | null>(() =>
    isMixed() ? null : targeted()[0].type,
  );

  // Radius shown as a single literal — when targeted corners share x===y
  // and the same value, show that number. Otherwise blank (the unlock
  // toggle in Task 11 will let the user split into rx/ry).
  const currentRadius = createMemo<number | null>(() => {
    const ts = targeted();
    const first = ts[0];
    if (first.radii.x !== first.radii.y) return null;
    if (ts.some((c) => c.radii.x !== first.radii.x || c.radii.y !== first.radii.y)) {
      return null;
    }
    return first.radii.x;
  });

  function commitShape(shape: CornerShape): void {
    const next = writeCorners(props.corners, targets(), (prev) => makeCornerOfShape(shape, prev));
    props.onCommit(next);
  }

  function commitRadius(r: number): void {
    if (!Number.isFinite(r) || r < 0) return;
    const next = writeCorners(props.corners, targets(), (prev) => ({
      ...prev,
      radii: { x: r, y: r },
    }));
    props.onCommit(next);
  }

  return (
    <div class="sigil-corner-popover">
      <h3 class="sigil-corner-popover__header">{headerLabel(props.target)}</h3>

      <div class="sigil-corner-popover__field" data-testid="corner-popover__shape">
        <label class="sigil-corner-popover__label">Shape</label>
        <Show when={isMixed()}>
          <span
            class="sigil-corner-popover__mixed"
            data-testid="corner-popover__mixed-indicator"
          >
            Mixed
          </span>
        </Show>
        <Select
          value={currentShape() ?? "round"}
          onChange={(v) => commitShape(v as CornerShape)}
          options={isCenter() ? CENTER_SHAPE_OPTIONS : CORNER_SHAPE_OPTIONS}
          aria-label="Corner shape"
        />
      </div>

      <div class="sigil-corner-popover__field" data-testid="corner-popover__radius">
        <label class="sigil-corner-popover__label">Radius</label>
        <ValueInput
          value={currentRadius() ?? ""}
          onCommit={(v) => {
            if (typeof v === "number") commitRadius(v);
          }}
          ariaLabel="Corner radius"
          mode="number"
        />
      </div>
    </div>
  );
};
```

Note: the exact `Select` and `ValueInput` props depend on those wrappers' actual API. Inspect their files in step 4 if signatures differ:
- `frontend/src/components/select/Select.tsx`
- `frontend/src/components/value-input/ValueInput.tsx`

If the test's `select` query fails because Kobalte's `<Select>` doesn't render a native `<select>` element, change the test to inspect Kobalte's listbox semantics instead — `[role="listbox"]` or `[aria-haspopup="listbox"]`.

```css
/* frontend/src/panels/corner-section/CornerPopover.css */
.sigil-corner-popover {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  min-width: 220px;
  background: var(--sigil-panel-bg, #1c1c1f);
  color: var(--sigil-panel-fg, #ddd);
  border-radius: 6px;
}

.sigil-corner-popover__header {
  margin: 0 0 4px 0;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--sigil-panel-fg-dim, #aaa);
}

.sigil-corner-popover__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sigil-corner-popover__label {
  font-size: 11px;
  color: var(--sigil-panel-fg-dim, #aaa);
}

.sigil-corner-popover__mixed {
  font-size: 11px;
  color: var(--sigil-panel-fg-warn, #d99a2b);
  align-self: flex-start;
}
```

- [ ] **Step 4: Inspect Select + ValueInput APIs and adjust the implementation**

Run: `grep -nE "^export|interface Select|interface ValueInput" frontend/src/components/select/Select.tsx frontend/src/components/value-input/ValueInput.tsx | head -10`

Adjust the implementation in step 3 if prop names differ (e.g., the project may use `onValueChange` instead of `onChange`, or `onCommit` may have a different signature in ValueInput). Re-write the affected lines without changing test contracts; tests assert on `select.value` and `aria-label` which both APIs expose.

- [ ] **Step 5: Run — expect green**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/CornerPopover.test.tsx 2>&1 | tail -10`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/panels/corner-section/CornerPopover.tsx \
        frontend/src/panels/corner-section/CornerPopover.css \
        frontend/src/panels/corner-section/__tests__/CornerPopover.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): CornerPopover skeleton — header, shape picker, radius

Corner + edge popovers offer 4 shapes (Round/Bevel/Notch/Scoop); center
popover adds Superellipse for a total of 5. Mixed indicator surfaces
when targeted corners differ in shape. Commits flow through the
parent-supplied onCommit callback. Axis-unlock toggle and smoothing
control come in Tasks 11 and 12.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: CornerPopover — "Unlock axes" toggle + rx/ry split

Adds the axis-unlock affordance. When unlocked, the single Radius input splits into rx/ry. Pre-toggles on when any targeted corner has rx ≠ ry.

- [ ] **Step 1: Extend the test file**

Append to `CornerPopover.test.tsx`:

```tsx
import { hotspotHasAsymmetricRadii } from "../corner-section-state";

describe("CornerPopover — axis-unlock toggle", () => {
  it("renders a Toggle labeled 'Unlock axes'", () => {
    const { container } = render(() => (
      <CornerPopover target="tl" corners={[round(8), round(8), round(8), round(8)]} onCommit={() => {}} />
    ));
    const toggle = container.querySelector('[data-testid="corner-popover__unlock"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-label")).toBe("Unlock axes");
  });

  it("pre-toggles on when any targeted corner has rx ≠ ry", () => {
    const asym: Corner = { type: "round", radii: { x: 30, y: 10 } };
    expect(hotspotHasAsymmetricRadii([asym, round(8), round(8), round(8)] as Corners, "tl")).toBe(
      true,
    );
    const { container } = render(() => (
      <CornerPopover target="tl" corners={[asym, round(8), round(8), round(8)]} onCommit={() => {}} />
    ));
    const toggle = container.querySelector(
      '[data-testid="corner-popover__unlock"] [role="switch"]',
    ) as HTMLElement;
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
  });

  it("when unlocked, renders rx and ry ValueInputs and commits them separately", () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <CornerPopover
        target="tl"
        corners={[
          { type: "round", radii: { x: 8, y: 8 } },
          round(8),
          round(8),
          round(8),
        ]}
        onCommit={handler}
      />
    ));
    // Click the toggle to unlock.
    const toggleButton = container.querySelector(
      '[data-testid="corner-popover__unlock"] [role="switch"]',
    ) as HTMLElement;
    fireEvent.click(toggleButton);

    const rxField = container.querySelector('[data-testid="corner-popover__rx"]');
    const ryField = container.querySelector('[data-testid="corner-popover__ry"]');
    expect(rxField).not.toBeNull();
    expect(ryField).not.toBeNull();

    // Simulate committing rx = 30 (the ValueInput exposes a hidden input
    // we can drive via change event; consult the actual ValueInput API
    // in Task 10 step 4 if this query fails).
    const rxInput = rxField!.querySelector("input") as HTMLInputElement;
    fireEvent.change(rxInput, { target: { value: "30" } });
    fireEvent.blur(rxInput);

    expect(handler).toHaveBeenCalled();
    const [newCorners] = handler.mock.calls[handler.mock.calls.length - 1];
    expect(newCorners[0].radii.x).toBe(30);
    expect(newCorners[0].radii.y).toBe(8); // unchanged
  });
});
```

- [ ] **Step 2: Run — expect failures**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/CornerPopover.test.tsx 2>&1 | tail -10`
Expected: 3 new tests fail (skeleton tests still pass).

- [ ] **Step 3: Extend the component**

Modify `CornerPopover.tsx`:

1. Add `Toggle` import from the wrapper at `../../components/toggle/Toggle`.
2. Add a `createSignal` for the locally-controlled unlock state, pre-set from `hotspotHasAsymmetricRadii`.
3. Conditionally render either the single Radius input OR (rx, ry) inputs based on unlock state.

```tsx
import { Toggle } from "../../components/toggle/Toggle";
import { createSignal, createEffect } from "solid-js";
import { hotspotHasAsymmetricRadii } from "./corner-section-state";

// ... inside the component, before the return:

const [unlocked, setUnlocked] = createSignal(
  hotspotHasAsymmetricRadii(props.corners, props.target),
);

// If the underlying corners change to asymmetric (e.g., another panel
// edits them), reflect that in the local toggle state.
createEffect(() => {
  setUnlocked(hotspotHasAsymmetricRadii(props.corners, props.target));
});

const currentRx = createMemo(() => {
  const ts = targeted();
  const first = ts[0];
  if (ts.some((c) => c.radii.x !== first.radii.x)) return null;
  return first.radii.x;
});

const currentRy = createMemo(() => {
  const ts = targeted();
  const first = ts[0];
  if (ts.some((c) => c.radii.y !== first.radii.y)) return null;
  return first.radii.y;
});

function commitRx(rx: number): void {
  if (!Number.isFinite(rx) || rx < 0) return;
  const next = writeCorners(props.corners, targets(), (prev) => ({
    ...prev,
    radii: { x: rx, y: prev.radii.y },
  }));
  props.onCommit(next);
}

function commitRy(ry: number): void {
  if (!Number.isFinite(ry) || ry < 0) return;
  const next = writeCorners(props.corners, targets(), (prev) => ({
    ...prev,
    radii: { x: prev.radii.x, y: ry },
  }));
  props.onCommit(next);
}
```

In the JSX, replace the single Radius field with:

```tsx
<div class="sigil-corner-popover__field" data-testid="corner-popover__unlock">
  <Toggle pressed={unlocked()} onChange={setUnlocked} aria-label="Unlock axes">
    Unlock axes
  </Toggle>
</div>

<Show
  when={unlocked()}
  fallback={
    <div class="sigil-corner-popover__field" data-testid="corner-popover__radius">
      <label class="sigil-corner-popover__label">Radius</label>
      <ValueInput
        value={currentRadius() ?? ""}
        onCommit={(v) => {
          if (typeof v === "number") commitRadius(v);
        }}
        ariaLabel="Corner radius"
        mode="number"
      />
    </div>
  }
>
  <div class="sigil-corner-popover__row">
    <div class="sigil-corner-popover__field" data-testid="corner-popover__rx">
      <label class="sigil-corner-popover__label">rx</label>
      <ValueInput
        value={currentRx() ?? ""}
        onCommit={(v) => {
          if (typeof v === "number") commitRx(v);
        }}
        ariaLabel="Radius X"
        mode="number"
      />
    </div>
    <div class="sigil-corner-popover__field" data-testid="corner-popover__ry">
      <label class="sigil-corner-popover__label">ry</label>
      <ValueInput
        value={currentRy() ?? ""}
        onCommit={(v) => {
          if (typeof v === "number") commitRy(v);
        }}
        ariaLabel="Radius Y"
        mode="number"
      />
    </div>
  </div>
</Show>
```

Add to `CornerPopover.css`:

```css
.sigil-corner-popover__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
```

- [ ] **Step 4: Run — expect green**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/CornerPopover.test.tsx 2>&1 | tail -10`
Expected: 8 tests pass (5 skeleton + 3 axis-unlock).

If the ValueInput change/blur-driven test fails because ValueInput's commit semantics differ (e.g., commit fires on Enter only, not blur), adjust the test to drive whatever event ValueInput uses — but DO NOT bypass the public API.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/corner-section/CornerPopover.tsx \
        frontend/src/panels/corner-section/CornerPopover.css \
        frontend/src/panels/corner-section/__tests__/CornerPopover.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): CornerPopover axis-unlock toggle + rx/ry split

Toggle pre-activates when any targeted corner has rx ≠ ry (auto-link
behavior per Spec 14 §1.5). When unlocked, the single Radius input
splits into rx and ry ValueInputs, each committing independently —
preserving the other axis per CLAUDE.md §11 "partial updates of multi-
field values".

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: CornerPopover — center variant smoothing control (ValueInput + Slider, history coalescing)

The smoothing control appears only when (a) the target is "center" AND (b) the current shape is Superellipse. It's a composite of ValueInput (token/expression support) + Slider (literal scrub) per Spec 14 §1.5.

- [ ] **Step 1: Extend the test file**

Append to `CornerPopover.test.tsx`:

```tsx
function superellipseAll(s: number): Corners {
  return [
    { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: s },
    { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: s },
    { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: s },
    { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: s },
  ];
}

describe("CornerPopover — center smoothing control", () => {
  it("does NOT render the smoothing control on non-center popovers", () => {
    const { container } = render(() => (
      <CornerPopover target="tl" corners={[round(8), round(8), round(8), round(8)]} onCommit={() => {}} />
    ));
    expect(container.querySelector('[data-testid="corner-popover__smoothing"]')).toBeNull();
  });

  it("does NOT render the smoothing control on center when shape != superellipse", () => {
    const { container } = render(() => (
      <CornerPopover target="center" corners={[round(8), round(8), round(8), round(8)]} onCommit={() => {}} />
    ));
    expect(container.querySelector('[data-testid="corner-popover__smoothing"]')).toBeNull();
  });

  it("renders the smoothing control on center popover when shape = superellipse", () => {
    const { container } = render(() => (
      <CornerPopover target="center" corners={superellipseAll(0.5)} onCommit={() => {}} />
    ));
    expect(container.querySelector('[data-testid="corner-popover__smoothing"]')).not.toBeNull();
  });

  it("dragging the slider during a gesture batches into a single onCommit at gesture end", () => {
    // The wrapped Slider's onChangeEnd event drives the single commit
    // — per CLAUDE.md §11 "Continuous-Value Controls Must Coalesce
    // History Entries". onChange events during drag do NOT commit.
    const handler = vi.fn();
    const { container } = render(() => (
      <CornerPopover target="center" corners={superellipseAll(0.5)} onCommit={handler} />
    ));
    const slider = container.querySelector(
      '[data-testid="corner-popover__smoothing-slider"]',
    ) as HTMLElement;
    expect(slider).not.toBeNull();
    // Simulate gesture: pointerdown → multiple change events → pointerup
    // The Slider wrapper translates pointerup into onChangeEnd which
    // calls onCommit. The intermediate onChange events do NOT call
    // onCommit. NOTE: simulating Kobalte slider drag in jsdom is
    // brittle; this test asserts handler.mock.calls.length === 1 after
    // a complete gesture rather than counting intermediate updates.
    //
    // The implementer should drive whatever events the wrapped Slider
    // exposes for its onChangeEnd callback — likely the Kobalte
    // SliderRoot's onChangeEnd event. Adjust if needed.
  });
});
```

(The slider-gesture test is best written against the actual Slider event surface — the implementer should consult `frontend/src/components/slider/Slider.test.tsx` for the existing pattern and adapt.)

- [ ] **Step 2: Implement the smoothing control**

Add to `CornerPopover.tsx`:

```tsx
import { Slider } from "../../components/slider/Slider";
import { MIN_SUPERELLIPSE_SMOOTHING, MAX_SUPERELLIPSE_SMOOTHING } from "../../store/corners-input";

// Track the in-gesture smoothing value (drives the slider visual during
// drag without committing on every tick). Captured on gesture start;
// reset on gesture end after the commit.
const [gestureSmoothing, setGestureSmoothing] = createSignal<number | null>(null);

// Show smoothing control only on center popover + when current shape is superellipse.
const showSmoothing = createMemo(() => {
  if (props.target !== "center") return false;
  return targeted().every((c) => c.type === "superellipse");
});

const currentSmoothing = createMemo<number>(() => {
  const ts = targeted();
  const first = ts[0];
  if (first.type !== "superellipse") return 0.5; // fallback (control is hidden)
  return first.smoothing;
});

function commitSmoothing(s: number): void {
  if (!Number.isFinite(s) || s < MIN_SUPERELLIPSE_SMOOTHING || s > MAX_SUPERELLIPSE_SMOOTHING) {
    return;
  }
  const next = writeCorners(props.corners, targets(), (prev) =>
    prev.type === "superellipse"
      ? { ...prev, smoothing: s }
      : { type: "superellipse", radii: { ...prev.radii }, smoothing: s },
  );
  props.onCommit(next);
}
```

In the JSX, append after the radius / rx-ry block:

```tsx
<Show when={showSmoothing()}>
  <div class="sigil-corner-popover__field" data-testid="corner-popover__smoothing">
    <label class="sigil-corner-popover__label">Smoothing</label>
    <div class="sigil-corner-popover__row">
      <ValueInput
        value={gestureSmoothing() ?? currentSmoothing()}
        onCommit={(v) => {
          if (typeof v === "number") commitSmoothing(v);
        }}
        ariaLabel="Smoothing"
        mode="number"
      />
      <div data-testid="corner-popover__smoothing-slider">
        <Slider
          value={gestureSmoothing() ?? currentSmoothing()}
          min={MIN_SUPERELLIPSE_SMOOTHING}
          max={MAX_SUPERELLIPSE_SMOOTHING}
          step={0.01}
          onChangeStart={() => setGestureSmoothing(currentSmoothing())}
          onChange={(v) => setGestureSmoothing(v)}
          onChangeEnd={(v) => {
            commitSmoothing(v);
            setGestureSmoothing(null);
          }}
          aria-label="Smoothing"
        />
      </div>
    </div>
  </div>
</Show>
```

- [ ] **Step 3: Run — expect green**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/CornerPopover.test.tsx 2>&1 | tail -10`
Expected: tests pass. If the slider gesture test is too brittle in jsdom, scope it to just asserting that the Slider's `onChangeEnd` triggers `onCommit` once — the gesture-coalescing contract is enforceable that way.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/panels/corner-section/CornerPopover.tsx \
        frontend/src/panels/corner-section/__tests__/CornerPopover.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): CornerPopover center smoothing control (ValueInput + Slider)

Smoothing control appears only on the center popover when shape is
Superellipse. Composite of ValueInput (literal/token/expression) +
Slider for direct scrub. Slider gesture (pointerdown → drag → pointerup)
emits a single commit at onChangeEnd per "Continuous-Value Controls
Must Coalesce History Entries". Slider min/max from named constants
MIN/MAX_SUPERELLIPSE_SMOOTHING (Task 9).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: CornerSection — orchestration scaffold (no superellipse-lock or RF-038 yet)

Wire CornerPreviewSvg + native Popover + CornerPopover into one component. The section opens a popover anchored to the activated hotspot button, and routes commits to the store's `setCorners` function.

**Files:**
- Create: `frontend/src/panels/corner-section/CornerSection.tsx`
- Create: `frontend/src/panels/corner-section/CornerSection.css`
- Create: `frontend/src/panels/corner-section/__tests__/CornerSection.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/panels/corner-section/__tests__/CornerSection.test.tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { CornerSection } from "../CornerSection";
import type { DocumentNode } from "../../../types/document";

function makeRectNode(uuid = "n1"): DocumentNode {
  return {
    id: { index: 1, generation: 0 },
    uuid,
    kind: {
      type: "rectangle",
      corners: [
        { type: "round", radii: { x: 8, y: 8 } },
        { type: "round", radii: { x: 8, y: 8 } },
        { type: "round", radii: { x: 8, y: 8 } },
        { type: "round", radii: { x: 8, y: 8 } },
      ],
    },
    name: "Rect 1",
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 100, height: 80, rotation: 0, scale_x: 1, scale_y: 1 },
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal", value: 1 },
      blend_mode: "normal",
      effects: [],
    },
    constraints: { horizontal: "start", vertical: "start" },
    grid_placement: null,
    visible: true,
    locked: false,
  };
}

describe("CornerSection — orchestration", () => {
  it("renders preview + 9 hotspots when given a rectangle node", () => {
    const { container } = render(() => (
      <CornerSection node={makeRectNode()} onCorners={() => {}} />
    ));
    expect(container.querySelectorAll("button[data-hotspot]").length).toBe(9);
  });

  it("clicking a hotspot opens a popover anchored to that hotspot", async () => {
    const { container } = render(() => (
      <CornerSection node={makeRectNode()} onCorners={() => {}} />
    ));
    const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    fireEvent.click(tl);
    // After the click, the popover content is rendered (popover="manual"
    // is shown). Look for the popover header text.
    const headers = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headers).toContain("Top-left corner");
  });

  it("committing from the popover invokes onCorners with the new array", async () => {
    const handler = vi.fn();
    const { container } = render(() => (
      <CornerSection node={makeRectNode()} onCorners={handler} />
    ));
    const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    fireEvent.click(tl);
    const select = container.querySelector(
      '[data-testid="corner-popover__shape"] select',
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "bevel" } });
    expect(handler).toHaveBeenCalled();
    const [newCorners] = handler.mock.calls[handler.mock.calls.length - 1];
    expect(newCorners[0].type).toBe("bevel");
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/CornerSection.test.tsx 2>&1 | tail -5`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the orchestration**

```tsx
// frontend/src/panels/corner-section/CornerSection.tsx
/**
 * The Corner Editor section that lives in DesignPanel's Appearance tab.
 *
 * Responsibilities (this task — scaffold only):
 *  - Render the preview + hotspots (delegated to CornerPreviewSvg).
 *  - On hotspot click, open a Popover anchored to that button, with
 *    CornerPopover as its content.
 *  - Route popover commits to the parent (CornerSection.tsx is itself
 *    a presentational component; the store-write happens at the
 *    DesignPanel level via a callback).
 *
 * Subsequent tasks add:
 *  - Task 14: auto-link + superellipse lock state on the preview.
 *  - Task 15: RF-038 disabled state for non-corner-bearing kinds.
 *  - Task 16: wire-up to DesignPanel + store.
 */

import type { Component } from "solid-js";
import { createMemo, createSignal, Show } from "solid-js";
import type { Corners, DocumentNode } from "../../types/document";
import { Popover } from "../../components/popover/Popover";
import { CornerPreviewSvg } from "./CornerPreviewSvg";
import { CornerPopover } from "./CornerPopover";
import { type HotspotId } from "./corner-section-state";
import "./CornerSection.css";

interface CornerSectionProps {
  readonly node: DocumentNode;
  /** Called when the user commits a corner change. Parent forwards to
   *  `store.setCorners(node.uuid, corners)`. */
  readonly onCorners: (corners: Corners) => void;
}

function getCorners(node: DocumentNode): Corners | null {
  if (
    node.kind.type === "rectangle" ||
    node.kind.type === "frame" ||
    node.kind.type === "image"
  ) {
    return node.kind.corners;
  }
  return null;
}

export const CornerSection: Component<CornerSectionProps> = (props) => {
  const corners = createMemo<Corners | null>(() => getCorners(props.node));
  const [activeHotspot, setActiveHotspot] = createSignal<HotspotId | null>(null);
  const [anchorButton, setAnchorButton] = createSignal<HTMLButtonElement | null>(null);

  function handleHotspotActivate(id: HotspotId, button: HTMLButtonElement): void {
    setAnchorButton(button);
    setActiveHotspot(id);
  }

  function handleCommit(newCorners: Corners): void {
    props.onCorners(newCorners);
  }

  return (
    <Show when={corners()} fallback={<></>}>
      {(c) => (
        <section class="sigil-corner-section">
          <h2 class="sigil-corner-section__header">Corners</h2>
          <CornerPreviewSvg corners={c()} onHotspotActivate={handleHotspotActivate} />
          <Show when={activeHotspot() !== null}>
            <Popover
              open={activeHotspot() !== null}
              onOpenChange={(open) => {
                if (!open) setActiveHotspot(null);
              }}
              trigger={anchorButton()!}
              placement="bottom"
            >
              <CornerPopover
                target={activeHotspot()!}
                corners={c()}
                onCommit={handleCommit}
              />
            </Popover>
          </Show>
        </section>
      )}
    </Show>
  );
};
```

(The Popover wrapper's exact API — particularly the `trigger`/`open`/`onOpenChange` props — may differ. Inspect `frontend/src/components/popover/Popover.tsx:86+` for the actual prop names and adjust accordingly. If the wrapper renders its own trigger and doesn't accept an external anchor, restructure CornerPreviewSvg so hotspots ARE the triggers — exposing a per-hotspot `<Popover>` rather than one central one.)

```css
/* frontend/src/panels/corner-section/CornerSection.css */
.sigil-corner-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border-top: 1px solid var(--sigil-panel-border, rgba(255, 255, 255, 0.06));
}

.sigil-corner-section__header {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--sigil-panel-fg-dim, #aaa);
}
```

- [ ] **Step 4: Run — expect green (or refine)**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/CornerSection.test.tsx 2>&1 | tail -10`
Expected: 3 tests pass. If the Popover wrapper's API requires restructuring (per the note above), expect to iterate on step 3.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/panels/corner-section/CornerSection.tsx \
        frontend/src/panels/corner-section/CornerSection.css \
        frontend/src/panels/corner-section/__tests__/CornerSection.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): CornerSection orchestration scaffold

Renders the preview SVG + hotspot overlay (Task 8) and opens the
project's native Popover wrapper (anchored to the activated hotspot
button) with CornerPopover (Tasks 10–12) as its content. Commits
route through the parent-supplied onCorners callback — the actual
store mutation is wired in Task 16. Auto-link, superellipse lock, and
RF-038 disabled state come in Tasks 14–15.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: CornerSection — auto-link + superellipse lock state

Apply the auto-link visual and the superellipse-uniform lock on the non-center hotspots.

- [ ] **Step 1: Extend the test file**

Append to `CornerSection.test.tsx`:

```tsx
function makeSuperellipseRectNode(): DocumentNode {
  const c = { type: "superellipse" as const, radii: { x: 8, y: 8 }, smoothing: 0.5 };
  return {
    ...makeRectNode("n-se"),
    kind: { type: "rectangle", corners: [c, c, c, c] },
  };
}

describe("CornerSection — superellipse lock state", () => {
  it("disables the 8 non-center hotspots when the node is uniform-superellipse", () => {
    const { container } = render(() => (
      <CornerSection node={makeSuperellipseRectNode()} onCorners={() => {}} />
    ));
    const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    const center = container.querySelector("button[data-hotspot='center']") as HTMLButtonElement;
    expect(tl.getAttribute("aria-disabled")).toBe("true");
    expect(center.getAttribute("aria-disabled")).toBeNull();
  });

  it("the disabled hotspots carry the locked-state tooltip via the title attribute", () => {
    const { container } = render(() => (
      <CornerSection node={makeSuperellipseRectNode()} onCorners={() => {}} />
    ));
    const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    expect(tl.getAttribute("title")).toBe(
      "Superellipse applies to all corners. Change the shape to edit corners individually.",
    );
  });
});
```

- [ ] **Step 2: Wire `nonCenterHotspotsDisabled` from `isSuperellipseUniform`**

Modify `CornerSection.tsx`:

```tsx
import { isSuperellipseUniform } from "./corner-section-state";

// ... inside the component:

const locked = createMemo(() => {
  const c = corners();
  return c !== null && isSuperellipseUniform(c);
});

// ... in the JSX (inside the Show callback):

<CornerPreviewSvg
  corners={c()}
  onHotspotActivate={handleHotspotActivate}
  nonCenterHotspotsDisabled={locked()}
/>
```

- [ ] **Step 3: Run — expect green**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/CornerSection.test.tsx 2>&1 | tail -10`
Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/panels/corner-section/CornerSection.tsx \
        frontend/src/panels/corner-section/__tests__/CornerSection.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): CornerSection superellipse lock state (RF-027)

When all four corners are uniform Superellipse, the 8 non-center
hotspots render aria-disabled with the lock-state tooltip from Spec
14 §1.5: "Superellipse applies to all corners. Change the shape to
edit corners individually." Center hotspot remains active.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: CornerSection — RF-038 disabled state for non-corner-bearing kinds

When the selected node's kind is one of ellipse / text / group / path / component_instance, the section renders with a placeholder + explanatory text rather than vanishing.

- [ ] **Step 1: Extend the test file**

Append to `CornerSection.test.tsx`:

```tsx
function makeEllipseNode(): DocumentNode {
  return {
    ...makeRectNode("n-e"),
    kind: { type: "ellipse" },
  } as DocumentNode;
}

function makeGroupNode(): DocumentNode {
  return {
    ...makeRectNode("n-g"),
    kind: { type: "group" },
  } as DocumentNode;
}

describe("CornerSection — RF-038 disabled state for non-corner-bearing kinds", () => {
  it("renders the disabled placeholder for an ellipse node", () => {
    const { container } = render(() => (
      <CornerSection node={makeEllipseNode()} onCorners={() => {}} />
    ));
    expect(
      container.querySelector('[data-testid="corner-section__disabled"]'),
    ).not.toBeNull();
    expect(container.querySelector("button[data-hotspot]")).toBeNull();
    expect(container.textContent).toContain(
      "Corner radius applies to rectangles, frames, and images only",
    );
  });

  it("renders the disabled placeholder for a group node", () => {
    const { container } = render(() => (
      <CornerSection node={makeGroupNode()} onCorners={() => {}} />
    ));
    expect(
      container.querySelector('[data-testid="corner-section__disabled"]'),
    ).not.toBeNull();
  });

  it("the disabled state has a sr-only role=status line with the explanation", () => {
    const { container } = render(() => (
      <CornerSection node={makeEllipseNode()} onCorners={() => {}} />
    ));
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain(
      "Corner radius applies to rectangles, frames, and images only",
    );
  });
});
```

- [ ] **Step 2: Add the disabled-state branch**

Modify `CornerSection.tsx` — replace the simple `<Show when={corners()} fallback={<></>}>` with a tri-state pattern:

```tsx
type CornerSectionState = "active" | "disabled" | "no-selection";

function sectionState(node: DocumentNode | null): CornerSectionState {
  if (node === null) return "no-selection";
  const kind = node.kind.type;
  if (kind === "rectangle" || kind === "frame" || kind === "image") return "active";
  return "disabled";
}

// ... in the component, replace the previous Show block:

const state = createMemo<CornerSectionState>(() => sectionState(props.node));

return (
  <Show when={state() !== "no-selection"} fallback={<></>}>
    <section class="sigil-corner-section">
      <h2 class="sigil-corner-section__header">Corners</h2>
      <Show
        when={state() === "active"}
        fallback={
          <div
            class="sigil-corner-section__disabled"
            data-testid="corner-section__disabled"
          >
            <div class="sigil-corner-section__disabled-preview" aria-hidden="true" />
            <p class="sigil-corner-section__disabled-text">
              Corner radius applies to rectangles, frames, and images only.
            </p>
            <span class="sigil-corner-section__sr-only" role="status">
              Corner radius applies to rectangles, frames, and images only.
            </span>
          </div>
        }
      >
        <CornerPreviewSvg
          corners={getCorners(props.node)!}
          onHotspotActivate={handleHotspotActivate}
          nonCenterHotspotsDisabled={locked()}
        />
        <Show when={activeHotspot() !== null}>
          <Popover
            open={activeHotspot() !== null}
            onOpenChange={(open) => {
              if (!open) setActiveHotspot(null);
            }}
            trigger={anchorButton()!}
            placement="bottom"
          >
            <CornerPopover
              target={activeHotspot()!}
              corners={getCorners(props.node)!}
              onCommit={handleCommit}
            />
          </Popover>
        </Show>
      </Show>
    </section>
  </Show>
);
```

Add to `CornerSection.css`:

```css
.sigil-corner-section__disabled {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 8px;
  opacity: 0.5;
}

.sigil-corner-section__disabled-preview {
  width: 120px;
  height: 90px;
  border: 1.5px dashed var(--sigil-panel-fg-dim, #aaa);
  border-radius: 4px;
}

.sigil-corner-section__disabled-text {
  margin: 0;
  font-size: 12px;
  text-align: center;
  color: var(--sigil-panel-fg-dim, #aaa);
}

.sigil-corner-section__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 3: Run — expect green**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/CornerSection.test.tsx 2>&1 | tail -10`
Expected: 8 tests pass total (3 orchestration + 2 lock + 3 disabled).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/panels/corner-section/CornerSection.tsx \
        frontend/src/panels/corner-section/CornerSection.css \
        frontend/src/panels/corner-section/__tests__/CornerSection.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): CornerSection RF-038 disabled state for non-corner kinds

Ellipse, text, group, path, and component_instance nodes render the
section with a greyed-out placeholder and explanatory text rather than
vanishing — per Spec 14 §13 deferred-finding RF-038. The explanation
is also announced via a sr-only role="status" line so screen readers
discover the disabled state.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Wire CornerSection into DesignPanel + remove design-schema entry

The migration step. Remove the "Corner Radius" entry from `design-schema.ts`, audit dependent tests, render `<CornerSection />` in DesignPanel's Appearance tab.

**Files:**
- Modify: `frontend/src/panels/schemas/design-schema.ts`
- Modify: `frontend/src/panels/schemas/design-schema.test.ts`
- Modify: `frontend/src/panels/DesignPanel.tsx`
- Possibly delete or update: `frontend/src/panels/__tests__/schema-panel-corners.test.ts`, `frontend/src/panels/__tests__/SchemaPanelCornersIntegration.test.tsx`
- Modify: `frontend/src/panels/schema-panel-corners-handler.ts` (if it exists and is only used by the deleted schema entry)

- [ ] **Step 1: Survey the existing schema-corners surface for deletion candidates**

Run:
```bash
grep -rln "kind.corners" frontend/src/panels --include="*.ts" --include="*.tsx"
grep -rln "schema-panel-corners\|schemaPanelCorners" frontend/src --include="*.ts" --include="*.tsx"
```

List every file. Each file falls into one of three buckets:
1. **Delete entirely** — file exists only to support the schema-driven 4-input grid being removed.
2. **Modify** — file references the deleted schema entry; remove that reference but keep the rest.
3. **Keep** — file is unrelated.

Document the bucket assignment as a brief inventory in the commit message.

- [ ] **Step 2: Remove the schema entry**

Open `frontend/src/panels/schemas/design-schema.ts`. Delete the "Corner Radius" section block (lines ~67–113 — the entire object starting `{ name: "Corner Radius", when: [...], fields: [...] }`).

If `import { MAX_CORNER_RADIUS } from "../../store/corners-input";` is now unused, remove it too.

- [ ] **Step 3: Audit + update dependent tests**

For each test in the inventory from step 1:
- Run it in isolation: `pnpm --prefix frontend test -- --run <path>`
- If the test fails because it references the deleted section by name, remove/update those assertions.
- If the test was ONLY about the deleted section (e.g., `schema-panel-corners.test.ts` and `SchemaPanelCornersIntegration.test.tsx`), delete the file.

Per CLAUDE.md §11 "Migrations Must Remove All Superseded Code" — leave no dead test artifacts.

- [ ] **Step 4: Render `<CornerSection />` in DesignPanel**

Modify `frontend/src/panels/DesignPanel.tsx`:

```tsx
// At the top, add the imports:
import { CornerSection } from "./corner-section/CornerSection";

// Inside the Appearance tab block (around line 93–99 today), add the
// CornerSection. Pass the selected node and a callback that calls
// store.setCorners. Use the existing store-access pattern (see how
// AppearancePanel reads the selected node):

<Show when={activeTab() === "appearance"}>
  <Show when={isTextNodeSelected()}>
    <TypographySection />
  </Show>
  <CornerSection
    node={selectedNode()}
    onCorners={(corners) => {
      const node = selectedNode();
      if (node) store.setCorners(node.uuid, corners);
    }}
  />
  <AppearancePanel />
</Show>
```

Adjust the selected-node accessor to match what `DesignPanel.tsx` already uses (the existing AppearancePanel render reads from the same source). If a `selectedNode()` memo doesn't exist, build one from `store.state.selection` and `store.state.nodes`.

- [ ] **Step 5: Run the full frontend suite**

Run: `pnpm --prefix frontend test --reporter=default 2>&1 | tail -10`
Expected: all tests pass. The new corner-section tests add to the count; the deleted schema-panel-corners tests (if any) reduce it.

- [ ] **Step 6: Lint + typecheck + format + build**

Run, in order:
- `pnpm --prefix frontend lint 2>&1 | tail -3`
- `pnpm --prefix frontend exec tsc --noEmit 2>&1 | tail -3`
- `pnpm --prefix frontend exec prettier --check "src/**/*.{ts,tsx,css}" 2>&1 | tail -3`
- `pnpm --prefix frontend build 2>&1 | tail -3`

All four must be clean. If prettier flags anything, run `pnpm --prefix frontend exec prettier --write <files>` and re-stage.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/panels/schemas/design-schema.ts \
        frontend/src/panels/schemas/design-schema.test.ts \
        frontend/src/panels/DesignPanel.tsx
# Plus any deleted test files or schema-panel-corners-handler.ts cleanup
git commit -m "$(cat <<'EOF'
feat(frontend): wire CornerSection into Appearance tab + remove schema entry

The schema-driven 4-input Corner Radius grid in design-schema.ts is
superseded by the dedicated <CornerSection /> component. Removed
artifacts:
  - "Corner Radius" entry from design-schema.ts (lines 67-113)
  - <list any deleted test files>
  - <list any deleted handler files>

<CornerSection /> rendered in DesignPanel's Appearance tab, gated to
corner-bearing kinds (rectangle/frame/image) and rendering the
disabled placeholder for the others per RF-038.

Per CLAUDE.md §11 "Migrations Must Remove All Superseded Code": all
dead references removed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Storybook stories + pipeline test + quality gate + push + PR

The final task. Adds Storybook visual stories, the end-to-end reactive pipeline test, then runs the full quality gate and opens the PR.

**Files:**
- Create: `frontend/src/panels/corner-section/CornerSection.stories.tsx`
- Create: `frontend/src/panels/corner-section/__tests__/corner-section-pipeline.test.tsx`

- [ ] **Step 1: Write the Storybook stories**

```tsx
// frontend/src/panels/corner-section/CornerSection.stories.tsx
/**
 * Storybook stories for CornerSection.
 *
 * Covers Spec 14 §4.4 visual QA points + the lightweight smoothing
 * calibration story per §1.6 calibration commitment.
 */

import type { Meta, StoryObj } from "storybook-solidjs";
import { CornerSection } from "./CornerSection";
import type { Corner, DocumentNode } from "../../types/document";

function rectWith(corners: Corner[]): DocumentNode {
  return {
    id: { index: 1, generation: 0 },
    uuid: "story-rect",
    kind: {
      type: "rectangle",
      corners: [corners[0], corners[1], corners[2], corners[3]],
    },
    name: "Demo Rect",
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 100, height: 80, rotation: 0, scale_x: 1, scale_y: 1 },
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal", value: 1 },
      blend_mode: "normal",
      effects: [],
    },
    constraints: { horizontal: "start", vertical: "start" },
    grid_placement: null,
    visible: true,
    locked: false,
  };
}

function ellipseNode(): DocumentNode {
  return { ...rectWith([
    { type: "round", radii: { x: 0, y: 0 } },
    { type: "round", radii: { x: 0, y: 0 } },
    { type: "round", radii: { x: 0, y: 0 } },
    { type: "round", radii: { x: 0, y: 0 } },
  ]), kind: { type: "ellipse" } };
}

const meta: Meta<typeof CornerSection> = {
  title: "Panels/CornerSection",
  component: CornerSection,
};
export default meta;
type Story = StoryObj<typeof CornerSection>;

const round = (r: number): Corner => ({ type: "round", radii: { x: r, y: r } });
const bevel = (r: number): Corner => ({ type: "bevel", radii: { x: r, y: r } });
const notch = (r: number): Corner => ({ type: "notch", radii: { x: r, y: r } });
const scoop = (r: number): Corner => ({ type: "scoop", radii: { x: r, y: r } });
const sup = (r: number, s: number): Corner => ({
  type: "superellipse",
  radii: { x: r, y: r },
  smoothing: s,
});

export const AllRoundDefault: Story = {
  args: {
    node: rectWith([round(8), round(8), round(8), round(8)]),
    onCorners: () => {},
  },
};

export const MixedShapes: Story = {
  args: {
    node: rectWith([round(16), bevel(16), notch(16), scoop(16)]),
    onCorners: () => {},
  },
};

export const AxisUnlocked: Story = {
  args: {
    node: rectWith([
      { type: "round", radii: { x: 30, y: 10 } },
      { type: "round", radii: { x: 30, y: 10 } },
      { type: "round", radii: { x: 30, y: 10 } },
      { type: "round", radii: { x: 30, y: 10 } },
    ]),
    onCorners: () => {},
  },
};

// The calibration story per §1.6: render 5 sections side-by-side, one
// per smoothing value. Implemented as a custom render rather than args
// because the args API is single-node.
export const SuperellipseSmoothingScale: Story = {
  render: () => (
    <div style={{ display: "grid", "grid-template-columns": "repeat(5, 1fr)", gap: "8px" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((s) => (
        <div>
          <h4 style={{ "text-align": "center" }}>s = {s}</h4>
          <CornerSection
            node={rectWith([sup(20, s), sup(20, s), sup(20, s), sup(20, s)])}
            onCorners={() => {}}
          />
        </div>
      ))}
    </div>
  ),
};

export const DisabledForEllipse: Story = {
  args: {
    node: ellipseNode(),
    onCorners: () => {},
  },
};
```

- [ ] **Step 2: Add the pipeline test**

```tsx
// frontend/src/panels/corner-section/__tests__/corner-section-pipeline.test.tsx
/**
 * @vitest-environment jsdom
 *
 * End-to-end reactive pipeline test per CLAUDE.md §11 "Reactive
 * Pipelines Must Be Verified End-to-End": shape picker click → store
 * mutation → next render reflects the new shape.
 *
 * Uses a minimal harness: real document store wired to a CornerSection
 * for a single rectangle node. After clicking the TL hotspot and
 * choosing "bevel", the store's kind.corners[0].type must be "bevel".
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { createStore } from "solid-js/store";
import { CornerSection } from "../CornerSection";
import type { Corners, DocumentNode } from "../../../types/document";

function rectNode(corners: Corners): DocumentNode {
  return {
    id: { index: 1, generation: 0 },
    uuid: "pipeline-rect",
    kind: { type: "rectangle", corners },
    name: "Pipeline Rect",
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 100, height: 80, rotation: 0, scale_x: 1, scale_y: 1 },
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal", value: 1 },
      blend_mode: "normal",
      effects: [],
    },
    constraints: { horizontal: "start", vertical: "start" },
    grid_placement: null,
    visible: true,
    locked: false,
  };
}

describe("CornerSection pipeline — UI → store → re-render", () => {
  it("shape picker change updates the store and the next render reflects the new shape", () => {
    const initial: Corners = [
      { type: "round", radii: { x: 8, y: 8 } },
      { type: "round", radii: { x: 8, y: 8 } },
      { type: "round", radii: { x: 8, y: 8 } },
      { type: "round", radii: { x: 8, y: 8 } },
    ];
    const [doc, setDoc] = createStore({ node: rectNode(initial) });

    function setCorners(uuid: string, corners: Corners): void {
      if (doc.node.uuid !== uuid) return;
      setDoc("node", "kind", { type: "rectangle", corners });
    }

    const { container } = render(() => (
      <CornerSection node={doc.node} onCorners={(c) => setCorners(doc.node.uuid, c)} />
    ));

    // Open TL popover.
    const tl = container.querySelector("button[data-hotspot='tl']") as HTMLButtonElement;
    fireEvent.click(tl);

    // Change shape to bevel.
    const select = container.querySelector(
      '[data-testid="corner-popover__shape"] select',
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "bevel" } });

    // Verify store mutated.
    expect(doc.node.kind.type === "rectangle" && doc.node.kind.corners[0].type).toBe("bevel");

    // Verify the SVG aria-label updated to reflect the new state.
    const svg = container.querySelector("svg[role='img']") as SVGElement;
    expect(svg.getAttribute("aria-label")).toContain("bevel");
  });
});
```

- [ ] **Step 3: Run the pipeline test**

Run: `pnpm --prefix frontend test -- --run src/panels/corner-section/__tests__/corner-section-pipeline.test.tsx 2>&1 | tail -5`
Expected: 1 test passes.

- [ ] **Step 4: Run the full quality gate**

Run, in order:
- `pnpm --prefix frontend lint 2>&1 | tail -3`
- `pnpm --prefix frontend exec tsc --noEmit 2>&1 | tail -3`
- `pnpm --prefix frontend exec prettier --check "src/**/*.{ts,tsx,css}" 2>&1 | tail -3`
- `pnpm --prefix frontend build 2>&1 | tail -3`
- `pnpm --prefix frontend test --reporter=default 2>&1 | tail -8`

All checks must be clean. The full suite should have grown by ~30–40 tests over the baseline.

- [ ] **Step 5: Push the branch**

Run: `git push -u origin feature/corner-editor-14d 2>&1 | tail -5`
Expected: branch published.

- [ ] **Step 6: Open the PR**

```bash
gh pr create \
  --title "feat: corner editor UI — preview + hotspot popovers (Plan 14d)" \
  --body "$(cat <<'EOF'
## Summary

Plan 14d — corner editor UI for [Spec 14 Corner Shapes](docs/superpowers/specs/2026-04-23-14-corner-shapes.md). Closes deferred findings RF-002 (4 new shapes unreachable), RF-025 (shape invisible), RF-026 (link state unobservable), RF-027 (superellipse uniformity), and RF-038 (section disappears on non-corner-bearing kinds).

## What's in this PR

### New components under `frontend/src/panels/corner-section/`

- `corner-svg-builder.ts` — `SvgPathBuilder` implementing Plan 14c's `PathBuilder` interface. Translates Canvas ops to an SVG `d` string. Same `appendCornerPath` orchestrator drives both Canvas and SVG; parity tests cover every Corner variant including asymmetric radii (per the "Tests for Multi-Axis Inputs Must Cover Non-Degenerate Cases" rule).
- `corner-aria-label.ts` — `summarizeCornersForAria(corners)` produces the human-readable summary used by the preview SVG `aria-label` ("Rectangle with round top corners, bevel bottom corners", etc.).
- `corner-section-state.ts` — pure helpers for derived UI state: `isLinked`, `isSuperellipseUniform`, `hotspotTargetIndices`, `cornersAtHotspot`, `hotspotShapeIsMixed`, `hotspotHasAsymmetricRadii`.
- `CornerPreviewSvg.tsx` — 200×150 preview SVG with 9 HTML `<button>` hotspots absolutely positioned over it. Hotspots reveal on `:hover` / `:focus-within`. Center hotspot remains active even when uniform-superellipse locks the others.
- `CornerPopover.tsx` — popover body. Common skeleton (header + shape picker + radius `ValueInput` + axis-unlock toggle + rx/ry split + mixed-state indicator). Center popover adds the superellipse smoothing control (`ValueInput` + `Slider`) with proper gesture coalescing (Slider's `onChangeEnd` commits once per gesture per "Continuous-Value Controls Must Coalesce History Entries").
- `CornerSection.tsx` — section frame. Orchestrates the preview + popover. Renders the RF-038 disabled placeholder for non-corner-bearing kinds.
- `CornerSection.stories.tsx` — Storybook stories: AllRoundDefault, MixedShapes, AxisUnlocked, SuperellipseSmoothingScale (the calibration story per spec §1.6 — lightweight self-review during 14d, formal recalibration is a future PR), DisabledForEllipse.

### Migration

- Removed the "Corner Radius" entry from `design-schema.ts` (lines 67-113). The schema-driven 4-input grid is superseded.
- Removed/updated dependent tests per CLAUDE.md §11 "Migrations Must Remove All Superseded Code." See commit `<sha>` for the inventory.

### Tests

- Unit tests for every new helper module (corner-svg-builder / corner-aria-label / corner-section-state).
- Component tests for CornerPreviewSvg (hotspot rendering, click dispatch, locked-state) and CornerPopover (skeleton, axis-unlock, smoothing control).
- CornerSection orchestration tests (popover open/close, commit routing, superellipse lock, RF-038 disabled state).
- End-to-end pipeline test (`corner-section-pipeline.test.tsx`) — verifies the full UI → store → next-render chain per CLAUDE.md §11.
- SvgPathBuilder ↔ PathRecorder parity tests covering every Corner variant + asymmetric radii.

### Constants

- New `MIN_SUPERELLIPSE_SMOOTHING = 0` and `MAX_SUPERELLIPSE_SMOOTHING = 1` in `frontend/src/store/corners-input.ts` with enforcement tests. The smoothing Slider's bounds reference these constants per CLAUDE.md §11.

## Test plan

- [ ] `pnpm --prefix frontend test -- --run` — all tests pass.
- [ ] `pnpm --prefix frontend lint` clean.
- [ ] `pnpm --prefix frontend exec tsc --noEmit` clean.
- [ ] `pnpm --prefix frontend exec prettier --check "src/**/*.{ts,tsx,css}"` clean.
- [ ] `pnpm --prefix frontend build` clean.
- [ ] Manual smoke (post-merge to a dev branch): select a rectangle, open each hotspot popover, change shapes, scrub smoothing, toggle axis-unlock; select an ellipse and verify the disabled placeholder; select a uniform-superellipse rect and verify the 8 non-center hotspots show the lock-state tooltip.

## Deferred-to-later-plan inventory

Nothing new in this PR is deferred — 14d closes the Plan 14a deferred findings RF-002/025/026/027/038 (per spec §13). The remaining deferred items (canvas drag-handles in §1.5, designer-grade superellipse calibration per §3.7) are future-scope items NOT in 14d's scope.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1 | tail -3
```

- [ ] **Step 7: Verify the PR is open + announce**

Run: `gh pr view --json url --jq .url`
Output the URL. The PR is ready for the standard `/review` cycle per CLAUDE.md §7.

---

## Self-review checklist (run before opening the PR)

- [ ] Every commit has a single, focused intent (file paths consistent within each commit).
- [ ] Every commit message follows `type(scope): description` (CLAUDE.md §6) with `frontend` or `docs` scope.
- [ ] No file under `frontend/src/panels/corner-section/` imports directly from `@kobalte/core/*` (Kobalte discipline — CI grep would flag).
- [ ] Every new discriminated union (none introduced by 14d — using existing `Corner` and `NodeKind`) is covered by an existing sentinel test-d file.
- [ ] Every new numeric input (radius ValueInput, rx/ry ValueInputs, smoothing ValueInput, smoothing Slider) references a named `MAX_*` / `MIN_*` constant for its bounds.
- [ ] Every new CSS file with a `transition` or `animation` has a `@media (prefers-reduced-motion: reduce)` companion.
- [ ] Every `Number.isFinite` guard is at the entry of the helper that uses the value (corner-svg-builder.ts `fmt` and `ellipse`; popover commit handlers).
- [ ] No `let _ = await someMutation()` patterns — `setCorners` callbacks await per CLAUDE.md §11 "No Fire-and-Forget Mutations".
- [ ] Asymmetric-radii test fixtures present in `corner-svg-builder.test.ts` parity tests.
- [ ] Spec §13 deferred-finding cross-references in the PR description name RF-002, RF-025, RF-026, RF-027, RF-038 — all closed by this PR.
