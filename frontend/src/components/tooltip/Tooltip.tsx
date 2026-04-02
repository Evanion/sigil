import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip";
import type { JSX } from "solid-js";
import "./Tooltip.css";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** Text content displayed inside the tooltip. */
  content: string;
  /** Placement of the tooltip relative to the trigger. Defaults to "top". */
  placement?: TooltipPlacement;
  /** The trigger element that activates the tooltip on hover/focus. */
  children: JSX.Element;
  /** Delay in ms before the tooltip opens. Defaults to 300. */
  openDelay?: number;
  /** Delay in ms before the tooltip closes. Defaults to 0. */
  closeDelay?: number;
}

export function Tooltip(props: TooltipProps) {
  return (
    <KobalteTooltip
      placement={props.placement ?? "top"}
      openDelay={props.openDelay ?? 300}
      closeDelay={props.closeDelay ?? 0}
    >
      <KobalteTooltip.Trigger as="span">
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
}
