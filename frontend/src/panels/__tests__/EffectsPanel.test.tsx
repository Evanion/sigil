import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { EffectsPanel } from "../EffectsPanel";
import { DocumentProvider } from "../../store/document-context";
import type { DocumentStoreAPI, ToolType } from "../../store/document-store-solid";
import type { Effect } from "../../types/document";

function createMockStore(
  selectedId: string | null = null,
  nodes: Record<string, unknown> = {},
): DocumentStoreAPI {
  const [selectedNodeId] = createSignal(selectedId);
  const [activeTool] = createSignal<ToolType>("select");

  return {
    state: {
      info: { name: "", page_count: 0, node_count: 0, can_undo: false, can_redo: false },
      pages: [],
      nodes,
      tokens: {},
    },
    selectedNodeId,
    setSelectedNodeId: vi.fn(),
    selectedNodeIds: () => (selectedId ? [selectedId] : []),
    isNodeSelected: () => false,
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
    createToken: vi.fn(),
    updateToken: vi.fn(),
    deleteToken: vi.fn(),
    renameToken: vi.fn(),
    resolveToken: () => null,
    destroy: vi.fn(),
  } as DocumentStoreAPI;
}

const dropShadowEffect: Effect = {
  type: "drop_shadow",
  color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 0.3 } },
  offset: { x: 0, y: 4 },
  blur: { type: "literal", value: 8 },
  spread: { type: "literal", value: 0 },
};

const nodeWithEffects = {
  uuid: "node-1",
  name: "Frame",
  style: {
    fills: [],
    strokes: [],
    opacity: { type: "literal", value: 1 },
    blend_mode: "normal",
    effects: [dropShadowEffect],
  },
  kind: { type: "frame", layout: null },
  transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
  visible: true,
  locked: false,
  parentUuid: null,
  childrenUuids: [],
  id: { index: 0, generation: 0 },
  parent: null,
  children: [],
  constraints: { horizontal: "start", vertical: "start" },
  grid_placement: null,
};

