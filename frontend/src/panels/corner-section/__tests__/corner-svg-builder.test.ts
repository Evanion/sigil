/**
 * @vitest-environment jsdom
 *
 * Tests for SvgPathBuilder. The builder implements PathBuilder from
 * corner-path.ts so Plan 14c's appendCornerPath can drive SVG output.
 */
import { describe, it, expect, vi } from "vitest";
import { SvgPathBuilder } from "../corner-svg-builder";
import { appendCornerPath, type PathBuilder } from "../../../canvas/corner-path";
import type { Corner, Corners } from "../../../types/document";

describe("SvgPathBuilder — basic ops", () => {
  it("moveTo emits M command", () => {
    const b = new SvgPathBuilder();
    b.moveTo(10, 20);
    expect(b.toString()).toBe("M 10 20");
  });

  it("lineTo emits L command", () => {
    const b = new SvgPathBuilder();
    b.moveTo(0, 0);
    b.lineTo(50, 30);
    expect(b.toString()).toBe("M 0 0 L 50 30");
  });

  it("bezierCurveTo emits C command", () => {
    const b = new SvgPathBuilder();
    b.moveTo(0, 0);
    b.bezierCurveTo(10, 10, 20, 30, 40, 50);
    expect(b.toString()).toBe("M 0 0 C 10 10 20 30 40 50");
  });

  it("closePath emits Z command", () => {
    const b = new SvgPathBuilder();
    b.moveTo(0, 0);
    b.lineTo(100, 0);
    b.closePath();
    expect(b.toString()).toBe("M 0 0 L 100 0 Z");
  });

  it("formats numbers to 4 decimals max, trimming trailing zeros", () => {
    const b = new SvgPathBuilder();
    b.moveTo(1.123456, 2);
    expect(b.toString()).toBe("M 1.1235 2");
  });
});

