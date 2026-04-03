import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { Toolbar } from "../Toolbar";
import { DocumentProvider } from "../../store/document-context";
import type { DocumentStoreAPI } from "../../store/document-store-solid";
import type { ToolType } from "../../store/document-store-solid";

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
    undo: vi.fn(),
    redo: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  } as DocumentStoreAPI;
}

describe("Toolbar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders 4 tool buttons", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <Toolbar />
      </DocumentProvider>
    ));
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(4);
  });

  it("marks active tool as pressed (aria-pressed)", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <Toolbar />
      </DocumentProvider>
    ));
    const selectBtn = screen.getByLabelText(/Select/);
    expect(selectBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("has toolbar role with vertical orientation", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <Toolbar />
      </DocumentProvider>
    ));
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.getAttribute("aria-orientation")).toBe("vertical");
  });
});
