import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { SchemaPanel } from "./SchemaPanel";
import { DocumentProvider } from "../store/document-context";
import type { DocumentStoreAPI, ToolType } from "../store/document-store-solid";
import type { PropertySchema } from "./schema/types";

function createMockStore(
  selectedUuid: string | null = null,
  nodes: Record<string, unknown> = {},
): DocumentStoreAPI {
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(selectedUuid);
  const [activeTool, setActiveTool] = createSignal<ToolType>("select");

  return {
    state: {
      info: { name: "", page_count: 0, node_count: 0, can_undo: false, can_redo: false },
      pages: [],
      nodes,
    },
    selectedNodeId,
    setSelectedNodeId,
    selectedNodeIds: () => {
      const id = selectedNodeId();
      return id ? [id] : [];
    },
    setSelectedNodeIds: () => {},
    activeTool,
    setActiveTool,
    viewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: () => {},
    connected: () => true,
    canUndo: () => false,
    canRedo: () => false,
    createNode: () => "",
    setTransform: () => {},
    renameNode: () => {},
    deleteNode: () => {},
    setVisible: () => {},
    setLocked: () => {},
    reparentNode: () => {},
    reorderChildren: () => {},
    setOpacity: () => {},
    setBlendMode: () => {},
    setFills: () => {},
    setStrokes: () => {},
    setEffects: () => {},
    setCornerRadii: () => {},
    setTextContent: () => {},
    setTextStyle: () => {},
    batchSetTransform: () => {},
    groupNodes: () => {},
    ungroupNodes: () => {},
    createPage: () => {},
    deletePage: () => {},
    renamePage: () => {},
    reorderPages: () => {},
    setActivePage: () => {},
    activePageId: () => null,
    isNodeSelected: () => false,
    undo: () => {},
    redo: () => {},
    flushHistory: () => {},
    destroy: () => {},
  } as DocumentStoreAPI;
}

const UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const sampleNode = {
  id: { index: 0, generation: 0 },
  uuid: UUID,
  kind: { type: "rectangle", corner_radii: [8, 8, 8, 8] },
  name: "Blue Card",
  parent: null,
  children: [],
  transform: { x: 120, y: 80, width: 200, height: 150, rotation: 0, scale_x: 1, scale_y: 1 },
  style: {
    fills: [
      {
        type: "solid",
        color: { type: "literal", value: { space: "srgb", r: 0.05, g: 0.6, b: 1.0, a: 1.0 } },
      },
    ],
    strokes: [],
    opacity: { type: "literal", value: 0.9 },
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

const designSchema: PropertySchema = {
  sections: [
    {
      name: "Node",
      fields: [
        { key: "name", label: "Name", type: "text", span: 2 },
        { key: "visible", label: "Visible", type: "toggle" },
        { key: "locked", label: "Locked", type: "toggle" },
      ],
    },
    {
      name: "Transform",
      fields: [
        { key: "transform.x", label: "X", type: "number", step: 1 },
        { key: "transform.y", label: "Y", type: "number", step: 1 },
        { key: "transform.width", label: "W", type: "number", step: 1, min: 0 },
        { key: "transform.height", label: "H", type: "number", step: 1, min: 0 },
        { key: "transform.rotation", label: "R", type: "number", step: 0.1, suffix: "deg" },
      ],
    },
  ],
};

const meta: Meta<typeof SchemaPanel> = {
  title: "Panels/SchemaPanel",
  component: SchemaPanel,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: "280px", background: "var(--surface-2, #252525)" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SchemaPanel>;

export const NoSelection: Story = {
  args: { schema: designSchema },
  decorators: [
    (Story) => {
      const store = createMockStore();
      return (
        <DocumentProvider store={store}>
          <Story />
        </DocumentProvider>
      );
    },
  ],
};

export const WithSelectedNode: Story = {
  args: { schema: designSchema },
  decorators: [
    (Story) => {
      const store = createMockStore(UUID, { [UUID]: sampleNode });
      return (
        <DocumentProvider store={store}>
          <Story />
        </DocumentProvider>
      );
    },
  ],
};
