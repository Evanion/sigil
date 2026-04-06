/**
 * AlignPanel — Alignment and distribution controls for multi-selected nodes.
 *
 * Shows 6 alignment buttons when 2+ nodes are selected and 2 distribute
 * buttons when 3+ nodes are selected. Each button reads the current
 * transforms from the store, applies the pure alignment function, and
 * commits the result via `store.batchSetTransform`.
 *
 * Layout: `role="toolbar"` with `aria-label="Alignment"` per CLAUDE.md §5.
 * Each button has `aria-label` and `title` for discoverability.
 */
import { createMemo, Show, type Component } from "solid-js";
import { useDocument } from "../store/document-context";
import {
  alignLeft,
  alignCenter,
  alignRight,
  alignTop,
  alignMiddle,
  alignBottom,
  distributeHorizontal,
  distributeVertical,
  type AlignEntry,
} from "../canvas/align-math";
import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalSpaceBetween,
  AlignVerticalSpaceBetween,
} from "lucide-solid";
import "./AlignPanel.css";

// ── Icon size constant ──────────────────────────────────────────────────

const ICON_SIZE = 16;

// ── Component ───────────────────────────────────────────────────────────

export const AlignPanel: Component = () => {
  const store = useDocument();

  const selectedIds = createMemo(() => store.selectedNodeIds());

  const selectionCount = createMemo(() => selectedIds().length);

  /**
   * Build the AlignEntry array from the current selection.
   * Reads transforms from the reactive store so this memo tracks changes.
   */
  const selectedEntries = createMemo((): AlignEntry[] => {
    const ids = selectedIds();
    const entries: AlignEntry[] = [];
    for (const uuid of ids) {
      const node = store.state.nodes[uuid];
      if (node) {
        entries.push({ uuid, transform: node.transform });
      }
    }
    return entries;
  });

  /**
   * Execute an alignment function and commit the result to the store.
   */
  function executeAlign(alignFn: (nodes: readonly AlignEntry[]) => readonly AlignEntry[]): void {
    const entries = selectedEntries();
    if (entries.length < 2) return;
    const result = alignFn(entries);
    store.batchSetTransform(result.map((n) => ({ uuid: n.uuid, transform: n.transform })));
  }

  /**
   * Execute a distribute function and commit the result to the store.
   */
  function executeDistribute(
    distributeFn: (nodes: readonly AlignEntry[]) => readonly AlignEntry[],
  ): void {
    const entries = selectedEntries();
    if (entries.length < 3) return;
    const result = distributeFn(entries);
    store.batchSetTransform(result.map((n) => ({ uuid: n.uuid, transform: n.transform })));
  }

  return (
    <Show when={selectionCount() >= 2}>
      <div class="sigil-align-panel" role="toolbar" aria-label="Alignment">
        <span class="sigil-align-panel__section-title">Align</span>
        <div class="sigil-align-panel__row">
          <button
            class="sigil-align-panel__button"
            type="button"
            aria-label="Align left"
            title="Align left"
            onClick={() => executeAlign(alignLeft)}
          >
            <AlignStartVertical size={ICON_SIZE} />
          </button>
          <button
            class="sigil-align-panel__button"
            type="button"
            aria-label="Align center horizontally"
            title="Align center horizontally"
            onClick={() => executeAlign(alignCenter)}
          >
            <AlignCenterVertical size={ICON_SIZE} />
          </button>
          <button
            class="sigil-align-panel__button"
            type="button"
            aria-label="Align right"
            title="Align right"
            onClick={() => executeAlign(alignRight)}
          >
            <AlignEndVertical size={ICON_SIZE} />
          </button>
          <button
            class="sigil-align-panel__button"
            type="button"
            aria-label="Align top"
            title="Align top"
            onClick={() => executeAlign(alignTop)}
          >
            <AlignStartHorizontal size={ICON_SIZE} />
          </button>
          <button
            class="sigil-align-panel__button"
            type="button"
            aria-label="Align center vertically"
            title="Align center vertically"
            onClick={() => executeAlign(alignMiddle)}
          >
            <AlignCenterHorizontal size={ICON_SIZE} />
          </button>
          <button
            class="sigil-align-panel__button"
            type="button"
            aria-label="Align bottom"
            title="Align bottom"
            onClick={() => executeAlign(alignBottom)}
          >
            <AlignEndHorizontal size={ICON_SIZE} />
          </button>
        </div>

        <Show when={selectionCount() >= 3}>
          <span class="sigil-align-panel__section-title">Distribute</span>
          <div class="sigil-align-panel__row">
            <button
              class="sigil-align-panel__button"
              type="button"
              aria-label="Distribute horizontally"
              title="Distribute horizontally"
              onClick={() => executeDistribute(distributeHorizontal)}
            >
              <AlignHorizontalSpaceBetween size={ICON_SIZE} />
            </button>
            <button
              class="sigil-align-panel__button"
              type="button"
              aria-label="Distribute vertically"
              title="Distribute vertically"
              onClick={() => executeDistribute(distributeVertical)}
            >
              <AlignVerticalSpaceBetween size={ICON_SIZE} />
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
};
