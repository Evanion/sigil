/**
 * typography-helpers.ts — pure, named, exported helper functions for
 * TypographySection.  Extracted per CLAUDE.md §5 "Business Logic Must Not
 * Live in Inline JSX Handlers".
 *
 * All functions here are independently testable and side-effect-free except
 * for the addFontFromFile handler, which wraps store mutations but keeps all
 * async plumbing visible at the call site.
 */

import type { FontProvenance } from "../types/document";

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Minimal slice of DocumentStoreAPI consumed by the add-font handler.
 * Using a structural sub-type here lets tests supply a minimal mock without
 * importing the full DocumentStoreAPI.
 */
export interface AddFontStore {
  addFont(bytes: Uint8Array, provenance: FontProvenance): Promise<string>;
  setNodeFont(uuid: string, entryId: string): void;
}

/** Return value of handleAddFontFile — callers swap the status region text. */
export interface AddFontResult {
  /** Human-readable status for the aria-live region. */
  readonly statusMessage: string;
  /** True when the font was added and applied successfully. */
  readonly ok: boolean;
  /**
   * The resolved family name on success, for use in the success message.
   * Undefined on failure.
   */
  readonly family?: string;
}

// ── Exported helpers ─────────────────────────────────────────────────────

/**
 * Handle a file chosen via the "Add font…" <input type="file">.
 *
 * Flow:
 *  1. Read the first file as a Uint8Array.
 *  2. Call store.addFont(bytes, "user_supplied") — awaited; NOT fire-and-forget.
 *  3. On success call store.setNodeFont(nodeUuid, entryId).
 *  4. Return an AddFontResult describing success or the rejection cause.
 *
 * The caller (TypographySection) is responsible for:
 *  - Updating the status signal with result.statusMessage.
 *  - Resetting the file input value so re-selecting the same file re-fires.
 *
 * @param file        The first file from the file input's FileList.
 * @param nodeUuid    UUID of the currently-selected text node.
 * @param store       The store slice required to add and apply a font.
 * @param t           i18n translation function.
 */
export async function handleAddFontFile(
  file: File,
  nodeUuid: string | null,
  store: AddFontStore,
  t: (key: string, opts?: Record<string, unknown>) => string,
): Promise<AddFontResult> {
  // Read file bytes.
  let bytes: Uint8Array;
  try {
    const buf = await file.arrayBuffer();
    bytes = new Uint8Array(buf);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("handleAddFontFile: failed to read file bytes", err);
    return {
      statusMessage: t("panels:typography.fontAddError", { error: msg }),
      ok: false,
    };
  }

  // Add the font to the document via the store. NOT fire-and-forget — await
  // and handle rejection per CLAUDE.md §11 "No Fire-and-Forget Mutations".
  let entryId: string;
  try {
    entryId = await store.addFont(bytes, "user_supplied");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("handleAddFontFile: addFont rejected", err);
    return {
      statusMessage: t("panels:typography.fontAddError", { error: msg }),
      ok: false,
    };
  }

  // Apply the new font to the selected text node (if any).
  if (nodeUuid !== null) {
    store.setNodeFont(nodeUuid, entryId);
  }

  // Extract family name from the file name as a display hint (server returns
  // the authoritative family in FontEntry, but we don't have it here — the
  // caller can enrich the message later if needed; the entryId gives a stable
  // handle).  Strip common suffixes for a readable label.
  const family = file.name.replace(/\.(ttf|otf|woff2?|ttc)$/i, "");

  return {
    statusMessage: t("panels:typography.fontAdded", { family }),
    ok: true,
    family,
  };
}
