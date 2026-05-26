/**
 * Pure helpers deriving UI state from a `Corners` value. Used by
 * CornerSection (overall section state) and CornerPopover (per-hotspot
 * popover state). Pure functions only — no Solid reactivity.
 */

import type { Corner, Corners } from "../../types/document";

export type HotspotId = "tl" | "tr" | "br" | "bl" | "top" | "right" | "bottom" | "left" | "center";

/**
 * RF-009: Tolerance used when comparing `smoothing` values for uniformity.
 *
 * Why a tolerance: Kobalte's `<Slider>` normalizes through floating-point
 * math (clamp + step rounding), so a value the user thinks is "exactly 0.5"
 * may round-trip back with 1-ULP drift. Strict `===` then reports the
 * tuple as non-uniform and the popover collapses out of its lock state.
 *
 * Why this magnitude: the smoothing domain is `[0, 1]` and the slider's
 * `step` is `0.01`. `1e-9` sits ~7 decades below the step granularity, so
 * it cannot collapse two truly distinct user choices into "uniform" — but
 * it tolerates IEEE 754 round-trip noise. Mirrors the rationale in
 * frontend-defensive "Display Layers Must Preserve User Intent Across
 * Lossy Transforms."
 */
const SMOOTHING_EPSILON = 1e-9;

/**
 * Tolerance-aware equality for two finite smoothing values. Returns false
 * for any non-finite input (defensive against NaN / Infinity propagating
 * from upstream computations) — non-finite inputs cannot be considered
 * equal because their equivalence is undefined.
 */
function smoothingEqual(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < SMOOTHING_EPSILON;
}

/** All 9 hotspot ids in their canonical iteration order (TL, TR, BR, BL,
 *  top, right, bottom, left, center). */
export const ALL_HOTSPOT_IDS: readonly HotspotId[] = [
  "tl",
  "tr",
  "br",
  "bl",
  "top",
  "right",
  "bottom",
  "left",
  "center",
];

/** Corner-position labels used by the popover header and aria-label
 *  helper. Indexed by `Corners` array position (TL=0, TR=1, BR=2, BL=3). */
export const CORNER_POSITION_LABEL: readonly string[] = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left",
];

function cornerEq(a: Corner, b: Corner): boolean {
  if (a.type !== b.type) return false;
  if (a.radii.x !== b.radii.x || a.radii.y !== b.radii.y) return false;
  if (a.type === "superellipse" && b.type === "superellipse") {
    // RF-009: tolerance-based equality — see SMOOTHING_EPSILON.
    return smoothingEqual(a.smoothing, b.smoothing);
  }
  return true;
}

/** True when all four corners are deep-equal — opens section in linked
 *  state per Spec 14 §1.5 auto-link behavior. */
export function isLinked(corners: Corners): boolean {
  const [tl, tr, br, bl] = corners;
  return cornerEq(tl, tr) && cornerEq(tl, br) && cornerEq(tl, bl);
}

/** True when all four corners are Superellipse with matching smoothing —
 *  triggers the lock state on non-center hotspots per Spec 14 §1.5.
 *  RF-009: smoothing comparison uses tolerance-based equality. */
export function isSuperellipseUniform(corners: Corners): boolean {
  const [tl, tr, br, bl] = corners;
  if (tl.type !== "superellipse") return false;
  if (tr.type !== "superellipse") return false;
  if (br.type !== "superellipse") return false;
  if (bl.type !== "superellipse") return false;
  return (
    smoothingEqual(tl.smoothing, tr.smoothing) &&
    smoothingEqual(tl.smoothing, br.smoothing) &&
    smoothingEqual(tl.smoothing, bl.smoothing)
  );
}

/** Maps a hotspot id to the corner indices it edits. */
export function hotspotTargetIndices(id: HotspotId): readonly number[] {
  switch (id) {
    case "tl":
      return [0];
    case "tr":
      return [1];
    case "br":
      return [2];
    case "bl":
      return [3];
    case "top":
      return [0, 1];
    case "right":
      return [1, 2];
    case "bottom":
      return [2, 3];
    case "left":
      return [3, 0];
    case "center":
      return [0, 1, 2, 3];
    default: {
      const _exhaustive: never = id;
      throw new Error(`hotspotTargetIndices: unexpected id ${String(_exhaustive)}`);
    }
  }
}

/** Returns the `Corner` instances at a hotspot's target indices. */
export function cornersAtHotspot(corners: Corners, id: HotspotId): Corner[] {
  return hotspotTargetIndices(id).map((i) => corners[i]);
}

/** True when the targeted corners have non-uniform shapes. Always false
 *  for single-corner hotspots (TL/TR/BR/BL). For multi-corner hotspots,
 *  drives the "Mixed" indicator in the shape picker per §1.6. */
export function hotspotShapeIsMixed(corners: Corners, id: HotspotId): boolean {
  const targets = cornersAtHotspot(corners, id);
  if (targets.length <= 1) return false;
  const firstShape = targets[0].type;
  return targets.some((c) => c.type !== firstShape);
}

/** True when any targeted corner has rx ≠ ry. Drives the auto-toggling
 *  of "Unlock axes" when a popover opens. */
export function hotspotHasAsymmetricRadii(corners: Corners, id: HotspotId): boolean {
  return cornersAtHotspot(corners, id).some((c) => c.radii.x !== c.radii.y);
}
