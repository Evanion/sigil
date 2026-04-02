import { ToggleButton as KobalteToggleButton } from "@kobalte/core/toggle-button";
import { type JSX, splitProps } from "solid-js";
import "./ToggleButton.css";

export interface ToggleButtonProps {
  /** Whether the toggle is currently pressed/active. */
  pressed: boolean;
  /** Callback when the pressed state changes. */
  onPressedChange: (pressed: boolean) => void;
  /** Content displayed inside the toggle button (text or icon). */
  children: JSX.Element;
  /** Whether the toggle button is disabled. */
  disabled?: boolean;
  /** Additional CSS class. */
  class?: string;
  /** Accessible label for the toggle button. */
  "aria-label"?: string;
}

export function ToggleButton(props: ToggleButtonProps) {
  const [local, others] = splitProps(props, [
    "pressed",
    "onPressedChange",
    "children",
    "disabled",
    "class",
  ]);

  const className = () => {
    const classes = ["sigil-toggle-button"];
    if (local.pressed) classes.push("sigil-toggle-button--pressed");
    if (local.class) classes.push(local.class);
    return classes.join(" ");
  };

  return (
    <KobalteToggleButton
      class={className()}
      pressed={local.pressed}
      onChange={local.onPressedChange}
      disabled={local.disabled}
      {...others}
    >
      {local.children}
    </KobalteToggleButton>
  );
}
