/**
 * TokenDetailEditor — form for editing a single token's value and description.
 *
 * Renders type-specific value editors based on the token's type.
 * Auto-saves changes via store.updateToken on each field change.
 */

import { Show, For, Switch, Match, splitProps, type Component } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { NumberInput } from "../components/number-input/NumberInput";
import { ColorPicker } from "../components/color-picker/ColorPicker";
import { Select, type SelectOption } from "../components/select/Select";
import ValueInput from "../components/value-input/ValueInput";
import { showToast } from "../components/toast/Toast";
import { MAX_TOKEN_DESCRIPTION_LENGTH } from "../store/document-store-solid";
import { validateCssIdentifier } from "../validation/css-identifiers";
import type { Token, TokenValue, TokenType } from "../types/document";
import {
  tokenValueToString,
  parseTokenValueChange,
  acceptedTypesForToken,
} from "./token-detail-helpers";
import "./TokenDetailEditor.css";

// ── Constants ───────────────────────────────────────────────────────────

/** Minimum font weight value — matches CSS spec. */
const MIN_FONT_WEIGHT = 1;
/** Maximum font weight value — matches CSS spec. */
const MAX_FONT_WEIGHT = 1000;
/** Step for font weight slider. */
const FONT_WEIGHT_STEP = 100;

/** Minimum duration in seconds. */
const MIN_DURATION = 0;
/** Maximum duration in seconds. */
const MAX_DURATION = 60;

/** Minimum cubic bezier control point value. */
const MIN_BEZIER = 0;
/** Maximum cubic bezier control point value. */
const MAX_BEZIER = 1;
/** Step for cubic bezier control points. */
const BEZIER_STEP = 0.01;

/** Min shadow blur/spread. */
const MIN_SHADOW_BLUR = 0;
/** Max shadow blur/spread. */
const MAX_SHADOW_BLUR = 1000;

/** Min shadow offset. */
const MIN_SHADOW_OFFSET = -10_000;
/** Max shadow offset. */
const MAX_SHADOW_OFFSET = 10_000;

/** Min typography font size. */
const MIN_FONT_SIZE = 1;
/**
 * Max typography font size. RF-026: aligned to the Rust server constant
 * `crates/core/src/validate.rs :: MAX_FONT_SIZE = 10_000.0`. Previously
 * 1_000 — the frontend silently rejected values the server would accept,
 * violating "Validation Must Be Symmetric Across All Transports" in
 * CLAUDE.md §11. If we ever need a stricter UX bound, document the
 * rationale and keep it below the Rust authoritative value.
 */
const MAX_FONT_SIZE = 10_000;

/** Min line height / letter spacing. */
const MIN_LINE_HEIGHT = 0;
/** Max line height. */
const MAX_LINE_HEIGHT = 10;
/** Min letter spacing. */
const MIN_LETTER_SPACING = -100;
/** Max letter spacing. */
const MAX_LETTER_SPACING = 100;

// ── Props ───────────────────────────────────────────────────────────────

export interface TokenDetailEditorProps {
  readonly token: Token;
  readonly tokens: Record<string, Token>;
  readonly onUpdate: (name: string, value: TokenValue, description?: string) => void;
  readonly onDelete?: (name: string) => void;
}

// ── Named font weight options ────────────────────────────────────────────

const FONT_WEIGHT_OPTIONS: readonly SelectOption[] = [
  { value: "100", label: "Thin (100)" },
  { value: "200", label: "Extra Light (200)" },
  { value: "300", label: "Light (300)" },
  { value: "400", label: "Regular (400)" },
  { value: "500", label: "Medium (500)" },
  { value: "600", label: "Semi Bold (600)" },
  { value: "700", label: "Bold (700)" },
  { value: "800", label: "Extra Bold (800)" },
  { value: "900", label: "Black (900)" },
];

// ── Component ───────────────────────────────────────────────────────────

