/**
 * Tests for the remote add_font, remove_font, and set_field font_entry handlers
 * in apply-remote.ts (Fonts-1 Task 15b).
 *
 * Uses the same test harness as apply-remote.test.ts — createStore<StoreState> +
 * applyRemoteTransaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import {
  applyRemoteTransaction,
  type RemoteTransactionPayload,
  type RemoteOperationPayload,
  type StoreState,
  type StoreDocumentNode,
} from "../apply-remote";
import type { NodeKind } from "../../types/document";

// ── Node ID placeholder ────────────────────────────────────────────────────────

const PLACEHOLDER_NODE_ID = { index: 0, generation: 0 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRectNode(uuid: string): StoreDocumentNode {
  return {
    id: PLACEHOLDER_NODE_ID,
    uuid,
    kind: {
      type: "rectangle",
      corners: [
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
        { type: "round", radii: { x: 0, y: 0 } },
      ],
    },
    name: "Rect",
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
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
    parentUuid: null,
    childrenUuids: [],
  };
}

/**
 * Make a text node with a minimal text_style.
 * `text_style` is cast through `unknown` because the TypeScript interface
 * still has `font_family` (Task 17 migrates it) but we need to store
 * `font_entry` for the font_entry path tests.
 */
function makeTextNode(uuid: string, fontEntry = ""): StoreDocumentNode {
  const textKind: NodeKind = {
    type: "text",
    content: "Hello",
    text_style: {
      font_family: "Inter",
      font_size: { type: "literal", value: 16 },
      font_weight: 400,
      font_style: "normal",
      line_height: { type: "literal", value: 1.5 },
      letter_spacing: { type: "literal", value: 0 },
      text_align: "left",
      text_decoration: "none",
      text_color: {
        type: "literal",
        value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 },
      },
      // Inject font_entry via type escape (field not yet in TS interface — Task 17)
      ...(fontEntry ? ({ font_entry: fontEntry } as Record<string, unknown>) : {}),
    } as unknown as NodeKind extends { type: "text" } ? NodeKind["text_style"] : never,
  } as unknown as NodeKind;

  return {
    id: PLACEHOLDER_NODE_ID,
    uuid,
    kind: textKind,
    name: "Text",
    parent: null,
    children: [],
    transform: { x: 0, y: 0, width: 200, height: 40, rotation: 0, scale_x: 1, scale_y: 1 },
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
    parentUuid: null,
    childrenUuids: [],
  };
}

function makeFontEntry(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "font-uuid-1",
    family: "Inter",
    postscript_name: "Inter-Regular",
    source: { source: "bundled" },
    metrics: {
      units_per_em: 2048,
      ascent: 1984.0,
      descent: -432.0,
      line_gap: 0.0,
      cap_height: 1456.0,
      x_height: 1082.0,
      italic_angle: 0.0,
      avg_advance: 1000.0,
      panose: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      is_serif: false,
    },
    fs_type: 0,
    embeddable: "reference_system",
    is_variable: false,
    axes: [],
    ...overrides,
  };
}

function makeTx(ops: RemoteOperationPayload[]): RemoteTransactionPayload {
  return {
    transactionId: "tx-fonts",
    userId: "remote-user",
    seq: "1",
    operations: ops,
    eventType: "FONT_UPDATED",
    uuid: null,
  };
}

function makeOp(overrides: Partial<RemoteOperationPayload>): RemoteOperationPayload {
  return {
    id: "op-1",
    nodeUuid: "",
    type: "set_field",
    path: null,
    value: null,
    ...overrides,
  };
}

