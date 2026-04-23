import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { StatusBar } from "./StatusBar";
import { DocumentProvider } from "../store/document-context";
import type { DocumentStoreAPI, ToolType } from "../store/document-store-solid";

function createMockStore(overrides?: Partial<DocumentStoreAPI>): DocumentStoreAPI {
  const [activeTool, setActiveTool] = createSignal<ToolType>("select");

  return {
    state: {
      info: { name: "My Design", page_count: 3, node_count: 42, can_undo: true, can_redo: false },
      pages: [],
      nodes: {},
      tokens: {},
    },
    selectedNodeId: () => null,
    setSelectedNodeId: () => {},
    selectedNodeIds: () => [],
    isNodeSelected: () => false,
    setSelectedNodeIds: () => {},
    activeTool,
    setActiveTool,
    viewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: () => {},
    connected: () => true,
    canUndo: () => true,
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
    undo: () => {},
    redo: () => {},
    flushHistory: () => {},
    createToken: () => {},
    updateToken: () => {},
    deleteToken: () => {},
    renameToken: () => {},
    resolveToken: () => null,
    destroy: () => {},
    ...overrides,
  } as DocumentStoreAPI;
}

const meta: Meta<typeof StatusBar> = {
  title: "Shell/StatusBar",
  component: StatusBar,
  tags: ["autodocs"],
  decorators: [
    (Story) => {
      const store = createMockStore();
      return (
        <DocumentProvider store={store}>
          <div style={{ width: "800px", background: "var(--surface-1, #1e1e1e)" }}>
            <Story />
          </div>
        </DocumentProvider>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof StatusBar>;

export const Connected: Story = {};

export const Disconnected: Story = {
  decorators: [
    (Story) => {
      const store = createMockStore({ connected: () => false });
      return (
        <DocumentProvider store={store}>
          <div style={{ width: "800px", background: "var(--surface-1, #1e1e1e)" }}>
            <Story />
          </div>
        </DocumentProvider>
      );
    },
  ],
};

export const ZoomedIn: Story = {
  decorators: [
    (Story) => {
      const store = createMockStore({ viewport: () => ({ x: 0, y: 0, zoom: 2.5 }) });
      return (
        <DocumentProvider store={store}>
          <div style={{ width: "800px", background: "var(--surface-1, #1e1e1e)" }}>
            <Story />
          </div>
        </DocumentProvider>
      );
    },
  ],
};
