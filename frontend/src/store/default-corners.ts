/**
 * Default corners factory for newly-created rectangle, frame, and image nodes.
 *
 * Returns a canonical Corners tuple of 4 round corners at radius 0.
 * Each call returns a fresh tuple so callers may mutate without aliasing.
 */

import type { Corner, Corners } from "../types/document";

/**
 * Produces a default Corners tuple: 4 round corners at radius 0/0.
 * Use this when constructing a new rectangle, frame, or image node.
 */
export function defaultCorners(): Corners {
  const c: Corner = { type: "round", radii: { x: 0, y: 0 } };
  return [c, c, c, c];
}
