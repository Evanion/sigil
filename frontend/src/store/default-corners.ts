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
 *
 * Each call returns four INDEPENDENT Corner objects (no aliasing). Callers
 * may safely mutate any one corner without affecting the others. This is a
 * load-bearing invariant — earlier revisions of this factory returned
 * `[c, c, c, c]` (one shared object), which silently coupled positional
 * mutations across all four indices.
 */
export function defaultCorners(): Corners {
  const make = (): Corner => ({ type: "round", radii: { x: 0, y: 0 } });
  return [make(), make(), make(), make()];
}
