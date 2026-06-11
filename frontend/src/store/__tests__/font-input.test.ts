/**
 * Unit tests for parseFontEntry (font-input.ts).
 *
 * parseFontEntry is the single source-of-truth FontEntry validator shared by
 * parseFontsResponse (document-store-solid.tsx) and applyAddFont (apply-remote.ts).
 * These tests verify the validator's contract in isolation.
 */
import { describe, it, expect } from "vitest";
import type { FontEntry } from "../../types/document";
import { parseFontEntry } from "../font-input";

// ── Minimal valid fixture ─────────────────────────────────────────────────────

function makeValidEntry(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    family: "Inter",
    postscript_name: "Inter-Regular",
    source: { source: "bundled" },
    metrics: { units_per_em: 2048 },
    fs_type: 0,
    embeddable: "reference_system",
    is_variable: false,
    axes: [],
    ...overrides,
  };
}

// ── parseFontEntry ────────────────────────────────────────────────────────────

describe("parseFontEntry", () => {
  describe("valid inputs", () => {
    it("should return the entry cast to FontEntry when id and family are non-empty strings", () => {
      const input = makeValidEntry({ id: "test-id", family: "Roboto" });
      const result = parseFontEntry(input);
      expect(result).not.toBeNull();
      expect((result as FontEntry).id).toBe("test-id");
      expect((result as FontEntry).family).toBe("Roboto");
    });

    it("should preserve all fields of the input object in the returned entry", () => {
      const input = makeValidEntry({ id: "full-id", family: "Lato" });
      const result = parseFontEntry(input);
      expect(result).not.toBeNull();
      expect((result as FontEntry).postscript_name).toBe("Inter-Regular");
      expect((result as FontEntry).is_variable).toBe(false);
    });
  });

  describe("null / non-object inputs", () => {
    it("should return null when value is null", () => {
      expect(parseFontEntry(null)).toBeNull();
    });

    it("should return null when value is undefined", () => {
      expect(parseFontEntry(undefined)).toBeNull();
    });

    it("should return null when value is a string", () => {
      expect(parseFontEntry("not an object")).toBeNull();
    });

    it("should return null when value is a number", () => {
      expect(parseFontEntry(42)).toBeNull();
    });

    it("should return null when value is an array", () => {
      // Arrays are typeof 'object' but are not valid FontEntry objects
      expect(parseFontEntry([])).toBeNull();
    });
  });

  describe("missing or invalid id", () => {
    it("should return null when id field is absent", () => {
      const input = makeValidEntry();
      delete (input as Record<string, unknown>)["id"];
      expect(parseFontEntry(input)).toBeNull();
    });

    it("should return null when id is an empty string", () => {
      const input = makeValidEntry({ id: "" });
      expect(parseFontEntry(input)).toBeNull();
    });

    it("should return null when id is a number (not a string)", () => {
      const input = makeValidEntry({ id: 123 });
      expect(parseFontEntry(input)).toBeNull();
    });

    it("should return null when id is null", () => {
      const input = makeValidEntry({ id: null });
      expect(parseFontEntry(input)).toBeNull();
    });
  });

  describe("missing or invalid family", () => {
    it("should return null when family field is absent", () => {
      const input = makeValidEntry();
      delete (input as Record<string, unknown>)["family"];
      expect(parseFontEntry(input)).toBeNull();
    });

    it("should return null when family is an empty string", () => {
      const input = makeValidEntry({ family: "" });
      expect(parseFontEntry(input)).toBeNull();
    });

    it("should return null when family is a number (not a string)", () => {
      const input = makeValidEntry({ family: 0 });
      expect(parseFontEntry(input)).toBeNull();
    });

    it("should return null when family is null", () => {
      const input = makeValidEntry({ family: null });
      expect(parseFontEntry(input)).toBeNull();
    });
  });
});
