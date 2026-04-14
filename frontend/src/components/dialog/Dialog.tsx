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
        <KobalteDialog.Content class={className()}>
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
