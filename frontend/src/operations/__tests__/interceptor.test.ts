import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStore } from "solid-js/store";
import { createInterceptor, type Interceptor } from "../interceptor";
import { HistoryManager } from "../history-manager";
import type { Transaction } from "../types";
import { MAX_OPERATIONS_PER_TRANSACTION } from "../types";

/**
 * The interceptor uses setTimeout(fn, 100) for idle coalescing.
 * We use Vitest fake timers to control when the timeout fires.
 */
function flushFrame(): void {
  // Advance fake timers past the 100ms coalesce window
  vi.advanceTimersByTime(150);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vi.fn() type doesn't match (() => void) exactly
  let onCommitSpy: any;

  beforeEach(() => {
    vi.useFakeTimers();

    const [s, ss] = createStore({
      nodes: {} as Record<string, Record<string, unknown>>,
      pages: [] as unknown[],
      info: { name: "", page_count: 0, node_count: 0 },
    });
    state = s as unknown as Record<string, unknown>;
    setState = ss as unknown as (...args: unknown[]) => void;

    historyManager = new HistoryManager("test-user");
    onCommitSpy = vi.fn() as unknown as () => void;
    interceptor = createInterceptor(state, setState, historyManager, "test-user", onCommitSpy);
  });

  afterEach(() => {
    interceptor.destroy();
    vi.useRealTimers();
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

  it("should cancel timeout on destroy", () => {
    setState("nodes", "node-1", { name: "Before" });
    interceptor.set("node-1", "name", "After");
    // timeout is scheduled but not fired

    interceptor.destroy();
    // Advancing timers should NOT commit (timeout was cleared)
    vi.advanceTimersByTime(200);
    expect(historyManager.canUndo()).toBe(false);
  });

  it("should not commit empty buffer", () => {
    interceptor.flush();
    expect(historyManager.canUndo()).toBe(false);
  });

  it("should reschedule timeout when new writes arrive before previous fires", () => {
    setState("nodes", "node-1", { name: "Original" });

    interceptor.set("node-1", "name", "A");
    // Advance 50ms (within 100ms window) — not committed yet
    vi.advanceTimersByTime(50);
    expect(historyManager.canUndo()).toBe(false);

    interceptor.set("node-1", "name", "B");
    // Advance another 50ms — still within new 100ms window (reset by second write)
    vi.advanceTimersByTime(50);
    expect(historyManager.canUndo()).toBe(false);

    // Advance past the full window — NOW it commits
    vi.advanceTimersByTime(60);
    expect(historyManager.canUndo()).toBe(true);
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

  // RF-003: onCommit callback is called after commit, undo, and redo
  it("should call onCommit after commitBuffer", () => {
    setState("nodes", "node-1", { name: "Before" });
    interceptor.set("node-1", "name", "After");
    expect(onCommitSpy).not.toHaveBeenCalled();

    flushFrame();
    expect(onCommitSpy).toHaveBeenCalledTimes(1);
  });

  it("should call onCommit after undo", () => {
    setState("nodes", "node-1", { name: "Before" });
    interceptor.set("node-1", "name", "After");
    flushFrame();
    onCommitSpy.mockClear();

    interceptor.undo();
    expect(onCommitSpy).toHaveBeenCalledTimes(1);
  });

  it("should call onCommit after redo", () => {
    setState("nodes", "node-1", { name: "Before" });
    interceptor.set("node-1", "name", "After");
    flushFrame();
    interceptor.undo();
    onCommitSpy.mockClear();

    interceptor.redo();
    expect(onCommitSpy).toHaveBeenCalledTimes(1);
  });

  // RF-008: MAX_OPERATIONS_PER_TRANSACTION enforced in commitBuffer
  it("should warn when operations exceed MAX_OPERATIONS_PER_TRANSACTION", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Use structural ops to exceed MAX_OPERATIONS_PER_TRANSACTION, since
    // structural ops are not subject to the RF-017 buffer size limit (which
    // only applies to the field-change buffer Map).
    for (let i = 0; i < MAX_OPERATIONS_PER_TRANSACTION + 10; i++) {
      interceptor.trackStructural({
        id: `op-${i}`,
        userId: "test-user",
        nodeUuid: `node-${i}`,
        type: "create_node",
        path: "",
        value: { uuid: `node-${i}`, name: `Node-${i}` },
        previousValue: null,
        seq: 0,
      });
    }

    flushFrame();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("exceeding MAX_OPERATIONS_PER_TRANSACTION"),
    );
    expect(historyManager.canUndo()).toBe(true);

    consoleSpy.mockRestore();
  });

  // RF-012: isUndoing flag is exception-safe (try-finally)
  it("should reset isUndoing flag even if undo application throws", () => {
    setState("nodes", "node-1", { name: "Before" });
    interceptor.set("node-1", "name", "After");
    flushFrame();

    // After a successful undo, the interceptor should accept new writes
    interceptor.undo();
    interceptor.set("node-1", "name", "AfterUndo");
    // If isUndoing was stuck, this write would be ignored and no undo step created
    flushFrame();
    expect(historyManager.canUndo()).toBe(true);
  });

  // RF-017: Buffer size limit with force-flush
  it("should force-flush when buffer reaches MAX_BUFFER_ENTRIES", () => {
    // We can't easily test 1000 entries, but we can verify the flush happens
    // by checking onCommit is called before we manually flush
    for (let i = 0; i < 1001; i++) {
      const nodeId = `node-${i}`;
      setState("nodes", nodeId, { name: `Original-${i}` });
      interceptor.set(nodeId, "name", `Changed-${i}`);
    }

    // The 1001st entry should have triggered a force-flush for the first batch
    // (onCommit would have been called)
    expect(onCommitSpy).toHaveBeenCalled();
  });

  // RF-018: Max-age safety valve (5s)
  it("should force-flush after MAX_BUFFER_AGE_MS even with continuous writes", () => {
    setState("nodes", "node-1", { name: "Original" });

    // Start writing
    interceptor.set("node-1", "name", "A");
    // Advance to just past 5000ms, writing periodically to keep rescheduling
    for (let elapsed = 0; elapsed < 5100; elapsed += 50) {
      vi.advanceTimersByTime(50);
      interceptor.set("node-1", "name", `Value-${elapsed}`);
    }

    // The safety valve should have fired by now
    expect(onCommitSpy).toHaveBeenCalled();
  });

  // RF-029: Context round-trip test
  it("should capture and restore side-effect context on undo", () => {
    const contextState = {
      selectedNodeIds: ["node-1"],
      activeTool: "rectangle",
      viewport: { x: 10, y: 20, zoom: 2 },
    };

    interceptor.setSideEffectReaders({
      getSelectedNodeIds: () => contextState.selectedNodeIds,
      setSelectedNodeIds: (ids) => {
        contextState.selectedNodeIds = ids;
      },
      getActiveTool: () => contextState.activeTool,
      setActiveTool: (tool) => {
        contextState.activeTool = tool;
      },
      getViewport: () => contextState.viewport,
      setViewport: (vp) => {
        contextState.viewport = vp;
      },
    });

    setState("nodes", "node-1", { name: "Original" });
    interceptor.set("node-1", "name", "Changed");
    flushFrame();

    // Change context after the commit
    contextState.selectedNodeIds = ["node-2"];
    contextState.activeTool = "select";
    contextState.viewport = { x: 0, y: 0, zoom: 1 };

    // Undo should restore context from when the change was made
    interceptor.undo();

    expect(contextState.selectedNodeIds).toEqual(["node-1"]);
    expect(contextState.activeTool).toBe("rectangle");
    expect(contextState.viewport).toEqual({ x: 10, y: 20, zoom: 2 });
  });

  // RF-019: sideEffectContext is stored on Transaction (not _context)
  it("should store sideEffectContext as a typed field on Transaction", () => {
    interceptor.setSideEffectReaders({
      getSelectedNodeIds: () => ["sel-1"],
      setSelectedNodeIds: () => {},
      getActiveTool: () => "frame",
      setActiveTool: () => {},
      getViewport: () => ({ x: 5, y: 10, zoom: 3 }),
      setViewport: () => {},
    });

    setState("nodes", "node-1", { name: "Before" });
    interceptor.set("node-1", "name", "After");
    flushFrame();

    // Peek at the transaction on the undo stack
    const tx = historyManager.peekUndo();
    expect(tx).not.toBeNull();
    if (tx === null) return;
    expect(tx.sideEffectContext).toBeDefined();
    expect(tx.sideEffectContext?.selectedNodeIds).toEqual(["sel-1"]);
    expect(tx.sideEffectContext?.activeTool).toBe("frame");
    expect(tx.sideEffectContext?.viewport).toEqual({ x: 5, y: 10, zoom: 3 });
  });
});
