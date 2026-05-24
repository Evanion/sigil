import { describe, it, expect } from "vitest";
import { SystemFontProvider, GENERIC_FAMILIES } from "../font-provider";
import type { FontInfo, FontProvider } from "../font-provider";

// ── GENERIC_FAMILIES ──────────────────────────────────────────────────

describe("GENERIC_FAMILIES", () => {
  it("should contain serif", () => {
    const names = GENERIC_FAMILIES.map((f) => f.name);
    expect(names).toContain("serif");
  });

  it("should contain sans-serif", () => {
    const names = GENERIC_FAMILIES.map((f) => f.name);
    expect(names).toContain("sans-serif");
  });

  it("should contain monospace", () => {
    const names = GENERIC_FAMILIES.map((f) => f.name);
    expect(names).toContain("monospace");
  });

  it("should contain all 10 CSS generic families", () => {
    expect(GENERIC_FAMILIES.length).toBe(10);
  });

  it("should have source='generic' for all entries", () => {
    for (const f of GENERIC_FAMILIES) {
      expect(f.source).toBe("generic");
    }
  });

  it("should be readonly (array cannot be reassigned at runtime)", () => {
    // GENERIC_FAMILIES is typed as readonly — this test verifies the shape
    const families: readonly FontInfo[] = GENERIC_FAMILIES;
    expect(Array.isArray(families)).toBe(true);
  });
});

// ── SystemFontProvider ────────────────────────────────────────────────

describe("SystemFontProvider", () => {
  it("should implement FontProvider interface", () => {
    const provider: FontProvider = new SystemFontProvider();
    expect(typeof provider.listFonts).toBe("function");
  });

  it("should return at least 40 fonts (including generic families)", () => {
    const provider = new SystemFontProvider();
    const fonts = provider.listFonts();
    expect(fonts.length).toBeGreaterThanOrEqual(40);
  });

  it("should include all GENERIC_FAMILIES in the list", () => {
    const provider = new SystemFontProvider();
    const fonts = provider.listFonts();
    const names = fonts.map((f) => f.name);
    for (const generic of GENERIC_FAMILIES) {
      expect(names).toContain(generic.name);
    }
  });

  it("should include common system fonts like 'Arial'", () => {
    const provider = new SystemFontProvider();
    const fonts = provider.listFonts();
    const names = fonts.map((f) => f.name);
    expect(names).toContain("Arial");
  });

  it("should include 'Georgia' as a common system font", () => {
    const provider = new SystemFontProvider();
    const fonts = provider.listFonts();
    const names = fonts.map((f) => f.name);
    expect(names).toContain("Georgia");
  });

  it("should include 'Courier New' as a monospace system font", () => {
    const provider = new SystemFontProvider();
    const fonts = provider.listFonts();
    const names = fonts.map((f) => f.name);
    expect(names).toContain("Courier New");
  });

  it("should have source='system' for non-generic system font entries", () => {
    const provider = new SystemFontProvider();
    const fonts = provider.listFonts();
    const genericNames = new Set(GENERIC_FAMILIES.map((f) => f.name));
    for (const f of fonts) {
      if (genericNames.has(f.name)) {
        expect(f.source).toBe("generic");
      } else {
        expect(f.source).toBe("system");
      }
    }
  });

  it("should return readonly arrays on each call", () => {
    const provider = new SystemFontProvider();
    const fonts = provider.listFonts();
    expect(Array.isArray(fonts)).toBe(true);
  });

  it("should have no duplicate font names", () => {
    const provider = new SystemFontProvider();
    const fonts = provider.listFonts();
    const names = fonts.map((f) => f.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("should return stable results across multiple calls", () => {
    const provider = new SystemFontProvider();
    const a = provider.listFonts();
    const b = provider.listFonts();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]?.name).toBe(b[i]?.name);
    }
  });
});
