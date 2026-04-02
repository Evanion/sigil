import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { Button } from "./Button";

describe("Button", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render children text content", () => {
    render(() => <Button>Click me</Button>);
    expect(screen.getByText("Click me")).toBeTruthy();
  });

  it("should apply the primary variant class", () => {
    render(() => <Button variant="primary">Primary</Button>);
    const btn = screen.getByText("Primary");
    expect(btn.classList.contains("sigil-button--primary")).toBe(true);
  });

  it("should apply the danger variant class", () => {
    render(() => <Button variant="danger">Danger</Button>);
    const btn = screen.getByText("Danger");
    expect(btn.classList.contains("sigil-button--danger")).toBe(true);
  });

  it("should apply the ghost variant class", () => {
    render(() => <Button variant="ghost">Ghost</Button>);
    const btn = screen.getByText("Ghost");
    expect(btn.classList.contains("sigil-button--ghost")).toBe(true);
  });

  it("should apply the sm size class", () => {
    render(() => <Button size="sm">Small</Button>);
    const btn = screen.getByText("Small");
    expect(btn.classList.contains("sigil-button--sm")).toBe(true);
  });

  it("should apply the lg size class", () => {
    render(() => <Button size="lg">Large</Button>);
    const btn = screen.getByText("Large");
    expect(btn.classList.contains("sigil-button--lg")).toBe(true);
  });

  it("should not add a size class for md (default)", () => {
    render(() => <Button>Medium default</Button>);
    const btn = screen.getByText("Medium default");
    expect(btn.classList.contains("sigil-button--md")).toBe(false);
  });

  it("should default to the secondary variant", () => {
    render(() => <Button>Secondary default</Button>);
    const btn = screen.getByText("Secondary default");
    expect(btn.classList.contains("sigil-button--secondary")).toBe(true);
  });

  it("should always include the base sigil-button class", () => {
    render(() => <Button>Base</Button>);
    const btn = screen.getByText("Base");
    expect(btn.classList.contains("sigil-button")).toBe(true);
  });

  it("should fire onClick handler when clicked", () => {
    const handler = vi.fn();
    render(() => <Button onClick={handler}>Click</Button>);
    screen.getByText("Click").click();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("should set the disabled attribute when disabled prop is true", () => {
    render(() => <Button disabled>Disabled</Button>);
    expect(screen.getByText("Disabled").hasAttribute("disabled")).toBe(true);
  });

  it("should render as a button element for keyboard accessibility", () => {
    render(() => <Button>Accessible</Button>);
    const btn = screen.getByText("Accessible");
    expect(btn.tagName.toLowerCase()).toBe("button");
  });

  it("should forward aria-label to the underlying element", () => {
    render(() => (
      <Button aria-label="Close dialog">X</Button>
    ));
    const btn = screen.getByLabelText("Close dialog");
    expect(btn).toBeTruthy();
  });

  it("should append custom class names alongside component classes", () => {
    render(() => <Button class="my-custom">Custom</Button>);
    const btn = screen.getByText("Custom");
    expect(btn.classList.contains("my-custom")).toBe(true);
    expect(btn.classList.contains("sigil-button")).toBe(true);
  });
});
