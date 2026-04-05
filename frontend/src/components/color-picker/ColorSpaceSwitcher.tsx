/**
 * ColorSpaceSwitcher — 4-option segmented toggle for selecting the active
 * color space: sRGB, Display P3, OkLCH, or OkLab.
 *
 * Rendered as a radiogroup so that screen readers announce the current
 * selection correctly. Each button uses aria-checked to reflect state.
 */
import { For } from "solid-js";
import type { ColorSpace } from "./types";
import "./ColorPicker.css";

interface SpaceOption {
  value: ColorSpace;
  label: string;
}

const SPACE_OPTIONS: SpaceOption[] = [
  { value: "srgb", label: "sRGB" },
  { value: "display_p3", label: "P3" },
  { value: "oklch", label: "OkLCH" },
  { value: "oklab", label: "OkLab" },
];

export interface ColorSpaceSwitcherProps {
  /** The currently active color space. */
  value: ColorSpace;
  /** Called when the user selects a different color space. */
  onChange: (space: ColorSpace) => void;
}

export function ColorSpaceSwitcher(props: ColorSpaceSwitcherProps) {
  return (
    <div class="sigil-color-space-switcher" role="radiogroup" aria-label="Color space">
      <For each={SPACE_OPTIONS}>
        {(option) => {
          const isActive = () => props.value === option.value;
          return (
            <button
              class={
                isActive()
                  ? "sigil-color-space-switcher__btn sigil-color-space-switcher__btn--active"
                  : "sigil-color-space-switcher__btn"
              }
              role="radio"
              aria-checked={isActive()}
              onClick={() => props.onChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          );
        }}
      </For>
    </div>
  );
}
