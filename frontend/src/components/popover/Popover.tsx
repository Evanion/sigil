/**
 * Popover — native HTML popover implementation.
 *
 * Uses the HTML `popover` attribute for top-layer rendering, which avoids
 * the JavaScript-based layer stack issues (e.g., body.style.pointerEvents = "none")
 * that break popovers inside modal dialogs.
 *
 * - `popover="auto"` (default): light dismiss (click outside closes), Escape closes
 * - `popover="manual"` (modal=true): no light dismiss, must be closed programmatically
 *
 * Children are lazily rendered (only mounted when the popover is open) to match
 * Kobalte's Portal behavior and avoid duplicate DOM elements from color pickers
 * and other interactive content.
 *
 * Positioning is computed manually since CSS Anchor Positioning is not yet
 * fully supported across browsers.
 *
 * A11y audit (replacing Kobalte Popover):
 * - Trigger: preserved as <button> with aria-label
 * - Focus trap: not provided by native popover; modal=true consumers (ColorSwatch,
 *   GradientEditorPopover) handle focus internally via their interactive controls
 * - Escape to close: preserved via native popover behavior (auto mode) and
 *   manual keydown handler (manual mode)
 * - Light dismiss: preserved via native popover="auto"
 * - aria-expanded: added on trigger button
 * - :focus-visible: preserved in CSS
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
   * The popover must be closed programmatically or via Escape.
   * Use for color pickers and gradient editors where continuous interaction
   * is needed without accidental dismissal.
   */
  modal?: boolean;
  /** Accessible label for the trigger button. */
  triggerAriaLabel?: string;
  /** Controlled open state. When provided, the popover is controlled externally. */
  open?: boolean;
  /** Called when the popover's open state changes (controlled mode). */
  onOpenChange?: (open: boolean) => void;
}

const POPOVER_GAP = 8;

/**
 * Compute fixed position for the popover relative to the trigger.
 *
 * All numeric values are guarded with Number.isFinite() per CLAUDE.md.
 */
function positionPopover(
  popoverEl: HTMLElement,
  triggerEl: HTMLElement,
  placement: PopoverPlacement,
): void {
  const triggerRect = triggerEl.getBoundingClientRect();
  const popoverRect = popoverEl.getBoundingClientRect();

  let top = 0;
  let left = 0;

  switch (placement) {
    case "bottom":
      top = triggerRect.bottom + POPOVER_GAP;
      left = triggerRect.left + triggerRect.width / 2 - popoverRect.width / 2;
      break;
    case "top":
      top = triggerRect.top - popoverRect.height - POPOVER_GAP;
      left = triggerRect.left + triggerRect.width / 2 - popoverRect.width / 2;
      break;
    case "left":
      top = triggerRect.top + triggerRect.height / 2 - popoverRect.height / 2;
      left = triggerRect.left - popoverRect.width - POPOVER_GAP;
      break;
    case "right":
      top = triggerRect.top + triggerRect.height / 2 - popoverRect.height / 2;
      left = triggerRect.right + POPOVER_GAP;
      break;
  }

  // Guard against NaN/Infinity (CLAUDE.md §11 floating-point validation)
  if (!Number.isFinite(top)) top = 0;
  if (!Number.isFinite(left)) left = 0;

  popoverEl.style.position = "fixed";
  popoverEl.style.top = `${top}px`;
  popoverEl.style.left = `${left}px`;
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

  const popoverId = `sigil-popover-${createUniqueId()}`;
  // eslint-disable-next-line no-unassigned-vars -- Solid's ref directive assigns this variable
  let triggerRef: HTMLButtonElement | undefined;
  // eslint-disable-next-line no-unassigned-vars -- Solid's ref directive assigns this variable
  let popoverRef: HTMLDivElement | undefined;

  // Internal open state — tracks whether the popover is currently open.
  // Used for lazy rendering of children (Show) and aria-expanded.
  const [isOpen, setIsOpen] = createSignal(local.open ?? false);

  const className = () => {
    const classes = ["sigil-popover"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  // For manual mode: close on Escape key
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
      // Already showing or element removed — ignore
    }
  }

  function hidePopover(): void {
    if (!popoverRef) return;
    try {
      popoverRef.hidePopover();
    } catch {
      // Already hidden or element removed — ignore
    }
  }

  // Handle the native toggle event to sync controlled state
  function handleToggle(e: Event): void {
    const toggleEvent = e as ToggleEvent;
    const newOpen = toggleEvent.newState === "open";

    setIsOpen(newOpen);

    if (newOpen && popoverRef && triggerRef) {
      // Position after the content is rendered; use rAF so the popover
      // dimensions are available after the Show renders children.
      requestAnimationFrame(() => {
        if (popoverRef && triggerRef) {
          positionPopover(popoverRef, triggerRef, local.placement ?? "bottom");
        }
      });
    }

    local.onOpenChange?.(newOpen);
  }

  // For manual mode: handle trigger click manually since popovertarget
  // only works for auto popovers
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
        // :popover-open not supported — try toggling
        showPopover();
      }
    }
    // For auto mode, popovertarget handles it
  }

  // Controlled mode: sync open prop with popover state
  createEffect(() => {
    const shouldBeOpen = local.open;
    if (shouldBeOpen === undefined || !popoverRef) return;

    if (shouldBeOpen) {
      showPopover();
    } else {
      hidePopover();
    }
  });

  // Cleanup: ensure popover is closed on unmount
  onCleanup(() => {
    hidePopover();
  });

  return (
    <>
      <button
        ref={triggerRef}
        class="sigil-popover-trigger"
        aria-label={local.triggerAriaLabel}
        aria-expanded={isOpen()}
        aria-controls={popoverId}
        popovertarget={local.modal ? undefined : popoverId}
        onClick={handleTriggerClick}
      >
        {local.trigger}
      </button>
      <div
        ref={popoverRef}
        id={popoverId}
        popover={local.modal ? "manual" : "auto"}
        class={className()}
        onKeyDown={handlePopoverKeyDown}
        onToggle={handleToggle}
      >
        <Show when={isOpen()}>{local.children}</Show>
      </div>
    </>
  );
}
