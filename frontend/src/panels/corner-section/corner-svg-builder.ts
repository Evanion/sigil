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
    this.parts.push(`C ${fmt(cp1x)} ${fmt(cp1y)} ${fmt(cp2x)} ${fmt(cp2y)} ${fmt(x)} ${fmt(y)}`);
  }

  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    // CLAUDE.md §11 Floating-Point Validation — guard at the helper entry.
    if (
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      !Number.isFinite(rx) ||
      !Number.isFinite(ry) ||
      !Number.isFinite(rotation) ||
      !Number.isFinite(startAngle) ||
      !Number.isFinite(endAngle) ||
      rx <= 0 ||
      ry <= 0
    ) {
      console.warn("SvgPathBuilder.ellipse: rejected non-finite or non-positive input", {
        cx,
        cy,
        rx,
        ry,
        rotation,
        startAngle,
        endAngle,
      });
      return;
    }

    // 1. Compute endpoints on un-rotated ellipse, then rotate around (cx, cy).
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    function rotate(localX: number, localY: number): [number, number] {
      return [localX * cosR - localY * sinR, localX * sinR + localY * cosR];
    }
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

    // 2. Compute the sweep angle (always non-negative, < 2π).
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

    // 3. Convert to SVG flags.
    const largeArc = sweep > Math.PI ? 1 : 0;
    const sweepFlag = counterclockwise ? 0 : 1;

    // 4. Convert rotation from radians to degrees for SVG's x-axis-rotation.
    const rotationDeg = (rotation * 180) / Math.PI;

    // 5. Emit lineTo to arc start (idempotent if pen is already there),
    //    then the arc command.
    this.parts.push(`L ${fmt(startX)} ${fmt(startY)}`);
    this.parts.push(
      `A ${fmt(rx)} ${fmt(ry)} ${fmt(rotationDeg)} ${largeArc} ${sweepFlag} ${fmt(endX)} ${fmt(endY)}`,
    );
  }

  closePath(): void {
    this.parts.push("Z");
  }

  toString(): string {
    return this.parts.join(" ");
  }
}
