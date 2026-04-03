import { describe, it, expect } from "vitest";
import { computeDropTarget, canDropInside } from "../tree-insertion";

describe("computeDropTarget", () => {
  const ROW_HEIGHT = 28;

  it("should return 'before' when cursor is in top 25% of row", () => {
    const result = computeDropTarget({
      targetUuid: "node-1",
      targetDepth: 2,
      targetCanHaveChildren: true,
      cursorY: 3,
      rowHeight: ROW_HEIGHT,
      cursorX: 60,
      treeLeftEdge: 0,
    });
    expect(result.position).toBe("before");
    expect(result.targetUuid).toBe("node-1");
  });

  it("should return 'after' when cursor is in bottom 25% of row", () => {
    const result = computeDropTarget({
      targetUuid: "node-1",
      targetDepth: 2,
      targetCanHaveChildren: true,
      cursorY: 25,
      rowHeight: ROW_HEIGHT,
      cursorX: 60,
      treeLeftEdge: 0,
    });
    expect(result.position).toBe("after");
  });

  it("should return 'inside' when cursor is in middle 50% of a container node", () => {
    const result = computeDropTarget({
      targetUuid: "frame-1",
      targetDepth: 1,
      targetCanHaveChildren: true,
      cursorY: 14,
      rowHeight: ROW_HEIGHT,
      cursorX: 60,
      treeLeftEdge: 0,
    });
    expect(result.position).toBe("inside");
    expect(result.depth).toBe(2); // inside = target depth + 1
  });

  it("should return 'before' or 'after' instead of 'inside' for non-container nodes", () => {
    const result = computeDropTarget({
      targetUuid: "rect-1",
      targetDepth: 2,
      targetCanHaveChildren: false,
      cursorY: 14,
      rowHeight: ROW_HEIGHT,
      cursorX: 60,
      treeLeftEdge: 0,
    });
    // Middle zone on non-container falls back to nearest edge
    expect(result.position).not.toBe("inside");
  });

  it("should calculate depth from horizontal cursor position", () => {
    // Cursor at 60px from tree left, INDENT_WIDTH=20 -> depth 3
    const result = computeDropTarget({
      targetUuid: "node-1",
      targetDepth: 3,
      targetCanHaveChildren: false,
      cursorY: 3,
      rowHeight: ROW_HEIGHT,
      cursorX: 60,
      treeLeftEdge: 0,
    });
    expect(result.depth).toBe(3);
  });

  it("should clamp depth to max valid depth for 'before' position", () => {
    // Target is at depth 2, cursor indicates depth 5 -> clamped to 2
    const result = computeDropTarget({
      targetUuid: "node-1",
      targetDepth: 2,
      targetCanHaveChildren: false,
      cursorY: 3,
      rowHeight: ROW_HEIGHT,
      cursorX: 200,
      treeLeftEdge: 0,
    });
    expect(result.depth).toBeLessThanOrEqual(2);
  });

  it("should allow depth up to targetDepth + 1 for 'after' position", () => {
    const result = computeDropTarget({
      targetUuid: "node-1",
      targetDepth: 2,
      targetCanHaveChildren: false,
      cursorY: 25,
      rowHeight: ROW_HEIGHT,
      cursorX: 200,
      treeLeftEdge: 0,
    });
    expect(result.depth).toBeLessThanOrEqual(3);
  });

  it("should clamp depth minimum to 0", () => {
    const result = computeDropTarget({
      targetUuid: "node-1",
      targetDepth: 1,
      targetCanHaveChildren: false,
      cursorY: 3,
      rowHeight: ROW_HEIGHT,
      cursorX: -10,
      treeLeftEdge: 0,
    });
    expect(result.depth).toBeGreaterThanOrEqual(0);
  });

  it("should account for treeLeftEdge offset in depth calculation", () => {
    // Tree starts at x=100, cursor at x=160 -> effective offset 60px -> depth 3
    const result = computeDropTarget({
      targetUuid: "node-1",
      targetDepth: 3,
      targetCanHaveChildren: false,
      cursorY: 3,
      rowHeight: ROW_HEIGHT,
      cursorX: 160,
      treeLeftEdge: 100,
    });
    expect(result.depth).toBe(3);
  });

  it("should snap to 'before' when non-container is in upper half of middle zone", () => {
    // cursorY = 10, relativeY = 10/28 ~= 0.357, in middle zone, < 0.5
    const result = computeDropTarget({
      targetUuid: "rect-1",
      targetDepth: 1,
      targetCanHaveChildren: false,
      cursorY: 10,
      rowHeight: ROW_HEIGHT,
      cursorX: 20,
      treeLeftEdge: 0,
    });
    expect(result.position).toBe("before");
  });

  it("should snap to 'after' when non-container is in lower half of middle zone", () => {
    // cursorY = 16, relativeY = 16/28 ~= 0.571, in middle zone, >= 0.5
    const result = computeDropTarget({
      targetUuid: "rect-1",
      targetDepth: 1,
      targetCanHaveChildren: false,
      cursorY: 16,
      rowHeight: ROW_HEIGHT,
      cursorX: 20,
      treeLeftEdge: 0,
    });
    expect(result.position).toBe("after");
  });
});

describe("canDropInside", () => {
  it("should return true for frame nodes", () => {
    expect(canDropInside("frame")).toBe(true);
  });

  it("should return true for group nodes", () => {
    expect(canDropInside("group")).toBe(true);
  });

  it("should return false for rectangle nodes", () => {
    expect(canDropInside("rectangle")).toBe(false);
  });

  it("should return false for text nodes", () => {
    expect(canDropInside("text")).toBe(false);
  });

  it("should return false for ellipse nodes", () => {
    expect(canDropInside("ellipse")).toBe(false);
  });
});
