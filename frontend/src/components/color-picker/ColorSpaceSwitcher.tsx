/**
 * ColorDisplayModeSwitcher — segmented toggle for selecting the active display
 * mode of the color picker's numeric fields: sRGB, Display-P3, OkLCH, or HSL.
 *
 * The display mode controls how channels are labelled and ranged in
 * ColorValueFields AND determines the storage tag emitted by the picker
 * (Spec 18 — P3 mode emits Color::DisplayP3, others emit Color::Srgb for now).
 *
 * Rendered as a radiogroup so that screen readers announce the current
 * selection correctly. Each button uses aria-checked to reflect state.
 *
 * Implements roving tabindex: only the selected radio button gets tabindex=0,
 * all others get tabindex=-1. ArrowLeft/ArrowRight cycle through options
 * (wrapping at ends), calling onChange and moving focus (RF-001).
 */
import { For, createMemo } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import type { ColorDisplayMode } from "./types";
import "./ColorPicker.css";

interface SpaceOption {
  value: ColorDisplayMode;
  label: string;
  /** Descriptive tooltip for the color space button. */
  title: string;
}

export interface ColorDisplayModeSwitcherProps {
  /** The currently active color space. */
  readonly value: ColorDisplayMode;
  /** Called when the user selects a different color space. */
  readonly onChange: (space: ColorDisplayMode) => void;
}

export function ColorSpaceSwitcher(props: ColorDisplayModeSwitcherProps) {
  const [t] = useTransContext();
  const buttonRefs: (HTMLButtonElement | undefined)[] = [];

  // Locale-derived option list. createMemo so it updates if locale changes.
  const options = createMemo<SpaceOption[]>(() => [
    { value: "srgb", label: "sRGB", title: t("panels:colorPicker.srgbTitle") },
    {
      value: "display_p3",
      label: t("panels:colorPicker.p3Label"),
      title: t("panels:colorPicker.p3Title"),
    },
    { value: "oklch", label: "OkLCH", title: t("panels:colorPicker.oklchTitle") },
    { value: "hsl", label: "HSL", title: t("panels:colorPicker.hslTitle") },
  ]);

  function handleKeyDown(e: KeyboardEvent) {
    const opts = options();
    const currentIndex = opts.findIndex((o) => o.value === props.value);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % opts.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + opts.length) % opts.length;
    }

    if (nextIndex !== null) {
      const nextOption = opts[nextIndex];
      if (nextOption) {
        props.onChange(nextOption.value);
        buttonRefs[nextIndex]?.focus();
      }
    }
  }

  return (
    <div
      class="sigil-color-space-switcher"
      role="radiogroup"
      aria-label={t("panels:colorPicker.colorSpace")}
    >
      <For each={options()}>
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
