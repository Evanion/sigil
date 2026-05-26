/**
 * generate-p3-parity.mjs — compute Display-P3 ↔ sRGB conversion vectors
 * directly from W3C-published matrices (cited in color-matrices.ts).
 *
 * Run: node frontend/scripts/generate-p3-parity.mjs
 *
 * Output: pretty-printed JSON matching the schema of
 * tests/fixtures/parity/p3-color-conversions.json
 *
 * This script provides INDEPENDENT GROUND TRUTH for the parity fixture
 * (RF-010). Re-run when matrices change or when adding new test cases;
 * commit the regenerated fixture alongside this script.
 *
 * The script computes vectors using ONLY the W3C matrix constants —
 * different control flow from production code (no use of project's
 * color-math helpers). If both production paths converge on these
 * computed values, they're independently verified.
 */

// W3C css-color-4 §10 matrices (verbatim).
const SRGB_TO_XYZ_D65 = [
  [0.4123907992659593, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151024, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const XYZ_TO_SRGB_D65 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717561],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const DISPLAY_P3_TO_XYZ_D65 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const XYZ_TO_DISPLAY_P3_D65 = [
  [2.493496911941425, -0.9313836179191239, -0.40271078445071684],
  [-0.8294889695615747, 1.7626640603183463, 0.023624685841943577],
  [0.03584583024378447, -0.07617238926804182, 0.9568845240076872],
];

// sRGB transfer functions.
function srgbEotf(c) {
  const sign = c < 0 ? -1 : 1;
  const abs = Math.abs(c);
  const linear = abs <= 0.04045 ? abs / 12.92 : Math.pow((abs + 0.055) / 1.055, 2.4);
  return sign * linear;
}
function srgbOetf(c) {
  const sign = c < 0 ? -1 : 1;
  const abs = Math.abs(c);
  const encoded = abs <= 0.0031308 ? abs * 12.92 : 1.055 * Math.pow(abs, 1 / 2.4) - 0.055;
  return sign * encoded;
}

function mulMV(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function p3ToSrgb([r, g, b]) {
  const linearP3 = [srgbEotf(r), srgbEotf(g), srgbEotf(b)];
  const xyz = mulMV(DISPLAY_P3_TO_XYZ_D65, linearP3);
  const linearSrgb = mulMV(XYZ_TO_SRGB_D65, xyz);
  return [srgbOetf(linearSrgb[0]), srgbOetf(linearSrgb[1]), srgbOetf(linearSrgb[2])];
}

function srgbToP3([r, g, b]) {
  const linearSrgb = [srgbEotf(r), srgbEotf(g), srgbEotf(b)];
  const xyz = mulMV(SRGB_TO_XYZ_D65, linearSrgb);
  const linearP3 = mulMV(XYZ_TO_DISPLAY_P3_D65, xyz);
  return [srgbOetf(linearP3[0]), srgbOetf(linearP3[1]), srgbOetf(linearP3[2])];
}

function round8(n) {
  return Math.round(n * 1e8) / 1e8;
}

const inputs = [
  { name: "black", v: [0.0, 0.0, 0.0] },
  { name: "white", v: [1.0, 1.0, 1.0] },
  { name: "gray_50", v: [0.5, 0.5, 0.5] },
  { name: "red", v: [1.0, 0.0, 0.0] },
  { name: "green", v: [0.0, 1.0, 0.0] },
  { name: "blue", v: [0.0, 0.0, 1.0] },
  { name: "asymmetric_a", v: [0.25, 0.75, 0.5] },
  { name: "asymmetric_b", v: [0.75, 0.25, 0.5] },
];

const fixture = {
  description:
    "Cross-language parity vectors for Display-P3 ↔ sRGB conversion (Spec 18). Values are computed directly from W3C css-color-4 §10 matrices (https://www.w3.org/TR/css-color-4/#color-conversion-code) via the script at frontend/scripts/generate-p3-parity.mjs. Both Rust and TypeScript implementations are asserted to match these computed values within tolerance, providing independent ground truth (RF-010). Re-run the generator after any matrix change. See CLAUDE.md 'Parallel Implementations Must Have Parity Tests'.",
  tolerance: 1e-6,
  p3_to_srgb: inputs.map((i) => {
    const [r, g, b] = p3ToSrgb(i.v);
    // For names that need a suffix matching the current fixture, use OOG marker.
    const name = ["red", "green", "blue"].includes(i.name) ? `p3_${i.name}_oog` : i.name;
    return { name, p3: i.v, srgb: [round8(r), round8(g), round8(b)] };
  }),
  srgb_to_p3: inputs.map((i) => {
    const [r, g, b] = srgbToP3(i.v);
    const name = ["red", "green", "blue"].includes(i.name) ? `srgb_${i.name}` : i.name;
    return { name, srgb: i.v, p3: [round8(r), round8(g), round8(b)] };
  }),
};

console.log(JSON.stringify(fixture, null, 2));
