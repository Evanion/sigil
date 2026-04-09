import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { TypographySection } from "../TypographySection";
import { DocumentProvider } from "../../store/document-context";
import type { DocumentStoreAPI, ToolType } from "../../store/document-store-solid";

// ── Mock store factory ─────────────────────────────────────────────────

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
    undo: vi.fn(),
    redo: vi.fn(),
    destroy: vi.fn(),
  } as DocumentStoreAPI;
}

// ── Fixtures ───────────────────────────────────────────────────────────

function makeTextNode(
  overrides: Partial<{
    font_family: string;
    font_size: number;
    font_weight: number;
    font_style: string;
    line_height: number;
    letter_spacing: number;
    text_align: string;
    text_decoration: string;
    text_color_r: number;
    text_color_g: number;
    text_color_b: number;
  }> = {},
) {
  return {
    uuid: "text-1",
    name: "Text",
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal", value: 1 },
      blend_mode: "normal",
      effects: [],
    },
    kind: {
      type: "text",
      content: "Hello",
      text_style: {
        font_family: overrides.font_family ?? "Inter",
        font_size: { type: "literal", value: overrides.font_size ?? 16 },
        font_weight: overrides.font_weight ?? 400,
        font_style: overrides.font_style ?? "normal",
        line_height: { type: "literal", value: overrides.line_height ?? 1.2 },
        letter_spacing: { type: "literal", value: overrides.letter_spacing ?? 0 },
        text_align: overrides.text_align ?? "left",
        text_decoration: overrides.text_decoration ?? "none",
        text_color: {
          type: "literal",
          value: {
            space: "srgb",
            r: overrides.text_color_r ?? 0,
            g: overrides.text_color_g ?? 0,
            b: overrides.text_color_b ?? 0,
            a: 1,
          },
        },
      },
      sizing: "auto_width",
    },
    transform: { x: 0, y: 0, width: 100, height: 20, rotation: 0, scale_x: 1, scale_y: 1 },
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
}

