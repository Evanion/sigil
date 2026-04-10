/**
 * AlignPanel.stories.tsx — Storybook stories for the AlignPanel.
 *
 * Stories cover the three meaningful selection states:
 * - 2 nodes: align buttons enabled, distribute buttons disabled
 * - 3+ nodes: align and distribute buttons both enabled
 * - 1 node: panel not shown (nothing rendered)
 */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { AlignPanel } from "./AlignPanel";
import { DocumentProvider } from "../store/document-context";
import type { DocumentStoreAPI, ToolType } from "../store/document-store-solid";

// ── Mock store factory ─────────────────────────────────────────────────

function createMockStore(
  selectedUuids: string[],
  nodes: Record<string, unknown>,
): DocumentStoreAPI {
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(selectedUuids[0] ?? null);
  const [activeTool, setActiveTool] = createSignal<ToolType>("select");

  return {
    state: {
      info: { name: "", page_count: 0, node_count: 0, can_undo: false, can_redo: false },
      pages: [],
      nodes,
    },
    selectedNodeId,
    setSelectedNodeId,
    selectedNodeIds: () => selectedUuids,
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
    destroy: () => {},
  } as DocumentStoreAPI;
}

// ── Node factory ────────────────────────────────────────────────────────

function makeNode(uuid: string, x: number, y: number) {
  return {
    id: { index: 0, generation: 0 },
    uuid,
    kind: { type: "rectangle", corner_radii: [0, 0, 0, 0] },
    name: `Rectangle ${uuid}`,
    parent: null,
    children: [],
    transform: { x, y, width: 100, height: 80, rotation: 0, scale_x: 1, scale_y: 1 },
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

const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const UUID_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// ── Meta ───────────────────────────────────────────────────────────────

const meta: Meta<typeof AlignPanel> = {
  title: "Panels/AlignPanel",
  component: AlignPanel,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: "280px", background: "var(--surface-2)", padding: "8px" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AlignPanel>;

// ── Stories ────────────────────────────────────────────────────────────

/**
 * Two nodes selected: alignment buttons enabled, distribute buttons disabled.
 */
export const TwoNodesSelected: Story = {
  decorators: [
    (Story) => {
      const nodes = {
        [UUID_A]: makeNode(UUID_A, 10, 10),
        [UUID_B]: makeNode(UUID_B, 200, 50),
      };
      const store = createMockStore([UUID_A, UUID_B], nodes);
      return (
        <DocumentProvider store={store}>
          <Story />
        </DocumentProvider>
      );
    },
  ],
};

/**
 * Three nodes selected: alignment and distribute buttons both enabled.
 */
export const ThreeNodesSelected: Story = {
  decorators: [
    (Story) => {
      const nodes = {
        [UUID_A]: makeNode(UUID_A, 10, 10),
        [UUID_B]: makeNode(UUID_B, 200, 50),
        [UUID_C]: makeNode(UUID_C, 400, 100),
      };
      const store = createMockStore([UUID_A, UUID_B, UUID_C], nodes);
      return (
        <DocumentProvider store={store}>
          <Story />
        </DocumentProvider>
      );
    },
  ],
};

/**
 * One node selected: panel is not shown (nothing rendered).
 */
export const OneNodeSelected: Story = {
  decorators: [
    (Story) => {
      const nodes = {
        [UUID_A]: makeNode(UUID_A, 10, 10),
      };
      const store = createMockStore([UUID_A], nodes);
      return (
        <DocumentProvider store={store}>
          <Story />
        </DocumentProvider>
      );
    },
  ],
};
