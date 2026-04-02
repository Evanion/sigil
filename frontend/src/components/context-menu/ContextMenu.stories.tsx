import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ContextMenu, type ContextMenuProps } from "./ContextMenu";

const meta: Meta<ContextMenuProps> = {
  title: "Components/ContextMenu",
  component: ContextMenu,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<ContextMenuProps>;

export const Default: Story = {
  args: {
    items: [
      { key: "rename", label: "Rename" },
      { key: "duplicate", label: "Duplicate" },
      { key: "delete", label: "Delete" },
    ],
    onSelect: (key: string) => console.log("Selected:", key),
    children: (
      <div
        style={{
          padding: "2rem",
          border: "1px dashed var(--border-2)",
          "border-radius": "var(--radius-2)",
          "text-align": "center",
          color: "var(--text-2)",
          "user-select": "none",
        }}
      >
        Right-click here
      </div>
    ),
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
    onSelect: (key: string) => console.log("Selected:", key),
    children: (
      <div
        style={{
          padding: "2rem",
          border: "1px dashed var(--border-2)",
          "border-radius": "var(--radius-2)",
          "text-align": "center",
          color: "var(--text-2)",
          "user-select": "none",
        }}
      >
        Right-click for shortcuts
      </div>
    ),
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
    onSelect: (key: string) => console.log("Selected:", key),
    children: (
      <div
        style={{
          padding: "2rem",
          border: "1px dashed var(--border-2)",
          "border-radius": "var(--radius-2)",
          "text-align": "center",
          color: "var(--text-2)",
          "user-select": "none",
        }}
      >
        Right-click (some items disabled)
      </div>
    ),
  },
};
