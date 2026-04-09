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
import { createMemo, createSignal, onCleanup, onMount, type Component } from "solid-js";
import type {
  Color,
  FontStyle,
  NodeKindText,
  StyleValue,
  TextAlign,
  TextDecoration,
} from "../types/document";
import { useDocument } from "../store/document-context";
import { TextInput } from "../components/text-input/TextInput";
import { NumberInput } from "../components/number-input/NumberInput";
import { Select } from "../components/select/Select";
import { ToggleButton } from "../components/toggle-button/ToggleButton";
import { ColorSwatch } from "../components/color-picker";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Italic,
  Underline,
  Strikethrough,
} from "lucide-solid";
import "./TypographySection.css";

// ── Font weight options ──────────────────────────────────────────────

const FONT_WEIGHT_OPTIONS = [
  { value: "100", label: "Thin (100)" },
  { value: "200", label: "Extra Light (200)" },
  { value: "300", label: "Light (300)" },
  { value: "400", label: "Regular (400)" },
  { value: "500", label: "Medium (500)" },
  { value: "600", label: "Semi Bold (600)" },
  { value: "700", label: "Bold (700)" },
  { value: "800", label: "Extra Bold (800)" },
  { value: "900", label: "Black (900)" },
] as const;

// ── Text align options ───────────────────────────────────────────────

const TEXT_ALIGN_OPTIONS: readonly { value: TextAlign; label: string; icon: typeof AlignLeft }[] = [
  { value: "left", label: "Align left", icon: AlignLeft },
  { value: "center", label: "Align center", icon: AlignCenter },
  { value: "right", label: "Align right", icon: AlignRight },
  { value: "justify", label: "Justify", icon: AlignJustify },
] as const;

// ── TypographySection ────────────────────────────────────────────────

