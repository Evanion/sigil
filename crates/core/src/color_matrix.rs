//! `color_matrix.rs` — Color-space conversion matrices and transfer functions
//! cited verbatim from W3C css-color-4 §10
//! (<https://www.w3.org/TR/css-color-4/#color-conversion-code>).
//!
//! All matrices are CIE XYZ tristimulus values relative to a D65 reference
//! white. Display-P3 uses the sRGB transfer function pair (γ ≈ 2.4 piecewise),
//! not its own profile-defined transfer function — this matches the W3C
//! specification.
//!
//! Single source of truth for the Rust side. The TypeScript module
//! `frontend/src/components/color-picker/color-matrices.ts` mirrors these
//! values — cross-language parity is enforced by the parity fixture at
//! `tests/fixtures/parity/p3-color-conversions.json`.

/// sRGB linear → CIE XYZ (D65). From W3C css-color-4 §10.1.
pub const SRGB_TO_XYZ_D65: [[f64; 3]; 3] = [
    [
        0.412_390_799_265_959_3,
        0.357_584_339_383_878,
        0.180_480_788_401_834_3,
    ],
    [
        0.212_639_005_871_510_24,
        0.715_168_678_767_756,
        0.072_192_315_360_733_71,
    ],
    [
        0.019_330_818_715_591_82,
        0.119_194_779_794_625_98,
        0.950_532_152_249_660_7,
    ],
];

/// CIE XYZ (D65) → sRGB linear. Inverse of `SRGB_TO_XYZ_D65`.
pub const XYZ_TO_SRGB_D65: [[f64; 3]; 3] = [
    [
        3.240_969_941_904_522_6,
        -1.537_383_177_570_094,
        -0.498_610_760_293_003_4,
    ],
    [
        -0.969_243_636_280_879_6,
        1.875_967_501_507_720_2,
        0.041_555_057_407_175_61,
    ],
    [
        0.055_630_079_696_993_66,
        -0.203_976_958_888_976_52,
        1.056_971_514_242_878_6,
    ],
];

/// Display-P3 linear → CIE XYZ (D65). From W3C css-color-4 §10.6.
pub const DISPLAY_P3_TO_XYZ_D65: [[f64; 3]; 3] = [
    [
        0.486_570_948_648_216_2,
        0.265_667_693_169_093_06,
        0.198_217_285_234_362_5,
    ],
    [
        0.228_974_564_069_748_8,
        0.691_738_521_836_506_4,
        0.079_286_914_093_745,
    ],
    [0.0, 0.045_113_381_858_902_64, 1.043_944_368_900_976],
];

/// CIE XYZ (D65) → Display-P3 linear. Inverse of `DISPLAY_P3_TO_XYZ_D65`.
pub const XYZ_TO_DISPLAY_P3_D65: [[f64; 3]; 3] = [
    [
        2.493_496_911_941_425,
        -0.931_383_617_919_123_9,
        -0.402_710_784_450_716_84,
    ],
    [
        -0.829_488_969_561_574_7,
        1.762_664_060_318_346_3,
        0.023_624_685_841_943_577,
    ],
    [
        0.035_845_830_243_784_47,
        -0.076_172_389_268_041_82,
        0.956_884_524_007_687_2,
    ],
];

/// sRGB EOTF (gamma decode): non-linear γ-encoded channel → linear-light.
/// Negative inputs are kept signed so out-of-gamut math round-trips.
#[must_use]
pub fn srgb_eotf(c: f64) -> f64 {
    let sign = if c < 0.0 { -1.0 } else { 1.0 };
    let abs = c.abs();
    let linear = if abs <= 0.04045 {
        abs / 12.92
    } else {
        ((abs + 0.055) / 1.055).powf(2.4)
    };
    sign * linear
}

/// sRGB OETF (gamma encode): linear-light channel → non-linear γ-encoded.
/// Inverse of `srgb_eotf`.
#[must_use]
pub fn srgb_oetf(c: f64) -> f64 {
    let sign = if c < 0.0 { -1.0 } else { 1.0 };
    let abs = c.abs();
    let encoded = if abs <= 0.003_130_8 {
        abs * 12.92
    } else {
        1.055 * abs.powf(1.0 / 2.4) - 0.055
    };
    sign * encoded
}

/// Multiply a 3x3 matrix by a 3-vector.
#[must_use]
pub fn multiply_matrix_vec3(m: &[[f64; 3]; 3], v: [f64; 3]) -> [f64; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPSILON: f64 = 1e-9;

    fn assert_approx(actual: f64, expected: f64, label: &str) {
        assert!(
            (actual - expected).abs() < EPSILON,
            "{label}: expected {expected}, got {actual}",
        );
    }

    #[test]
    fn srgb_matrix_round_trips_via_inverse() {
        for i in 0..3 {
            for j in 0..3 {
                let mut sum = 0.0;
                for k in 0..3 {
                    sum += SRGB_TO_XYZ_D65[i][k] * XYZ_TO_SRGB_D65[k][j];
                }
                let expected = if i == j { 1.0 } else { 0.0 };
                assert_approx(sum, expected, &format!("identity[{i}][{j}]"));
            }
        }
    }

    #[test]
    fn display_p3_matrix_round_trips_via_inverse() {
        for i in 0..3 {
            for j in 0..3 {
                let mut sum = 0.0;
                for k in 0..3 {
                    sum += DISPLAY_P3_TO_XYZ_D65[i][k] * XYZ_TO_DISPLAY_P3_D65[k][j];
                }
                let expected = if i == j { 1.0 } else { 0.0 };
                assert_approx(sum, expected, &format!("identity[{i}][{j}]"));
            }
        }
    }

    #[test]
    fn srgb_eotf_round_trips_with_oetf() {
        for &v in &[0.0_f64, 0.1, 0.5, 0.99, 1.0] {
            let linear = srgb_eotf(v);
            let back = srgb_oetf(linear);
            assert_approx(back, v, &format!("round-trip {v}"));
        }
    }

    #[test]
    fn srgb_eotf_zero_and_one() {
        assert_approx(srgb_eotf(0.0), 0.0, "eotf(0)");
        assert_approx(srgb_eotf(1.0), 1.0, "eotf(1)");
    }

    #[test]
    fn multiply_matrix_vec3_identity() {
        let i: [[f64; 3]; 3] = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        let v = [3.0, 5.0, 7.0];
        assert_eq!(multiply_matrix_vec3(&i, v), [3.0, 5.0, 7.0]);
    }

    #[test]
    fn multiply_matrix_vec3_permutation() {
        let p: [[f64; 3]; 3] = [[0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let v = [1.0, 2.0, 3.0];
        assert_eq!(multiply_matrix_vec3(&p, v), [3.0, 1.0, 2.0]);
    }
}
