import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip";
import type { TooltipTriggerRenderProps } from "@kobalte/core/tooltip";
import { splitProps } from "solid-js";
import type { JSX } from "solid-js";
import "./Tooltip.css";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** Text content displayed inside the tooltip. */
  content: string;
  /** Placement of the tooltip relative to the trigger. Defaults to "top". */
  placement?: TooltipPlacement;
  /**
   * Render function that receives the Kobalte trigger props and returns the
   * trigger element. Use the spread pattern to forward all event handlers and
   * ARIA attributes onto the interactive element:
   *
   *   <Tooltip content="Save">
   *     {(triggerProps) => <button {...triggerProps}>Save</button>}
   *   </Tooltip>
   *
   * This avoids nesting a Kobalte-generated <button> wrapper around the child,
   * which would produce invalid HTML (nested <button> elements) and violates
   * CLAUDE.md §5: "Never override Kobalte trigger or interactive primitives
   * with non-interactive elements."
   */
  children: (triggerProps: TooltipTriggerRenderProps) => JSX.Element;
  /** Delay in ms before the tooltip opens. Defaults to 300. */
  openDelay?: number;
  /** Delay in ms before the tooltip closes. Defaults to 0. */
  closeDelay?: number;
}

/**
 * Internal passthrough component used as the `as` target for Kobalte's
 * Tooltip.Trigger. Kobalte's Polymorphic component calls this with the merged
 * trigger render props (event handlers, aria-describedby, ref) plus `children`
 * from the outer Tooltip. We split `children` out and call it as a render
 * function, forwarding the remaining trigger props onto the returned element.
 */
type TriggerPassthroughProps = TooltipTriggerRenderProps & {
  children: (triggerProps: TooltipTriggerRenderProps) => JSX.Element;
};

function TriggerPassthrough(props: TriggerPassthroughProps) {
  const [local, triggerProps] = splitProps(props, ["children"]);
  return local.children(triggerProps as TooltipTriggerRenderProps);
}

export function Tooltip(props: TooltipProps) {
  return (
    <KobalteTooltip
      placement={props.placement ?? "top"}
      openDelay={props.openDelay ?? 300}
      closeDelay={props.closeDelay ?? 0}
    >
      <KobalteTooltip.Trigger as={TriggerPassthrough}>
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
