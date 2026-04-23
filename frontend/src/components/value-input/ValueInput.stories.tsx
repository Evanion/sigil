/**
 * ValueInput.stories.tsx — Storybook stories for the ValueInput component.
 *
 * Covers all usage modes introduced in Spec 13c:
 *   - Color: literal hex, single token reference, expression, empty
 *   - Number/Dimension: literal, token reference, expression, with unit
 *   - Font family: literal, with fallbacks
 *   - States: disabled, interactive (live signal demo)
 *
 * FontTokenRef is documented below as intentionally omitted — ValueInput
 * with acceptedTypes=["font_family"] only accepts font tokens, and
 * font_family tokens use `families: string[]` not a numeric/color value,
 * so a token reference is structurally valid but the autocomplete will
 * surface it. The story is included to confirm this behavior.
 */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { default as ValueInput } from "./ValueInput";
import type { Token } from "../../types/document";
import { SystemFontProvider } from "./font-provider";

// ── Mock data ──────────────────────────────────────────────────────────

const MOCK_TOKENS: Record<string, Token> = {
  "brand.primary": {
    id: "tok-brand-primary",
    name: "brand.primary",
    token_type: "color",
    value: {
      type: "color",
      value: { space: "srgb", r: 0, g: 0.4, b: 1, a: 1 },
    },
    description: "Primary brand blue",
  },
  "brand.secondary": {
    id: "tok-brand-secondary",
    name: "brand.secondary",
    token_type: "color",
    value: {
      type: "color",
      value: { space: "srgb", r: 0.8, g: 0, b: 0.4, a: 1 },
    },
    description: "Secondary brand pink",
  },
  "brand.error": {
    id: "tok-brand-error",
    name: "brand.error",
    token_type: "color",
    value: {
      type: "color",
      value: { space: "srgb", r: 1, g: 0.27, b: 0.27, a: 1 },
    },
    description: null,
  },
  "spacing.sm": {
    id: "tok-spacing-sm",
    name: "spacing.sm",
    token_type: "dimension",
    value: { type: "dimension", value: 8, unit: "px" },
    description: null,
  },
  "spacing.md": {
    id: "tok-spacing-md",
    name: "spacing.md",
    token_type: "dimension",
    value: { type: "dimension", value: 16, unit: "px" },
    description: null,
  },
  "spacing.lg": {
    id: "tok-spacing-lg",
    name: "spacing.lg",
    token_type: "dimension",
    value: { type: "dimension", value: 24, unit: "px" },
    description: null,
  },
  "font.family.primary": {
    id: "tok-font-primary",
    name: "font.family.primary",
    token_type: "font_family",
    value: { type: "font_family", families: ["Inter", "sans-serif"] },
    description: "Primary typeface",
  },
};

const EMPTY_TOKENS: Record<string, Token> = {};

/** Shared font provider instance for all font-related stories. */
const fontProvider = new SystemFontProvider();

// ── Wrapper style for consistent story sizing ──────────────────────────

const inputWrapperStyle = {
  display: "flex",
  "flex-direction": "column" as const,
  gap: "8px",
  width: "300px",
  padding: "16px",
  background: "var(--surface-2, #1e1e2e)",
};

// ── Meta ───────────────────────────────────────────────────────────────

