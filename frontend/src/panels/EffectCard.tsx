/**
 * EffectCard — single effect editor card in the Effects panel.
 *
 * Renders a header row (drag handle, type select, remove button) and a
 * per-type fields section. Shadow effects expose color, X/Y offset, blur and
 * spread. Blur effects expose only a radius field.
 *
 * Type switching preserves compatible fields:
 *   Shadow → Blur:   carry blur as radius
 *   Blur → Shadow:   carry radius as blur, default color/offset/spread
 *   Shadow → Shadow: carry color, offset, blur, spread
 *   Blur → Blur:     carry radius
 *
 * All numeric inputs are guarded with Number.isFinite() per CLAUDE.md §11.
 */
import { createMemo, createSignal } from "solid-js";
import type {
  Color,
  Effect,
  EffectDropShadow,
  EffectInnerShadow,
  EffectLayerBlur,
  EffectBackgroundBlur,
  StyleValue,
} from "../types/document";
import { ColorPicker } from "../components/color-picker";
import { colorToHex } from "../components/color-picker/color-math";
import { NumberInput } from "../components/number-input/NumberInput";
import "./EffectCard.css";

// ── Types ───────────────────────────────────────────────────────────────

export interface EffectCardProps {
  readonly effect: Effect;
  readonly index: number;
  readonly onUpdate: (index: number, effect: Effect) => void;
  readonly onRemove: (index: number) => void;
}

type EffectType = Effect["type"];

// ── Helpers ─────────────────────────────────────────────────────────────

const DEFAULT_SHADOW_COLOR: StyleValue<Color> = {
  type: "literal",
  value: { space: "srgb", r: 0, g: 0, b: 0, a: 0.3 },
};

