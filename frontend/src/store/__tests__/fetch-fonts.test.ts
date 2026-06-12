/**
 * Tests for parseFontsResponse and the fontTable store field (Task 15a).
 *
 * These tests exercise the module-level `parseFontsResponse` function
 * directly — no network calls, no Solid reactive context required.
 * `fetchFonts()` itself (the thin query→parse→setState wrapper) is not
 * separately integration-tested; its parsing logic is fully covered here
 * via `parseFontsResponse`, mirroring the existing `fetchTokens` pattern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseFontsResponse } from "../document-store-solid";
import type { FontEntry } from "../../types/document";

// ── Minimal valid FontEntry fixture ──────────────────────────────────────────

function makeFontEntry(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    family: "Inter",
    postscript_name: "Inter-Regular",
    source: { source: "bundled" },
    metrics: {
      units_per_em: 2048,
      ascent: 1984.0,
      descent: -432.0,
      line_gap: 0.0,
      cap_height: 1456.0,
      x_height: 1082.0,
      italic_angle: 0.0,
      avg_advance: 1000.0,
      panose: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      is_serif: false,
    },
    fs_type: 0,
    embeddable: "reference_system",
    is_variable: false,
    axes: [],
    ...overrides,
  };
}

// ── parseFontsResponse ────────────────────────────────────────────────────────

describe("parseFontsResponse", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("should populate fontTable keyed by entry id from a parsed array response", () => {
    const entry1 = makeFontEntry({ id: "id-1", family: "Inter" });
    const entry2 = makeFontEntry({ id: "id-2", family: "Roboto" });
    const data = { fonts: [entry1, entry2] };

    const result = parseFontsResponse(data);

    expect(Object.keys(result)).toHaveLength(2);
    expect(result["id-1"]).toBeDefined();
    expect((result["id-1"] as FontEntry).family).toBe("Inter");
    expect(result["id-2"]).toBeDefined();
    expect((result["id-2"] as FontEntry).family).toBe("Roboto");
  });

  it("should handle a JSON string scalar (urql may deliver already-parsed or string form)", () => {
    const entry = makeFontEntry({ id: "str-id", family: "Lato" });
    // Simulate urql delivering the scalar as a JSON string
    const data = { fonts: JSON.stringify([entry]) };

    const result = parseFontsResponse(data);

    expect(result["str-id"]).toBeDefined();
    expect((result["str-id"] as FontEntry).family).toBe("Lato");
  });

  it("should skip malformed entries with missing id and warn, but not crash", () => {
    const validEntry = makeFontEntry({ id: "valid-id", family: "Valid" });
    const missingId = { family: "NoId", postscript_name: "NoId-Regular" };
    const emptyId = { ...makeFontEntry(), id: "" };
    const nonObject = "not an object";

    const data = { fonts: [missingId, emptyId, nonObject, validEntry] };

    const result = parseFontsResponse(data);

    // Only the valid entry should be in the table
    expect(Object.keys(result)).toHaveLength(1);
    expect(result["valid-id"]).toBeDefined();

    // Each malformed entry should have triggered a warn
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it("should skip entries with missing/empty family and warn (family flows into ctx.font)", () => {
    const validEntry = makeFontEntry({ id: "valid-id", family: "Valid" });
    const missingFamily = { id: "no-family-id", postscript_name: "X-Regular" };
    const emptyFamily = { ...makeFontEntry({ id: "empty-family-id" }), family: "" };

    const data = { fonts: [missingFamily, emptyFamily, validEntry] };

    const result = parseFontsResponse(data);

    // Only the entry with a valid family survives.
    expect(Object.keys(result)).toHaveLength(1);
    expect(result["valid-id"]).toBeDefined();
    expect(result["no-family-id"]).toBeUndefined();
    expect(result["empty-family-id"]).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("should return empty table when fonts field is absent", () => {
    const result = parseFontsResponse({ other: "data" });
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("should return empty table when fonts field is null", () => {
    const result = parseFontsResponse({ fonts: null });
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("should return empty table and log error when fonts field is not an array", () => {
    const result = parseFontsResponse({ fonts: { not: "array" } });
    expect(Object.keys(result)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("expected array"),
      expect.any(String),
    );
  });

  it("should return empty table and log error when fonts is an invalid JSON string", () => {
    const result = parseFontsResponse({ fonts: "{ invalid json [[[" });
    expect(Object.keys(result)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to parse fonts JSON string"),
      expect.anything(),
    );
  });

  it("should return empty table when data is null or undefined", () => {
    expect(Object.keys(parseFontsResponse(null))).toHaveLength(0);
    expect(Object.keys(parseFontsResponse(undefined))).toHaveLength(0);
  });

  it("should return empty table when data is not an object", () => {
    expect(Object.keys(parseFontsResponse("string"))).toHaveLength(0);
    expect(Object.keys(parseFontsResponse(42))).toHaveLength(0);
  });

  it("should include all entries from an array with a single default bundled entry", () => {
    const defaultEntry = makeFontEntry({
      id: "00000000-0000-0000-0000-000000000001",
      family: "Inter",
      source: { source: "bundled" },
    });
    const data = { fonts: [defaultEntry] };

    const result = parseFontsResponse(data);

    expect(Object.keys(result)).toHaveLength(1);
    expect(result["00000000-0000-0000-0000-000000000001"]).toBeDefined();
  });
});
