import { Dialog as KobalteDialog } from "@kobalte/core/dialog";
import { Show, splitProps } from "solid-js";
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
  const [local, others] = splitProps(props, [
    "open",
    "onOpenChange",
    "title",
    "description",
    "children",
    "class",
  ]);

  const className = () => {
    const classes = ["sigil-dialog"];
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <KobalteDialog open={local.open} onOpenChange={local.onOpenChange} modal {...others}>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay class="sigil-dialog__overlay" />
        <KobalteDialog.Content
          class={className()}
          onPointerDownOutside={(e: Event) => {
            // Allow interaction with portaled popovers (color pickers, gradient editors)
            // that were opened from within this dialog. Kobalte portals these to the
            // document body, so the Dialog sees them as "outside" interactions.
            const target = e.target as HTMLElement | null;
            if (target?.closest(".sigil-popover, .sigil-color-picker-popover")) {
              e.preventDefault();
            }
          }}
          onFocusOutside={(e: Event) => {
            // Same — allow focus to move to portaled popovers from this dialog.
            const target = (e as FocusEvent).relatedTarget as HTMLElement | null;
            if (target?.closest(".sigil-popover, .sigil-color-picker-popover")) {
              e.preventDefault();
            }
          }}
        >
          <div class="sigil-dialog__header">
            <KobalteDialog.Title class="sigil-dialog__title">{local.title}</KobalteDialog.Title>
            <KobalteDialog.CloseButton class="sigil-dialog__close" aria-label="Close">
              <X size={16} />
            </KobalteDialog.CloseButton>
          </div>
          <Show when={local.description}>
            <KobalteDialog.Description class="sigil-dialog__description">
              {local.description}
            </KobalteDialog.Description>
          </Show>
          <div class="sigil-dialog__body">{local.children}</div>
        </KobalteDialog.Content>
      </KobalteDialog.Portal>
    </KobalteDialog>
  );
}
