/**
 * ColorDisplayModeSwitcher — segmented toggle for selecting the active display
 * mode of the color picker's numeric fields: sRGB, OkLCH, or HSL.
 *
 * The display mode only affects how channels are labelled and ranged in
 * ColorValueFields — colors are always stored as sRGB.
 *
 * Rendered as a radiogroup so that screen readers announce the current
 * selection correctly. Each button uses aria-checked to reflect state.
 *
 * Implements roving tabindex: only the selected radio button gets tabindex=0,
 * all others get tabindex=-1. ArrowLeft/ArrowRight cycle through options
 * (wrapping at ends), calling onChange and moving focus (RF-001).
 */
import { For } from "solid-js";
import type { ColorDisplayMode } from "./types";
import "./ColorPicker.css";

interface SpaceOption {
  value: ColorDisplayMode;
  label: string;
  /** RF-030: Descriptive tooltip for the color space button. */
  title: string;
}

const SPACE_OPTIONS: SpaceOption[] = [
  { value: "srgb", label: "sRGB", title: "Standard web colors (sRGB)" },
  // P3 hidden until proper color matrix conversion is implemented
  // { value: "display_p3", label: "P3", title: "Wide-gamut display colors (Display P3)" },
  { value: "oklch", label: "OkLCH", title: "Perceptual lightness/chroma/hue (OkLCH)" },
  {
    value: "hsl",
    label: "HSL",
    title: "Hue/Saturation/Lightness (HSL \u2014 CSS-style, not Figma's HSB)",
  },
];

export interface ColorDisplayModeSwitcherProps {
  /** The currently active color space. */
  value: ColorDisplayMode;
  /** Called when the user selects a different color space. */
  onChange: (space: ColorDisplayMode) => void;
}

export function ColorSpaceSwitcher(props: ColorDisplayModeSwitcherProps) {
  const buttonRefs: (HTMLButtonElement | undefined)[] = [];

  function handleKeyDown(e: KeyboardEvent) {
    const currentIndex = SPACE_OPTIONS.findIndex((o) => o.value === props.value);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % SPACE_OPTIONS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + SPACE_OPTIONS.length) % SPACE_OPTIONS.length;
    }

    if (nextIndex !== null) {
      const nextOption = SPACE_OPTIONS[nextIndex];
      if (nextOption) {
        props.onChange(nextOption.value);
        buttonRefs[nextIndex]?.focus();
      }
    }
  }

  return (
    <div class="sigil-color-space-switcher" role="radiogroup" aria-label="Color space">
      <For each={SPACE_OPTIONS}>
        {(option, i) => {
          const isActive = () => props.value === option.value;
          return (
            <button
              ref={(el) => {
                buttonRefs[i()] = el;
              }}
              class={
                isActive()
                  ? "sigil-color-space-switcher__btn sigil-color-space-switcher__btn--active"
                  : "sigil-color-space-switcher__btn"
              }
              role="radio"
              aria-checked={isActive()}
              tabindex={isActive() ? 0 : -1}
              title={option.title}
              onClick={() => props.onChange(option.value)}
              onKeyDown={handleKeyDown}
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
