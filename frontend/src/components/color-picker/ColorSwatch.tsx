/**
 * ColorSwatch — a reusable color swatch button that opens a ColorPicker
 * popover on click.
 *
 * Usage:
 *   <ColorSwatch color={myColor} onColorChange={setMyColor} />
 *
 * The popover opens to the left by default (suitable for right-panel usage)
 * and stays open during interaction (drag in color area, hue/alpha strips).
 * Closes on Escape or clicking outside.
 */
import type { Component } from "solid-js";
import type { Color } from "../../types/document";
import type { PopoverPlacement } from "../popover/Popover";
import { Popover } from "../popover/Popover";
import { ColorPicker } from "./ColorPicker";
import { colorToHex } from "./color-math";
import "./ColorSwatch.css";

export interface ColorSwatchProps {
  /** The current color to display and edit. */
  readonly color: Color;
  /** Called when the user changes the color. */
  readonly onColorChange: (color: Color) => void;
  /** Popover placement relative to the swatch. Defaults to "left". */
  readonly placement?: PopoverPlacement;
  /** Accessible label for the swatch button. Defaults to "Edit color". */
  readonly "aria-label"?: string;
  /** Additional CSS class for the swatch button. */
  readonly class?: string;
}

export const ColorSwatch: Component<ColorSwatchProps> = (props) => {
  const hex = (): string => {
    try {
      return colorToHex(props.color);
    } catch {
      // Defense in depth: if colorToHex fails due to unexpected input
      // (e.g., NaN channels from a corrupted color value), fall back to black.
      return "#000000";
    }
  };

  const className = () => {
    const classes = ["sigil-color-swatch"];
    if (props.class) classes.push(props.class);
    return classes.join(" ");
  };

  return (
    <Popover
      placement={props.placement ?? "left"}
      class="sigil-color-picker-popover"
      preventDismissOnInteract
      triggerAriaLabel={props["aria-label"] ?? "Edit color"}
      trigger={<span class={className()} style={{ background: hex() }} />}
    >
      <ColorPicker color={props.color} onColorChange={props.onColorChange} />
    </Popover>
  );
};
