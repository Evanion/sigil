/**
 * The Corner Editor section that lives in DesignPanel's Appearance tab.
 *
 * Responsibilities (this task — scaffold only):
 *  - Render the preview + hotspots (delegated to CornerPreviewSvg).
 *  - On hotspot click, open the project's native Popover wrapper with
 *    CornerPopover as its content.
 *  - Route popover commits to the parent (CornerSection is itself a
 *    presentational component; the store-write happens at the
 *    DesignPanel level via the `onCorners` callback).
 *
 * Composition note — the Popover wrapper's actual API:
 *   `frontend/src/components/popover/Popover.tsx` accepts `trigger` as
 *   JSX content (NOT as an external HTMLButtonElement reference) and
 *   renders its OWN <button class="sigil-popover-trigger"> around it
 *   with `anchor-name` for CSS Anchor Positioning. The plan's
 *   suggested `trigger={anchorButton()!}` pattern (passing an external
 *   button ref) does not match the wrapper.
 *
 *   We therefore use the wrapper in **controlled mode**: it always
 *   renders, with `open` driven by `activeHotspot() !== null`. The
 *   wrapper's internal trigger button is rendered hidden (visually,
 *   aria-hidden) — the visible "triggers" remain the 9 hotspot
 *   buttons inside CornerPreviewSvg. When a hotspot is activated,
 *   CornerSection flips `activeHotspot` to that id, which (a) opens
 *   the popover via the controlled `open` prop and (b) tells
 *   CornerPopover which hotspot to edit. Visual anchoring to the
 *   clicked hotspot is a polish concern for a later task — the
 *   current popover anchors to its internal hidden trigger, which is
 *   sufficient for the scaffold + tests.
 *
 * Subsequent tasks add:
 *  - Task 14: auto-link + superellipse lock state on the preview.
 *  - Task 15: RF-038 disabled state for non-corner-bearing kinds.
 *  - Task 16: wire-up to DesignPanel + store.
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
 *                 render a greyed placeholder + an sr-only status line
 *                 explaining why the editor is unavailable, rather than
 *                 vanishing (which would surprise users who selected a
 *                 single non-corner-bearing node).
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
  const [activeHotspot, setActiveHotspot] = createSignal<HotspotId | null>(null);

  function handleHotspotActivate(id: HotspotId): void {
    setActiveHotspot(id);
  }

  function handleOpenChange(open: boolean): void {
    if (!open) setActiveHotspot(null);
  }

  function handleCommit(newCorners: Corners): void {
    props.onCorners(newCorners);
  }

  return (
    <section class="sigil-corner-section">
      <h2 class="sigil-corner-section__header">Corners</h2>
      <Show
        when={state() === "active" ? corners() : null}
        fallback={
          <div class="sigil-corner-section__disabled" data-testid="corner-section__disabled">
            <div class="sigil-corner-section__disabled-preview" aria-hidden="true" />
            <p class="sigil-corner-section__disabled-text">{DISABLED_EXPLANATION}</p>
            <span class="sigil-corner-section__sr-only" role="status">
              {DISABLED_EXPLANATION}
            </span>
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
             * Controlled-mode Popover. The wrapper renders its own
             * <button class="sigil-popover-trigger"> internally — we
             * visually hide it because the hotspot buttons inside
             * CornerPreviewSvg are the real triggers (clicking a hotspot
             * sets `activeHotspot`, which opens the popover via `open`).
             */}
            <div class="sigil-corner-section__popover-host" aria-hidden="true">
              <Popover
                open={activeHotspot() !== null}
                onOpenChange={handleOpenChange}
                trigger={<span class="sigil-corner-section__popover-anchor" />}
                placement="bottom"
                modal
              >
                <Show when={activeHotspot()}>
                  {(id) => <CornerPopover target={id()} corners={c()} onCommit={handleCommit} />}
                </Show>
              </Popover>
            </div>
          </>
        )}
      </Show>
    </section>
  );
};
