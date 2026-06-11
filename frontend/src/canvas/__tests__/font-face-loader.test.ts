/**
 * Tests for font-face-loader.ts
 *
 * jsdom does not implement FontFace / document.fonts, so we mock them here.
 *
 * Conventions:
 * - Test names describe behavior, not implementation.
 * - Every test exercises the full external contract of its target function.
 * - No mocking of internal details — only the platform APIs that jsdom omits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildMetricFallback, loadFonts } from "../font-face-loader";
import type { FontEntry, FontMetrics, FontSource } from "../../types/document";

// ---------------------------------------------------------------------------
// Platform API mocks (FontFace + document.fonts)
// ---------------------------------------------------------------------------

interface MockFontFaceDescriptors {
  ascentOverride?: string;
  descentOverride?: string;
  lineGapOverride?: string;
  sizeAdjust?: string;
}

interface MockFontFaceInstance {
  family: string;
  /** Source: bytes as Uint8Array, or a local() CSS string. */
  source: Uint8Array | string;
  descriptors: MockFontFaceDescriptors;
  /** Call this to make face.load() reject on demand. */
  _rejectLoad: (reason: Error) => void;
  load: () => Promise<MockFontFaceInstance>;
}

/**
 * Factory for a FontFace mock whose load() can be made to reject.
 */
function makeMockFontFace(
  family: string,
  source: Uint8Array | string,
  descriptors: MockFontFaceDescriptors = {},
): MockFontFaceInstance {
  let reject_: (reason: Error) => void;
  let resolve_: (face: MockFontFaceInstance) => void;

  const loadPromise = new Promise<MockFontFaceInstance>((resolve, reject) => {
    resolve_ = resolve;
    reject_ = reject;
  });

  const instance: MockFontFaceInstance = {
    family,
    source,
    descriptors,
    _rejectLoad: (reason: Error) => reject_(reason),
    load: () => {
      resolve_(instance);
      return loadPromise;
    },
  };

  return instance;
}

/** Captured calls to document.fonts mock methods. */
interface MockFonts {
  _added: MockFontFaceInstance[];
  _deleted: MockFontFaceInstance[];
  _checkMap: Map<string, boolean>;
  add: (face: MockFontFaceInstance) => void;
  delete: (face: MockFontFaceInstance) => void;
  check: (query: string) => boolean;
}

