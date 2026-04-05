import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { TreeNode } from "./TreeNode";
import { DocumentProvider } from "../store/document-context";
import { AnnounceProvider } from "../shell/AnnounceProvider";
import type { DocumentStoreAPI, ToolType } from "../store/document-store-solid";
import type { DocumentNode } from "../types/document";

// Mock dnd-kit-solid for Storybook (no DragDropProvider needed)
// The story imports TreeNode which uses useDraggable/useDroppable —
// Storybook's vi.mock won't work here, but the DnD hooks will
// no-op gracefully when there's no DragDropProvider ancestor.

function createMockStore(overrides?: Partial<DocumentStoreAPI>): DocumentStoreAPI {
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [activeTool, setActiveTool] = createSignal<ToolType>("select");

  return {
    state: {
      info: { name: "", page_count: 0, node_count: 0, can_undo: false, can_redo: false },
      pages: [],
      nodes: {},
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
    ...overrides,
  } as DocumentStoreAPI;
}

function makeNode(
  uuid: string,
  name: string,
  kindType = "rectangle",
  overrides?: Record<string, unknown>,
): DocumentNode & { parentUuid: string | null; childrenUuids: readonly string[] } {
  return {
    id: { index: 0, generation: 0 },
    uuid,
    kind: { type: kindType, corner_radii: [0, 0, 0, 0] } as DocumentNode["kind"],
    name,
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
  } as DocumentNode & { parentUuid: string | null; childrenUuids: readonly string[] };
}

const meta: Meta<typeof TreeNode> = {
  title: "Panels/TreeNode",
  component: TreeNode,
  tags: ["autodocs"],
  decorators: [
    (Story) => {
      const store = createMockStore();
      return (
        <DocumentProvider store={store}>
          <AnnounceProvider announce={() => {}}>
            <div
              role="tree"
              aria-label="Layers"
              style={{ width: "240px", background: "var(--surface-2, #252525)" }}
            >
              <Story />
            </div>
          </AnnounceProvider>
        </DocumentProvider>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof TreeNode>;

const UUID = "11111111-1111-1111-1111-111111111111";

export const Default: Story = {
  args: {
    node: makeNode(UUID, "Rectangle 1"),
    depth: 0,
    isExpanded: false,
    onToggleExpand: () => {},
    hasChildren: false,
  },
};

export const FrameWithChildren: Story = {
  args: {
    node: makeNode(UUID, "Header Frame", "frame", { childrenUuids: ["a", "b"] }),
    depth: 0,
    isExpanded: true,
    onToggleExpand: () => {},
    hasChildren: true,
  },
};

export const CollapsedParent: Story = {
  args: {
    node: makeNode(UUID, "Card Container", "frame", { childrenUuids: ["a", "b", "c"] }),
    depth: 0,
    isExpanded: false,
    onToggleExpand: () => {},
    hasChildren: true,
  },
};

export const NestedChild: Story = {
  args: {
    node: makeNode(UUID, "Icon", "ellipse"),
    depth: 2,
    isExpanded: false,
    onToggleExpand: () => {},
    hasChildren: false,
  },
};

export const HiddenNode: Story = {
  args: {
    node: makeNode(UUID, "Hidden Layer", "rectangle", { visible: false }),
    depth: 0,
    isExpanded: false,
    onToggleExpand: () => {},
    hasChildren: false,
  },
};

export const LockedNode: Story = {
  args: {
    node: makeNode(UUID, "Locked Background", "rectangle", { locked: true }),
    depth: 0,
    isExpanded: false,
    onToggleExpand: () => {},
    hasChildren: false,
  },
};

export const Focused: Story = {
  args: {
    node: makeNode(UUID, "Focused Item"),
    depth: 0,
    isExpanded: false,
    onToggleExpand: () => {},
    hasChildren: false,
    isFocused: true,
  },
};
