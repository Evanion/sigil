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
