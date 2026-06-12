/**
 * Shared FontEntry fixture for tests and Storybook stories.
 *
 * `store.addFont` resolves to the full server-canonical `FontEntry` (RF-002),
 * so mock stores must return one rather than a bare id string. This factory
 * builds a minimal, valid `FontEntry` so the 18+ mock fixtures don't each
 * inline the full shape.
 */

import type { EmbedDecision, FontEntry } from "../types/document";

/**
 * Build a minimal valid `FontEntry` for tests.
 *
 * @param overrides Partial fields to override (e.g. `embeddable`, `family`).
 */
export function makeTestFontEntry(overrides: Partial<FontEntry> = {}): FontEntry {
  const embeddable: EmbedDecision = overrides.embeddable ?? "embed";
  return {
    id: overrides.id ?? "00000000-0000-0000-0000-000000000000",
    family: overrides.family ?? "Test Family",
    postscript_name: overrides.postscript_name ?? "TestFamily-Regular",
    source: overrides.source ?? { source: "custom", asset_uuid: "asset-uuid" },
    metrics: overrides.metrics ?? {
      units_per_em: 2048,
      ascent: 1984,
      descent: -432,
      line_gap: 0,
      cap_height: 1456,
      x_height: 1082,
      italic_angle: 0,
      avg_advance: 1000,
      panose: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      is_serif: false,
    },
    fs_type: overrides.fs_type ?? 0,
    embeddable,
    is_variable: overrides.is_variable ?? false,
    axes: overrides.axes ?? [],
  };
}
