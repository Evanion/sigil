import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTextOverlay, type TextOverlayHandle } from "../text-overlay";
import type { DocumentNode, TextStyle, NodeKindText } from "../../types/document";
import type { Viewport } from "../viewport";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTextStyle(overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    font_family: "Inter",
    font_size: { type: "literal", value: 16 },
    font_weight: 400,
    font_style: "normal",
    line_height: { type: "literal", value: 1.5 },
    letter_spacing: { type: "literal", value: 0 },
    text_align: "left",
    text_decoration: "none",
    text_color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
    ...overrides,
  };
}

function makeTextNode(overrides: Partial<DocumentNode> = {}): DocumentNode {
  const kind: NodeKindText = {
    type: "text",
    content: "Hello world",
    text_style: makeTextStyle(),
    sizing: "auto_width",
  };
  return {
    id: { index: 0, generation: 0 },
    uuid: "test-uuid-1",
    kind,
    name: "Text 1",
    parent: null,
    children: [],
    transform: { x: 100, y: 200, width: 150, height: 40, rotation: 0, scale_x: 1, scale_y: 1 },
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
    ...overrides,
  };
}

function makeViewport(overrides: Partial<Viewport> = {}): Viewport {
  return { x: 0, y: 0, zoom: 1, ...overrides };
}

/**
 * Create a minimal mock canvas element with a parent container.
 * jsdom does not provide real layout so getBoundingClientRect returns zeros.
 */
