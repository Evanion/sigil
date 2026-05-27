/**
 * ColorDisplayMode — display mode for the ColorPicker's numeric fields.
 *
 * Internally the picker always works in sRGB [0,1] for area/strip widgets;
 * the display mode controls how channels are labelled and ranged in
 * ColorValueFields AND determines the storage tag emitted by the picker:
 *   - "srgb"        → Color::Srgb storage
 *   - "display_p3"  → Color::DisplayP3 storage (Spec 18)
 *   - "oklch"      → Color::Srgb storage (legacy; OkLCH stays a display
 *                     mode only — full OkLCH storage path not yet wired)
 *   - "hsl"        → Color::Srgb storage (HSL is not a document storage
 *                     space)
 */
export type ColorDisplayMode = "srgb" | "display_p3" | "oklch" | "hsl";
