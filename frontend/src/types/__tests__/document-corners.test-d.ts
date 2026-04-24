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
});
