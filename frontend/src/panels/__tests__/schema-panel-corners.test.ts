/**
 * Tests for the `kind.corners.` MUTATION_MAP handler in SchemaPanel.
 *
 * These tests exercise the handler logic directly via the exported
 * `handleCornersFieldChange` helper (extracted from SchemaPanel for
 * testability). This avoids needing a full DocumentProvider render for
 * pure mutation-logic assertions.
 *
 * Cases covered:
 * 1. All-round, all-equal corners → uniform scalar shorthand.
 * 2. Mixed corners (non-equal radii) → per-corner array.
 * 3. Superellipse corner present → shape-level superellipse call.
 * 4. Non-finite value → early return (setCorners not called).
 * 5. Frame and image kinds also accept writes.
 */

import { describe, it, expect, vi, type Mock } from "vitest";
import { handleCornersFieldChange } from "../schema-panel-corners-handler";
import type { DocumentNode, Corner } from "../../types/document";
import type { DocumentStoreAPI } from "../../store/document-store-solid";

// ── Helpers ────────────────────────────────────────────────────────────

function roundCorner(r: number): Corner {
  return { type: "round", radii: { x: r, y: r } };
}

// RF-032: Replace the `any`-bearing AnyMock alias with a precise Mock type
// derived from the real store's `setCorners` signature. This eliminates the
// previous lint-suppression comment and gives the test file the same
// `no-explicit-any` discipline as production code.
type SetCornersMock = Mock<DocumentStoreAPI["setCorners"]>;

interface CornersStore {
  setCorners: SetCornersMock;
}

function makeStore(): CornersStore {
  return { setCorners: vi.fn() as unknown as SetCornersMock };
}

function makeRectNode(corners: [Corner, Corner, Corner, Corner]): DocumentNode {
  return {
    id: { index: 0, generation: 0 },
    uuid: "uuid-rect",
    name: "Rect",
    kind: { type: "rectangle" as const, corners },
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal" as const, value: 1 },
      blend_mode: "normal" as const,
      effects: [],
    },
    constraints: { horizontal: "start" as const, vertical: "start" as const },
    grid_placement: null,
    visible: true,
    locked: false,
  } as unknown as DocumentNode;
}

function makeFrameNode(corners: [Corner, Corner, Corner, Corner]): DocumentNode {
  return {
    id: { index: 1, generation: 0 },
    uuid: "uuid-frame",
    name: "Frame",
    kind: { type: "frame" as const, layout: null, corners },
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 200, height: 200, rotation: 0, scale_x: 1, scale_y: 1 },
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal" as const, value: 1 },
      blend_mode: "normal" as const,
      effects: [],
    },
    constraints: { horizontal: "start" as const, vertical: "start" as const },
    grid_placement: null,
    visible: true,
    locked: false,
  } as unknown as DocumentNode;
}

function makeImageNode(corners: [Corner, Corner, Corner, Corner]): DocumentNode {
  return {
    id: { index: 2, generation: 0 },
    uuid: "uuid-image",
    name: "Image",
    kind: { type: "image" as const, asset_ref: "asset-1", corners },
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 150, height: 150, rotation: 0, scale_x: 1, scale_y: 1 },
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal" as const, value: 1 },
      blend_mode: "normal" as const,
      effects: [],
    },
    constraints: { horizontal: "start" as const, vertical: "start" as const },
    grid_placement: null,
    visible: true,
    locked: false,
  } as unknown as DocumentNode;
}

// ── Test suite ─────────────────────────────────────────────────────────

