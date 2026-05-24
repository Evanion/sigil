/**
 * Dialog — native HTML <dialog> implementation.
 *
 * Uses the native <dialog> element with showModal() for:
 * - Browser-native focus trap (no JavaScript focus management needed)
 * - Escape key closes the dialog (native behavior)
 * - ::backdrop pseudo-element for overlay
 * - Top layer rendering (no z-index conflicts)
 * - role="dialog" is automatic on <dialog>
 *
 * A11y audit (replacing Kobalte Dialog):
 * - aria-live regions: none in outgoing code — preserved (none)
 * - Focus management: Kobalte provided focus trap via modal — preserved via
 *   native showModal() which provides browser-native focus trap
 * - Keyboard handlers: Escape closes — preserved via native dialog close event
 * - role="dialog": automatic on <dialog> element
 * - aria-labelledby: added, pointing to title element
 * - aria-describedby: added when description is present
 * - :focus-visible: preserved in CSS
 * - Close button: preserved as <button> with aria-label="Close"
 */
import { Show, splitProps, createUniqueId, createEffect, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { X } from "lucide-solid";
import "./Dialog.css";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: JSX.Element;
  class?: string;
}

export function Dialog(props: DialogProps) {
  const [local] = splitProps(props, [
    "open",
    "onOpenChange",
    "title",
    "description",
    "children",
    "class",
  ]);

  const titleId = `sigil-dialog-title-${createUniqueId()}`;
  const descriptionId = `sigil-dialog-desc-${createUniqueId()}`;
  // eslint-disable-next-line no-unassigned-vars -- Solid's ref directive assigns this variable
  let dialogRef: HTMLDialogElement | undefined;

  const className = () => {
    const classes = ["sigil-dialog"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  // Sync open prop with dialog state
  createEffect(() => {
    if (!dialogRef) return;
    if (local.open) {
      if (!dialogRef.open) {
        dialogRef.showModal();
      }
    } else {
      if (dialogRef.open) {
        dialogRef.close();
      }
    }
  });

  // Handle native close event (fires on Escape and form[method=dialog] submit)
  function handleClose(): void {
    local.onOpenChange(false);
  }

  // Prevent click on backdrop from propagating but close dialog
  function handleDialogClick(e: MouseEvent): void {
    if (e.target === dialogRef) {
      // Click was on the backdrop (the <dialog> element itself, not content)
      local.onOpenChange(false);
    }
  }

  onCleanup(() => {
    if (dialogRef?.open) {
      dialogRef.close();
    }
  });

  return (
    <dialog
      ref={dialogRef}
      class={className()}
      onClose={handleClose}
      onClick={handleDialogClick}
      aria-labelledby={titleId}
      aria-describedby={local.description ? descriptionId : undefined}
    >
      <div class="sigil-dialog__inner">
        <div class="sigil-dialog__header">
          <h2 id={titleId} class="sigil-dialog__title">
            {local.title}
          </h2>
          <button
            class="sigil-dialog__close"
            aria-label="Close"
            onClick={() => local.onOpenChange(false)}
          >
            <X size={16} />
          </button>
        </div>
        <Show when={local.description}>
          <p id={descriptionId} class="sigil-dialog__description">
            {local.description}
          </p>
        </Show>
        <div class="sigil-dialog__body">{local.children}</div>
      </div>
    </dialog>
  );
}
