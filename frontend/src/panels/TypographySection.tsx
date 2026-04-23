/**
 * TypographySection — text style controls shown when a text node is selected.
 *
 * Controls:
 * - Font family (text input)
 * - Font weight (select dropdown: 100–900 in steps of 100)
 * - Font size (NumberInput with px suffix)
 * - Font style (toggle button for italic)
 * - Line height (NumberInput with px suffix)
 * - Letter spacing (NumberInput with px suffix)
 * - Text align (4-button segmented control: left, center, right, justify)
 * - Text decoration (toggle buttons: underline, strikethrough)
 * - Text color (ColorSwatch reusing existing component)
 *
 * Each control calls `store.setTextStyle(uuid, field, value)`.
 *
 * All numeric values from NumberInput are guarded with Number.isFinite()
 * before use per CLAUDE.md section 11 Floating-Point Validation.
 *
 * Keyboard shortcuts (when text node is selected):
 * - Cmd+B toggles font_weight 400/700
 * - Cmd+I toggles font_style normal/italic
 * - Cmd+U toggles text_decoration none/underline
 */
import {
  createMemo,
  createSignal,
  Index,
  onCleanup,
  onMount,
  Show,
  type Component,
} from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import type {
  Color,
  FontStyle,
  NodeKindText,
  StyleValue,
  TextAlign,
  TextDecoration,
  TextShadow,
} from "../types/document";
import { useDocument } from "../store/document-context";
import { NumberInput } from "../components/number-input/NumberInput";
import { Select } from "../components/select/Select";
import { ToggleButton } from "../components/toggle-button/ToggleButton";
import { ColorSwatch } from "../components/color-picker";
import ValueInput from "../components/value-input/ValueInput";
import { SystemFontProvider } from "../components/value-input/font-provider";
import { showToast } from "../components/toast/Toast";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Italic,
  Underline,
  Strikethrough,
} from "lucide-solid";
import { validateCssIdentifier } from "../validation/css-identifiers";
import {
  formatColorStyleValue,
  formatNumberStyleValue,
  parseColorInput,
  parseNumberInput,
} from "./panel-value-helpers";
import "./TypographySection.css";

/** Single shared instance — SystemFontProvider is stateless. */
const systemFontProvider = new SystemFontProvider();

// ── Validation constants ─────────────────────────────────────────────

/** RF-022: Maximum font size in pixels. Values above this are rejected. */
const MAX_FONT_SIZE = 10_000;

/** Maximum text shadow blur radius in pixels. */
const MAX_SHADOW_BLUR = 1000;

/** RF-018: Maximum shadow offset value in pixels. */
const MAX_SHADOW_OFFSET = 1000;

/** RF-018: Minimum shadow offset value in pixels. */
const MIN_SHADOW_OFFSET = -1000;

// RF-005: Frontend UX bounds for text style numeric fields. The Rust server
// only enforces `line_height > 0` and `letter_spacing finite` (see
// crates/core/src/validate.rs :: validate_text_style_line_height /
// validate_text_style_letter_spacing); these constants add a practical upper
// bound for user feedback so absurdly large values are caught before they
// hit the network. `MIN_LINE_HEIGHT` is a UX minimum — the server still
// enforces `> 0` authoritatively, but `0.1` matches the old NumberInput
// `min` and avoids unusably small line heights.

/** Minimum line height multiplier (literal branch only). */
export const MIN_LINE_HEIGHT = 0.1;
/** Maximum line height multiplier (literal branch only). */
export const MAX_LINE_HEIGHT = 10;
/** Minimum letter spacing in pixels (literal branch only). */
export const MIN_LETTER_SPACING = -100;
/** Maximum letter spacing in pixels (literal branch only). */
export const MAX_LETTER_SPACING = 100;

/** Default text shadow values when toggling shadow on. */
const DEFAULT_TEXT_SHADOW: TextShadow = {
  offset_x: 0,
  offset_y: 2,
  blur_radius: 4,
  color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 0.3 } },
};

// ── Font weight option values (labels resolved via i18n at render time) ──

const FONT_WEIGHT_VALUES = ["100", "200", "300", "400", "500", "600", "700", "800", "900"] as const;

// ── Text align options ───────────────────────────────────────────────