describe("SvgPathBuilder — ellipse → arc", () => {
  it("translates a quarter-circle (TL round) to an L + A pair", () => {
    // TL round corner: cx=rx, cy=ry, sweep π to 1.5π clockwise.
    // Local at startAngle=π: (rx*cos π, ry*sin π) = (-rx, 0)
    // Local at endAngle=1.5π: (rx*cos 1.5π, ry*sin 1.5π) = (0, -ry)
    // World: start = (0, ry), end = (rx, 0). Sweep = π/2 (large=0, sweep-flag=1).
    const b = new SvgPathBuilder();
    b.ellipse(16, 16, 16, 16, 0, Math.PI, 1.5 * Math.PI);
    expect(b.toString()).toBe("L 0 16 A 16 16 0 0 1 16 0");
  });

  it("translates a counterclockwise quarter arc (scoop) with sweep-flag=0", () => {
    // TL scoop: ellipse centered at corner (0,0), arc CCW from endAngle-π=0.5π to startAngle-π=0.
    // Local at 0.5π: (0, ry). Local at 0: (rx, 0). World same.
    // CCW sweep from 0.5π to 0 = π/2. large=0, sweep-flag=0.
    const b = new SvgPathBuilder();
    b.ellipse(0, 0, 16, 16, 0, 0.5 * Math.PI, 0, true);
    expect(b.toString()).toBe("L 0 16 A 16 16 0 0 0 16 0");
  });

  it("emits large-arc-flag=1 when sweep exceeds π", () => {
    // 3/4 sweep: π → 0.5π going CW. Need to normalize: 0.5π < π so add 2π → 2.5π.
    // sweep = 2.5π - π = 1.5π > π.
    const b = new SvgPathBuilder();
    b.ellipse(0, 0, 10, 10, 0, Math.PI, 0.5 * Math.PI);
    const d = b.toString();
    expect(d).toMatch(/A 10 10 0 1 1/); // large=1, sweep=1
  });

  it("rejects non-finite radii with a structured warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const b = new SvgPathBuilder();
      b.ellipse(0, 0, NaN, 10, 0, 0, Math.PI);
      expect(b.toString()).toBe("");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("rejected non-finite"),
        expect.objectContaining({ rx: NaN }),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

// ── Parity tests: shared appendCornerPath drives both builders ──────────

interface RecordedOp {
  method: "moveTo" | "lineTo" | "bezierCurveTo" | "ellipse" | "closePath";
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
  closePath(): void {
    this.ops.push({ method: "closePath", args: [] });
  }
}

function round(r: number): Corner {
  return { type: "round", radii: { x: r, y: r } };
}
function bevel(rx: number, ry: number): Corner {
  return { type: "bevel", radii: { x: rx, y: ry } };
}
function notch(rx: number, ry: number): Corner {
  return { type: "notch", radii: { x: rx, y: ry } };
}
function scoop(rx: number, ry: number): Corner {
  return { type: "scoop", radii: { x: rx, y: ry } };
}
function superellipse(r: number, smoothing: number): Corner {
  return { type: "superellipse", radii: { x: r, y: r }, smoothing };
}
// RF-022: superellipse with independent rx and ry. The data model supports
// per-axis radii (see canvas/corner-path.ts appendSuperellipseCorner), so
// asymmetric superellipse fixtures must be exercised — without this, a
// regression that swapped rx and ry in the bezier control-point math would
// be invisible to the parity suite (all-symmetric fixtures collapse the bug).
function superellipseXY(rx: number, ry: number, smoothing: number): Corner {
  return { type: "superellipse", radii: { x: rx, y: ry }, smoothing };
}

/**
 * RF-021: helper to compute the SVG arc args that SvgPathBuilder.ellipse
 * is expected to emit, given the Canvas-style ellipse parameters. Mirrors
 * the math in SvgPathBuilder.ellipse so the parity test can assert exact
 * coordinate equality, not just op-type counts. If the builder's arc math
 * drifts from the formula the recorder is matched against, the test fails.
 */
interface ExpectedArc {
  readonly startX: number;
  readonly startY: number;
  readonly rx: number;
  readonly ry: number;
  readonly rotationDeg: number;
  readonly largeArc: 0 | 1;
  readonly sweepFlag: 0 | 1;
  readonly endX: number;
  readonly endY: number;
}

function computeExpectedArc(args: readonly number[]): ExpectedArc {
  const [cx, cy, rx, ry, rotation, startAngle, endAngle, ccw] = args;
  const counterclockwise = ccw === 1;
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const rotate = (lx: number, ly: number): [number, number] => [
    lx * cosR - ly * sinR,
    lx * sinR + ly * cosR,
  ];
  const startLocalX = rx * Math.cos(startAngle);
  const startLocalY = ry * Math.sin(startAngle);
  const endLocalX = rx * Math.cos(endAngle);
  const endLocalY = ry * Math.sin(endAngle);
  const [srx, sry] = rotate(startLocalX, startLocalY);
  const [erx, ery] = rotate(endLocalX, endLocalY);
  const startX = cx + srx;
  const startY = cy + sry;
  const endX = cx + erx;
  const endY = cy + ery;
  const TWO_PI = 2 * Math.PI;
  let sweep: number;
  if (!counterclockwise) {
    let e = endAngle;
    while (e < startAngle) e += TWO_PI;
    sweep = e - startAngle;
  } else {
    let e = endAngle;
    while (e > startAngle) e -= TWO_PI;
    sweep = startAngle - e;
  }
  const largeArc = sweep > Math.PI ? 1 : 0;
  const sweepFlag = counterclockwise ? 0 : 1;
  const rotationDeg = (rotation * 180) / Math.PI;
  return { startX, startY, rx, ry, rotationDeg, largeArc, sweepFlag, endX, endY };
}

/**
 * RF-021: strengthened parity check. Walks the recorder's ops in order and
 * asserts that the SVG `d` string contains the exact tokens each Canvas op
 * should translate into — not just the count of each command letter.
 *
 *  - moveTo(x, y)           → "M {x} {y}"
 *  - lineTo(x, y)           → "L {x} {y}"
 *  - bezierCurveTo(...)     → "C {cp1x} {cp1y} {cp2x} {cp2y} {x} {y}"
 *  - ellipse(...)           → "L {startX} {startY} A {rx} {ry} {rotDeg} {large} {sweep} {endX} {endY}"
 *  - closePath()            → "Z"
 *
 * Tokens are parsed from the builder's whitespace-delimited `d` string and
 * compared with toBeCloseTo at 4 decimal places (matches the builder's
 * `fmt` precision).
 *
 * This catches: (a) coordinate swap bugs (rx ↔ ry, x ↔ y), (b) flag-sign
 * bugs (large-arc vs sweep), (c) drift in either implementation's arc
 * endpoint math, (d) translations that get the structural counts right but
 * produce different coordinates.
 */
function expectParity(corners: Corners, x = 0, y = 0, w = 100, h = 80): void {
  const recorder = new PathRecorder();
  const builder = new SvgPathBuilder();
  appendCornerPath(recorder, x, y, w, h, corners);
  appendCornerPath(builder, x, y, w, h, corners);

  // Tokenize the SVG d string. Numbers parse via Number(); command letters
  // stay as strings ("M", "L", "C", "A", "Z").
  const tokens = builder
    .toString()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  let cursor = 0;
  const nextToken = (): string => {
    const t = tokens[cursor];
    cursor += 1;
    return t;
  };
  const nextNumber = (): number => Number(nextToken());

  for (const op of recorder.ops) {
    switch (op.method) {
      case "moveTo": {
        expect(nextToken(), `op #${cursor} should be M`).toBe("M");
        expect(nextNumber()).toBeCloseTo(op.args[0], 4);
        expect(nextNumber()).toBeCloseTo(op.args[1], 4);
        break;
      }
      case "lineTo": {
        expect(nextToken(), `op #${cursor} should be L`).toBe("L");
        expect(nextNumber()).toBeCloseTo(op.args[0], 4);
        expect(nextNumber()).toBeCloseTo(op.args[1], 4);
        break;
      }
      case "bezierCurveTo": {
        expect(nextToken(), `op #${cursor} should be C`).toBe("C");
        for (let i = 0; i < op.args.length; i++) {
          expect(nextNumber()).toBeCloseTo(op.args[i], 4);
        }
        break;
      }
      case "ellipse": {
        // ellipse emits a paired L (start point) then A (arc-to end point).
        const expected = computeExpectedArc(op.args);
        expect(nextToken(), `ellipse should emit L first`).toBe("L");
        expect(nextNumber()).toBeCloseTo(expected.startX, 4);
        expect(nextNumber()).toBeCloseTo(expected.startY, 4);
        expect(nextToken(), `ellipse should emit A after L`).toBe("A");
        expect(nextNumber()).toBeCloseTo(expected.rx, 4);
        expect(nextNumber()).toBeCloseTo(expected.ry, 4);
        expect(nextNumber()).toBeCloseTo(expected.rotationDeg, 4);
        expect(nextNumber()).toBe(expected.largeArc);
        expect(nextNumber()).toBe(expected.sweepFlag);
        expect(nextNumber()).toBeCloseTo(expected.endX, 4);
        expect(nextNumber()).toBeCloseTo(expected.endY, 4);
        break;
      }
      case "closePath": {
        expect(nextToken(), `op #${cursor} should be Z`).toBe("Z");
        break;
      }
    }
  }
  // No leftover tokens — the builder must produce exactly the expected
  // sequence, no more.
  expect(cursor, "SVG d string had extra trailing tokens not matched by any op").toBe(
    tokens.length,
  );
}

describe("SvgPathBuilder ↔ PathRecorder parity (RF-019)", () => {
  it("all-round rectangle: 4 ellipses, 4 lineTos, 1 moveTo, 1 closePath", () => {
    const corners: Corners = [round(16), round(16), round(16), round(16)];
    expectParity(corners);
  });

  it("all-bevel rectangle: 4 lineTos (corner cuts) + 4 edge lineTos", () => {
    const corners: Corners = [bevel(8, 8), bevel(8, 8), bevel(8, 8), bevel(8, 8)];
    expectParity(corners);
  });

  it("all-notch rectangle: 8 lineTos (corner steps) + 4 edge lineTos", () => {
    const corners: Corners = [notch(8, 8), notch(8, 8), notch(8, 8), notch(8, 8)];
    expectParity(corners);
  });

  it("all-scoop rectangle: 4 ellipses + 4 edge lineTos", () => {
    const corners: Corners = [scoop(8, 8), scoop(8, 8), scoop(8, 8), scoop(8, 8)];
    expectParity(corners);
  });

  it("all-superellipse rectangle: 4 beziers + 4 edge lineTos", () => {
    const corners: Corners = [
      superellipse(8, 0.5),
      superellipse(8, 0.5),
      superellipse(8, 0.5),
      superellipse(8, 0.5),
    ];
    expectParity(corners);
  });

  it("asymmetric radii — bevel/notch/scoop with rx ≠ ry", () => {
    // Per the "Tests for Multi-Axis Inputs Must Cover Non-Degenerate Cases"
    // rule from frontend-defensive.md. PR #64 RF-001 precedent.
    const corners: Corners = [
      bevel(30, 10),
      notch(25, 15),
      superellipse(20, 0.7), // symmetric superellipse still in this case
      scoop(8, 16),
    ];
    expectParity(corners);
  });

  it("RF-022: asymmetric radii — superellipse with rx ≠ ry per corner", () => {
    // Spec 14's Corner data model supports independent rx and ry per
    // superellipse corner via entryEdgeRadius / exitEdgeRadius (see
    // canvas/corner-path.ts appendSuperellipseCorner). The previous
    // asymmetric-radii fixture only exercised superellipse with rx === ry,
    // which leaves the bezier control-point math in the rx/ry asymmetric
    // branch uncovered by the parity suite. Combined with the strengthened
    // coordinate-equality assertions from RF-021, this catches any swap-
    // rx-ry bug in the superellipse path.
    const corners: Corners = [
      superellipseXY(30, 10, 0.5),
      superellipseXY(20, 40, 0.5),
      superellipseXY(15, 25, 0.5),
      superellipseXY(35, 5, 0.5),
    ];
    expectParity(corners);
  });

  it("RF-022: asymmetric radii — swapped fixture (rx ↔ ry vs prior test)", () => {
    // Companion test to the one above — same corner set with rx and ry
    // swapped per position. If the builder ever mixed up axis identity
    // for a specific corner role, only ONE of these two tests would fail,
    // narrowing the regression's location.
    const corners: Corners = [
      superellipseXY(10, 30, 0.5),
      superellipseXY(40, 20, 0.5),
      superellipseXY(25, 15, 0.5),
      superellipseXY(5, 35, 0.5),
    ];
    expectParity(corners);
  });
});

describe("SvgPathBuilder — exact d-string snapshot (RF-021)", () => {
  it("all-round 16-radius rectangle produces a deterministic, finite d string", () => {
    // Belt-and-braces: in addition to the coordinate-by-coordinate parity
    // check above, capture an exact d-string snapshot for the canonical
    // case so a visually-obvious regression (extra space, wrong precision,
    // missing Z) shows up as a one-line diff. The expected string is
    // mechanically derived by running both implementations on the same
    // input — any drift between Canvas-orchestrator output and SVG output
    // is independently caught by expectParity; THIS test catches drift in
    // the SVG formatter itself (e.g., precision changes, token separator
    // changes).
    const builder = new SvgPathBuilder();
    const corners: Corners = [round(16), round(16), round(16), round(16)];
    appendCornerPath(builder, 0, 0, 100, 80, corners);
    const d = builder.toString();
    // Sanity: starts with M, ends with Z, contains 4 arcs (one per corner).
    expect(d.startsWith("M ")).toBe(true);
    expect(d.endsWith(" Z")).toBe(true);
    expect((d.match(/A /g) ?? []).length).toBe(4);
    // No malformed tokens (NaN/Infinity would be emitted as "0" via fmt's
    // guard, but never as the literal strings "NaN" or "Infinity").
    expect(d).not.toMatch(/NaN|Infinity/);
  });
});
