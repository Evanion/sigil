/**
 * GradientEditorPopover — popover that wraps GradientControls with a
 * gradient swatch trigger and a "Repeating" toggle.
 *
 * The swatch shows a CSS gradient preview. Clicking it opens the popover
 * with the full gradient editor (type tabs, stop editor, angle/center controls).
 *
 * Uses `modal` so that focus is trapped and the popover works correctly
 * inside modal dialogs (Kobalte's layer stack requires modal popovers
 * to receive pointer events when a pointer-blocking dialog is open).
 *
 * All numeric values are guarded with Number.isFinite() per CLAUDE.md.
 */
import { createMemo } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import type {
  Fill,
  FillConicGradient,
  FillLinearGradient,
  FillRadialGradient,
} from "../types/document";
import { Popover } from "../components/popover/Popover";
import {
  angleFromPoints,
  stopsToLinearGradientCSS,
  stopsToRadialGradientCSS,
  stopsToConicGradientCSS,
} from "../components/gradient-editor/gradient-utils";
import { GradientControls } from "./GradientControls";
import "./GradientEditorPopover.css";

export interface GradientEditorPopoverProps {
  readonly fill: FillLinearGradient | FillRadialGradient | FillConicGradient;
  readonly onUpdate: (fill: Fill) => void;
  /**
   * Called when a continuous drag gesture begins inside gradient controls.
   * Parent should flush pending history buffer to start a fresh coalesce window.
   */
  readonly onDragStart?: () => void;
  /**
   * Called when a continuous drag gesture ends inside gradient controls.
   * Parent should flush the history buffer to commit the drag as one undo entry.
   */
  readonly onDragEnd?: () => void;
}

/**
 * GradientSwatch — small gradient preview showing the CSS gradient.
 *
 * Renders a div with the gradient as `background`. Used as the popover trigger.
 */
function GradientSwatch(props: {
  readonly fill: FillLinearGradient | FillRadialGradient | FillConicGradient;
}) {
  const gradientCSS = createMemo((): string => {
    const sorted = [...props.fill.gradient.stops].sort((a, b) => a.position - b.position);
    const repeating = props.fill.gradient.repeating;

    switch (props.fill.type) {
      case "linear_gradient": {
        const angle = angleFromPoints(props.fill.gradient.start, props.fill.gradient.end);
        return stopsToLinearGradientCSS(sorted, angle, repeating);
      }
      case "radial_gradient":
        return stopsToRadialGradientCSS(sorted, repeating);
      case "conic_gradient":
        return stopsToConicGradientCSS(sorted, props.fill.gradient.start_angle, repeating);
    }
  });

  return <div class="sigil-gradient-swatch" style={{ background: gradientCSS() }} />;
}

export function GradientEditorPopover(props: GradientEditorPopoverProps) {
  const [t] = useTransContext();

  const isRepeating = createMemo((): boolean => {
    return props.fill.gradient.repeating === true;
  });

  function handleRepeatingToggle(e: Event): void {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    const checked = target.checked;
    const fill = props.fill;

    if (fill.type === "linear_gradient") {
      props.onUpdate({
        ...fill,
        gradient: { ...fill.gradient, repeating: checked },
      });
    } else if (fill.type === "radial_gradient") {
      props.onUpdate({
        ...fill,
        gradient: { ...fill.gradient, repeating: checked },
      });
    } else if (fill.type === "conic_gradient") {
      props.onUpdate({
        ...fill,
        gradient: { ...fill.gradient, repeating: checked },
      });
    }
  }

  function handleGradientUpdate(updatedFill: Fill): void {
    props.onUpdate(updatedFill);
  }

  return (
    <Popover
      trigger={<GradientSwatch fill={props.fill} />}
      triggerAriaLabel={t("panels:gradient.editGradient")}
      placement="bottom"
    >
      <div class="sigil-gradient-editor-popover">
        <GradientControls
          fill={props.fill}
          onUpdate={handleGradientUpdate}
          onDragStart={props.onDragStart}
          onDragEnd={props.onDragEnd}
        />
        <div class="sigil-gradient-editor-popover__footer">
          <label>
            <input type="checkbox" checked={isRepeating()} onChange={handleRepeatingToggle} />
            {t("panels:gradient.repeating")}
          </label>
        </div>
      </div>
    </Popover>
  );
}
