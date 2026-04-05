/**
 * DesignPanel.stories.tsx — Storybook stories for the DesignPanel.
 *
 * Each story wraps a mock DocumentProvider so the panel can read node
 * data and renders the three sub-tabs: Layout, Appearance, Effects.
 */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { DesignPanel } from "./DesignPanel";
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
    },
    selectedNodeId,
    setSelectedNodeId,
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
    undo: () => {},
    redo: () => {},
    destroy: () => {},
  } as DocumentStoreAPI;
}

// ── Sample node factory ────────────────────────────────────────────────

const UUID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function makeNode(styleOverrides: Record<string, unknown> = {}) {
  return {
    id: { index: 0, generation: 0 },
    uuid: UUID,
    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
    name: "Rectangle 1",
    parent: null,
    children: [],
    transform: { x: 100, y: 80, width: 200, height: 150, rotation: 0, scale_x: 1, scale_y: 1 },
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

const meta: Meta<typeof DesignPanel> = {
  title: "Panels/DesignPanel",
  component: DesignPanel,
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
type Story = StoryObj<typeof DesignPanel>;

// ── Stories ────────────────────────────────────────────────────────────

/**
 * Default — Layout tab active with a rectangle node selected.
 * Shows transform fields, corner radius, and constraint editors.
 */
export const Default: Story = {
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
 * Appearance tab — node with two solid fills and a stroke.
 * Demonstrates the fill and stroke list editors.
 */
export const AppearanceTab: Story = {
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
            color: { type: "literal", value: { space: "srgb", r: 1.0, g: 0.2, b: 0.2, a: 0.5 } },
          },
        ],
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
        opacity: { type: "literal", value: 0.9 },
        blend_mode: "normal",
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
 * Effects tab — node with a drop shadow and a layer blur.
 * Demonstrates the effects card list editors.
 */
export const EffectsTab: Story = {
  decorators: [
    (Story) => {
      const node = makeNode({
        effects: [
          {
            type: "drop_shadow",
            color: {
              type: "literal",
              value: { space: "srgb", r: 0.0, g: 0.0, b: 0.0, a: 0.3 },
            },
            offset: { x: 0, y: 4 },
            blur: { type: "literal", value: 8 },
            spread: { type: "literal", value: 0 },
          },
          {
            type: "layer_blur",
            radius: { type: "literal", value: 4 },
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
