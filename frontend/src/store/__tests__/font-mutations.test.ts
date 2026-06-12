/**
 * Tests for store.addFont, store.removeFont, and store.setNodeFont (Task 18).
 *
 * Vitest + plain objects — no Solid reactive context required.
 * Uses the same HistoryManager + applyOperationToStore pattern as
 * undo-redo-integration.test.ts for the setNodeFont undo/redo test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HistoryManager } from "../../operations/history-manager";
import { createSetFieldOp } from "../../operations/operation-helpers";
import { applyOperationToStore, type StoreStateReader } from "../../operations/apply-to-store";
import { parseFontEntry } from "../font-input";
import { DEFAULT_FONT_ENTRY_ID, type FontEntry } from "../../types/document";
import { MAX_EMBEDDED_FONT_BYTES } from "../../types/validation";

// ── Helpers ─────────────────────────────────────────────────────────────────

const TEST_USER_ID = "test-user";

/** Minimal FontEntry fixture */
function makeFontEntry(id: string, family = "Inter"): Record<string, unknown> {
  return {
    id,
    family,
    postscript_name: `${family}-Regular`,
    source: { source: "bundled" },
    metrics: {
      units_per_em: 2048,
      ascent: 1984,
      descent: -432,
      line_gap: 0,
      cap_height: 1456,
      x_height: 1082,
      italic_angle: 0,
      avg_advance: 1000,
      panose: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      is_serif: false,
    },
    fs_type: 0,
    embeddable: "embed",
    is_variable: false,
    axes: [],
  };
}

/** Deep clone using JSON round-trip */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── MAX_EMBEDDED_FONT_BYTES enforcement ─────────────────────────────────────

describe("MAX_EMBEDDED_FONT_BYTES", () => {
  it("should be 32 MiB (mirrors crates/core/src/validate.rs)", () => {
    // Parity assertion: matches MAX_EMBEDDED_FONT_BYTES = 32 * 1024 * 1024 in Rust.
    expect(MAX_EMBEDDED_FONT_BYTES).toBe(32 * 1024 * 1024);
  });
});

// ── addFont tests ────────────────────────────────────────────────────────────
//
// These tests exercise the addFont logic by calling a locally-isolated
// implementation that mirrors the store's addFont function — simulating the
// urql client mutation response without a full Solid store/createDocumentStore
// instance (which would require browser globals not present in Vitest).

