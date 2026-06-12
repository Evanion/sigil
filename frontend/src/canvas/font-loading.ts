/**
 * Font-loading orchestrator for the canvas renderer.
 *
 * Bridges the Solid store's `state.fontTable` into the browser's FontFace API:
 * - Watches for new entries in fontTable (Custom and reference/system)
 * - Fetches font bytes from the server for Custom entries via `fontBytes` query
 * - Calls `loadFonts` to register FontFace objects in `document.fonts`
 * - Increments `fontLoadVersion` after each batch resolves so the canvas
 *   render effect re-runs and `ctx.font` picks up newly-available families
 *
 * Per CLAUDE.md §11:
 * - "Plain class instances are not reactive" — `document.fonts` availability is
 *   external to Solid; `fontLoadVersion` signal bridges it into the reactive graph.
 * - "Module-Level Timers and Subscriptions Must Be Cleared on Teardown" — the
 *   `destroyed` flag + `onCleanup` guard prevent post-teardown state updates.
 * - "No Fire-and-Forget Mutations" — every async load call is awaited; errors
 *   are logged + handled (fallen back) per the `loadFonts` error contract.
 * - "Defensive Message Parsing" — the base64 decode is wrapped in try-catch.
 */

import { createSignal, createEffect, onCleanup } from "solid-js";
import { gql } from "@urql/solid";
import type { FontEntry } from "../types/document";
import { FONT_BYTES_QUERY } from "../graphql/queries";
import { loadFonts, type FontLoadResult } from "./font-face-loader";

// ---------------------------------------------------------------------------
// FontBytesClient — minimal interface for the urql client used here
//
// We accept a structural subtype rather than importing `Client` from @urql/core
// so that (a) the module does not depend on a package not directly listed in
// package.json, and (b) test mocks can satisfy the interface without needing
// the full urql Client type.
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the urql `Client` interface required by the orchestrator.
 *
 * Callers pass `store.urqlClient` (which satisfies this) or a test mock.
 *
 * `data` is typed as `unknown` (not `Record<string,unknown>`) because urql's
 * `OperationResult.data` is `unknown` — the orchestrator narrows it internally.
 */
export interface FontBytesClient {
  query(
    doc: ReturnType<typeof gql>,
    variables: Record<string, unknown>,
  ): { toPromise(): Promise<{ data?: unknown; error?: { message: string } }> };
}

// ---------------------------------------------------------------------------
// fontLoadVersion signal (module-level singleton)
//
// Canvas.tsx reads this in its render createEffect alongside the fontTable
// key-set read — incrementing it causes the render effect to re-run, which
// forces ctx.font to resolve the newly-registered family from document.fonts.
//
// Per CLAUDE.md §5 "Plain class instances are not reactive": document.fonts
// availability is imperative state; this signal mirrors it into Solid's
// reactive graph. Every mutation to external font state (loadFonts resolution)
// MUST call the setter immediately after.
// ---------------------------------------------------------------------------

const [fontLoadVersion, setFontLoadVersion] = createSignal(0);

/**
 * Read the current font-load version.  The canvas render createEffect reads
 * this so a FontFace resolution (incrementing this signal) triggers a re-render
 * without requiring the user to interact with the canvas.
 */
export { fontLoadVersion };

// ---------------------------------------------------------------------------
// b64ToUint8Array
// ---------------------------------------------------------------------------

/**
 * Decode a standard base64 string into a Uint8Array.
 *
 * Uses `atob` (available in modern browsers and jsdom) followed by a manual
 * copy into a Uint8Array.  Returns null and logs on decode failure rather than
 * throwing — per "No Silent Error Suppression" the caller must handle the null.
 *
 * Per CLAUDE.md §11 "Defensive Message Parsing": wrapped in try-catch.
 */
