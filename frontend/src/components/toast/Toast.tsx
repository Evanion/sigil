import { Toast, toaster } from "@kobalte/core/toast";
import { Portal } from "solid-js/web";
import type { JSX } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { X } from "lucide-solid";
import { i18nInstance } from "../../i18n";
import "./Toast.css";

export type ToastVariant = "info" | "success" | "error" | "warning";

const VALID_VARIANTS = new Set<ToastVariant>(["info", "success", "error", "warning"]);

export interface ToastData {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

export function showToast(data: ToastData): void {
  const variant: ToastVariant = data.variant ?? "info";
  const variantClass = VALID_VARIANTS.has(variant) ? ` sigil-toast--${variant}` : "";

  toaster.show((props) => (
    <Toast toastId={props.toastId} class={`sigil-toast${variantClass}`}>
      <Toast.Title class="sigil-toast__title">{data.title}</Toast.Title>
      {data.description && (
        <Toast.Description class="sigil-toast__description">{data.description}</Toast.Description>
      )}
      <Toast.CloseButton class="sigil-toast__close" aria-label={i18nInstance.t("common:close")}>
        <X size={14} />
      </Toast.CloseButton>
    </Toast>
  ));
}

export function ToastRegion(): JSX.Element {
  const [t] = useTransContext();
  return (
    <Portal>
      <Toast.Region aria-label={t("common:notifications")}>
        <Toast.List class="sigil-toast-region" />
      </Toast.Region>
    </Portal>
  );
}
