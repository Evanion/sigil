/**
 * HexInput — swatch + hex text field + optional out-of-gamut warning badge.
 *
 * Edit flow:
 *  - Clicking the input enters edit mode (isEditing = true).
 *  - On blur or Enter: parse hex, call onChange. Invalid hex: revert to current.
 *  - On Escape: cancel edit without committing.
 *
 * The swatch always reflects the committed (props) color, not the in-progress
 * text, so the user sees the current color while typing.
 */
import { createSignal, Show } from "solid-js";
import { srgbToHex, hexToSrgb } from "./color-math";
import "./ColorPicker.css";

export interface HexInputProps {
  /** Red channel in sRGB [0, 1]. */
  r: number;
  /** Green channel in sRGB [0, 1]. */
  g: number;
  /** Blue channel in sRGB [0, 1]. */
  b: number;
  /** When true, shows a gamut warning badge. */
  isOutOfGamut: boolean;
  /** Called with the new sRGB values when a valid hex is committed. */
  onChange: (r: number, g: number, b: number) => void;
}

export function HexInput(props: HexInputProps) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal("");

  const committedHex = () => srgbToHex(props.r, props.g, props.b);
  const swatchColor = () => committedHex();
  const displayValue = () => (isEditing() ? editValue() : committedHex().slice(1).toUpperCase());

  function beginEdit() {
    setEditValue(committedHex().slice(1).toUpperCase());
    setIsEditing(true);
  }

  function commitEdit() {
    const raw = editValue();
    const parsed = hexToSrgb(raw);
    if (parsed !== null) {
      props.onChange(parsed[0], parsed[1], parsed[2]);
    }
    // Revert to committed value on invalid input (done implicitly — we don't
    // store the parsed value locally, so committedHex() still reflects props).
    setIsEditing(false);
  }

  function cancelEdit() {
    setIsEditing(false);
  }

  function handleInput(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    setEditValue(target.value);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
      (e.currentTarget as HTMLElement).blur();
    }
  }

  function handleFocus() {
    beginEdit();
  }

  function handleBlur() {
    if (isEditing()) {
      commitEdit();
    }
  }

  return (
    <div class="sigil-hex-input">
      <div
        class="sigil-hex-input__swatch"
        style={{ background: swatchColor() }}
        aria-hidden="true"
      />
      <input
        class="sigil-hex-input__input"
        type="text"
        maxLength={7}
        aria-label="Hex color"
        value={displayValue()}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        spellcheck={false}
        autocomplete="off"
      />
      <Show when={props.isOutOfGamut}>
        <span
          class="sigil-hex-input__gamut-warning"
          title="Color is outside the sRGB gamut"
          aria-label="Out of sRGB gamut"
          role="img"
        >
          ⚠
        </span>
      </Show>
    </div>
  );
}
