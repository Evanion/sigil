/**
 * The Corner Editor section that lives in DesignPanel's Appearance tab.
 *
 * Responsibilities:
 *  - Render the preview + hotspots (delegated to CornerPreviewSvg).
 *  - On hotspot click, open the project's native Popover wrapper with
 *    CornerPopover as its content, anchored visually at the clicked
 *    hotspot via the Popover wrapper's `anchorRef` prop.
 *  - Restore focus to the activating hotspot when the popover closes
 *    (Escape, light-dismiss outside click, commit).
 *  - Route popover commits to the parent (CornerSection is itself a
 *    presentational component; the store-write happens at the
 *    DesignPanel level via the `onCorners` callback).
 *
 * Anchoring (RF-001 / Batch A landed in ac39fc6):
 *   The Popover wrapper accepts an external `anchorRef: HTMLElement | null`
 *   prop. When provided, the wrapper skips rendering its internal
 *   trigger button, applies CSS Anchor Positioning to the external
 *   element (so the popover floats over the clicked hotspot), and
 *   mirrors ARIA expand-state attributes onto it. CornerSection captures
 *   the clicked hotspot element from CornerPreviewSvg's onHotspotActivate
 *   callback and feeds it into the wrapper as the anchor.
 *
 * Focus return (RF-002):
 *   The activating element is also remembered separately as
 *   `lastTriggerEl` so we can restore focus when the popover closes —
 *   `anchorEl` is cleared eagerly on close to release the ARIA mirror,
 *   but focus restoration needs the element AFTER the popover unmount
 *   completes. The restore call is scheduled via `queueMicrotask` so the
 *   popover's own cleanup runs first (otherwise it can steal focus back
 *   to its default placement).
 */

import type { Component } from "solid-js";
import { createMemo, createSignal, Show } from "solid-js";
import type { Corners, DocumentNode } from "../../types/document";
import { Popover } from "../../components/popover/Popover";
import { CornerPreviewSvg } from "./CornerPreviewSvg";
import { CornerPopover } from "./CornerPopover";
import { isSuperellipseUniform, type HotspotId } from "./corner-section-state";
import "./CornerSection.css";

interface CornerSectionProps {
  readonly node: DocumentNode;
  /** Called when the user commits a corner change. Parent forwards to
   *  `store.setCorners(node.uuid, corners)`. */
  readonly onCorners: (corners: Corners) => void;
}

/**
 * Returns the node's `corners` tuple if the node is corner-bearing
 * (rectangle, frame, image), otherwise null. Task 15 renders a disabled
 * placeholder (rather than hiding the section) for non-corner-bearing
 * kinds — see `sectionState` below and the RF-038 entry in Spec 14 §13.
 */
function getCorners(node: DocumentNode): Corners | null {
  if (node.kind.type === "rectangle" || node.kind.type === "frame" || node.kind.type === "image") {
    return node.kind.corners;
  }
  return null;
}

/**
 * Tri-state for the section, per Spec 14 §13 RF-038:
 *  - "active"   — node is rectangle / frame / image; render the preview
 *                 + hotspots + popover.
 *  - "disabled" — node is ellipse / text / group / path / component_instance;
 *                 render a greyed placeholder + a visible <p> with the
 *                 explanation (in the reading flow — RF-014 removed the
 *                 duplicate role="status" span that flooded SR queues on
 *                 every selection change). Choosing not-vanishing keeps the
 *                 panel layout stable when users select a single
 *                 non-corner-bearing node.
 *
 * The component's `node` prop is non-nullable, so there is no
 * "no-selection" branch — the parent gates rendering when nothing is
 * selected.
 */
type CornerSectionState = "active" | "disabled";

function sectionState(node: DocumentNode): CornerSectionState {
  const kind = node.kind.type;
  if (kind === "rectangle" || kind === "frame" || kind === "image") return "active";
  return "disabled";
}

const DISABLED_EXPLANATION = "Corner radius applies to rectangles, frames, and images only.";

