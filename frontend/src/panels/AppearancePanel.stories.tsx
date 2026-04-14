/**
 * AppearancePanel.stories.tsx — Storybook stories for the AppearancePanel.
 *
 * Each story wraps a mock DocumentProvider with sample node data so the
 * panel can read fills, strokes, opacity and blend mode without a live server.
 */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { AppearancePanel } from "./AppearancePanel";
import { DocumentProvider } from "../store/document-context";
import type { DocumentStoreAPI, ToolType } from "../store/document-store-solid";

// ── Mock store factory ─────────────────────────────────────────────────

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
      tokens: {},
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
    createToken: () => {},
    updateToken: () => {},
    deleteToken: () => {},
    resolveToken: () => null,
    destroy: () => {},
  } as DocumentStoreAPI;
}

// ── Sample node factory ────────────────────────────────────────────────

const UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeNode(styleOverrides: Record<string, unknown> = {}) {
  return {
    id: { index: 0, generation: 0 },
    uuid: UUID,
    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
    name: "Rectangle 1",
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 200, height: 150, rotation: 0, scale_x: 1, scale_y: 1 },
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal", value: 1 },
      blend_mode: "normal",
      effects: [],
      ...styleOverrides,
    },
    constraints: { horizontal: "start", vertical: "start" },
    grid_placement: null,
    visible: true,
    locked: false,
    parentUuid: null,
    childrenUuids: [],
  };
}

// ── Meta ───────────────────────────────────────────────────────────────

const meta: Meta<typeof AppearancePanel> = {
  title: "Panels/AppearancePanel",
  component: AppearancePanel,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: "280px", background: "var(--surface-2)" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AppearancePanel>;

// ── Stories ────────────────────────────────────────────────────────────

/**
 * Node with two solid fills — a blue and a red.
 */
export const WithFills: Story = {
  decorators: [
    (Story) => {
      const node = makeNode({
        fills: [
          {
            type: "solid",
            color: { type: "literal", value: { space: "srgb", r: 0.2, g: 0.6, b: 1.0, a: 1.0 } },
          },
          {
            type: "solid",
            color: { type: "literal", value: { space: "srgb", r: 1.0, g: 0.2, b: 0.2, a: 1.0 } },
          },
        ],
      });
      const store = createMockStore(UUID, { [UUID]: node });
      return (
        <DocumentProvider store={store}>
          <Story />
        </DocumentProvider>
      );
    },
  ],
};

/**
 * Node with one stroke — a black 2px inside stroke.
 */
export const WithStrokes: Story = {
  decorators: [
    (Story) => {
      const node = makeNode({
        strokes: [
          {
            color: {
              type: "literal",
              value: { space: "srgb", r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            },
            width: { type: "literal", value: 2 },
            alignment: "inside",
            cap: "butt",
            join: "miter",
          },
        ],
      });
      const store = createMockStore(UUID, { [UUID]: node });
      return (
        <DocumentProvider store={store}>
          <Story />
        </DocumentProvider>
      );
    },
  ],
};

/**
 * Node with no fills or strokes — shows the empty state placeholders.
 */
export const Empty: Story = {
  decorators: [
    (Story) => {
      const node = makeNode();
      const store = createMockStore(UUID, { [UUID]: node });
      return (
        <DocumentProvider store={store}>
          <Story />
        </DocumentProvider>
      );
    },
  ],
};

/**
 * Node with blend_mode "multiply" and opacity 0.7. Shows the Multiply
 * option selected in the blend mode select and 70% in the opacity field.
 */
export const WithBlendMode: Story = {
  decorators: [
    (Story) => {
      const node = makeNode({
        fills: [
          {
            type: "solid",
            color: { type: "literal", value: { space: "srgb", r: 0.4, g: 0.2, b: 0.8, a: 1.0 } },
          },
        ],
        opacity: { type: "literal", value: 0.7 },
        blend_mode: "multiply",
      });
      const store = createMockStore(UUID, { [UUID]: node });
      return (
        <DocumentProvider store={store}>
          <Story />
        </DocumentProvider>
      );
    },
  ],
};

/**
 * No node selected — all controls disabled, empty state visible.
 */
export const NoSelection: Story = {
  decorators: [
    (Story) => {
      const store = createMockStore(null, {});
      return (
        <DocumentProvider store={store}>
          <Story />
        </DocumentProvider>
      );
    },
  ],
};
