/**
 * typography-helpers.test.ts — unit tests for handleAddFontFile.
 *
 * Tests verify:
 * 1. Success path: reads bytes, calls addFont with Uint8Array + "user_supplied",
 *    calls setNodeFont with the uuid + returned entryId, returns ok status.
 * 2. addFont rejection: setNodeFont NOT called, error status returned, no
 *    unhandled rejection.
 * 3. File read failure: addFont NOT called, error status returned.
 */

import { describe, it, expect, vi } from "vitest";
import { addFontSuccessMessage, handleAddFontFile, type AddFontStore } from "../typography-helpers";
import type { EmbedDecision, FontEntry } from "../../types/document";
import { makeTestFontEntry } from "../../test-utils/font-entry";

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Create a minimal mock AddFontStore.
 * @param addFontImpl Optional override for addFont — defaults to resolving an
 *   embeddable FontEntry with id "entry-123" and family "Inter".
 */
function makeStore(
  addFontImpl?: (bytes: Uint8Array) => Promise<FontEntry>,
): AddFontStore & { addFont: ReturnType<typeof vi.fn>; setNodeFont: ReturnType<typeof vi.fn> } {
  const addFont = vi.fn(
    addFontImpl ?? (() => Promise.resolve(makeTestFontEntry({ id: "entry-123", family: "Inter" }))),
  );
  const setNodeFont = vi.fn();
  return { addFont, setNodeFont };
}

