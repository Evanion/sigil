/**
 * Font provider interface and system font list for the ValueInput component.
 *
 * Provides a list of available fonts for autocomplete in font_family fields.
 * The interface is extensible — workspace and plugin providers can be added
 * in later tasks without changing the consumer API.
 */

// ── Types ──────────────────────────────────────────────────────────────

/** Metadata for a single font family. */
export interface FontInfo {
  /** The font family name as it would appear in CSS. */
  readonly name: string;
  /** Where the font originates from. */
  readonly source: "system" | "workspace" | "plugin";
}

/** Interface for objects that can enumerate available fonts. */
export interface FontProvider {
  /** Returns the list of available font families. */
  listFonts(): readonly FontInfo[];
}

// ── Generic CSS families ───────────────────────────────────────────────

/**
 * The 10 CSS generic font families per the CSS Fonts Level 4 specification.
 * These always resolve on any platform and are safe to use as fallbacks.
 */
export const GENERIC_FAMILIES: readonly FontInfo[] = [
  { name: "serif", source: "system" },
  { name: "sans-serif", source: "system" },
  { name: "monospace", source: "system" },
  { name: "cursive", source: "system" },
  { name: "fantasy", source: "system" },
  { name: "system-ui", source: "system" },
  { name: "ui-serif", source: "system" },
  { name: "ui-sans-serif", source: "system" },
  { name: "ui-monospace", source: "system" },
  { name: "ui-rounded", source: "system" },
] as const;

// ── Common system fonts ────────────────────────────────────────────────

/**
 * A curated list of ~40 fonts commonly available on macOS, Windows, and
 * major Linux distributions. Used as a baseline for the autocomplete list
 * when no OS font enumeration API is available in the browser.
 *
 * Sources: CSS Font Stack (https://www.cssfontstack.com/), Google Fonts
 * safe fallbacks, and OS default font surveys.
 */
const SYSTEM_FONTS: readonly FontInfo[] = [
  // Sans-serif
  { name: "Arial", source: "system" },
  { name: "Arial Black", source: "system" },
  { name: "Helvetica", source: "system" },
  { name: "Helvetica Neue", source: "system" },
  { name: "Verdana", source: "system" },
  { name: "Tahoma", source: "system" },
  { name: "Trebuchet MS", source: "system" },
  { name: "Geneva", source: "system" },
  { name: "Gill Sans", source: "system" },
  { name: "Optima", source: "system" },
  { name: "Calibri", source: "system" },
  { name: "Candara", source: "system" },
  { name: "Segoe UI", source: "system" },
  { name: "Myriad Pro", source: "system" },
  { name: "Futura", source: "system" },
  // Serif
  { name: "Georgia", source: "system" },
  { name: "Times", source: "system" },
  { name: "Times New Roman", source: "system" },
  { name: "Palatino", source: "system" },
  { name: "Palatino Linotype", source: "system" },
  { name: "Book Antiqua", source: "system" },
  { name: "Garamond", source: "system" },
  { name: "Didot", source: "system" },
  { name: "Baskerville", source: "system" },
  { name: "Constantia", source: "system" },
  { name: "Cambria", source: "system" },
  // Monospace
  { name: "Courier New", source: "system" },
  { name: "Courier", source: "system" },
  { name: "Lucida Console", source: "system" },
  { name: "Monaco", source: "system" },
  { name: "Menlo", source: "system" },
  { name: "Consolas", source: "system" },
  { name: "Lucida Sans Typewriter", source: "system" },
  // Display / decorative
  { name: "Impact", source: "system" },
  { name: "Comic Sans MS", source: "system" },
  { name: "Copperplate", source: "system" },
  { name: "Papyrus", source: "system" },
  // CJK / multilingual
  { name: "Hiragino Sans", source: "system" },
  { name: "Noto Sans", source: "system" },
  { name: "Noto Serif", source: "system" },
  { name: "Noto Sans CJK", source: "system" },
] as const;

// ── SystemFontProvider ─────────────────────────────────────────────────

/**
 * Font provider that returns the combined list of CSS generic families
 * and common cross-platform system fonts.
 *
 * In a future task this will be replaced or augmented by a provider that
 * uses the CSS Font Loading API or the Local Font Access API to enumerate
 * fonts actually installed on the user's device.
 */
export class SystemFontProvider implements FontProvider {
  private readonly _fonts: readonly FontInfo[];

  constructor() {
    // Combine system fonts with generic families.
    // System fonts come first (more specific), generic families last.
    // Deduplicate by name to prevent duplicates if lists overlap.
    const seen = new Set<string>();
    const combined: FontInfo[] = [];

    for (const font of SYSTEM_FONTS) {
      if (!seen.has(font.name)) {
        seen.add(font.name);
        combined.push(font);
      }
    }

    for (const font of GENERIC_FAMILIES) {
      if (!seen.has(font.name)) {
        seen.add(font.name);
        combined.push(font);
      }
    }

    this._fonts = combined;
  }

  /**
   * Returns the complete list of available font families, sorted with
   * named system fonts first and generic CSS families at the end.
   */
  listFonts(): readonly FontInfo[] {
    return this._fonts;
  }
}
