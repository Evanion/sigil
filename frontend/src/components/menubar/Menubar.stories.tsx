import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { fn } from "storybook/test";
import { Menubar, type MenubarProps } from "./Menubar";

const meta: Meta<typeof Menubar> = {
  title: "Components/Menubar",
  component: Menubar,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Menubar>;

const defaultMenus: MenubarProps["menus"] = [
  {
    label: "File",
    items: [
      { key: "new", label: "New" },
      { key: "open", label: "Open" },
      { key: "save", label: "Save" },
      { key: "export", label: "Export" },
    ],
  },
  {
    label: "Edit",
    items: [
      { key: "undo", label: "Undo" },
      { key: "redo", label: "Redo" },
      { key: "cut", label: "Cut" },
      { key: "copy", label: "Copy" },
      { key: "paste", label: "Paste" },
    ],
  },
  {
    label: "View",
    items: [
      { key: "zoom-in", label: "Zoom In" },
      { key: "zoom-out", label: "Zoom Out" },
      { key: "fit-to-screen", label: "Fit to Screen" },
    ],
  },
];

const shortcutMenus: MenubarProps["menus"] = [
  {
    label: "File",
    items: [
      { key: "new", label: "New", shortcut: "Ctrl+N" },
      { key: "open", label: "Open", shortcut: "Ctrl+O" },
      { key: "save", label: "Save", shortcut: "Ctrl+S" },
      { key: "export", label: "Export", shortcut: "Ctrl+Shift+E" },
    ],
  },
  {
    label: "Edit",
    items: [
      { key: "undo", label: "Undo", shortcut: "Ctrl+Z" },
      { key: "redo", label: "Redo", shortcut: "Ctrl+Shift+Z" },
      { key: "cut", label: "Cut", shortcut: "Ctrl+X" },
      { key: "copy", label: "Copy", shortcut: "Ctrl+C" },
      { key: "paste", label: "Paste", shortcut: "Ctrl+V" },
    ],
  },
  {
    label: "View",
    items: [
      { key: "zoom-in", label: "Zoom In", shortcut: "Ctrl+=" },
      { key: "zoom-out", label: "Zoom Out", shortcut: "Ctrl+-" },
      { key: "fit-to-screen", label: "Fit to Screen", shortcut: "Ctrl+1" },
    ],
  },
  {
    label: "Insert",
    items: [
      { key: "frame", label: "Frame", shortcut: "F" },
      { key: "rectangle", label: "Rectangle", shortcut: "R" },
      { key: "text", label: "Text", shortcut: "T" },
      { key: "pen", label: "Pen", shortcut: "P" },
    ],
  },
];

export const Default: Story = {
  args: {
    menus: defaultMenus,
    onSelect: fn(),
  },
};

export const WithShortcuts: Story = {
  args: {
    menus: shortcutMenus,
    onSelect: fn(),
  },
};
