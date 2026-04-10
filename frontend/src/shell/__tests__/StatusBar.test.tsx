import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { StatusBar } from "../StatusBar";
import { DocumentProvider } from "../../store/document-context";
import type { DocumentStoreAPI } from "../../store/document-store-solid";
import type { ToolType } from "../../store/document-store-solid";

function createMockStore(overrides?: Partial<DocumentStoreAPI>): DocumentStoreAPI {
  const [activeTool] = createSignal<ToolType>("select");
  const [connected] = createSignal(true);

  return {
    state: {
      info: { name: "Test Doc", page_count: 2, node_count: 5, can_undo: false, can_redo: false },
      pages: [],
      nodes: {},
    },
    selectedNodeId: () => null,
    setSelectedNodeId: vi.fn(),
    selectedNodeIds: () => [],
    isNodeSelected: () => false,
    setSelectedNodeIds: vi.fn(),
    activeTool,
    setActiveTool: vi.fn(),
    viewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: vi.fn(),
    connected,
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
    destroy: vi.fn(),
    ...overrides,
  } as DocumentStoreAPI;
}

describe("StatusBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows connected status text", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <StatusBar />
      </DocumentProvider>
    ));
    expect(screen.getByText("Connected")).toBeTruthy();
  });

  it("shows document info (name, node count, page count)", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <StatusBar />
      </DocumentProvider>
    ));
    expect(screen.getByText("Test Doc")).toBeTruthy();
    expect(screen.getByText("5 nodes")).toBeTruthy();
    expect(screen.getByText("2 pages")).toBeTruthy();
  });

  it("shows zoom percentage", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <StatusBar />
      </DocumentProvider>
    ));
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("has status role without aria-live (RF-008: prevents announcement flooding)", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <StatusBar />
      </DocumentProvider>
    ));
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBeNull();
  });
});
