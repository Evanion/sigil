/**
 * Tests for applyOperationToStore — the function that applies a single
 * Operation to the Solid store's setState.
 *
 * Uses a plain object + setter mock to avoid Solid runtime dependency in unit tests.
 */
import { describe, it, expect, vi } from "vitest";
import {
  applyOperationToStore,
  type StoreStateSetter,
  type StoreStateReader,
} from "../apply-to-store";
import type { Operation } from "../types";

function makeOp(overrides: Partial<Operation>): Operation {
  return {
    id: crypto.randomUUID(),
    userId: "user-1",
    nodeUuid: "node-1",
    type: "set_field",
    path: "transform",
    value: null,
    previousValue: null,
    seq: 0,
    ...overrides,
  };
}

describe("applyOperationToStore — set_field", () => {
  it("applies a transform set_field operation", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = {
      getNode: () => ({
        uuid: "node-1",
        transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
        style: {
          fills: [],
          strokes: [],
          opacity: { type: "literal", value: 1 },
          blend_mode: "normal",
          effects: [],
        },
        kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
        name: "Rect",
        visible: true,
        locked: false,
      }),
    };
    const newTransform = {
      x: 50,
      y: 50,
      width: 200,
      height: 200,
      rotation: 0,
      scale_x: 1,
      scale_y: 1,
    };
    const op = makeOp({
      type: "set_field",
      path: "transform",
      nodeUuid: "node-1",
      value: newTransform,
    });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalledWith("nodes", "node-1", "transform", newTransform);
  });

  it("applies a name set_field operation", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = {
      getNode: () => ({ uuid: "node-1", name: "Old Name" }),
    };
    const op = makeOp({ type: "set_field", path: "name", value: "New Name" });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalledWith("nodes", "node-1", "name", "New Name");
  });

  it("applies a visible set_field operation", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = { getNode: () => ({ uuid: "node-1", visible: true }) };
    const op = makeOp({ path: "visible", value: false });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalledWith("nodes", "node-1", "visible", false);
  });

  it("applies a locked set_field operation", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = { getNode: () => ({ uuid: "node-1", locked: false }) };
    const op = makeOp({ path: "locked", value: true });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalledWith("nodes", "node-1", "locked", true);
  });

  it("applies style.opacity set_field operation via nested setState", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = {
      getNode: () => ({
        uuid: "node-1",
        style: {
          opacity: { type: "literal", value: 1 },
          fills: [],
          strokes: [],
          blend_mode: "normal",
          effects: [],
        },
      }),
    };
    const op = makeOp({ path: "style.opacity", value: { type: "literal", value: 0.5 } });

    applyOperationToStore(op, setter, reader);

    // Nested style fields use the four-arg setState path form
    expect(setter).toHaveBeenCalled();
  });

  it("applies style.fills set_field operation", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = { getNode: () => ({ uuid: "node-1", style: { fills: [] } }) };
    const newFills = [
      {
        type: "solid",
        color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } },
      },
    ];
    const op = makeOp({ path: "style.fills", value: newFills });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalled();
  });

  it("applies style.strokes set_field operation", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = {
      getNode: () => ({ uuid: "node-1", style: { strokes: [] } }),
    };
    const op = makeOp({ path: "style.strokes", value: [] });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalled();
  });

  it("applies style.effects set_field operation", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = {
      getNode: () => ({ uuid: "node-1", style: { effects: [] } }),
    };
    const op = makeOp({ path: "style.effects", value: [] });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalled();
  });

  it("applies style.blend_mode set_field operation", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = {
      getNode: () => ({ uuid: "node-1", style: { blend_mode: "normal" } }),
    };
    const op = makeOp({ path: "style.blend_mode", value: "multiply" });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalled();
  });

  it("applies kind set_field operation (corner radii)", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = {
      getNode: () => ({
        uuid: "node-1",
        kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
      }),
    };
    const op = makeOp({
      path: "kind",
      value: { type: "rectangle", corner_radii: [8, 8, 8, 8] },
    });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalled();
  });

  it("warns and falls back for unknown field paths", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = { getNode: () => ({ uuid: "node-1" }) };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const op = makeOp({ path: "unknown.field", value: "something" });

    applyOperationToStore(op, setter, reader);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown path "unknown.field"'),
    );
    warnSpy.mockRestore();
  });

  it("skips set_field when node is not found in store", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = { getNode: () => undefined };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const op = makeOp({ path: "name", value: "New Name", nodeUuid: "missing-node" });

    applyOperationToStore(op, setter, reader);

    expect(setter).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("applyOperationToStore — create_node", () => {
  it("inserts a new node into the store", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = { getNode: () => undefined };
    const nodeData = {
      uuid: "new-uuid",
      name: "Rect 1",
      kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
      style: {
        fills: [],
        strokes: [],
        opacity: { type: "literal", value: 1 },
        blend_mode: "normal",
        effects: [],
      },
      visible: true,
      locked: false,
    };
    const op = makeOp({
      type: "create_node",
      nodeUuid: "",
      path: "",
      value: nodeData,
      previousValue: null,
    });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalledWith(
      "nodes",
      "new-uuid",
      expect.objectContaining({ uuid: "new-uuid" }),
    );
  });

  it("skips create_node when node data has no uuid", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = { getNode: () => undefined };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const op = makeOp({
      type: "create_node",
      nodeUuid: "",
      path: "",
      value: { name: "No UUID" },
      previousValue: null,
    });

    applyOperationToStore(op, setter, reader);

    expect(setter).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("wires up parent childrenUuids when parentUuid is present in node data", () => {
    const calls: unknown[][] = [];
    const setter = ((...args: unknown[]) => {
      calls.push(args);
    }) as unknown as StoreStateSetter;
    const nodes: Record<string, unknown> = {
      "parent-uuid": {
        uuid: "parent-uuid",
        childrenUuids: [],
      },
    };
    const reader: StoreStateReader = { getNode: (uuid) => nodes[uuid] as never };

    const nodeData = {
      uuid: "child-uuid",
      name: "Child",
      parentUuid: "parent-uuid",
      kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
      style: {
        fills: [],
        strokes: [],
        opacity: { type: "literal", value: 1 },
        blend_mode: "normal",
        effects: [],
      },
      visible: true,
      locked: false,
    };
    const op = makeOp({
      type: "create_node",
      nodeUuid: "",
      path: "",
      value: nodeData,
      previousValue: null,
    });

    applyOperationToStore(op, setter, reader);

    // First call: insert the node
    expect(calls[0]).toEqual([
      "nodes",
      "child-uuid",
      expect.objectContaining({ uuid: "child-uuid", parentUuid: "parent-uuid" }),
    ]);
    // Second call: update parent's childrenUuids
    expect(calls[1]).toEqual(["nodes", "parent-uuid", "childrenUuids", ["child-uuid"]]);
  });
});

describe("applyOperationToStore — delete_node", () => {
  it("removes a node from the store and cleans up parent's childrenUuids", () => {
    const calls: unknown[][] = [];
    const setter = ((...args: unknown[]) => {
      calls.push(args);
    }) as unknown as StoreStateSetter;
    const nodes: Record<string, unknown> = {
      "node-1": { uuid: "node-1", parentUuid: "parent-a", name: "Rect" },
      "parent-a": { uuid: "parent-a", childrenUuids: ["node-1", "node-2"] },
    };
    const reader: StoreStateReader = { getNode: (uuid) => nodes[uuid] as never };
    const op = makeOp({
      type: "delete_node",
      nodeUuid: "node-1",
      path: "",
      value: null,
      previousValue: { uuid: "node-1" },
    });

    applyOperationToStore(op, setter, reader);

    // Should remove node-1 from parent's childrenUuids
    expect(calls).toContainEqual(["nodes", "parent-a", "childrenUuids", ["node-2"]]);
    // Should call setter at least twice (parent update + node deletion via produce)
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("removes a node with no parent from the store", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = {
      getNode: () => ({ uuid: "node-1", parentUuid: null, name: "Root" }),
    };
    const op = makeOp({
      type: "delete_node",
      nodeUuid: "node-1",
      path: "",
      value: null,
      previousValue: { uuid: "node-1" },
    });

    applyOperationToStore(op, setter, reader);

    // setter is called at least once (the produce delete)
    expect(setter).toHaveBeenCalled();
  });
});

describe("applyOperationToStore — reparent", () => {
  it("updates parentUuid and childrenUuids for reparent operations", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const nodes: Record<string, unknown> = {
      "node-1": { uuid: "node-1", parentUuid: "parent-a", childrenUuids: [] },
      "parent-a": { uuid: "parent-a", childrenUuids: ["node-1"] },
      "parent-b": { uuid: "parent-b", childrenUuids: [] },
    };
    const reader: StoreStateReader = { getNode: (uuid: string) => nodes[uuid] as never };
    const op = makeOp({
      type: "reparent",
      nodeUuid: "node-1",
      path: "",
      value: { parentUuid: "parent-b", position: 0 },
      previousValue: { parentUuid: "parent-a", position: 0 },
    });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalled();
  });

  it("removes node from old parent and inserts into new parent at specified position", () => {
    const calls: unknown[][] = [];
    const setter = ((...args: unknown[]) => {
      calls.push(args);
    }) as unknown as StoreStateSetter;
    const nodes: Record<string, unknown> = {
      "node-1": { uuid: "node-1", parentUuid: "parent-a" },
      "parent-a": { uuid: "parent-a", childrenUuids: ["node-1", "node-2"] },
      "parent-b": { uuid: "parent-b", childrenUuids: ["node-3", "node-4"] },
    };
    const reader: StoreStateReader = { getNode: (uuid: string) => nodes[uuid] as never };
    const op = makeOp({
      type: "reparent",
      nodeUuid: "node-1",
      path: "",
      value: { parentUuid: "parent-b", position: 1 },
      previousValue: { parentUuid: "parent-a", position: 0 },
    });

    applyOperationToStore(op, setter, reader);

    // Old parent should have node-1 removed
    expect(calls).toContainEqual(["nodes", "parent-a", "childrenUuids", ["node-2"]]);
    // New parent should have node-1 inserted at position 1
    expect(calls).toContainEqual(["nodes", "parent-b", "childrenUuids", ["node-3", "node-1", "node-4"]]);
    // Node should have updated parentUuid
    expect(calls).toContainEqual(["nodes", "node-1", "parentUuid", "parent-b"]);
  });

  it("warns when node is not found during reparent", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = { getNode: () => undefined };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const op = makeOp({
      type: "reparent",
      nodeUuid: "missing",
      path: "",
      value: { parentUuid: "parent-b", position: 0 },
      previousValue: null,
    });

    applyOperationToStore(op, setter, reader);

    expect(setter).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("applyOperationToStore — reorder", () => {
  it("reorders a node within its parent childrenUuids", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const nodes: Record<string, unknown> = {
      "node-1": { uuid: "node-1", parentUuid: "parent-a" },
      "parent-a": { uuid: "parent-a", childrenUuids: ["node-1", "node-2", "node-3"] },
    };
    const reader: StoreStateReader = { getNode: (uuid: string) => nodes[uuid] as never };
    const op = makeOp({
      type: "reorder",
      nodeUuid: "node-1",
      path: "",
      value: { newPosition: 2 },
      previousValue: { oldPosition: 0 },
    });

    applyOperationToStore(op, setter, reader);

    expect(setter).toHaveBeenCalled();
  });

  it("moves a node from position 0 to position 2 correctly", () => {
    const calls: unknown[][] = [];
    const setter = ((...args: unknown[]) => {
      calls.push(args);
    }) as unknown as StoreStateSetter;
    const nodes: Record<string, unknown> = {
      "node-1": { uuid: "node-1", parentUuid: "parent-a" },
      "parent-a": { uuid: "parent-a", childrenUuids: ["node-1", "node-2", "node-3"] },
    };
    const reader: StoreStateReader = { getNode: (uuid: string) => nodes[uuid] as never };
    const op = makeOp({
      type: "reorder",
      nodeUuid: "node-1",
      path: "",
      value: { newPosition: 2 },
      previousValue: { oldPosition: 0 },
    });

    applyOperationToStore(op, setter, reader);

    expect(calls).toContainEqual([
      "nodes",
      "parent-a",
      "childrenUuids",
      ["node-2", "node-3", "node-1"],
    ]);
  });

  it("warns when node has no parent during reorder", () => {
    const setter = vi.fn() as unknown as StoreStateSetter;
    const reader: StoreStateReader = {
      getNode: () => ({ uuid: "node-1", parentUuid: null }),
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const op = makeOp({
      type: "reorder",
      nodeUuid: "node-1",
      path: "",
      value: { newPosition: 1 },
      previousValue: { oldPosition: 0 },
    });

    applyOperationToStore(op, setter, reader);

    expect(setter).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
