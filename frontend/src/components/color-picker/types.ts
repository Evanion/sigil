/**
 * ColorDisplayMode — display mode for the ColorPicker's numeric fields.
 *
 * Note: this is the picker's internal *display* mode, NOT the document's
 * storage space (`Color["space"]` in `../../types/document`). Internally the
 * picker always works in sRGB [0,1] and emits sRGB colors; the display mode
 * only controls how channels are labelled and ranged in ColorValueFields
 * (e.g. "R/G/B 0-255" vs "H/S/L 0-360/0-100/0-100").
 *
 * "hsl" is a display-only mode — HSL is not a document storage space, so
 * colors edited in HSL mode are still stored as sRGB.
 *
 * Display_P3 is intentionally not present: it was previously carried as a
 * dead variant (hidden in the switcher UI, hardcoded to sRGB on emit) and
 * was removed (RF-D05, RF-D10). Re-add only when proper color-matrix
 * conversion is implemented end-to-end.
 */
export type ColorDisplayMode = "srgb" | "oklch" | "hsl";