function createMockFonts(checkDefaults: Map<string, boolean> = new Map()): MockFonts {
  const added: MockFontFaceInstance[] = [];
  const deleted: MockFontFaceInstance[] = [];

  return {
    _added: added,
    _deleted: deleted,
    _checkMap: checkDefaults,
    add(face) {
      added.push(face);
    },
    delete(face) {
      deleted.push(face);
    },
    check(query: string) {
      return checkDefaults.get(query) ?? false;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<FontMetrics> = {}): FontMetrics {
  return {
    units_per_em: 1000,
    ascent: 800,
    descent: -200,
    line_gap: 0,
    cap_height: 700,
    x_height: 500,
    italic_angle: 0,
    avg_advance: 550,
    panose: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    is_serif: false,
    ...overrides,
  };
}

function makeEntry(
  id: string,
  family: string,
  source: FontSource,
  metricsOverrides: Partial<FontMetrics> = {},
): FontEntry {
  return {
    id,
    family,
    postscript_name: family,
    source,
    metrics: makeMetrics(metricsOverrides),
    fs_type: 0,
    embeddable: "embed",
    is_variable: false,
    axes: [],
  };
}

// ---------------------------------------------------------------------------
// Test setup: install mocks on globalThis
// ---------------------------------------------------------------------------

let mockFonts: MockFonts;
// Track all FontFace instances constructed during a test
let constructedFaces: MockFontFaceInstance[] = [];

/**
 * Build a constructable FontFace mock function.
 *
 * vi.fn() wraps an arrow function which is NOT constructable (no [[Construct]]
 * internal slot). We need a regular function so `new FontFace(...)` works.
 * We capture the face instances in the module-level `constructedFaces` array
 * via closure over the array reference that gets reset in beforeEach.
 */
function buildFontFaceMock(
  getFaces: () => MockFontFaceInstance[],
  opts?: {
    rejectLoad?: Error;
  },
): new (
  family: string,
  source: Uint8Array | string,
  descriptors?: MockFontFaceDescriptors,
) => MockFontFaceInstance {
  // Must be a named regular function (not arrow) to be constructable.
  function MockFontFaceConstructor(
    this: unknown,
    family: string,
    source: Uint8Array | string,
    descriptors: MockFontFaceDescriptors = {},
  ): MockFontFaceInstance {
    const face = makeMockFontFace(family, source, descriptors);
    if (opts?.rejectLoad) {
      face._rejectLoad(opts.rejectLoad);
    }
    getFaces().push(face);
    return face;
  }
  return MockFontFaceConstructor as unknown as new (
    family: string,
    source: Uint8Array | string,
    descriptors?: MockFontFaceDescriptors,
  ) => MockFontFaceInstance;
}

beforeEach(() => {
  constructedFaces = [];
  mockFonts = createMockFonts();

  // Install the constructable FontFace mock.
  // Arrow functions can't be used with `new` — use buildFontFaceMock which
  // returns a regular function.
  vi.stubGlobal("FontFace", buildFontFaceMock(() => constructedFaces));

  // Mock document.fonts
  Object.defineProperty(document, "fonts", {
    value: mockFonts,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// buildMetricFallback — math
// ---------------------------------------------------------------------------

describe("buildMetricFallback", () => {
  it("should compute correct percentage strings for known metrics", () => {
    // units_per_em = 1000, ascent = 800, descent = -200, line_gap = 0, avg_advance = 550
    // ascentOverride  = 800/1000*100 = 80.00%
    // descentOverride = |-200|/1000*100 = 20.00%
    // lineGapOverride = 0/1000*100 = 0.00%
    // sizeAdjust = (550/1000) / 0.5 * 100 = 1.10 * 100 = 110.00%
    const metrics = makeMetrics();
    const result = buildMetricFallback(metrics);

    expect(result.ascentOverride).toBe("80.00%");
    expect(result.descentOverride).toBe("20.00%");
    expect(result.lineGapOverride).toBe("0.00%");
    expect(result.sizeAdjust).toBe("110.00%");
  });

  it("should handle asymmetric ascent vs absolute-descent (proves per-axis correctness)", () => {
    // ascent = 700 ≠ |descent| = 300 → different output per axis
    const metrics = makeMetrics({ ascent: 700, descent: -300, units_per_em: 1000 });
    const result = buildMetricFallback(metrics);

    expect(result.ascentOverride).toBe("70.00%");
    expect(result.descentOverride).toBe("30.00%"); // abs(-300)/1000*100
    expect(result.ascentOverride).not.toBe(result.descentOverride);
  });

  it("should return 100% for all descriptors when units_per_em is 0", () => {
    const metrics = makeMetrics({ units_per_em: 0 });
    const result = buildMetricFallback(metrics);

    expect(result.ascentOverride).toBe("100%");
    expect(result.descentOverride).toBe("100%");
    expect(result.lineGapOverride).toBe("100%");
    expect(result.sizeAdjust).toBe("100%");
  });

  it("should return 100% for all descriptors when units_per_em is negative", () => {
    const metrics = makeMetrics({ units_per_em: -1 });
    const result = buildMetricFallback(metrics);

    expect(result.ascentOverride).toBe("100%");
    expect(result.descentOverride).toBe("100%");
    expect(result.lineGapOverride).toBe("100%");
    expect(result.sizeAdjust).toBe("100%");
  });

  it("should return 100% for all descriptors when units_per_em is NaN", () => {
    const metrics = makeMetrics({ units_per_em: NaN });
    const result = buildMetricFallback(metrics);

    expect(result.ascentOverride).toBe("100%");
    expect(result.descentOverride).toBe("100%");
    expect(result.lineGapOverride).toBe("100%");
    expect(result.sizeAdjust).toBe("100%");
  });

  it("should return 100% for a specific descriptor when that metric is NaN", () => {
    const metrics = makeMetrics({ ascent: NaN });
    const result = buildMetricFallback(metrics);

    // ascentOverride falls back, others remain computed
    expect(result.ascentOverride).toBe("100%");
    // descent, line_gap, avg_advance are fine
    expect(result.descentOverride).toBe("20.00%");
  });

  it("should return 100% for sizeAdjust when avg_advance is Infinity", () => {
    const metrics = makeMetrics({ avg_advance: Infinity });
    const result = buildMetricFallback(metrics);

    expect(result.sizeAdjust).toBe("100%");
    // Other overrides are still computed from normal values
    expect(result.ascentOverride).toBe("80.00%");
  });

  it("should not produce NaN or Infinity in any returned string", () => {
    // Pathological metrics: all NaN
    const metrics = makeMetrics({
      units_per_em: NaN,
      ascent: NaN,
      descent: NaN,
      line_gap: NaN,
      avg_advance: NaN,
    });
    const result = buildMetricFallback(metrics);

    for (const val of Object.values(result)) {
      expect(val).not.toContain("NaN");
      expect(val).not.toContain("Infinity");
    }
  });

  it("should include a line_gap when it is positive", () => {
    const metrics = makeMetrics({ line_gap: 200, units_per_em: 1000 });
    const result = buildMetricFallback(metrics);

    expect(result.lineGapOverride).toBe("20.00%");
  });
});

// ---------------------------------------------------------------------------
// loadFonts — custom entries
// ---------------------------------------------------------------------------

describe("loadFonts (custom source)", () => {
  it("should load a custom font and return status loaded when bytes are provided", async () => {
    const entry = makeEntry("id-1", "MyFont", { source: "custom", asset_uuid: "uuid-1" });
    const bytes = new Uint8Array([1, 2, 3]);
    const bytesById = new Map([["id-1", bytes]]);

    const results = await loadFonts([entry], bytesById);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-1");
    expect(results[0].family).toBe("MyFont");
    expect(results[0].status).toBe("loaded");

    // FontFace constructed with correct family + bytes
    expect(constructedFaces).toHaveLength(1);
    expect(constructedFaces[0].family).toBe("MyFont");
    expect(constructedFaces[0].source).toBe(bytes);

    // Added to document.fonts
    expect(mockFonts._added).toHaveLength(1);
    expect(mockFonts._added[0]).toBe(constructedFaces[0]);
  });

  it("should return status missing when no bytes are provided for a custom font", async () => {
    const entry = makeEntry("id-2", "NoBytes", { source: "custom", asset_uuid: "uuid-2" });
    const bytesById = new Map<string, Uint8Array>();

    const results = await loadFonts([entry], bytesById);

    expect(results[0].status).toBe("missing");
    expect(constructedFaces).toHaveLength(0);
    expect(mockFonts._added).toHaveLength(0);
  });

  it("should return status error and revert face from document.fonts when load() rejects", async () => {
    const entry = makeEntry("id-3", "BadFont", { source: "custom", asset_uuid: "uuid-3" });
    const bytes = new Uint8Array([9, 8, 7]);
    const bytesById = new Map([["id-3", bytes]]);

    // Override FontFace to produce a face whose load() rejects.
    // Must be a constructable regular function — arrow functions can't be used with `new`.
    const loadError = new Error("font parse failed");
    vi.stubGlobal(
      "FontFace",
      buildFontFaceMock(() => constructedFaces, { rejectLoad: loadError }),
    );

    const results = await loadFonts([entry], bytesById);

    expect(results[0].status).toBe("error");
    expect(results[0].error).toContain("font parse failed");

    // The face was added then removed (revert)
    expect(mockFonts._added).toHaveLength(1);
    expect(mockFonts._deleted).toHaveLength(1);
    expect(mockFonts._deleted[0]).toBe(mockFonts._added[0]);
  });
});

// ---------------------------------------------------------------------------
// loadFonts — system_reference entries
// ---------------------------------------------------------------------------

describe("loadFonts (system_reference source)", () => {
  it("should return status loaded when document.fonts.check returns true", async () => {
    const entry = makeEntry("id-10", "Helvetica", { source: "system_reference" });
    // Simulate the system having this font
    mockFonts._checkMap.set('16px "Helvetica"', true);
    const bytesById = new Map<string, Uint8Array>();

    const results = await loadFonts([entry], bytesById);

    expect(results[0].status).toBe("loaded");
    // No FontFace should have been created
    expect(constructedFaces).toHaveLength(0);
    expect(mockFonts._added).toHaveLength(0);
  });

  it("should register a metric-preserving fallback when system font is absent", async () => {
    const entry = makeEntry("id-11", "MissingFont", { source: "system_reference" });
    // document.fonts.check returns false for this family (default)
    const bytesById = new Map<string, Uint8Array>();

    const results = await loadFonts([entry], bytesById);

    expect(results[0].status).toBe("fallback");

    // One FontFace created with local('Arial') and metric descriptors
    expect(constructedFaces).toHaveLength(1);
    const face = constructedFaces[0];
    expect(face.family).toBe("MissingFont");
    expect(face.source).toBe("local('Arial')");

    // Verify descriptors match buildMetricFallback output for default metrics
    const expected = buildMetricFallback(entry.metrics);
    expect(face.descriptors.ascentOverride).toBe(expected.ascentOverride);
    expect(face.descriptors.descentOverride).toBe(expected.descentOverride);
    expect(face.descriptors.lineGapOverride).toBe(expected.lineGapOverride);
    expect(face.descriptors.sizeAdjust).toBe(expected.sizeAdjust);

    // Added to document.fonts
    expect(mockFonts._added).toHaveLength(1);
    expect(mockFonts._added[0]).toBe(face);
  });

  it("should return error and revert fallback face when load() rejects", async () => {
    const entry = makeEntry("id-12", "EvilFont", { source: "system_reference" });
    const loadError = new Error("local font not available");

    // Must be constructable — arrow functions can't be used with `new`.
    vi.stubGlobal(
      "FontFace",
      buildFontFaceMock(() => constructedFaces, { rejectLoad: loadError }),
    );

    const bytesById = new Map<string, Uint8Array>();
    const results = await loadFonts([entry], bytesById);

    expect(results[0].status).toBe("error");
    expect(mockFonts._deleted).toHaveLength(1);
    expect(mockFonts._deleted[0]).toBe(mockFonts._added[0]);
  });
});

// ---------------------------------------------------------------------------
// loadFonts — bundled source
// ---------------------------------------------------------------------------

describe("loadFonts (bundled source)", () => {
  it("should return status loaded without creating a FontFace for bundled fonts", async () => {
    const entry = makeEntry("id-20", "Inter", { source: "bundled" });
    const bytesById = new Map<string, Uint8Array>();

    const results = await loadFonts([entry], bytesById);

    expect(results[0].status).toBe("loaded");
    expect(constructedFaces).toHaveLength(0);
    expect(mockFonts._added).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// loadFonts — library source (treated like system_reference)
// ---------------------------------------------------------------------------

describe("loadFonts (library source)", () => {
  it("should return status loaded when library font is available in document.fonts", async () => {
    const entry = makeEntry("id-30", "LibraryFont", {
      source: "library",
      catalog_id: "cat-1",
    });
    mockFonts._checkMap.set('16px "LibraryFont"', true);
    const bytesById = new Map<string, Uint8Array>();

    const results = await loadFonts([entry], bytesById);

    expect(results[0].status).toBe("loaded");
    expect(constructedFaces).toHaveLength(0);
  });

  it("should register a fallback when library font is absent", async () => {
    const entry = makeEntry("id-31", "AbsentLibFont", {
      source: "library",
      catalog_id: "cat-2",
    });
    const bytesById = new Map<string, Uint8Array>();

    const results = await loadFonts([entry], bytesById);

    expect(results[0].status).toBe("fallback");
    expect(constructedFaces).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// loadFonts — CSS-unsafe family name
// ---------------------------------------------------------------------------

describe("loadFonts (CSS-unsafe family name)", () => {
  it("should return error for a family containing a CSS-significant character", async () => {
    // Semicolon in family name is CSS-significant
    const entry = makeEntry("id-40", "Bad;Font", { source: "system_reference" });
    const bytesById = new Map<string, Uint8Array>();

    const results = await loadFonts([entry], bytesById);

    expect(results[0].status).toBe("error");
    expect(results[0].error).toContain("CSS-unsafe");
    // No document.fonts.check or FontFace call with the bad string
    expect(constructedFaces).toHaveLength(0);
    expect(mockFonts._added).toHaveLength(0);
  });

  it("should return error for a family containing a double-quote character", async () => {
    const entry = makeEntry('id-41', 'Bad"Font', { source: "custom", asset_uuid: "uuid-41" });
    const bytesById = new Map([['id-41', new Uint8Array([1])]]);

    const results = await loadFonts([entry], bytesById);

    expect(results[0].status).toBe("error");
    expect(constructedFaces).toHaveLength(0);
  });

  it("should return error for a family containing a C0 control character", async () => {
    const entry = makeEntry("id-42", "Bad\x01Font", { source: "bundled" });
    const bytesById = new Map<string, Uint8Array>();

    const results = await loadFonts([entry], bytesById);

    expect(results[0].status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// loadFonts — batch behaviour
// ---------------------------------------------------------------------------

describe("loadFonts (batch)", () => {
  it("should process multiple entries independently and return all results", async () => {
    const entries = [
      makeEntry("id-50", "FontA", { source: "bundled" }),
      makeEntry("id-51", "FontB", { source: "custom", asset_uuid: "uuid-51" }),
      makeEntry("id-52", "FontC", { source: "system_reference" }),
    ];
    // FontB has bytes
    const bytesById = new Map([["id-51", new Uint8Array([4, 5, 6])]]);
    // FontC is available in system
    mockFonts._checkMap.set('16px "FontC"', true);

    const results = await loadFonts(entries, bytesById);

    expect(results).toHaveLength(3);

    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(byId["id-50"].status).toBe("loaded"); // bundled
    expect(byId["id-51"].status).toBe("loaded"); // custom with bytes
    expect(byId["id-52"].status).toBe("loaded"); // system found
  });

  it("should not fail the whole batch when one entry errors", async () => {
    // First entry will fail (custom, no bytes)
    // Second entry succeeds (bundled)
    const entries = [
      makeEntry("id-60", "FailFont", { source: "custom", asset_uuid: "uuid-60" }),
      makeEntry("id-61", "Inter", { source: "bundled" }),
    ];
    const bytesById = new Map<string, Uint8Array>(); // no bytes

    const results = await loadFonts(entries, bytesById);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("missing"); // custom with no bytes
    expect(results[1].status).toBe("loaded"); // bundled
  });
});
