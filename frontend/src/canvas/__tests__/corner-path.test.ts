/**
 * @vitest-environment jsdom
 *
 * Pure-geometry tests for `corner-path.ts`. Uses a `PathRecorder` that
 * implements the `PathBuilder` structural interface; assertions are on the
 * recorded operation sequence.
 *
 * Per spec § 4.3: no pixel snapshots, no `canvas` npm package.
 */
import { describe, it, expect } from "vitest";
import {
  appendCornerPath,
  appendRoundCorner,
  appendBevelCorner,
  appendNotchCorner,
  appendScoopCorner,
  appendSuperellipseCorner,
  type PathBuilder,
  type CornerGeometry,
} from "../corner-path";
import type { Corner, Corners } from "../../types/document";

interface RecordedOp {
  method: "moveTo" | "lineTo" | "ellipse" | "bezierCurveTo" | "closePath";
  args: readonly number[];
}

class PathRecorder implements PathBuilder {
  ops: RecordedOp[] = [];
  moveTo(x: number, y: number): void {
    this.ops.push({ method: "moveTo", args: [x, y] });
  }
  lineTo(x: number, y: number): void {
    this.ops.push({ method: "lineTo", args: [x, y] });
  }
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    this.ops.push({
      method: "ellipse",
      args: [x, y, rx, ry, rotation, startAngle, endAngle, counterclockwise ? 1 : 0],
    });
  }
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this.ops.push({ method: "bezierCurveTo", args: [cp1x, cp1y, cp2x, cp2y, x, y] });
  }
  closePath(): void {
    this.ops.push({ method: "closePath", args: [] });
  }
}

function round(r: number): Corner {
  return { type: "round", radii: { x: r, y: r } };
}

const TL_GEOM: CornerGeometry = {
  cornerX: 0,
  cornerY: 0,
  cx: 16,
  cy: 16,
  rx: 16,
  ry: 16,
  startAngle: Math.PI,
  endAngle: 1.5 * Math.PI,
  entryDirX: 0,
  entryDirY: -1,
  exitDirX: 1,
  exitDirY: 0,
};

describe("appendRoundCorner", () => {
  it("emits a single ellipse instruction", () => {
    const r = new PathRecorder();
    appendRoundCorner(r, TL_GEOM);
    const ellipses = r.ops.filter((op) => op.method === "ellipse");
    expect(ellipses.length).toBe(1);
  });

  it("ellipse arguments match the corner geometry", () => {
    const r = new PathRecorder();
    appendRoundCorner(r, TL_GEOM);
    const ellipse = r.ops.find((op) => op.method === "ellipse");
    expect(ellipse?.args[0]).toBe(16); // cx
    expect(ellipse?.args[1]).toBe(16); // cy
    expect(ellipse?.args[2]).toBe(16); // rx
    expect(ellipse?.args[3]).toBe(16); // ry
    expect(ellipse?.args[5]).toBe(Math.PI); // startAngle
    expect(ellipse?.args[6]).toBe(1.5 * Math.PI); // endAngle
  });
});

describe("appendCornerPath — all-round corners", () => {
  it("emits moveTo + 4 lineTo + 4 ellipse + closePath in the right order", () => {
    const r = new PathRecorder();
    const corners: Corners = [round(16), round(16), round(16), round(16)];
    appendCornerPath(r, 0, 0, 100, 100, corners);
    const methods = r.ops.map((op) => op.method);
    expect(methods).toEqual([
      "moveTo",
      "lineTo",
      "ellipse",
      "lineTo",
      "ellipse",
      "lineTo",
      "ellipse",
      "lineTo",
      "ellipse",
      "closePath",
    ]);
  });

  it("starts the path at the top edge just past the TL corner radius", () => {
    const r = new PathRecorder();
    const corners: Corners = [round(16), round(16), round(16), round(16)];
    appendCornerPath(r, 10, 20, 100, 100, corners);
    const moveTo = r.ops[0];
    expect(moveTo.method).toBe("moveTo");
    expect(moveTo.args).toEqual([10 + 16, 20]); // x + tl.radii.x, y
  });
});

function bevel(r: number): Corner {
  return { type: "bevel", radii: { x: r, y: r } };
}

describe("appendBevelCorner", () => {
  it("emits a single lineTo diagonal cut for a TL bevel", () => {
    const r = new PathRecorder();
    appendBevelCorner(r, TL_GEOM);
    expect(r.ops.length).toBe(1);
    expect(r.ops[0].method).toBe("lineTo");
    // Exit endpoint = (cornerX + exitDirX * rx, cornerY + exitDirY * rx) = (16, 0).
    expect(r.ops[0].args).toEqual([16, 0]);
  });
});

describe("appendCornerPath — all-bevel corners", () => {
  it("emits moveTo + 8 lineTo + closePath (no ellipses)", () => {
    const r = new PathRecorder();
    const corners: Corners = [bevel(16), bevel(16), bevel(16), bevel(16)];
    appendCornerPath(r, 0, 0, 100, 100, corners);
    const methods = r.ops.map((op) => op.method);
    expect(methods.filter((m) => m === "ellipse").length).toBe(0);
    // 4 edge lineTos (between corners) + 4 bevel-cut lineTos = 8 lineTos.
    expect(methods.filter((m) => m === "lineTo").length).toBe(8);
  });
});