export const TypographySection: Component = () => {
  const store = useDocument();

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

  const fontSize = createMemo((): number => {
    const kind = textKind();
    if (!kind) return 16;
    const sv = kind.text_style.font_size;
    if (sv.type !== "literal") return 16;
    const raw = sv.value;
    return Number.isFinite(raw) ? raw : 16;
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

  const lineHeight = createMemo((): number => {
    const kind = textKind();
    if (!kind) return 1.2;
    const sv = kind.text_style.line_height;
    if (sv.type !== "literal") return 1.2;
    const raw = sv.value;
    return Number.isFinite(raw) ? raw : 1.2;
  });

  const letterSpacing = createMemo((): number => {
    const kind = textKind();
    if (!kind) return 0;
    const sv = kind.text_style.letter_spacing;
    if (sv.type !== "literal") return 0;
    const raw = sv.value;
    return Number.isFinite(raw) ? raw : 0;
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

  const textColor = createMemo((): Color => {
    const kind = textKind();
    if (!kind) return { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
    const sv = kind.text_style.text_color;
    if (sv.type !== "literal") return { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
    return sv.value;
  });

  // ── Handlers ──────────────────────────────────────────────────────

  function handleFontFamilyChange(value: string): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    store.setTextStyle(uuid, "font_family", value);
  }

  function handleFontSizeChange(value: number): void {
    if (!Number.isFinite(value)) return;
    if (value <= 0) return;
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const sv: StyleValue<number> = { type: "literal", value };
    store.setTextStyle(uuid, "font_size", sv);
  }

  function handleFontWeightChange(value: string): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const weight = parseInt(value, 10);
    if (!Number.isFinite(weight)) return;
    store.setTextStyle(uuid, "font_weight", weight);
    announce(`Font weight set to ${value}`);
  }

  function handleFontStyleToggle(pressed: boolean): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const newStyle: FontStyle = pressed ? "italic" : "normal";
    store.setTextStyle(uuid, "font_style", newStyle);
    announce(`Font style ${newStyle}`);
  }

  function handleLineHeightChange(value: number): void {
    if (!Number.isFinite(value)) return;
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const sv: StyleValue<number> = { type: "literal", value };
    store.setTextStyle(uuid, "line_height", sv);
  }

  function handleLetterSpacingChange(value: number): void {
    if (!Number.isFinite(value)) return;
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const sv: StyleValue<number> = { type: "literal", value };
    store.setTextStyle(uuid, "letter_spacing", sv);
  }

  function handleTextAlignChange(align: TextAlign): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    store.setTextStyle(uuid, "text_align", align);
    announce(`Text alignment set to ${align}`);
  }

  function handleTextDecorationToggle(decoration: TextDecoration): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const current = textDecoration();
    const newDecoration: TextDecoration = current === decoration ? "none" : decoration;
    store.setTextStyle(uuid, "text_decoration", newDecoration);
    announce(`Text decoration ${newDecoration}`);
  }

  function handleTextColorChange(color: Color): void {
    const uuid = selectedUuid();
    if (!uuid || !textKind()) return;
    const sv: StyleValue<Color> = { type: "literal", value: color };
    store.setTextStyle(uuid, "text_color", sv);
  }

  // ── Keyboard shortcuts (Cmd+B, Cmd+I, Cmd+U) ─────────────────────

  function handleKeyDown(e: KeyboardEvent): void {
    // Only act when a text node is selected
    if (!textKind()) return;

    const isMeta = e.metaKey || e.ctrlKey;
    if (!isMeta) return;

    const uuid = selectedUuid();
    if (!uuid) return;

    if (e.key === "b" || e.key === "B") {
      e.preventDefault();
      const current = fontWeight();
      const newWeight = current >= 700 ? 400 : 700;
      store.setTextStyle(uuid, "font_weight", newWeight);
      announce(`Font weight ${newWeight === 700 ? "bold" : "regular"}`);
    } else if (e.key === "i" || e.key === "I") {
      e.preventDefault();
      const current = fontStyle();
      const newStyle: FontStyle = current === "italic" ? "normal" : "italic";
      store.setTextStyle(uuid, "font_style", newStyle);
      announce(`Font style ${newStyle}`);
    } else if (e.key === "u" || e.key === "U") {
      e.preventDefault();
      const current = textDecoration();
      const newDecoration: TextDecoration = current === "underline" ? "none" : "underline";
      store.setTextStyle(uuid, "text_decoration", newDecoration);
      announce(`Text decoration ${newDecoration}`);
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
    <div
      class="sigil-typography-section"
      role="region"
      aria-label="Typography"
    >
      <span class="sigil-typography-section__title" id="typography-section-title">
        Typography
      </span>

      {/* ── Font family + weight ───────────────────────────────────── */}
      <div class="sigil-typography-section__font-row">
        <TextInput
          value={fontFamily()}
          onValueChange={handleFontFamilyChange}
          aria-label="Font family"
          placeholder="Font family"
          disabled={disabled()}
        />
        <Select
          options={FONT_WEIGHT_OPTIONS}
          value={String(fontWeight())}
          onValueChange={handleFontWeightChange}
          aria-label="Font weight"
          disabled={disabled()}
        />
      </div>

      {/* ── Font size + italic toggle ──────────────────────────────── */}
      <div class="sigil-typography-section__size-row">
        <NumberInput
          value={fontSize()}
          onValueChange={handleFontSizeChange}
          aria-label="Font size"
          step={1}
          min={1}
          max={1000}
          suffix="px"
          disabled={disabled()}
        />
        <ToggleButton
          pressed={fontStyle() === "italic"}
          onPressedChange={handleFontStyleToggle}
          aria-label="Italic"
          disabled={disabled()}
        >
          <Italic size={14} />
        </ToggleButton>
      </div>

      {/* ── Line height + letter spacing ───────────────────────────── */}
      <div class="sigil-typography-section__spacing-row">
        <NumberInput
          value={lineHeight()}
          onValueChange={handleLineHeightChange}
          aria-label="Line height"
          step={0.1}
          min={0.1}
          suffix="px"
          disabled={disabled()}
        />
        <NumberInput
          value={letterSpacing()}
          onValueChange={handleLetterSpacingChange}
          aria-label="Letter spacing"
          step={0.1}
          suffix="px"
          disabled={disabled()}
        />
      </div>

      {/* ── Text align (segmented control) ─────────────────────────── */}
      <div
        class="sigil-typography-section__align-group"
        role="radiogroup"
        aria-label="Text alignment"
      >
        {TEXT_ALIGN_OPTIONS.map((opt) => (
          <button
            class="sigil-typography-section__align-btn"
            classList={{
              "sigil-typography-section__align-btn--active": textAlign() === opt.value,
            }}
            type="button"
            role="radio"
            aria-checked={textAlign() === opt.value}
            aria-label={opt.label}
            disabled={disabled()}
            onClick={() => handleTextAlignChange(opt.value)}
          >
            <opt.icon size={14} />
          </button>
        ))}
      </div>

      {/* ── Text decoration toggles ────────────────────────────────── */}
      <div class="sigil-typography-section__decoration-row">
        <ToggleButton
          pressed={textDecoration() === "underline"}
          onPressedChange={() => handleTextDecorationToggle("underline")}
          aria-label="Underline"
          disabled={disabled()}
        >
          <Underline size={14} />
        </ToggleButton>
        <ToggleButton
          pressed={textDecoration() === "strikethrough"}
          onPressedChange={() => handleTextDecorationToggle("strikethrough")}
          aria-label="Strikethrough"
          disabled={disabled()}
        >
          <Strikethrough size={14} />
        </ToggleButton>
      </div>

      {/* ── Text color ─────────────────────────────────────────────── */}
      <div class="sigil-typography-section__color-row">
        <span class="sigil-typography-section__color-label">Color</span>
        <ColorSwatch
          color={textColor()}
          onColorChange={handleTextColorChange}
          aria-label="Text color"
        />
      </div>

      {/* Live region for discrete status announcements (RF-009) */}
      <span role="status" aria-live="polite" class="sr-only">
        {announcement()}
      </span>
    </div>
  );
};
