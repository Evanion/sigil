import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Popover } from "./Popover";
import { Button } from "../button/Button";

const meta: Meta<typeof Popover> = {
  title: "Components/Popover",
  component: Popover,
  tags: ["autodocs"],
  argTypes: {
    placement: {
      control: { type: "select" },
      options: ["top", "bottom", "left", "right"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Popover>;

export const Default: Story = {
  render: () => (
    <Popover trigger={<Button>Open Popover</Button>}>
      <p style={{ margin: "0", color: "var(--text-1)" }}>
        This is popover content. It can contain any elements.
      </p>
    </Popover>
  ),
};

export const Top: Story = {
  render: () => (
    <div style={{ "padding-top": "120px" }}>
      <Popover trigger={<Button>Top Popover</Button>} placement="top">
        <p style={{ margin: "0", color: "var(--text-1)" }}>Popover placed above the trigger.</p>
      </Popover>
    </div>
  ),
};

export const Left: Story = {
  render: () => (
    <div style={{ "padding-left": "240px" }}>
      <Popover trigger={<Button>Left Popover</Button>} placement="left">
        <p style={{ margin: "0", color: "var(--text-1)" }}>Popover placed to the left.</p>
      </Popover>
    </div>
  ),
};

export const Right: Story = {
  render: () => (
    <Popover trigger={<Button>Right Popover</Button>} placement="right">
      <p style={{ margin: "0", color: "var(--text-1)" }}>Popover placed to the right.</p>
    </Popover>
  ),
};

export const Modal: Story = {
  render: () => (
    <Popover trigger={<Button>Modal Popover</Button>} modal>
      <p style={{ margin: "0", color: "var(--text-1)" }}>
        This is a manual popover (no light dismiss). Press Escape or use close logic to dismiss.
      </p>
    </Popover>
  ),
};
