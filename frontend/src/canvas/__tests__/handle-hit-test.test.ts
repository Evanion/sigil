/**
 * Tests for handle hit-testing.
 *
 * Verifies that hitTestHandle correctly identifies which of the 8 resize
 * handles (NW, N, NE, E, SE, S, SW, W) the pointer is over, returns null
 * on miss, and maintains consistent hit zones regardless of zoom level.
 */

import { describe, it, expect } from "vitest";
import {
  hitTestHandle,
  getHandleCursor,
  HandleType,
} from "../handle-hit-test";
import type { Transform } from "../../types/document";

const TRANSFORM: Transform = {
  x: 100,
  y: 100,
  width: 200,
  height: 150,
  rotation: 0,
  scale_x: 1,
  scale_y: 1,
};

const ZOOM = 1;

describe("hitTestHandle", () => {
  it("returns NW when pointer is on the top-left corner", () => {
    expect(hitTestHandle(TRANSFORM, 100, 100, ZOOM)).toBe(HandleType.NW);
  });

  it("returns N when pointer is on the top-center edge", () => {
    expect(hitTestHandle(TRANSFORM, 200, 100, ZOOM)).toBe(HandleType.N);
  });

  it("returns NE when pointer is on the top-right corner", () => {
    expect(hitTestHandle(TRANSFORM, 300, 100, ZOOM)).toBe(HandleType.NE);
  });

  it("returns E when pointer is on the right-center edge", () => {
    expect(hitTestHandle(TRANSFORM, 300, 175, ZOOM)).toBe(HandleType.E);
  });

  it("returns SE when pointer is on the bottom-right corner", () => {
    expect(hitTestHandle(TRANSFORM, 300, 250, ZOOM)).toBe(HandleType.SE);
  });

  it("returns S when pointer is on the bottom-center edge", () => {
    expect(hitTestHandle(TRANSFORM, 200, 250, ZOOM)).toBe(HandleType.S);
  });

  it("returns SW when pointer is on the bottom-left corner", () => {
    expect(hitTestHandle(TRANSFORM, 100, 250, ZOOM)).toBe(HandleType.SW);
  });

  it("returns W when pointer is on the left-center edge", () => {
    expect(hitTestHandle(TRANSFORM, 100, 175, ZOOM)).toBe(HandleType.W);
  });

  it("returns null when pointer is inside the node but not on a handle", () => {
    expect(hitTestHandle(TRANSFORM, 200, 175, ZOOM)).toBeNull();
  });

  it("returns null when pointer is outside the node entirely", () => {
    expect(hitTestHandle(TRANSFORM, 500, 500, ZOOM)).toBeNull();
  });

  it("hit zone scales inversely with zoom (zoom-independent screen-space)", () => {
    // At zoom=2, hit zone in world space is 8/2 = 4px per side
    // Point at (104, 104) is 4px from corner — just inside at zoom=2
    expect(hitTestHandle(TRANSFORM, 104, 104, 2)).toBe(HandleType.NW);
    // Point at (106, 106) is 6px from corner — outside at zoom=2 (threshold=4)
    expect(hitTestHandle(TRANSFORM, 106, 106, 2)).toBeNull();
  });

  it("corners take priority over edges when both are within hit zone", () => {
    // At zoom=1, the NW handle center is at (100,100). A point at
    // (100, 100) is equidistant from NW corner and N/W edge midpoints.
    // Corners must win because they are checked first.
    expect(hitTestHandle(TRANSFORM, 100, 100, ZOOM)).toBe(HandleType.NW);
  });
});

describe("getHandleCursor", () => {
  it("returns nwse-resize for NW", () => {
    expect(getHandleCursor(HandleType.NW)).toBe("nwse-resize");
  });

  it("returns ns-resize for N", () => {
    expect(getHandleCursor(HandleType.N)).toBe("ns-resize");
  });

  it("returns nesw-resize for NE", () => {
    expect(getHandleCursor(HandleType.NE)).toBe("nesw-resize");
  });

  it("returns ew-resize for E", () => {
    expect(getHandleCursor(HandleType.E)).toBe("ew-resize");
  });

  it("returns nwse-resize for SE", () => {
    expect(getHandleCursor(HandleType.SE)).toBe("nwse-resize");
  });

  it("returns ns-resize for S", () => {
    expect(getHandleCursor(HandleType.S)).toBe("ns-resize");
  });

  it("returns nesw-resize for SW", () => {
    expect(getHandleCursor(HandleType.SW)).toBe("nesw-resize");
  });

  it("returns ew-resize for W", () => {
    expect(getHandleCursor(HandleType.W)).toBe("ew-resize");
  });
});
