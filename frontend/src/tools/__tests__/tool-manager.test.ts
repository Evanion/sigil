import { describe, it, expect, vi } from "vitest";
import {
  createToolManager,
  type Tool,
  type ToolEvent,
  type ToolType,
} from "../tool-manager";

/** Helper to create a minimal ToolEvent. */
function makeEvent(overrides?: Partial<ToolEvent>): ToolEvent {
  return {
    worldX: 0,
    worldY: 0,
    screenX: 0,
    screenY: 0,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

/** Helper to create a mock Tool that records calls. */
function makeMockTool(cursor: string = "default"): Tool & {
  pointerDownCalls: ToolEvent[];
  pointerMoveCalls: ToolEvent[];
  pointerUpCalls: ToolEvent[];
} {
  const pointerDownCalls: ToolEvent[] = [];
  const pointerMoveCalls: ToolEvent[] = [];
  const pointerUpCalls: ToolEvent[] = [];

  return {
    pointerDownCalls,
    pointerMoveCalls,
    pointerUpCalls,
    onPointerDown(event: ToolEvent): void {
      pointerDownCalls.push(event);
    },
    onPointerMove(event: ToolEvent): void {
      pointerMoveCalls.push(event);
    },
    onPointerUp(event: ToolEvent): void {
      pointerUpCalls.push(event);
    },
    getCursor(): string {
      return cursor;
    },
  };
}

describe("createToolManager", () => {
  it("should default to select tool", () => {
    const manager = createToolManager();
    expect(manager.getActiveTool()).toBe("select");
  });

  it("should accept a custom initial tool", () => {
    const manager = createToolManager(undefined, "rectangle");
    expect(manager.getActiveTool()).toBe("rectangle");
  });
});

describe("ToolManager.setActiveTool", () => {
  it("should switch the active tool", () => {
    const manager = createToolManager();
    manager.setActiveTool("frame");
    expect(manager.getActiveTool()).toBe("frame");
  });

  it("should switch to all supported tool types", () => {
    const manager = createToolManager();
    const types: ToolType[] = ["select", "frame", "rectangle", "ellipse"];
    for (const toolType of types) {
      manager.setActiveTool(toolType);
      expect(manager.getActiveTool()).toBe(toolType);
    }
  });

  it("should notify subscribers when tool changes", () => {
    const manager = createToolManager();
    const listener = vi.fn();
    manager.subscribe(listener);

    manager.setActiveTool("rectangle");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("should not notify subscribers when setting same tool", () => {
    const manager = createToolManager();
    const listener = vi.fn();
    manager.subscribe(listener);

    manager.setActiveTool("select");
    expect(listener).not.toHaveBeenCalled();
  });

  it("should notify multiple subscribers", () => {
    const manager = createToolManager();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    manager.subscribe(listener1);
    manager.subscribe(listener2);

    manager.setActiveTool("ellipse");
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });
});

describe("ToolManager.subscribe", () => {
  it("should return an unsubscribe function", () => {
    const manager = createToolManager();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);

    unsubscribe();
    manager.setActiveTool("frame");
    expect(listener).not.toHaveBeenCalled();
  });

  it("should only remove the specific subscriber on unsubscribe", () => {
    const manager = createToolManager();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = manager.subscribe(listener1);
    manager.subscribe(listener2);

    unsub1();
    manager.setActiveTool("frame");
    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).toHaveBeenCalledTimes(1);
  });
});

describe("ToolManager event delegation", () => {
  it("should delegate onPointerDown to the active tool implementation", () => {
    const selectTool = makeMockTool("default");
    const implementations = new Map<ToolType, Tool>([["select", selectTool]]);
    const manager = createToolManager(implementations);

    const event = makeEvent({ worldX: 10, worldY: 20 });
    manager.onPointerDown(event);

    expect(selectTool.pointerDownCalls).toHaveLength(1);
    expect(selectTool.pointerDownCalls[0]).toBe(event);
  });

  it("should delegate onPointerMove to the active tool implementation", () => {
    const selectTool = makeMockTool();
    const implementations = new Map<ToolType, Tool>([["select", selectTool]]);
    const manager = createToolManager(implementations);

    const event = makeEvent({ worldX: 30, worldY: 40 });
    manager.onPointerMove(event);

    expect(selectTool.pointerMoveCalls).toHaveLength(1);
    expect(selectTool.pointerMoveCalls[0]).toBe(event);
  });

  it("should delegate onPointerUp to the active tool implementation", () => {
    const selectTool = makeMockTool();
    const implementations = new Map<ToolType, Tool>([["select", selectTool]]);
    const manager = createToolManager(implementations);

    const event = makeEvent({ worldX: 50, worldY: 60 });
    manager.onPointerUp(event);

    expect(selectTool.pointerUpCalls).toHaveLength(1);
    expect(selectTool.pointerUpCalls[0]).toBe(event);
  });

  it("should delegate events to the correct tool after switching", () => {
    const selectTool = makeMockTool("default");
    const rectTool = makeMockTool("crosshair");
    const implementations = new Map<ToolType, Tool>([
      ["select", selectTool],
      ["rectangle", rectTool],
    ]);
    const manager = createToolManager(implementations);

    const event1 = makeEvent({ worldX: 1, worldY: 1 });
    manager.onPointerDown(event1);
    expect(selectTool.pointerDownCalls).toHaveLength(1);
    expect(rectTool.pointerDownCalls).toHaveLength(0);

    manager.setActiveTool("rectangle");

    const event2 = makeEvent({ worldX: 2, worldY: 2 });
    manager.onPointerDown(event2);
    expect(selectTool.pointerDownCalls).toHaveLength(1);
    expect(rectTool.pointerDownCalls).toHaveLength(1);
    expect(rectTool.pointerDownCalls[0]).toBe(event2);
  });

  it("should not throw when no tool implementation is registered", () => {
    const manager = createToolManager();
    const event = makeEvent();

    expect(() => manager.onPointerDown(event)).not.toThrow();
    expect(() => manager.onPointerMove(event)).not.toThrow();
    expect(() => manager.onPointerUp(event)).not.toThrow();
  });
});

describe("ToolManager.getCursor", () => {
  it("should return the cursor from the active tool implementation", () => {
    const selectTool = makeMockTool("default");
    const rectTool = makeMockTool("crosshair");
    const implementations = new Map<ToolType, Tool>([
      ["select", selectTool],
      ["rectangle", rectTool],
    ]);
    const manager = createToolManager(implementations);

    expect(manager.getCursor()).toBe("default");

    manager.setActiveTool("rectangle");
    expect(manager.getCursor()).toBe("crosshair");
  });

  it("should return 'default' when no tool implementation is registered", () => {
    const manager = createToolManager();
    expect(manager.getCursor()).toBe("default");
  });

  it("should return 'default' for tool types without implementations", () => {
    const selectTool = makeMockTool("move");
    const implementations = new Map<ToolType, Tool>([["select", selectTool]]);
    const manager = createToolManager(implementations);

    manager.setActiveTool("ellipse");
    expect(manager.getCursor()).toBe("default");
  });
});
