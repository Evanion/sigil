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
import { createEffect, createMemo } from "solid-js";
import type {
  Color,
  Effect,
  EffectDropShadow,
  EffectInnerShadow,
  EffectLayerBlur,
  EffectBackgroundBlur,
  StyleValue,
  Token,
} from "../types/document";
import { GripVertical } from "lucide-solid";
import ValueInput from "../components/value-input/ValueInput";
import { showToast } from "../components/toast/Toast";
import {
  formatColorStyleValue,
  formatNumber,
  formatNumberStyleValue,
  parseColorInput,
  parseNumberInput,
} from "./panel-value-helpers";
import "./EffectCard.css";

// ── Types ───────────────────────────────────────────────────────────────

export interface EffectCardProps {
  readonly effect: Effect;
  readonly index: number;
  readonly onUpdate: (index: number, effect: Effect) => void;
  readonly onRemove: (index: number) => void;
  /** Token dictionary for ValueInput autocomplete. Defaults to empty. */
  readonly tokens?: Record<string, Token>;
  /** Called at gesture boundaries so the parent can flush its history buffer. */
  readonly onCommit?: () => void;
}

type EffectType = Effect["type"];

const VALID_EFFECT_TYPES: readonly EffectType[] = [
  "drop_shadow",
  "inner_shadow",
  "layer_blur",
  "background_blur",
];

// ── Helpers ─────────────────────────────────────────────────────────────

const DEFAULT_SHADOW_COLOR: StyleValue<Color> = {
  type: "literal",
  value: { space: "srgb", r: 0, g: 0, b: 0, a: 0.3 },
};

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

// ── EffectCard component ─────────────────────────────────────────────────

