/**
 * Tests for the defensive kind-field handler in apply-remote.ts.
 *
 * Covers the path="kind" case that validates the corners array shape
 * before committing to the store. The old numeric-array corners format
 * has been removed — these tests verify the new handler rejects invalid
 * payloads and accepts well-formed ones.
 */

import { describe, it, expect, vi } from "vitest";
import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import {
  applyRemoteTransaction,
  type RemoteTransactionPayload,
  type RemoteOperationPayload,
  type StoreState,
  type StoreDocumentNode,
} from "../apply-remote";

const PLACEHOLDER_NODE_ID = { index: 0, generation: 0 };

const ZERO_CORNERS = [
  { type: "round" as const, radii: { x: 0, y: 0 } },
  { type: "round" as const, radii: { x: 0, y: 0 } },
  { type: "round" as const, radii: { x: 0, y: 0 } },
  { type: "round" as const, radii: { x: 0, y: 0 } },
] as const;

function makeRectNode(uuid: string, overrides?: Partial<StoreDocumentNode>): StoreDocumentNode {
  return {
    id: PLACEHOLDER_NODE_ID,
    uuid,
    kind: { type: "rectangle", corners: ZERO_CORNERS },
    name: "Rect",
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

function makeFrameNode(uuid: string): StoreDocumentNode {
  return {
    id: PLACEHOLDER_NODE_ID,
    uuid,
    kind: { type: "frame", layout: null, corners: ZERO_CORNERS },
    name: "Frame",
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 200, height: 200, rotation: 0, scale_x: 1, scale_y: 1 },
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
  };
}

function makeTx(ops: RemoteOperationPayload[]): RemoteTransactionPayload {
  return {
    transactionId: "tx-corners",
    userId: "remote-user",
    seq: "1",
    operations: ops,
    eventType: "NODE_UPDATED",
    uuid: null,
  };
}

function makeKindOp(nodeUuid: string, value: unknown): RemoteOperationPayload {
  return {
    id: "op-kind",
    nodeUuid,
    type: "set_field",
    path: "kind",
    value,
  };
}

const LOCAL_USER = "local-user";
const REMOTE_USER = "remote-user";

const VALID_RECT_KIND = {
  type: "rectangle",
  corners: [
    { type: "round", radii: { x: 8, y: 8 } },
    { type: "round", radii: { x: 8, y: 8 } },
    { type: "round", radii: { x: 8, y: 8 } },
    { type: "round", radii: { x: 8, y: 8 } },
  ],
};

const VALID_FRAME_KIND = {
  type: "frame",
  layout: null,
  corners: [
    { type: "round", radii: { x: 4, y: 4 } },
    { type: "bevel", radii: { x: 4, y: 4 } },
    { type: "notch", radii: { x: 4, y: 4 } },
    { type: "scoop", radii: { x: 4, y: 4 } },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("apply-remote corners handler (path='kind')", () => {
  describe("acceptance: applies full kind replacement with new corners", () => {
    it("should update store when payload has valid rectangle corners", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeKindOp("node-1", VALID_RECT_KIND)]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        expect(kind.type).toBe("rectangle");
        if (kind.type === "rectangle") {
          expect(kind.corners[0].type).toBe("round");
          expect(kind.corners[0].radii.x).toBe(8);
        }
        dispose();
      });
    });

    it("should update store when payload has valid frame corners with mixed types", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "frame-1": makeFrameNode("frame-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          { ...makeTx([makeKindOp("frame-1", VALID_FRAME_KIND)]), userId: REMOTE_USER },
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["frame-1"].kind;
        expect(kind.type).toBe("frame");
        if (kind.type === "frame") {
          expect(kind.corners[0].type).toBe("round");
          expect(kind.corners[1].type).toBe("bevel");
          expect(kind.corners[2].type).toBe("notch");
          expect(kind.corners[3].type).toBe("scoop");
        }
        dispose();
      });
    });

    it("should apply superellipse corner kind with valid smoothing", () => {
      createRoot((dispose) => {
        const superellipseKind = {
          type: "rectangle",
          corners: [
            { type: "superellipse", radii: { x: 10, y: 10 }, smoothing: 0.6 },
            { type: "superellipse", radii: { x: 10, y: 10 }, smoothing: 0.6 },
            { type: "superellipse", radii: { x: 10, y: 10 }, smoothing: 0.6 },
            { type: "superellipse", radii: { x: 10, y: 10 }, smoothing: 0.6 },
          ],
        };
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeKindOp("node-1", superellipseKind)]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        expect(kind.type).toBe("rectangle");
        if (kind.type === "rectangle") {
          expect(kind.corners[0].type).toBe("superellipse");
        }
        dispose();
      });
    });
  });

  describe("rejection: payload type discriminator differs from local node type", () => {
    it("should leave state unchanged when payload type is 'frame' but node is 'rectangle'", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        // Node is rectangle, payload says frame — must be rejected
        applyRemoteTransaction(
          makeTx([makeKindOp("node-1", VALID_FRAME_KIND)]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].kind.type).toBe("rectangle");
        dispose();
      });
    });

    it("should leave state unchanged when payload type is 'ellipse' but node is 'rectangle'", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeKindOp("node-1", { type: "ellipse", arc_start: 0, arc_end: 360 })]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].kind.type).toBe("rectangle");
        dispose();
      });
    });
  });

  describe("rejection: corners is not an array", () => {
    it("should leave state unchanged when corners is a string", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeKindOp("node-1", { type: "rectangle", corners: "invalid" })]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        expect(state.nodes["node-1"].kind.type).toBe("rectangle");
        // corners remain unchanged (zero radii)
        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should leave state unchanged when corners is null", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeKindOp("node-1", { type: "rectangle", corners: null })]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });
  });

  describe("rejection: corners array is not length 4", () => {
    it("should leave state unchanged when corners has 3 elements", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should leave state unchanged when corners has 5 elements", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });
  });

  describe("rejection: corner has unknown type discriminator", () => {
    it("should leave state unchanged when a corner type is 'triangle'", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "triangle", radii: { x: 8, y: 8 } }, // invalid
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should leave state unchanged when corner type is missing", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { radii: { x: 8, y: 8 } }, // no type field
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });
  });

  describe("rejection: corner.radii has non-finite x/y", () => {
    it("should leave state unchanged when radii.x is NaN", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "round", radii: { x: NaN, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should leave state unchanged when radii.y is Infinity", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "round", radii: { x: 8, y: Infinity } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should leave state unchanged when radii is not an object", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "round", radii: 42 }, // radii must be {x, y} object
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });
  });

  describe("rejection: superellipse smoothing out of range", () => {
    it("should leave state unchanged when smoothing is greater than 1.0 (MAX_CORNER_SMOOTHING)", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 1.5 }, // > 1.0
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 1.5 },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 1.5 },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 1.5 },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should leave state unchanged when smoothing is negative (below MIN_CORNER_SMOOTHING)", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: -0.1 }, // < 0
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: -0.1 },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: -0.1 },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: -0.1 },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should leave state unchanged when smoothing is NaN", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: NaN },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });
  });

  describe("acceptance: non-corner-bearing kinds pass through without corners validation", () => {
    it("should apply ellipse kind replacement without corners check", () => {
      createRoot((dispose) => {
        const ellipseNode: StoreDocumentNode = {
          id: PLACEHOLDER_NODE_ID,
          uuid: "ellipse-1",
          kind: { type: "ellipse", arc_start: 0, arc_end: 360 },
          name: "Ellipse",
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
        };

        const [state, setState] = createStore<StoreState>({
          nodes: { "ellipse-1": ellipseNode },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("ellipse-1", { type: "ellipse", arc_start: 45, arc_end: 270 }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["ellipse-1"].kind;
        expect(kind.type).toBe("ellipse");
        if (kind.type === "ellipse") {
          expect(kind.arc_start).toBe(45);
          expect(kind.arc_end).toBe(270);
        }
        dispose();
      });
    });
  });

  // ── M1 findings: missing bounds/uniformity checks ────────────────

  describe("rejection: negative radii (M1 finding)", () => {
    it("should reject negative radii.x", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "round", radii: { x: -1, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        // Store must remain unchanged with zero radii from seed
        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should reject negative radii.y", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "round", radii: { x: 8, y: -5 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });
  });

  describe("rejection: radii above MAX_CORNER_RADIUS (M1 finding)", () => {
    it("should reject radii.x above MAX_CORNER_RADIUS (100_000)", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "round", radii: { x: 100_001, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should reject radii.y above MAX_CORNER_RADIUS (100_000)", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "round", radii: { x: 8, y: 100_001 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should accept radii exactly at MAX_CORNER_RADIUS (100_000)", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "round", radii: { x: 100_000, y: 100_000 } },
                { type: "round", radii: { x: 100_000, y: 100_000 } },
                { type: "round", radii: { x: 100_000, y: 100_000 } },
                { type: "round", radii: { x: 100_000, y: 100_000 } },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        // Should be applied — exactly at limit is valid
        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(100_000);
        }
        dispose();
      });
    });
  });

  describe("rejection: superellipse uniformity (M1 finding)", () => {
    it("should reject mixed superellipse and round corners", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.6 },
                { type: "round", radii: { x: 8, y: 8 } }, // not superellipse — invalid
                { type: "round", radii: { x: 8, y: 8 } },
                { type: "round", radii: { x: 8, y: 8 } },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        // Must be rejected — store unchanged
        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].type).toBe("round");
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should reject a single superellipse corner among other types", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "bevel", radii: { x: 8, y: 8 } },
                { type: "notch", radii: { x: 8, y: 8 } },
                { type: "scoop", radii: { x: 8, y: 8 } },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should accept all four superellipse corners", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        // All four superellipse — valid, store must be updated
        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].type).toBe("superellipse");
        }
        dispose();
      });
    });
  });

  describe("rejection: superellipse smoothing parity (M1 finding)", () => {
    it("should reject superellipse corners with mismatched smoothing values", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.6 }, // different!
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        // Must be rejected — smoothing values not all equal
        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should reject superellipse corners where first and last smoothing differ", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeKindOp("node-1", {
              type: "rectangle",
              corners: [
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.3 }, // different!
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
                { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.5 },
              ],
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });
  });

  describe("rejection: non-object payload", () => {
    it("should leave state unchanged when value is a string", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeKindOp("node-1", "rectangle")]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should leave state unchanged when value is null", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeKindOp("node-1", null)]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });

    it("should leave state unchanged when value is an array", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: { "node-1": makeRectNode("node-1") },
          pages: [],
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeKindOp("node-1", ["rectangle"])]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = state.nodes["node-1"].kind;
        if (kind.type === "rectangle") {
          expect(kind.corners[0].radii.x).toBe(0);
        }
        dispose();
      });
    });
  });

  // ── RF-030: structured logging on every silent early-return ──────────
  //
  // Per CLAUDE.md "No Silent Error Suppression": each rejection branch
  // in the kind handler must emit a structured `console.warn` carrying
  // `{ nodeUuid, reason, ...ctx }` so dropped remote mutations are
  // observable. These tests assert the log shape, not just presence.

  describe("RF-030: emits structured warn on every rejection branch", () => {
    function expectRejection(
      payload: unknown,
      expectedReason: string,
      makeNode: (uuid: string) => StoreDocumentNode = makeRectNode,
    ): void {
      createRoot((dispose) => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
          const [state, setState] = createStore<StoreState>({
            nodes: { "node-1": makeNode("node-1") },
            pages: [],
          });
          const fetchPages = vi.fn().mockResolvedValue(undefined);
          applyRemoteTransaction(
            makeTx([makeKindOp("node-1", payload)]),
            LOCAL_USER,
            setState,
            (uuid) => state.nodes[uuid],
            fetchPages,
          );
          const matched = warnSpy.mock.calls.find(
            (call) =>
              call[0] === "Remote set_field kind: rejected" &&
              typeof call[1] === "object" &&
              call[1] !== null &&
              (call[1] as Record<string, unknown>).reason === expectedReason,
          );
          expect(matched, `expected reason=${expectedReason}`).toBeDefined();
          const ctx = matched?.[1] as Record<string, unknown>;
          expect(ctx.nodeUuid).toBe("node-1");
        } finally {
          warnSpy.mockRestore();
          dispose();
        }
      });
    }

    it("warns reason=kind_value_not_object when value is null", () => {
      expectRejection(null, "kind_value_not_object");
    });

    it("warns reason=kind_value_not_object when value is an array", () => {
      expectRejection(["rectangle"], "kind_value_not_object");
    });

    it("warns reason=kind_type_mismatch when type discriminator differs", () => {
      expectRejection({ type: "frame", layout: null, corners: ZERO_CORNERS }, "kind_type_mismatch");
    });

    it("warns reason=corners_not_array_of_4 when corners is missing", () => {
      expectRejection({ type: "rectangle" }, "corners_not_array_of_4");
    });

    it("warns reason=corners_not_array_of_4 when corners has wrong length", () => {
      expectRejection(
        { type: "rectangle", corners: [{ type: "round", radii: { x: 0, y: 0 } }] },
        "corners_not_array_of_4",
      );
    });

    it("warns reason=corner_invalid_type when discriminator is not in the allowlist", () => {
      const corners = [
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "elliptical", radii: { x: 0, y: 0 } }, // unknown type
      ];
      expectRejection({ type: "rectangle", corners }, "corner_invalid_type");
    });

    it("warns reason=corner_radius_x_not_finite when x is NaN", () => {
      const corners = [
        { type: "round", radii: { x: NaN, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
      ];
      expectRejection({ type: "rectangle", corners }, "corner_radius_x_not_finite");
    });

    it("warns reason=corner_radius_x_out_of_range when x is negative", () => {
      const corners = [
        { type: "round", radii: { x: -1, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
      ];
      expectRejection({ type: "rectangle", corners }, "corner_radius_x_out_of_range");
    });

    it("warns reason=superellipse_partial_uniformity when only some corners are superellipse", () => {
      const corners = [
        { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.6 },
        { type: "round", radii: { x: 8, y: 8 } },
        { type: "round", radii: { x: 8, y: 8 } },
        { type: "round", radii: { x: 8, y: 8 } },
      ];
      expectRejection({ type: "rectangle", corners }, "superellipse_partial_uniformity");
    });

    it("warns reason=superellipse_smoothing_parity_violation when smoothings differ across corners", () => {
      const corners = [
        { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.6 },
        { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.6 },
        { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.6 },
        { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.7 }, // mismatched
      ];
      expectRejection({ type: "rectangle", corners }, "superellipse_smoothing_parity_violation");
    });
  });
});