function createMockCanvas(): HTMLCanvasElement {
  const container = document.createElement("div");
  container.style.position = "relative";
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  document.body.appendChild(container);

  // Mock getBoundingClientRect to return a known rect
  canvas.getBoundingClientRect = () => ({
    x: 10,
    y: 20,
    width: 800,
    height: 600,
    top: 20,
    right: 810,
    bottom: 620,
    left: 10,
    toJSON: () => ({}),
  });

  return canvas;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createTextOverlay", () => {
  let canvas: HTMLCanvasElement;
  let handle: TextOverlayHandle | null;

  beforeEach(() => {
    canvas = createMockCanvas();
    handle = null;
  });

  afterEach(() => {
    if (handle) {
      handle.destroy();
      handle = null;
    }
    // Clean up the container
    if (canvas.parentElement) {
      canvas.parentElement.remove();
    }
  });

  it("should create a contenteditable overlay element appended to canvas parent", () => {
    const node = makeTextNode();
    const vp = makeViewport();

    handle = createTextOverlay(node, vp, canvas);

    expect(handle.element).toBeInstanceOf(HTMLDivElement);
    expect(handle.element.contentEditable).toBe("true");
    expect(handle.element.spellcheck).toBe(false);
    expect(handle.element.parentElement).toBe(canvas.parentElement);
  });

  it("should set ARIA attributes for accessibility", () => {
    const node = makeTextNode();
    const vp = makeViewport();

    handle = createTextOverlay(node, vp, canvas);

    expect(handle.element.getAttribute("role")).toBe("textbox");
    expect(handle.element.getAttribute("aria-multiline")).toBe("true");
    expect(handle.element.getAttribute("aria-label")).toBe("Edit text");
  });

  it("should populate with existing text content", () => {
    const node = makeTextNode();
    const vp = makeViewport();

    handle = createTextOverlay(node, vp, canvas);

    expect(handle.element.textContent).toBe("Hello world");
  });

  it("should apply font styling from TextStyle", () => {
    const node = makeTextNode({
      kind: {
        type: "text",
        content: "Styled",
        text_style: makeTextStyle({
          font_family: "Roboto",
          font_size: { type: "literal", value: 24 },
          font_weight: 700,
          font_style: "italic",
          text_align: "center",
          text_color: {
            type: "literal",
            value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 },
          },
        }),
        sizing: "auto_width",
      },
    });
    const vp = makeViewport();

    handle = createTextOverlay(node, vp, canvas);

    expect(handle.element.style.fontFamily).toBe("Roboto");
    expect(handle.element.style.fontSize).toBe("24px");
    expect(handle.element.style.fontWeight).toBe("700");
    expect(handle.element.style.fontStyle).toBe("italic");
    expect(handle.element.style.textAlign).toBe("center");
  });

  it("should return text content from getContent()", () => {
    const node = makeTextNode();
    const vp = makeViewport();

    handle = createTextOverlay(node, vp, canvas);
    handle.element.textContent = "New content";

    expect(handle.getContent()).toBe("New content");
  });

  it("should return empty string from getContent() when element has no text", () => {
    const node = makeTextNode({
      kind: {
        type: "text",
        content: "",
        text_style: makeTextStyle(),
        sizing: "auto_width",
      },
    });
    const vp = makeViewport();

    handle = createTextOverlay(node, vp, canvas);
    handle.element.textContent = null;

    expect(handle.getContent()).toBe("");
  });

  it("should remove element from DOM on destroy()", () => {
    const node = makeTextNode();
    const vp = makeViewport();

    handle = createTextOverlay(node, vp, canvas);
    const parent = handle.element.parentElement;
    expect(parent).toBeTruthy();

    handle.destroy();
    expect(handle.element.parentElement).toBeNull();
    handle = null; // prevent double-destroy in afterEach
  });

  it("should position the overlay based on viewport transform", () => {
    const node = makeTextNode({
      transform: { x: 50, y: 100, width: 200, height: 30, rotation: 0, scale_x: 1, scale_y: 1 },
    });
    const vp = makeViewport({ x: 10, y: 20, zoom: 2 });

    handle = createTextOverlay(node, vp, canvas);

    // screenX = worldX * zoom + offsetX = 50 * 2 + 10 = 110
    // screenY = worldY * zoom + offsetY = 100 * 2 + 20 = 220
    // screenWidth = width * zoom = 200 * 2 = 400
    // screenHeight = height * zoom = 30 * 2 = 60
    expect(handle.element.style.left).toBe("110px");
    expect(handle.element.style.top).toBe("220px");
    expect(handle.element.style.width).toBe("400px");
    expect(handle.element.style.minHeight).toBe("60px");
  });

  it("should update position when updatePosition is called", () => {
    const node = makeTextNode({
      transform: { x: 50, y: 100, width: 200, height: 30, rotation: 0, scale_x: 1, scale_y: 1 },
    });
    const vp = makeViewport({ x: 0, y: 0, zoom: 1 });

    handle = createTextOverlay(node, vp, canvas);

    expect(handle.element.style.left).toBe("50px");
    expect(handle.element.style.top).toBe("100px");

    const newVp = makeViewport({ x: 10, y: 20, zoom: 2 });
    handle.updatePosition(newVp);

    expect(handle.element.style.left).toBe("110px");
    expect(handle.element.style.top).toBe("220px");
    expect(handle.element.style.width).toBe("400px");
  });

  it("should apply line-height from TextStyle literal value", () => {
    const node = makeTextNode({
      kind: {
        type: "text",
        content: "Test",
        text_style: makeTextStyle({
          line_height: { type: "literal", value: 1.8 },
          font_size: { type: "literal", value: 16 },
        }),
        sizing: "auto_width",
      },
    });
    const vp = makeViewport();

    handle = createTextOverlay(node, vp, canvas);

    // lineHeight = fontSize * lineHeightMultiplier = 16 * 1.8 = 28.8
    expect(handle.element.style.lineHeight).toBe("28.8px");
  });

  it("should apply letter-spacing from TextStyle literal value", () => {
    const node = makeTextNode({
      kind: {
        type: "text",
        content: "Test",
        text_style: makeTextStyle({
          letter_spacing: { type: "literal", value: 2 },
        }),
        sizing: "auto_width",
      },
    });
    const vp = makeViewport();

    handle = createTextOverlay(node, vp, canvas);

    expect(handle.element.style.letterSpacing).toBe("2px");
  });

  it("should apply text-decoration underline", () => {
    const node = makeTextNode({
      kind: {
        type: "text",
        content: "Test",
        text_style: makeTextStyle({ text_decoration: "underline" }),
        sizing: "auto_width",
      },
    });
    const vp = makeViewport();

    handle = createTextOverlay(node, vp, canvas);

    expect(handle.element.style.textDecoration).toBe("underline");
  });

  it("should apply text-decoration strikethrough as line-through", () => {
    const node = makeTextNode({
      kind: {
        type: "text",
        content: "Test",
        text_style: makeTextStyle({ text_decoration: "strikethrough" }),
        sizing: "auto_width",
      },
    });
    const vp = makeViewport();

    handle = createTextOverlay(node, vp, canvas);

    expect(handle.element.style.textDecoration).toBe("line-through");
  });

  it("should handle non-finite viewport values gracefully", () => {
    const node = makeTextNode();
    const vp = makeViewport({ x: NaN, y: Infinity, zoom: NaN });

    handle = createTextOverlay(node, vp, canvas);

    // Non-finite values should fall back to 0 for position, 1 for zoom
    expect(handle.element.style.left).toBe("100px");
    expect(handle.element.style.top).toBe("200px");
  });

  it("should set font-size based on zoom level", () => {
    const node = makeTextNode({
      kind: {
        type: "text",
        content: "Test",
        text_style: makeTextStyle({ font_size: { type: "literal", value: 16 } }),
        sizing: "auto_width",
      },
    });
    const vp = makeViewport({ zoom: 2 });

    handle = createTextOverlay(node, vp, canvas);

    // Font size should be scaled by zoom: 16 * 2 = 32
    expect(handle.element.style.fontSize).toBe("32px");
  });

  it("should clean up event listeners on destroy", () => {
    const node = makeTextNode();
    const vp = makeViewport();

    handle = createTextOverlay(node, vp, canvas);
    const removeEventListenerSpy = vi.spyOn(handle.element, "removeEventListener");

    handle.destroy();

    // Should have called removeEventListener for registered listeners
    expect(removeEventListenerSpy.mock.calls.length).toBeGreaterThan(0);
    handle = null; // prevent double-destroy
  });
});