export function b64ToUint8Array(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    console.error("[font-loading] base64 decode failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// installFontLoadingOrchestrator
// ---------------------------------------------------------------------------

/**
 * Install a font-loading orchestrator as a Solid reactive effect.
 *
 * Must be called INSIDE a Solid component or reactive root (so that
 * `createEffect` and `onCleanup` have a reactive owner).
 *
 * @param getFontTable - zero-arg accessor that returns the current fontTable
 *   record from the Solid store.  Called reactively — the effect re-runs when
 *   the key-set changes (new fonts added or removed).
 * @param urqlClient - the urql client (or compatible mock) used to issue
 *   `fontBytes` queries.  Must satisfy the `FontBytesClient` interface.
 *
 * The orchestrator:
 * 1. Reads the fontTable key-set (reactive — triggers on add/remove).
 * 2. For entries not yet processed, fires `fontBytes` fetches for Custom
 *    entries and then calls `loadFonts` with the collected bytes.
 * 3. On resolution, increments `fontLoadVersion` so the canvas re-renders.
 * 4. Guards all post-teardown state updates with a `destroyed` flag set via
 *    `onCleanup` — prevents updates to a dead reactive root.
 */
export function installFontLoadingOrchestrator(
  getFontTable: () => Readonly<Record<string, FontEntry>>,
  urqlClient: FontBytesClient,
): void {
  // Track which entry ids have already been dispatched.  This is a plain Set
  // (not reactive) — reads from it inside the effect do NOT create dependencies
  // (intentional: we don't want the effect to re-run because the Set was mutated).
  const processedIds = new Set<string>();

  // Destroyed sentinel: set to true in onCleanup so in-flight async operations
  // do not touch reactive state after the component is destroyed.
  // Per CLAUDE.md §5 "onCleanup must be called synchronously during component
  // setup" — registered here, at the top of installFontLoadingOrchestrator's
  // synchronous body, which runs inside the Solid component's setup.
  let destroyed = false;
  onCleanup(() => {
    destroyed = true;
  });

  createEffect(() => {
    // Read the fontTable — Solid tracks this as a reactive dependency.
    // We read Object.keys() so the effect re-triggers when entries are added
    // or removed (same pattern as the Canvas.tsx render effect's fontTable
    // key-set read, per the comment at ~704 in Canvas.tsx).
    const fontTable = getFontTable();
    const allIds = Object.keys(fontTable);

    // Find entries that haven't been dispatched yet.
    const newIds = allIds.filter((id) => !processedIds.has(id));
    if (newIds.length === 0) return;

    // Mark all new ids as dispatched immediately (before the async load)
    // so a re-trigger of this effect (e.g. from another font being added
    // before the current batch resolves) does not double-dispatch them.
    for (const id of newIds) {
      processedIds.add(id);
    }

    // Collect the FontEntry objects for the new ids.
    const newEntries: FontEntry[] = newIds
      .map((id) => fontTable[id])
      .filter((entry): entry is FontEntry => entry !== undefined);

    if (newEntries.length === 0) return;

    // Kick off the async work in a fire-and-catch wrapper.
    // Per "No Fire-and-Forget Mutations": the promise is captured and any
    // rejection is caught and logged — we don't suppress errors.
    loadEntriesAsync(newEntries, urqlClient, () => destroyed).catch((err: unknown) => {
      console.error("[font-loading] unexpected error in font load batch", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Internal async load helper
// ---------------------------------------------------------------------------

/**
 * Fetch bytes for Custom entries, then call `loadFonts`, then bump
 * `fontLoadVersion`.
 *
 * Separated from the `createEffect` body so the effect remains synchronous and
 * testable.  The `isDestroyed` function is called lazily (after awaits) so
 * post-teardown signal updates are suppressed.
 *
 * @param entries      - new font entries to load in this batch
 * @param urqlClient   - urql client for fontBytes queries
 * @param isDestroyed  - zero-arg closure that returns the current destroyed state;
 *   checked after each await to prevent post-teardown signal updates
 */
async function loadEntriesAsync(
  entries: FontEntry[],
  urqlClient: FontBytesClient,
  isDestroyed: () => boolean,
): Promise<void> {
  // --- Step 1: fetch bytes for Custom entries ---
  //
  // Per "No Fire-and-Forget Mutations": every query is awaited and its
  // response is handled (error → log + skip; null → skip with no bytes).
  const bytesById = new Map<string, Uint8Array>();

  const customEntries = entries.filter((e) => e.source.source === "custom");
  const fetchPromises = customEntries.map(async (entry) => {
    try {
      const result = await urqlClient.query(gql(FONT_BYTES_QUERY), { id: entry.id }).toPromise();

      if (result.error) {
        console.warn("[font-loading] fontBytes query error", {
          id: entry.id,
          family: entry.family,
          error: result.error.message,
        });
        return; // no bytes — loadFonts will produce "missing" result
      }

      // Narrow result.data: urql types it as unknown. Defensive cast per
      // CLAUDE.md §11 "Defensive Message Parsing".
      const dataObj =
        result.data !== null && typeof result.data === "object"
          ? (result.data as Record<string, unknown>)
          : undefined;
      const raw = dataObj?.["fontBytes"];

      if (raw === null || raw === undefined) {
        // Server returned null — non-Custom entry or no bytes stored.
        // Not an error — loadFonts falls back to "missing".
        return;
      }

      if (typeof raw !== "string") {
        console.warn("[font-loading] fontBytes returned unexpected type", {
          id: entry.id,
          type: typeof raw,
        });
        return;
      }

      const decoded = b64ToUint8Array(raw);
      if (decoded === null) {
        // b64ToUint8Array already logged the decode failure.
        console.warn("[font-loading] Skipping font with base64 decode failure", {
          id: entry.id,
          family: entry.family,
        });
        return;
      }

      bytesById.set(entry.id, decoded);
    } catch (err: unknown) {
      console.warn("[font-loading] fontBytes fetch exception", {
        id: entry.id,
        family: entry.family,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  await Promise.all(fetchPromises);

  // Guard: if the component was destroyed while we were fetching, abort.
  if (isDestroyed()) return;

  // --- Step 2: call loadFonts ---
  //
  // `loadFonts` handles all source types (custom, system_reference, bundled,
  // library) and never rejects — it returns results for every entry.
  let results: FontLoadResult[];
  try {
    results = await loadFonts(entries, bytesById);
  } catch (err: unknown) {
    // loadFonts should never reject (it catches internally), but if it does,
    // log and abort — the canvas will render without the fonts (graceful).
    console.error("[font-loading] loadFonts threw unexpectedly", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Guard: if destroyed while loading, skip state update.
  if (isDestroyed()) return;

  // Log any error results for diagnostics.
  for (const r of results) {
    if (r.status === "error") {
      console.error("[font-loading] font load error", {
        id: r.id,
        family: r.family,
        error: r.error,
      });
    }
  }

  // --- Step 3: increment fontLoadVersion ---
  //
  // Bumping this signal causes the canvas render createEffect to re-run,
  // which forces ctx.font re-resolution against the now-populated
  // document.fonts.  This is the "Plain class instance → signal bridge" pattern
  // from CLAUDE.md §5.
  setFontLoadVersion((v) => v + 1);
}
