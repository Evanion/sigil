import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { IconButton } from "./IconButton";
import { Square } from "lucide-solid";

afterEach(() => {
  cleanup();
});

describe("IconButton", () => {
  it("should render the icon as an SVG inside the button", () => {
    render(() => <IconButton icon={Square} aria-label="Draw rectangle" />);
    const button = screen.getByRole("button", { name: "Draw rectangle" });
    const svg = button.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("should be accessible via its aria-label", () => {
    render(() => <IconButton icon={Square} aria-label="Select tool" />);
    const button = screen.getByRole("button", { name: "Select tool" });
    expect(button).toBeTruthy();
  });

  it("should apply the base sigil-icon-button class", () => {
    render(() => <IconButton icon={Square} aria-label="Base class test" />);
    const button = screen.getByRole("button", { name: "Base class test" });
    expect(button.classList.contains("sigil-icon-button")).toBe(true);
  });

  it("should apply the active class when active prop is true", () => {
    render(() => <IconButton icon={Square} aria-label="Active tool" active />);
    const button = screen.getByRole("button", { name: "Active tool" });
    expect(button.classList.contains("sigil-icon-button--active")).toBe(true);
  });

  it("should not apply the active class when active prop is omitted", () => {
    render(() => <IconButton icon={Square} aria-label="Inactive tool" />);
    const button = screen.getByRole("button", { name: "Inactive tool" });
    expect(button.classList.contains("sigil-icon-button--active")).toBe(false);
  });

  it("should fire onClick when clicked", () => {
    const handler = vi.fn();
    render(() => <IconButton icon={Square} aria-label="Click test" onClick={handler} />);
    screen.getByRole("button", { name: "Click test" }).click();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("should be disabled when disabled prop is set", () => {
    render(() => <IconButton icon={Square} aria-label="Disabled tool" disabled />);
    const button = screen.getByRole("button", { name: "Disabled tool" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("should render as a button element for keyboard accessibility", () => {
    render(() => <IconButton icon={Square} aria-label="Keyboard test" />);
    const button = screen.getByRole("button", { name: "Keyboard test" });
    expect(button.tagName.toLowerCase()).toBe("button");
  });

  it("should pass icon size of 18 to the icon component", () => {
    const mockIcon = vi.fn((props: { size?: number }) => {
      return <svg data-testid="mock-icon" width={props.size} height={props.size}></svg>;
    });
    render(() => <IconButton icon={mockIcon} aria-label="Size test" />);
    expect(mockIcon).toHaveBeenCalledWith(expect.objectContaining({ size: 18 }));
  });

  it("should append additional class names from the class prop", () => {
    render(() => <IconButton icon={Square} aria-label="Custom class test" class="toolbar-item" />);
    const button = screen.getByRole("button", { name: "Custom class test" });
    expect(button.classList.contains("toolbar-item")).toBe(true);
    expect(button.classList.contains("sigil-icon-button")).toBe(true);
  });
});
