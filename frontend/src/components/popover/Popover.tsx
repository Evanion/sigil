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
 * **Modal-dialog nesting**: when a Popover renders inside an open modal
 * `<dialog>` (detected by walking `triggerRef`'s ancestors for a `:modal`
 * match on mount), the browser's native `popover="auto"` light-dismiss
 * algorithm misfires — pointerdown events inside the popover content
 * (e.g., the ColorArea canvas in ColorPicker) are incorrectly classified
 * as "outside" because the popover and the dialog occupy separate
 * top-layer entries. To avoid this, Popover switches to `popover="manual"`
 * when nested inside a modal dialog and installs its own outside-click
 * dismisser that uses DOM containment (`popoverRef.contains(target)`)
 * instead of the browser's top-layer hit-testing.
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
  onMount,
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
  // eslint-disable-next-line no-unassigned-vars
  let triggerRef: HTMLButtonElement | undefined;
  // eslint-disable-next-line no-unassigned-vars
  let popoverRef: HTMLDivElement | undefined;

  const [isOpen, setIsOpen] = createSignal(local.open ?? false);

  /**
   * True when this Popover is rendered inside an open modal `<dialog>`.
   * Detected once on mount by walking ancestors of `triggerRef`.
   * When true, we force manual popover mode and run our own outside-click
   * dismisser to work around the native light-dismiss misfire on nested
   * top-layer elements.
   */
  const [insideModalDialog, setInsideModalDialog] = createSignal(false);

  const className = () => {
    const classes = ["sigil-popover"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  const placement = () => local.placement ?? "bottom";

  /**
   * Effective modal mode — either the caller explicitly requested it
   * (local.modal) or we auto-detected a modal-dialog ancestor. Both
   * cases use `popover="manual"`; only the auto-detected case installs
   * our fallback outside-click dismisser.
   */
  const effectiveModal = () => local.modal === true || insideModalDialog();

  // For manual mode: close on Escape
  function handlePopoverKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape" && effectiveModal()) {
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

  /** Position the arrow to point at the trigger's center along the popover edge. */
  function positionArrow(): void {
    if (!popoverRef || !triggerRef) return;
    const arrow = popoverRef.querySelector(".sigil-popover__arrow") as HTMLElement | null;
    if (!arrow) return;

    const triggerRect = triggerRef.getBoundingClientRect();
    const popoverRect = popoverRef.getBoundingClientRect();
    const p = placement();

    if (p === "top" || p === "bottom") {
      // Arrow on top/bottom edge — position horizontally at trigger center
      const triggerCenterX = triggerRect.left + triggerRect.width / 2;
      const arrowLeft = triggerCenterX - popoverRect.left - 6; // 6 = half arrow size
      arrow.style.left = `${Math.max(8, Math.min(popoverRect.width - 20, arrowLeft))}px`;
      arrow.style.top = "";
      arrow.style.right = "";
      arrow.style.bottom = "";
    } else {
      // Arrow on left/right edge — position vertically at trigger center
      const triggerCenterY = triggerRect.top + triggerRect.height / 2;
      const arrowTop = triggerCenterY - popoverRect.top - 6;
      arrow.style.top = `${Math.max(8, Math.min(popoverRect.height - 20, arrowTop))}px`;
      arrow.style.left = "";
      arrow.style.right = "";
      arrow.style.bottom = "";
    }
  }

  function handleToggle(e: Event): void {
    const toggleEvent = e as ToggleEvent;
    const newOpen = toggleEvent.newState === "open";
    setIsOpen(newOpen);
    if (newOpen) {
      // Position arrow after the popover is positioned by CSS anchor
      requestAnimationFrame(positionArrow);
    }
    local.onOpenChange?.(newOpen);
  }

  function handleTriggerClick(): void {
    if (effectiveModal()) {
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

  /**
   * Walk ancestors from `triggerRef` and return true if any is an
   * open modal `<dialog>` (`.matches(':modal')`). The `:modal`
   * pseudo-class matches any element currently in the browser's
   * top-layer via `showModal()`.
   */
  function detectModalDialogAncestor(): boolean {
    if (!triggerRef) return false;
    let current: Element | null = triggerRef.parentElement;
    while (current) {
      if (current instanceof HTMLDialogElement) {
        try {
          if (current.matches(":modal")) return true;
        } catch {
          // :modal pseudo-class unsupported — fall through
        }
      }
      current = current.parentElement;
    }
    return false;
  }

  /**
   * Outside-click dismisser for auto-detected modal-dialog nesting.
   * Uses DOM containment (which works across top-layer entries)
   * instead of the browser's light-dismiss hit-test.
   */
  function handleGlobalPointerDown(e: PointerEvent): void {
    if (!isOpen()) return;
    // Only run for auto-detected nesting — callers using explicit
    // `modal=true` manage their own dismissal.
    if (local.modal === true || !insideModalDialog()) return;
    if (!popoverRef || !triggerRef) return;
    const target = e.target as Node | null;
    if (!target) return;
    if (popoverRef.contains(target) || triggerRef.contains(target)) return;
    hidePopover();
  }

  onMount(() => {
    setInsideModalDialog(detectModalDialogAncestor());
  });

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

  // Install the outside-click dismisser only while the popover is open
  // AND we're auto-detecting a modal-dialog ancestor. Capture-phase so
  // we see the event before any descendant stopPropagation calls.
  createEffect(() => {
    if (!isOpen() || local.modal === true || !insideModalDialog()) return;
    document.addEventListener("pointerdown", handleGlobalPointerDown, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", handleGlobalPointerDown, true);
    });
  });

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
        popovertarget={effectiveModal() ? undefined : popoverId}
        onClick={handleTriggerClick}
        style={{ "anchor-name": anchorName }}
      >
        {local.trigger}
      </button>
      <div
        ref={popoverRef}
        id={popoverId}
        popover={effectiveModal() ? "manual" : "auto"}
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
        <div class="sigil-popover__arrow" />
        <Show when={isOpen()}>{local.children}</Show>
      </div>
    </>
  );
}