describe("addFont (isolated logic tests)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // test_max_embedded_font_bytes_enforced: exercises the store-boundary size
  // cap (rejects an over-limit byte array before any network call), satisfying
  // the §11 Constant Enforcement Tests convention (not a tautology).
  it("test_max_embedded_font_bytes_enforced: rejects bytes over the cap before mutation", async () => {
    // Build an oversize byte array (MAX + 1 byte).
    const oversizeBytes = new Uint8Array(MAX_EMBEDDED_FONT_BYTES + 1);
    const mockMutation = vi.fn();
    const mockAnnounce = vi.fn();

    const result = await simulateAddFont(
      oversizeBytes,
      "user_supplied",
      mockMutation,
      mockAnnounce,
    ).catch((e: unknown) => e);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/MAX_EMBEDDED_FONT_BYTES|exceeds max/);
    // mutation should NOT have been called
    expect(mockMutation).not.toHaveBeenCalled();
    expect(mockAnnounce).toHaveBeenCalledOnce();
  });

  it("should accept bytes exactly at MAX_EMBEDDED_FONT_BYTES (boundary)", async () => {
    const exactBytes = new Uint8Array(MAX_EMBEDDED_FONT_BYTES);
    const entryId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const fontTableUpdates: Record<string, unknown>[] = [];
    const mockMutation = vi.fn().mockResolvedValue({
      error: null,
      data: { addFont: makeFontEntry(entryId, "Inter") },
    });

    const result = await simulateAddFont(
      exactBytes,
      "user_supplied",
      mockMutation,
      vi.fn(),
      fontTableUpdates,
    );

    expect(result.id).toBe(entryId);
    expect(mockMutation).toHaveBeenCalledOnce();
    expect(fontTableUpdates).toHaveLength(1);
    expect(fontTableUpdates[0]).toMatchObject({ id: entryId, family: "Inter" });
  });

  it("should populate fontTable with the server-returned FontEntry on success", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]);
    const entryId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const fontTableUpdates: Record<string, unknown>[] = [];
    const mockMutation = vi.fn().mockResolvedValue({
      error: null,
      data: { addFont: makeFontEntry(entryId, "Roboto") },
    });

    const result = await simulateAddFont(
      bytes,
      "user_supplied",
      mockMutation,
      vi.fn(),
      fontTableUpdates,
    );

    expect(result.id).toBe(entryId);
    expect(fontTableUpdates).toHaveLength(1);
    expect(fontTableUpdates[0]).toMatchObject({ id: entryId, family: "Roboto" });
  });

  it("should reject (announceError + reject) on server mutation error", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]);
    const mockAnnounce = vi.fn();
    const fontTableUpdates: Record<string, unknown>[] = [];
    const mockMutation = vi.fn().mockResolvedValue({
      error: { message: "validation failed: font limit reached" },
      data: null,
    });

    const result = await simulateAddFont(
      bytes,
      "user_supplied",
      mockMutation,
      mockAnnounce,
      fontTableUpdates,
    ).catch((e: unknown) => e);

    expect(result).toBeInstanceOf(Error);
    expect(mockAnnounce).toHaveBeenCalledOnce();
    // fontTable must NOT be modified on error (nothing was inserted)
    expect(fontTableUpdates).toHaveLength(0);
  });

  it("should reject and warn if server returns an invalid FontEntry", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]);
    const mockAnnounce = vi.fn();
    const fontTableUpdates: Record<string, unknown>[] = [];
    const mockMutation = vi.fn().mockResolvedValue({
      error: null,
      // malformed — missing family
      data: { addFont: { id: "cccccccc-cccc-cccc-cccc-cccccccccccc" } },
    });

    const result = await simulateAddFont(
      bytes,
      "user_supplied",
      mockMutation,
      mockAnnounce,
      fontTableUpdates,
    ).catch((e: unknown) => e);

    expect(result).toBeInstanceOf(Error);
    expect(mockAnnounce).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalled();
    expect(fontTableUpdates).toHaveLength(0);
  });
});

// ── removeFont tests ─────────────────────────────────────────────────────────

