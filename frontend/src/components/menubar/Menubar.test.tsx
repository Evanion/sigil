import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { Menubar, type MenubarMenu } from "./Menubar";

const sampleMenus: readonly MenubarMenu[] = [
  {
    label: "File",
    items: [
      { key: "new", label: "New" },
      { key: "open", label: "Open" },
    ],
  },
  {
    label: "Edit",
    items: [
      { key: "undo", label: "Undo" },
      { key: "redo", label: "Redo" },
    ],
  },
  {
    label: "View",
    items: [{ key: "zoom-in", label: "Zoom In", shortcut: "Ctrl+=" }],
  },
];

describe("Menubar", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render an element with menubar role", () => {
    const handler = vi.fn();
    render(() => <Menubar menus={sampleMenus} onSelect={handler} />);
    const menubar = screen.getByRole("menubar");
    expect(menubar).toBeTruthy();
  });

  it("should render trigger labels for each menu", () => {
    const handler = vi.fn();
    render(() => <Menubar menus={sampleMenus} onSelect={handler} />);
    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.getByText("View")).toBeTruthy();
  });

  it("should apply the base sigil-menubar class to the root element", () => {
    const handler = vi.fn();
    render(() => <Menubar menus={sampleMenus} onSelect={handler} />);
    const menubar = screen.getByRole("menubar");
    expect(menubar.classList.contains("sigil-menubar")).toBe(true);
  });

  it("should append a custom class to the root element", () => {
    const handler = vi.fn();
    render(() => (
      <Menubar menus={sampleMenus} onSelect={handler} class="my-custom" />
    ));
    const menubar = screen.getByRole("menubar");
    expect(menubar.classList.contains("my-custom")).toBe(true);
    expect(menubar.classList.contains("sigil-menubar")).toBe(true);
  });

  it("should apply sigil-menubar__trigger class to each trigger button", () => {
    const handler = vi.fn();
    render(() => <Menubar menus={sampleMenus} onSelect={handler} />);
    const fileButton = screen.getByText("File");
    expect(fileButton.classList.contains("sigil-menubar__trigger")).toBe(true);
  });

  it("should accept the menus prop with items including shortcuts", () => {
    const handler = vi.fn();
    render(() => <Menubar menus={sampleMenus} onSelect={handler} />);
    // Verify all triggers render — items with shortcuts are accepted without error
    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.getByText("View")).toBeTruthy();
  });
});
