import { describe, it, expect, vi } from "vitest";
import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import {
  applyRemoteTransaction,
  type RemoteTransactionPayload,
  type RemoteOperationPayload,
} from "../apply-remote";
import type { DocumentNode, Transform, Fill, Stroke, Effect, NodeKind } from "../../types/document";

// ── Helpers ───────────────────────────────────────────────────────────

/** Mutable document node matching the store shape. */
type MutableDocumentNode = {
  -readonly [K in keyof DocumentNode]: DocumentNode[K];
} & {
  parentUuid: string | null;
  childrenUuids: string[];
};

interface StoreState {
  nodes: Record<string, MutableDocumentNode>;
  pages: Array<{ id: string; name: string; root_nodes: unknown[] }>;
}

const PLACEHOLDER_NODE_ID = { index: 0, generation: 0 };

function makeNode(uuid: string, overrides?: Partial<MutableDocumentNode>): MutableDocumentNode {
  return {
    id: PLACEHOLDER_NODE_ID,
    uuid,
    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
    name: "Test Node",
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal", value: 1 },
      blend_mode: "normal",
      effects: [],
    },
    constraints: { horizontal: "start", vertical: "start" },
    grid_placement: null,
    visible: true,
    locked: false,
    parentUuid: null,
    childrenUuids: [],
    ...overrides,
  };
}

function makeTx(
  overrides?: Partial<RemoteTransactionPayload>,
  ops?: RemoteOperationPayload[],
): RemoteTransactionPayload {
  return {
    transactionId: "tx-1",
    userId: "remote-user",
    seq: "42",
    operations: ops ?? [],
    eventType: "NODE_UPDATED",
    uuid: null,
    ...overrides,
  };
}

function makeOp(overrides?: Partial<RemoteOperationPayload>): RemoteOperationPayload {
  return {
    id: "op-1",
    nodeUuid: "node-1",
    type: "set_field",
    path: "name",
    value: "New Name",
    ...overrides,
  };
}

const LOCAL_USER = "local-user";
const REMOTE_USER = "remote-user";

// ── Tests ─────────────────────────────────────────────────────────────