const LOCAL_USER = "local-user";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("applyRemoteTransaction — font operations", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // ── add_font ─────────────────────────────────────────────────────────────────

  describe("add_font", () => {
    it("should populate fontTable[id] with a valid FontEntry payload", () => {
      createRoot((dispose) => {
        const entry = makeFontEntry({ id: "font-uuid-1", family: "Inter" });
        const [state, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
          tokens: {},
          fontTable: {},
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeOp({ type: "add_font", value: entry })]),
          LOCAL_USER,
          setState,
          () => undefined,
          fetchPages,
        );

        expect(state.fontTable["font-uuid-1"]).toBeDefined();
        expect((state.fontTable["font-uuid-1"] as import("../../types/document").FontEntry).family).toBe("Inter");
        dispose();
      });
    });

    it("should overwrite an existing fontTable entry for the same id (last-writer-wins)", () => {
      createRoot((dispose) => {
        const original = makeFontEntry({ id: "font-uuid-1", family: "OldFamily" });
        const updated = makeFontEntry({ id: "font-uuid-1", family: "NewFamily" });
        const [state, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
          tokens: {},
          fontTable: { "font-uuid-1": original as unknown as import("../../types/document").FontEntry },
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeOp({ type: "add_font", value: updated })]),
          LOCAL_USER,
          setState,
          () => undefined,
          fetchPages,
        );

        expect((state.fontTable["font-uuid-1"] as import("../../types/document").FontEntry).family).toBe("NewFamily");
        dispose();
      });
    });

    it("should warn and leave fontTable unchanged when payload is missing id", () => {
      createRoot((dispose) => {
        const badEntry = makeFontEntry({ id: undefined as unknown as string });
        delete (badEntry as Record<string, unknown>)["id"];
        const [state, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
          tokens: {},
          fontTable: {},
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeOp({ type: "add_font", value: badEntry })]),
          LOCAL_USER,
          setState,
          () => undefined,
          fetchPages,
        );

        expect(Object.keys(state.fontTable)).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("add_font"),
          expect.objectContaining({ value: badEntry }),
        );
        dispose();
      });
    });

    it("should warn and leave fontTable unchanged when payload is missing family", () => {
      createRoot((dispose) => {
        const badEntry = makeFontEntry({ family: "" });
        const [state, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
          tokens: {},
          fontTable: {},
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeOp({ type: "add_font", value: badEntry })]),
          LOCAL_USER,
          setState,
          () => undefined,
          fetchPages,
        );

        expect(Object.keys(state.fontTable)).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("add_font"),
          expect.any(Object),
        );
        dispose();
      });
    });

    it("should warn and leave fontTable unchanged when payload is not an object", () => {
      createRoot((dispose) => {
        const [state, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
          tokens: {},
          fontTable: {},
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeOp({ type: "add_font", value: "not-an-object" })]),
          LOCAL_USER,
          setState,
          () => undefined,
          fetchPages,
        );

        expect(Object.keys(state.fontTable)).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalled();
        dispose();
      });
    });
  });

  // ── remove_font ───────────────────────────────────────────────────────────────

  describe("remove_font", () => {
    it("should delete the entry from fontTable when id matches", () => {
      createRoot((dispose) => {
        const entry = makeFontEntry({ id: "font-to-remove", family: "Inter" });
        const [state, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
          tokens: {},
          fontTable: {
            "font-to-remove": entry as unknown as import("../../types/document").FontEntry,
          },
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeOp({ type: "remove_font", value: { id: "font-to-remove" } })]),
          LOCAL_USER,
          setState,
          () => undefined,
          fetchPages,
        );

        expect(state.fontTable["font-to-remove"]).toBeUndefined();
        dispose();
      });
    });

    it("should leave fontTable unchanged when id does not exist (idempotent)", () => {
      createRoot((dispose) => {
        const entry = makeFontEntry({ id: "other-font", family: "Roboto" });
        const [state, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
          tokens: {},
          fontTable: {
            "other-font": entry as unknown as import("../../types/document").FontEntry,
          },
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeOp({ type: "remove_font", value: { id: "nonexistent-font" } })]),
          LOCAL_USER,
          setState,
          () => undefined,
          fetchPages,
        );

        // The unrelated entry is still present
        expect(state.fontTable["other-font"]).toBeDefined();
        dispose();
      });
    });

    it("should warn and leave fontTable unchanged when payload has no id field", () => {
      createRoot((dispose) => {
        const entry = makeFontEntry({ id: "existing", family: "Inter" });
        const [state, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
          tokens: {},
          fontTable: {
            existing: entry as unknown as import("../../types/document").FontEntry,
          },
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeOp({ type: "remove_font", value: {} })]),
          LOCAL_USER,
          setState,
          () => undefined,
          fetchPages,
        );

        expect(state.fontTable["existing"]).toBeDefined();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("remove_font"),
          expect.any(Object),
        );
        dispose();
      });
    });

    it("should warn and leave fontTable unchanged when payload is not an object", () => {
      createRoot((dispose) => {
        const [, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
          tokens: {},
          fontTable: {},
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeOp({ type: "remove_font", value: null })]),
          LOCAL_USER,
          setState,
          () => undefined,
          fetchPages,
        );

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("remove_font"),
          expect.any(Object),
        );
        dispose();
      });
    });

    it("should warn and leave fontTable unchanged when id is an empty string", () => {
      createRoot((dispose) => {
        const [, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
          tokens: {},
          fontTable: {},
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([makeOp({ type: "remove_font", value: { id: "" } })]),
          LOCAL_USER,
          setState,
          () => undefined,
          fetchPages,
        );

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("remove_font"),
          expect.any(Object),
        );
        dispose();
      });
    });
  });

  // ── set_field kind.text_style.font_entry ──────────────────────────────────────

  describe("set_field kind.text_style.font_entry", () => {
    it("should update text_style.font_entry to a uuid string on a text node", () => {
      createRoot((dispose) => {
        const fontUuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        const textNode = makeTextNode("text-node-1");
        const [state, setState] = createStore<StoreState>({
          nodes: { "text-node-1": textNode },
          pages: [],
          tokens: {},
          fontTable: {},
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeOp({
              type: "set_field",
              nodeUuid: "text-node-1",
              path: "kind.text_style.font_entry",
              value: fontUuid,
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = (state.nodes["text-node-1"] as StoreDocumentNode).kind;
        // Access via Record<string,unknown> because font_entry is not yet in
        // the TypeScript TextStyle interface (awaiting Task 17)
        const textStyle = (kind as unknown as Record<string, unknown>)["text_style"] as Record<
          string,
          unknown
        >;
        expect(textStyle["font_entry"]).toBe(fontUuid);
        dispose();
      });
    });

    it("should warn and leave text_style unchanged when value is not a string", () => {
      createRoot((dispose) => {
        const textNode = makeTextNode("text-node-1");
        const [state, setState] = createStore<StoreState>({
          nodes: { "text-node-1": textNode },
          pages: [],
          tokens: {},
          fontTable: {},
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        const beforeKind = (state.nodes["text-node-1"] as StoreDocumentNode).kind;

        applyRemoteTransaction(
          makeTx([
            makeOp({
              type: "set_field",
              nodeUuid: "text-node-1",
              path: "kind.text_style.font_entry",
              value: 12345, // number, not string
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        // kind should be unchanged (produce was not called with mutation)
        expect((state.nodes["text-node-1"] as StoreDocumentNode).kind).toEqual(beforeKind);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("font_entry"),
          expect.any(Object),
        );
        dispose();
      });
    });

    it("should warn and leave text_style unchanged when value is an empty string", () => {
      createRoot((dispose) => {
        const textNode = makeTextNode("text-node-1");
        const [state, setState] = createStore<StoreState>({
          nodes: { "text-node-1": textNode },
          pages: [],
          tokens: {},
          fontTable: {},
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeOp({
              type: "set_field",
              nodeUuid: "text-node-1",
              path: "kind.text_style.font_entry",
              value: "",
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        const kind = (state.nodes["text-node-1"] as StoreDocumentNode).kind;
        const textStyle = (kind as unknown as Record<string, unknown>)["text_style"] as Record<
          string,
          unknown
        >;
        // font_entry should not be set to an empty string
        expect(textStyle["font_entry"]).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("font_entry"),
          expect.any(Object),
        );
        dispose();
      });
    });

    it("should warn and skip when node is not a text node", () => {
      createRoot((dispose) => {
        const rectNode = makeRectNode("rect-node-1");
        const [state, setState] = createStore<StoreState>({
          nodes: { "rect-node-1": rectNode },
          pages: [],
          tokens: {},
          fontTable: {},
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          makeTx([
            makeOp({
              type: "set_field",
              nodeUuid: "rect-node-1",
              path: "kind.text_style.font_entry",
              value: "some-uuid",
            }),
          ]),
          LOCAL_USER,
          setState,
          (uuid) => state.nodes[uuid],
          fetchPages,
        );

        // rect node kind is unchanged
        expect((state.nodes["rect-node-1"] as StoreDocumentNode).kind.type).toBe("rectangle");
        // No set_field should have modified it
        const kind = (state.nodes["rect-node-1"] as StoreDocumentNode).kind as unknown as Record<string, unknown>;
        expect(kind["text_style"]).toBeUndefined();
        dispose();
      });
    });
  });

  // ── self-echo suppression ─────────────────────────────────────────────────────

  describe("self-echo suppression", () => {
    it("should not apply add_font when userId matches localUserId", () => {
      createRoot((dispose) => {
        const entry = makeFontEntry({ id: "font-uuid-1", family: "Inter" });
        const [state, setState] = createStore<StoreState>({
          nodes: {},
          pages: [],
          tokens: {},
          fontTable: {},
        });
        const fetchPages = vi.fn().mockResolvedValue(undefined);

        applyRemoteTransaction(
          {
            transactionId: "tx-1",
            userId: LOCAL_USER, // same as localUserId
            seq: "1",
            operations: [makeOp({ type: "add_font", value: entry })],
            eventType: "FONT_UPDATED",
            uuid: null,
          },
          LOCAL_USER,
          setState,
          () => undefined,
          fetchPages,
        );

        // Self-echo suppressed — fontTable should remain empty
        expect(Object.keys(state.fontTable)).toHaveLength(0);
        dispose();
      });
    });
  });
});
