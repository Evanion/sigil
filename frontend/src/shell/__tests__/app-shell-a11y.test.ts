/**
 * Accessibility tests for the app shell (RF-001 through RF-023).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mountAppShell } from "../app-shell";
import type { DocumentStore } from "../../store/document-store";
import type { Subscriber } from "../../store/document-store";

/** Minimal mock store that satisfies the DocumentStore interface. */
function createMockStore(overrides?: Partial<DocumentStore>): DocumentStore & {
  /** Trigger all registered subscribers (simulates a state change). */
  triggerSubscribers: () => void;
  /** Spy for getSelectedNodeId that can be updated. */
  selectedNodeIdValue: string | null;
} {
  const subscribers = new Set<Subscriber>();
  const selectedNodeIdValue: string | null = null;

  const store: DocumentStore & {
    triggerSubscribers: () => void;
    selectedNodeIdValue: string | null;
  } = {
    selectedNodeIdValue,
    triggerSubscribers: () => {
      for (const fn of subscribers) {
        fn();
      }
    },
    getInfo: vi.fn().mockReturnValue(null),
    getAllNodes: vi.fn().mockReturnValue(new Map()),
    getNodeByUuid: vi.fn().mockReturnValue(undefined),
    getPages: vi.fn().mockReturnValue([]),
    isConnected: vi.fn().mockReturnValue(false),
    canUndo: vi.fn().mockReturnValue(false),
    canRedo: vi.fn().mockReturnValue(false),
    sendCommand: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    getSelectedNodeId: vi.fn().mockImplementation(() => store.selectedNodeIdValue),
    select: vi.fn(),
    getActivePage: vi.fn().mockReturnValue(undefined),
    createNode: vi.fn().mockReturnValue("mock-uuid"),
    subscribe: vi.fn().mockImplementation((fn: Subscriber) => {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    }),
    loadInitialState: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    ...overrides,
  };

  return store;
}

/**
 * Stub out canvas getContext and ResizeObserver so the shell can mount
 * without a real browser environment.
 */
function setupDomStubs(): void {
  HTMLCanvasElement.prototype.getContext = vi
    .fn()
    .mockReturnValue(null) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  class StubResizeObserver {
    observe(): void {
      /* noop */
    }
    unobserve(): void {
      /* noop */
    }
    disconnect(): void {
      /* noop */
    }
  }

  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
}

