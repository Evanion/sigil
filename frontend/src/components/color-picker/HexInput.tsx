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
import { createSignal, createUniqueId, Show } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
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
  /** Spec 18: when true, shows a "P3" badge to signal hex is interpreted as P3. */
  isP3Mode: boolean;
  /** Called with the new sRGB values when a valid hex is committed. */
  onChange: (r: number, g: number, b: number) => void;
}

export function HexInput(props: HexInputProps) {
  const [t] = useTransContext();
  const [isEditing, setIsEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal("");
  const [isError, setIsError] = createSignal(false);
  // RF-017: stable id so the input's `aria-describedby` can reference the
  // P3 badge while the picker is in P3 mode. The badge keeps
  // `aria-hidden="true"` to skip tab order; `aria-describedby` walks
  // through aria-hidden referenced elements per ARIA spec, so screen-reader
  // users tabbing into the hex input still receive the spoken hint.
  const p3HintId = createUniqueId();

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
    } else if (raw.length > 0) {
      // RF-023: Flash error state on failed parse so the user knows the value was invalid.
      setIsError(true);
      setTimeout(() => setIsError(false), 1200);
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
    // RF-018: Strip non-hex and non-# characters before storing.
    const sanitized = target.value.replace(/[^0-9a-fA-F#]/g, "").slice(0, 7);
    setEditValue(sanitized);
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
        classList={{ "sigil-hex-input__input--error": isError() }}
        type="text"
        maxLength={7}
        aria-label={t("panels:colorPicker.hexColor")}
        aria-describedby={props.isP3Mode ? p3HintId : undefined}
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
          title={t("panels:colorPicker.outOfGamutLong")}
          aria-label={t("panels:colorPicker.outOfGamutShort")}
          role="img"
        >
          {/* eslint-disable-next-line i18next/no-literal-string -- i18n-allow: decorative warning glyph; accessible name comes from aria-label/title */}
          {"⚠"}
        </span>
      </Show>
      <Show when={props.isP3Mode}>
        <>
          <span
            class="sigil-hex-input__p3-badge"
            aria-hidden="true"
            title={t("panels:colorPicker.p3HexHint")}
          >
            {/* eslint-disable-next-line i18next/no-literal-string -- i18n-allow: abbreviated mode label, full name in title attribute */}
            {"P3"}
          </span>
          {/* RF-017: full-text description referenced by the input's
              aria-describedby so keyboard / screen-reader users discover the
              P3 hint on focus. The badge above keeps its 2-glyph visible
              label; this hidden node carries the spoken text. */}
          <span id={p3HintId} class="sr-only">
            {t("panels:colorPicker.p3HexHint")}
          </span>
        </>
      </Show>
    </div>
  );
}
