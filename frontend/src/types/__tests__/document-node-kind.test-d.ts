import { describe, it, expectTypeOf } from "vitest";
import type { NodeKind } from "../document";

describe("NodeKind types", () => {
  it("NodeKind discriminant has eight variants", () => {
    type Types = NodeKind["type"];
    expectTypeOf<Types>().toEqualTypeOf<
      "frame" | "rectangle" | "ellipse" | "path" | "text" | "image" | "group" | "component_instance"
    >();
  });

  // Compile-time exhaustiveness sentinel for NodeKind dispatch sites.
  //
  // If a new NodeKind variant is added to the union without also adding an
  // arm to the canvas renderer's drawNode fill + stroke switches (and every
  // other dispatch site that branches on `node.kind.type`), the `_exhaustive`
  // assignment below will fail tsc with
  //   `Type "<new-variant>" is not assignable to type 'never'`.
  // That forces every reviewer to update the dispatch sites before the change
  // can land.
  it("NodeKind discriminant has an exhaustive switch sentinel", () => {
    function exhaustiveDispatch(k: NodeKind): string {
      switch (k.type) {
        case "frame":
          return "frame";
        case "rectangle":
          return "rectangle";
        case "ellipse":
          return "ellipse";
        case "path":
          return "path";
        case "text":
          return "text";
        case "image":
          return "image";
        case "group":
          return "group";
        case "component_instance":
          return "component_instance";
        default: {
          const _exhaustive: never = k;
          return _exhaustive;
        }
      }
    }
    expectTypeOf(exhaustiveDispatch).toBeFunction();
  });
});
