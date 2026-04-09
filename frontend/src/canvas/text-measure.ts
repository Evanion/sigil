/**
 * Text measurement module for the canvas renderer.
 *
 * Computes line wrapping and dimensions for text nodes using a
 * CanvasRenderingContext2D for accurate font metrics. Used by the
 * canvas renderer and by auto-width resize logic.
 *
 * All numeric parameters are guarded with Number.isFinite() per CLAUDE.md
 * "Floating-Point Validation" — NaN or Infinity in layout calculations
 * propagates silently and corrupts downstream rendering.
 */

import type { TextStyle } from "../types/document";

/** Default font size used when the TextStyle font_size is a token_ref. */
export const DEFAULT_FONT_SIZE_PX = 16;

/** Fallback line height when an invalid lineHeight is supplied. */
const FALLBACK_LINE_HEIGHT_PX = 20;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MeasuredLine {
  /** The text content of this line. */
  text: string;
  /** The pixel width of this line as reported by ctx.measureText. */
  width: number;
  /**
   * Baseline y offset from the top of the text block.
   * Approximated as: lineIndex * lineHeight + fontSize.
   */
  y: number;
}

export interface TextMeasurement {
  /** Overall width of the text block. */
  width: number;
  /** Overall height of the text block (lines.length * lineHeight). */
  height: number;
  /** Individual measured lines. */
  lines: MeasuredLine[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Measure text, computing line breaks either from explicit newlines only
 * (auto_width) or by word-wrapping within maxWidth (fixed_width).
 *
 * @param ctx          - Canvas rendering context. ctx.font is set to fontString.
 * @param content      - The raw text content (may contain \n).
 * @param fontString   - CSS font string (e.g. "400 16px Arial").
 * @param sizing       - "auto_width" or "fixed_width".
 * @param maxWidth     - Maximum line width in pixels (used only in fixed_width).
 * @param lineHeight   - Line height in pixels.
 */
export function measureTextLines(
  ctx: CanvasRenderingContext2D,
  content: string,
  fontString: string,
  sizing: "auto_width" | "fixed_width",
  maxWidth: number,
  lineHeight: number,
): TextMeasurement {
  // Guard non-finite inputs.
  const safeLineHeight = Number.isFinite(lineHeight) ? lineHeight : FALLBACK_LINE_HEIGHT_PX;
  // For fixed_width mode, a non-finite maxWidth degrades to auto_width behaviour.
  const safeMaxWidth = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : 0;
  const effectiveSizing: "auto_width" | "fixed_width" =
    sizing === "fixed_width" && safeMaxWidth > 0 ? "fixed_width" : "auto_width";

  // Set font before any measuring so all calls use consistent metrics.
  ctx.font = fontString;

  const paragraphs = content.split("\n");

  let lines: Array<{ text: string; width: number }>;

  if (effectiveSizing === "auto_width") {
    lines = paragraphs.map((para) => {
      const w = ctx.measureText(para).width;
      return { text: para, width: w };
    });
  } else {
    // fixed_width: word-wrap each paragraph independently.
    lines = [];
    for (const para of paragraphs) {
      const wrappedLines = wrapParagraph(ctx, para, safeMaxWidth);
      for (const line of wrappedLines) {
        lines.push(line);
      }
    }
  }

  // Derive font size from fontString to approximate the baseline offset.
  // The fontString is CSS-like: "italic? weight size font-family".
  // We parse the first token that ends in "px".
  const fontSize = parseFontSizePx(fontString);

  // Build MeasuredLine array with y (baseline offset from top).
  const measuredLines: MeasuredLine[] = lines.map((line, index) => ({
    text: line.text,
    width: line.width,
    y: index * safeLineHeight + fontSize,
  }));

  const blockWidth =
    effectiveSizing === "fixed_width"
      ? safeMaxWidth
      : measuredLines.reduce((max, l) => Math.max(max, l.width), 0);

  return {
    width: blockWidth,
    height: measuredLines.length * safeLineHeight,
    lines: measuredLines,
  };
}

/**
 * Build a CSS font string from a TextStyle object.
 *
 * Format: "[italic ]<weight> <size>px <family>"
 *
 * font_size is taken from the literal value; when it is a token_ref (not
 * resolvable at this layer) DEFAULT_FONT_SIZE_PX (16) is used.
 * Non-finite font_size values also fall back to DEFAULT_FONT_SIZE_PX.
 */
export function buildFontString(style: TextStyle): string {
  const italic = style.font_style === "italic" ? "italic " : "";

  let fontSize: number;
  if (style.font_size.type === "literal") {
    const candidate = style.font_size.value;
    // Guard non-finite values per CLAUDE.md Floating-Point Validation.
    fontSize = Number.isFinite(candidate) ? candidate : DEFAULT_FONT_SIZE_PX;
  } else {
    // token_ref — cannot resolve tokens at this layer; use default.
    fontSize = DEFAULT_FONT_SIZE_PX;
  }

  return `${italic}${String(style.font_weight)} ${String(fontSize)}px ${style.font_family}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Word-wrap a single paragraph to fit within maxWidth.
 *
 * Words are split on whitespace. A word that exceeds maxWidth on its own is
 * placed on its own line without truncation (the caller — the renderer — is
 * responsible for clipping).
 */
function wrapParagraph(
  ctx: CanvasRenderingContext2D,
  paragraph: string,
  maxWidth: number,
): Array<{ text: string; width: number }> {
  const words = paragraph.split(/\s+/);
  const result: Array<{ text: string; width: number }> = [];

  // RF-014: Pre-measure space width once to avoid O(W*L) re-measuring of
  // the entire candidate string on each word. Instead, accumulate widths
  // additively: currentWidth + spaceWidth + wordWidth.
  const spaceWidth = ctx.measureText(" ").width;

  let currentLine = "";
  let currentWidth = 0;

  for (const word of words) {
    if (word === "") {
      // Artefact of split on leading/trailing whitespace; skip.
      continue;
    }

    const wordWidth = ctx.measureText(word).width;

    if (currentLine === "") {
      // Starting a new line — always place the first word regardless of width.
      currentLine = word;
      currentWidth = wordWidth;
    } else {
      const candidateWidth = currentWidth + spaceWidth + wordWidth;

      if (candidateWidth <= maxWidth) {
        currentLine = currentLine + " " + word;
        currentWidth = candidateWidth;
      } else {
        // Flush current line and start a new one with this word.
        result.push({ text: currentLine, width: currentWidth });
        currentLine = word;
        currentWidth = wordWidth;
      }
    }
  }

  // Flush the last line. For an empty paragraph, push one empty line.
  if (paragraph === "") {
    result.push({ text: "", width: 0 });
  } else {
    result.push({ text: currentLine, width: currentWidth });
  }

  return result;
}

/**
 * Parse the pixel font size from a CSS font string.
 *
 * Looks for the first token matching /^\d+(\.\d+)?px$/.
 * Falls back to DEFAULT_FONT_SIZE_PX if not found.
 */
function parseFontSizePx(fontString: string): number {
  const tokens = fontString.split(/\s+/);
  for (const token of tokens) {
    if (token.endsWith("px")) {
      const value = parseFloat(token);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
  }
  return DEFAULT_FONT_SIZE_PX;
}
