import { Button as KobalteButton } from "@kobalte/core/button";
import { type JSX, splitProps } from "solid-js";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  children: JSX.Element;
  onClick?: () => void;
  class?: string;
  "aria-label"?: string;
}

export function Button(props: ButtonProps) {
  const [local, others] = splitProps(props, [
    "variant",
    "size",
    "disabled",
    "children",
    "onClick",
    "class",
  ]);

  const variant = () => local.variant ?? "secondary";
  const size = () => local.size ?? "md";

  const className = () => {
    const classes = ["sigil-button", `sigil-button--${variant()}`];
    if (size() !== "md") classes.push(`sigil-button--${size()}`);
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <KobalteButton
      class={className()}
      disabled={local.disabled}
      onClick={local.onClick}
      {...others}
    >
      {local.children}
    </KobalteButton>
  );
}