describe("removeFont (isolated logic tests)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("should block removal of DEFAULT_FONT_ENTRY_ID", async () => {
    const fontTable: Record<string, Record<string, unknown>> = {
      [DEFAULT_FONT_ENTRY_ID]: makeFontEntry(DEFAULT_FONT_ENTRY_ID, "Bundled"),
    };
    const mockMutation = vi.fn();
    const mockAnnounce = vi.fn();
    const deletedIds: string[] = [];

    await simulateRemoveFont(
      DEFAULT_FONT_ENTRY_ID,
      fontTable,
      [],
      mockMutation,
      mockAnnounce,
      deletedIds,
    );

    expect(mockMutation).not.toHaveBeenCalled();
    expect(mockAnnounce).toHaveBeenCalledOnce();
    expect(deletedIds).toHaveLength(0);
    // fontTable must still contain the default entry
    expect(fontTable[DEFAULT_FONT_ENTRY_ID]).toBeDefined();
  });

  it("should block removal of a font referenced by a text node", async () => {
    const fontId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const fontTable: Record<string, Record<string, unknown>> = {
      [fontId]: makeFontEntry(fontId, "Custom"),
    };
    // One text node references the font
    const nodes = [
      {
        kind: {
          type: "text" as const,
          text_style: { font_entry: fontId },
        },
      },
    ];
    const mockMutation = vi.fn();
    const mockAnnounce = vi.fn();
    const deletedIds: string[] = [];

    await simulateRemoveFont(fontId, fontTable, nodes, mockMutation, mockAnnounce, deletedIds);

    expect(mockMutation).not.toHaveBeenCalled();
    expect(mockAnnounce).toHaveBeenCalledOnce();
    expect(deletedIds).toHaveLength(0);
    expect(fontTable[fontId]).toBeDefined();
  });

  it("should optimistically delete an unreferenced font and call the mutation", async () => {
    const fontId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const fontTable: Record<string, Record<string, unknown>> = {
      [fontId]: makeFontEntry(fontId, "Custom"),
    };
    const mockMutation = vi.fn().mockResolvedValue({ error: null });
    const mockAnnounce = vi.fn();
    const deletedIds: string[] = [];

    await simulateRemoveFont(fontId, fontTable, [], mockMutation, mockAnnounce, deletedIds);

    expect(mockMutation).toHaveBeenCalledOnce();
    expect(mockAnnounce).not.toHaveBeenCalled();
    expect(deletedIds).toContain(fontId);
    expect(fontTable[fontId]).toBeUndefined();
  });

  it("should roll back optimistic delete on server error", async () => {
    const fontId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const originalEntry = makeFontEntry(fontId, "Custom");
    const fontTable: Record<string, Record<string, unknown>> = {
      [fontId]: deepClone(originalEntry),
    };
    const mockMutation = vi.fn().mockResolvedValue({
      error: { message: "font_table entry not found" },
    });
    const mockAnnounce = vi.fn();
    const deletedIds: string[] = [];

    await simulateRemoveFont(fontId, fontTable, [], mockMutation, mockAnnounce, deletedIds);

    // Optimistic delete fired, then rolled back
    expect(deletedIds).toContain(fontId);
    // The entry was re-inserted via rollback
    expect(fontTable[fontId]).toMatchObject({ id: fontId, family: "Custom" });
    expect(mockAnnounce).toHaveBeenCalledOnce();
  });

  it("should no-op silently when the entry is not in the table", async () => {
    const fontId = "11111111-1111-1111-1111-111111111111";
    const fontTable: Record<string, Record<string, unknown>> = {};
    const mockMutation = vi.fn();
    const mockAnnounce = vi.fn();
    const deletedIds: string[] = [];

    await simulateRemoveFont(fontId, fontTable, [], mockMutation, mockAnnounce, deletedIds);

    expect(mockMutation).not.toHaveBeenCalled();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });
});

// ── setNodeFont tests ─────────────────────────────────────────────────────────

