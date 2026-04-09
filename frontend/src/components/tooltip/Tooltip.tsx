import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip";
import type { Component, JSX } from "solid-js";
import "./Tooltip.css";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** Text content displayed inside the tooltip. */
  content: string;
  /** Placement of the tooltip relative to the trigger. Defaults to "top". */
  placement?: TooltipPlacement;
  /**
   * The trigger element content. Kobalte renders a `<button>` wrapper
   * automatically — do NOT pass a `<button>` as a child (it would nest).
   * Pass icon/text content directly.
   */
  children: JSX.Element;
  /** Delay in ms before the tooltip opens. Defaults to 300. */
  openDelay?: number;
  /** Delay in ms before the tooltip closes. Defaults to 0. */
  closeDelay?: number;
  /** Additional CSS class(es) for the trigger button. */
  triggerClass?: string;
  /** ARIA label for the trigger button. */
  "aria-label"?: string;
  /** ARIA pressed state for toggle buttons. */
  "aria-pressed"?: boolean;
  /** Callback when the trigger is clicked. */
  onClick?: () => void;
  /** Tab index for the trigger button. */
  tabIndex?: number;
  /** Ref callback for the trigger button element. */
  ref?: (el: HTMLButtonElement) => void;
}

/**
 * Tooltip wrapper using Kobalte. Renders a `<button>` trigger with tooltip.
 * Pass icon/text content as children — do not wrap in another `<button>`.
 */
export const Tooltip: Component<TooltipProps> = (props) => {
  return (
    <KobalteTooltip
      placement={props.placement ?? "top"}
      openDelay={props.openDelay ?? 300}
      closeDelay={props.closeDelay ?? 0}
    >
      <KobalteTooltip.Trigger
        class={props.triggerClass}
        aria-label={props["aria-label"]}
        aria-pressed={props["aria-pressed"]}
        onClick={props.onClick}
        tabIndex={props.tabIndex}
        ref={props.ref}
      >
        {props.children}
      </KobalteTooltip.Trigger>
      <KobalteTooltip.Portal>
        <KobalteTooltip.Content class="sigil-tooltip">
          <KobalteTooltip.Arrow class="sigil-tooltip__arrow" />
          {props.content}
        </KobalteTooltip.Content>
      </KobalteTooltip.Portal>
    </KobalteTooltip>
  );
};
