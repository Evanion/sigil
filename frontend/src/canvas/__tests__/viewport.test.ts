import { describe, it, expect } from "vitest";
import { createViewport, screenToWorld, worldToScreen, zoomAt, type Viewport } from "../viewport";

describe("createViewport", () => {
  it("should return default viewport at origin with zoom 1", () => {
    const vp = createViewport();
    expect(vp.x).toBe(0);
    expect(vp.y).toBe(0);
    expect(vp.zoom).toBe(1);
  });
});

describe("screenToWorld", () => {
  it("should return same coordinates at default viewport", () => {
    const vp = createViewport();
    const [wx, wy] = screenToWorld(vp, 100, 200);
    expect(wx).toBe(100);
    expect(wy).toBe(200);
  });

  it("should account for viewport offset", () => {
    const vp: Viewport = { x: 50, y: 30, zoom: 1 };
    const [wx, wy] = screenToWorld(vp, 100, 200);
    expect(wx).toBe(50);
    expect(wy).toBe(170);
  });

  it("should account for zoom", () => {
    const vp: Viewport = { x: 0, y: 0, zoom: 2 };
    const [wx, wy] = screenToWorld(vp, 100, 200);
    expect(wx).toBe(50);
    expect(wy).toBe(100);
  });

  it("should account for both offset and zoom", () => {
    const vp: Viewport = { x: 100, y: 100, zoom: 2 };
    const [wx, wy] = screenToWorld(vp, 200, 300);
    expect(wx).toBe(50);
    expect(wy).toBe(100);
  });
});

describe("worldToScreen", () => {
  it("should return same coordinates at default viewport", () => {
    const vp = createViewport();
    const [sx, sy] = worldToScreen(vp, 100, 200);
    expect(sx).toBe(100);
    expect(sy).toBe(200);
  });

  it("should account for viewport offset", () => {
    const vp: Viewport = { x: 50, y: 30, zoom: 1 };
    const [sx, sy] = worldToScreen(vp, 50, 170);
    expect(sx).toBe(100);
    expect(sy).toBe(200);
  });

  it("should account for zoom", () => {
    const vp: Viewport = { x: 0, y: 0, zoom: 2 };
    const [sx, sy] = worldToScreen(vp, 50, 100);
    expect(sx).toBe(100);
    expect(sy).toBe(200);
  });

  it("should account for both offset and zoom", () => {
    const vp: Viewport = { x: 100, y: 100, zoom: 2 };
    const [sx, sy] = worldToScreen(vp, 50, 100);
    expect(sx).toBe(200);
    expect(sy).toBe(300);
  });
});

describe("screenToWorld / worldToScreen round-trip", () => {
  it("should round-trip screen -> world -> screen", () => {
    const vp: Viewport = { x: 137, y: -42, zoom: 3.7 };
    const sx = 500;
    const sy = 300;
    const [wx, wy] = screenToWorld(vp, sx, sy);
    const [sx2, sy2] = worldToScreen(vp, wx, wy);
    expect(sx2).toBeCloseTo(sx, 10);
    expect(sy2).toBeCloseTo(sy, 10);
  });

  it("should round-trip world -> screen -> world", () => {
    const vp: Viewport = { x: -200, y: 50, zoom: 0.5 };
    const wx = 400;
    const wy = 250;
    const [sx, sy] = worldToScreen(vp, wx, wy);
    const [wx2, wy2] = screenToWorld(vp, sx, sy);
    expect(wx2).toBeCloseTo(wx, 10);
    expect(wy2).toBeCloseTo(wy, 10);
  });
});

describe("zoomAt", () => {
  it("should zoom in when delta is positive", () => {
    const vp = createViewport();
    const result = zoomAt(vp, 0, 0, 1);
    expect(result.zoom).toBeGreaterThan(1);
  });

  it("should zoom out when delta is negative", () => {
    const vp = createViewport();
    const result = zoomAt(vp, 0, 0, -1);
    expect(result.zoom).toBeLessThan(1);
  });

  it("should clamp zoom to minimum 0.1", () => {
    const vp: Viewport = { x: 0, y: 0, zoom: 0.1 };
    const result = zoomAt(vp, 0, 0, -100);
    expect(result.zoom).toBeCloseTo(0.1, 5);
  });

  it("should clamp zoom to maximum 10", () => {
    const vp: Viewport = { x: 0, y: 0, zoom: 10 };
    const result = zoomAt(vp, 0, 0, 100);
    expect(result.zoom).toBeCloseTo(10, 5);
  });

  it("should keep the world point under the cursor stable", () => {
    const vp: Viewport = { x: 100, y: 50, zoom: 1 };
    const cursorX = 400;
    const cursorY = 300;

    // World point under cursor before zoom
    const [wxBefore, wyBefore] = screenToWorld(vp, cursorX, cursorY);

    const result = zoomAt(vp, cursorX, cursorY, 2);

    // World point under cursor after zoom
    const [wxAfter, wyAfter] = screenToWorld(result, cursorX, cursorY);

    expect(wxAfter).toBeCloseTo(wxBefore, 5);
    expect(wyAfter).toBeCloseTo(wyBefore, 5);
  });

  it("should keep the world point under the cursor stable when zooming out", () => {
    const vp: Viewport = { x: 200, y: -100, zoom: 3 };
    const cursorX = 600;
    const cursorY = 400;

    const [wxBefore, wyBefore] = screenToWorld(vp, cursorX, cursorY);
    const result = zoomAt(vp, cursorX, cursorY, -2);
    const [wxAfter, wyAfter] = screenToWorld(result, cursorX, cursorY);

    expect(wxAfter).toBeCloseTo(wxBefore, 5);
    expect(wyAfter).toBeCloseTo(wyBefore, 5);
  });

  it("should not mutate the original viewport", () => {
    const vp: Viewport = { x: 100, y: 200, zoom: 2 };
    zoomAt(vp, 0, 0, 1);
    expect(vp.x).toBe(100);
    expect(vp.y).toBe(200);
    expect(vp.zoom).toBe(2);
  });
});
