/**
 * @vitest-environment jsdom
 *
 * Pure-geometry tests for `corner-path.ts`. Uses a `PathRecorder` that
 * implements the `PathBuilder` structural interface; assertions are on the
 * recorded operation sequence.
 *
 * Per spec § 4.3: no pixel snapshots, no `canvas` npm package.
 */
import { describe, it, expect, vi } from "vitest";
import {
  appendCornerPath,
  appendRoundCorner,
  appendBevelCorner,
  appendNotchCorner,
  appendScoopCorner,
  appendSuperellipseCorner,
  buildCornerPath,
  clampScale,
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
  // TL entry edge is vertical (left side) → entryEdgeRadius = ry.
  // TL exit edge is horizontal (top) → exitEdgeRadius = rx.
  entryEdgeRadius: 16,
  exitEdgeRadius: 16,
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

describe("clampScale", () => {
  it("returns 1.0 when radii fit within edges", () => {
    const corners: Corners = [round(16), round(16), round(16), round(16)];
    expect(clampScale(100, 100, corners)).toBe(1);
  });

  it("returns 0.75 when top-edge sum exceeds width by 4/3x", () => {
    const corners: Corners = [round(40), round(40), round(40), round(40)];
    // Top edge: 40 + 40 = 80 > 60 → scale = 60/80 = 0.75.
    expect(clampScale(60, 100, corners)).toBe(0.75);
  });

  it("uses the minimum scale across all 4 edges", () => {
    // Asymmetric: left edge is the constraint.
    const corners: Corners = [round(60), round(10), round(10), round(60)];
    // Left edge: 60 + 60 = 120 > 100 → scale_left = 100/120 ≈ 0.833.
    // Top edge: 60 + 10 = 70 < 100 → scale_top ≈ 1.43, no clamp.
    // Right edge: 10 + 10 = 20, scale_right = 5.
    // Bottom edge: 10 + 60 = 70, scale_bottom ≈ 1.43.
    // Min: scale_left.
    expect(clampScale(100, 100, corners)).toBeCloseTo(100 / 120, 6);
  });
});

describe("appendCornerPath — radius clamping", () => {
  it("scales ellipse radii when corner radii exceed edge length", () => {
    const r = new PathRecorder();
    const corners: Corners = [round(40), round(40), round(40), round(40)];
    appendCornerPath(r, 0, 0, 60, 60, corners);
    // After clamping, scale = 60/80 = 0.75 → effective radii = 30.
    const ellipses = r.ops.filter((op) => op.method === "ellipse");
    expect(ellipses.length).toBe(4);
    for (const e of ellipses) {
      expect(e.args[2]).toBeCloseTo(30, 6); // rx
      expect(e.args[3]).toBeCloseTo(30, 6); // ry
    }
  });
});

describe("appendCornerPath — input guards", () => {
  it("emits no ops and warns on NaN x", () => {
    const r = new PathRecorder();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const corners: Corners = [round(16), round(16), round(16), round(16)];
      appendCornerPath(r, NaN, 0, 100, 100, corners);
      expect(r.ops.length).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("emits no ops and warns on Infinity width", () => {
    const r = new PathRecorder();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const corners: Corners = [round(16), round(16), round(16), round(16)];
      appendCornerPath(r, 0, 0, Infinity, 100, corners);
      expect(r.ops.length).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("emits no ops on zero width (degenerate rectangle)", () => {
    const r = new PathRecorder();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const corners: Corners = [round(16), round(16), round(16), round(16)];
      appendCornerPath(r, 0, 0, 0, 100, corners);
      expect(r.ops.length).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("emits no ops on NaN radius", () => {
    const r = new PathRecorder();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const corners: Corners = [
        { type: "round", radii: { x: NaN, y: 16 } },
        round(16),
        round(16),
        round(16),
      ];
      appendCornerPath(r, 0, 0, 100, 100, corners);
      expect(r.ops.length).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("emits no ops on superellipse smoothing > 1", () => {
    const r = new PathRecorder();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const corners: Corners = [
        superellipse(16, 1.5),
        superellipse(16, 0.5),
        superellipse(16, 0.5),
        superellipse(16, 0.5),
      ];
      appendCornerPath(r, 0, 0, 100, 100, corners);
      expect(r.ops.length).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("emits no ops on superellipse smoothing < 0", () => {
    const r = new PathRecorder();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const corners: Corners = [
        superellipse(16, -0.1),
        superellipse(16, 0.5),
        superellipse(16, 0.5),
        superellipse(16, 0.5),
      ];
      appendCornerPath(r, 0, 0, 100, 100, corners);
      expect(r.ops.length).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("appendCornerPath — mixed shapes", () => {
  it("emits the right per-corner ops when corners differ", () => {
    const r = new PathRecorder();
    const corners: Corners = [round(16), bevel(16), notch(16), scoop(16)];
    appendCornerPath(r, 0, 0, 100, 100, corners);
    // The orchestrator emits corners in order: TR, BR, BL, TL.
    // TR is index 1 = bevel (1 lineTo).
    // BR is index 2 = notch (2 lineTo).
    // BL is index 3 = scoop (1 ellipse).
    // TL is index 0 = round (1 ellipse).
    const methods = r.ops.map((op) => op.method);
    expect(methods).toEqual([
      "moveTo",
      "lineTo", // top edge
      "lineTo", // TR bevel
      "lineTo", // right edge
      "lineTo", // BR notch step 1
      "lineTo", // BR notch step 2
      "lineTo", // bottom edge
      "ellipse", // BL scoop
      "lineTo", // left edge
      "ellipse", // TL round
      "closePath",
    ]);
  });
});

describe("buildCornerPath public API", () => {
  it("returns a Path2D instance", () => {
    const corners: Corners = [round(16), round(16), round(16), round(16)];
    const path = buildCornerPath(0, 0, 100, 100, corners);
    expect(path).toBeInstanceOf(Path2D);
  });

  it("returns an empty Path2D when inputs are invalid (no throw)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const corners: Corners = [round(16), round(16), round(16), round(16)];
      const path = buildCornerPath(NaN, 0, 100, 100, corners);
      // Construction succeeds; path is empty (no observable side effect).
      expect(path).toBeInstanceOf(Path2D);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ── RF-001 / RF-003: asymmetric radii (rx ≠ ry) regression tests ─────────────
//
// Bug class: per-corner helpers were conflating rx and ry, using whichever
// happened to be defined on the "entry" vs "exit" role rather than selecting
// by edge axis. The bug was hidden by every existing test using circular
// radii (rx === ry). These tests exercise rectangles with elliptical radii
// (rx ≠ ry) where each corner uses a different shape; the assertion is that
// every per-corner helper hands the pen off to the orchestrator's next edge
// `lineTo` at the right coordinate.
//
// For a rect at (0,0,W,H) with corners=[CTL, CTR, CBR, CBL], the orchestrator
// emits, in order:
//   moveTo(CTL.rx, 0)
//   lineTo(W - CTR.rx, 0)      ← top edge to TR entry endpoint
//   <CTR helper>               ← must end the pen at (W, CTR.ry)
//   lineTo(W, H - CBR.ry)      ← right edge to BR entry endpoint
//   <CBR helper>               ← must end at (W - CBR.rx, H)
//   lineTo(CBL.rx, H)          ← bottom edge to BL entry endpoint
//   <CBL helper>               ← must end at (0, H - CBL.ry)
//   lineTo(0, CTL.ry)          ← left edge to TL entry endpoint
//   <CTL helper>               ← must end at (CTL.rx, 0)
//   closePath()
//
// Bevel emits one final `lineTo` per corner; we assert the last `lineTo`
// before each subsequent edge-lineTo matches the expected exit endpoint.
//
// Notch emits TWO `lineTo`s per corner (inner step + exit endpoint); the
// second is the exit endpoint we assert on.
//
// Superellipse emits one `bezierCurveTo`; the last two args are the exit
// endpoint (x, y).
//
// Scoop emits an `ellipse` call with the rectangle's corner-point as center
// and (rx, ry) as the axes — it's the only helper that natively handles
// rx ≠ ry via Canvas's ellipse API, so it's a control case.

// Asymmetric-radii helpers: each takes explicit rx and ry (the existing
// `bevel`/`notch`/`scoop` helpers above use a single circular radius).
function bevelXY(x: number, y: number): Corner {
  return { type: "bevel", radii: { x, y } };
}
function notchXY(x: number, y: number): Corner {
  return { type: "notch", radii: { x, y } };
}
function squircleXY(x: number, y: number, smoothing: number): Corner {
  return { type: "superellipse", radii: { x, y }, smoothing };
}
function scoopXY(x: number, y: number): Corner {
  return { type: "scoop", radii: { x, y } };
}

describe("asymmetric radii (rx ≠ ry) — RF-001 regression", () => {
  const W = 400;
  const H = 300;

  it("bevel: every corner's exit endpoint lands on its exit edge", () => {
    // Each corner uses bevel with DIFFERENT rx and ry. If the helper picked
    // the wrong axis, the exit endpoint would land off the expected edge.
    const corners: Corners = [bevelXY(30, 20), bevelXY(25, 18), bevelXY(40, 12), bevelXY(35, 22)];
    const r = new PathRecorder();
    appendCornerPath(r, 0, 0, W, H, corners);

    // Pull out every lineTo and bezierCurveTo (the pen-position emitters).
    const lineTos = r.ops.filter((op) => op.method === "lineTo");
    // Five lineTos from the orchestrator (top, right, bottom, left, closing
    // happens implicitly via closePath) plus one per bevel corner = 9 total.
    expect(lineTos.length).toBe(8);

    // TR exit endpoint: (W, ry=18). After top-edge lineTo (W-25, 0) the
    // bevel must land on (W, 18) — NOT (W, 25) which is the wrong-axis bug.
    const trExit = lineTos[1];
    expect(trExit.args).toEqual([W, 18]);

    // BR exit endpoint: (W - 40, H). Comes after the right-edge lineTo
    // (W, H-12).
    const brExit = lineTos[3];
    expect(brExit.args).toEqual([W - 40, H]);

    // BL exit endpoint: (0, H - 22). Comes after the bottom-edge lineTo
    // (35, H).
    const blExit = lineTos[5];
    expect(blExit.args).toEqual([0, H - 22]);

    // TL exit endpoint: (30, 0). Comes after the left-edge lineTo (0, 20).
    const tlExit = lineTos[7];
    expect(tlExit.args).toEqual([30, 0]);
  });

  it("notch: every corner's exit endpoint lands on its exit edge", () => {
    const corners: Corners = [notchXY(30, 20), notchXY(25, 18), notchXY(40, 12), notchXY(35, 22)];
    const r = new PathRecorder();
    appendCornerPath(r, 0, 0, W, H, corners);
    const lineTos = r.ops.filter((op) => op.method === "lineTo");
    // Each notch emits 2 lineTos (inner + exit); orchestrator emits 4 edges.
    // 4 edges + 4 corners * 2 lineTos = 12.
    expect(lineTos.length).toBe(12);

    // TR exit endpoint (second lineTo of TR notch): (W, 18). Index map:
    // [0] top-edge, [1] TR inner, [2] TR exit, [3] right-edge, [4] BR inner,
    // [5] BR exit, [6] bottom-edge, [7] BL inner, [8] BL exit, [9] left-edge,
    // [10] TL inner, [11] TL exit.
    expect(lineTos[2].args).toEqual([W, 18]);
    // BR exit: (W - 40, H)
    expect(lineTos[5].args).toEqual([W - 40, H]);
    // BL exit: (0, H - 22)
    expect(lineTos[8].args).toEqual([0, H - 22]);
    // TL exit: (30, 0)
    expect(lineTos[11].args).toEqual([30, 0]);
  });

  it("superellipse (s=0): every corner's exit endpoint matches the round-corner endpoint", () => {
    // At smoothing=0, the bezier endpoints must land at the same coordinates
    // a round corner would have. This is the asymmetric-radii canary.
    const corners: Corners = [
      squircleXY(30, 20, 0),
      squircleXY(25, 18, 0),
      squircleXY(40, 12, 0),
      squircleXY(35, 22, 0),
    ];
    const r = new PathRecorder();
    appendCornerPath(r, 0, 0, W, H, corners);
    const beziers = r.ops.filter((op) => op.method === "bezierCurveTo");
    expect(beziers.length).toBe(4);

    // The last two args of each bezierCurveTo are (endpointX, endpointY).
    // bezierCurveTo signature: (cp1x, cp1y, cp2x, cp2y, x, y).
    const [tr, br, bl, tl] = beziers;
    // TR exit endpoint: (W, ry=18)
    expect([tr.args[4], tr.args[5]]).toEqual([W, 18]);
    // BR exit endpoint: (W - 40, H)
    expect([br.args[4], br.args[5]]).toEqual([W - 40, H]);
    // BL exit endpoint: (0, H - 22)
    expect([bl.args[4], bl.args[5]]).toEqual([0, H - 22]);
    // TL exit endpoint: (30, 0)
    expect([tl.args[4], tl.args[5]]).toEqual([30, 0]);
  });

  it("superellipse: control points sit on the edges (tangent C1 with straight edges)", () => {
    // With smoothing=0 and bleed=1.0, the cp offset is rx*(1-K) on horizontal
    // edges and ry*(1-K) on vertical edges. Asymmetric radii must produce
    // axis-correct offsets — the bug used rx where ry was needed and v.v.
    const K = 1 - 0.5522847498;
    const corners: Corners = [
      squircleXY(30, 20, 0),
      squircleXY(25, 18, 0),
      squircleXY(40, 12, 0),
      squircleXY(35, 22, 0),
    ];
    const r = new PathRecorder();
    appendCornerPath(r, 0, 0, W, H, corners);
    const beziers = r.ops.filter((op) => op.method === "bezierCurveTo");

    // TR cp1 is on the top edge (entry edge = horizontal, entryEdgeRadius = rx = 25):
    //   cp1 = (cornerX - entryDirX * 25 * K, cornerY) = (W - 25*K, 0)
    // TR cp2 is on the right edge (exit edge = vertical, exitEdgeRadius = ry = 18):
    //   cp2 = (cornerX, cornerY + exitDirY * 18 * K) = (W, 18*K)
    const tr = beziers[0];
    expect(tr.args[0]).toBeCloseTo(W - 25 * K, 6);
    expect(tr.args[1]).toBe(0);
    expect(tr.args[2]).toBe(W);
    expect(tr.args[3]).toBeCloseTo(18 * K, 6);

    // BR cp1: entry edge vertical (right side), entryEdgeRadius = ry = 12.
    //   cp1 = (W, H - 12*K)
    // BR cp2: exit edge horizontal (bottom), exitEdgeRadius = rx = 40.
    //   cp2 = (W - 40*K, H)
    const br = beziers[1];
    expect(br.args[0]).toBe(W);
    expect(br.args[1]).toBeCloseTo(H - 12 * K, 6);
    expect(br.args[2]).toBeCloseTo(W - 40 * K, 6);
    expect(br.args[3]).toBe(H);
  });

  it("scoop: every corner's ellipse uses corner-specific rx and ry (control)", () => {
    // Scoop uses ctx.ellipse(cornerX, cornerY, rx, ry, ...) — Canvas natively
    // handles asymmetric axes via two separate parameters. This is the
    // control case: scoop is expected to be correct regardless of the bug.
    const corners: Corners = [scoopXY(30, 20), scoopXY(25, 18), scoopXY(40, 12), scoopXY(35, 22)];
    const r = new PathRecorder();
    appendCornerPath(r, 0, 0, W, H, corners);
    const ellipses = r.ops.filter((op) => op.method === "ellipse");
    expect(ellipses.length).toBe(4);

    // ellipse signature: (cx, cy, rx, ry, rotation, startAngle, endAngle, counterclockwise?).
    const [tr, br, bl, tl] = ellipses;
    // TR: corner = (W, 0), rx=25, ry=18
    expect([tr.args[0], tr.args[1], tr.args[2], tr.args[3]]).toEqual([W, 0, 25, 18]);
    // BR: corner = (W, H), rx=40, ry=12
    expect([br.args[0], br.args[1], br.args[2], br.args[3]]).toEqual([W, H, 40, 12]);
    // BL: corner = (0, H), rx=35, ry=22
    expect([bl.args[0], bl.args[1], bl.args[2], bl.args[3]]).toEqual([0, H, 35, 22]);
    // TL: corner = (0, 0), rx=30, ry=20
    expect([tl.args[0], tl.args[1], tl.args[2], tl.args[3]]).toEqual([0, 0, 30, 20]);
  });
});