export function EffectCard(props: EffectCardProps) {
  // ── Type select ────────────────────────────────────────────────────────
  // Controlled via createEffect: when props.effect.type changes externally
  // (e.g. undo), the select element value is kept in sync.

  // eslint-disable-next-line no-unassigned-vars -- Solid's ref directive assigns this variable
  let selectRef: HTMLSelectElement | undefined;

  createEffect(() => {
    if (selectRef) {
      selectRef.value = props.effect.type;
    }
  });

  function handleTypeChange(e: Event): void {
    const rawValue = (e.currentTarget as HTMLSelectElement).value;
    if (!VALID_EFFECT_TYPES.includes(rawValue as EffectType)) return;
    const newType = rawValue as EffectType;
    const newEffect = coerceEffectType(props.effect, newType);
    props.onUpdate(props.index, newEffect);
  }

  function handleRemove(): void {
    props.onRemove(props.index);
  }

  // ── Shadow-specific callbacks ──────────────────────────────────────────

  function handleColorChange(raw: string): void {
    if (props.effect.type !== "drop_shadow" && props.effect.type !== "inner_shadow") return;
    const parsed = parseColorInput(raw);
    if (!parsed) return;
    props.onUpdate(props.index, { ...props.effect, color: parsed });
  }

  function handleColorCommit(_raw: string): void {
    // RF-004: onChange already applied the value during the gesture.
    // onCommit only flushes history — do not re-dispatch the change.
    props.onCommit?.();
  }

  /**
   * Offset handlers only accept literal numeric input — the `Point` data
   * model stores plain numbers, not a `StyleValue<number>`. Non-literal
   * input surfaces a toast (RF-015) rather than failing silently so the
   * user understands why the input reverted.
   *
   * TODO(spec-13c): Promote `Point` to `{ x: StyleValue<number>, y:
   * StyleValue<number> }` to enable token binding on shadow offsets.
   */
  function handleOffsetX(raw: string): void {
    if (props.effect.type !== "drop_shadow" && props.effect.type !== "inner_shadow") return;
    const parsed = parseNumberInput(raw);
    if (!parsed) return;
    if (parsed.type !== "literal") {
      showToast({
        title: "Shadow offsets do not yet support token bindings",
        variant: "info",
      });
      return;
    }
    const v = parsed.value;
    if (!Number.isFinite(v)) return;
    props.onUpdate(props.index, { ...props.effect, offset: { ...props.effect.offset, x: v } });
  }

  function handleOffsetXCommit(_raw: string): void {
    // RF-004: onChange already applied the value during the gesture.
    props.onCommit?.();
  }

  function handleOffsetY(raw: string): void {
    if (props.effect.type !== "drop_shadow" && props.effect.type !== "inner_shadow") return;
    const parsed = parseNumberInput(raw);
    if (!parsed) return;
    if (parsed.type !== "literal") {
      showToast({
        title: "Shadow offsets do not yet support token bindings",
        variant: "info",
      });
      return;
    }
    const v = parsed.value;
    if (!Number.isFinite(v)) return;
    props.onUpdate(props.index, { ...props.effect, offset: { ...props.effect.offset, y: v } });
  }

  function handleOffsetYCommit(_raw: string): void {
    // RF-004: onChange already applied the value during the gesture.
    props.onCommit?.();
  }

  function handleBlur(raw: string): void {
    if (props.effect.type !== "drop_shadow" && props.effect.type !== "inner_shadow") return;
    const parsed = parseNumberInput(raw);
    if (!parsed) return;
    props.onUpdate(props.index, { ...props.effect, blur: parsed });
  }

  function handleBlurCommit(_raw: string): void {
    // RF-004: onChange already applied the value during the gesture.
    props.onCommit?.();
  }

  function handleSpread(raw: string): void {
    if (props.effect.type !== "drop_shadow" && props.effect.type !== "inner_shadow") return;
    const parsed = parseNumberInput(raw);
    if (!parsed) return;
    props.onUpdate(props.index, { ...props.effect, spread: parsed });
  }

  function handleSpreadCommit(_raw: string): void {
    // RF-004: onChange already applied the value during the gesture.
    props.onCommit?.();
  }

  // ── Blur-specific callbacks ────────────────────────────────────────────

  function handleRadius(raw: string): void {
    if (props.effect.type !== "layer_blur" && props.effect.type !== "background_blur") return;
    const parsed = parseNumberInput(raw);
    if (!parsed) return;
    props.onUpdate(props.index, { ...props.effect, radius: parsed });
  }

  function handleRadiusCommit(_raw: string): void {
    // RF-004: onChange already applied the value during the gesture.
    props.onCommit?.();
  }

  // ── Derived values (computed inside render, not in createMemo to stay
  //    reactive to prop changes without memoizing the whole effect) ────────

  const isShadow = createMemo(
    () => props.effect.type === "drop_shadow" || props.effect.type === "inner_shadow",
  );

  const shadowColorDisplay = createMemo(() => {
    if (!isShadow()) return "";
    const s = props.effect as EffectDropShadow | EffectInnerShadow;
    return formatColorStyleValue(s.color);
  });

  const offsetXDisplay = createMemo(() => {
    if (!isShadow()) return "";
    const v = (props.effect as EffectDropShadow).offset.x;
    return formatNumber(v);
  });

  const offsetYDisplay = createMemo(() => {
    if (!isShadow()) return "";
    const v = (props.effect as EffectDropShadow).offset.y;
    return formatNumber(v);
  });

  const blurDisplay = createMemo(() => {
    if (!isShadow()) return "";
    return formatNumberStyleValue((props.effect as EffectDropShadow).blur);
  });

  const spreadDisplay = createMemo(() => {
    if (!isShadow()) return "";
    return formatNumberStyleValue((props.effect as EffectDropShadow).spread);
  });

  const radiusDisplay = createMemo(() => {
    if (isShadow()) return "";
    return formatNumberStyleValue((props.effect as EffectLayerBlur).radius);
  });

  return (
    <div class="sigil-effect-card">
      {/* Header row */}
      <div class="sigil-effect-card__header">
        <span class="sigil-effect-card__handle" aria-hidden="true">
          <GripVertical size={14} />
        </span>

        <select
          ref={selectRef}
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
            <ValueInput
              value={shadowColorDisplay()}
              onChange={handleColorChange}
              onCommit={handleColorCommit}
              tokens={props.tokens ?? {}}
              acceptedTypes={["color"]}
              aria-label="Shadow color"
            />
          </div>

          {/*
            X/Y offsets bind to the `Point` data model which stores plain
            numbers — token refs and expressions cannot be persisted here.
            We pass `tokens={{}}` to suppress the `{` autocomplete dropdown
            rather than offering a broken affordance; handleOffsetX/Y also
            reject non-literal inputs defensively.
            TODO(spec-13c): Promote `Point` to `{ x: StyleValue<number>,
            y: StyleValue<number> }` to enable token binding on offsets.
          */}
          <ValueInput
            value={offsetXDisplay()}
            onChange={handleOffsetX}
            onCommit={handleOffsetXCommit}
            tokens={{}}
            acceptedTypes={["number"]}
            aria-label="X offset"
          />
          <ValueInput
            value={offsetYDisplay()}
            onChange={handleOffsetY}
            onCommit={handleOffsetYCommit}
            tokens={{}}
            acceptedTypes={["number"]}
            aria-label="Y offset"
          />
          <ValueInput
            value={blurDisplay()}
            onChange={handleBlur}
            onCommit={handleBlurCommit}
            tokens={props.tokens ?? {}}
            acceptedTypes={["number"]}
            aria-label="Blur"
          />
          <ValueInput
            value={spreadDisplay()}
            onChange={handleSpread}
            onCommit={handleSpreadCommit}
            tokens={props.tokens ?? {}}
            acceptedTypes={["number"]}
            aria-label="Spread"
          />
        </div>
      ) : (
        <div class="sigil-effect-card__fields sigil-effect-card__fields--single">
          <ValueInput
            value={radiusDisplay()}
            onChange={handleRadius}
            onCommit={handleRadiusCommit}
            tokens={props.tokens ?? {}}
            acceptedTypes={["number"]}
            aria-label="Radius"
          />
        </div>
      )}
    </div>
  );
}