describe("app-shell accessibility", () => {
  let root: HTMLElement;
  let cleanup: () => void;
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    setupDomStubs();
    root = document.createElement("div");
    document.body.appendChild(root);
    store = createMockStore();
    cleanup = mountAppShell(root, store);

    return () => {
      cleanup();
      document.body.removeChild(root);
    };
  });

  // ── RF-001: ARIA landmark roles ──────────────────────────────────

  describe("RF-001: ARIA landmark roles", () => {
    it("should assign role=toolbar and aria-label to the toolbar", () => {
      const toolbar = root.querySelector(".toolbar");
      expect(toolbar).not.toBeNull();
      expect(toolbar?.getAttribute("role")).toBe("toolbar");
      expect(toolbar?.getAttribute("aria-label")).toBe("Tools");
    });

    it("should assign role=complementary and aria-label to the left panel", () => {
      const leftPanel = root.querySelector(".panel--left");
      expect(leftPanel).not.toBeNull();
      expect(leftPanel?.getAttribute("role")).toBe("complementary");
      expect(leftPanel?.getAttribute("aria-label")).toBe("Layers panel");
    });

    it("should assign role=main and aria-label to the canvas container", () => {
      const canvasContainer = root.querySelector(".canvas-container");
      expect(canvasContainer).not.toBeNull();
      expect(canvasContainer?.getAttribute("role")).toBe("main");
      expect(canvasContainer?.getAttribute("aria-label")).toBe("Design canvas");
    });

    it("should assign role=complementary and aria-label to the right panel", () => {
      const rightPanel = root.querySelector(".panel--right");
      expect(rightPanel).not.toBeNull();
      expect(rightPanel?.getAttribute("role")).toBe("complementary");
      expect(rightPanel?.getAttribute("aria-label")).toBe("Properties panel");
    });

    it("should assign role=status and aria-label to the status bar", () => {
      const statusBar = root.querySelector(".status-bar");
      expect(statusBar).not.toBeNull();
      expect(statusBar?.getAttribute("role")).toBe("status");
      expect(statusBar?.getAttribute("aria-label")).toBe("Editor status");
    });
  });

  // ── RF-002: tabindex on focusable regions ─────────────────────────

  describe("RF-002: keyboard focusable regions", () => {
    it("should set tabindex=0 on the toolbar", () => {
      const toolbar = root.querySelector(".toolbar");
      expect(toolbar?.getAttribute("tabindex")).toBe("0");
    });

    it("should set tabindex=0 on the left panel", () => {
      const leftPanel = root.querySelector(".panel--left");
      expect(leftPanel?.getAttribute("tabindex")).toBe("0");
    });

    it("should set tabindex=0 on the right panel", () => {
      const rightPanel = root.querySelector(".panel--right");
      expect(rightPanel?.getAttribute("tabindex")).toBe("0");
    });
  });

  // ── RF-003: canvas aria-label ─────────────────────────────────────

  describe("RF-003: canvas aria-label", () => {
    it("should set aria-label on the canvas element", () => {
      const canvas = root.querySelector("canvas");
      expect(canvas).not.toBeNull();
      expect(canvas?.getAttribute("aria-label")).toBe("Design canvas");
    });
  });

  // ── RF-010: status bar live region and indicator ──────────────────

  describe("RF-010: status bar live region", () => {
    it("should set role=status on the status bar for implicit aria-live", () => {
      const statusBar = root.querySelector(".status-bar");
      expect(statusBar?.getAttribute("role")).toBe("status");
    });

    it("should set aria-hidden=true on the connection indicator dot", () => {
      const indicator = root.querySelector(".status-bar__indicator");
      expect(indicator).not.toBeNull();
      expect(indicator?.getAttribute("aria-hidden")).toBe("true");
    });
  });

  // ── RF-011: aria-pressed on tool buttons ──────────────────────────

  describe("RF-011: aria-pressed on tool buttons", () => {
    it("should set aria-pressed=true on the active tool button", () => {
      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      // Default is select (first button)
      expect(buttons?.[0]?.getAttribute("aria-pressed")).toBe("true");
    });

    it("should set aria-pressed=false on inactive tool buttons", () => {
      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      for (let i = 1; i < (buttons?.length ?? 0); i++) {
        expect(buttons?.[i]?.getAttribute("aria-pressed")).toBe("false");
      }
    });

    it("should update aria-pressed when tool changes", () => {
      // Switch to rectangle tool
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));

      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      // V=false, F=false, R=true, O=false
      expect(buttons?.[0]?.getAttribute("aria-pressed")).toBe("false");
      expect(buttons?.[2]?.getAttribute("aria-pressed")).toBe("true");
    });
  });

  // ── RF-011: semantic heading elements ─────────────────────────────

  describe("RF-011: semantic heading elements", () => {
    it("should use h2 elements for panel headings", () => {
      const headings = root.querySelectorAll("h2.panel__heading");
      expect(headings.length).toBe(2);
    });

    it("should render LAYERS heading as h2", () => {
      const headings = root.querySelectorAll("h2.panel__heading");
      const texts = Array.from(headings).map((h) => h.textContent);
      expect(texts).toContain("LAYERS");
    });

    it("should render PROPERTIES heading as h2", () => {
      const headings = root.querySelectorAll("h2.panel__heading");
      const texts = Array.from(headings).map((h) => h.textContent);
      expect(texts).toContain("PROPERTIES");
    });
  });

  // ── RF-012: roving tabindex on toolbar buttons ────────────────────

  describe("RF-012: roving tabindex on toolbar buttons", () => {
    it("should set tabindex=0 on the active tool button and tabindex=-1 on others", () => {
      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      // Default active = select (first button)
      expect(buttons?.[0]?.getAttribute("tabindex")).toBe("0");
      expect(buttons?.[1]?.getAttribute("tabindex")).toBe("-1");
      expect(buttons?.[2]?.getAttribute("tabindex")).toBe("-1");
      expect(buttons?.[3]?.getAttribute("tabindex")).toBe("-1");
    });

    it("should update roving tabindex when tool changes", () => {
      // Switch to rectangle tool (index 2)
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));

      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      expect(buttons?.[0]?.getAttribute("tabindex")).toBe("-1");
      expect(buttons?.[2]?.getAttribute("tabindex")).toBe("0");
    });

    it("should move focus with ArrowDown within toolbar", () => {
      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      if (!buttons || buttons.length === 0) return;

      // Focus the first button
      (buttons[0] as HTMLElement).focus();

      // Dispatch ArrowDown on the toolbar
      const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
      toolbar?.dispatchEvent(event);

      // The second button should now have tabindex=0
      expect(buttons[1]?.getAttribute("tabindex")).toBe("0");
      expect(buttons[0]?.getAttribute("tabindex")).toBe("-1");
    });

    it("should move focus with ArrowUp within toolbar", () => {
      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      if (!buttons || buttons.length === 0) return;

      // Focus the second button first
      (buttons[0] as HTMLElement).focus();
      // Move to second
      toolbar?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

      // Now move up
      toolbar?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));

      expect(buttons[0]?.getAttribute("tabindex")).toBe("0");
      expect(buttons[1]?.getAttribute("tabindex")).toBe("-1");
    });

    it("should wrap around when pressing ArrowDown on last button", () => {
      const toolbar = root.querySelector(".toolbar");
      const buttons = toolbar?.querySelectorAll(".toolbar__tool-btn");
      if (!buttons || buttons.length === 0) return;

      // Focus the last button
      const lastIndex = buttons.length - 1;
      (buttons[lastIndex] as HTMLElement).focus();
      // Set tabindex correctly for the focused button
      (buttons[lastIndex] as HTMLElement).setAttribute("tabindex", "0");

      toolbar?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

      expect(buttons[0]?.getAttribute("tabindex")).toBe("0");
    });
  });

  // ── RF-013: aria-live announcements ──────────────────────────────

  describe("RF-013: aria-live announcements", () => {
    it("should have a visually-hidden aria-live region", () => {
      const liveRegion = root.querySelector("[aria-live='polite']");
      expect(liveRegion).not.toBeNull();
      expect(liveRegion?.className).toContain("sr-only");
    });

    it("should announce initial tool on mount", () => {
      const liveRegion = root.querySelector("[aria-live='polite']");
      expect(liveRegion?.textContent).toBe("Select tool active");
    });

    it("should announce tool change when switching tools", () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));

      const liveRegion = root.querySelector("[aria-live='polite']");
      expect(liveRegion?.textContent).toBe("Rectangle tool active");
    });

    it("should announce selection change when a node is selected", () => {
      // Mock getNodeByUuid to return a node
      const mockNode = {
        id: { index: 1, generation: 0 },
        uuid: "node-1",
        kind: {
          type: "rectangle" as const,
          corner_radii: [0, 0, 0, 0] as [number, number, number, number],
        },
        name: "Rectangle 1",
        parent: null,
        children: [],
        transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
        style: {
          fills: [],
          strokes: [],
          opacity: { type: "literal" as const, value: 1 },
          blend_mode: "normal" as const,
          effects: [],
        },
        constraints: { horizontal: "start" as const, vertical: "start" as const },
        grid_placement: null,
        visible: true,
        locked: false,
      };
      (store.getNodeByUuid as ReturnType<typeof vi.fn>).mockReturnValue(mockNode);

      // Simulate selection change
      store.selectedNodeIdValue = "node-1";
      store.triggerSubscribers();

      const liveRegion = root.querySelector("[aria-live='polite']");
      expect(liveRegion?.textContent).toBe("Rectangle 1 selected");
    });

    it("should announce when selection is cleared", () => {
      // First select something
      store.selectedNodeIdValue = "node-1";
      (store.getNodeByUuid as ReturnType<typeof vi.fn>).mockReturnValue({
        name: "Rect",
      });
      store.triggerSubscribers();

      // Then clear
      store.selectedNodeIdValue = null;
      store.triggerSubscribers();

      const liveRegion = root.querySelector("[aria-live='polite']");
      expect(liveRegion?.textContent).toBe("Selection cleared");
    });
  });

  // ── RF-020: connection indicator aria-hidden (covered by RF-010) ──

  describe("RF-020: connection indicator aria-hidden", () => {
    it("should keep aria-hidden=true on connection indicator when connected", () => {
      cleanup();
      const connectedStore = createMockStore({
        isConnected: vi.fn().mockReturnValue(true),
      });
      cleanup = mountAppShell(root, connectedStore);

      const indicator = root.querySelector(".status-bar__indicator");
      expect(indicator?.getAttribute("aria-hidden")).toBe("true");
    });
  });

  // ── RF-023: document.title updates ────────────────────────────────

  describe("RF-023: document.title updates", () => {
    it('should set document.title to "Sigil" when no document info', () => {
      expect(document.title).toBe("Sigil");
    });

    it("should set document.title with document name when info is available", () => {
      cleanup();
      const storeWithInfo = createMockStore({
        getInfo: vi.fn().mockReturnValue({
          name: "My Design",
          node_count: 5,
          page_count: 1,
        }),
      });
      cleanup = mountAppShell(root, storeWithInfo);

      expect(document.title).toBe("My Design \u2014 Sigil");
    });
  });
});