/** Minimal translation function that returns the key. */
function t(key: string, opts?: Record<string, unknown>): string {
  if (!opts) return key;
  // Interpolate {{variables}} for assertion readability.
  return Object.entries(opts).reduce<string>(
    (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
    key,
  );
}

/** Create a File-like object with a fixed arrayBuffer. */
function makeFile(name: string, bytes: number[] = [0, 1, 2]): File {
  return new File([new Uint8Array(bytes)], name, { type: "font/ttf" });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("handleAddFontFile", () => {
  it("should read bytes from the file, call addFont with Uint8Array + user_supplied, then call setNodeFont", async () => {
    const store = makeStore();
    const file = makeFile("Inter.ttf", [10, 20, 30]);

    const result = await handleAddFontFile(file, "node-uuid", store, t);

    expect(result.ok).toBe(true);

    // addFont must have been called with a Uint8Array containing the file bytes.
    expect(store.addFont).toHaveBeenCalledOnce();
    const [calledBytes, provenance] = store.addFont.mock.calls[0] as [Uint8Array, string];
    expect(calledBytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(calledBytes)).toEqual([10, 20, 30]);
    expect(provenance).toBe("user_supplied");

    // setNodeFont must have been called with the uuid + entry id returned by addFont.
    expect(store.setNodeFont).toHaveBeenCalledOnce();
    expect(store.setNodeFont).toHaveBeenCalledWith("node-uuid", "entry-123");
  });

  it("should use the canonical FontEntry.family (not the filename) in result.family and the status message (RF-002)", async () => {
    // The file is named "Roboto-weird.ttf" but the server-canonical family is
    // "Roboto Mono" — the result must reflect the canonical family.
    const store = makeStore(() =>
      Promise.resolve(makeTestFontEntry({ id: "e1", family: "Roboto Mono" })),
    );
    const file = makeFile("Roboto-weird.ttf");

    const result = await handleAddFontFile(file, "node-uuid", store, t);

    expect(result.ok).toBe(true);
    // The family field must be the server-canonical family, not the filename.
    expect(result.family).toBe("Roboto Mono");
    expect(result.family).not.toContain("weird");
    // The success message uses the plain "fontAdded" key for an embeddable font.
    // (The test mock `t` returns the key; it has no {{family}} placeholder to
    // interpolate, so we assert the key, not the rendered English.)
    expect(result.statusMessage).toContain("panels:typography.fontAdded");
  });

  it("should surface a non-alarming referenced message for a non-embeddable font (RF-002)", async () => {
    const store = makeStore(() =>
      Promise.resolve(
        makeTestFontEntry({
          id: "e2",
          family: "Restricted Sans",
          embeddable: "reference_restricted",
        }),
      ),
    );
    const file = makeFile("whatever.ttf");

    const result = await handleAddFontFile(file, "node-uuid", store, t);

    expect(result.ok).toBe(true);
    expect(result.embeddable).toBe("reference_restricted");
    expect(result.family).toBe("Restricted Sans");
    // Distinct key from the plain "fontAdded" message.
    expect(result.statusMessage).toContain("panels:typography.fontAddedReferenced");
  });

  it("should use the plain fontAdded message for an embeddable font (RF-002)", async () => {
    const store = makeStore(() =>
      Promise.resolve(makeTestFontEntry({ id: "e3", family: "Embed Me", embeddable: "embed" })),
    );
    const result = await handleAddFontFile(makeFile("Embed.ttf"), "node-uuid", store, t);

    expect(result.ok).toBe(true);
    expect(result.embeddable).toBe("embed");
    expect(result.statusMessage).toContain("panels:typography.fontAdded");
    expect(result.statusMessage).not.toContain("fontAddedReferenced");
  });

  it("should NOT call setNodeFont when addFont rejects, and should return an error status", async () => {
    const store = makeStore(() => Promise.reject(new Error("Font too large")));

    const result = await handleAddFontFile(makeFile("Big.ttf"), "node-uuid", store, t);

    // setNodeFont must NOT have been called.
    expect(store.setNodeFont).not.toHaveBeenCalled();

    // Must resolve (not reject) with an error result — no unhandled rejection.
    expect(result.ok).toBe(false);
    // statusMessage must be non-empty and contain the i18n key (the test mock
    // returns the key with {{error}} substituted, so "Font too large" appears in it).
    expect(result.statusMessage).toBeTruthy();
  });

  it("should NOT throw or reject when addFont rejects — error is captured in the result", async () => {
    const store = makeStore(() => Promise.reject(new Error("Network error")));

    // handleAddFontFile MUST resolve, never reject — the caller cannot safely
    // attach an error handler in every case.
    await expect(
      handleAddFontFile(makeFile("X.ttf"), "node-uuid", store, t),
    ).resolves.toMatchObject({ ok: false });
  });

  it("should NOT call setNodeFont when nodeUuid is null (no text node selected)", async () => {
    const store = makeStore();
    const file = makeFile("Inter.ttf");

    const result = await handleAddFontFile(file, null, store, t);

    // addFont is still called — we add the font to the library.
    expect(store.addFont).toHaveBeenCalledOnce();
    // But setNodeFont must not be called when there is no selected node.
    expect(store.setNodeFont).not.toHaveBeenCalled();

    expect(result.ok).toBe(true);
  });

  it("should return an error result when the file cannot be read (arrayBuffer rejects)", async () => {
    const store = makeStore();

    // Create a File whose arrayBuffer method rejects.
    const badFile = new File([], "bad.ttf");
    vi.spyOn(badFile, "arrayBuffer").mockRejectedValue(new Error("Read failed"));

    const result = await handleAddFontFile(badFile, "node-uuid", store, t);

    expect(result.ok).toBe(false);
    // statusMessage must be non-empty (error key + interpolated error text).
    expect(result.statusMessage).toBeTruthy();
    // addFont must NOT have been called.
    expect(store.addFont).not.toHaveBeenCalled();
    expect(store.setNodeFont).not.toHaveBeenCalled();
  });
});

describe("addFontSuccessMessage", () => {
  it("should use the plain fontAdded key for the embed decision", () => {
    expect(addFontSuccessMessage("Inter", "embed", t)).toBe("panels:typography.fontAdded");
  });

  it.each<EmbedDecision>([
    "reference_restricted",
    "reference_system",
    "reference_no_os2",
    "reference_preview_print",
  ])("should use the referenced key for the %s decision", (decision) => {
    expect(addFontSuccessMessage("Inter", decision, t)).toBe(
      "panels:typography.fontAddedReferenced",
    );
  });
});
