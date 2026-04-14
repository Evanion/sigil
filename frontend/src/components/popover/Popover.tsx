/**
 * Popover — native HTML popover with CSS Anchor Positioning.
 *
 * Uses the HTML `popover` attribute for top-layer rendering and
 * CSS Anchor Positioning (`anchor-name`, `position-anchor`, `position-area`,
 * `position-try-fallbacks`) for viewport-aware positioning.
 *
 * - `popover="auto"` (default): light dismiss (click outside closes)
 * - `popover="manual"` (modal=true): no light dismiss, close via Escape or programmatically
 *
 * The arrow is a CSS pseudo-element (::before) that points toward the trigger.
 */
import {
  type JSX,
  Show,
  splitProps,
  createSignal,
  createUniqueId,
  createEffect,
  onCleanup,
} from "solid-js";
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
   * When true, the popover uses popover="manual" — no light dismiss.
   * Must be closed programmatically or via Escape.
   */
  modal?: boolean;
  /** Accessible label for the trigger button. */
  triggerAriaLabel?: string;
  /** Controlled open state. */
  open?: boolean;
  /** Called when the popover's open state changes. */
  onOpenChange?: (open: boolean) => void;
}

/** Map placement prop to CSS position-area value. */
function placementToPositionArea(placement: PopoverPlacement): string {
  switch (placement) {
    case "bottom":
      return "bottom";
    case "top":
      return "top";
    case "left":
      return "left";
    case "right":
      return "right";
  }
}

/** Map placement to position-try-fallbacks for viewport flipping. */
function placementToTryFallbacks(placement: PopoverPlacement): string {
  switch (placement) {
    case "bottom":
    case "top":
      return "flip-block";
    case "left":
    case "right":
      return "flip-inline";
  }
}

export function Popover(props: PopoverProps) {
  const [local] = splitProps(props, [
    "trigger",
    "children",
    "placement",
    "class",
    "modal",
    "triggerAriaLabel",
    "open",
    "onOpenChange",
  ]);

  const anchorName = `--sigil-popover-anchor-${createUniqueId()}`;
  const popoverId = `sigil-popover-${createUniqueId()}`;
  let popoverRef: HTMLDivElement | undefined;

  const [isOpen, setIsOpen] = createSignal(local.open ?? false);

  const className = () => {
    const classes = ["sigil-popover"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  const placement = () => local.placement ?? "bottom";

  // For manual mode: close on Escape
  function handlePopoverKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape" && local.modal) {
      e.preventDefault();
      e.stopPropagation();
      hidePopover();
    }
  }

  function showPopover(): void {
    if (!popoverRef) return;
    try {
      popoverRef.showPopover();
    } catch {
      // Already showing or element removed
    }
  }

  function hidePopover(): void {
    if (!popoverRef) return;
    try {
      popoverRef.hidePopover();
    } catch {
      // Already hidden or element removed
    }
  }

  function handleToggle(e: Event): void {
    const toggleEvent = e as ToggleEvent;
    const newOpen = toggleEvent.newState === "open";
    setIsOpen(newOpen);
    local.onOpenChange?.(newOpen);
  }

  function handleTriggerClick(): void {
    if (local.modal) {
      if (!popoverRef) return;
      try {
        if (popoverRef.matches(":popover-open")) {
          hidePopover();
        } else {
          showPopover();
        }
      } catch {
        showPopover();
      }
    }
  }

  // Controlled mode
  createEffect(() => {
    const shouldBeOpen = local.open;
    if (shouldBeOpen === undefined || !popoverRef) return;
    if (shouldBeOpen) {
      showPopover();
    } else {
      hidePopover();
    }
  });

  onCleanup(() => {
    hidePopover();
  });

  return (
    <>
      <button
        class="sigil-popover-trigger"
        aria-label={local.triggerAriaLabel}
        aria-expanded={isOpen()}
        aria-controls={popoverId}
        popovertarget={local.modal ? undefined : popoverId}
        onClick={handleTriggerClick}
        style={{ "anchor-name": anchorName }}
      >
        {local.trigger}
      </button>
      <div
        ref={popoverRef}
        id={popoverId}
        popover={local.modal ? "manual" : "auto"}
        class={className()}
        classList={{
          "sigil-popover--top": placement() === "top",
          "sigil-popover--bottom": placement() === "bottom",
          "sigil-popover--left": placement() === "left",
          "sigil-popover--right": placement() === "right",
        }}
        onKeyDown={handlePopoverKeyDown}
        onToggle={handleToggle}
        style={{
          "position-anchor": anchorName,
          "position-area": placementToPositionArea(placement()),
          "position-try-fallbacks": placementToTryFallbacks(placement()),
        }}
      >
        <div
          class="sigil-popover__arrow"
          style={{ "position-anchor": anchorName }}
        />
        <Show when={isOpen()}>{local.children}</Show>
      </div>
    </>
  );
}
