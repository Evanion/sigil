import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { TransProvider } from "@mbarzda/solid-i18next";
import type { i18n } from "i18next";
import { Toolbar } from "../Toolbar";
import { AnnounceProvider } from "../AnnounceProvider";
import { DocumentProvider } from "../../store/document-context";
import { createTestI18n } from "../../test-utils/i18n";
import type { DocumentStoreAPI } from "../../store/document-store-solid";
import type { ToolType } from "../../store/document-store-solid";

let i18nInstance: i18n;

beforeAll(async () => {
  i18nInstance = await createTestI18n();
});

function createMockStore(overrides?: Partial<DocumentStoreAPI>): DocumentStoreAPI {
  const [activeTool, setActiveTool] = createSignal<ToolType>("select");

  return {
    state: {
      info: { name: "", page_count: 0, node_count: 0, can_undo: false, can_redo: false },
      pages: [],
      nodes: {},
    },
    selectedNodeId: () => null,
    setSelectedNodeId: vi.fn(),
    selectedNodeIds: () => [],
    isNodeSelected: () => false,
    setSelectedNodeIds: vi.fn(),
    activeTool,
    setActiveTool,
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
    ...overrides,
  } as DocumentStoreAPI;
}

/** Wraps component under test with required providers. */
function renderWithProviders(store: DocumentStoreAPI) {
  return render(() => (
    <TransProvider instance={i18nInstance}>
      <DocumentProvider store={store}>
        <AnnounceProvider announce={vi.fn()}>
          <Toolbar />
        </AnnounceProvider>
      </DocumentProvider>
    </TransProvider>
  ));
}

describe("Toolbar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders 5 tool buttons", () => {
    const store = createMockStore();
    renderWithProviders(store);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(5);
  });

  it("marks active tool as pressed (aria-pressed)", () => {
    const store = createMockStore();
    renderWithProviders(store);
    const selectBtn = screen.getByLabelText(/Select/);
    expect(selectBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("has toolbar role with vertical orientation", () => {
    const store = createMockStore();
    renderWithProviders(store);
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.getAttribute("aria-orientation")).toBe("vertical");
  });
});
