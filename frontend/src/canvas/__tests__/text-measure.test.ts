import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  measureTextLines,
  buildFontString,
  resolveFontFamily,
  FALLBACK_FONT_FAMILY,
} from "../text-measure";
import type { TextStyle, FontEntry } from "../../types/document";
import { DEFAULT_FONT_ENTRY_ID } from "../../types/document";

// ---------------------------------------------------------------------------
// Minimal CanvasRenderingContext2D mock
// The mock measureText returns width = (number of characters) * charWidth
// where charWidth is configurable per test. Default charWidth = 8.
// ---------------------------------------------------------------------------

function createMockCtx(charWidth = 8): CanvasRenderingContext2D {
  return {
    font: "",
    measureText: vi.fn(
      (text: string): Pick<TextMetrics, "width"> => ({
        width: text.length * charWidth,
      }),
    ),
  } as unknown as CanvasRenderingContext2D;
}

// ---------------------------------------------------------------------------
// Helper: build a minimal TextStyle for buildFontString tests
// ---------------------------------------------------------------------------

function makeStyle(overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    font_entry: DEFAULT_FONT_ENTRY_ID,
    font_size: { type: "literal", value: 16 },
    font_weight: 400,
    font_style: "normal",
    line_height: { type: "literal", value: 20 },
    letter_spacing: { type: "literal", value: 0 },
    text_align: "left",
    text_decoration: "none",
    text_color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
    ...overrides,
  };
}

/**
 * Build a minimal FontEntry for test tables.
 */
function makeFontEntry(id: string, family: string): FontEntry {
  return {
    id,
    family,
    postscript_name: family.replace(/\s+/g, "-"),
    source: { source: "bundled" },
    metrics: {
      units_per_em: 2048,
      ascent: 1984,
      descent: -432,
      line_gap: 0,
      cap_height: 1456,
      x_height: 1082,
      italic_angle: 0,
      avg_advance: 1000,
      panose: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const,
      is_serif: false,
    },
    fs_type: 0,
    embeddable: "reference_system",
    is_variable: false,
    axes: [],
  };
}

// ---------------------------------------------------------------------------
// measureTextLines
// ---------------------------------------------------------------------------

