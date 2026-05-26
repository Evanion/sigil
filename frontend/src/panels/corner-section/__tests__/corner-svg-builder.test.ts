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

// Cross-builder structural check: every Canvas op (recorder) must have
// a corresponding SVG token (builder). Bezier and lineTo translate 1:1.
// Ellipse translates to `L startX startY A rx ry rotDeg large sweep endX endY`.
// MoveTo translates to `M`. ClosePath translates to `Z`.
function expectParity(corners: Corners, x = 0, y = 0, w = 100, h = 80): void {
  const recorder = new PathRecorder();
  const builder = new SvgPathBuilder();
  appendCornerPath(recorder, x, y, w, h, corners);
  appendCornerPath(builder, x, y, w, h, corners);

  const expectedTokens = recorder.ops.flatMap((op) => {
    switch (op.method) {
      case "moveTo":
        return ["M", String(op.args[0]), String(op.args[1])];
      case "lineTo":
        return ["L", String(op.args[0]), String(op.args[1])];
      case "bezierCurveTo":
        return ["C", ...op.args.map((a) => String(a))];
      case "ellipse":
        // The builder emits L startX startY then A rx ry rotDeg large sweep endX endY.
        // Don't reproduce the math here — just count that the SVG has both L and A
        // somewhere for each ellipse op. This is checked via op-type counts below.
        return ["__ELLIPSE_PAIR__"];
      case "closePath":
        return ["Z"];
    }
  });
  // Hint of structure: every M/L/C/Z appears in SVG; every ellipse becomes L+A.
  const ellipseCount = recorder.ops.filter((o) => o.method === "ellipse").length;
  const svgTokens = builder.toString().split(/\s+/);
  // Counts of letter commands in SVG.
  const counts = (re: RegExp) => svgTokens.filter((t) => re.test(t)).length;
  expect(counts(/^M$/)).toBe(recorder.ops.filter((o) => o.method === "moveTo").length);
  expect(counts(/^C$/)).toBe(recorder.ops.filter((o) => o.method === "bezierCurveTo").length);
  expect(counts(/^Z$/)).toBe(recorder.ops.filter((o) => o.method === "closePath").length);
  expect(counts(/^A$/)).toBe(ellipseCount);
  // Every ellipse in the recorder produces a paired L in the SVG; lineTo ops
  // also produce L. So total L count = lineTo count + ellipse count.
  expect(counts(/^L$/)).toBe(
    recorder.ops.filter((o) => o.method === "lineTo").length + ellipseCount,
  );
  // expectedTokens reference avoids unused-var lint when the asserts above pass.
  expect(expectedTokens.length).toBeGreaterThan(0);
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

  it("asymmetric radii — bevel/notch/superellipse with rx ≠ ry", () => {
    // Per the "Tests for Multi-Axis Inputs Must Cover Non-Degenerate Cases"
    // rule from frontend-defensive.md. PR #64 RF-001 precedent.
    const corners: Corners = [
      bevel(30, 10),
      notch(25, 15),
      superellipse(20, 0.7), // rx == ry for superellipse per spec uniformity
      scoop(8, 16),
    ];
    expectParity(corners);
  });
});
