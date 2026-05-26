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
  /**
   * The element that triggers the popover on click. Ignored when `anchorRef`
   * is provided — in that case the caller-owned external element is the
   * anchor and the wrapper does not render its own internal trigger button.
   */
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
  /**
   * Optional external anchor element. When provided, the wrapper does NOT
   * render its internal trigger button — the `trigger` prop is ignored.
   * Instead, the wrapper:
   *   1. applies `anchor-name: <unique-id>` to this element via inline style
   *      so CSS Anchor Positioning resolves the popover's `position-anchor`
   *      reference against it,
   *   2. mirrors the ARIA expand-state attributes (`aria-expanded`,
   *      `aria-controls`, `aria-haspopup`) onto the element so screen
   *      readers announce it as the controlling trigger,
   *   3. continues to honor controlled `open` / `onOpenChange`.
   *
   * The caller is responsible for wiring click/focus handlers on the
   * external element to toggle `open`. The wrapper does NOT install
   * click handlers on the external anchor — that would conflict with
   * the caller's own behavior (e.g., a corner hotspot that does its
   * own selection/focus management).
   *
   * Passing `null` is treated identically to omitting the prop —
   * the wrapper falls back to its internal trigger button.
   */
  anchorRef?: HTMLElement | null;
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
    "anchorRef",
  ]);

  /**
   * True when the caller supplied an external anchor element. The internal
   * trigger button is omitted and ARIA + anchor-name are mirrored onto the
   * caller's element instead. Using a function so the JSX read is reactive
   * if the prop transitions between null/element values across renders.
   */
  const useExternalAnchor = () => local.anchorRef != null;

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

  /** Position the arrow to point at the anchor's center along the popover edge. */
  function positionArrow(): void {
    if (!popoverRef) return;
    const anchor = local.anchorRef ?? triggerRef;
    if (!anchor) return;
    const arrow = popoverRef.querySelector(".sigil-popover__arrow") as HTMLElement | null;
    if (!arrow) return;

    const triggerRect = anchor.getBoundingClientRect();
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
   * Walk ancestors from the anchor (external `anchorRef` if provided,
   * otherwise the internal `triggerRef`) and return true if any is an
   * open modal `<dialog>` (`.matches(':modal')`). The `:modal`
   * pseudo-class matches any element currently in the browser's
   * top-layer via `showModal()`.
   */
  function detectModalDialogAncestor(): boolean {
    const start = local.anchorRef ?? triggerRef;
    if (!start) return false;
    let current: Element | null = start.parentElement;
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
    if (!popoverRef) return;
    const anchor = local.anchorRef ?? triggerRef;
    if (!anchor) return;
    const target = e.target as Node | null;
    if (!target) return;
    if (popoverRef.contains(target) || anchor.contains(target)) return;
    hidePopover();
  }

  onMount(() => {
    setInsideModalDialog(detectModalDialogAncestor());
  });

  /**
   * External-anchor effect: when `anchorRef` is provided, mirror the
   * anchor-name and static ARIA attributes (`aria-controls`,
   * `aria-haspopup`) onto the caller's element. Tracks the previously-
   * managed element so we can fully clean up its anchor-name and ARIA
   * attributes if the prop changes or the wrapper unmounts.
   *
   * `aria-expanded` is updated by a separate effect (below) so that it
   * tracks the reactive `isOpen()` signal without re-running this
   * setup-and-teardown effect on every open/close.
   */
  let managedAnchor: HTMLElement | null = null;
  function clearExternalAnchor(el: HTMLElement | null): void {
    if (!el) return;
    el.style.removeProperty("anchor-name");
    el.removeAttribute("aria-controls");
    el.removeAttribute("aria-haspopup");
    el.removeAttribute("aria-expanded");
  }
  createEffect(() => {
    const next = local.anchorRef ?? null;
    if (next === managedAnchor) return;
    // Clear the previously-managed element before adopting the new one.
    clearExternalAnchor(managedAnchor);
    managedAnchor = next;
    if (!next) return;
    next.style.setProperty("anchor-name", anchorName);
    next.setAttribute("aria-controls", popoverId);
    next.setAttribute("aria-haspopup", "dialog");
    // Seed aria-expanded with the current open state. The expand-state
    // effect below will keep it in sync going forward.
    next.setAttribute("aria-expanded", isOpen() ? "true" : "false");
  });

  /**
   * Mirror `aria-expanded` on the external anchor whenever the open state
   * changes. Kept separate from the setup effect so that opening/closing
   * does not re-trigger anchor-name reassignment or other DOM mutation.
   */
  createEffect(() => {
    const el = managedAnchor;
    if (!el) return;
    el.setAttribute("aria-expanded", isOpen() ? "true" : "false");
  });

  onCleanup(() => {
    clearExternalAnchor(managedAnchor);
    managedAnchor = null;
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
      <Show when={!useExternalAnchor()}>
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
      </Show>
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
