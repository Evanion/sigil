import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { TransProvider } from "@mbarzda/solid-i18next";
import type { i18n } from "i18next";
import {
  TypographySection,
  MIN_LINE_HEIGHT,
  MAX_LINE_HEIGHT,
  MIN_LETTER_SPACING,
  MAX_LETTER_SPACING,
} from "../TypographySection";
import { DocumentProvider } from "../../store/document-context";
import { createTestI18n } from "../../test-utils/i18n";
import type { DocumentStoreAPI, ToolType } from "../../store/document-store-solid";

let i18nInstance: i18n;

beforeAll(async () => {
  i18nInstance = await createTestI18n();
});

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
    text_shadow: {
      offset_x: number;
      offset_y: number;
      blur_radius: number;
      color: { type: string; value: { space: string; r: number; g: number; b: number; a: number } };
    } | null;
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
        text_shadow: overrides.text_shadow !== undefined ? overrides.text_shadow : null,
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
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    expect(document.querySelector(".sigil-typography-section")).toBeTruthy();
  });

  it("should render the Typography title", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    expect(screen.getByText("Typography")).toBeTruthy();
  });

  it("should have an ARIA region role with Typography label", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    expect(screen.getByRole("region", { name: "Typography" })).toBeTruthy();
  });

  // ── Text align controls ──────────────────────────────────────────────

  it("should render text alignment radio buttons", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
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
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
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
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    fireEvent.click(screen.getByRole("radio", { name: "Align center" }));
    expect(setTextStyle).toHaveBeenCalledWith("text-1", { field: "text_align", value: "center" });
  });

  // ── Italic toggle ───────────────────────────────────────────────────

  it("should render an Italic toggle button", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    expect(screen.getByRole("button", { name: "Italic" })).toBeTruthy();
  });

  it("should call setTextStyle with font_style italic when Italic is pressed", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    store.setTextStyle = setTextStyle;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    expect(setTextStyle).toHaveBeenCalledWith("text-1", { field: "font_style", value: "italic" });
  });

  // ── Underline / Strikethrough toggles ─────────────────────────────

  it("should render Underline and Strikethrough toggle buttons", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    expect(screen.getByRole("button", { name: "Underline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Strikethrough" })).toBeTruthy();
  });

  it("should call setTextStyle with text_decoration underline when Underline is clicked", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    store.setTextStyle = setTextStyle;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: "Underline" }));
    expect(setTextStyle).toHaveBeenCalledWith("text-1", {
      field: "text_decoration",
      value: "underline",
    });
  });

  it("should toggle text_decoration to none when Underline is clicked while already underlined", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", {
      "text-1": makeTextNode({ text_decoration: "underline" }),
    });
    store.setTextStyle = setTextStyle;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: "Underline" }));
    expect(setTextStyle).toHaveBeenCalledWith("text-1", {
      field: "text_decoration",
      value: "none",
    });
  });

  // ── Font size ────────────────────────────────────────────────────────

  it("should display the current font size value", () => {
    const store = createMockStore("text-1", {
      "text-1": makeTextNode({ font_size: 24 }),
    });
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    // ValueInput renders a combobox with the numeric value as text content.
    const fontSize = screen.getByRole("combobox", { name: "Font size" });
    expect(fontSize).toBeTruthy();
    expect(fontSize.textContent).toContain("24");
  });

  // ── Color row ────────────────────────────────────────────────────────

  it("should render a text color label and swatch", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    expect(screen.getByText("Color")).toBeTruthy();
  });

  // ── Live region ──────────────────────────────────────────────────────

  it("should have a visually-hidden live region for screen reader announcements", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    // TypographySection exposes its own live region alongside ValueInput's
    // internal regions — assert at least one exists.
    const liveRegions = screen.getAllByRole("status");
    expect(liveRegions.length).toBeGreaterThan(0);
  });

  // ── Keyboard shortcuts ─────────────────────────────────────────────

  it("should toggle font_weight 400/700 on Cmd+B when text node selected", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", {
      "text-1": makeTextNode({ font_weight: 400 }),
    });
    store.setTextStyle = setTextStyle;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
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
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
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
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
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
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    fireEvent.keyDown(document, { key: "u", metaKey: true });
    expect(setTextStyle).toHaveBeenCalledWith("text-1", {
      field: "text_decoration",
      value: "underline",
    });
  });

  it("should not fire keyboard shortcuts when no text node is selected", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("frame-1", { "frame-1": makeFrameNode() });
    store.setTextStyle = setTextStyle;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    fireEvent.keyDown(document, { key: "b", metaKey: true });
    expect(setTextStyle).not.toHaveBeenCalled();
  });

  // ── Radiogroup semantics ──────────────────────────────────────────

  it("should render text alignment in a radiogroup with proper aria-label", () => {
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    expect(screen.getByRole("radiogroup", { name: "Text alignment" })).toBeTruthy();
  });

  // ── Shadow toggle and controls ────────────────────────────────────

  it("should call setTextStyle with text_shadow when shadow toggle is clicked on", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", {
      "text-1": makeTextNode({ text_shadow: null }),
    });
    store.setTextStyle = setTextStyle;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    // The toggle button is labeled "Toggle text shadow"
    const toggleBtn = screen.getByRole("button", { name: "Toggle text shadow" });
    fireEvent.click(toggleBtn);
    // Find the specific text_shadow call among all setTextStyle calls
    const shadowCall = setTextStyle.mock.calls.find(
      (c: unknown[]) => (c[1] as { field: string }).field === "text_shadow",
    );
    expect(shadowCall).toBeTruthy();
    // The value should be a TextShadow object (not null) when toggling on
    if (!shadowCall) return;
    const shadowValue = (shadowCall[1] as { value: unknown }).value;
    expect(shadowValue).not.toBeNull();
    expect(shadowValue).toHaveProperty("offset_x");
    expect(shadowValue).toHaveProperty("blur_radius");
  });

  it("should call setTextStyle with null text_shadow when shadow toggle is clicked off", () => {
    const setTextStyle = vi.fn();
    const shadow = {
      offset_x: 0,
      offset_y: 2,
      blur_radius: 4,
      color: { type: "literal" as const, value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
    };
    const store = createMockStore("text-1", {
      "text-1": makeTextNode({ text_shadow: shadow }),
    });
    store.setTextStyle = setTextStyle;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    const toggleBtn = screen.getByRole("button", { name: "Toggle text shadow" });
    fireEvent.click(toggleBtn);
    expect(setTextStyle).toHaveBeenCalledWith("text-1", {
      field: "text_shadow",
      value: null,
    });
  });

  it("should render shadow offset controls when shadow is enabled", () => {
    const shadow = {
      offset_x: 3,
      offset_y: 5,
      blur_radius: 8,
      color: { type: "literal" as const, value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
    };
    const store = createMockStore("text-1", {
      "text-1": makeTextNode({ text_shadow: shadow }),
    });
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    // Shadow controls should be visible
    const shadowGroup = screen.getByRole("group", { name: "Text shadow" });
    expect(shadowGroup).toBeTruthy();
    // Shadow offset X and Y inputs should exist
    expect(shadowGroup.querySelector("[aria-label='Shadow offset X']")).toBeTruthy();
    expect(shadowGroup.querySelector("[aria-label='Shadow offset Y']")).toBeTruthy();
    expect(shadowGroup.querySelector("[aria-label='Shadow blur radius']")).toBeTruthy();
  });

  // ── flushHistory on ValueInput commit ────────────────────────────────

  it("should call flushHistory when the font size ValueInput commits via Enter", () => {
    const flushHistory = vi.fn();
    const store = createMockStore("text-1", { "text-1": makeTextNode({ font_size: 24 }) });
    store.flushHistory = flushHistory;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    const fontSize = screen.getByRole("combobox", { name: "Font size" });
    // Event handlers live on the inner textbox div, not the outer combobox.
    const fontSizeTextbox = fontSize.querySelector('[role="textbox"]') as HTMLElement;
    // Enter fires ValueInput's onCommit which forwards to handleFontSizeCommit
    // → store.flushHistory().
    fireEvent.keyDown(fontSizeTextbox, { key: "Enter" });
    expect(flushHistory).toHaveBeenCalled();
  });

  it("should call flushHistory when the font family ValueInput commits via Enter", () => {
    const flushHistory = vi.fn();
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    store.flushHistory = flushHistory;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    const fontFamily = screen.getByRole("combobox", { name: "Font family" });
    const fontFamilyTextbox = fontFamily.querySelector('[role="textbox"]') as HTMLElement;
    fireEvent.keyDown(fontFamilyTextbox, { key: "Enter" });
    expect(flushHistory).toHaveBeenCalled();
  });

  it("should call flushHistory when the text color ValueInput commits via Enter", () => {
    const flushHistory = vi.fn();
    const store = createMockStore("text-1", { "text-1": makeTextNode() });
    store.flushHistory = flushHistory;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    const textColor = screen.getByRole("combobox", { name: "Text color" });
    const textColorTextbox = textColor.querySelector('[role="textbox"]') as HTMLElement;
    fireEvent.keyDown(textColorTextbox, { key: "Enter" });
    expect(flushHistory).toHaveBeenCalled();
  });

  // ── RF-005: Line-height / letter-spacing range enforcement ──────────
  //
  // These tests verify that the `MIN_LINE_HEIGHT`, `MAX_LINE_HEIGHT`,
  // `MIN_LETTER_SPACING`, and `MAX_LETTER_SPACING` constants are actually
  // enforced by the handler — not just declared. A limit constant without an
  // enforcement test is treated as a bug per CLAUDE.md "Constant Enforcement
  // Tests".

  /**
   * Simulate typing into a ValueInput by setting the inner textbox's textContent
   * and firing an `input` event. This is the same mechanism ValueInput uses
   * internally — `handleInput` reads `inputRef.textContent` (the inner textbox)
   * and calls `props.onChange` with the result.
   *
   * After the flex-container refactor, ValueInput renders:
   *   <div role="combobox">  ← outer; owns ARIA state
   *     <div role="textbox" contenteditable>  ← inner; owns event handlers
   *
   * Setting textContent on the outer combobox destroys the inner textbox (native
   * DOM behaviour: assigning textContent replaces all children with a text node).
   * We therefore find the inner textbox first and operate on it directly.
   */
  function typeIntoCombobox(comboboxEl: HTMLElement, value: string): void {
    const textbox = comboboxEl.querySelector<HTMLElement>('[role="textbox"]') ?? comboboxEl;
    textbox.textContent = value;
    fireEvent.input(textbox);
  }

  it("test_min_line_height_enforced: should reject literal line height below MIN_LINE_HEIGHT", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", { "text-1": makeTextNode({ line_height: 1.5 }) });
    store.setTextStyle = setTextStyle;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    const lineHeight = screen.getByRole("combobox", { name: "Line height" });
    // Below min (0.05 < MIN_LINE_HEIGHT = 0.1) must not reach the store.
    const belowMin = String(MIN_LINE_HEIGHT / 2);
    typeIntoCombobox(lineHeight, belowMin);
    const lineHeightCalls = setTextStyle.mock.calls.filter(
      (c: unknown[]) => (c[1] as { field: string }).field === "line_height",
    );
    expect(lineHeightCalls.length).toBe(0);
  });

  it("test_max_line_height_enforced: should reject literal line height above MAX_LINE_HEIGHT", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", { "text-1": makeTextNode({ line_height: 1.5 }) });
    store.setTextStyle = setTextStyle;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    const lineHeight = screen.getByRole("combobox", { name: "Line height" });
    // Above max (MAX_LINE_HEIGHT + 1 = 11) must not reach the store.
    const aboveMax = String(MAX_LINE_HEIGHT + 1);
    typeIntoCombobox(lineHeight, aboveMax);
    const lineHeightCalls = setTextStyle.mock.calls.filter(
      (c: unknown[]) => (c[1] as { field: string }).field === "line_height",
    );
    expect(lineHeightCalls.length).toBe(0);
  });

  it("should accept a literal line height within [MIN_LINE_HEIGHT, MAX_LINE_HEIGHT]", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", { "text-1": makeTextNode({ line_height: 1.5 }) });
    store.setTextStyle = setTextStyle;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    const lineHeight = screen.getByRole("combobox", { name: "Line height" });
    typeIntoCombobox(lineHeight, "2");
    const lineHeightCalls = setTextStyle.mock.calls.filter(
      (c: unknown[]) => (c[1] as { field: string }).field === "line_height",
    );
    expect(lineHeightCalls.length).toBeGreaterThan(0);
  });

  it("test_min_letter_spacing_enforced: should reject literal letter spacing below MIN_LETTER_SPACING", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", { "text-1": makeTextNode({ letter_spacing: 0 }) });
    store.setTextStyle = setTextStyle;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    const letterSpacing = screen.getByRole("combobox", { name: "Letter spacing" });
    const belowMin = String(MIN_LETTER_SPACING - 1);
    typeIntoCombobox(letterSpacing, belowMin);
    const calls = setTextStyle.mock.calls.filter(
      (c: unknown[]) => (c[1] as { field: string }).field === "letter_spacing",
    );
    expect(calls.length).toBe(0);
  });

  it("test_max_letter_spacing_enforced: should reject literal letter spacing above MAX_LETTER_SPACING", () => {
    const setTextStyle = vi.fn();
    const store = createMockStore("text-1", { "text-1": makeTextNode({ letter_spacing: 0 }) });
    store.setTextStyle = setTextStyle;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    const letterSpacing = screen.getByRole("combobox", { name: "Letter spacing" });
    const aboveMax = String(MAX_LETTER_SPACING + 1);
    typeIntoCombobox(letterSpacing, aboveMax);
    const calls = setTextStyle.mock.calls.filter(
      (c: unknown[]) => (c[1] as { field: string }).field === "letter_spacing",
    );
    expect(calls.length).toBe(0);
  });

  it("should reject shadow blur values above MAX_SHADOW_BLUR", () => {
    const setTextStyle = vi.fn();
    const shadow = {
      offset_x: 0,
      offset_y: 2,
      blur_radius: 4,
      color: { type: "literal" as const, value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
    };
    const store = createMockStore("text-1", {
      "text-1": makeTextNode({ text_shadow: shadow }),
    });
    store.setTextStyle = setTextStyle;
    render(() => (
      <TransProvider instance={i18nInstance}>
        <DocumentProvider store={store}>
          <TypographySection />
        </DocumentProvider>
      </TransProvider>
    ));
    // The blur input is the "Shadow blur radius" NumberInput.
    // Simulate clicking increment many times would eventually hit the max,
    // but we can directly test by finding the blur NumberInput and simulating
    // a value change above 1000.
    // The handleShadowBlurChange function rejects values > MAX_SHADOW_BLUR (1000).
    // We need to get the NumberInput's internal input and fire a change event.
    const blurInput = screen
      .getByRole("group", { name: "Text shadow" })
      .querySelector("[aria-label='Shadow blur radius'] input") as HTMLInputElement | null;
    expect(blurInput).toBeTruthy();
    if (blurInput) {
      // Fire input with a value above 1000
      fireEvent.input(blurInput, { target: { value: "1001" } });
      fireEvent.change(blurInput, { target: { value: "1001" } });
      // The handler should NOT have been called with blur_radius > 1000
      const shadowCalls = setTextStyle.mock.calls.filter(
        (c: unknown[]) => (c[1] as { field: string }).field === "text_shadow",
      );
      for (const call of shadowCalls) {
        const val = (call[1] as { value: { blur_radius: number } | null }).value;
        if (val !== null) {
          expect(val.blur_radius).toBeLessThanOrEqual(1000);
        }
      }
    }
  });
});