describe("applyRemoteTransaction", () => {
  describe("self-echo suppression", () => {
    it("should return seq without applying when userId matches localUserId", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        const seq = applyRemoteTransaction(
          makeTx({ userId: LOCAL_USER }, [makeOp({ path: "name", value: "Changed" })]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(seq).toBe(42);
        expect(state.nodes["node-1"].name).toBe("Test Node");
        expect(fetchPages).not.toHaveBeenCalled();
        dispose();
      });
    });
  });

  describe("legacy fallback", () => {
    it("should call fetchPages when operations array is empty", () => {
      createRoot((dispose) => {
        const [, setState] = createStore<StoreState>({ nodes: {}, pages: [] });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        const seq = applyRemoteTransaction(
          makeTx({ userId: REMOTE_USER, seq: "7" }, []),
          LOCAL_USER,
          setState,
          () => undefined,
          fetchPages,
        );

        expect(seq).toBe(7);
        expect(fetchPages).toHaveBeenCalledTimes(1);
        dispose();
      });
    });
  });

  describe("set_field operations", () => {
    it("should update transform field on the target node", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);
        const newTransform: Transform = {
          x: 50,
          y: 60,
          width: 200,
          height: 300,
          rotation: 45,
          scale_x: 2,
          scale_y: 2,
        };

        applyRemoteTransaction(
          makeTx({}, [makeOp({ path: "transform", value: newTransform })]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].transform).toEqual(newTransform);
        dispose();
      });
    });

    it("should update name field on the target node", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx({}, [makeOp({ path: "name", value: "Renamed" })]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].name).toBe("Renamed");
        dispose();
      });
    });

    it("should update visible field on the target node", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx({}, [makeOp({ path: "visible", value: false })]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].visible).toBe(false);
        dispose();
      });
    });

    it("should update locked field on the target node", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx({}, [makeOp({ path: "locked", value: true })]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].locked).toBe(true);
        dispose();
      });
    });

    it("should update style.fills on the target node", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);
        const newFills: Fill[] = [
          {
            type: "solid",
            color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } },
          },
        ];

        applyRemoteTransaction(
          makeTx({}, [makeOp({ path: "style.fills", value: newFills })]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].style.fills).toEqual(newFills);
        dispose();
      });
    });

    it("should update style.strokes on the target node", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);
        const newStrokes: Stroke[] = [
          {
            color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
            width: { type: "literal", value: 2 },
            alignment: "center",
            cap: "butt",
            join: "miter",
          },
        ];

        applyRemoteTransaction(
          makeTx({}, [makeOp({ path: "style.strokes", value: newStrokes })]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].style.strokes).toEqual(newStrokes);
        dispose();
      });
    });

    it("should update style.effects on the target node", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);
        const newEffects: Effect[] = [
          {
            type: "drop_shadow",
            color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 0.5 } },
            offset: { x: 4, y: 4 },
            blur: { type: "literal", value: 8 },
            spread: { type: "literal", value: 0 },
          },
        ];

        applyRemoteTransaction(
          makeTx({}, [makeOp({ path: "style.effects", value: newEffects })]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].style.effects).toEqual(newEffects);
        dispose();
      });
    });

    it("should update style.opacity on the target node", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx({}, [makeOp({ path: "style.opacity", value: { type: "literal", value: 0.5 } })]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].style.opacity).toEqual({ type: "literal", value: 0.5 });
        dispose();
      });
    });

    it("should update style.blend_mode on the target node", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx({}, [makeOp({ path: "style.blend_mode", value: "multiply" })]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].style.blend_mode).toBe("multiply");
        dispose();
      });
    });

    it("should update kind field on the target node", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);
        const newKind: NodeKind = { type: "rectangle", corner_radii: [8, 8, 8, 8] };

        applyRemoteTransaction(
          makeTx({}, [makeOp({ path: "kind", value: newKind })]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].kind).toEqual(newKind);
        dispose();
      });
    });
  });

  describe("create_node", () => {
    it("should add a new node to the store", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);
        const newNodeData = {
          uuid: "new-node-1",
          kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
          name: "New Rect",
          transform: { x: 10, y: 20, width: 50, height: 50, rotation: 0, scale_x: 1, scale_y: 1 },
          style: {
            fills: [],
            strokes: [],
            opacity: { type: "literal", value: 1 },
            blend_mode: "normal",
            effects: [],
          },
          visible: true,
          locked: false,
          parent: null,
          children: [],
        };

        applyRemoteTransaction(
          makeTx({}, [
            makeOp({
              type: "create_node",
              nodeUuid: "new-node-1",
              path: null,
              value: newNodeData,
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["new-node-1"]).toBeDefined();
        expect(state.nodes["new-node-1"].name).toBe("New Rect");
        expect(state.nodes["new-node-1"].uuid).toBe("new-node-1");
        dispose();
      });
    });

    it("should update parent's childrenUuids when new node has a parent", () => {
      createRoot((dispose) => {
        const parent = makeNode("parent-1", { childrenUuids: ["existing-child"] });
        const [state, setState] = createStore<StoreState>({
          nodes: { "parent-1": parent, "existing-child": makeNode("existing-child") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);
        const newNodeData = {
          uuid: "new-child",
          kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
          name: "New Child",
          parent: "parent-1",
          children: [],
        };

        applyRemoteTransaction(
          makeTx({}, [
            makeOp({
              type: "create_node",
              nodeUuid: "new-child",
              path: null,
              value: newNodeData,
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["new-child"]).toBeDefined();
        expect(state.nodes["parent-1"].childrenUuids).toContain("new-child");
        expect(state.nodes["parent-1"].childrenUuids).toContain("existing-child");
        dispose();
      });
    });

    it("should reject create_node when transform has NaN fields", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const newNodeData = {
          uuid: "bad-node",
          transform: { x: NaN, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
        };

        applyRemoteTransaction(
          makeTx({}, [
            makeOp({
              type: "create_node",
              nodeUuid: "bad-node",
              path: null,
              value: newNodeData,
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["bad-node"]).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("transform.x is not a finite number"),
        );
        warnSpy.mockRestore();
        dispose();
      });
    });

    it("should reject create_node when transform has Infinity fields", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const newNodeData = {
          uuid: "bad-node",
          transform: {
            x: 0,
            y: 0,
            width: Infinity,
            height: 100,
            rotation: 0,
            scale_x: 1,
            scale_y: 1,
          },
        };

        applyRemoteTransaction(
          makeTx({}, [
            makeOp({
              type: "create_node",
              nodeUuid: "bad-node",
              path: null,
              value: newNodeData,
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["bad-node"]).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("transform.width is not a finite number"),
        );
        warnSpy.mockRestore();
        dispose();
      });
    });

    it("should reject create_node when transform is not an object", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const newNodeData = {
          uuid: "bad-node",
          transform: "not-an-object",
        };

        applyRemoteTransaction(
          makeTx({}, [
            makeOp({
              type: "create_node",
              nodeUuid: "bad-node",
              path: null,
              value: newNodeData,
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["bad-node"]).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("transform is not an object"));
        warnSpy.mockRestore();
        dispose();
      });
    });
  });

  describe("delete_node", () => {
    it("should remove a node from the store", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx({}, [
            makeOp({
              type: "delete_node",
              nodeUuid: "node-1",
              path: null,
              value: null,
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"]).toBeUndefined();
        dispose();
      });
    });

    it("should remove deleted node from parent's childrenUuids", () => {
      createRoot((dispose) => {
        const parent = makeNode("parent-1", {
          childrenUuids: ["node-1", "node-2"],
        });
        const child = makeNode("node-1", { parentUuid: "parent-1" });
        const [state, setState] = createStore<StoreState>({
          nodes: { "parent-1": parent, "node-1": child, "node-2": makeNode("node-2") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx({}, [
            makeOp({ type: "delete_node", nodeUuid: "node-1", path: null, value: null }),
          ]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"]).toBeUndefined();
        expect(state.nodes["parent-1"].childrenUuids).toEqual(["node-2"]);
        dispose();
      });
    });
  });

  describe("reparent", () => {
    it("should update parentUuid and childrenUuids for reparented node", () => {
      createRoot((dispose) => {
        const oldParent = makeNode("old-parent", { childrenUuids: ["node-1"] });
        const newParent = makeNode("new-parent", { childrenUuids: [] });
        const child = makeNode("node-1", { parentUuid: "old-parent" });
        const [state, setState] = createStore<StoreState>({
          nodes: { "old-parent": oldParent, "new-parent": newParent, "node-1": child },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx({}, [
            makeOp({
              type: "reparent",
              nodeUuid: "node-1",
              path: null,
              value: { parentUuid: "new-parent", position: 0 },
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].parentUuid).toBe("new-parent");
        expect(state.nodes["new-parent"].childrenUuids).toContain("node-1");
        expect(state.nodes["old-parent"].childrenUuids).not.toContain("node-1");
        dispose();
      });
    });
  });

  describe("reorder", () => {
    it("should reorder childrenUuids of the parent node", () => {
      createRoot((dispose) => {
        const parent = makeNode("parent-1", {
          childrenUuids: ["child-a", "child-b", "child-c"],
        });
        const [state, setState] = createStore<StoreState>({
          nodes: {
            "parent-1": parent,
            "child-a": makeNode("child-a", { parentUuid: "parent-1" }),
            "child-b": makeNode("child-b", { parentUuid: "parent-1" }),
            "child-c": makeNode("child-c", { parentUuid: "parent-1" }),
          },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        // Move child-c to position 0
        applyRemoteTransaction(
          makeTx({}, [
            makeOp({
              type: "reorder",
              nodeUuid: "child-c",
              path: null,
              value: { newPosition: 0 },
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["parent-1"].childrenUuids[0]).toBe("child-c");
        dispose();
      });
    });
  });

  describe("error resilience", () => {
    it("should log warning and not crash on unknown operation type", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const seq = applyRemoteTransaction(
          makeTx({}, [makeOp({ type: "unknown_type" })]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(seq).toBe(42);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Unknown remote operation type"),
        );
        warnSpy.mockRestore();
        dispose();
      });
    });

    it("should log warning and not crash on unknown field path", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        applyRemoteTransaction(
          makeTx({}, [makeOp({ path: "some.unknown.path", value: "foo" })]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown field path"));
        warnSpy.mockRestore();
        dispose();
      });
    });

    it("should not crash when set_field targets a non-existent node", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(() => {
          applyRemoteTransaction(
            makeTx({}, [makeOp({ nodeUuid: "nonexistent", path: "name", value: "X" })]),
            LOCAL_USER,
            setState,
            (uuid: string) => state.nodes[uuid],
            fetchPages,
          );
        }).not.toThrow();

        warnSpy.mockRestore();
        dispose();
      });
    });

    it("should not crash when set_field has null path", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        expect(() => {
          applyRemoteTransaction(
            makeTx({}, [makeOp({ path: null, value: "foo" })]),
            LOCAL_USER,
            setState,
            (uuid: string) => state.nodes[uuid],
            fetchPages,
          );
        }).not.toThrow();

        dispose();
      });
    });

    it("should handle NaN seq gracefully", () => {
      createRoot((dispose) => {
        const [, setState] = createStore<StoreState>({ nodes: {}, pages: [] });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        const seq = applyRemoteTransaction(
          makeTx({ seq: "not-a-number" }, []),
          LOCAL_USER,
          setState,
          () => undefined,
          fetchPages,
        );

        // NaN seq should be treated as 0 per Number.isFinite guard
        expect(Number.isFinite(seq)).toBe(true);
        expect(seq).toBe(0);
        dispose();
      });
    });
  });

  describe("multiple operations in single transaction", () => {
    it("should apply all operations in a single batch", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: {
            "node-1": makeNode("node-1"),
            "node-2": makeNode("node-2"),
          },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx({}, [
            makeOp({ id: "op-1", nodeUuid: "node-1", path: "name", value: "Node A" }),
            makeOp({ id: "op-2", nodeUuid: "node-2", path: "name", value: "Node B" }),
          ]),
          LOCAL_USER,
          setState,
          (uuid: string) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].name).toBe("Node A");
        expect(state.nodes["node-2"].name).toBe("Node B");
        dispose();
      });
    });
  });

  describe("seq parsing", () => {
    it("should return parsed seq number from transaction", () => {
      createRoot((dispose) => {
        const [, setState] = createStore<StoreState>({ nodes: {}, pages: [] });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        const seq = applyRemoteTransaction(
          makeTx({ userId: LOCAL_USER, seq: "999" }),
          LOCAL_USER,
          setState,
          () => undefined,
          fetchPages,
        );

        expect(seq).toBe(999);
        dispose();
      });
    });
  });
});
