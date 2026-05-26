import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareLocaleTrees,
  compareLocalePlaceholders,
  loadLocaleNamespace,
  MAX_LOCALE_NESTING_DEPTH,
} from "../check-locale-parity.mjs";

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

  // RF-021: null leaf values must match across locales without divergence.
  it("treats null leaf values as keys (no divergence when both are null)", () => {
    const en = { a: null, b: "hello" };
    const fr = { a: null, b: "bonjour" };
    expect(compareLocaleTrees(en, fr)).toEqual({ missing: [], extra: [] });
  });

  // RF-021: arrays are leaves and are NOT recursed into.
  it("treats array values as leaves and does not produce indexed sub-keys", () => {
    const en = { items: [{ name: "first" }, { name: "second" }] };
    const fr = { items: [{ name: "premier" }, { name: "deuxième" }] };
    // If arrays were recursed, we would see `items.0.name` style keys.
    // The expected behavior is `items` is a leaf and matches.
    expect(compareLocaleTrees(en, fr)).toEqual({ missing: [], extra: [] });
  });

  // RF-021: structural mismatch — string at a path on one side, object on the other.
  it("reports structural mismatch (string vs object at same path)", () => {
    const en = { a: "string" };
    const fr = { a: { b: "deep" } };
    const result = compareLocaleTrees(en, fr);
    // `a` (leaf in en) is missing from fr's leaf set; `a.b` is extra in fr.
    expect(result.missing).toContain("a");
    expect(result.extra).toContain("a.b");
  });
});

// RF-011: depth guard enforcement.
describe("collectKeys depth guard", () => {
  it("throws when nesting depth meets MAX_LOCALE_NESTING_DEPTH", () => {
    // Build an object nested exactly MAX_LOCALE_NESTING_DEPTH + 1 deep.
    // Each recursion increments depth by 1; depth >= MAX triggers the throw.
    let obj = { leaf: "value" };
    for (let i = 0; i <= MAX_LOCALE_NESTING_DEPTH; i++) {
      obj = { inner: obj };
    }
    expect(() => compareLocaleTrees(obj, obj)).toThrow(/MAX_LOCALE_NESTING_DEPTH/);
  });

  it("accepts nesting depth one level below the limit", () => {
    // Depth = MAX - 1 should pass without throwing.
    let obj = { leaf: "value" };
    for (let i = 0; i < MAX_LOCALE_NESTING_DEPTH - 1; i++) {
      obj = { inner: obj };
    }
    expect(() => compareLocaleTrees(obj, obj)).not.toThrow();
  });

  it("test_max_locale_nesting_depth_enforced — exceeds limit throws", () => {
    // Sentinel test per CLAUDE.md §11 "Constant Enforcement Tests".
    let obj = { leaf: "value" };
    for (let i = 0; i <= MAX_LOCALE_NESTING_DEPTH + 5; i++) {
      obj = { inner: obj };
    }
    expect(() => compareLocaleTrees(obj, obj)).toThrow();
  });
});

// RF-010: placeholder parity.
describe("compareLocalePlaceholders", () => {
  it("returns no divergence when placeholder sets match across locales", () => {
    const en = { hello: "Hi {{name}}, you have {{count}} messages." };
    const fr = { hello: "Salut {{name}}, vous avez {{count}} messages." };
    expect(compareLocalePlaceholders(en, fr)).toEqual([]);
  });

  it("reports divergence when fr is missing a placeholder en has", () => {
    const en = { hello: "Hi {{name}}, welcome!" };
    const fr = { hello: "Bonjour, bienvenue !" };
    const result = compareLocalePlaceholders(en, fr);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      key: "hello",
      expected: ["name"],
      actual: [],
    });
  });

  it("reports divergence when fr adds a placeholder en does not have", () => {
    const en = { hello: "Hi there!" };
    const fr = { hello: "Salut {{name}} !" };
    const result = compareLocalePlaceholders(en, fr);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      key: "hello",
      expected: [],
      actual: ["name"],
    });
  });

  it("ignores keys that exist in en but are missing from the other locale", () => {
    const en = { a: "Hi {{name}}", b: "Bye {{user}}" };
    const fr = { a: "Salut {{name}}" }; // b missing — structural concern
    expect(compareLocalePlaceholders(en, fr)).toEqual([]);
  });

  it("ignores top-level _meta key when comparing placeholders", () => {
    const en = { greeting: "Hi {{name}}" };
    const fr = {
      _meta: { source: "Hi {{wrongPlaceholder}}" },
      greeting: "Salut {{name}}",
    };
    expect(compareLocalePlaceholders(en, fr)).toEqual([]);
  });

  it("handles nested keys correctly", () => {
    const en = { buttons: { greet: "Hi {{name}}" } };
    const fr = { buttons: { greet: "Salut" } };
    const result = compareLocalePlaceholders(en, fr);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("buttons.greet");
  });
});

// RF-021: loadLocaleNamespace error path coverage.
describe("loadLocaleNamespace", () => {
  it("throws a contextual error when the locale file is malformed JSON", () => {
    // Write a malformed file into the real locales directory under a
    // synthetic locale + namespace name so we don't collide with real
    // locales. Both name components are stripped from the in-repo
    // LOCALES/NAMESPACES allowlists, so this test data is invisible to
    // main().
    // Resolve the locales root relative to this test file.
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const localesRoot = join(__dirname, "..", "..", "src", "i18n", "locales");
    const syntheticLocaleDir = join(localesRoot, "__test_malformed__");
    const namespacePath = join(syntheticLocaleDir, "broken.json");
    try {
      mkdirSync(syntheticLocaleDir, { recursive: true });
      writeFileSync(namespacePath, "{ not valid json,,,");
      expect(() => loadLocaleNamespace("__test_malformed__", "broken")).toThrow(
        /Failed to parse JSON in .+broken\.json/,
      );
    } finally {
      rmSync(syntheticLocaleDir, { recursive: true, force: true });
    }
  });

  it("throws when the locale namespace file does not exist", () => {
    expect(() => loadLocaleNamespace("zz-nonexistent-locale", "tools")).toThrow(/Failed to read/);
  });
});
