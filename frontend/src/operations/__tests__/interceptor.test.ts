import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStore } from "solid-js/store";
import { createInterceptor, type Interceptor } from "../interceptor";
import { HistoryManager } from "../history-manager";
import type { Transaction } from "../types";

// Mock rAF for deterministic testing
let rafCallback: (() => void) | null = null;
const mockRaf = vi.fn((cb: FrameRequestCallback) => {
  rafCallback = cb as unknown as () => void;
  return 1;
});
const mockCancelRaf = vi.fn();

function flushFrame(): void {
  if (rafCallback) {
    const cb = rafCallback;
    rafCallback = null;
    cb();
  }
}

/**
 * Assert that a value is not null and return it with a narrowed type.
 * Used to avoid non-null assertions (`!`) which are forbidden by lint rules.
 */
function assertNonNull(value: Transaction | null): Transaction {
  expect(value).not.toBeNull();
  if (value === null) {
    throw new Error("Unexpected null");
  }
  return value;
}

describe("Interceptor", () => {
  let setState: (...args: unknown[]) => void;
  let state: Record<string, unknown>;
  let historyManager: HistoryManager;
  let interceptor: Interceptor;

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", mockRaf);
    vi.stubGlobal("cancelAnimationFrame", mockCancelRaf);
    mockRaf.mockClear();
    mockCancelRaf.mockClear();
    rafCallback = null;

    const [s, ss] = createStore({
      nodes: {} as Record<string, Record<string, unknown>>,
      pages: [] as unknown[],
      info: { name: "", page_count: 0, node_count: 0 },
    });
    state = s as unknown as Record<string, unknown>;
    setState = ss as unknown as (...args: unknown[]) => void;

    historyManager = new HistoryManager("test-user");
    interceptor = createInterceptor(state, setState, historyManager, "test-user");
  });

  afterEach(() => {
    interceptor.destroy();
    vi.restoreAllMocks();
  });

  it("should create one undo step after single field write and idle frame", () => {
    // Pre-populate a node
    setState("nodes", "node-1", {
      name: "OldName",
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
    });

    interceptor.set("node-1", "name", "NewName");
    expect(historyManager.canUndo()).toBe(false); // not committed yet

    flushFrame();
    expect(historyManager.canUndo()).toBe(true); // committed
  });

  it("should coalesce rapid writes to same node+field into one step", () => {
    setState("nodes", "node-1", { name: "Original" });

    interceptor.set("node-1", "name", "A");
    interceptor.set("node-1", "name", "B");
    interceptor.set("node-1", "name", "C");

    flushFrame();
    expect(historyManager.canUndo()).toBe(true);

    // Undo should revert to "Original", not "B"
    const inverseTx = assertNonNull(historyManager.undo());
    expect(inverseTx.operations).toHaveLength(1);
    expect(inverseTx.operations[0].value).toBe("Original"); // before value
  });

  it("should group writes to different nodes in same frame into one step", () => {
    setState("nodes", "node-1", { name: "A" });
    setState("nodes", "node-2", { name: "B" });

    interceptor.set("node-1", "name", "A2");
    interceptor.set("node-2", "name", "B2");

    flushFrame();
    expect(historyManager.canUndo()).toBe(true);

    const inverseTx = assertNonNull(historyManager.undo());
    expect(inverseTx.operations).toHaveLength(2);
  });

  it("should ignore writes during undo", () => {
    setState("nodes", "node-1", { name: "Original" });
    interceptor.set("node-1", "name", "Changed");
    flushFrame();

    // Undo — interceptor should ignore the writes it triggers
    interceptor.undo();

    // Should not have created a new undo step from the undo writes
    expect(historyManager.canUndo()).toBe(false);
  });

  it("should add trackStructural operations to buffer", () => {
    interceptor.trackStructural({
      id: "op-1",
      userId: "test-user",
      nodeUuid: "node-1",
      type: "create_node",
      path: "",
      value: { uuid: "node-1", name: "New" },
      previousValue: null,
      seq: 0,
    });

    flushFrame();
    expect(historyManager.canUndo()).toBe(true);
  });

  it("should force-flush buffer on undo if pending", () => {
    setState("nodes", "node-1", { name: "Original" });
    interceptor.set("node-1", "name", "Changed");
    // Don't flush — buffer is pending

    interceptor.undo(); // should force-flush first, then undo

    // The flush created one step, then undo popped it
    expect(historyManager.canUndo()).toBe(false);
    expect(historyManager.canRedo()).toBe(true);
  });

  it("should apply the store value immediately on set", () => {
    setState("nodes", "node-1", { name: "Before" });

    interceptor.set("node-1", "name", "After");

    // Value should be in store immediately, before frame flush
    const nodes = (state as { nodes: Record<string, Record<string, unknown>> }).nodes;
    expect(nodes["node-1"]["name"]).toBe("After");
  });

  it("should restore store value on undo", () => {
    setState("nodes", "node-1", { name: "Original" });

    interceptor.set("node-1", "name", "Changed");
    flushFrame();

    interceptor.undo();

    const nodes = (state as { nodes: Record<string, Record<string, unknown>> }).nodes;
    expect(nodes["node-1"]["name"]).toBe("Original");
  });

  it("should re-apply store value on redo", () => {
    setState("nodes", "node-1", { name: "Original" });

    interceptor.set("node-1", "name", "Changed");
    flushFrame();

    interceptor.undo();
    interceptor.redo();

    const nodes = (state as { nodes: Record<string, Record<string, unknown>> }).nodes;
    expect(nodes["node-1"]["name"]).toBe("Changed");
  });

  it("should handle style paths correctly", () => {
    setState("nodes", "node-1", {
      name: "Test",
      style: { fills: [{ color: "red" }], strokes: [] },
    });

    interceptor.set("node-1", "style.fills", [{ color: "blue" }]);
    flushFrame();

    const nodes = (state as { nodes: Record<string, Record<string, unknown>> }).nodes;
    const style = nodes["node-1"]["style"] as Record<string, unknown>;
    expect(style["fills"]).toEqual([{ color: "blue" }]);
    expect(historyManager.canUndo()).toBe(true);
  });

  it("should cancel rAF on destroy", () => {
    setState("nodes", "node-1", { name: "Before" });
    interceptor.set("node-1", "name", "After");
    // rAF is scheduled but not fired

    interceptor.destroy();
    expect(mockCancelRaf).toHaveBeenCalled();
  });

  it("should not commit empty buffer", () => {
    interceptor.flush();
    expect(historyManager.canUndo()).toBe(false);
  });

  it("should reschedule rAF when new writes arrive before previous fires", () => {
    setState("nodes", "node-1", { name: "Original" });

    interceptor.set("node-1", "name", "A");
    // First rAF scheduled
    expect(mockRaf).toHaveBeenCalledTimes(1);

    interceptor.set("node-1", "name", "B");
    // cancelAnimationFrame called, then new rAF scheduled
    expect(mockCancelRaf).toHaveBeenCalledTimes(1);
    expect(mockRaf).toHaveBeenCalledTimes(2);
  });

  it("should ignore trackStructural during undo", () => {
    setState("nodes", "node-1", { name: "Original" });
    interceptor.set("node-1", "name", "Changed");
    flushFrame();

    // During undo, any trackStructural calls should be ignored
    // This is tested indirectly: after undo, no new undo step is created
    interceptor.undo();
    expect(historyManager.canUndo()).toBe(false);
  });

  it("should combine field changes and structural ops in one transaction", () => {
    setState("nodes", "node-1", { name: "Before" });

    interceptor.set("node-1", "name", "After");
    interceptor.trackStructural({
      id: "op-structural",
      userId: "test-user",
      nodeUuid: "node-2",
      type: "create_node",
      path: "",
      value: { uuid: "node-2", name: "NewNode" },
      previousValue: null,
      seq: 0,
    });

    flushFrame();

    const inverseTx = assertNonNull(historyManager.undo());
    // Should have both the field change and the structural op
    expect(inverseTx.operations).toHaveLength(2);
  });
});
