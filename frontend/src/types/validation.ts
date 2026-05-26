// Frontend mirror of crates/core/src/validate.rs color channel bounds.
// Used by the picker / panel validators per CLAUDE.md §11 "Validation Must Be
// Symmetric Across All Transports".

/** Minimum sRGB / Display-P3 channel value (API-level). */
export const MIN_COLOR_CHANNEL = 0.0;

/** Maximum sRGB / Display-P3 channel value (API-level). */
export const MAX_COLOR_CHANNEL = 1.0;
