import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { DesignPanel } from "../DesignPanel";
import { DocumentProvider } from "../../store/document-context";
import type { DocumentStoreAPI, ToolType } from "../../store/document-store-solid";

function createMockStore(
  selectedId: string | null = null,
  nodes: Record<string, unknown> = {},
): DocumentStoreAPI {
  const [selectedNodeId] = createSignal(selectedId);
  const [activeTool] = createSignal<ToolType>("select");

  return {
    state: {
      info: {
        name: "",
        page_count: 0,
        node_count: 0,
        can_undo: false,
        can_redo: false,
      },
      pages: [],
      nodes,
    },
    selectedNodeId,
    setSelectedNodeId: vi.fn(),
    selectedNodeIds: () => (selectedId ? [selectedId] : []),
    setSelectedNodeIds: vi.fn(),
    activeTool,
    setActiveTool: vi.fn(),
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
    batchSetTransform: vi.fn(),
    groupNodes: vi.fn(),
    ungroupNodes: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    destroy: vi.fn(),
  } as DocumentStoreAPI;
}

describe("DesignPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render three sub-tabs: Layout, Appearance, Effects", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <DesignPanel />
      </DocumentProvider>
    ));
    expect(screen.getByRole("tab", { name: "Layout" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Effects" })).toBeTruthy();
  });

  it("should show Layout tab content by default", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <DesignPanel />
      </DocumentProvider>
    ));
    const layoutTab = screen.getByRole("tab", { name: "Layout" });
    expect(layoutTab.getAttribute("aria-selected")).toBe("true");
    // The SchemaPanel empty state is shown (no node selected)
    expect(screen.getByText(/Select a layer/)).toBeTruthy();
  });

  it("should switch to Appearance tab when clicked", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <DesignPanel />
      </DocumentProvider>
    ));
    const appearanceTab = screen.getByRole("tab", { name: "Appearance" });
    fireEvent.click(appearanceTab);
    expect(appearanceTab.getAttribute("aria-selected")).toBe("true");
    // AppearancePanel renders a region with aria-label "Appearance"
    expect(document.querySelector(".sigil-appearance-panel")).toBeTruthy();
  });

  it("should switch to Effects tab when clicked", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <DesignPanel />
      </DocumentProvider>
    ));
    const effectsTab = screen.getByRole("tab", { name: "Effects" });
    fireEvent.click(effectsTab);
    expect(effectsTab.getAttribute("aria-selected")).toBe("true");
    // EffectsPanel renders a panel with the sigil-effects-panel class
    expect(document.querySelector(".sigil-effects-panel")).toBeTruthy();
  });

  it("should navigate tabs with ArrowRight key", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <DesignPanel />
      </DocumentProvider>
    ));
    const tablist = screen.getByRole("tablist");
    const layoutTab = screen.getByRole("tab", { name: "Layout" });
    layoutTab.focus();
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Appearance" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("should navigate tabs with ArrowLeft key", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <DesignPanel />
      </DocumentProvider>
    ));
    const tablist = screen.getByRole("tablist");
    const appearanceTab = screen.getByRole("tab", { name: "Appearance" });
    fireEvent.click(appearanceTab);
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Layout" }).getAttribute("aria-selected")).toBe("true");
  });

  it("should wrap ArrowRight navigation from last tab to first", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <DesignPanel />
      </DocumentProvider>
    ));
    const tablist = screen.getByRole("tablist");
    const effectsTab = screen.getByRole("tab", { name: "Effects" });
    fireEvent.click(effectsTab);
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Layout" }).getAttribute("aria-selected")).toBe("true");
  });

  it("should wrap ArrowLeft navigation from first tab to last", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <DesignPanel />
      </DocumentProvider>
    ));
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Effects" }).getAttribute("aria-selected")).toBe("true");
  });

  it("should use roving tabindex pattern (active tab has 0, others have -1)", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <DesignPanel />
      </DocumentProvider>
    ));
    const layoutTab = screen.getByRole("tab", { name: "Layout" });
    const appearanceTab = screen.getByRole("tab", { name: "Appearance" });
    const effectsTab = screen.getByRole("tab", { name: "Effects" });
    expect(layoutTab.getAttribute("tabindex")).toBe("0");
    expect(appearanceTab.getAttribute("tabindex")).toBe("-1");
    expect(effectsTab.getAttribute("tabindex")).toBe("-1");
  });

  it("should have a tabpanel with correct role", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <DesignPanel />
      </DocumentProvider>
    ));
    expect(screen.getByRole("tabpanel")).toBeTruthy();
  });
});
