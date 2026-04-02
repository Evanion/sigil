import { Button as KobalteButton } from "@kobalte/core/button";
import { type JSX, splitProps } from "solid-js";
import "./IconButton.css";

export interface IconButtonProps {
  /** Lucide icon component to render */
  icon: (props: { size?: number }) => JSX.Element;
  /** Required accessible label since icon buttons have no visible text */
  "aria-label": string;
  /** Whether the button is in an active/pressed state (e.g., selected tool) */
  active?: boolean;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Additional CSS class */
  class?: string;
}

export function IconButton(props: IconButtonProps) {
  const [local, others] = splitProps(props, ["icon", "active", "disabled", "onClick", "class"]);

  const className = () => {
    const classes = ["sigil-icon-button"];
    if (local.active) classes.push("sigil-icon-button--active");
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
      {local.icon({ size: 18 })}
    </KobalteButton>
  );
}
