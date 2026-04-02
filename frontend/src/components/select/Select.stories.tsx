import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { Select, type SelectOption } from "./Select";

const alignOptions: readonly SelectOption[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
];

const blendOptions: readonly SelectOption[] = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
];

const meta: Meta<typeof Select> = {
  title: "Components/Select",
  component: Select,
  tags: ["autodocs"],
  argTypes: {
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  args: {
    options: alignOptions,
    value: "left",
    onValueChange: () => {},
    "aria-label": "Text align",
  },
};

export const WithLabel: Story = {
  args: {
    options: blendOptions,
    value: "normal",
    onValueChange: () => {},
    label: "Blend mode",
  },
};

export const WithPlaceholder: Story = {
  args: {
    options: alignOptions,
    value: "",
    onValueChange: () => {},
    placeholder: "Select alignment...",
    "aria-label": "Text align",
  },
};

export const Disabled: Story = {
  args: {
    options: alignOptions,
    value: "center",
    onValueChange: () => {},
    disabled: true,
    "aria-label": "Text align",
  },
};

export const Interactive: Story = {
  render: () => {
    const [value, setValue] = createSignal("normal");
    return (
      <div style={{ width: "200px" }}>
        <Select
          options={blendOptions}
          value={value()}
          onValueChange={setValue}
          label="Blend mode"
        />
        <p style={{ "margin-top": "8px", color: "var(--text-2)", "font-size": "12px" }}>
          Selected: {value()}
        </p>
      </div>
    );
  },
};
