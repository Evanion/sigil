import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Tooltip } from "./Tooltip";

const meta: Meta<typeof Tooltip> = {
  title: "Components/Tooltip",
  component: Tooltip,
  tags: ["autodocs"],
  argTypes: {
    placement: {
      control: { type: "select" },
      options: ["top", "bottom", "left", "right"],
    },
    content: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Top: Story = {
  render: () => (
    <Tooltip content="Tooltip on top" placement="top">
      {(triggerProps) => <button {...triggerProps}>Hover me (top)</button>}
    </Tooltip>
  ),
};

export const Bottom: Story = {
  render: () => (
    <Tooltip content="Tooltip on bottom" placement="bottom">
      {(triggerProps) => <button {...triggerProps}>Hover me (bottom)</button>}
    </Tooltip>
  ),
};

export const Left: Story = {
  render: () => (
    <Tooltip content="Tooltip on the left" placement="left">
      {(triggerProps) => <button {...triggerProps}>Hover me (left)</button>}
    </Tooltip>
  ),
};

export const Right: Story = {
  render: () => (
    <Tooltip content="Tooltip on the right" placement="right">
      {(triggerProps) => <button {...triggerProps}>Hover me (right)</button>}
    </Tooltip>
  ),
};

export const WithIconButton: Story = {
  name: "With Icon Button",
  render: () => (
    <Tooltip content="Select tool (V)" placement="bottom">
      {(triggerProps) => (
        <button
          {...triggerProps}
          aria-label="Select tool"
          style={{
            width: "32px",
            height: "32px",
            display: "inline-flex",
            "align-items": "center",
            "justify-content": "center",
            border: "1px solid var(--border-1)",
            "border-radius": "var(--button-radius)",
            background: "var(--surface-3)",
            color: "var(--text-1)",
            cursor: "pointer",
          }}
        >
          V
        </button>
      )}
    </Tooltip>
  ),
};

export const LongContent: Story = {
  name: "Long Content",
  render: () => (
    <Tooltip
      content="This is a longer tooltip message that describes a feature or provides extended help text to the user about this particular action."
      placement="top"
    >
      {(triggerProps) => <button {...triggerProps}>Hover for details</button>}
    </Tooltip>
  ),
};
