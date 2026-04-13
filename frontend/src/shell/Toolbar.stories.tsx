import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { Toolbar } from "./Toolbar";
import { AnnounceProvider } from "./AnnounceProvider";
import { DocumentProvider } from "../store/document-context";
import type { DocumentStoreAPI, ToolType } from "../store/document-store-solid";

function createMockStore(overrides?: Partial<DocumentStoreAPI>): DocumentStoreAPI {
  const [activeTool, setActiveTool] = createSignal<ToolType>("select");

  return {
    state: {
      info: { name: "Untitled", page_count: 1, node_count: 3, can_undo: false, can_redo: false },
      pages: [],
      nodes: {},
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
    undo: () => {},
    redo: () => {},
    flushHistory: () => {},
    destroy: () => {},
    ...overrides,
  } as DocumentStoreAPI;
}

const meta: Meta<typeof Toolbar> = {
  title: "Shell/Toolbar",
  component: Toolbar,
  tags: ["autodocs"],
  decorators: [
    (Story) => {
      const store = createMockStore();
      return (
        <DocumentProvider store={store}>
          <AnnounceProvider announce={() => {}}>
            <div
              style={{ width: "48px", height: "400px", background: "var(--surface-2, #252525)" }}
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
type Story = StoryObj<typeof Toolbar>;

export const Default: Story = {};

export const WithFrameActive: Story = {
  decorators: [
    (Story) => {
      const store = createMockStore();
      store.setActiveTool("frame");
      return (
        <DocumentProvider store={store}>
          <AnnounceProvider announce={() => {}}>
            <div
              style={{ width: "48px", height: "400px", background: "var(--surface-2, #252525)" }}
            >
              <Story />
            </div>
          </AnnounceProvider>
        </DocumentProvider>
      );
    },
  ],
};
