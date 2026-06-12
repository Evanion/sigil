/**
 * Tests for font-loading.ts orchestrator.
 *
 * Mocks:
 * - urql Client (query method) — controls fontBytes responses
 * - FontFace / document.fonts — same mock pattern as font-face-loader.test.ts
 * - Solid.js reactive runtime — we use createRoot to provide a reactive owner
 * - font-face-loader (vi.mock with auto-spy) — allows specific tests to override
 *   loadFonts behavior (e.g. to make it reject) without affecting other tests
 *
 * Per CLAUDE.md testing standards: tests describe behavior, not implementation.
 */

// vi.mock is hoisted before imports by Vitest. The factory delegates to the
// real implementation by default via vi.importActual so that tests which need
// real FontFace loading continue to work; individual tests may override via
// vi.mocked(loadFonts).mockRejectedValueOnce(...).
vi.mock("../font-face-loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../font-face-loader")>();
  return {
    ...actual,
    loadFonts: vi.fn(actual.loadFonts),
  };
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { b64ToUint8Array, installFontLoadingOrchestrator, fontLoadVersion } from "../font-loading";
import { loadFonts } from "../font-face-loader";
import type { FontEntry, FontSource } from "../../types/document";

// ---------------------------------------------------------------------------
// Platform API mocks (FontFace + document.fonts)
// Same approach as font-face-loader.test.ts
// ---------------------------------------------------------------------------

interface MockFontFaceDescriptors {
  ascentOverride?: string;
  descentOverride?: string;
  lineGapOverride?: string;
  sizeAdjust?: string;
}

interface MockFontFaceInstance {
  family: string;
  source: Uint8Array | string;
  descriptors: MockFontFaceDescriptors;
  _rejectLoad: (reason: Error) => void;
  load: () => Promise<MockFontFaceInstance>;
}

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

let constructedFaces: MockFontFaceInstance[] = [];
let mockFonts: MockFonts;

