/**
 * Corners MUTATION_MAP handler extracted from SchemaPanel for testability.
 *
 * Called when the user edits a `kind.corners.<idx>.radii.x` or
 * `kind.corners.<idx>.radii.y` field in the SchemaPanel. Computes the new
 * Corners tuple and dispatches the correct setCorners call form:
 *
 *   - Superellipse: shape-level `{ type: "superellipse", radius, smoothing }`
 *   - All-round uniform (x edits only): scalar shorthand (a single number)
 *   - Otherwise: per-corner Corners tuple
 *
 * Rules from spec-14a:
 * - Preserves the existing `type` of every corner — never silently converts
 *   bevel/notch/scoop to round.
 * - Preserves the orthogonal axis when editing a single axis — editing `.x`
 *   does NOT overwrite a pre-existing `.y` (and vice versa). Elliptical
 *   corners (x ≠ y, set via MCP/GraphQL) survive single-axis edits intact.
 * - Superellipse is all-or-nothing: per-corner arrays with superellipse are
 *   rejected by setCorners, so we use shape-level form for all four corners.
 *   The shape-level form is uniform (radius collapses to x = y = radius) per
 *   spec §7 superellipse uniformity rule, so an x-edit on superellipse
 *   intentionally collapses any pre-existing per-axis asymmetry.
 * - Validates with `Number.isFinite` per CLAUDE.md floating-point rules.
 * - Returns early (no call) for invalid or non-finite values — no silent clamping.
 */

import type { DocumentStoreAPI } from "../store/document-store-solid";
import type { Corner, Corners, DocumentNode, CornerSuperellipse } from "../types/document";
import { DEFAULT_SMOOTHING } from "../store/corners-input";

/** Corner kinds that bear a `corners` field. */
const CORNER_BEARING_KINDS = new Set(["rectangle", "frame", "image"]);

/**
 * Handles a field change originating from a `kind.corners.<idx>.radii.x`
 * schema field. Exported for unit testing.
 *
 * @param store - The document store (only `setCorners` is called).
 * @param uuid  - UUID of the node being edited.
 * @param key   - The full dot-path key, e.g. `"kind.corners.2.radii.x"`.
 * @param value - The raw value from the field renderer (validated here).
 * @param node  - The current DocumentNode (read-only).
 */
export function handleCornersFieldChange(
  store: Pick<DocumentStoreAPI, "setCorners">,
  uuid: string,
  key: string,
  value: unknown,
  node: DocumentNode,
): void {
  // Guard: only rectangle, frame, image have corners.
  if (!CORNER_BEARING_KINDS.has(node.kind.type)) return;

  // Parse the corner index AND the axis from the key:
  // "kind.corners.<idx>.radii.<axis>" where axis ∈ {"x", "y"}.
  const afterPrefix = key.slice("kind.corners.".length);
  const parts = afterPrefix.split(".");
  const idxStr = parts[0] ?? "";
  const axis = parts[2];
  const idx = parseInt(idxStr, 10);

  // Validate index — must be 0, 1, 2, or 3.
  if (!Number.isFinite(idx) || idx < 0 || idx > 3) return;

  // Validate axis — must be "x" or "y".
  if (axis !== "x" && axis !== "y") return;

  // Validate value — must be a finite, non-negative number.
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return;

  // Read existing corners from the node kind.
  // All three corner-bearing kinds have a `corners` field.
  const kindWithCorners = node.kind as { corners: Corners };
  const existingCorners = kindWithCorners.corners;

  // ── Superellipse special case ─────────────────────────────────────────
  // If any existing corner is superellipse, we must use the shape-level form.
  // Per-corner arrays with superellipse are forbidden by parseCornersInput.
  if (existingCorners.some((c) => c.type === "superellipse")) {
    // Grab smoothing from corner 0 (all superellipse corners are uniform).
    const c0 = existingCorners[0] as CornerSuperellipse;
    const smoothing = c0.smoothing ?? DEFAULT_SMOOTHING;
    store.setCorners(uuid, { type: "superellipse", radius: value, smoothing });
    return;
  }

  // ── Uniform-scalar shorthand ──────────────────────────────────────────
  // If all four existing corners are `round` AND all have equal radii (i.e.
  // the previous state was already uniform), the UI treats all four corners as
  // linked — editing one edits all. Emit a scalar shorthand instead of a
  // per-corner array. This matches the Figma UX of "all corners linked".
  const allRoundBefore = existingCorners.every((c) => c.type === "round");
  if (allRoundBefore) {
    const v0 = existingCorners[0].radii.x;
    const uniformBefore =
      existingCorners[0].radii.x === existingCorners[0].radii.y &&
      existingCorners[1].radii.x === v0 &&
      existingCorners[1].radii.x === existingCorners[1].radii.y &&
      existingCorners[2].radii.x === v0 &&
      existingCorners[2].radii.x === existingCorners[2].radii.y &&
      existingCorners[3].radii.x === v0 &&
      existingCorners[3].radii.x === existingCorners[3].radii.y;

    if (uniformBefore) {
      store.setCorners(uuid, value);
      return;
    }
  }

  // ── Build the new corners tuple ───────────────────────────────────────
  // When corners are not all-equal-round, update only the target corner and
  // preserve the types and values of the others. Build as a mutable tuple,
  // mutate the target slot, then assign to a `Corners` (readonly) view.
  const draft: [Corner, Corner, Corner, Corner] = [
    { ...existingCorners[0], radii: { x: existingCorners[0].radii.x, y: existingCorners[0].radii.y } },
    { ...existingCorners[1], radii: { x: existingCorners[1].radii.x, y: existingCorners[1].radii.y } },
    { ...existingCorners[2], radii: { x: existingCorners[2].radii.x, y: existingCorners[2].radii.y } },
    { ...existingCorners[3], radii: { x: existingCorners[3].radii.x, y: existingCorners[3].radii.y } },
  ];

  // Replace only the target axis on the target corner — preserve the corner
  // type AND the orthogonal axis. A single-axis edit must not silently
  // overwrite a pre-existing per-axis value (RF-008): elliptical corners
  // (x ≠ y) set via MCP/GraphQL must survive .x edits with their .y intact,
  // and vice versa.
  const target = existingCorners[idx];
  const newRadii =
    axis === "x"
      ? { x: value, y: target.radii.y }
      : { x: target.radii.x, y: value };
  draft[idx] = { ...target, radii: newRadii };

  // ── Per-corner array ──────────────────────────────────────────────────
  // RF-019: single conversion via `Corners` (readonly tuple) — no double cast.
  const newCorners: Corners = draft;
  store.setCorners(uuid, newCorners);
}
