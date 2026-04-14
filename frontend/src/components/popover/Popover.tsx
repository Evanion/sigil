import { Popover as KobaltePopover } from "@kobalte/core/popover";
import { type JSX, splitProps } from "solid-js";
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
  /**
   * When true, the popover behaves as a modal: interaction with outside
   * elements is disabled, focus is trapped inside the popover content.
   * Required when the popover is inside a modal Dialog — without this,
   * the Dialog's pointer-blocking layer disables pointer events on the
   * popover content (Kobalte layer stack assigns pointer-events: none
   * to non-modal layers below a pointer-blocking layer).
   */
  modal?: boolean;
  /** Accessible label for the trigger button. */
  triggerAriaLabel?: string;
  /** Controlled open state. When provided, the popover is controlled externally. */
  open?: boolean;
  /** Called when the popover's open state changes (controlled mode). */
  onOpenChange?: (open: boolean) => void;
}

export function Popover(props: PopoverProps) {
  const [local, others] = splitProps(props, [
    "trigger",
    "children",
    "placement",
    "class",
    "modal",
    "triggerAriaLabel",
    "open",
    "onOpenChange",
  ]);

  const className = () => {
    const classes = ["sigil-popover"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <KobaltePopover
      placement={local.placement ?? "bottom"}
      open={local.open}
      onOpenChange={local.onOpenChange}
      modal={local.modal}
      {...others}
    >
      <KobaltePopover.Trigger class="sigil-popover-trigger" aria-label={local.triggerAriaLabel}>
        {local.trigger}
      </KobaltePopover.Trigger>
      <KobaltePopover.Portal>
        <KobaltePopover.Content class={className()}>
          <KobaltePopover.Arrow class="sigil-popover__arrow" />
          {local.children}
        </KobaltePopover.Content>
      </KobaltePopover.Portal>
    </KobaltePopover>
  );
}