interface TextAlignOption {
  readonly value: TextAlign;
  /** i18n key for the label, resolved at render time. */
  readonly labelKey: string;
  readonly icon: typeof AlignLeft;
}

const TEXT_ALIGN_OPTIONS: readonly TextAlignOption[] = [
  { value: "left", labelKey: "panels:typography.alignLeft", icon: AlignLeft },
  { value: "center", labelKey: "panels:typography.alignCenter", icon: AlignCenter },
  { value: "right", labelKey: "panels:typography.alignRight", icon: AlignRight },
  { value: "justify", labelKey: "panels:typography.justify", icon: AlignJustify },
] as const;

// ── TypographySection ────────────────────────────────────────────────

export const TypographySection: Component = () => {
  const store = useDocument();
  const [t] = useTransContext();

  // ── Live region for discrete status announcements ──────────────────
  const [announcement, setAnnouncement] = createSignal("");

  function announce(message: string): void {
    setAnnouncement("");
    queueMicrotask(() => setAnnouncement(message));
  }

  // ── Derived state ─────────────────────────────────────────────────

  const selectedUuid = createMemo(() => store.selectedNodeId());

  const textKind = createMemo((): NodeKindText | null => {
    const uuid = selectedUuid();
    if (!uuid) return null;
    const node = store.state.nodes[uuid];
    if (!node) return null;
    if (node.kind.type !== "text") return null;
    return node.kind as NodeKindText;
  });

  const fontFamily = createMemo((): string => {
    const kind = textKind();
    if (!kind) return "";
    return kind.text_style.font_family;
  });

  /** Font size as a display string for ValueInput. */
  const fontSizeDisplay = createMemo((): string => {
    const kind = textKind();
    if (!kind) return "";
    return formatNumberStyleValue(kind.text_style.font_size);
  });

  const fontWeight = createMemo((): number => {
    const kind = textKind();
    if (!kind) return 400;
    const raw = kind.text_style.font_weight;
    return Number.isFinite(raw) ? raw : 400;
  });

  const fontStyle = createMemo((): FontStyle => {
    const kind = textKind();
    if (!kind) return "normal";
    return kind.text_style.font_style;
  });

  /** Line height as a display string for ValueInput. */
  const lineHeightDisplay = createMemo((): string => {
    const kind = textKind();
    if (!kind) return "";
    return formatNumberStyleValue(kind.text_style.line_height);
  });

  /** Letter spacing as a display string for ValueInput. */
  const letterSpacingDisplay = createMemo((): string => {
    const kind = textKind();
    if (!kind) return "";
    return formatNumberStyleValue(kind.text_style.letter_spacing);
  });

  const textAlign = createMemo((): TextAlign => {
    const kind = textKind();
    if (!kind) return "left";
    return kind.text_style.text_align;
  });

  const textDecoration = createMemo((): TextDecoration => {
    const kind = textKind();
    if (!kind) return "none";
    return kind.text_style.text_decoration;
  });

  /** Text color as a display string for ValueInput. */
  const textColorDisplay = createMemo((): string => {
    const kind = textKind();
    if (!kind) return "";
    return formatColorStyleValue(kind.text_style.text_color);
  });

  const textShadow = createMemo((): TextShadow | null => {
    const kind = textKind();
    if (!kind) return null;
    return kind.text_style.text_shadow ?? null;
  });

  const shadowEnabled = createMemo((): boolean => textShadow() !== null);

  const shadowOffsetX = createMemo((): number => {
    const shadow = textShadow();
    if (!shadow) return 0;
    return Number.isFinite(shadow.offset_x) ? shadow.offset_x : 0;
  });

  const shadowOffsetY = createMemo((): number => {
    const shadow = textShadow();
    if (!shadow) return 2;
    return Number.isFinite(shadow.offset_y) ? shadow.offset_y : 2;
  });

  const shadowBlur = createMemo((): number => {
    const shadow = textShadow();
    if (!shadow) return 4;
    return Number.isFinite(shadow.blur_radius) ? shadow.blur_radius : 4;
  });

  const shadowColor = createMemo((): Color => {
    const shadow = textShadow();
    if (!shadow) return { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
    if (shadow.color.type !== "literal") return { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
    return shadow.color.value;
  });

  // ── Font weight options with i18n labels ────────────────────────────
  const fontWeightOptions = () =>
    FONT_WEIGHT_VALUES.map((value) => ({
      value,
      label: `${t(`panels:fontWeight.${value}`)} (${value})`,
    }));

  // ── Handlers ──────────────────────────────────────────────────────

  function handleFontFamilyChange(value: string): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    // RF-007: Surface a visible message when the user attempts to bind a
    // token or write an expression in the font_family field. The core
    // `TextStylePatch["font_family"]` type is still a plain `string`, not
    // a `StyleValue<string>`, so token refs cannot be persisted here —
    // silently rejecting them left the user with a DOM revert and no
    // diagnostic. TODO(spec-13c): Promote TextStylePatch.font_family to
    // StyleValue<string> to enable token binding for font families.
    if (value.includes("{") || value.includes("}")) {
      showToast({
        title: t("panels:typography.fontFamilyNoTokenBinding"),
        variant: "info",
      });
      return;
    }
    // RF-006: Reject font families containing CSS-significant characters.
    if (!validateCssIdentifier(value)) {
      showToast({
        title: t("panels:typography.fontFamilyInvalid"),
        variant: "error",
      });
      return;
    }
    store.setTextStyle(uuid, { field: "font_family", value });
  }

  function handleFontFamilyCommit(_value: string): void {
    // RF-004: onChange already applied the value during the gesture.
    store.flushHistory();
  }

  function handleFontSizeChange(raw: string): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const parsed = parseNumberInput(raw);
    if (!parsed) return;
    if (parsed.type === "literal") {
      const v = parsed.value;
      if (!Number.isFinite(v)) return;
      if (v <= 0) return;
      // RF-022: Reject font sizes above the upper bound.
      if (v > MAX_FONT_SIZE) return;
    }
    store.setTextStyle(uuid, { field: "font_size", value: parsed });
  }

  function handleFontSizeCommit(_raw: string): void {
    // RF-004: onChange already applied the value during the gesture.
    store.flushHistory();
  }

  function handleFontWeightChange(value: string): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const weight = parseInt(value, 10);
    if (!Number.isFinite(weight)) return;
    store.setTextStyle(uuid, { field: "font_weight", value: weight });
    announce(t("a11y:typography.fontWeightSet", { weight: value }));
  }

  function handleFontStyleToggle(pressed: boolean): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const newStyle: FontStyle = pressed ? "italic" : "normal";
    store.setTextStyle(uuid, { field: "font_style", value: newStyle });
    announce(t("a11y:typography.fontStyle", { style: newStyle }));
  }

  function handleLineHeightChange(raw: string): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const parsed = parseNumberInput(raw);
    if (!parsed) return;
    if (parsed.type === "literal") {
      if (!Number.isFinite(parsed.value)) return;
      // RF-005: Reject literal values outside the UX-allowed range and
      // surface a toast — do not silently drop, which revealed nothing to
      // the user. Token refs and expressions are deferred to eval time.
      if (parsed.value < MIN_LINE_HEIGHT || parsed.value > MAX_LINE_HEIGHT) {
        showToast({
          title: t("panels:typography.lineHeightOutOfRange", {
            min: MIN_LINE_HEIGHT,
            max: MAX_LINE_HEIGHT,
          }),
          variant: "error",
        });
        return;
      }
    }
    store.setTextStyle(uuid, { field: "line_height", value: parsed });
  }

  function handleLineHeightCommit(_raw: string): void {
    // RF-004: onChange already applied the value during the gesture.
    store.flushHistory();
  }

  function handleLetterSpacingChange(raw: string): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const parsed = parseNumberInput(raw);
    if (!parsed) return;
    if (parsed.type === "literal") {
      if (!Number.isFinite(parsed.value)) return;
      // RF-005: Same rationale as line_height — surface an out-of-range
      // toast instead of a silent drop.
      if (parsed.value < MIN_LETTER_SPACING || parsed.value > MAX_LETTER_SPACING) {
        showToast({
          title: t("panels:typography.letterSpacingOutOfRange", {
            min: MIN_LETTER_SPACING,
            max: MAX_LETTER_SPACING,
          }),
          variant: "error",
        });
        return;
      }
    }
    store.setTextStyle(uuid, { field: "letter_spacing", value: parsed });
  }

  function handleLetterSpacingCommit(_raw: string): void {
    // RF-004: onChange already applied the value during the gesture.
    store.flushHistory();
  }

  function handleTextAlignChange(align: TextAlign): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    store.setTextStyle(uuid, { field: "text_align", value: align });
    announce(t("a11y:typography.textAlign", { alignment: align }));
  }

  function handleTextDecorationToggle(decoration: TextDecoration): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const current = textDecoration();
    const newDecoration: TextDecoration = current === decoration ? "none" : decoration;
    store.setTextStyle(uuid, { field: "text_decoration", value: newDecoration });
    announce(t("a11y:typography.textDecoration", { decoration: newDecoration }));
  }

  function handleTextColorChange(raw: string): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const parsed = parseColorInput(raw);
    if (!parsed) return;
    store.setTextStyle(uuid, { field: "text_color", value: parsed });
  }

  function handleTextColorCommit(_raw: string): void {
    // RF-004: onChange already applied the value during the gesture.
    store.flushHistory();
  }

  function handleShadowToggle(enabled: boolean): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    if (enabled) {
      store.setTextStyle(uuid, {
        field: "text_shadow",
        value: structuredClone(DEFAULT_TEXT_SHADOW),
      });
      announce(t("a11y:typography.shadowEnabled"));
    } else {
      store.setTextStyle(uuid, { field: "text_shadow", value: null });
      announce(t("a11y:typography.shadowDisabled"));
    }
  }

  function handleShadowOffsetXChange(value: number): void {
    if (!Number.isFinite(value)) return;
    if (value < MIN_SHADOW_OFFSET || value > MAX_SHADOW_OFFSET) return;
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const current = textShadow();
    if (!current) return;
    const updated: TextShadow = { ...current, offset_x: value };
    store.setTextStyle(uuid, { field: "text_shadow", value: updated });
  }

  function handleShadowOffsetYChange(value: number): void {
    if (!Number.isFinite(value)) return;
    if (value < MIN_SHADOW_OFFSET || value > MAX_SHADOW_OFFSET) return;
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const current = textShadow();
    if (!current) return;
    const updated: TextShadow = { ...current, offset_y: value };
    store.setTextStyle(uuid, { field: "text_shadow", value: updated });
  }

  function handleShadowBlurChange(value: number): void {
    if (!Number.isFinite(value)) return;
    if (value < 0 || value > MAX_SHADOW_BLUR) return;
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const current = textShadow();
    if (!current) return;
    const updated: TextShadow = { ...current, blur_radius: value };
    store.setTextStyle(uuid, { field: "text_shadow", value: updated });
  }

  function handleShadowColorChange(color: Color): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const current = textShadow();
    if (!current) return;
    const sv: StyleValue<Color> = { type: "literal", value: color };
    const updated: TextShadow = { ...current, color: sv };
    store.setTextStyle(uuid, { field: "text_shadow", value: updated });
  }

  // ── Keyboard shortcuts (Cmd+B, Cmd+I, Cmd+U) ─────────────────────

  function handleKeyDown(e: KeyboardEvent): void {
    // RF-009: Respect other handlers that already handled this event.
    if (e.defaultPrevented) return;

    // Only act when a text node is selected
    if (!textKind()) return;

    const isMeta = e.metaKey || e.ctrlKey;
    if (!isMeta) return;

    const uuid = selectedUuid();
    if (!uuid) return;

    if (e.key === "b" || e.key === "B") {
      e.preventDefault();
      e.stopPropagation();
      const current = fontWeight();
      const newWeight = current >= 700 ? 400 : 700;
      store.setTextStyle(uuid, { field: "font_weight", value: newWeight });
      announce(t("a11y:typography.fontWeightSet", { weight: String(newWeight) }));
    } else if (e.key === "i" || e.key === "I") {
      e.preventDefault();
      e.stopPropagation();
      const current = fontStyle();
      const newStyle: FontStyle = current === "italic" ? "normal" : "italic";
      store.setTextStyle(uuid, { field: "font_style", value: newStyle });
      announce(t("a11y:typography.fontStyle", { style: newStyle }));
    } else if (e.key === "u" || e.key === "U") {
      e.preventDefault();
      e.stopPropagation();
      const current = textDecoration();
      const newDecoration: TextDecoration = current === "underline" ? "none" : "underline";
      store.setTextStyle(uuid, { field: "text_decoration", value: newDecoration });
      announce(t("a11y:typography.textDecoration", { decoration: newDecoration }));
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  // ── Render ────────────────────────────────────────────────────────

  const disabled = () => selectedUuid() === null || textKind() === null;

  return (
    <div class="sigil-typography-section" role="region" aria-labelledby="typography-section-title">
      <h3 class="sigil-typography-section__title" id="typography-section-title">
        {t("panels:typography.title")}
      </h3>

      {/* ── Font family + weight ───────────────────────────────────── */}
      <div class="sigil-typography-section__font-row">
        {/*
          TODO(spec-13c): Promote TextStylePatch.font_family to
          StyleValue<string> so font families can bind to tokens. Until
          that data-model change lands, we intentionally omit token
          autocomplete (no `tokens` prop, no `font_family` accepted type)
          and render a plain string input with system font suggestions.
          Accepting `font_family` here would produce a token dropdown
          that silently drops selections in handleFontFamilyChange.
        */}
        <ValueInput
          value={fontFamily()}
          onChange={handleFontFamilyChange}
          onCommit={handleFontFamilyCommit}
          tokens={{}}
          acceptedTypes={["string"]}
          fontProvider={systemFontProvider}
          aria-label={t("panels:typography.fontFamily")}
          placeholder={t("panels:typography.fontFamily")}
          disabled={disabled()}
        />
        <Select
          options={fontWeightOptions()}
          value={String(fontWeight())}
          onValueChange={handleFontWeightChange}
          aria-label={t("panels:typography.fontWeight")}
          disabled={disabled()}
        />
      </div>

      {/* ── Font size + italic toggle ──────────────────────────────── */}
      <div class="sigil-typography-section__size-row">
        <ValueInput
          value={fontSizeDisplay()}
          onChange={handleFontSizeChange}
          onCommit={handleFontSizeCommit}
          tokens={store.state.tokens}
          acceptedTypes={["number", "dimension"]}
          aria-label={t("panels:typography.fontSize")}
          disabled={disabled()}
        />
        <ToggleButton
          pressed={fontStyle() === "italic"}
          onPressedChange={handleFontStyleToggle}
          aria-label={t("panels:typography.italic")}
          disabled={disabled()}
        >
          <Italic size={14} />
        </ToggleButton>
      </div>

      {/* ── Line height + letter spacing ───────────────────────────── */}
      <div class="sigil-typography-section__spacing-row">
        <ValueInput
          value={lineHeightDisplay()}
          onChange={handleLineHeightChange}
          onCommit={handleLineHeightCommit}
          tokens={store.state.tokens}
          acceptedTypes={["number"]}
          aria-label={t("panels:typography.lineHeight")}
          disabled={disabled()}
        />
        <ValueInput
          value={letterSpacingDisplay()}
          onChange={handleLetterSpacingChange}
          onCommit={handleLetterSpacingCommit}
          tokens={store.state.tokens}
          acceptedTypes={["number", "dimension"]}
          aria-label={t("panels:typography.letterSpacing")}
          disabled={disabled()}
        />
      </div>

      {/* ── Text align (segmented control) ─────────────────────────── */}
      <div
        class="sigil-typography-section__align-group"
        role="radiogroup"
        aria-label={t("panels:typography.textAlignment")}
        onKeyDown={(e: KeyboardEvent) => {
          // RF-024: Arrow-key navigation for text alignment radio group.
          const currentIdx = TEXT_ALIGN_OPTIONS.findIndex((o) => o.value === textAlign());
          let nextIdx = -1;
          if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault();
            nextIdx = (currentIdx + 1) % TEXT_ALIGN_OPTIONS.length;
          } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault();
            nextIdx = (currentIdx - 1 + TEXT_ALIGN_OPTIONS.length) % TEXT_ALIGN_OPTIONS.length;
          }
          if (nextIdx >= 0) {
            const next = TEXT_ALIGN_OPTIONS[nextIdx];
            if (next) {
              handleTextAlignChange(next.value);
              // Focus the newly-active radio button (roving tabindex)
              const group = e.currentTarget as HTMLElement;
              const buttons = group.querySelectorAll<HTMLButtonElement>("[role='radio']");
              buttons[nextIdx]?.focus();
            }
          }
        }}
      >
        <Index each={TEXT_ALIGN_OPTIONS}>
          {(opt) => (
            <button
              class="sigil-typography-section__align-btn"
              classList={{
                "sigil-typography-section__align-btn--active": textAlign() === opt().value,
              }}
              type="button"
              role="radio"
              aria-checked={textAlign() === opt().value}
              aria-label={t(opt().labelKey)}
              disabled={disabled()}
              tabIndex={textAlign() === opt().value ? 0 : -1}
              onClick={() => handleTextAlignChange(opt().value)}
            >
              {(() => {
                const Icon = opt().icon;
                return <Icon size={14} />;
              })()}
            </button>
          )}
        </Index>
      </div>

      {/* ── Text decoration toggles ────────────────────────────────── */}
      <div class="sigil-typography-section__decoration-row">
        <ToggleButton
          pressed={textDecoration() === "underline"}
          onPressedChange={() => handleTextDecorationToggle("underline")}
          aria-label={t("panels:typography.underline")}
          disabled={disabled()}
        >
          <Underline size={14} />
        </ToggleButton>
        <ToggleButton
          pressed={textDecoration() === "strikethrough"}
          onPressedChange={() => handleTextDecorationToggle("strikethrough")}
          aria-label={t("panels:typography.strikethrough")}
          disabled={disabled()}
        >
          <Strikethrough size={14} />
        </ToggleButton>
      </div>

      {/* ── Text color ─────────────────────────────────────────────── */}
      <div class="sigil-typography-section__color-row">
        <span class="sigil-typography-section__color-label" aria-hidden="true">
          {t("panels:typography.color")}
        </span>
        <ValueInput
          value={textColorDisplay()}
          onChange={handleTextColorChange}
          onCommit={handleTextColorCommit}
          tokens={store.state.tokens}
          acceptedTypes={["color"]}
          aria-label={t("panels:typography.textColor")}
          disabled={disabled()}
        />
      </div>

      {/* ── Text shadow ──────────────────────────────────────────── */}
      <div
        class="sigil-typography-section__shadow-section"
        role="group"
        aria-label={t("panels:typography.shadowGroup")}
      >
        <div class="sigil-typography-section__shadow-header">
          <span class="sigil-typography-section__shadow-label" aria-hidden="true">
            {t("panels:typography.shadow")}
          </span>
          <ToggleButton
            pressed={shadowEnabled()}
            onPressedChange={handleShadowToggle}
            aria-label={t("panels:typography.shadowToggle")}
            aria-expanded={shadowEnabled()}
            aria-controls="shadow-controls"
            disabled={disabled()}
          >
            {shadowEnabled() ? t("panels:typography.shadowOn") : t("panels:typography.shadowOff")}
          </ToggleButton>
        </div>
        <Show when={shadowEnabled()}>
          <div id="shadow-controls" class="sigil-typography-section__shadow-controls">
            <NumberInput
              value={shadowOffsetX()}
              onValueChange={handleShadowOffsetXChange}
              aria-label={t("panels:typography.shadowOffsetX")}
              step={1}
              min={MIN_SHADOW_OFFSET}
              max={MAX_SHADOW_OFFSET}
              suffix="px"
              disabled={disabled()}
            />
            <NumberInput
              value={shadowOffsetY()}
              onValueChange={handleShadowOffsetYChange}
              aria-label={t("panels:typography.shadowOffsetY")}
              step={1}
              min={MIN_SHADOW_OFFSET}
              max={MAX_SHADOW_OFFSET}
              suffix="px"
              disabled={disabled()}
            />
            <NumberInput
              value={shadowBlur()}
              onValueChange={handleShadowBlurChange}
              aria-label={t("panels:typography.shadowBlur")}
              step={1}
              min={0}
              max={MAX_SHADOW_BLUR}
              suffix="px"
              disabled={disabled()}
            />
            <ColorSwatch
              color={shadowColor()}
              onColorChange={handleShadowColorChange}
              aria-label={t("panels:typography.shadowColor")}
            />
          </div>
        </Show>
      </div>

      {/* Live region for discrete status announcements (RF-009) */}
      <span role="status" aria-live="polite" class="sr-only">
        {announcement()}
      </span>
    </div>
  );
};
