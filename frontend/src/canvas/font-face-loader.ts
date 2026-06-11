/**
 * FontFace loader for the canvas renderer.
 *
 * Loads embedded fonts via the platform FontFace API and registers
 * metric-preserving fallbacks for missing referenced fonts. Callers supply
 * the font bytes; this module does NOT fetch from the server.
 *
 * Per CLAUDE.md §11 "Floating-Point Validation": every numeric value
 * interpolated into a CSS property string MUST pass Number.isFinite before
 * interpolation. Non-finite values fall back to "100%" for metric descriptors
 * rather than producing "NaN%" or "Infinity%" which the browser silently drops.
 *
 * Per CLAUDE.md §11 "CSS-Rendered String Fields Must Reject CSS-Significant
 * Characters": entry.family is validated before any interpolation into
 * document.fonts.check or FontFace constructor strings.
 */

import type { FontEntry, FontMetrics } from "../types/document";
import { validateCssIdentifier } from "../validation/css-identifiers";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Approximate ratio of a typical proportional font's average advance to its
 * em square. Used to compute sizeAdjust for metric fallbacks.
 *
 * Note: horizontal metric matching is approximate. The vertical overrides
 * (ascentOverride, descentOverride, lineGapOverride) are the reflow-critical
 * values; precise horizontal matching is deferred to Fonts-2.
 */
const REFERENCE_AVG_ADVANCE_RATIO = 0.5;

/**
 * Safe fallback for any metric-override descriptor when the computed value is
 * non-finite or units_per_em is invalid. Produces no-op overrides.
 */
const METRIC_FALLBACK_PERCENT = "100%";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result for a single font entry after a loadFonts call.
 *
 * - "loaded"   — font is available in document.fonts (was loaded or already present)
 * - "fallback" — a metric-preserving substitute was registered in document.fonts
 * - "missing"  — custom font has no bytes in the bytesById map
 * - "error"    — load failed; face reverted from document.fonts
 */
export interface FontLoadResult {
  readonly id: string;
  readonly family: string;
  readonly status: "loaded" | "fallback" | "missing" | "error";
  readonly error?: string;
}

/**
 * Override descriptors accepted by the FontFace constructor for metric
 * matching. Exposed as a named type so tests can assert the exact descriptors
 * passed to the fallback FontFace.
 */
export interface MetricFallbackDescriptors {
  readonly ascentOverride: string;
  readonly descentOverride: string;
  readonly lineGapOverride: string;
  readonly sizeAdjust: string;
}

// ---------------------------------------------------------------------------
// buildMetricFallback
// ---------------------------------------------------------------------------

/**
 * Compute CSS @font-face metric-override descriptor strings (percentages) so
 * a substitute font occupies the same vertical space as the missing referenced
 * font, preventing layout reflow.
 *
 * All four descriptors are validated with Number.isFinite before formatting.
 * If any computed value is non-finite, or if units_per_em is ≤ 0, the
 * affected descriptor falls back to "100%" — per CLAUDE.md §11 "Floating-Point
 * Validation": NaN or Infinity MUST NOT be interpolated into CSS strings.
 */
export function buildMetricFallback(metrics: FontMetrics): MetricFallbackDescriptors {
  const { units_per_em, ascent, descent, line_gap, avg_advance } = metrics;

  // Guard: units_per_em must be positive. The server validates > 0, but we
  // defend in depth at the output boundary per §11.
  const safeDivisor = Number.isFinite(units_per_em) && units_per_em > 0 ? units_per_em : 0;

  function toPercent(numerator: number): string {
    if (safeDivisor === 0) return METRIC_FALLBACK_PERCENT;
    if (!Number.isFinite(numerator)) return METRIC_FALLBACK_PERCENT;
    const ratio = numerator / safeDivisor;
    if (!Number.isFinite(ratio)) return METRIC_FALLBACK_PERCENT;
    return `${(ratio * 100).toFixed(2)}%`;
  }

  // descent is negative by convention in font metrics; the override needs a
  // positive percentage, so we use the absolute value.
  const ascentOverride = toPercent(ascent);
  // Math.abs(-Infinity) = Infinity — but toPercent guards non-finite inputs.
  const descentOverride = toPercent(Number.isFinite(descent) ? Math.abs(descent) : descent);
  const lineGapOverride = toPercent(line_gap);

  // sizeAdjust: horizontal scale. Approximate — see module-level comment.
  // sizeAdjust = (avg_advance / units_per_em) / REFERENCE_AVG_ADVANCE_RATIO * 100
  let sizeAdjust: string;
  if (safeDivisor === 0 || !Number.isFinite(avg_advance)) {
    sizeAdjust = METRIC_FALLBACK_PERCENT;
  } else {
    const ratio = avg_advance / safeDivisor / REFERENCE_AVG_ADVANCE_RATIO;
    sizeAdjust = Number.isFinite(ratio) ? `${(ratio * 100).toFixed(2)}%` : METRIC_FALLBACK_PERCENT;
  }

  return { ascentOverride, descentOverride, lineGapOverride, sizeAdjust };
}

// ---------------------------------------------------------------------------
// loadFonts
// ---------------------------------------------------------------------------

