import { describe, it, expect } from "vitest";
import { compareLocaleTrees } from "../check-locale-parity.mjs";

describe("compareLocaleTrees", () => {
  it("returns empty divergence list when trees match", () => {
    const en = { greeting: "Hello", buttons: { ok: "OK" } };
    const fr = { greeting: "Bonjour", buttons: { ok: "OK" } };
    expect(compareLocaleTrees(en, fr)).toEqual({ missing: [], extra: [] });
  });

  it("reports missing keys in the comparison locale", () => {
    const en = { greeting: "Hello", buttons: { ok: "OK" } };
    const fr = { greeting: "Bonjour" }; // missing buttons.ok
    expect(compareLocaleTrees(en, fr)).toEqual({
      missing: ["buttons.ok"],
      extra: [],
    });
  });

  it("reports extra keys in the comparison locale", () => {
    const en = { greeting: "Hello" };
    const fr = { greeting: "Bonjour", farewell: "Au revoir" };
    expect(compareLocaleTrees(en, fr)).toEqual({
      missing: [],
      extra: ["farewell"],
    });
  });

  it("ignores top-level _meta key", () => {
    const en = { greeting: "Hello" };
    const fr = {
      _meta: { source: "machine-assisted" },
      greeting: "Bonjour",
    };
    expect(compareLocaleTrees(en, fr)).toEqual({ missing: [], extra: [] });
  });

  it("recurses into nested objects", () => {
    const en = { a: { b: { c: "x" } } };
    const fr = { a: { b: {} } };
    expect(compareLocaleTrees(en, fr)).toEqual({
      missing: ["a.b.c"],
      extra: [],
    });
  });
});
