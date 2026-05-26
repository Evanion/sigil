/**
 * @vitest-environment jsdom
 *
 * Tests for SvgPathBuilder. The builder implements PathBuilder from
 * corner-path.ts so Plan 14c's appendCornerPath can drive SVG output.
 */
import { describe, it, expect, vi } from "vitest";
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