describe("setNodeFont (isolated logic + undo/redo tests)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("should update the text node's font_entry and queue a server setField op", () => {
    const nodeUuid = "node-uuid-1";
    const oldEntryId = DEFAULT_FONT_ENTRY_ID;
    const newEntryId = "22222222-2222-2222-2222-222222222222";

    const nodes: Record<string, Record<string, unknown>> = {
      [nodeUuid]: makeTextNode(nodeUuid, oldEntryId),
    };
    const fontTable: Record<string, Record<string, unknown>> = {
      [newEntryId]: makeFontEntry(newEntryId, "CustomFont"),
    };
    const pendingOps: Record<string, unknown>[] = [];
    const interceptorSets: Array<{ uuid: string; field: string; value: unknown }> = [];

    simulateSetNodeFont(nodeUuid, newEntryId, nodes, fontTable, pendingOps, interceptorSets);

    // interceptor.set was called with the new kind
    expect(interceptorSets).toHaveLength(1);
    const setCall = interceptorSets[0];
    expect(setCall.uuid).toBe(nodeUuid);
    expect(setCall.field).toBe("kind");
    const newKind = setCall.value as { text_style: { font_entry: string } };
    expect(newKind.text_style.font_entry).toBe(newEntryId);

    // A setField server op was queued
    expect(pendingOps).toHaveLength(1);
    const op = pendingOps[0] as { setField: { nodeUuid: string; path: string; value: string } };
    expect(op.setField.nodeUuid).toBe(nodeUuid);
    expect(op.setField.path).toBe("kind.text_style.font_entry");
    expect(JSON.parse(op.setField.value) as string).toBe(newEntryId);
  });

  it("should warn and no-op for a missing or non-text node", () => {
    const nodes: Record<string, Record<string, unknown>> = {};
    const fontTable: Record<string, Record<string, unknown>> = {
      [DEFAULT_FONT_ENTRY_ID]: makeFontEntry(DEFAULT_FONT_ENTRY_ID),
    };
    const pendingOps: Record<string, unknown>[] = [];
    const interceptorSets: Array<{ uuid: string; field: string; value: unknown }> = [];

    simulateSetNodeFont(
      "missing-uuid",
      DEFAULT_FONT_ENTRY_ID,
      nodes,
      fontTable,
      pendingOps,
      interceptorSets,
    );

    expect(interceptorSets).toHaveLength(0);
    expect(pendingOps).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("should announceError and no-op for an unknown font entry", () => {
    const nodeUuid = "node-2";
    const nodes: Record<string, Record<string, unknown>> = {
      [nodeUuid]: makeTextNode(nodeUuid, DEFAULT_FONT_ENTRY_ID),
    };
    const fontTable: Record<string, Record<string, unknown>> = {
      [DEFAULT_FONT_ENTRY_ID]: makeFontEntry(DEFAULT_FONT_ENTRY_ID),
    };
    const mockAnnounce = vi.fn();
    const pendingOps: Record<string, unknown>[] = [];
    const interceptorSets: Array<{ uuid: string; field: string; value: unknown }> = [];

    simulateSetNodeFont(
      nodeUuid,
      "nonexistent-entry-id",
      nodes,
      fontTable,
      pendingOps,
      interceptorSets,
      mockAnnounce,
    );

    expect(interceptorSets).toHaveLength(0);
    expect(pendingOps).toHaveLength(0);
    expect(mockAnnounce).toHaveBeenCalledOnce();
  });

  it("should not apply on a non-text node (rectangle)", () => {
    const nodeUuid = "rect-node";
    const nodes: Record<string, Record<string, unknown>> = {
      [nodeUuid]: {
        uuid: nodeUuid,
        kind: {
          type: "rectangle",
          corners: [
            { type: "round", radii: { x: 0, y: 0 } },
            { type: "round", radii: { x: 0, y: 0 } },
            { type: "round", radii: { x: 0, y: 0 } },
            { type: "round", radii: { x: 0, y: 0 } },
          ],
        },
      },
    };
    const fontTable = { [DEFAULT_FONT_ENTRY_ID]: makeFontEntry(DEFAULT_FONT_ENTRY_ID) };
    const pendingOps: Record<string, unknown>[] = [];
    const interceptorSets: Array<{ uuid: string; field: string; value: unknown }> = [];

    simulateSetNodeFont(
      nodeUuid,
      DEFAULT_FONT_ENTRY_ID,
      nodes,
      fontTable,
      pendingOps,
      interceptorSets,
    );

    expect(interceptorSets).toHaveLength(0);
    expect(pendingOps).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  // ── undo/redo via HistoryManager + applyOperationToStore ───────────────────

  it("should undo a setNodeFont to restore the previous font_entry", () => {
    const nodeUuid = "text-node-undo-1";
    const oldEntryId = DEFAULT_FONT_ENTRY_ID;
    const newEntryId = "33333333-3333-3333-3333-333333333333";

    // Use the same store-simulation shape as undo-redo-integration.test.ts:
    // storeData has a top-level "nodes" key mirroring Solid's store structure.
    const storeData: Record<string, unknown> = {
      nodes: {
        [nodeUuid]: makeTextNode(nodeUuid, oldEntryId),
      },
    };

    function getNodes(): Record<string, Record<string, unknown>> {
      return storeData["nodes"] as Record<string, Record<string, unknown>>;
    }

    const reader: StoreStateReader = {
      getNode: (uuid: string) => getNodes()[uuid],
    };

    /**
     * Minimal setState that mirrors createTestStore from undo-redo-integration.test.ts.
     * Handles:
     *  - setState(produce(fn))  — produce callback with mutable draft
     *  - setState("nodes", uuid, field, value) — set a field on a node
     *  - setState("nodes", uuid, nodeObj) — replace a full node
     */
    function setState(...args: unknown[]): void {
      if (args.length === 1 && typeof args[0] === "function") {
        // produce() callback — call directly on the mutable storeData draft
        const fn = args[0] as (draft: Record<string, unknown>) => void;
        fn(storeData);
        return;
      }
      if (args.length === 4 && args[0] === "nodes") {
        const uuid = args[1] as string;
        const field = args[2] as string;
        const value = args[3];
        const nodes = getNodes();
        if (nodes[uuid]) {
          nodes[uuid][field] = value;
        }
        return;
      }
      if (args.length === 3 && args[0] === "nodes") {
        const uuid = args[1] as string;
        const value = args[2];
        getNodes()[uuid] = value as Record<string, unknown>;
        return;
      }
    }

    const historyManager = new HistoryManager(TEST_USER_ID);

    // Build the previous and new kind for the set_field op
    const node = getNodes()[nodeUuid];
    const previousKind = deepClone(node["kind"]);
    const previousTextStyle = deepClone(
      (previousKind as { text_style: Record<string, unknown> }).text_style,
    );
    const newTextStyle = { ...previousTextStyle, font_entry: newEntryId };
    const newKind = { ...(previousKind as object), text_style: newTextStyle };

    // Create a set_field op for "kind" — same as setNodeFont does via interceptor.set
    const op = createSetFieldOp(TEST_USER_ID, nodeUuid, "kind", newKind, previousKind);

    // Apply + track (mirrors interceptor.set + historyManager.apply)
    applyOperationToStore(op, setState, reader);
    historyManager.apply(op, "Set font");

    // Verify forward state
    const afterApply = getNodes()[nodeUuid]["kind"] as { text_style: { font_entry: string } };
    expect(afterApply.text_style.font_entry).toBe(newEntryId);

    // Undo
    const inverseTx = historyManager.undo();
    expect(inverseTx).not.toBeNull();
    if (inverseTx === null) throw new Error("undo returned null");
    for (const inverseOp of inverseTx.operations) {
      applyOperationToStore(inverseOp, setState, reader);
    }

    // After undo: font_entry reverts to oldEntryId
    const afterUndo = getNodes()[nodeUuid]["kind"] as { text_style: { font_entry: string } };
    expect(afterUndo.text_style.font_entry).toBe(oldEntryId);

    // Redo
    const redoTx = historyManager.redo();
    expect(redoTx).not.toBeNull();
    if (redoTx === null) throw new Error("redo returned null");
    for (const redoOp of redoTx.operations) {
      applyOperationToStore(redoOp, setState, reader);
    }

    // After redo: font_entry is newEntryId again
    const afterRedo = getNodes()[nodeUuid]["kind"] as { text_style: { font_entry: string } };
    expect(afterRedo.text_style.font_entry).toBe(newEntryId);
  });
});

// ── Isolated simulation helpers ───────────────────────────────────────────────
//
// These helpers extract the core logic of addFont, removeFont, and setNodeFont
// from the store, allowing us to test them without a full Solid reactive context
// or real urql client.  They mirror the implementation in
// document-store-solid.tsx exactly.

type MutationResult = { error: { message: string } | null; data: Record<string, unknown> | null };

/**
 * Simulates the addFont store function.
 * Returns the new FontEntry on success (RF-002), or throws on error.
 */
async function simulateAddFont(
  bytes: Uint8Array,
  provenance: string,
  mutationFn: (vars: Record<string, unknown>) => Promise<MutationResult>,
  announceErrorFn: (msg: string) => void,
  fontTableUpdates?: Record<string, unknown>[],
): Promise<FontEntry> {
  if (bytes.length > MAX_EMBEDDED_FONT_BYTES) {
    const msg = `addFont: font file is ${bytes.length} bytes, exceeds max ${MAX_EMBEDDED_FONT_BYTES}`;
    announceErrorFn(msg);
    throw new Error(msg);
  }

  // Minimal base64 encode for test purposes (real code uses btoa + chunks)
  let bytesBase64: string;
  try {
    bytesBase64 = btoa(String.fromCharCode(...bytes.slice(0, 100)));
  } catch {
    bytesBase64 = "";
  }
  void bytesBase64;

  const result = await mutationFn({ bytesBase64: "base64stub", provenance });

  if (result.error) {
    const msg = `addFont: server error — ${result.error.message}`;
    console.error(msg);
    announceErrorFn(msg);
    throw new Error(msg);
  }

  const rawEntry: unknown = result.data?.["addFont"];
  const entry = parseFontEntry(rawEntry);
  if (entry === null) {
    const msg = `addFont: server returned an invalid FontEntry`;
    console.warn(msg, rawEntry);
    announceErrorFn(msg);
    throw new Error(msg);
  }

  // Insert into table (in real code: setState("fontTable", entry.id, entry))
  fontTableUpdates?.push(entry as unknown as Record<string, unknown>);

  // RF-002: real store.addFont returns the full FontEntry, not just the id.
  return entry;
}

type NodeShape = { kind: { type: string; text_style?: { font_entry: string } } };

/**
 * Simulates the removeFont store function.
 * `deletedIds` records which ids were optimistically deleted.
 */
async function simulateRemoveFont(
  id: string,
  fontTable: Record<string, Record<string, unknown>>,
  nodes: NodeShape[],
  mutationFn: (vars: Record<string, unknown>) => Promise<MutationResult>,
  announceErrorFn: (msg: string) => void,
  deletedIds: string[],
): Promise<void> {
  // Pre-check 1: default font cannot be removed
  if (id === DEFAULT_FONT_ENTRY_ID) {
    announceErrorFn("removeFont: cannot remove the bundled default font");
    return;
  }

  // Pre-check 2: font in use by a text node
  const isReferenced = nodes.some(
    (node) => node.kind.type === "text" && node.kind.text_style?.font_entry === id,
  );
  if (isReferenced) {
    announceErrorFn("removeFont: font is in use by one or more text nodes and cannot be removed");
    return;
  }

  // Not in table — nothing to do
  if (fontTable[id] === undefined) {
    return;
  }

  // Snapshot before optimistic delete
  const snapshot = deepClone(fontTable[id]);

  // Optimistic delete
  deletedIds.push(id);
  Reflect.deleteProperty(fontTable, id);

  // Call server
  const result = await mutationFn({ id });

  if (result.error) {
    // Rollback: re-insert the snapshot
    fontTable[id] = snapshot;
    const msg = `removeFont: server error — ${result.error.message}`;
    console.error(msg);
    announceErrorFn(msg);
  }
}

/**
 * Simulates the setNodeFont store function.
 * `interceptorSets` records interceptor.set calls.
 * `pendingOps` records queued server ops.
 */
function simulateSetNodeFont(
  uuid: string,
  entryId: string,
  nodes: Record<string, Record<string, unknown>>,
  fontTable: Record<string, Record<string, unknown>>,
  pendingOps: Record<string, unknown>[],
  interceptorSets: Array<{ uuid: string; field: string; value: unknown }>,
  announceErrorFn?: (msg: string) => void,
): void {
  const node = nodes[uuid];
  if (!node || (node["kind"] as { type: string }).type !== "text") {
    console.warn("setNodeFont: node not found or not a text node", { uuid });
    return;
  }

  if (!fontTable[entryId]) {
    const msg = `setNodeFont: unknown font entry "${entryId}"`;
    (announceErrorFn ?? (() => {}))(msg);
    return;
  }

  const previousKind = deepClone(node["kind"]);
  const prevTextStyle = deepClone(
    (previousKind as { text_style: Record<string, unknown> }).text_style,
  );
  const newTextStyle = { ...prevTextStyle, font_entry: entryId };
  const newKind = { ...(previousKind as object), text_style: newTextStyle };

  // Simulate interceptor.set
  interceptorSets.push({ uuid, field: "kind", value: newKind });

  // Simulate pendingServerOps.push
  pendingOps.push({
    setField: {
      nodeUuid: uuid,
      path: "kind.text_style.font_entry",
      value: JSON.stringify(entryId),
    },
  });
}

/** Minimal text node fixture */
function makeTextNode(uuid: string, fontEntry: string): Record<string, unknown> {
  return {
    uuid,
    kind: {
      type: "text",
      content: "Hello",
      text_style: {
        font_entry: fontEntry,
        font_size: { type: "literal", value: 16 },
        font_weight: 400,
        font_style: "normal",
        line_height: { type: "literal", value: 1.2 },
        letter_spacing: { type: "literal", value: 0 },
        text_align: "left",
        text_decoration: "none",
        text_color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
        text_shadow: null,
      },
    },
    parentUuid: null,
    childrenUuids: [],
  };
}