describe("EffectsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render the panel with sigil-effects-panel class", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <EffectsPanel />
      </DocumentProvider>
    ));
    expect(document.querySelector(".sigil-effects-panel")).toBeTruthy();
  });

  it("should render the Effects section header", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <EffectsPanel />
      </DocumentProvider>
    ));
    expect(screen.getByText("Effects")).toBeTruthy();
  });

  it("should render an add button labeled Add effect", () => {
    const store = createMockStore();
    render(() => (
      <DocumentProvider store={store}>
        <EffectsPanel />
      </DocumentProvider>
    ));
    expect(screen.getByRole("button", { name: "Add effect" })).toBeTruthy();
  });

  it("should show empty state when no node is selected", () => {
    const store = createMockStore(null, {});
    render(() => (
      <DocumentProvider store={store}>
        <EffectsPanel />
      </DocumentProvider>
    ));
    // Add button should be disabled when no selection
    const addBtn = screen.getByRole("button", { name: "Add effect" });
    expect(addBtn).toBeTruthy();
    // With no selection, no effect cards should be present
    expect(document.querySelectorAll(".sigil-effect-card").length).toBe(0);
  });

  it("should render an EffectCard for each effect on the selected node", () => {
    const store = createMockStore("node-1", { "node-1": nodeWithEffects });
    render(() => (
      <DocumentProvider store={store}>
        <EffectsPanel />
      </DocumentProvider>
    ));
    const cards = document.querySelectorAll(".sigil-effect-card");
    expect(cards.length).toBe(1);
  });

  it("should call setEffects with a new default effect when add is clicked", () => {
    const setEffects = vi.fn();
    const store = createMockStore("node-1", { "node-1": nodeWithEffects });
    store.setEffects = setEffects;
    render(() => (
      <DocumentProvider store={store}>
        <EffectsPanel />
      </DocumentProvider>
    ));
    const addBtn = screen.getByRole("button", { name: "Add effect" });
    fireEvent.click(addBtn);
    expect(setEffects).toHaveBeenCalledWith(
      "node-1",
      expect.arrayContaining([dropShadowEffect, expect.objectContaining({ type: "drop_shadow" })]),
    );
  });

  it("should call setEffects with the effect removed when onRemove fires", () => {
    const setEffects = vi.fn();
    const store = createMockStore("node-1", { "node-1": nodeWithEffects });
    store.setEffects = setEffects;
    render(() => (
      <DocumentProvider store={store}>
        <EffectsPanel />
      </DocumentProvider>
    ));
    const removeBtn = screen.getByRole("button", { name: "Remove effect" });
    fireEvent.click(removeBtn);
    expect(setEffects).toHaveBeenCalledWith("node-1", []);
  });

  it("should call setEffects with the updated effects array when onUpdate fires", () => {
    const setEffects = vi.fn();
    const store = createMockStore("node-1", { "node-1": nodeWithEffects });
    store.setEffects = setEffects;
    render(() => (
      <DocumentProvider store={store}>
        <EffectsPanel />
      </DocumentProvider>
    ));
    // Change the type from drop_shadow to layer_blur via the select
    const select = document.querySelector(
      "select.sigil-effect-card__type-select",
    ) as HTMLSelectElement;
    select.value = "layer_blur";
    fireEvent.change(select);
    expect(setEffects).toHaveBeenCalledWith(
      "node-1",
      expect.arrayContaining([expect.objectContaining({ type: "layer_blur" })]),
    );
  });

  it("should move effect up when Alt+ArrowUp is pressed on a focused card", () => {
    const setEffects = vi.fn();
    const twoEffects = [
      dropShadowEffect,
      { type: "layer_blur", radius: { type: "literal", value: 4 } } as Effect,
    ];
    const nodeWith2Effects = {
      ...nodeWithEffects,
      style: { ...nodeWithEffects.style, effects: twoEffects },
    };
    const store = createMockStore("node-1", { "node-1": nodeWith2Effects });
    store.setEffects = setEffects;
    render(() => (
      <DocumentProvider store={store}>
        <EffectsPanel />
      </DocumentProvider>
    ));
    const cards = document.querySelectorAll(".sigil-effect-card");
    const secondCard = cards[1];
    if (!secondCard) throw new Error("Expected second card to exist");
    // Press Alt+ArrowUp on the second card to move it above the first
    fireEvent.keyDown(secondCard, { key: "ArrowUp", altKey: true });
    expect(setEffects).toHaveBeenCalledWith("node-1", [twoEffects[1], twoEffects[0]]);
  });

  it("should move effect down when Alt+ArrowDown is pressed on a focused card", () => {
    const setEffects = vi.fn();
    const twoEffects = [
      dropShadowEffect,
      { type: "layer_blur", radius: { type: "literal", value: 4 } } as Effect,
    ];
    const nodeWith2Effects = {
      ...nodeWithEffects,
      style: { ...nodeWithEffects.style, effects: twoEffects },
    };
    const store = createMockStore("node-1", { "node-1": nodeWith2Effects });
    store.setEffects = setEffects;
    render(() => (
      <DocumentProvider store={store}>
        <EffectsPanel />
      </DocumentProvider>
    ));
    const cards = document.querySelectorAll(".sigil-effect-card");
    const firstCard = cards[0];
    if (!firstCard) throw new Error("Expected first card to exist");
    // Press Alt+ArrowDown on the first card to move it below the second
    fireEvent.keyDown(firstCard, { key: "ArrowDown", altKey: true });
    expect(setEffects).toHaveBeenCalledWith("node-1", [twoEffects[1], twoEffects[0]]);
  });

  // ── RF-013: MAX_EFFECTS enforcement test ──────────────────────────────

  it("test_max_effects_enforced: should not add effect when at maximum (16)", () => {
    const effects: Effect[] = Array.from({ length: 16 }, () => ({
      ...dropShadowEffect,
    }));
    const setEffects = vi.fn();
    const store = createMockStore("node-1", {
      "node-1": {
        ...nodeWithEffects,
        style: { ...nodeWithEffects.style, effects },
      },
    });
    store.setEffects = setEffects;
    render(() => (
      <DocumentProvider store={store}>
        <EffectsPanel />
      </DocumentProvider>
    ));
    // Clear calls from Kobalte NumberField firing onRawValueChange during mount
    setEffects.mockClear();
    const addBtn = screen.getByRole("button", { name: "Add effect" });
    fireEvent.click(addBtn);
    expect(setEffects).not.toHaveBeenCalled();
  });
});
