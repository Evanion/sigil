/**
 * AlignPanel — Alignment and distribution controls for multi-selected nodes.
 *
 * Shows 6 alignment buttons when 2+ nodes are selected. Distribute buttons
 * are always visible when 2+ selected, but disabled when < 3 selected
 * (RF-030: prevents layout jump when selection count crosses the threshold).
 *
 * Uses the shared `executeAlign` helper from align-helpers.ts (RF-012).
 *
 * Layout: `role="toolbar"` with `aria-label="Alignment"` per CLAUDE.md §5.
 * Implements roving tabindex per WAI-ARIA APG toolbar pattern (RF-035):
 * only the active button is in tab order; ArrowLeft/ArrowRight cycles focus.
 */
import { createMemo, createSignal, Show, type Component } from "solid-js";
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
} from "../canvas/align-math";
import { executeAlign } from "../canvas/align-helpers";
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

/** Total number of buttons in the toolbar (6 align + 2 distribute). */
const BUTTON_COUNT = 8;

// ── Component ───────────────────────────────────────────────────────────

export const AlignPanel: Component = () => {
  const store = useDocument();

  const selectedIds = createMemo(() => store.selectedNodeIds());

  const selectionCount = createMemo(() => selectedIds().length);

  // RF-035: Roving tabindex — track which button is the "active" tab stop.
  const [activeIndex, setActiveIndex] = createSignal(0);

  /**
   * Handle keyboard navigation within the toolbar (RF-035).
   * ArrowRight moves focus forward; ArrowLeft moves backward.
   * Home/End jump to first/last button.
   */
  function handleToolbarKeyDown(e: KeyboardEvent): void {
    let newIndex = activeIndex();
    if (e.key === "ArrowRight") {
      e.preventDefault();
      newIndex = (newIndex + 1) % BUTTON_COUNT;
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      newIndex = (newIndex - 1 + BUTTON_COUNT) % BUTTON_COUNT;
    } else if (e.key === "Home") {
      e.preventDefault();
      newIndex = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      newIndex = BUTTON_COUNT - 1;
    } else {
      return;
    }
    setActiveIndex(newIndex);
    // Move DOM focus to the new active button.
    const toolbar = (e.currentTarget as HTMLElement).closest('[role="toolbar"]');
    if (toolbar) {
      const buttons = toolbar.querySelectorAll("button");
      const target = buttons[newIndex];
      if (target instanceof HTMLButtonElement) {
        target.focus();
      }
    }
  }

  /** Get the tabIndex for a button at the given position. */
  function tabIndexFor(index: number): number {
    return activeIndex() === index ? 0 : -1;
  }

  return (
    <Show when={selectionCount() >= 2}>
      <div class="sigil-align-panel" role="toolbar" aria-label="Alignment">
        <span class="sigil-align-panel__section-title">Align</span>
        <div class="sigil-align-panel__row" onKeyDown={handleToolbarKeyDown}>
          <button
            class="sigil-align-panel__button"
            type="button"
            aria-label="Align left"
            title="Align left"
            tabIndex={tabIndexFor(0)}
            onClick={() => executeAlign(store, alignLeft)}
          >
            <AlignStartVertical size={ICON_SIZE} />
          </button>
          <button
            class="sigil-align-panel__button"
            type="button"
            aria-label="Align center horizontally"
            title="Align center horizontally"
            tabIndex={tabIndexFor(1)}
            onClick={() => executeAlign(store, alignCenter)}
          >
            <AlignCenterVertical size={ICON_SIZE} />
          </button>
          <button
            class="sigil-align-panel__button"
            type="button"
            aria-label="Align right"
            title="Align right"
            tabIndex={tabIndexFor(2)}
            onClick={() => executeAlign(store, alignRight)}
          >
            <AlignEndVertical size={ICON_SIZE} />
          </button>
          <button
            class="sigil-align-panel__button"
            type="button"
            aria-label="Align top"
            title="Align top"
            tabIndex={tabIndexFor(3)}
            onClick={() => executeAlign(store, alignTop)}
          >
            <AlignStartHorizontal size={ICON_SIZE} />
          </button>
          <button
            class="sigil-align-panel__button"
            type="button"
            aria-label="Align center vertically"
            title="Align center vertically"
            tabIndex={tabIndexFor(4)}
            onClick={() => executeAlign(store, alignMiddle)}
          >
            <AlignCenterHorizontal size={ICON_SIZE} />
          </button>
          <button
            class="sigil-align-panel__button"
            type="button"
            aria-label="Align bottom"
            title="Align bottom"
            tabIndex={tabIndexFor(5)}
            onClick={() => executeAlign(store, alignBottom)}
          >
            <AlignEndHorizontal size={ICON_SIZE} />
          </button>
        </div>

        {/* RF-030: Distribute buttons always visible when 2+ selected, disabled when < 3. */}
        <span class="sigil-align-panel__section-title">Distribute</span>
        <div class="sigil-align-panel__row" onKeyDown={handleToolbarKeyDown}>
          <button
            class="sigil-align-panel__button"
            type="button"
            aria-label="Distribute horizontally"
            title="Distribute horizontally"
            tabIndex={tabIndexFor(6)}
            disabled={selectionCount() < 3}
            onClick={() => executeAlign(store, distributeHorizontal, 3)}
          >
            <AlignHorizontalSpaceBetween size={ICON_SIZE} />
          </button>
          <button
            class="sigil-align-panel__button"
            type="button"
            aria-label="Distribute vertically"
            title="Distribute vertically"
            tabIndex={tabIndexFor(7)}
            disabled={selectionCount() < 3}
            onClick={() => executeAlign(store, distributeVertical, 3)}
          >
            <AlignVerticalSpaceBetween size={ICON_SIZE} />
          </button>
        </div>
      </div>
    </Show>
  );
};
