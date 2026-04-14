/**
 * EffectsPanel.stories.tsx — Storybook stories for the EffectsPanel.
 *
 * Each story wraps a mock DocumentProvider so the panel can read its
 * effects array without a live server.
 */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { EffectsPanel } from "./EffectsPanel";
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

const UUID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeNode(effects: unknown[] = []) {
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
      effects,
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

const meta: Meta<typeof EffectsPanel> = {
  title: "Panels/EffectsPanel",
  component: EffectsPanel,
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
type Story = StoryObj<typeof EffectsPanel>;

// ── Stories ────────────────────────────────────────────────────────────

/**
 * Node with a single drop shadow effect.
 */
export const WithDropShadow: Story = {
  decorators: [
    (Story) => {
      const node = makeNode([
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
      ]);
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
 * Node with two effects — a drop shadow and a layer blur.
 */
export const WithMultipleEffects: Story = {
  decorators: [
    (Story) => {
      const node = makeNode([
        {
          type: "drop_shadow",
          color: {
            type: "literal",
            value: { space: "srgb", r: 0.0, g: 0.0, b: 0.0, a: 0.4 },
          },
          offset: { x: 2, y: 6 },
          blur: { type: "literal", value: 12 },
          spread: { type: "literal", value: 0 },
        },
        {
          type: "layer_blur",
          radius: { type: "literal", value: 4 },
        },
      ]);
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
 * Node with no effects — shows the empty state.
 */
export const Empty: Story = {
  decorators: [
    (Story) => {
      const node = makeNode([]);
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
 * No node selected — add button is disabled.
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
