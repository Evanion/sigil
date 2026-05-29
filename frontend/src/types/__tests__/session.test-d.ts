import { describe, it, expectTypeOf } from "vitest";
import type { SessionInfo, SessionState, GqlSessionState } from "../session";
import { assertSessionStateExhaustive } from "../session";

describe("SessionInfo wire-format type", () => {
  it("has the expected camelCase fields", () => {
    expectTypeOf<SessionInfo>().toHaveProperty("id").toEqualTypeOf<string>();
    expectTypeOf<SessionInfo>().toHaveProperty("workfilePath").toEqualTypeOf<string>();
    expectTypeOf<SessionInfo>().toHaveProperty("title").toEqualTypeOf<string>();
    expectTypeOf<SessionInfo>().toHaveProperty("openedAt").toEqualTypeOf<string>();
  });

  it("SessionState mirrors the Rust enum (PascalCase)", () => {
    expectTypeOf<SessionState>().toEqualTypeOf<"Live" | "Errored">();
  });

  it("GqlSessionState mirrors the GraphQL enum (SCREAMING_SNAKE_CASE)", () => {
    expectTypeOf<GqlSessionState>().toEqualTypeOf<"LIVE" | "ERRORED">();
  });

  it("assertSessionStateExhaustive accepts both variants", () => {
    // Compile-time check: this would fail to compile if a new variant
    // were added without updating the switch arms.
    assertSessionStateExhaustive("Live");
    assertSessionStateExhaustive("Errored");
  });
});
