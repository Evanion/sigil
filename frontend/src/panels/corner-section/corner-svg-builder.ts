/**
 * SvgPathBuilder — translates Canvas-style PathBuilder ops into an SVG
 * `d` attribute string. Implements the same structural interface as
 * `Path2D` so Plan 14c's `appendCornerPath` can drive both Canvas and
 * SVG output from one source of truth (Spec 14 §1.6).
 *
 * Coordinate conventions are identical (y-down). Translation rules:
 *  - moveTo(x, y)         → "M {x} {y}"
 *  - lineTo(x, y)         → "L {x} {y}"
 *  - bezierCurveTo(...)   → "C {cp1x} {cp1y} {cp2x} {cp2y} {x} {y}"
 *  - ellipse(...)         → "L {startX} {startY} A {rx} {ry} 0 {large} {sweep} {endX} {endY}"
 *    (see Task 3 for full ellipse math)
 *  - closePath()          → "Z"
 *
 * Numeric outputs are formatted with 4 decimal places to keep the
 * resulting `d` string compact and stable across browsers.
 */

import type { PathBuilder } from "../../canvas/corner-path";

const DECIMALS = 4;

function fmt(n: number): string {
  if (!Number.isFinite(n)) {
    // CLAUDE.md §11 Floating-Point Validation — guard at the helper entry.
    // Non-finite values should never reach the builder (the orchestrator
    // validates upstream), but a defensive guard prevents a malformed
    // `d` string from silently rendering nothing.
    console.warn("SvgPathBuilder.fmt: non-finite value", { value: n });
    return "0";
  }
  return n.toFixed(DECIMALS).replace(/\.?0+$/, "");
}

export class SvgPathBuilder implements PathBuilder {
  private parts: string[] = [];

  moveTo(x: number, y: number): void {
    this.parts.push(`M ${fmt(x)} ${fmt(y)}`);
  }

  lineTo(x: number, y: number): void {
    this.parts.push(`L ${fmt(x)} ${fmt(y)}`);
  }

  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this.parts.push(
      `C ${fmt(cp1x)} ${fmt(cp1y)} ${fmt(cp2x)} ${fmt(cp2y)} ${fmt(x)} ${fmt(y)}`,
    );
  }

  ellipse(
    _cx: number,
    _cy: number,
    _rx: number,
    _ry: number,
    _rotation: number,
    _startAngle: number,
    _endAngle: number,
    _counterclockwise = false,
  ): void {
    throw new Error("SvgPathBuilder.ellipse: implemented in Task 3");
  }

  closePath(): void {
    this.parts.push("Z");
  }

  toString(): string {
    return this.parts.join(" ");
  }
}