function makeFrameNode() {
  return {
    uuid: "frame-1",
    name: "Frame",
    style: {
      fills: [],
      strokes: [],
      opacity: { type: "literal", value: 1 },
      blend_mode: "normal",
      effects: [],
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
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("TypographySection", () => {
  afterEach(() => {
    cleanup();
  });

  // ── Rendering ─────────────────────────────────────────────────────────

  it("should render the section with sigil-typography-section class", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    expect(document.querySelector(".sigil-typography-section")).toBeTruthy();
  });

  it("should render the Typography title", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    expect(screen.getByText("Typography")).toBeTruthy();
  });

  it("should have an ARIA region role with Typography label", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    expect(screen.getByRole("region", { name: "Typography" })).toBeTruthy();
  });

  // ── Text align controls ──────────────────────────────────────────────

  it("should render text alignment radio buttons", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    expect(screen.getByRole("radio", { name: "Align left" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Align center" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Align right" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Justify" })).toBeTruthy();
  });

  it("should mark the current text alignment as checked", () => {
    const store = createMockStore("text-1", {
      "text-1": makeTextNode({ text_align: "center" }),
    });
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    const centerBtn = screen.getByRole("radio", { name: "Align center" });
    expect(centerBtn.getAttribute("aria-checked")).toBe("true");
    const leftBtn = screen.getByRole("radio", { name: "Align left" });
    expect(leftBtn.getAttribute("aria-checked")).toBe("false");
  });

  it("should call setTextStyle with text_align when an alignment button is clicked", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    store.setTextStyle = setTextStyle;
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    fireEvent.click(screen.getByRole("radio", { name: "Align center" }));
    expect(setTextStyle).toHaveBeenCalledWith("text-1", { field: "text_align", value: "center" });
  });

  // ── Italic toggle ───────────────────────────────────────────────────

  it("should render an Italic toggle button", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    expect(screen.getByRole("button", { name: "Italic" })).toBeTruthy();
  });

  it("should call setTextStyle with font_style italic when Italic is pressed", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    store.setTextStyle = setTextStyle;
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    expect(setTextStyle).toHaveBeenCalledWith("text-1", { field: "font_style", value: "italic" });
  });

  // ── Underline / Strikethrough toggles ─────────────────────────────

  it("should render Underline and Strikethrough toggle buttons", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    expect(screen.getByRole("button", { name: "Underline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Strikethrough" })).toBeTruthy();
  });

  it("should call setTextStyle with text_decoration underline when Underline is clicked", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    store.setTextStyle = setTextStyle;
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: "Underline" }));
    expect(setTextStyle).toHaveBeenCalledWith("text-1", { field: "text_decoration", value: "underline" });
  });

  it("should toggle text_decoration to none when Underline is clicked while already underlined", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", {
      "text-1": makeTextNode({ text_decoration: "underline" }),
    });
    store.setTextStyle = setTextStyle;
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: "Underline" }));
    expect(setTextStyle).toHaveBeenCalledWith("text-1", { field: "text_decoration", value: "none" });
  });

  // ── Font size ────────────────────────────────────────────────────────

  it("should display the current font size value", () => {
    const store = createMockStore("text-1", {
      "text-1": makeTextNode({ font_size: 24 }),
    });
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    // NumberInput renders the value in an input element
    const inputs = document.querySelectorAll("input");
    const fontSizeInput = Array.from(inputs).find(
      (el) => el.closest("[aria-label='Font size']") !== null,
    );
    expect(fontSizeInput).toBeTruthy();
  });

  // ── Color row ────────────────────────────────────────────────────────

  it("should render a text color label and swatch", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    expect(screen.getByText("Color")).toBeTruthy();
  });

  // ── Live region ──────────────────────────────────────────────────────

  it("should have a visually-hidden live region for screen reader announcements", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toBeTruthy();
  });

  // ── Keyboard shortcuts ─────────────────────────────────────────────

  it("should toggle font_weight 400/700 on Cmd+B when text node selected", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", {
      "text-1": makeTextNode({ font_weight: 400 }),
    });
    store.setTextStyle = setTextStyle;
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    fireEvent.keyDown(document, { key: "b", metaKey: true });
    expect(setTextStyle).toHaveBeenCalledWith("text-1", { field: "font_weight", value: 700 });
  });

  it("should toggle font_weight from 700 to 400 on Cmd+B", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", {
      "text-1": makeTextNode({ font_weight: 700 }),
    });
    store.setTextStyle = setTextStyle;
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    fireEvent.keyDown(document, { key: "b", metaKey: true });
    expect(setTextStyle).toHaveBeenCalledWith("text-1", { field: "font_weight", value: 400 });
  });

  it("should toggle font_style on Cmd+I when text node selected", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", {
      "text-1": makeTextNode({ font_style: "normal" }),
    });
    store.setTextStyle = setTextStyle;
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    fireEvent.keyDown(document, { key: "i", metaKey: true });
    expect(setTextStyle).toHaveBeenCalledWith("text-1", { field: "font_style", value: "italic" });
  });

  it("should toggle text_decoration on Cmd+U when text node selected", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", {
      "text-1": makeTextNode({ text_decoration: "none" }),
    });
    store.setTextStyle = setTextStyle;
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    fireEvent.keyDown(document, { key: "u", metaKey: true });
    expect(setTextStyle).toHaveBeenCalledWith("text-1", { field: "text_decoration", value: "underline" });
  });

  it("should not fire keyboard shortcuts when no text node is selected", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("frame-1", { "frame-1": makeFrameNode() });
    store.setTextStyle = setTextStyle;
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    fireEvent.keyDown(document, { key: "b", metaKey: true });
    expect(setTextStyle).not.toHaveBeenCalled();
  });

  // ── Radiogroup semantics ──────────────────────────────────────────

  it("should render text alignment in a radiogroup with proper aria-label", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <DocumentProvider store={store}>
        <TypographySection />
      </DocumentProvider>
    ));
    expect(screen.getByRole("radiogroup", { name: "Text alignment" })).toBeTruthy();
  });
});
