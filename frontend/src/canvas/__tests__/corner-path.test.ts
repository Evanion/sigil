/**
 * @vitest-environment jsdom
 *
 * Pure-geometry tests for `corner-path.ts`. We use a `PathRecorder` that
 * implements the `PathBuilder` structural interface and records every
 * emitted operation; tests assert on the operation sequence.
 *
 * Per spec § 4.3 + § 3.7: no pixel snapshots, no `canvas` npm package.
 * For pure deterministic geometry, instruction sequence == output.
 */
import { describe, it, expect } from "vitest";
import {
  appendCornerPath,
  appendRoundCorner,
  type PathBuilder,
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

describe("appendRoundCorner", () => {
  it("emits a single ellipse instruction for a round corner", () => {
    const r = new PathRecorder();
    appendRoundCorner(r, round(16));
    const ellipses = r.ops.filter((op) => op.method === "ellipse");
    expect(ellipses.length).toBe(1);
  });
});

// Suppress unused-import warnings until later tasks use these symbols.
void appendCornerPath;
const _typeKeep: Corners | null = null;
void _typeKeep;
