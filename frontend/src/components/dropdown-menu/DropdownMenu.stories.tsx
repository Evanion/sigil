import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { fn } from "storybook/test";
import { DropdownMenu, type DropdownMenuProps } from "./DropdownMenu";
import { Button } from "../button/Button";

const meta: Meta<DropdownMenuProps> = {
  title: "Components/DropdownMenu",
  component: DropdownMenu,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<DropdownMenuProps>;

export const Default: Story = {
  args: {
    items: [
      { key: "rename", label: "Rename Page" },
      { key: "duplicate", label: "Duplicate Page" },
      { key: "delete", label: "Delete Page" },
    ],
    onSelect: fn(),
    trigger: <Button variant="secondary">Page Actions</Button>,
  },
};

export const WithShortcuts: Story = {
  args: {
    items: [
      { key: "rename", label: "Rename", shortcut: "F2" },
      { key: "duplicate", label: "Duplicate", shortcut: "Ctrl+D" },
      { key: "delete", label: "Delete", shortcut: "Del" },
      { key: "copy", label: "Copy", shortcut: "Ctrl+C" },
      { key: "paste", label: "Paste", shortcut: "Ctrl+V" },
    ],
    onSelect: fn(),
    trigger: <Button variant="secondary">Edit</Button>,
  },
};

export const WithDisabledItems: Story = {
  args: {
    items: [
      { key: "rename", label: "Rename" },
      { key: "duplicate", label: "Duplicate" },
      { key: "paste", label: "Paste", disabled: true },
      { key: "delete", label: "Delete", disabled: true },
    ],
    onSelect: fn(),
    trigger: <Button variant="ghost">More Options</Button>,
  },
};
