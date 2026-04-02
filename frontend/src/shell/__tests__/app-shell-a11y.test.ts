/**
 * Accessibility tests for the app shell (RF-001 through RF-023).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mountAppShell } from "../app-shell";
import type { DocumentStore } from "../../store/document-store";

/** Minimal mock store that satisfies the DocumentStore interface. */
function createMockStore(overrides?: Partial<DocumentStore>): DocumentStore {
  return {
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
    subscribe: vi.fn().mockReturnValue(vi.fn()),
    loadInitialState: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    ...overrides,
  };
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

  globalThis.ResizeObserver =
    StubResizeObserver as unknown as typeof ResizeObserver;
}

describe("app-shell accessibility", () => {
  let root: HTMLElement;
  let cleanup: () => void;
  let store: DocumentStore;

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
      expect(canvasContainer?.getAttribute("aria-label")).toBe(
        "Design canvas",
      );
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
