/**
 * @vitest-environment jsdom
 *
 * Tests for SvgPathBuilder. The builder implements PathBuilder from
 * corner-path.ts so Plan 14c's appendCornerPath can drive SVG output.
 */
import { describe, it, expect } from "vitest";
import { SvgPathBuilder } from "../corner-svg-builder";

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
