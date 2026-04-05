import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { FieldRenderer } from "./FieldRenderer";

const meta: Meta<typeof FieldRenderer> = {
  title: "Panels/FieldRenderer",
  component: FieldRenderer,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: "200px", padding: "12px", background: "var(--surface-2, #252525)" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof FieldRenderer>;

export const NumberField: Story = {
  args: {
    field: { key: "transform.x", label: "X", type: "number", step: 1 },
    value: 120,
    onChange: () => {},
  },
};

export const NumberWithSuffix: Story = {
  args: {
    field: {
      key: "transform.rotation",
      label: "Rotation",
      type: "number",
      step: 0.1,
      suffix: "deg",
    },
    value: 45,
    onChange: () => {},
  },
};

export const NumberWithRange: Story = {
  args: {
    field: { key: "transform.width", label: "Width", type: "number", step: 1, min: 0 },
    value: 200,
    onChange: () => {},
  },
};

export const SliderField: Story = {
  args: {
    field: { key: "style.opacity", label: "Opacity", type: "slider", min: 0, max: 100, step: 1 },
    value: 80,
    onChange: () => {},
  },
};

export const TextField: Story = {
  args: {
    field: { key: "name", label: "Name", type: "text", span: 2 },
    value: "Header Frame",
    onChange: () => {},
  },
};

export const SelectField: Story = {
  args: {
    field: {
      key: "constraints.horizontal",
      label: "Horizontal",
      type: "select",
      options: [
        { value: "start", label: "Start" },
        { value: "center", label: "Center" },
        { value: "end", label: "End" },
        { value: "stretch", label: "Stretch" },
      ],
    },
    value: "start",
    onChange: () => {},
  },
};

export const ToggleField: Story = {
  args: {
    field: { key: "visible", label: "Visible", type: "toggle" },
    value: true,
    onChange: () => {},
  },
};

export const ToggleOff: Story = {
  args: {
    field: { key: "locked", label: "Locked", type: "toggle" },
    value: false,
    onChange: () => {},
  },
};