function buildFontFaceMock(
  getFaces: () => MockFontFaceInstance[],
): new (
  family: string,
  source: Uint8Array | string,
  descriptors?: MockFontFaceDescriptors,
) => MockFontFaceInstance {
  function MockFontFaceConstructor(
    this: unknown,
    family: string,
    source: Uint8Array | string,
    descriptors: MockFontFaceDescriptors = {},
  ): MockFontFaceInstance {
    const face = makeMockFontFace(family, source, descriptors);
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
  vi.stubGlobal(
    "FontFace",
    buildFontFaceMock(() => constructedFaces),
  );
  Object.defineProperty(document, "fonts", {
    value: mockFonts,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(id: string, family: string, source: FontSource): FontEntry {
  return {
    id,
    family,
    postscript_name: family,
    source,
    metrics: {
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
    },
    fs_type: 0,
    embeddable: "embed",
    is_variable: false,
    axes: [],
  };
}

// ---------------------------------------------------------------------------
// Mock urql Client factory
// ---------------------------------------------------------------------------

type MockQueryResult = {
  data?: Record<string, unknown>;
  error?: { message: string };
};

function makeMockClient(responses: Map<string, MockQueryResult>) {
  return {
    query: vi.fn().mockImplementation((_doc: unknown, variables: Record<string, unknown>) => {
      const id = variables["id"] as string | undefined;
      const key = id ?? "__default__";
      const response = responses.get(key) ?? { data: { fontBytes: null } };
      return {
        toPromise: () => Promise.resolve(response),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Helpers for flushing async operations
// ---------------------------------------------------------------------------

/**
 * Wait for all microtasks and pending promises to settle.
 * Retries up to `maxTicks` times so that promise chains (fetch → decode → load)
 * fully resolve.
 */
async function flushAsync(maxTicks = 8): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

// ---------------------------------------------------------------------------
// b64ToUint8Array tests
// ---------------------------------------------------------------------------

describe("b64ToUint8Array", () => {
  it("should decode a valid base64 string to matching Uint8Array", () => {
    // "AQID" is base64 for bytes [1, 2, 3]
    const result = b64ToUint8Array("AQID");
    expect(result).not.toBeNull();
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("should return null for invalid base64 and log an error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = b64ToUint8Array("!!!not-valid-base64!!!");
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[font-loading]"),
      expect.objectContaining({ error: expect.any(String) }),
    );
    spy.mockRestore();
  });

  it("should return an empty Uint8Array for an empty string", () => {
    const result = b64ToUint8Array("");
    expect(result).not.toBeNull();
    expect(result).toEqual(new Uint8Array(0));
  });
});

// ---------------------------------------------------------------------------
// installFontLoadingOrchestrator — full orchestration
// ---------------------------------------------------------------------------

describe("installFontLoadingOrchestrator", () => {
  it("should fetch fontBytes, call loadFonts, and increment fontLoadVersion for a Custom entry", async () => {
    const rawBytes = new Uint8Array([0xde, 0xad, 0xbe]);
    // Encode to base64 as the server would return
    const b64 = btoa(String.fromCharCode(...rawBytes));

    const fontId = "custom-id-1";
    const client = makeMockClient(new Map([[fontId, { data: { fontBytes: b64 } }]]));

    const fontTable: Record<string, FontEntry> = {
      [fontId]: makeEntry(fontId, "CustomFont", { source: "custom", asset_uuid: "asset-1" }),
    };

    const versionBefore = fontLoadVersion();

    let disposeRoot: () => void = () => undefined;
    await new Promise<void>((resolve) => {
      disposeRoot = createRoot((dispose) => {
        installFontLoadingOrchestrator(
          () => fontTable,
          client as unknown as import("../font-loading").FontBytesClient,
        );
        // Effect has fired synchronously; async work is in-flight
        resolve();
        return dispose;
      });
    });

    await flushAsync();

    const versionAfter = fontLoadVersion();
    expect(versionAfter).toBe(versionBefore + 1);

    // FontFace was constructed with the custom family
    const customFace = constructedFaces.find((f) => f.family === "CustomFont");
    expect(customFace).toBeDefined();
    expect(mockFonts._added).toHaveLength(1);

    disposeRoot();
  });

  it("should call loadFonts with no bytes when fontBytes returns null, producing 'missing' result", async () => {
    const fontId = "custom-id-null";
    // Server returns null for this id
    const client = makeMockClient(new Map([[fontId, { data: { fontBytes: null } }]]));

    const fontTable: Record<string, FontEntry> = {
      [fontId]: makeEntry(fontId, "NoBytesFont", { source: "custom", asset_uuid: "asset-null" }),
    };

    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    let disposeRoot: () => void = () => undefined;
    await new Promise<void>((resolve) => {
      disposeRoot = createRoot((dispose) => {
        installFontLoadingOrchestrator(
          () => fontTable,
          client as unknown as import("../font-loading").FontBytesClient,
        );
        resolve();
        return dispose;
      });
    });

    await flushAsync();

    // No FontFace should have been created (custom with no bytes → missing)
    expect(constructedFaces).toHaveLength(0);
    // warn is emitted for missing bytes
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[font-face-loader]"),
      expect.objectContaining({ id: fontId }),
    );

    consoleWarnSpy.mockRestore();
    disposeRoot();
  });

  it("should log an error and skip when base64 decode fails, without crashing", async () => {
    const fontId = "custom-id-bad-b64";
    const client = makeMockClient(
      new Map([[fontId, { data: { fontBytes: "!!!invalid-base64!!!" } }]]),
    );

    const fontTable: Record<string, FontEntry> = {
      [fontId]: makeEntry(fontId, "BadB64Font", { source: "custom", asset_uuid: "asset-bad" }),
    };

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    let disposeRoot: () => void = () => undefined;
    await new Promise<void>((resolve) => {
      disposeRoot = createRoot((dispose) => {
        installFontLoadingOrchestrator(
          () => fontTable,
          client as unknown as import("../font-loading").FontBytesClient,
        );
        resolve();
        return dispose;
      });
    });

    await flushAsync();

    // Should not have constructed any FontFace (no bytes to pass)
    expect(constructedFaces).toHaveLength(0);
    // Error should have been logged for the decode failure
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[font-loading]"),
      expect.any(Object),
    );

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    disposeRoot();
  });

  it("should not re-fetch an already-processed id on a subsequent fontTable change", async () => {
    // This test uses a real Solid reactive signal to back the fontTable so that
    // adding a second entry genuinely re-triggers the orchestrator's createEffect
    // (unlike a plain object mutation which is invisible to Solid's tracking).
    const fontId1 = "id-stable-1";
    const fontId2 = "id-stable-2";
    const b64 = btoa(String.fromCharCode(1, 2, 3));

    const queryMock = vi
      .fn()
      .mockImplementation((_doc: unknown, variables: Record<string, unknown>) => {
        const id = variables["id"] as string;
        return {
          toPromise: () =>
            Promise.resolve({
              data: { fontBytes: id === fontId1 || id === fontId2 ? b64 : null },
            }),
        };
      });
    const client = { query: queryMock };

    // Use a Solid signal so that setTable() causes the effect to re-run.
    const [getFontTable, setFontTable] = createSignal<Record<string, FontEntry>>({
      [fontId1]: makeEntry(fontId1, "Font1", { source: "custom", asset_uuid: "a1" }),
    });

    let disposeRoot: () => void = () => undefined;
    await new Promise<void>((resolve) => {
      disposeRoot = createRoot((dispose) => {
        installFontLoadingOrchestrator(
          getFontTable,
          client as unknown as import("../font-loading").FontBytesClient,
        );
        // createEffect fires synchronously in the same microtask; async work is in-flight
        resolve();
        return dispose;
      });
    });

    // Let the first batch (fontId1) fully resolve
    await flushAsync();

    const queriesForId1After1stBatch = queryMock.mock.calls.filter(
      (args) => (args[1] as Record<string, unknown>)["id"] === fontId1,
    ).length;
    expect(queriesForId1After1stBatch).toBe(1);

    // Reactively add fontId2 — this mutates the signal and re-triggers the effect
    setFontTable((prev) => ({
      ...prev,
      [fontId2]: makeEntry(fontId2, "Font2", { source: "custom", asset_uuid: "a2" }),
    }));

    // Let the second batch (fontId2) fully resolve
    await flushAsync();

    // fontId2 must have been fetched exactly once
    const queriesForId2 = queryMock.mock.calls.filter(
      (args) => (args[1] as Record<string, unknown>)["id"] === fontId2,
    ).length;
    expect(queriesForId2).toBe(1);

    // fontId1 must NOT have been re-fetched — processedIds set guards it
    const queriesForId1Total = queryMock.mock.calls.filter(
      (args) => (args[1] as Record<string, unknown>)["id"] === fontId1,
    ).length;
    expect(queriesForId1Total).toBe(1); // still exactly 1, not re-dispatched

    disposeRoot();
  });

  it("should not update fontLoadVersion after teardown (destroyed guard)", async () => {
    const fontId = "teardown-id";
    const b64 = btoa(String.fromCharCode(9, 8, 7));

    const fontTable: Record<string, FontEntry> = {
      [fontId]: makeEntry(fontId, "TeardownFont", { source: "custom", asset_uuid: "td-1" }),
    };

    const versionBefore = fontLoadVersion();

    // Dispose root BEFORE the async load resolves.
    // We need to prevent the load from completing until after dispose.
    let resolveQuery: () => void = () => undefined;
    const slowQueryPromise = new Promise<void>((r) => {
      resolveQuery = r;
    });

    const slowClient = {
      query: vi.fn().mockImplementation(() => ({
        toPromise: () => slowQueryPromise.then(() => ({ data: { fontBytes: b64 } })),
      })),
    };

    let disposeRoot: () => void = () => undefined;
    await new Promise<void>((resolve) => {
      disposeRoot = createRoot((dispose) => {
        installFontLoadingOrchestrator(
          () => fontTable,
          slowClient as unknown as import("../font-loading").FontBytesClient,
        );
        resolve();
        return dispose;
      });
    });

    // Dispose the root BEFORE the query resolves
    disposeRoot();

    // Now unblock the query
    resolveQuery();
    await flushAsync();

    // fontLoadVersion should NOT have changed — destroyed guard prevented the update
    expect(fontLoadVersion()).toBe(versionBefore);
  });

  it("should handle a fetch error gracefully, logging a warning and not crashing", async () => {
    const fontId = "error-id";
    const client = {
      query: vi.fn().mockImplementation(() => ({
        toPromise: () => Promise.resolve({ error: { message: "network error" } }),
      })),
    };

    const fontTable: Record<string, FontEntry> = {
      [fontId]: makeEntry(fontId, "ErrorFont", { source: "custom", asset_uuid: "e1" }),
    };

    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    let disposeRoot!: () => void;
    await new Promise<void>((resolve) => {
      disposeRoot = createRoot((dispose) => {
        installFontLoadingOrchestrator(
          () => fontTable,
          client as unknown as import("../font-loading").FontBytesClient,
        );
        resolve();
        return dispose;
      });
    });

    await flushAsync();

    // No crash — warning logged for the fetch error
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[font-loading]"),
      expect.objectContaining({ id: fontId, error: "network error" }),
    );

    consoleWarnSpy.mockRestore();
    disposeRoot();
  });

  it("should load a system_reference entry without fetching fontBytes", async () => {
    const fontId = "sys-ref-id";
    // system_reference — no fontBytes fetch should occur
    const querySpy = vi
      .fn()
      .mockReturnValue({ toPromise: () => Promise.resolve({ data: { fontBytes: null } }) });
    const client = { query: querySpy };

    // Make the system font available
    mockFonts._checkMap.set('16px "SysFont"', true);

    const fontTable: Record<string, FontEntry> = {
      [fontId]: makeEntry(fontId, "SysFont", { source: "system_reference" }),
    };

    let disposeRoot!: () => void;
    await new Promise<void>((resolve) => {
      disposeRoot = createRoot((dispose) => {
        installFontLoadingOrchestrator(
          () => fontTable,
          client as unknown as import("../font-loading").FontBytesClient,
        );
        resolve();
        return dispose;
      });
    });

    await flushAsync();

    // query should NOT have been called for system_reference entries
    expect(querySpy).not.toHaveBeenCalled();

    disposeRoot();
  });

  it("should catch a loadFonts rejection, log an error, not increment fontLoadVersion, and not crash", async () => {
    // loadFonts is documented to never reject, but the orchestrator wraps it in
    // try-catch (~line 282) as a defensive measure. This test exercises that path
    // by making the vi.mock-wrapped loadFonts reject once.
    //
    // Expected behavior per the catch block:
    //   - console.error is called with "[font-loading] loadFonts threw unexpectedly"
    //   - the function returns early (no setFontLoadVersion call)
    //   - no unhandled promise rejection is thrown

    const fontId = "throws-id";
    const b64 = btoa(String.fromCharCode(0xde, 0xad));
    const client = makeMockClient(new Map([[fontId, { data: { fontBytes: b64 } }]]));

    const fontTable: Record<string, FontEntry> = {
      [fontId]: makeEntry(fontId, "ThrowsFont", { source: "custom", asset_uuid: "t1" }),
    };

    // Inject a rejection into the loadFonts mock for this test only.
    // The one-shot mockRejectedValueOnce is consumed on the first call and
    // does not bleed into subsequent tests.
    const expectedError = new Error("loadFonts internal boom");
    vi.mocked(loadFonts).mockRejectedValueOnce(expectedError);

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const versionBefore = fontLoadVersion();

    let disposeRoot!: () => void;
    await new Promise<void>((resolve) => {
      disposeRoot = createRoot((dispose) => {
        installFontLoadingOrchestrator(
          () => fontTable,
          client as unknown as import("../font-loading").FontBytesClient,
        );
        resolve();
        return dispose;
      });
    });

    await flushAsync();

    // The catch block must have logged the error
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[font-loading] loadFonts threw unexpectedly"),
      expect.objectContaining({ error: expectedError.message }),
    );

    // fontLoadVersion must NOT have been incremented — the catch block returns early
    // before the setFontLoadVersion call
    expect(fontLoadVersion()).toBe(versionBefore);

    consoleErrorSpy.mockRestore();
    disposeRoot();
  });
});