/** Extract the numeric blur value from a shadow blur StyleValue (0 if token_ref). */
function shadowBlurValue(sv: StyleValue<number>): number {
  if (sv.type === "literal") {
    const v = sv.value;
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}

/** Extract the numeric radius value from a blur radius StyleValue (0 if token_ref). */
function blurRadiusValue(sv: StyleValue<number>): number {
  if (sv.type === "literal") {
    const v = sv.value;
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}

/** Extract the literal Color from a shadow color StyleValue (fallback black). */
function shadowColorValue(sv: StyleValue<Color>): Color {
  if (sv.type === "literal") {
    return sv.value;
  }
  return { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
}

/**
 * Build a new Effect of the requested type, preserving compatible fields
 * from the previous effect.
 */
function coerceEffectType(prev: Effect, newType: EffectType): Effect {
  const isShadow = prev.type === "drop_shadow" || prev.type === "inner_shadow";
  const isBlur = prev.type === "layer_blur" || prev.type === "background_blur";
  const newIsShadow = newType === "drop_shadow" || newType === "inner_shadow";
  const newIsBlur = newType === "layer_blur" || newType === "background_blur";

  if (isShadow && newIsShadow) {
    // Shadow → Shadow: preserve all fields, just change the discriminant
    const s = prev as EffectDropShadow | EffectInnerShadow;
    if (newType === "drop_shadow") {
      const next: EffectDropShadow = {
        type: "drop_shadow",
        color: s.color,
        offset: s.offset,
        blur: s.blur,
        spread: s.spread,
      };
      return next;
    } else {
      const next: EffectInnerShadow = {
        type: "inner_shadow",
        color: s.color,
        offset: s.offset,
        blur: s.blur,
        spread: s.spread,
      };
      return next;
    }
  }

  if (isBlur && newIsBlur) {
    // Blur → Blur: preserve radius
    const b = prev as EffectLayerBlur | EffectBackgroundBlur;
    if (newType === "layer_blur") {
      const next: EffectLayerBlur = { type: "layer_blur", radius: b.radius };
      return next;
    } else {
      const next: EffectBackgroundBlur = { type: "background_blur", radius: b.radius };
      return next;
    }
  }

  if (isShadow && newIsBlur) {
    // Shadow → Blur: carry blur as radius
    const s = prev as EffectDropShadow | EffectInnerShadow;
    const radius: StyleValue<number> = s.blur;
    if (newType === "layer_blur") {
      const next: EffectLayerBlur = { type: "layer_blur", radius };
      return next;
    } else {
      const next: EffectBackgroundBlur = { type: "background_blur", radius };
      return next;
    }
  }

  // Blur → Shadow: carry radius as blur, default everything else
  const b = prev as EffectLayerBlur | EffectBackgroundBlur;
  const blur: StyleValue<number> = b.radius;
  if (newType === "drop_shadow") {
    const next: EffectDropShadow = {
      type: "drop_shadow",
      color: DEFAULT_SHADOW_COLOR,
      offset: { x: 0, y: 4 },
      blur,
      spread: { type: "literal", value: 0 },
    };
    return next;
  } else {
    const next: EffectInnerShadow = {
      type: "inner_shadow",
      color: DEFAULT_SHADOW_COLOR,
      offset: { x: 0, y: 4 },
      blur,
      spread: { type: "literal", value: 0 },
    };
    return next;
  }
}

/** Compute a CSS background for the shadow color swatch. */
function swatchBackground(sv: StyleValue<Color>): string {
  if (sv.type === "literal") {
    return colorToHex(sv.value);
  }
  return "var(--surface-4)";
}

// ── EffectCard component ─────────────────────────────────────────────────

export function EffectCard(props: EffectCardProps) {
  const [pickerOpen, setPickerOpen] = createSignal(false);

  // ── Type select ────────────────────────────────────────────────────────
  // The select element is uncontrolled: no reactive value binding. We set
  // the initial value imperatively via a ref callback so Solid cannot reset
  // the DOM value during user interaction.

  function initSelect(el: HTMLSelectElement): void {
    el.value = props.effect.type;
  }

  function handleTypeChange(e: Event): void {
    const newType = (e.currentTarget as HTMLSelectElement).value as EffectType;
    const newEffect = coerceEffectType(props.effect, newType);
    props.onUpdate(props.index, newEffect);
  }

  function handleRemove(): void {
    props.onRemove(props.index);
  }

  // ── Shadow-specific callbacks ──────────────────────────────────────────

  function handleColorChange(newColor: Color): void {
    if (props.effect.type !== "drop_shadow" && props.effect.type !== "inner_shadow") return;
    const newColorSv: StyleValue<Color> = { type: "literal", value: newColor };
    props.onUpdate(props.index, { ...props.effect, color: newColorSv });
  }

  function handleOffsetX(v: number): void {
    if (!Number.isFinite(v)) return;
    if (props.effect.type !== "drop_shadow" && props.effect.type !== "inner_shadow") return;
    props.onUpdate(props.index, { ...props.effect, offset: { ...props.effect.offset, x: v } });
  }

  function handleOffsetY(v: number): void {
    if (!Number.isFinite(v)) return;
    if (props.effect.type !== "drop_shadow" && props.effect.type !== "inner_shadow") return;
    props.onUpdate(props.index, { ...props.effect, offset: { ...props.effect.offset, y: v } });
  }

  function handleBlur(v: number): void {
    if (!Number.isFinite(v)) return;
    if (props.effect.type !== "drop_shadow" && props.effect.type !== "inner_shadow") return;
    const newBlur: StyleValue<number> = { type: "literal", value: v };
    props.onUpdate(props.index, { ...props.effect, blur: newBlur });
  }

  function handleSpread(v: number): void {
    if (!Number.isFinite(v)) return;
    if (props.effect.type !== "drop_shadow" && props.effect.type !== "inner_shadow") return;
    const newSpread: StyleValue<number> = { type: "literal", value: v };
    props.onUpdate(props.index, { ...props.effect, spread: newSpread });
  }

  // ── Blur-specific callbacks ────────────────────────────────────────────

  function handleRadius(v: number): void {
    if (!Number.isFinite(v)) return;
    if (props.effect.type !== "layer_blur" && props.effect.type !== "background_blur") return;
    const newRadius: StyleValue<number> = { type: "literal", value: v };
    props.onUpdate(props.index, { ...props.effect, radius: newRadius });
  }

  // ── Derived values (computed inside render, not in createMemo to stay
  //    reactive to prop changes without memoizing the whole effect) ────────

  const isShadow = createMemo(
    () => props.effect.type === "drop_shadow" || props.effect.type === "inner_shadow",
  );

  const shadowColor = createMemo(() => {
    if (!isShadow()) return { space: "srgb" as const, r: 0, g: 0, b: 0, a: 1 };
    const s = props.effect as EffectDropShadow | EffectInnerShadow;
    return shadowColorValue(s.color);
  });

  const shadowBackground = createMemo(() => {
    if (!isShadow()) return "var(--surface-4)";
    const s = props.effect as EffectDropShadow | EffectInnerShadow;
    return swatchBackground(s.color);
  });

  const offsetX = createMemo(() => {
    if (!isShadow()) return 0;
    return (props.effect as EffectDropShadow).offset.x;
  });

  const offsetY = createMemo(() => {
    if (!isShadow()) return 0;
    return (props.effect as EffectDropShadow).offset.y;
  });

  const blurVal = createMemo(() => {
    if (!isShadow()) return 0;
    return shadowBlurValue((props.effect as EffectDropShadow).blur);
  });

  const spreadVal = createMemo(() => {
    if (!isShadow()) return 0;
    return shadowBlurValue((props.effect as EffectDropShadow).spread);
  });

  const radiusVal = createMemo(() => {
    if (isShadow()) return 0;
    return blurRadiusValue((props.effect as EffectLayerBlur).radius);
  });

  const swatchAriaLabel = createMemo(() =>
    pickerOpen() ? "Close color picker" : "Edit shadow color",
  );

  // ── Shadow color swatch (used as ColorPicker trigger) ──────────────────

  const swatchTrigger = (
    <button
      class="sigil-effect-card__color-swatch"
      style={{ background: shadowBackground() }}
      aria-label={swatchAriaLabel()}
      type="button"
      onClick={() => setPickerOpen((v) => !v)}
    />
  );

  return (
    <div class="sigil-effect-card">
      {/* Header row */}
      <div class="sigil-effect-card__header">
        <span class="sigil-effect-card__handle" aria-hidden="true">
          ☰
        </span>

        <select
          ref={initSelect}
          class="sigil-effect-card__type-select"
          onChange={handleTypeChange}
          aria-label="Effect type"
        >
          <option value="drop_shadow">Drop Shadow</option>
          <option value="inner_shadow">Inner Shadow</option>
          <option value="layer_blur">Layer Blur</option>
          <option value="background_blur">Background Blur</option>
        </select>

        <button
          class="sigil-effect-card__remove"
          type="button"
          tabIndex={-1}
          aria-label="Remove effect"
          onClick={handleRemove}
        >
          ×
        </button>
      </div>

      {/* Per-type fields */}
      {isShadow() ? (
        <div class="sigil-effect-card__fields">
          {/* Color row spans full width */}
          <div class="sigil-effect-card__shadow-color-row">
            <ColorPicker
              color={shadowColor()}
              onColorChange={handleColorChange}
              trigger={swatchTrigger}
            />
          </div>

          <NumberInput
            value={offsetX()}
            onValueChange={handleOffsetX}
            aria-label="X offset"
            step={1}
          />
          <NumberInput
            value={offsetY()}
            onValueChange={handleOffsetY}
            aria-label="Y offset"
            step={1}
          />
          <NumberInput
            value={blurVal()}
            onValueChange={handleBlur}
            aria-label="Blur"
            step={1}
            min={0}
          />
          <NumberInput
            value={spreadVal()}
            onValueChange={handleSpread}
            aria-label="Spread"
            step={1}
          />
        </div>
      ) : (
        <div class="sigil-effect-card__fields sigil-effect-card__fields--single">
          <NumberInput
            value={radiusVal()}
            onValueChange={handleRadius}
            aria-label="Radius"
            step={1}
            min={0}
          />
        </div>
      )}
    </div>
  );
}
