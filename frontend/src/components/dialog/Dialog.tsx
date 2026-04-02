import { Dialog as KobalteDialog } from "@kobalte/core/dialog";
import { Show } from "solid-js";
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
  const className = () => {
    const classes = ["sigil-dialog"];
    if (props.class) classes.push(props.class);
    return classes.join(" ");
  };

  return (
    <KobalteDialog open={props.open} onOpenChange={props.onOpenChange} modal>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay class="sigil-dialog__overlay" />
        <KobalteDialog.Content class={className()}>
          <div class="sigil-dialog__header">
            <KobalteDialog.Title class="sigil-dialog__title">{props.title}</KobalteDialog.Title>
            <KobalteDialog.CloseButton class="sigil-dialog__close" aria-label="Close">
              <X size={16} />
            </KobalteDialog.CloseButton>
          </div>
          <Show when={props.description}>
            <KobalteDialog.Description class="sigil-dialog__description">
              {props.description}
            </KobalteDialog.Description>
          </Show>
          <div class="sigil-dialog__body">{props.children}</div>
        </KobalteDialog.Content>
      </KobalteDialog.Portal>
    </KobalteDialog>
  );
}
