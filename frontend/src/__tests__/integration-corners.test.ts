/**
 * End-to-end replay of the MCP broadcast shape asserted in
 * crates/mcp/tests/integration_set_corners.rs. If either side drifts,
 * the MCP Broadcast Payload Shape Contract (CLAUDE.md §4) is broken.
 *
 * These tests construct the exact transaction payload that the Rust
 * integration tests verify is emitted by `set_corners_impl`, then feed it
 * through `applyRemoteTransaction` to confirm the frontend dispatcher
 * applies the change to the Solid store correctly.
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
} from "../operations/apply-remote";

// ── Helpers mirrored from apply-remote-corners.test.ts ────────────────

const PLACEHOLDER_NODE_ID = { index: 0, generation: 0 };

const ZERO_CORNERS = [
  { type: "round" as const, radii: { x: 0, y: 0 } },
  { type: "round" as const, radii: { x: 0, y: 0 } },
  { type: "round" as const, radii: { x: 0, y: 0 } },
  { type: "round" as const, radii: { x: 0, y: 0 } },
] as const;

function makeRectNode(uuid: string): StoreDocumentNode {
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
  };
}

function makeTx(ops: RemoteOperationPayload[], userId = "remote-user"): RemoteTransactionPayload {
  return {
    transactionId: "tx-integration",
    userId,
    seq: "1",
    operations: ops,
    eventType: "NODE_UPDATED",
    uuid: null,
  };
}

function makeSetFieldOp(nodeUuid: string, path: string, value: unknown): RemoteOperationPayload {
  return {
    id: "op-integration",
    nodeUuid,
    type: "set_field",
    path,
    value,
  };
}

const LOCAL_USER = "local-user";
const RECT_UUID = "rect-integration-uuid";

// ── Tests ─────────────────────────────────────────────────────────────

describe("integration: MCP broadcast → applyRemoteTransaction (corners)", () => {
  /**
   * Mirrors test_set_corners_uniform_round_broadcasts_full_kind in
   * crates/mcp/tests/integration_set_corners.rs.
   *
   * The Rust test asserts the broadcast value is:
   *   { type: "rectangle", corners: [4 × { type: "round", radii: { x: 16, y: 16 } }] }
   *
   * This test feeds that exact payload into the frontend dispatcher and
   * asserts the store is updated to match.
   */
  it("test_set_corners_uniform_round_broadcasts_full_kind: store reflects 16px round corners", () => {
    createRoot((dispose) => {
      const [state, setState] = createStore<StoreState>({
        nodes: { [RECT_UUID]: makeRectNode(RECT_UUID) },
        pages: [],
        tokens: {},
      });
      const fetchPages = vi.fn().mockResolvedValue(undefined);

      // Exact payload shape that Rust broadcasts for
      //   set_corners_impl(&state, &uuid, &json!({ "shape": "round", "radius": 16.0 }))
      const broadcastValue = {
        type: "rectangle",
        corners: [
          { type: "round", radii: { x: 16, y: 16 } },
          { type: "round", radii: { x: 16, y: 16 } },
          { type: "round", radii: { x: 16, y: 16 } },
          { type: "round", radii: { x: 16, y: 16 } },
        ],
      };

      applyRemoteTransaction(
        makeTx([makeSetFieldOp(RECT_UUID, "kind", broadcastValue)]),
        LOCAL_USER,
        setState,
        (uuid) => state.nodes[uuid],
        fetchPages,
      );

      const kind = state.nodes[RECT_UUID].kind;
      expect(kind.type).toBe("rectangle");
      if (kind.type === "rectangle") {
        expect(kind.corners).toHaveLength(4);
        for (let i = 0; i < 4; i++) {
          expect(kind.corners[i].type).toBe("round");
          expect(kind.corners[i].radii.x).toBe(16);
          expect(kind.corners[i].radii.y).toBe(16);
        }
      }
      dispose();
    });
  });

  /**
   * Mirrors test_set_corners_superellipse_broadcasts_shape_level_payload in
   * crates/mcp/tests/integration_set_corners.rs.
   *
   * The Rust test asserts the broadcast value is:
   *   { type: "rectangle",
   *     corners: [4 × { type: "superellipse", radii: { x: 20, y: 20 }, smoothing: 0.7 }] }
   *
   * This test feeds that exact payload into the frontend dispatcher and
   * asserts the store is updated to match.
   */
  it("test_set_corners_superellipse_broadcasts_shape_level_payload: store reflects 20px superellipse smoothing=0.7", () => {
    createRoot((dispose) => {
      const [state, setState] = createStore<StoreState>({
        nodes: { [RECT_UUID]: makeRectNode(RECT_UUID) },
        pages: [],
        tokens: {},
      });
      const fetchPages = vi.fn().mockResolvedValue(undefined);

      // Exact payload shape that Rust broadcasts for
      //   set_corners_impl(&state, &uuid,
      //     &json!({ "shape": "superellipse", "radius": 20.0, "smoothing": 0.7 }))
      const broadcastValue = {
        type: "rectangle",
        corners: [
          { type: "superellipse", radii: { x: 20, y: 20 }, smoothing: 0.7 },
          { type: "superellipse", radii: { x: 20, y: 20 }, smoothing: 0.7 },
          { type: "superellipse", radii: { x: 20, y: 20 }, smoothing: 0.7 },
          { type: "superellipse", radii: { x: 20, y: 20 }, smoothing: 0.7 },
        ],
      };

      applyRemoteTransaction(
        makeTx([makeSetFieldOp(RECT_UUID, "kind", broadcastValue)]),
        LOCAL_USER,
        setState,
        (uuid) => state.nodes[uuid],
        fetchPages,
      );

      const kind = state.nodes[RECT_UUID].kind;
      expect(kind.type).toBe("rectangle");
      if (kind.type === "rectangle") {
        expect(kind.corners).toHaveLength(4);
        for (let i = 0; i < 4; i++) {
          const corner = kind.corners[i];
          expect(corner.type).toBe("superellipse");
          expect(corner.radii.x).toBe(20);
          expect(corner.radii.y).toBe(20);
          if (corner.type === "superellipse") {
            expect(corner.smoothing).toBe(0.7);
          }
        }
      }
      dispose();
    });
  });
});
