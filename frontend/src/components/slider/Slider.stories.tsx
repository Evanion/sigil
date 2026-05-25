import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { Slider } from "./Slider";

const meta: Meta<typeof Slider> = {
  title: "Components/Slider",
  component: Slider,
  tags: ["autodocs"],
  argTypes: {
    value: { control: "number" },
    min: { control: "number" },
    max: { control: "number" },
    step: { control: "number" },
    disabled: { control: "boolean" },
    ariaLabel: { control: "text" },
    ariaValueText: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof Slider>;

export const Default: Story = {
  args: {
    value: 50,
    onChange: () => {},
    min: 0,
    max: 100,
    step: 1,
    ariaLabel: "Demo slider",
  },
};

export const WithBounds: Story = {
  args: {
    value: 0.6,
    onChange: () => {},
    min: 0,
    max: 1,
    step: 0.01,
    ariaLabel: "Smoothing",
    ariaValueText: "60 percent",
  },
};

export const Disabled: Story = {
  args: {
    value: 50,
    onChange: () => {},
    min: 0,
    max: 100,
    disabled: true,
    ariaLabel: "Disabled slider",
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = createSignal(args.value);
    return (
      <Slider
        {...args}
        value={value()}
        onChange={(v) => {
          setValue(v);
          args.onChange?.(v);
        }}
      />
    );
  },
  args: {
    value: 25,
    onChange: () => {},
    min: 0,
    max: 100,
    step: 1,
    ariaLabel: "Interactive slider",
  },
};
