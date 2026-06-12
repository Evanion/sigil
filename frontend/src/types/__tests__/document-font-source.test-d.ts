// Compile-time exhaustiveness sentinels for FontSource and EmbedDecision.
//
// CLAUDE.md §11 "Discriminated Unions Must Have a Type-Level Exhaustiveness
// Sentinel": every discriminated union in frontend/src/types/ must have a
// colocated .test-d.ts file with a switch that ends in `default: never`.
//
// If a new variant is added to FontSource or EmbedDecision without also adding
// a corresponding arm at every dispatch site, the `_exhaustive: never`
// assignment below fails tsc with:
//   `Type "<new-variant>" is not assignable to type 'never'`
//
// Sources: crates/core/src/font.rs (FontSource, EmbedDecision).

import { describe, it, expectTypeOf } from "vitest";
import type { EmbedDecision, FontSource } from "../document";

describe("FontSource types", () => {
  it("FontSource discriminant has four variants", () => {
    type Sources = FontSource["source"];
    expectTypeOf<Sources>().toEqualTypeOf<"bundled" | "library" | "custom" | "system_reference">();
  });

  // Compile-time exhaustiveness sentinel for FontSource dispatch sites.
  //
  // Adding a new FontSource variant without updating this switch will fail tsc.
  it("FontSource discriminant has an exhaustive switch sentinel", () => {
    function exhaustiveFontSource(s: FontSource): string {
      switch (s.source) {
        case "bundled":
          return "bundled";
        case "library":
          return s.catalog_id;
        case "custom":
          return s.asset_uuid;
        case "system_reference":
          return "system_reference";
        default: {
          const _x: never = s;
          return _x;
        }
      }
    }
    expectTypeOf(exhaustiveFontSource).toBeFunction();
  });
});

describe("EmbedDecision types", () => {
  it("EmbedDecision has five variants", () => {
    expectTypeOf<EmbedDecision>().toEqualTypeOf<
      | "embed"
      | "reference_restricted"
      | "reference_system"
      | "reference_no_os2"
      | "reference_preview_print"
    >();
  });

  // Compile-time exhaustiveness sentinel for EmbedDecision dispatch sites.
  //
  // Adding a new EmbedDecision variant without updating this switch will fail tsc.
  it("EmbedDecision has an exhaustive switch sentinel", () => {
    function exhaustiveEmbedDecision(e: EmbedDecision): string {
      switch (e) {
        case "embed":
          return "embed";
        case "reference_restricted":
          return "reference_restricted";
        case "reference_system":
          return "reference_system";
        case "reference_no_os2":
          return "reference_no_os2";
        case "reference_preview_print":
          return "reference_preview_print";
        default: {
          const _x: never = e;
          return _x;
        }
      }
    }
    expectTypeOf(exhaustiveEmbedDecision).toBeFunction();
  });
});
