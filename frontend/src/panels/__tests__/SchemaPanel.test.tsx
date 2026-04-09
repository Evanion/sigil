import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { SchemaPanel } from "../SchemaPanel";
import { DocumentProvider } from "../../store/document-context";
import type { DocumentStoreAPI, ToolType } from "../../store/document-store-solid";
import type { PropertySchema } from "../schema/types";

const testSchema: PropertySchema = {
  sections: [
    {
      name: "Transform",
      fields: [
        { key: "transform.x", label: "X", type: "number", step: 1 },
        { key: "transform.y", label: "Y", type: "number", step: 1 },
      ],
    },
    {
      name: "Rectangle Only",
      when: "rectangle",
      fields: [{ key: "kind.corner_radii.0", label: "TL", type: "number" }],
    },
  ],
};

function createMockStore(
  selectedId: string | null = null,
  nodes: Record<string, unknown> = {},
): DocumentStoreAPI {
  const [selectedNodeId] = createSignal(selectedId);
  const [activeTool] = createSignal<ToolType>("select");

  return {
    state: {
      info: {
        name: "",
        page_count: 0,
        node_count: 0,
        can_undo: false,
        can_redo: false,
      },
      pages: [],
      nodes,
    },
    selectedNodeId,
    setSelectedNodeId: vi.fn(),
    selectedNodeIds: () => (selectedId ? [selectedId] : []),
    isNodeSelected: () => false,
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
    setCornerRadii: vi.fn(),
    setTextContent: vi.fn(),
    setTextStyle: vi.fn(),
    batchSetTransform: vi.fn(),
    groupNodes: vi.fn(),
    ungroupNodes: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    destroy: vi.fn(),
  } as DocumentStoreAPI;
}

describe("SchemaPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("should show empty state when no node selected", () => {
    const store = createMockStore(null);
    render(() => (
      <DocumentProvider store={store}>
        <SchemaPanel schema={testSchema} />
      </DocumentProvider>
    ));
    expect(screen.getByText(/Select a layer/)).toBeTruthy();
  });

  it("should render section headings when node is selected", () => {
    const node = {
      id: { index: 0, generation: 0 },
      uuid: "test-uuid",
      kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
      name: "Test",
      parent: null,
      children: [],
      transform: {
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
      },
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
    const store = createMockStore("test-uuid", { "test-uuid": node });
    render(() => (
      <DocumentProvider store={store}>
        <SchemaPanel schema={testSchema} />
      </DocumentProvider>
    ));
    expect(screen.getByText("Transform")).toBeTruthy();
    expect(screen.getByText("Rectangle Only")).toBeTruthy();
  });

  it("should hide sections with non-matching when guard", () => {
    const node = {
      id: { index: 0, generation: 0 },
      uuid: "test-uuid",
      kind: { type: "frame", layout: null },
      name: "Test Frame",
      parent: null,
      children: [],
      transform: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        scale_x: 1,
        scale_y: 1,
      },
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
    const store = createMockStore("test-uuid", { "test-uuid": node });
    render(() => (
      <DocumentProvider store={store}>
        <SchemaPanel schema={testSchema} />
      </DocumentProvider>
    ));
    expect(screen.getByText("Transform")).toBeTruthy();
    expect(screen.queryByText("Rectangle Only")).toBeNull();
  });
});