/**
 * Load or register all fonts for the current document.
 *
 * For each entry:
 * - custom + bytes present → new FontFace(family, bytes), loaded into document.fonts
 * - custom + bytes absent  → "missing" (warns)
 * - system_reference       → checks document.fonts; if absent, registers a
 *                            metric-preserving fallback using Arial glyphs
 * - bundled                → assumed available (app CSS @font-face covers it)
 * - library                → treated like system_reference (Fonts-2 deferred)
 *
 * All per-entry results are collected independently; one failure does NOT
 * reject the whole batch. Returns only when all entries have settled.
 *
 * Per CLAUDE.md §11 "No Fire-and-Forget Mutations": every async face.load()
 * is awaited inside the per-entry handler; errors revert the face from
 * document.fonts.
 */
export async function loadFonts(
  entries: readonly FontEntry[],
  bytesById: ReadonlyMap<string, Uint8Array>,
): Promise<FontLoadResult[]> {
  const tasks = entries.map((entry) => loadSingleFont(entry, bytesById));
  return Promise.all(tasks);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Process a single font entry. Never rejects — always resolves to a
 * FontLoadResult with status "loaded", "fallback", "missing", or "error".
 */
async function loadSingleFont(
  entry: FontEntry,
  bytesById: ReadonlyMap<string, Uint8Array>,
): Promise<FontLoadResult> {
  const { id, family } = entry;

  // Defense-in-depth: validate family before any interpolation into CSS
  // strings (document.fonts.check, FontFace constructor).
  // Per CLAUDE.md §11 "CSS-Rendered String Fields Must Reject CSS-Significant
  // Characters": the server validates, but we guard at the output boundary too.
  if (!validateCssIdentifier(family)) {
    console.warn("[font-face-loader] Skipping entry with CSS-unsafe family", {
      id,
      family,
    });
    return { id, family, status: "error", error: "CSS-unsafe font family name" };
  }

  // Exhaustive switch on source discriminant — a new FontSource variant will
  // fail tsc (no default catch-all) per CLAUDE.md §11 discriminated-union rule.
  const src = entry.source.source;

  switch (src) {
    case "custom":
      return loadCustomFont(entry, bytesById);

    case "system_reference":
    case "library":
      // library is deferred to Fonts-2; treat like system_reference (check
      // availability, register fallback if missing).
      return loadSystemOrFallback(entry);

    case "bundled":
      // The app ships bundled fonts (e.g. Inter) via its own CSS @font-face.
      // Nothing to load — assume the browser has already parsed that stylesheet.
      return { id, family, status: "loaded" };

    default: {
      // Exhaustiveness sentinel: this branch is unreachable if all FontSource
      // variants are handled above. tsc's never-check fires on a new variant.
      const _exhaustive: never = src;
      console.error("[font-face-loader] Unknown font source", { id, family, source: _exhaustive });
      return {
        id,
        family,
        status: "error",
        error: `Unknown font source: ${String(_exhaustive)}`,
      };
    }
  }
}

/**
 * Load a custom-embedded font from caller-supplied bytes.
 */
async function loadCustomFont(
  entry: FontEntry,
  bytesById: ReadonlyMap<string, Uint8Array>,
): Promise<FontLoadResult> {
  const { id, family } = entry;
  const bytes = bytesById.get(id);

  if (bytes === undefined) {
    console.warn("[font-face-loader] No bytes for custom font entry", { id, family });
    return { id, family, status: "missing" };
  }

  // Cast required: ReadonlyMap<string, Uint8Array> gives Uint8Array<ArrayBufferLike>
  // but FontFace's second parameter is typed as BufferSource (ArrayBufferView<ArrayBuffer>).
  // At runtime Uint8Array is always a valid BufferSource — the generic mismatch is a TS
  // lib.dom.d.ts stricter-generic artifact.
  const face = new FontFace(family, bytes as unknown as BufferSource);
  document.fonts.add(face);

  try {
    await face.load();
    return { id, family, status: "loaded" };
  } catch (err) {
    // Revert: remove the face we just added. Per CLAUDE.md §11
    // "No Fire-and-Forget Mutations" and "No Silent Error Suppression":
    // we must revert optimistic state on failure.
    document.fonts.delete(face);
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[font-face-loader] Failed to load custom font", { id, family, error: errorMsg });
    return { id, family, status: "error", error: errorMsg };
  }
}

/**
 * Check system availability; if missing, register a metric-preserving fallback.
 */
async function loadSystemOrFallback(entry: FontEntry): Promise<FontLoadResult> {
  const { id, family, metrics } = entry;

  // Check if the system already has this font loaded.
  // The string "16px <family>" is the canonical check per MDN FontFaceSet.check().
  const checkString = `16px "${family}"`;
  if (document.fonts.check(checkString)) {
    return { id, family, status: "loaded" };
  }

  // Not available — register a metric-preserving fallback using Arial glyphs.
  // The metric overrides ensure the fallback occupies the same vertical space
  // as the missing font, preventing layout reflow.
  const descriptors = buildMetricFallback(metrics);
  const face = new FontFace(family, "local('Arial')", descriptors);
  document.fonts.add(face);

  try {
    await face.load();
    return { id, family, status: "fallback" };
  } catch (err) {
    document.fonts.delete(face);
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[font-face-loader] Failed to register metric fallback", {
      id,
      family,
      error: errorMsg,
    });
    return { id, family, status: "error", error: errorMsg };
  }
}
