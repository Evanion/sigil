import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { default as ValueInput } from "./ValueInput";
import type { Token } from "../../types/document";

// ── Mock data ─────────────────────────────────────────────────────────

const MOCK_TOKENS: Record<string, Token> = {
  "brand.primary": {
    id: "tok-brand-primary",
    name: "brand.primary",
    token_type: "color",
    value: {
      type: "color",
      value: { space: "srgb", r: 0, g: 0.4, b: 1, a: 1 },
    },
    description: null,
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
  "spacing.xs": {
    id: "tok-spacing-xs",
    name: "spacing.xs",
    token_type: "dimension",
    value: { type: "dimension", value: 4, unit: "px" },
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
  "font.primary": {
    id: "tok-font-primary",
    name: "font.primary",
    token_type: "font_family",
    value: { type: "font_family", families: ["Inter", "sans-serif"] },
    description: null,
  },
};

const EMPTY_TOKENS: Record<string, Token> = {};

// ── Meta ──────────────────────────────────────────────────────────────

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

// ── Stories ───────────────────────────────────────────────────────────

export const Default: Story = {
  args: {
    value: "",
    onChange: () => {},
    tokens: EMPTY_TOKENS,
    placeholder: "Type { for tokens, or an expression",
    "aria-label": "Default token input",
  },
};

export const WithTokenRef: Story = {
  args: {
    value: "{brand.primary}",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    "aria-label": "Token reference input",
  },
};

export const WithExpression: Story = {
  args: {
    value: "{spacing.md} * 2",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    "aria-label": "Expression input",
  },
};

export const WithFunction: Story = {
  args: {
    value: "lighten({brand.primary}, 20%)",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    "aria-label": "Function expression input",
  },
};

export const WithError: Story = {
  args: {
    value: "{",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    "aria-label": "Error state input",
  },
};

export const Disabled: Story = {
  args: {
    value: "{spacing.md} * 2",
    onChange: () => {},
    tokens: MOCK_TOKENS,
    disabled: true,
    "aria-label": "Disabled token input",
  },
};

export const WithTokens: Story = {
  render: () => {
    const [value, setValue] = createSignal("");
    return (
      <div style={{ display: "flex", "flex-direction": "column", gap: "8px", width: "300px" }}>
        <ValueInput
          value={value()}
          onChange={setValue}
          tokens={MOCK_TOKENS}
          aria-label="Token input with autocomplete"
          placeholder="Type { to see token suggestions"
        />
        <span style={{ color: "var(--text-2)", "font-size": "12px" }}>
          Current value: {value()}
        </span>
      </div>
    );
  },
};
