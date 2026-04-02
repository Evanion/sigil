import { Popover as KobaltePopover } from "@kobalte/core/popover";
import type { JSX } from "solid-js";
import "./Popover.css";

export type PopoverPlacement = "top" | "bottom" | "left" | "right";

export interface PopoverProps {
  /** The element that triggers the popover on click. */
  trigger: JSX.Element;
  /** Content displayed inside the popover panel. */
  children: JSX.Element;
  /** Placement of the popover relative to the trigger. Defaults to "bottom". */
  placement?: PopoverPlacement;
  /** Additional CSS class names appended to the content element. */
  class?: string;
}

export function Popover(props: PopoverProps) {
  const className = () => {
    const classes = ["sigil-popover"];
    if (props.class) classes.push(props.class);
    return classes.join(" ");
  };

  return (
    <KobaltePopover placement={props.placement ?? "bottom"}>
      <KobaltePopover.Trigger as="span">{props.trigger}</KobaltePopover.Trigger>
      <KobaltePopover.Portal>
        <KobaltePopover.Content class={className()}>
          <KobaltePopover.Arrow class="sigil-popover__arrow" />
          {props.children}
        </KobaltePopover.Content>
      </KobaltePopover.Portal>
    </KobaltePopover>
  );
}