export const TokenDetailEditor: Component<TokenDetailEditorProps> = (rawProps) => {
  const [props] = splitProps(rawProps, ["token", "tokens", "onUpdate", "onDelete"]);
  const [t] = useTransContext();

  // ── Description editor ──────────────────────────────────────────────

  function handleDescriptionChange(e: Event): void {
    const target = e.currentTarget as HTMLTextAreaElement;
    const desc = target.value.length > 0 ? target.value : undefined;
    props.onUpdate(props.token.name, props.token.value, desc);
  }

  // ── Value update helpers (type-safe wrappers) ────────────────────────

  function updateValue(newValue: TokenValue): void {
    props.onUpdate(props.token.name, newValue, props.token.description ?? undefined);
  }

  // ── Simple-type ValueInput handler ──────────────────────────────────

  /**
   * Shared onChange handler for all ValueInput-backed simple token types
   * (color, dimension, number, font_family).
   *
   * Parses the raw string from ValueInput into the appropriate TokenValue
   * variant and calls updateValue. Shows a toast on parse failure so the
   * user is informed — no silent discard per CLAUDE.md.
   *
   * Extracted per CLAUDE.md: "Business Logic Must Not Live in Inline JSX Handlers".
   */
  function handleSimpleValueChange(raw: string, tokenType: TokenType): void {
    const newValue = parseTokenValueChange(raw, tokenType);
    if (newValue === null) {
      if (raw.trim().length > 0) {
        showToast({
          title: t("panels:tokens.invalidValue") || "Invalid value",
          variant: "error",
        });
      }
      return;
    }
    updateValue(newValue);
  }

  // ── Simple-type ValueInput editors ───────────────────────────────────

  function renderColorEditor(): ReturnType<Component> {
    const displayValue = () => tokenValueToString(props.token.value);
    return (
      <div class="sigil-token-detail__field">
        <span class="sigil-token-detail__field-label">{t("panels:tokens.value")}</span>
        <ValueInput
          value={displayValue()}
          onChange={(raw) => handleSimpleValueChange(raw, "color")}
          tokens={props.tokens}
          acceptedTypes={acceptedTypesForToken(props.token.token_type)}
          aria-label={t("panels:tokens.value")}
        />
      </div>
    );
  }

  function renderDimensionEditor(): ReturnType<Component> {
    const displayValue = () => tokenValueToString(props.token.value);
    return (
      <div class="sigil-token-detail__field">
        <span class="sigil-token-detail__field-label">{t("panels:tokens.value")}</span>
        <ValueInput
          value={displayValue()}
          onChange={(raw) => handleSimpleValueChange(raw, "dimension")}
          tokens={props.tokens}
          acceptedTypes={acceptedTypesForToken(props.token.token_type)}
          placeholder="e.g. 16px, 1.5rem, 50%"
          aria-label={t("panels:tokens.value")}
        />
      </div>
    );
  }

  function renderNumberEditor(): ReturnType<Component> {
    const displayValue = () => tokenValueToString(props.token.value);
    return (
      <div class="sigil-token-detail__field">
        <span class="sigil-token-detail__field-label">{t("panels:tokens.value")}</span>
        <ValueInput
          value={displayValue()}
          onChange={(raw) => handleSimpleValueChange(raw, "number")}
          tokens={props.tokens}
          acceptedTypes={acceptedTypesForToken(props.token.token_type)}
          aria-label={t("panels:tokens.value")}
        />
      </div>
    );
  }

  function renderFontFamilyEditor(): ReturnType<Component> {
    const displayValue = () => tokenValueToString(props.token.value);
    return (
      <div class="sigil-token-detail__field">
        <label class="sigil-token-detail__field-label">{t("panels:tokens.typeFontFamily")}</label>
        <ValueInput
          value={displayValue()}
          onChange={(raw) => handleSimpleValueChange(raw, "font_family")}
          tokens={props.tokens}
          acceptedTypes={acceptedTypesForToken(props.token.token_type)}
          aria-label={t("panels:tokens.typeFontFamily")}
        />
      </div>
    );
  }

  function renderFontWeightEditor(): ReturnType<Component> {
    const safeWeight = () => {
      if (props.token.value.type !== "font_weight") return 400;
      const w = props.token.value.weight;
      return Number.isFinite(w) ? w : 400;
    };
    return (
      <div class="sigil-token-detail__row">
        <div class="sigil-token-detail__field sigil-token-detail__field--grow">
          <NumberInput
            value={safeWeight()}
            onValueChange={(v) => {
              if (Number.isFinite(v)) {
                updateValue({ type: "font_weight", weight: v });
              }
            }}
            label={t("panels:tokens.typeFontWeight")}
            min={MIN_FONT_WEIGHT}
            max={MAX_FONT_WEIGHT}
            step={FONT_WEIGHT_STEP}
          />
        </div>
        <div class="sigil-token-detail__field">
          <Select
            options={[...FONT_WEIGHT_OPTIONS]}
            value={String(safeWeight())}
            onValueChange={(v) => {
              const parsed = parseInt(v, 10);
              if (Number.isFinite(parsed)) {
                updateValue({ type: "font_weight", weight: parsed });
              }
            }}
            aria-label={t("panels:tokens.typeFontWeight")}
          />
        </div>
      </div>
    );
  }

  function renderDurationEditor(): ReturnType<Component> {
    const safeSeconds = () => {
      if (props.token.value.type !== "duration") return 0;
      const s = props.token.value.seconds;
      return Number.isFinite(s) ? s : 0;
    };
    return (
      <div class="sigil-token-detail__field">
        <NumberInput
          value={safeSeconds()}
          onValueChange={(v) => {
            if (Number.isFinite(v)) {
              updateValue({ type: "duration", seconds: v });
            }
          }}
          label={t("panels:tokens.typeDuration")}
          min={MIN_DURATION}
          max={MAX_DURATION}
          step={0.1}
          suffix="s"
        />
      </div>
    );
  }

  function renderCubicBezierEditor(): ReturnType<Component> {
    const labels = ["P1x", "P1y", "P2x", "P2y"];
    const values = (): readonly [number, number, number, number] => {
      if (props.token.value.type !== "cubic_bezier") return [0, 0, 0, 0];
      return props.token.value.values;
    };
    return (
      <div class="sigil-token-detail__bezier-grid">
        <For each={labels}>
          {(label, i) => (
            <NumberInput
              value={Number.isFinite(values()[i()]) ? values()[i()] : 0}
              onValueChange={(v) => {
                if (Number.isFinite(v)) {
                  const newValues = [...values()] as [number, number, number, number];
                  newValues[i()] = v;
                  updateValue({ type: "cubic_bezier", values: newValues });
                }
              }}
              prefix={label}
              min={MIN_BEZIER}
              max={MAX_BEZIER}
              step={BEZIER_STEP}
              aria-label={label}
            />
          )}
        </For>
      </div>
    );
  }

  function renderShadowEditor(): ReturnType<Component> {
    const val = () => {
      if (props.token.value.type !== "shadow") return null;
      return props.token.value.value;
    };

    return (
      <Show when={val()}>
        {(shadow) => (
          <div class="sigil-token-detail__shadow-grid">
            <div class="sigil-token-detail__field">
              <span class="sigil-token-detail__field-label">{t("panels:tokens.typeColor")}</span>
              <ColorPicker
                color={shadow().color}
                onColorChange={(c) =>
                  updateValue({
                    type: "shadow",
                    value: { ...shadow(), color: c },
                  })
                }
              />
            </div>
            <NumberInput
              value={Number.isFinite(shadow().offset.x) ? shadow().offset.x : 0}
              onValueChange={(v) => {
                if (Number.isFinite(v)) {
                  updateValue({
                    type: "shadow",
                    value: {
                      ...shadow(),
                      offset: { x: v, y: shadow().offset.y },
                    },
                  });
                }
              }}
              prefix="X"
              min={MIN_SHADOW_OFFSET}
              max={MAX_SHADOW_OFFSET}
              aria-label="Offset X"
            />
            <NumberInput
              value={Number.isFinite(shadow().offset.y) ? shadow().offset.y : 0}
              onValueChange={(v) => {
                if (Number.isFinite(v)) {
                  updateValue({
                    type: "shadow",
                    value: {
                      ...shadow(),
                      offset: { x: shadow().offset.x, y: v },
                    },
                  });
                }
              }}
              prefix="Y"
              min={MIN_SHADOW_OFFSET}
              max={MAX_SHADOW_OFFSET}
              aria-label="Offset Y"
            />
            <NumberInput
              value={Number.isFinite(shadow().blur) ? shadow().blur : 0}
              onValueChange={(v) => {
                if (Number.isFinite(v)) {
                  updateValue({
                    type: "shadow",
                    value: { ...shadow(), blur: v },
                  });
                }
              }}
              prefix="B"
              min={MIN_SHADOW_BLUR}
              max={MAX_SHADOW_BLUR}
              aria-label="Blur"
            />
            <NumberInput
              value={Number.isFinite(shadow().spread) ? shadow().spread : 0}
              onValueChange={(v) => {
                if (Number.isFinite(v)) {
                  updateValue({
                    type: "shadow",
                    value: { ...shadow(), spread: v },
                  });
                }
              }}
              prefix="S"
              min={MIN_SHADOW_BLUR}
              max={MAX_SHADOW_BLUR}
              aria-label="Spread"
            />
          </div>
        )}
      </Show>
    );
  }

  function renderTypographyEditor(): ReturnType<Component> {
    const val = () => {
      if (props.token.value.type !== "typography") return null;
      return props.token.value.value;
    };

    return (
      <Show when={val()}>
        {(typo) => (
          <div class="sigil-token-detail__typography-grid">
            <div class="sigil-token-detail__field">
              {/* RF-018: for/id association links label to input for screen readers. */}
              <label class="sigil-token-detail__field-label" for="token-detail-typo-font-family">
                {t("panels:tokens.typeFontFamily")}
              </label>
              <input
                id="token-detail-typo-font-family"
                class="sigil-token-detail__text-input"
                type="text"
                value={typo().font_family}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const fam = e.currentTarget.value.trim();
                  if (fam.length === 0) return;
                  // RF-030: gate typography font_family writes through the
                  // same validation used everywhere else (matches
                  // FONT_FAMILY_FORBIDDEN_CHARS in crates/core/src/validate.rs).
                  // Without this gate a user could persist `'; drop-shadow"`
                  // into a typography token and corrupt every canvas render
                  // that interpolates the family into ctx.font / CSS strings.
                  if (!validateCssIdentifier(fam)) {
                    showToast({
                      title: t("panels:typography.fontFamilyInvalid"),
                      variant: "error",
                    });
                    // Revert the DOM so the user sees their input rejected
                    // rather than silently accepted visually but dropped
                    // in the store.
                    e.currentTarget.value = typo().font_family;
                    return;
                  }
                  updateValue({
                    type: "typography",
                    value: { ...typo(), font_family: fam },
                  });
                }}
              />
            </div>
            <NumberInput
              value={Number.isFinite(typo().font_size) ? typo().font_size : 16}
              onValueChange={(v) => {
                if (Number.isFinite(v)) {
                  updateValue({
                    type: "typography",
                    value: { ...typo(), font_size: v },
                  });
                }
              }}
              label={t("panels:typography.fontSize")}
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
            />
            <NumberInput
              value={Number.isFinite(typo().font_weight) ? typo().font_weight : 400}
              onValueChange={(v) => {
                if (Number.isFinite(v)) {
                  updateValue({
                    type: "typography",
                    value: { ...typo(), font_weight: v },
                  });
                }
              }}
              label={t("panels:typography.fontWeight")}
              min={MIN_FONT_WEIGHT}
              max={MAX_FONT_WEIGHT}
              step={FONT_WEIGHT_STEP}
            />
            <NumberInput
              value={Number.isFinite(typo().line_height) ? typo().line_height : 1.5}
              onValueChange={(v) => {
                if (Number.isFinite(v)) {
                  updateValue({
                    type: "typography",
                    value: { ...typo(), line_height: v },
                  });
                }
              }}
              label={t("panels:typography.lineHeight")}
              min={MIN_LINE_HEIGHT}
              max={MAX_LINE_HEIGHT}
              step={0.1}
            />
            <NumberInput
              value={Number.isFinite(typo().letter_spacing) ? typo().letter_spacing : 0}
              onValueChange={(v) => {
                if (Number.isFinite(v)) {
                  updateValue({
                    type: "typography",
                    value: { ...typo(), letter_spacing: v },
                  });
                }
              }}
              label={t("panels:typography.letterSpacing")}
              min={MIN_LETTER_SPACING}
              max={MAX_LETTER_SPACING}
              step={0.1}
            />
          </div>
        )}
      </Show>
    );
  }

  /**
   * Parse an expression/alias string from ValueInput and store
   * the appropriate TokenValue variant.
   *
   * If the string is a bare token reference `{name}` with no operators,
   * store as alias. Otherwise store as expression.
   *
   * Extracted per CLAUDE.md: "Business Logic Must Not Live in Inline JSX Handlers".
   */
  function handleExpressionChange(rawValue: string): void {
    const trimmed = rawValue.trim();
    // RF-019: show error on empty expression instead of silently returning
    if (!trimmed) {
      showToast({
        title: t("panels:tokens.emptyExpression") || "Expression cannot be empty",
        variant: "error",
      });
      return;
    }

    // Check if it's a bare token reference: {token.name} with no operators
    const bareRefMatch = trimmed.match(/^\{([a-zA-Z][a-zA-Z0-9._-]*)\}$/);
    if (bareRefMatch) {
      // Store as alias
      updateValue({ type: "alias", name: bareRefMatch[1] });
      return;
    }

    // Otherwise store as expression
    updateValue({ type: "expression", expr: trimmed });
  }

  function renderAliasEditor(): ReturnType<Component> {
    const aliasValue = () => {
      if (props.token.value.type !== "alias") return "";
      return `{${props.token.value.name}}`;
    };
    return (
      <div class="sigil-token-detail__field">
        <label class="sigil-token-detail__field-label">{t("panels:tokens.typeAlias")}</label>
        <ValueInput
          value={aliasValue()}
          onChange={handleExpressionChange}
          tokens={props.tokens}
          tokenType={props.token.token_type}
          aria-label={t("panels:tokens.typeAlias")}
        />
      </div>
    );
  }

  function renderGradientEditor(): ReturnType<Component> {
    const stopCount = () =>
      props.token.value.type === "gradient" ? props.token.value.gradient.stops.length : 0;
    return (
      <div class="sigil-token-detail__field">
        <span class="sigil-token-detail__field-label">{t("panels:tokens.typeGradient")}</span>
        <span class="sigil-token-detail__readonly-value">{stopCount()} stops</span>
      </div>
    );
  }

  function renderExpressionEditor(): ReturnType<Component> {
    const exprValue = () =>
      props.token.value.type === "expression" ? props.token.value.expr : "";
    return (
      <div class="sigil-token-detail__field">
        <label class="sigil-token-detail__field-label">{t("panels:tokens.typeExpression")}</label>
        <ValueInput
          value={exprValue()}
          onChange={handleExpressionChange}
          tokens={props.tokens}
          tokenType={props.token.token_type}
          aria-label="Expression"
        />
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────
  //
  // Branch selection uses <Switch>/<Match> keyed on `props.token.value.type`.
  // Solid's Switch installs a single reactive memo tracking the matched branch;
  // when `type` remains stable across token mutations (e.g., the hex channel
  // of a color token changes during color-picker drag), the active Match stays
  // the same and its already-mounted DOM subtree is preserved.
  //
  // Inserting the editor via `{renderValueEditor()}` previously wrapped the
  // whole editor in a reactive insert effect that re-evaluated on every
  // `props.token.value` change, replacing the DOM subtree — which unmounted
  // any open Popover mid-drag (the Token dialog color-picker regression).

  return (
    // F-17: Use dedicated i18n key for form label context
    <div
      class="sigil-token-detail"
      role="form"
      aria-label={t("panels:tokens.editTokenForm", { name: props.token.name })}
    >
      <Switch>
        <Match when={props.token.value.type === "color"}>{renderColorEditor()}</Match>
        <Match when={props.token.value.type === "dimension"}>{renderDimensionEditor()}</Match>
        <Match when={props.token.value.type === "number"}>{renderNumberEditor()}</Match>
        <Match when={props.token.value.type === "font_family"}>{renderFontFamilyEditor()}</Match>
        <Match when={props.token.value.type === "font_weight"}>{renderFontWeightEditor()}</Match>
        <Match when={props.token.value.type === "duration"}>{renderDurationEditor()}</Match>
        <Match when={props.token.value.type === "cubic_bezier"}>{renderCubicBezierEditor()}</Match>
        <Match when={props.token.value.type === "shadow"}>{renderShadowEditor()}</Match>
        <Match when={props.token.value.type === "gradient"}>{renderGradientEditor()}</Match>
        <Match when={props.token.value.type === "typography"}>{renderTypographyEditor()}</Match>
        <Match when={props.token.value.type === "alias"}>{renderAliasEditor()}</Match>
        <Match when={props.token.value.type === "expression"}>{renderExpressionEditor()}</Match>
      </Switch>

      <div class="sigil-token-detail__field">
        <label class="sigil-token-detail__field-label">{t("panels:tokens.description")}</label>
        <textarea
          class="sigil-token-detail__textarea"
          value={props.token.description ?? ""}
          maxLength={MAX_TOKEN_DESCRIPTION_LENGTH}
          rows={3}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={handleDescriptionChange}
          placeholder={t("panels:tokens.description")}
        />
      </div>

      <Show when={props.onDelete}>
        <button
          class="sigil-token-detail__delete-button"
          onClick={() => props.onDelete?.(props.token.name)}
        >
          {/* F-15: Use dedicated i18n key for delete button label */}
          {t("panels:tokens.deleteButton")}
        </button>
      </Show>
    </div>
  );
};
