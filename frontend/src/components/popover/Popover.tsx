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
   * Prevent closing when clicking/focusing inside the popover content.
   * Use for editor popovers (color picker, gradient editor) that need
   * continuous interaction. Default: false (popover closes normally).
   */
  preventDismissOnInteract?: boolean;
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
    "preventDismissOnInteract",
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
      {...others}
    >
      <KobaltePopover.Trigger class="sigil-popover-trigger" aria-label={local.triggerAriaLabel}>
        {local.trigger}
      </KobaltePopover.Trigger>
      <KobaltePopover.Portal>
        <KobaltePopover.Content
          class={className()}
          {...(local.preventDismissOnInteract
            ? {
                onPointerDownOutside: (e: Event) => e.preventDefault(),
                onFocusOutside: (e: Event) => e.preventDefault(),
              }
            : {})}
        >
          <KobaltePopover.Arrow class="sigil-popover__arrow" />
          {local.children}
        </KobaltePopover.Content>
      </KobaltePopover.Portal>
    </KobaltePopover>
  );
}