function notch(r: number): Corner {
  return { type: "notch", radii: { x: r, y: r } };
}

describe("appendNotchCorner", () => {
  it("emits exactly two lineTo segments (step in + step out)", () => {
    const r = new PathRecorder();
    appendNotchCorner(r, TL_GEOM);
    expect(r.ops.length).toBe(2);
    expect(r.ops.every((op) => op.method === "lineTo")).toBe(true);
    // Entry endpoint = corner (0,0) - entryDir (0,-1) * ry (16) = (0, 16).
    // Inner step: + exitDir (1,0) * rx (16) = (16, 16).
    expect(r.ops[0].args).toEqual([16, 16]);
    // Outward step: exit endpoint = corner (0,0) + exitDir (1,0) * rx (16) = (16, 0).
    expect(r.ops[1].args).toEqual([16, 0]);
  });
});

describe("appendCornerPath — all-notch corners", () => {
  it("emits moveTo + 12 lineTo + closePath (4 edges + 4 corners × 2 segments)", () => {
    const r = new PathRecorder();
    const corners: Corners = [notch(16), notch(16), notch(16), notch(16)];
    appendCornerPath(r, 0, 0, 100, 100, corners);
    const methods = r.ops.map((op) => op.method);
    expect(methods.filter((m) => m === "ellipse").length).toBe(0);
    expect(methods.filter((m) => m === "lineTo").length).toBe(12);
  });
});

function scoop(r: number): Corner {
  return { type: "scoop", radii: { x: r, y: r } };
}

describe("appendScoopCorner", () => {
  it("emits an ellipse with counterclockwise sweep centered at the corner-point", () => {
    const r = new PathRecorder();
    appendScoopCorner(r, TL_GEOM);
    expect(r.ops.length).toBe(1);
    expect(r.ops[0].method).toBe("ellipse");
    // Center at corner-point (0, 0), not at ellipse center.
    expect(r.ops[0].args[0]).toBe(0);
    expect(r.ops[0].args[1]).toBe(0);
    // counterclockwise flag at index 7 = 1.
    expect(r.ops[0].args[7]).toBe(1);
  });
});

function superellipse(r: number, smoothing: number): Corner {
  return { type: "superellipse", radii: { x: r, y: r }, smoothing };
}
// Suppress unused-symbol warnings until later tasks consume this helper.
void superellipse;

describe("appendSuperellipseCorner at smoothing = 0", () => {
  it("emits a single bezierCurveTo", () => {
    const r = new PathRecorder();
    appendSuperellipseCorner(r, TL_GEOM, 0);
    expect(r.ops.length).toBe(1);
    expect(r.ops[0].method).toBe("bezierCurveTo");
  });

  it("control points are placed using kappa anchor at bleed=1.0", () => {
    const r = new PathRecorder();
    appendSuperellipseCorner(r, TL_GEOM, 0);
    const expectedOffset = 16 * (1 - 0.5522847498) * 1.0;
    // cp1: corner (0,0) - entryDir (0,-1) * offset = (0, +offset).
    expect(r.ops[0].args[0]).toBeCloseTo(0, 6);
    expect(r.ops[0].args[1]).toBeCloseTo(expectedOffset, 6);
    // cp2: corner (0,0) + exitDir (1,0) * offset = (offset, 0).
    expect(r.ops[0].args[2]).toBeCloseTo(expectedOffset, 6);
    expect(r.ops[0].args[3]).toBeCloseTo(0, 6);
    // Exit endpoint: (16, 0).
    expect(r.ops[0].args[4]).toBeCloseTo(16, 6);
    expect(r.ops[0].args[5]).toBeCloseTo(0, 6);
  });
});

describe("appendSuperellipseCorner interpolation", () => {
  it("at smoothing = 1, control point offset extends to bleed=1.5", () => {
    const r = new PathRecorder();
    appendSuperellipseCorner(r, TL_GEOM, 1);
    const expectedOffset = 16 * (1 - 0.5522847498) * 1.5;
    expect(r.ops[0].args[1]).toBeCloseTo(expectedOffset, 6); // cp1.y
    expect(r.ops[0].args[2]).toBeCloseTo(expectedOffset, 6); // cp2.x
  });

  it("at smoothing = 0.5, control point offset is the midpoint between bleed values", () => {
    const r = new PathRecorder();
    appendSuperellipseCorner(r, TL_GEOM, 0.5);
    // Midpoint of bleed between 1.0 and 1.5 is 1.25.
    const expectedOffset = 16 * (1 - 0.5522847498) * 1.25;
    expect(r.ops[0].args[1]).toBeCloseTo(expectedOffset, 6);
    expect(r.ops[0].args[2]).toBeCloseTo(expectedOffset, 6);
  });
});
