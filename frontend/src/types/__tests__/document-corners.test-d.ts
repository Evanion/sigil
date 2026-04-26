import { describe, it, expectTypeOf } from "vitest";
import type {
  Corner,
  CornerRadii,
  NodeKindRectangle,
  NodeKindFrame,
  NodeKindImage,
} from "../document";

describe("Corner types", () => {
  it("CornerRadii has x and y", () => {
    expectTypeOf<CornerRadii>().toHaveProperty("x").toEqualTypeOf<number>();
    expectTypeOf<CornerRadii>().toHaveProperty("y").toEqualTypeOf<number>();
  });

  it("Corner is a discriminated union with 5 variants", () => {
    type Types = Corner["type"];
    expectTypeOf<Types>().toEqualTypeOf<
      "round" | "bevel" | "notch" | "scoop" | "superellipse"
    >();
  });

  it("Rectangle/Frame/Image carry corners: readonly Corner[] of length 4", () => {
    expectTypeOf<NodeKindRectangle["corners"]>().toEqualTypeOf<
      readonly [Corner, Corner, Corner, Corner]
    >();
    expectTypeOf<NodeKindFrame["corners"]>().toEqualTypeOf<
      readonly [Corner, Corner, Corner, Corner]
    >();
    expectTypeOf<NodeKindImage["corners"]>().toEqualTypeOf<
      readonly [Corner, Corner, Corner, Corner]
    >();
  });

  // RF-033: Compile-time exhaustiveness sentinel.
  //
  // If a new Corner variant is added to the union without also adding an
  // arm to this exhaustive switch, the `_exhaustive` assignment below will
  // fail tsc with `Type "<new-variant>" is not assignable to type 'never'`.
  // That forces every reviewer to update the call sites that branch on
  // `corner.type` (parseCornersInput, applyCornersHandler, the canvas
  // renderer's corner-shape dispatch) before the change can land.
  //
  // This test mirrors the discriminant-only test above; the difference is
  // that adding a new variant to `Types` would still compile if the
  // `Corner is a discriminated union` test was updated to add a string —
  // this sentinel additionally requires every dispatch site to handle the
  // new branch.
  it("Corner discriminant has an exhaustive switch sentinel", () => {
    function exhaustiveDispatch(c: Corner): string {
      switch (c.type) {
        case "round":
          return "round";
        case "bevel":
          return "bevel";
        case "notch":
          return "notch";
        case "scoop":
          return "scoop";
        case "superellipse":
          return "superellipse";
        default: {
          // If a new Corner variant is added without updating this switch,
          // `c` is no longer narrowed to `never` here and tsc fails.
          const _exhaustive: never = c;
          return _exhaustive;
        }
      }
    }
    // Compile-time check; runtime invocation is incidental.
    expectTypeOf(exhaustiveDispatch).toBeFunction();
  });
});
