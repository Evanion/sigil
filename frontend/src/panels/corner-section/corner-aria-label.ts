/**
 * Produces a human-readable summary of a `Corners` value for the preview
 * SVG's `aria-label` (RF-025 — "current corner shape invisible to user"
 * is partly addressed by this).
 *
 * Three tiers of detail:
 *  1. Uniform shape + radii → "rounded corners, radius 8" / "square corners"
 *  2. Uniform shape, mixed radii → "rounded corners, mixed radii"
 *  3. Mixed shapes → either "round top corners, bevel bottom corners" when
 *     top pair and bottom pair are uniform respectively, or per-corner
 *     "round top-left, bevel top-right, notch bottom-right, scoop bottom-left".
 */

import type { Corner, Corners } from "../../types/document";
// RF-020: import the single source-of-truth array from corner-section-state.
// Previously this module carried a local duplicate, which is exactly the
// "inline copies diverge silently" pattern CLAUDE.md §5 forbids.
import { CORNER_POSITION_LABEL } from "./corner-section-state";

const SHAPE_LABEL: Record<Corner["type"], string> = {
  round: "round",
  bevel: "bevel",
  notch: "notch",
  scoop: "scoop",
  superellipse: "superellipse",
};

function sameShape(a: Corner, b: Corner): boolean {
  return a.type === b.type;
}

function sameRadii(a: Corner, b: Corner): boolean {
  return a.radii.x === b.radii.x && a.radii.y === b.radii.y;
}

function radiusText(c: Corner): string {
  if (c.radii.x === c.radii.y) return String(c.radii.x);
  return `${c.radii.x}×${c.radii.y}`;
}

export function summarizeCornersForAria(corners: Corners): string {
  const [tl, tr, br, bl] = corners;
  const allSameShape = sameShape(tl, tr) && sameShape(tl, br) && sameShape(tl, bl);
  const allSameRadii = sameRadii(tl, tr) && sameRadii(tl, br) && sameRadii(tl, bl);
  const allZero = allSameRadii && tl.radii.x === 0 && tl.radii.y === 0;

  if (allSameShape && allZero) {
    return "Rectangle with square corners";
  }

  if (allSameShape && tl.type === "superellipse" && allSameRadii) {
    return `Rectangle with superellipse corners, radius ${radiusText(tl)}, smoothing ${tl.smoothing}`;
  }

  if (allSameShape && allSameRadii) {
    const shape = SHAPE_LABEL[tl.type];
    return `Rectangle with ${shape === "round" ? "rounded" : `${shape}`} corners, radius ${radiusText(tl)}`;
  }

  if (allSameShape) {
    const shape = SHAPE_LABEL[tl.type];
    return `Rectangle with ${shape === "round" ? "rounded" : shape} corners, mixed radii`;
  }

  // Shape mixed — group by top pair vs bottom pair when those are uniform.
  const topUniform = sameShape(tl, tr);
  const bottomUniform = sameShape(br, bl);
  if (topUniform && bottomUniform) {
    return `Rectangle with ${SHAPE_LABEL[tl.type]} top corners, ${SHAPE_LABEL[br.type]} bottom corners`;
  }

  // Fallback: per-corner.
  const parts = corners.map((c, i) => `${SHAPE_LABEL[c.type]} ${CORNER_POSITION_LABEL[i]}`);
  return `Rectangle with ${parts.join(", ")}`;
}
