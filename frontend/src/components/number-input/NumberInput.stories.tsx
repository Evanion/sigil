import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { NumberInput } from "./NumberInput";

const meta: Meta<typeof NumberInput> = {
  title: "Components/NumberInput",
  component: NumberInput,
  tags: ["autodocs"],
  argTypes: {
    value: { control: "number" },
    step: { control: "number" },
    min: { control: "number" },
    max: { control: "number" },
    suffix: { control: "text" },
    label: { control: "text" },
    disabled: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof NumberInput>;

export const Default: Story = {
  args: { value: 100, onValueChange: () => {} },
};

export const WithLabel: Story = {
  args: { value: 200, onValueChange: () => {}, label: "Width" },
};

export const WithSuffix: Story = {
  args: { value: 16, onValueChange: () => {}, suffix: "px" },
};

export const WithMinMax: Story = {
  args: {
    value: 50,
    onValueChange: () => {},
    min: 0,
    max: 100,
    suffix: "%",
    label: "Opacity",
  },
};

export const Disabled: Story = {
  args: { value: 42, onValueChange: () => {}, disabled: true, label: "Locked" },
};

export const Interactive: Story = {
  render: () => {
    const [val, setVal] = createSignal(0);
    return (
      <div style={{ display: "flex", gap: "8px", "align-items": "flex-end" }}>
        <NumberInput value={val()} onValueChange={setVal} label="X" suffix="px" step={1} />
        <NumberInput value={val()} onValueChange={setVal} label="Y" suffix="px" step={1} />
      </div>
    );
  },
};
