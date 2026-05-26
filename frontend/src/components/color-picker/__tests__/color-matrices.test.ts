/**
 * Tests for color-matrices.ts — verifies the W3C-published matrix and
 * transfer-function values are present and behave as documented.
 * The exact numerical values are cited inline in color-matrices.ts.
 */
import { describe, it, expect } from "vitest";
import {
  SRGB_TO_XYZ_D65,
  XYZ_TO_SRGB_D65,
  DISPLAY_P3_TO_XYZ_D65,
  XYZ_TO_DISPLAY_P3_D65,
  srgbEotf,
  srgbOetf,
  multiplyMatrixVec3,
} from "../color-matrices";

describe("color-matrices", () => {
  it("each matrix is 3x3", () => {
    for (const m of [
      SRGB_TO_XYZ_D65,
      XYZ_TO_SRGB_D65,
      DISPLAY_P3_TO_XYZ_D65,
      XYZ_TO_DISPLAY_P3_D65,
    ]) {
      expect(m).toHaveLength(3);
      for (const row of m) expect(row).toHaveLength(3);
    }
  });

  it("sRGB matrix multiplied by its inverse approximates identity", () => {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) {
          const left = SRGB_TO_XYZ_D65[i]?.[k];
          const right = XYZ_TO_SRGB_D65[k]?.[j];
          if (left === undefined || right === undefined) throw new Error("matrix index");
          sum += left * right;
        }
        const expected = i === j ? 1 : 0;
        expect(Math.abs(sum - expected)).toBeLessThan(1e-9);
      }
    }
  });

  it("P3 matrix multiplied by its inverse approximates identity", () => {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) {
          const left = DISPLAY_P3_TO_XYZ_D65[i]?.[k];
          const right = XYZ_TO_DISPLAY_P3_D65[k]?.[j];
          if (left === undefined || right === undefined) throw new Error("matrix index");
          sum += left * right;
        }
        const expected = i === j ? 1 : 0;
        expect(Math.abs(sum - expected)).toBeLessThan(1e-9);
      }
    }
  });

  it("srgbEotf round-trips with srgbOetf", () => {
    for (const v of [0, 0.1, 0.5, 0.99, 1.0]) {
      const linear = srgbEotf(v);
      const back = srgbOetf(linear);
      expect(Math.abs(back - v)).toBeLessThan(1e-9);
    }
  });

  it("srgbEotf(0) === 0 and srgbEotf(1) === 1", () => {
    expect(srgbEotf(0)).toBe(0);
    expect(Math.abs(srgbEotf(1) - 1)).toBeLessThan(1e-9);
  });

  it("multiplyMatrixVec3 produces correct output for the identity matrix", () => {
    const I: ReadonlyArray<ReadonlyArray<number>> = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    expect(multiplyMatrixVec3(I, [3, 5, 7])).toEqual([3, 5, 7]);
  });

  it("multiplyMatrixVec3 swaps axes correctly with a permutation matrix", () => {
    const P: ReadonlyArray<ReadonlyArray<number>> = [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ];
    expect(multiplyMatrixVec3(P, [1, 2, 3])).toEqual([3, 1, 2]);
  });
});
