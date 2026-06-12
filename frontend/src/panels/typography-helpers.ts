/**
 * typography-helpers.ts — pure, named, exported helper functions for
 * TypographySection.  Extracted per CLAUDE.md §5 "Business Logic Must Not
 * Live in Inline JSX Handlers".
 *
 * All functions here are independently testable and side-effect-free except
 * for the addFontFromFile handler, which wraps store mutations but keeps all
 * async plumbing visible at the call site.
 */

import type { EmbedDecision, FontEntry, FontProvenance } from "../types/document";

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Minimal slice of DocumentStoreAPI consumed by the add-font handler.
 * Using a structural sub-type here lets tests supply a minimal mock without
 * importing the full DocumentStoreAPI.
 *
 * RF-002: addFont resolves to the full server-canonical FontEntry so the
 * handler can branch its status message on `entry.embeddable` (embed vs
 * reference) and use the canonical `entry.family` (not the stripped filename).
 */
export interface AddFontStore {
  addFont(bytes: Uint8Array, provenance: FontProvenance): Promise<FontEntry>;
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
  /**
   * RF-002/RF-003: the embed classification on success (undefined on failure),
   * so the caller can pick the toast variant (a non-alarming warning for
   * reference decisions, success for "embed").
   */
  readonly embeddable?: EmbedDecision;
}

/**
 * RF-002: build the status/toast message for a successful add, branching on
 * the server's embed classification.
 *
 * - "embed": the font's OS/2 fsType permits embedding → plain "Added {family}".
 * - reference_* : the font will be referenced (not embedded) on export. We
 *   surface a distinct, NON-alarming notice naming the family so the user
 *   understands the font won't travel with the exported document.
 *
 * Exhaustive switch with a `never` sentinel so a new EmbedDecision variant
 * fails tsc here (CLAUDE.md §11 discriminated-union dispatch rule).
 */
export function addFontSuccessMessage(
  family: string,
  embeddable: EmbedDecision,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  switch (embeddable) {
    case "embed":
      return t("panels:typography.fontAdded", { family });
    case "reference_restricted":
    case "reference_system":
    case "reference_no_os2":
    case "reference_preview_print":
      return t("panels:typography.fontAddedReferenced", { family });
    default: {
      // Exhaustiveness sentinel: unreachable if every EmbedDecision variant is
      // handled above; a new variant fails tsc here.
      const _exhaustive: never = embeddable;
      void _exhaustive;
      // Fall back to the plain message rather than throwing in a UI path.
      return t("panels:typography.fontAdded", { family });
    }
  }
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
  // RF-002: addFont resolves to the full server-canonical FontEntry.
  let entry: FontEntry;
  try {
    entry = await store.addFont(bytes, "user_supplied");
  } catch (err: unknown) {
    // RF-015: store.addFont already rejects with a clean user-facing message
    // (no `addFont:` debug prefix). Surface that message verbatim; verbose
    // detail stays in the store's console.error.
    const msg = err instanceof Error ? err.message : String(err);
    console.error("handleAddFontFile: addFont rejected", err);
    return {
      statusMessage: msg,
      ok: false,
    };
  }

  // Apply the new font to the selected text node (if any).
  if (nodeUuid !== null) {
    store.setNodeFont(nodeUuid, entry.id);
  }

  // RF-002/RF-003: use the canonical family from the FontEntry (NOT the
  // stripped filename) and branch the status message on the embed
  // classification.
  const family = entry.family;
  return {
    statusMessage: addFontSuccessMessage(family, entry.embeddable, t),
    ok: true,
    family,
    embeddable: entry.embeddable,
  };
}
