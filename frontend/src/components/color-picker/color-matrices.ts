/**
 * color-matrices.ts — Color-space conversion matrices and transfer functions
 * cited verbatim from W3C css-color-4 §10 (https://www.w3.org/TR/css-color-4/#color-conversion-code).
 *
 * All matrices are CIE XYZ tristimulus values relative to a D65 reference
 * white. Display-P3 uses the sRGB transfer function pair (γ ≈ 2.4 piecewise),
 * not its own profile-defined transfer function — this matches the W3C
 * specification.
 *
 * Single source of truth for both color-math.ts (which composes these into
 * end-to-end conversion functions) and the parity test fixture generator.
 * Rust mirrors these constants in crates/core/src/color_matrix.rs (cross-
 * language parity per CLAUDE.md §11 "Parallel Implementations Must Have
 * Parity Tests").
 */

/** sRGB linear → CIE XYZ (D65). From W3C css-color-4 §10.1. */
export const SRGB_TO_XYZ_D65: ReadonlyArray<ReadonlyArray<number>> = [
  [0.4123907992659593, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151024, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];

/** CIE XYZ (D65) → sRGB linear. Inverse of SRGB_TO_XYZ_D65 from W3C §10.1. */
export const XYZ_TO_SRGB_D65: ReadonlyArray<ReadonlyArray<number>> = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717561],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];

/** Display-P3 linear → CIE XYZ (D65). From W3C css-color-4 §10.6. */
export const DISPLAY_P3_TO_XYZ_D65: ReadonlyArray<ReadonlyArray<number>> = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];

/** CIE XYZ (D65) → Display-P3 linear. Inverse of DISPLAY_P3_TO_XYZ_D65. */
export const XYZ_TO_DISPLAY_P3_D65: ReadonlyArray<ReadonlyArray<number>> = [
  [2.493496911941425, -0.9313836179191239, -0.40271078445071684],
  [-0.8294889695615747, 1.7626640603183463, 0.023624685841943577],
  [0.03584583024378447, -0.07617238926804182, 0.9568845240076872],
];

/**
 * sRGB EOTF (gamma decode): non-linear γ-encoded channel → linear-light.
 * Piecewise: linear toe up to ~0.04045, power curve above.
 */
export function srgbEotf(c: number): number {
  // Negative values are kept signed so out-of-gamut math round-trips.
  const sign = c < 0 ? -1 : 1;
  const abs = Math.abs(c);
  const linear = abs <= 0.04045 ? abs / 12.92 : Math.pow((abs + 0.055) / 1.055, 2.4);
  return sign * linear;
}

/**
 * sRGB OETF (gamma encode): linear-light channel → non-linear γ-encoded.
 * Inverse of srgbEotf.
 */
export function srgbOetf(c: number): number {
  const sign = c < 0 ? -1 : 1;
  const abs = Math.abs(c);
  const encoded = abs <= 0.0031308 ? abs * 12.92 : 1.055 * Math.pow(abs, 1 / 2.4) - 0.055;
  return sign * encoded;
}

/** Multiply a 3x3 matrix by a 3-vector. */
export function multiplyMatrixVec3(
  m: ReadonlyArray<ReadonlyArray<number>>,
  v: readonly [number, number, number],
): [number, number, number] {
  const r0 = m[0];
  const r1 = m[1];
  const r2 = m[2];
  if (!r0 || !r1 || !r2) throw new Error("matrix is not 3x3");
  return [
    (r0[0] ?? 0) * v[0] + (r0[1] ?? 0) * v[1] + (r0[2] ?? 0) * v[2],
    (r1[0] ?? 0) * v[0] + (r1[1] ?? 0) * v[1] + (r1[2] ?? 0) * v[2],
    (r2[0] ?? 0) * v[0] + (r2[1] ?? 0) * v[1] + (r2[2] ?? 0) * v[2],
  ];
}
