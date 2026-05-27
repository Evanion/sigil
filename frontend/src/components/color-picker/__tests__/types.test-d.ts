/**
 * Type-level exhaustiveness sentinel for ColorDisplayMode (Spec 18, RF-009).
 *
 * Per frontend-defensive.md "Discriminated Unions Must Have a Type-Level
 * Exhaustiveness Sentinel": any string-literal union used for runtime
 * dispatch needs a `.test-d.ts` that exhaustively switches on the
 * discriminant and ends with a `never` sentinel. Adding a new variant to
 * ColorDisplayMode without updating downstream dispatch sites should fail
 * `tsc --noEmit` on this file.
 *
 * Dispatch sites covered (update this list when adding/removing dispatch):
 *  - frontend/src/components/color-picker/ColorValueFields.tsx
 *    (two switches: field-shape memo around line 118, commit dispatch around line 239)
 *  - frontend/src/components/color-picker/ColorSpaceSwitcher.tsx
 *    (options memo around line 40 — option list must include every mode)
 *  - frontend/src/components/color-picker/ColorPicker.tsx
 *    (flushEmit branch around line 178 — `if (space === "display_p3")`)
 *
 * Note: `color-math.ts` and `value-input/input-helpers.ts` dispatch on the
 * `Color.space` STORAGE discriminant (which includes "oklab" but not "hsl"),
 * NOT on ColorDisplayMode. They are covered by the `Color` sentinel in
 * `frontend/src/types/__tests__/document-discriminated-unions.test-d.ts`.
 */

import { describe, it, expectTypeOf } from "vitest";
import type { ColorDisplayMode } from "../types";

describe("ColorDisplayMode exhaustiveness", () => {
  it("covers every color-display-mode variant", () => {
    /**
     * Exhaustive switch on every ColorDisplayMode value. If a new variant
     * is added to the union but not added here, tsc --noEmit fails because
     * the `_x: never` assignment becomes invalid — which then forces every
     * dispatch site listed in the file header to be updated.
     */
    function dispatch(m: ColorDisplayMode): string {
      switch (m) {
        case "srgb":
          return "srgb";
        case "display_p3":
          return "display_p3";
        case "oklch":
          return "oklch";
        case "hsl":
          return "hsl";
        default: {
          const _x: never = m;
          return _x;
        }
      }
    }
    expectTypeOf(dispatch).toBeFunction();
  });
});