export const CornerSection: Component<CornerSectionProps> = (props) => {
  const state = createMemo<CornerSectionState>(() => sectionState(props.node));
  const corners = createMemo<Corners | null>(() => getCorners(props.node));
  const locked = createMemo(() => {
    const c = corners();
    return c !== null && isSuperellipseUniform(c);
  });

  /**
   * Which hotspot is currently being edited. Drives both (a) the
   * Popover wrapper's `open` prop, and (b) which corner indices
   * CornerPopover targets.
   */
  const [activeHotspot, setActiveHotspot] = createSignal<HotspotId | null>(null);
  /**
   * The DOM element the popover is currently anchored to. Passed to the
   * Popover wrapper as `anchorRef` — see the wrapper's external-anchor
   * effect for the CSS Anchor Positioning + ARIA mirror behavior. Cleared
   * on close so the wrapper releases its ARIA mutations on the hotspot.
   */
  const [anchorEl, setAnchorEl] = createSignal<HTMLButtonElement | null>(null);
  /**
   * The most-recent activating element, retained beyond `anchorEl` so we
   * can restore focus to it after the popover closes (RF-002). We can't
   * read `anchorEl()` for this because it's cleared in handleOpenChange
   * BEFORE the focus restoration so the wrapper releases its ARIA
   * mirroring; `lastTriggerEl` outlives that clear and is the focus
   * target.
   */
  const [lastTriggerEl, setLastTriggerEl] = createSignal<HTMLButtonElement | null>(null);

  function handleHotspotActivate(id: HotspotId, element: HTMLButtonElement): void {
    setAnchorEl(element);
    setLastTriggerEl(element);
    setActiveHotspot(id);
  }

  function handleOpenChange(open: boolean): void {
    if (open) return;
    // Capture the focus-return target BEFORE clearing the anchor — the
    // anchor clear releases the wrapper's ARIA mirroring eagerly so the
    // hotspot's aria-expanded flips back to "false" immediately, but
    // focus restoration must outlive that clear because the popover's
    // own onCleanup may run between now and the next microtask.
    const trigger = lastTriggerEl();
    setActiveHotspot(null);
    setAnchorEl(null);
    // Restore focus AFTER the wrapper's teardown completes. Without this
    // microtask deferral the popover's hidePopover() implementation can
    // steal focus back to its default placement, defeating the restore.
    queueMicrotask(() => {
      trigger?.focus();
    });
  }

  function handleCommit(newCorners: Corners): void {
    props.onCorners(newCorners);
  }

  return (
    <section class="sigil-corner-section">
      {/*
       * RF-010: heading level is h3 (matches sibling sections like
       * TypographySection). Previously h2 — which jumped the document's
       * outline because DesignPanel's panel container starts headings at
       * h2-or-h3 and consistent siblings render at the same level.
       */}
      <h3 class="sigil-corner-section__header">Corners</h3>
      <Show
        when={state() === "active" ? corners() : null}
        fallback={
          <div class="sigil-corner-section__disabled" data-testid="corner-section__disabled">
            <div class="sigil-corner-section__disabled-preview" aria-hidden="true" />
            {/*
             * RF-014: the visible <p> is the sole carrier of the
             * explanation. A prior duplicate sr-only role="status" span
             * re-fired an SR announcement every time the user selected a
             * non-corner-bearing node — flooding the live-region queue
             * (banned by a11y-rules.md "aria-live Regions Must Be Scoped
             * to Discrete Status Changes"). The <p> is already in the
             * reading flow; SR users hear it on first focus into the panel.
             */}
            <p class="sigil-corner-section__disabled-text">{DISABLED_EXPLANATION}</p>
          </div>
        }
      >
        {(c) => (
          <>
            <CornerPreviewSvg
              corners={c()}
              onHotspotActivate={handleHotspotActivate}
              nonCenterHotspotsDisabled={locked()}
            />
            {/*
             * Popover anchored directly at the clicked hotspot via the
             * wrapper's `anchorRef` prop. The wrapper skips rendering
             * its own trigger button when `anchorRef` is provided —
             * there is no aria-hidden host wrapper anymore (RF-001).
             *
             * `trigger` is required by the Popover prop type even when
             * `anchorRef` is supplied (the wrapper ignores it in that
             * mode), so we pass an empty fragment.
             */}
            <Popover
              open={activeHotspot() !== null}
              onOpenChange={handleOpenChange}
              anchorRef={anchorEl()}
              trigger={null}
              placement="bottom"
              modal
            >
              <Show when={activeHotspot()}>
                {(id) => <CornerPopover target={id()} corners={c()} onCommit={handleCommit} />}
              </Show>
            </Popover>
          </>
        )}
      </Show>
    </section>
  );
};
