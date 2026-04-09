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
      Hover me (top)
    </Tooltip>
  ),
};

export const Bottom: Story = {
  render: () => (
    <Tooltip content="Tooltip on bottom" placement="bottom">
      Hover me (bottom)
    </Tooltip>
  ),
};

export const Left: Story = {
  render: () => (
    <Tooltip content="Tooltip on the left" placement="left">
      Hover me (left)
    </Tooltip>
  ),
};

export const Right: Story = {
  render: () => (
    <Tooltip content="Tooltip on the right" placement="right">
      Hover me (right)
    </Tooltip>
  ),
};

export const WithIconButton: Story = {
  name: "With Icon Button",
  render: () => (
    <Tooltip
      content="Select tool (V)"
      placement="bottom"
      aria-label="Select tool"
      triggerClass="icon-btn-story"
    >
      V
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
      Hover for details
    </Tooltip>
  ),
};