describe("measureTextLines", () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockCtx(8);
  });

  it("should return one line for a single line in auto_width mode", () => {
    const result = measureTextLines(ctx, "hello", "16px Arial", "auto_width", 0, 20);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].text).toBe("hello");
    // "hello" = 5 chars × 8px = 40
    expect(result.lines[0].width).toBe(40);
  });

  it("should return width equal to max line width in auto_width mode", () => {
    // Two explicit newlines — second line is longer
    const result = measureTextLines(ctx, "hi\nhello world", "16px Arial", "auto_width", 0, 20);
    // "hi" = 16, "hello world" = 11 * 8 = 88
    expect(result.width).toBe(88);
  });

  it("should preserve explicit newlines in auto_width mode", () => {
    const result = measureTextLines(ctx, "line one\nline two", "16px Arial", "auto_width", 0, 20);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].text).toBe("line one");
    expect(result.lines[1].text).toBe("line two");
  });

  it("should return one empty line for empty string", () => {
    const result = measureTextLines(ctx, "", "16px Arial", "auto_width", 0, 20);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].text).toBe("");
    expect(result.lines[0].width).toBe(0);
  });

  it("should set ctx.font to fontString before measuring", () => {
    const fontString = "bold 24px Helvetica";
    measureTextLines(ctx, "test", fontString, "auto_width", 0, 24);
    expect((ctx as unknown as { font: string }).font).toBe(fontString);
  });

  it("should wrap words at maxWidth in fixed_width mode", () => {
    // charWidth = 8. Words: "foo" (24px), "bar" (24px), "baz" (24px)
    // maxWidth = 55: "foo bar" = 7 chars * 8 = 56 → exceeds, so "bar" starts new line
    // Line 1: "foo bar" would be 56px > 55px, so we get "foo" then "bar baz"
    // Actually: we add word by word:
    //   current = "foo" (24) → fits
    //   try "foo bar" (56) > 55 → flush "foo", start "bar"
    //   try "bar baz" (48+8=?) wait... "bar baz" = 7 * 8 = 56 > 55 → flush "bar", start "baz"
    //   end → flush "baz"
    // So 3 lines: "foo", "bar", "baz"
    const result = measureTextLines(ctx, "foo bar baz", "16px Arial", "fixed_width", 55, 20);
    expect(result.lines.length).toBeGreaterThanOrEqual(2);
    // First line must not exceed maxWidth
    expect(result.lines[0].width).toBeLessThanOrEqual(55);
    // Width of result should equal maxWidth for fixed mode
    expect(result.width).toBe(55);
  });

  it("should treat a long single word as its own line in fixed_width mode", () => {
    // "superlongword" = 13 * 8 = 104px, maxWidth = 50
    const result = measureTextLines(ctx, "superlongword", "16px Arial", "fixed_width", 50, 20);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].text).toBe("superlongword");
  });

  it("should preserve explicit newlines when wrapping in fixed_width mode", () => {
    // Two paragraphs separated by explicit newline
    // maxWidth = 200 (wide enough for each word individually but wrapping paragraph 2)
    const result = measureTextLines(
      ctx,
      "para one\npara two three",
      "16px Arial",
      "fixed_width",
      200,
      20,
    );
    // "para one" = 8 chars * 8 = 64 ≤ 200 → 1 line
    // "para two three" = 14 chars * 8 = 112 ≤ 200 → 1 line
    expect(result.lines.length).toBeGreaterThanOrEqual(2);
    expect(result.lines[0].text).toBe("para one");
  });

  it("should compute height as lines.length * lineHeight", () => {
    const lineHeight = 24;
    const result = measureTextLines(
      ctx,
      "line1\nline2\nline3",
      "16px Arial",
      "auto_width",
      0,
      lineHeight,
    );
    expect(result.height).toBe(3 * lineHeight);
  });

  it("should assign increasing baseline y offsets per line", () => {
    const lineHeight = 20;
    const result = measureTextLines(ctx, "a\nb\nc", "16px Arial", "auto_width", 0, lineHeight);
    // y[i] should be strictly increasing
    expect(result.lines[1].y).toBeGreaterThan(result.lines[0].y);
    expect(result.lines[2].y).toBeGreaterThan(result.lines[1].y);
    // Each successive line differs by lineHeight
    expect(result.lines[1].y - result.lines[0].y).toBe(lineHeight);
  });

  it("should guard against non-finite maxWidth and fall back to auto_width behaviour", () => {
    // NaN maxWidth in fixed_width mode — must not throw or produce NaN in output
    const result = measureTextLines(ctx, "hello", "16px Arial", "fixed_width", NaN, 20);
    expect(Number.isFinite(result.width)).toBe(true);
    expect(result.lines[0].width).toBeGreaterThan(0);
  });

  it("should guard against non-finite lineHeight and return finite height", () => {
    const result = measureTextLines(ctx, "hello", "16px Arial", "auto_width", 0, NaN);
    expect(Number.isFinite(result.height)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildFontString
// ---------------------------------------------------------------------------

describe("buildFontString", () => {
  it("should build a normal weight font string from literal values", () => {
    const style = makeStyle({
      font_weight: 400,
      font_style: "normal",
      font_size: { type: "literal", value: 16 },
      font_entry: "arial-entry-id",
    });
    const resolver = (id: string) => (id === "arial-entry-id" ? "Arial" : FALLBACK_FONT_FAMILY);
    expect(buildFontString(style, resolver)).toBe("400 16px Arial");
  });

  it("should prepend italic when font_style is italic", () => {
    const style = makeStyle({
      font_style: "italic",
      font_size: { type: "literal", value: 14 },
      font_entry: "georgia-entry-id",
    });
    const resolver = (id: string) => (id === "georgia-entry-id" ? "Georgia" : FALLBACK_FONT_FAMILY);
    expect(buildFontString(style, resolver)).toBe("italic 400 14px Georgia");
  });

  it("should use default font size 16 for token_ref font_size", () => {
    const style = makeStyle({ font_size: { type: "token_ref", name: "font.body" } });
    expect(buildFontString(style, () => "Arial")).toContain("16px");
  });

  it("should handle bold weight", () => {
    const style = makeStyle({
      font_weight: 700,
      font_size: { type: "literal", value: 18 },
      font_entry: "roboto-entry-id",
    });
    const resolver = (id: string) => (id === "roboto-entry-id" ? "Roboto" : FALLBACK_FONT_FAMILY);
    expect(buildFontString(style, resolver)).toBe("700 18px Roboto");
  });

  it("should produce a string with no NaN values", () => {
    const style = makeStyle({ font_size: { type: "literal", value: NaN } });
    // Should fall back to default (16) for non-finite values
    const result = buildFontString(style, () => "Arial");
    expect(result).not.toContain("NaN");
  });

  it("should use fallback family when resolver returns a CSS-invalid value", () => {
    const style = makeStyle({ font_entry: "bad-entry-id" });
    const resolver = (_id: string) => "Bad'Family;"; // contains CSS-significant chars
    const result = buildFontString(style, resolver);
    // CSS-invalid family is replaced with 'sans-serif'
    expect(result).toContain("sans-serif");
    expect(result).not.toContain("Bad");
  });

  it("should use FALLBACK_FONT_FAMILY when no resolver is provided", () => {
    const style = makeStyle({ font_entry: DEFAULT_FONT_ENTRY_ID });
    const result = buildFontString(style); // no resolver — default returns FALLBACK_FONT_FAMILY
    expect(result).toContain(FALLBACK_FONT_FAMILY);
  });
});

// ---------------------------------------------------------------------------
// resolveFontFamily
// ---------------------------------------------------------------------------

describe("resolveFontFamily", () => {
  it("should return the family for a present font entry id", () => {
    const fontTable: Record<string, FontEntry> = {
      "some-id": makeFontEntry("some-id", "Roboto"),
    };
    expect(resolveFontFamily(fontTable, "some-id")).toBe("Roboto");
  });

  it("should return FALLBACK_FONT_FAMILY for an absent font entry id and emit a console.warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fontTable: Record<string, FontEntry> = {};
    const result = resolveFontFamily(fontTable, "missing-id-" + String(Math.random()));
    expect(result).toBe(FALLBACK_FONT_FAMILY);
    expect(warnSpy).toHaveBeenCalledWith(
      "resolveFontFamily: font entry not found in table",
      expect.objectContaining({ fontEntryId: expect.any(String) as string }),
    );
    warnSpy.mockRestore();
  });

  it("should return FALLBACK_FONT_FAMILY for a font entry with CSS-significant characters in family", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalidId = "invalid-css-id-" + String(Math.random());
    const fontTable: Record<string, FontEntry> = {
      [invalidId]: makeFontEntry(invalidId, "Bad'Family;"),
    };
    const result = resolveFontFamily(fontTable, invalidId);
    expect(result).toBe(FALLBACK_FONT_FAMILY);
    warnSpy.mockRestore();
  });

  it("should return a CSS-safe family for a valid font entry", () => {
    const fontTable: Record<string, FontEntry> = {
      [DEFAULT_FONT_ENTRY_ID]: makeFontEntry(DEFAULT_FONT_ENTRY_ID, "Inter"),
    };
    expect(resolveFontFamily(fontTable, DEFAULT_FONT_ENTRY_ID)).toBe("Inter");
  });
});
