/**
 * RF-018: integration test for SchemaPanel → setCorners pipeline.
 *
 * Per CLAUDE.md frontend-defensive "Reactive Pipelines Must Be Verified
 * End-to-End": when a value flows from a producer (a NumberField input
 * inside SchemaPanel) to a consumer (store.setCorners), the wiring MUST
 * be exercised by an integration test, not just the producer or consumer
 * in isolation. The chain under test is:
 *
 *   SchemaPanel
 *     → SchemaSection (For/Show)
 *       → FieldRenderer (Switch/Match by field.type)
 *         → NumberInput (Kobalte NumberField)
 *           → onValueChange (Number.isFinite guard)
 *             → SchemaPanel.handleFieldChange
 *               → MUTATION_MAP "kind.corners." entry
 *                 → handleCornersFieldChange
 *                   → store.setCorners
 *
 * Existing unit tests cover handleCornersFieldChange (schema-panel-corners.test.ts)
 * and the parser/store layer (document-store-corners.test.ts) in isolation.
 * Neither of those exercises the chain — a regression in any link (renamed
 * MUTATION_MAP prefix, missing onChange forwarding, broken FieldRenderer
 * dispatch, lost field.key in SchemaSection) would compile and pass unit
 * tests but break the user-facing edit. This test guards that chain.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import { fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { SchemaPanel } from "../SchemaPanel";
import { DocumentProvider } from "../../store/document-context";
import type { DocumentStoreAPI, ToolType } from "../../store/document-store-solid";
import type { PropertySchema } from "../schema/types";
import { MAX_CORNER_RADIUS } from "../../store/corners-input";

// Schema slice under test: just the Corner Radius section with TL.
const cornerSchema: PropertySchema = {
  sections: [
    {
      name: "Corner Radius",
      when: ["rectangle", "frame", "image"],
      fields: [
        {
          key: "kind.corners.0.radii.x",
          label: "TL",
          type: "number",
          step: 1,
          min: 0,
          max: MAX_CORNER_RADIUS,
        },
      ],
    },
  ],
};

const RECT_UUID = "rect-uuid-rf018";

function makeRectNode(): unknown {
  return {
    id: { index: 0, generation: 0 },
    uuid: RECT_UUID,
    name: "Rect",
    kind: {
      type: "rectangle",
      corners: [
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
      ],
    },
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
  };
}

function createMockStore(setCornersSpy: ReturnType<typeof vi.fn>): DocumentStoreAPI {
  const [selectedNodeId] = createSignal<string | null>(RECT_UUID);
  const [activeTool] = createSignal<ToolType>("select");

  return {
    state: {
      info: {
        name: "",
        page_count: 0,
        node_count: 1,
        can_undo: false,
        can_redo: false,
      },
      pages: [],
      nodes: { [RECT_UUID]: makeRectNode() },
    },
    selectedNodeId,
    setSelectedNodeId: vi.fn(),
    selectedNodeIds: () => [RECT_UUID],
    isNodeSelected: () => true,
    setSelectedNodeIds: vi.fn(),
    activeTool,
    setActiveTool: vi.fn(),
    viewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: vi.fn(),
    connected: () => true,
    canUndo: () => false,
    canRedo: () => false,
    createNode: vi.fn(() => ""),
    setTransform: vi.fn(),
    renameNode: vi.fn(),
    deleteNode: vi.fn(),
    setVisible: vi.fn(),
    setLocked: vi.fn(),
    reparentNode: vi.fn(),
    reorderChildren: vi.fn(),
    setOpacity: vi.fn(),
    setBlendMode: vi.fn(),
    setFills: vi.fn(),
    setStrokes: vi.fn(),
    setEffects: vi.fn(),
    setCorners: setCornersSpy,
    setTextContent: vi.fn(),
    setTextStyle: vi.fn(),
    batchSetTransform: vi.fn(),
    groupNodes: vi.fn(),
    ungroupNodes: vi.fn(),
    createPage: vi.fn(),
    deletePage: vi.fn(),
    renamePage: vi.fn(),
    reorderPages: vi.fn(),
    setActivePage: vi.fn(),
    activePageId: () => null,
    undo: vi.fn(),
    redo: vi.fn(),
    flushHistory: vi.fn(),
    destroy: vi.fn(),
  } as DocumentStoreAPI;
}

describe("RF-018: SchemaPanel → setCorners integration", () => {
  afterEach(() => {
    cleanup();
  });

  it("typing a new TL radius dispatches store.setCorners with the new value", () => {
    const setCornersSpy = vi.fn();
    const store = createMockStore(setCornersSpy);

    const { container } = render(() => (
      <DocumentProvider store={store}>
        <SchemaPanel schema={cornerSchema} />
      </DocumentProvider>
    ));

    // Find the TL number input: NumberField renders an <input> inside the
    // section. The Kobalte NumberField fires `onRawValueChange` during mount
    // with the initial value (0); we ignore those mount-time calls and assert
    // on the call that follows the user-initiated change event.
    const inputs = container.querySelectorAll("input");
    expect(inputs.length).toBeGreaterThan(0);
    const tlInput = inputs[0] as HTMLInputElement;

    // Snapshot mount-time call count so we can assert the user-initiated call
    // is observable independently from any onMount emission.
    const mountTimeCalls = setCornersSpy.mock.calls.length;

    // Simulate user typing a new value and committing via blur — Kobalte
    // NumberField commits the parsed numeric value on `change`, which fires
    // `onRawValueChange`.
    fireEvent.input(tlInput, { target: { value: "20" } });
    fireEvent.change(tlInput, { target: { value: "20" } });
    fireEvent.blur(tlInput);

    // Assert: setCorners was called at least once after mount with the
    // correct args. Because all 4 corners were uniform-zero before, the
    // handler emits a uniform scalar shorthand (a single number 20).
    expect(setCornersSpy.mock.calls.length).toBeGreaterThan(mountTimeCalls);
    const userCalls = setCornersSpy.mock.calls.slice(mountTimeCalls);
    const matched = userCalls.find(
      (call) => call[0] === RECT_UUID && call[1] === 20,
    );
    expect(matched).toBeDefined();
  });

  it("section guard: corners section hides for non-corner-bearing kinds", () => {
    // Sanity: when the selected node's kind is text/ellipse, the Corner
    // Radius section is filtered out by `when` — so no NumberField mounts
    // and no spurious onMount call hits setCorners.
    const setCornersSpy = vi.fn();
    const [selectedNodeId] = createSignal<string | null>("ellipse-uuid");
    const [activeTool] = createSignal<ToolType>("select");
    const ellipseNode = {
      ...(makeRectNode() as Record<string, unknown>),
      uuid: "ellipse-uuid",
      kind: { type: "ellipse", arc_start: 0, arc_end: Math.PI * 2 },
    };
    const store = {
      ...createMockStore(setCornersSpy),
      state: {
        info: {
          name: "",
          page_count: 0,
          node_count: 1,
          can_undo: false,
          can_redo: false,
        },
        pages: [],
        nodes: { "ellipse-uuid": ellipseNode },
      },
      selectedNodeId,
      activeTool,
      selectedNodeIds: () => ["ellipse-uuid"],
    } as DocumentStoreAPI;

    const { container } = render(() => (
      <DocumentProvider store={store}>
        <SchemaPanel schema={cornerSchema} />
      </DocumentProvider>
    ));

    // No inputs rendered → no setCorners onMount, no user-initiated dispatch.
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(setCornersSpy).not.toHaveBeenCalled();
  });
});