describe("handleCornersFieldChange", () => {
  // ── Case 1: uniform-scalar shorthand ────────────────────────────────

  it("should call setCorners with uniform scalar when all 4 corners are equal round at 0", () => {
    const store = makeStore();
    const node = makeRectNode([roundCorner(0), roundCorner(0), roundCorner(0), roundCorner(0)]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.0.radii.x",
      20,
      node,
    );
    expect(store.setCorners).toHaveBeenCalledOnce();
    expect(store.setCorners).toHaveBeenCalledWith("uuid-rect", 20);
  });

  it("should call setCorners with uniform scalar when all 4 corners are equal round at non-zero", () => {
    const store = makeStore();
    const node = makeRectNode([
      roundCorner(10),
      roundCorner(10),
      roundCorner(10),
      roundCorner(10),
    ]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.2.radii.x",
      15,
      node,
    );
    // All corners were equal-round before (10). Because they were uniform before,
    // the UI treats them as linked — the new value is applied to all corners as
    // a scalar shorthand.
    expect(store.setCorners).toHaveBeenCalledOnce();
    expect(store.setCorners).toHaveBeenCalledWith("uuid-rect", 15);
  });

  it("should use uniform scalar shorthand when writing same value to corner 0 that matches the others", () => {
    const store = makeStore();
    // All 4 currently at 5 — write 5 to index 0 → still all 5 → uniform
    const node = makeRectNode([roundCorner(5), roundCorner(5), roundCorner(5), roundCorner(5)]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.0.radii.x",
      5,
      node,
    );
    expect(store.setCorners).toHaveBeenCalledWith("uuid-rect", 5);
  });

  // ── Case 2: per-corner array ─────────────────────────────────────────

  it("should call setCorners with per-corner array when corners are unequal", () => {
    const store = makeStore();
    const node = makeRectNode([
      roundCorner(0),
      roundCorner(10),
      roundCorner(0),
      roundCorner(0),
    ]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.0.radii.x",
      20,
      node,
    );
    expect(store.setCorners).toHaveBeenCalledOnce();
    const [, arg] = store.setCorners.mock.calls[0] as [string, unknown];
    expect(Array.isArray(arg)).toBe(true);
    const arr = arg as Corner[];
    expect(arr).toHaveLength(4);
    // Corner 0 updated to 20, others preserved
    expect((arr[0] as { radii: { x: number } }).radii.x).toBe(20);
    expect((arr[1] as { radii: { x: number } }).radii.x).toBe(10);
  });

  it("should preserve existing corner type when updating radii", () => {
    const bevelCorner: Corner = { type: "bevel", radii: { x: 5, y: 5 } };
    const store = makeStore();
    const node = makeRectNode([
      bevelCorner,
      roundCorner(0),
      roundCorner(0),
      roundCorner(0),
    ]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.0.radii.x",
      12,
      node,
    );
    const [, arg] = store.setCorners.mock.calls[0] as [string, unknown];
    const arr = arg as Corner[];
    // Type must be preserved — bevel, not round
    expect(arr[0]?.type).toBe("bevel");
    expect((arr[0] as { radii: { x: number } }).radii.x).toBe(12);
  });

  // ── Case 3: superellipse shape-level call ────────────────────────────

  it("should call setCorners with shape-level superellipse when any corner is superellipse", () => {
    const supCorner: Corner = { type: "superellipse", radii: { x: 8, y: 8 }, smoothing: 0.6 };
    const store = makeStore();
    const node = makeRectNode([supCorner, supCorner, supCorner, supCorner]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.0.radii.x",
      16,
      node,
    );
    expect(store.setCorners).toHaveBeenCalledOnce();
    const [, arg] = store.setCorners.mock.calls[0] as [string, unknown];
    expect(typeof arg).toBe("object");
    expect((arg as { type: string }).type).toBe("superellipse");
    expect((arg as { radius: number }).radius).toBe(16);
    expect((arg as { smoothing: number }).smoothing).toBe(0.6);
  });

  it("should use the existing smoothing from corner 0 for superellipse shape-level call", () => {
    const supCorner: Corner = { type: "superellipse", radii: { x: 4, y: 4 }, smoothing: 0.8 };
    const store = makeStore();
    const node = makeRectNode([supCorner, supCorner, supCorner, supCorner]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.2.radii.x",
      10,
      node,
    );
    const [, arg] = store.setCorners.mock.calls[0] as [string, unknown];
    expect((arg as { smoothing: number }).smoothing).toBe(0.8);
  });

  // ── Case 4: invalid (non-finite) input ───────────────────────────────

  it("should not call setCorners when value is NaN", () => {
    const store = makeStore();
    const node = makeRectNode([roundCorner(0), roundCorner(0), roundCorner(0), roundCorner(0)]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.0.radii.x",
      NaN,
      node,
    );
    expect(store.setCorners).not.toHaveBeenCalled();
  });

  it("should not call setCorners when value is Infinity", () => {
    const store = makeStore();
    const node = makeRectNode([roundCorner(0), roundCorner(0), roundCorner(0), roundCorner(0)]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.0.radii.x",
      Infinity,
      node,
    );
    expect(store.setCorners).not.toHaveBeenCalled();
  });

  it("should not call setCorners when value is negative", () => {
    const store = makeStore();
    const node = makeRectNode([roundCorner(0), roundCorner(0), roundCorner(0), roundCorner(0)]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.0.radii.x",
      -1,
      node,
    );
    expect(store.setCorners).not.toHaveBeenCalled();
  });

  it("should not call setCorners when value is not a number", () => {
    const store = makeStore();
    const node = makeRectNode([roundCorner(0), roundCorner(0), roundCorner(0), roundCorner(0)]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.0.radii.x",
      "not-a-number",
      node,
    );
    expect(store.setCorners).not.toHaveBeenCalled();
  });

  // ── Case 5: frame and image kinds ────────────────────────────────────

  it("should write to a frame node with corners", () => {
    const store = makeStore();
    const node = makeFrameNode([roundCorner(0), roundCorner(0), roundCorner(0), roundCorner(0)]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-frame",
      "kind.corners.0.radii.x",
      8,
      node,
    );
    expect(store.setCorners).toHaveBeenCalledWith("uuid-frame", 8);
  });

  it("should write to an image node with corners", () => {
    const store = makeStore();
    const node = makeImageNode([roundCorner(0), roundCorner(0), roundCorner(0), roundCorner(0)]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-image",
      "kind.corners.0.radii.x",
      4,
      node,
    );
    expect(store.setCorners).toHaveBeenCalledWith("uuid-image", 4);
  });

  // ── Case 6: orthogonal-axis preservation (RF-008) ───────────────────

  it("preserves existing y radius when editing only .x on a per-corner array", () => {
    // Start with an elliptical corner 0 ({x: 8, y: 4}) — set this way via
    // MCP/GraphQL since the schema only exposes .x edits today. The other
    // corners are different so we land in the per-corner array branch
    // (not the uniform-scalar shorthand).
    const ellipticalCorner: Corner = { type: "round", radii: { x: 8, y: 4 } };
    const store = makeStore();
    const node = makeRectNode([
      ellipticalCorner,
      roundCorner(0),
      roundCorner(0),
      roundCorner(0),
    ]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.0.radii.x",
      10,
      node,
    );
    const [, arg] = store.setCorners.mock.calls[0] as [string, unknown];
    expect(Array.isArray(arg)).toBe(true);
    const arr = arg as Corner[];
    expect((arr[0] as { radii: { x: number; y: number } }).radii.x).toBe(10);
    // The pre-existing y MUST survive — this is the data-loss bug fixed
    // by RF-008.
    expect((arr[0] as { radii: { x: number; y: number } }).radii.y).toBe(4);
  });

  it("preserves existing x radius when editing only .y on a per-corner array", () => {
    // Symmetric case — even though the current schema only exposes .x
    // editors, the handler must be robust to future .y editors so it
    // does not regress when the schema grows.
    const ellipticalCorner: Corner = { type: "round", radii: { x: 7, y: 3 } };
    const store = makeStore();
    const node = makeRectNode([
      ellipticalCorner,
      roundCorner(0),
      roundCorner(0),
      roundCorner(0),
    ]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.0.radii.y",
      9,
      node,
    );
    const [, arg] = store.setCorners.mock.calls[0] as [string, unknown];
    expect(Array.isArray(arg)).toBe(true);
    const arr = arg as Corner[];
    expect((arr[0] as { radii: { x: number; y: number } }).radii.x).toBe(7);
    expect((arr[0] as { radii: { x: number; y: number } }).radii.y).toBe(9);
  });

  it("preserves existing y radius when editing only .x on a Bevel corner", () => {
    // Same preservation rule applies to non-Round corner types
    // (Bevel/Notch/Scoop also carry CornerRadii per spec §7).
    const bevelEllip: Corner = { type: "bevel", radii: { x: 12, y: 6 } };
    const store = makeStore();
    const node = makeRectNode([
      bevelEllip,
      roundCorner(0),
      roundCorner(0),
      roundCorner(0),
    ]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.0.radii.x",
      14,
      node,
    );
    const [, arg] = store.setCorners.mock.calls[0] as [string, unknown];
    const arr = arg as Corner[];
    expect(arr[0]?.type).toBe("bevel");
    expect((arr[0] as { radii: { x: number; y: number } }).radii.x).toBe(14);
    expect((arr[0] as { radii: { x: number; y: number } }).radii.y).toBe(6);
  });

  it("does not call setCorners when axis component is unrecognised", () => {
    const store = makeStore();
    const node = makeRectNode([roundCorner(0), roundCorner(0), roundCorner(0), roundCorner(0)]);
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-rect",
      "kind.corners.0.radii.z",
      10,
      node,
    );
    expect(store.setCorners).not.toHaveBeenCalled();
  });

  // ── Case 7: non-corner kind ──────────────────────────────────────────

  it("should not call setCorners for a non-corner kind (ellipse)", () => {
    const store = makeStore();
    const node = {
      id: { index: 3, generation: 0 },
      uuid: "uuid-ellipse",
      name: "Ellipse",
      kind: { type: "ellipse" as const, arc_start: 0, arc_end: Math.PI * 2 },
      parent: null,
      children: [],
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
      style: {
        fills: [],
        strokes: [],
        opacity: { type: "literal" as const, value: 1 },
        blend_mode: "normal" as const,
        effects: [],
      },
      constraints: { horizontal: "start" as const, vertical: "start" as const },
      grid_placement: null,
      visible: true,
      locked: false,
    } as unknown as DocumentNode;
    handleCornersFieldChange(
      store as unknown as Pick<import("../../store/document-store-solid").DocumentStoreAPI, "setCorners">,
      "uuid-ellipse",
      "kind.corners.0.radii.x",
      10,
      node,
    );
    expect(store.setCorners).not.toHaveBeenCalled();
  });
});