const meta: Meta<typeof ValueInput> = {
  title: "Components/ValueInput",
  component: ValueInput,
  tags: ["autodocs"],
  argTypes: {
    value: { control: "text" },
    placeholder: { control: "text" },
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof ValueInput>;

// ── Color mode stories ─────────────────────────────────────────────────

/**
 * Color literal — hex value #0066FF.
 * The color swatch prefix shows the resolved blue color.
 * Click the swatch to open the inline color picker.
 */
export const ColorLiteral: Story = {
  args: {
    value: "#0066FF",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    acceptedTypes: ["color"],
    "aria-label": "Color literal input",
  },
};

/**
 * Color token reference — {brand.primary} resolves to blue (0, 0.4, 1).
 * The swatch shows the resolved token color.
 */
export const ColorTokenRef: Story = {
  args: {
    value: "{brand.primary}",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    acceptedTypes: ["color"],
    "aria-label": "Color token reference input",
  },
};

/**
 * Color expression — darken({brand.primary}, 20%).
 * The swatch cannot resolve the expression (complex eval required) and shows
 * a transparent/unset fallback.
 */
export const ColorExpression: Story = {
  args: {
    value: "darken({brand.primary}, 20%)",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    acceptedTypes: ["color"],
    "aria-label": "Color expression input",
  },
};

/**
 * Color field — empty value.
 * The swatch shows the transparent/unset state (checkerboard pattern).
 */
export const ColorEmpty: Story = {
  args: {
    value: "",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    acceptedTypes: ["color"],
    placeholder: "Enter hex or {token}",
    "aria-label": "Empty color input",
  },
};

// ── Number / Dimension mode stories ───────────────────────────────────

/**
 * Number literal — bare integer 16.
 * No swatch prefix; field accepts number type only.
 */
export const NumberLiteral: Story = {
  args: {
    value: "16",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    acceptedTypes: ["number"],
    "aria-label": "Number literal input",
  },
};

/**
 * Number token reference — {spacing.md} resolves to 16.
 * Autocomplete suggests dimension tokens when typing {.
 */
export const NumberTokenRef: Story = {
  args: {
    value: "{spacing.md}",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    acceptedTypes: ["number", "dimension"],
    "aria-label": "Number token reference input",
  },
};

/**
 * Number expression — {spacing.md} * 2.
 * The expression evaluator will resolve this to 32 at eval time.
 */
export const NumberExpression: Story = {
  args: {
    value: "{spacing.md} * 2",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    acceptedTypes: ["number", "dimension"],
    "aria-label": "Number expression input",
  },
};

/**
 * Dimension with unit — 1.5rem.
 * Demonstrates a CSS dimension value with a non-px unit.
 */
export const DimensionWithUnit: Story = {
  args: {
    value: "1.5rem",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    acceptedTypes: ["dimension"],
    "aria-label": "Dimension with unit input",
  },
};

// ── Font family mode stories ───────────────────────────────────────────

/**
 * Font family — Inter, sans-serif.
 * Typing in this field shows font name autocomplete from SystemFontProvider.
 */
export const FontFamily: Story = {
  args: {
    value: "Inter, sans-serif",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    acceptedTypes: ["font_family"],
    fontProvider,
    "aria-label": "Font family input",
  },
};

/**
 * Font family with multiple fallbacks — "Helvetica Neue", Arial, sans-serif.
 * Tests rendering of a quoted font name followed by unquoted fallbacks.
 */
export const FontFamilyWithFallbacks: Story = {
  args: {
    value: '"Helvetica Neue", Arial, sans-serif',
    onChange: () => {},
    tokens: MOCK_TOKENS,
    acceptedTypes: ["font_family"],
    fontProvider,
    "aria-label": "Font family with fallbacks input",
  },
};

/**
 * Font token reference — {font.family.primary}.
 * The token resolves to Inter/sans-serif. Font token references are
 * structurally valid — the component accepts them and surfaces the token
 * in the autocomplete when typing {. No swatch is shown for font fields.
 */
export const FontTokenRef: Story = {
  args: {
    value: "{font.family.primary}",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    acceptedTypes: ["font_family"],
    fontProvider,
    "aria-label": "Font token reference input",
  },
};

// ── State stories ──────────────────────────────────────────────────────

/**
 * Disabled state — input is not editable; shows the current value read-only.
 */
export const Disabled: Story = {
  args: {
    value: "{spacing.md} * 2",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    disabled: true,
    "aria-label": "Disabled token input",
  },
};

/**
 * Error state — malformed token reference (unclosed brace).
 * The input highlights the error segment in red.
 */
export const ParseError: Story = {
  args: {
    value: "{brand.primary",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    acceptedTypes: ["color"],
    "aria-label": "Error state input",
  },
};

// ── Interactive stories ────────────────────────────────────────────────

/**
 * Interactive color input — live signal-backed demo.
 * Type a hex value or {token} to see the swatch update in real time.
 * The displayed value updates as you type.
 */
export const InteractiveColor: Story = {
  render: () => {
    const [value, setValue] = createSignal("#0066FF");

    return (
      <div style={inputWrapperStyle}>
        <ValueInput
          value={value()}
          onChange={setValue}
          tokens={MOCK_TOKENS}
          acceptedTypes={["color"]}
          aria-label="Interactive color input"
          placeholder="Enter hex or {token}"
        />
        <span style={{ color: "var(--text-2, #9399b2)", "font-size": "12px" }}>
          Current value: {value()}
        </span>
      </div>
    );
  },
};

/**
 * Interactive font input — live signal-backed demo.
 * Start typing a font name to see the font autocomplete dropdown.
 * Type { to see font token suggestions.
 */
export const InteractiveFont: Story = {
  render: () => {
    const [value, setValue] = createSignal("Inter, sans-serif");

    return (
      <div style={inputWrapperStyle}>
        <ValueInput
          value={value()}
          onChange={setValue}
          tokens={MOCK_TOKENS}
          acceptedTypes={["font_family"]}
          fontProvider={fontProvider}
          aria-label="Interactive font family input"
          placeholder="Font name or {token}"
        />
        <span style={{ color: "var(--text-2, #9399b2)", "font-size": "12px" }}>
          Current value: {value()}
        </span>
      </div>
    );
  },
};

/**
 * Interactive multi-field demo — showcases all modes side by side.
 * Each field is independently live with its own signal. Demonstrates:
 *   - Color swatch prefix (hex field)
 *   - Number field (no swatch)
 *   - Font family with autocomplete
 *   - Token reference with autocomplete
 */
export const Interactive: Story = {
  render: () => {
    const [colorValue, setColorValue] = createSignal("#0066FF");
    const [numberValue, setNumberValue] = createSignal("16");
    const [fontValue, setFontValue] = createSignal("Inter, sans-serif");
    const [tokenValue, setTokenValue] = createSignal("{spacing.md}");

    const labelStyle = {
      color: "var(--text-2, #9399b2)",
      "font-size": "11px",
      "text-transform": "uppercase" as const,
      "letter-spacing": "0.05em",
      "margin-bottom": "2px",
    };

    return (
      <div style={{ ...inputWrapperStyle, width: "320px", gap: "16px" }}>
        <div>
          <div style={labelStyle}>Color</div>
          <ValueInput
            value={colorValue()}
            onChange={setColorValue}
            tokens={MOCK_TOKENS}
            acceptedTypes={["color"]}
            aria-label="Color field"
            placeholder="#RRGGBB or {token}"
          />
        </div>

        <div>
          <div style={labelStyle}>Number / Dimension</div>
          <ValueInput
            value={numberValue()}
            onChange={setNumberValue}
            tokens={MOCK_TOKENS}
            acceptedTypes={["number", "dimension"]}
            aria-label="Number field"
            placeholder="16 or {token}"
          />
        </div>

        <div>
          <div style={labelStyle}>Font Family</div>
          <ValueInput
            value={fontValue()}
            onChange={setFontValue}
            tokens={MOCK_TOKENS}
            acceptedTypes={["font_family"]}
            fontProvider={fontProvider}
            aria-label="Font family field"
            placeholder="Inter, sans-serif"
          />
        </div>

        <div>
          <div style={labelStyle}>Token Reference</div>
          <ValueInput
            value={tokenValue()}
            onChange={setTokenValue}
            tokens={MOCK_TOKENS}
            acceptedTypes={["number", "dimension"]}
            aria-label="Token reference field"
            placeholder="{token.name}"
          />
        </div>
      </div>
    );
  },
};

// ── Legacy / backward-compat stories ──────────────────────────────────

/**
 * Default (no acceptedTypes) — falls back to unfiltered token autocomplete.
 * Preserved from the original EnhancedTokenInput stories for regression coverage.
 */
export const Default: Story = {
  args: {
    value: "",
    onChange: () => {},
    tokens: EMPTY_TOKENS,
    placeholder: "Type { for tokens, or an expression",
    "aria-label": "Default token input",
  },
};

/**
 * Generic expression — preserved from original EnhancedTokenInput stories.
 * No acceptedTypes restriction; expression is type-agnostic.
 */
export const WithExpression: Story = {
  args: {
    value: "{spacing.md} * 2",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    "aria-label": "Expression input",
  },
};

/**
 * Function call expression — lighten(). Syntax highlighting colors
 * the function name differently from token references.
 */
export const WithFunction: Story = {
  args: {
    value: "lighten({brand.primary}, 20%)",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    "aria-label": "Function expression input",
  },
};
