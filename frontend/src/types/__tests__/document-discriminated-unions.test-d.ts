/**
 * Exhaustive-switch sentinels for the discriminated unions defined in
 * `frontend/src/types/document.ts` that don't already have a dedicated
 * sentinel file. Per the rule in `.claude/rules/frontend-defensive.md`
 * "Discriminated Unions Must Have a Type-Level Exhaustiveness Sentinel":
 * adding a new variant to any of these unions without updating the
 * corresponding switch below fails `tsc --noEmit`, which then forces
 * every downstream dispatch site to be updated.
 *
 * Per-union sentinel rules (do NOT remove without confirming there is
 * a different .test-d.ts that covers the same union):
 *  - Color discriminates on `space` ("srgb" | "display_p3" | "oklch" | "oklab")
 *  - Fill discriminates on `type` ("solid" | "linear_gradient" | ...)
 *  - Effect discriminates on `type` ("drop_shadow" | "inner_shadow" | ...)
 *  - GridTrack discriminates on `type` ("fixed" | "fractional" | "auto" | "min_max")
 *  - LayoutMode discriminates on `mode` ("flex" | "grid")
 *  - GridSpan discriminates on `type` ("auto" | "line" | "span" | "line_to_line")
 *  - PathSegment discriminates on `type` ("move_to" | "line_to" | "cubic_to" | "close")
 *
 * Corner and NodeKind are covered by their own dedicated sentinel files
 * (`document-corners.test-d.ts` and `document-node-kind.test-d.ts`).
 */

import { describe, it, expectTypeOf } from "vitest";
import type {
  Color,
  Effect,
  Fill,
  GridSpan,
  GridTrack,
  LayoutMode,
  PathSegment,
} from "../document";

describe("Color exhaustiveness", () => {
  it("Color discriminant covers every color-space variant", () => {
    function dispatch(c: Color): string {
      switch (c.space) {
        case "srgb":
          return "srgb";
        case "display_p3":
          return "display_p3";
        case "oklch":
          return "oklch";
        case "oklab":
          return "oklab";
        default: {
          const _x: never = c;
          return _x;
        }
      }
    }
    expectTypeOf(dispatch).toBeFunction();
  });
});

describe("Fill exhaustiveness", () => {
  it("Fill discriminant covers every fill-kind variant", () => {
    function dispatch(f: Fill): string {
      switch (f.type) {
        case "solid":
          return "solid";
        case "linear_gradient":
          return "linear_gradient";
        case "radial_gradient":
          return "radial_gradient";
        case "conic_gradient":
          return "conic_gradient";
        case "image":
          return "image";
        default: {
          const _x: never = f;
          return _x;
        }
      }
    }
    expectTypeOf(dispatch).toBeFunction();
  });
});

describe("Effect exhaustiveness", () => {
  it("Effect discriminant covers every effect-kind variant", () => {
    function dispatch(e: Effect): string {
      switch (e.type) {
        case "drop_shadow":
          return "drop_shadow";
        case "inner_shadow":
          return "inner_shadow";
        case "layer_blur":
          return "layer_blur";
        case "background_blur":
          return "background_blur";
        default: {
          const _x: never = e;
          return _x;
        }
      }
    }
    expectTypeOf(dispatch).toBeFunction();
  });
});

describe("GridTrack exhaustiveness", () => {
  it("GridTrack discriminant covers every track-kind variant", () => {
    function dispatch(t: GridTrack): string {
      switch (t.type) {
        case "fixed":
          return "fixed";
        case "fractional":
          return "fractional";
        case "auto":
          return "auto";
        case "min_max":
          return "min_max";
        default: {
          const _x: never = t;
          return _x;
        }
      }
    }
    expectTypeOf(dispatch).toBeFunction();
  });
});

describe("LayoutMode exhaustiveness", () => {
  it("LayoutMode discriminant covers every layout-mode variant", () => {
    function dispatch(m: LayoutMode): string {
      switch (m.mode) {
        case "flex":
          return "flex";
        case "grid":
          return "grid";
        default: {
          const _x: never = m;
          return _x;
        }
      }
    }
    expectTypeOf(dispatch).toBeFunction();
  });
});

describe("GridSpan exhaustiveness", () => {
  it("GridSpan discriminant covers every span-kind variant", () => {
    function dispatch(s: GridSpan): string {
      switch (s.type) {
        case "auto":
          return "auto";
        case "line":
          return "line";
        case "span":
          return "span";
        case "line_to_line":
          return "line_to_line";
        default: {
          const _x: never = s;
          return _x;
        }
      }
    }
    expectTypeOf(dispatch).toBeFunction();
  });
});

describe("PathSegment exhaustiveness", () => {
  it("PathSegment discriminant covers every segment-kind variant", () => {
    function dispatch(p: PathSegment): string {
      switch (p.type) {
        case "move_to":
          return "move_to";
        case "line_to":
          return "line_to";
        case "cubic_to":
          return "cubic_to";
        case "close":
          return "close";
        default: {
          const _x: never = p;
          return _x;
        }
      }
    }
    expectTypeOf(dispatch).toBeFunction();
  });
});
