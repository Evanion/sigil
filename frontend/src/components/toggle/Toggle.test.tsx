import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render an element with switch role", () => {
    render(() => (
      <Toggle checked={false} onCheckedChange={() => {}} aria-label="Test" />
    ));
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("should always include the base sigil-toggle class", () => {
    render(() => (
      <Toggle checked={false} onCheckedChange={() => {}} aria-label="Test" />
    ));
    const root = screen.getByRole("switch").closest(".sigil-toggle");
    expect(root).toBeTruthy();
  });

  it("should reflect checked state as aria-checked on the switch", () => {
    render(() => (
      <Toggle checked={true} onCheckedChange={() => {}} aria-label="Test" />
    ));
    const switchEl = screen.getByRole("switch");
    expect(switchEl.getAttribute("aria-checked")).toBe("true");
  });

  it("should reflect unchecked state as aria-checked on the switch", () => {
    render(() => (
      <Toggle checked={false} onCheckedChange={() => {}} aria-label="Test" />
    ));
    const switchEl = screen.getByRole("switch");
    expect(switchEl.getAttribute("aria-checked")).toBe("false");
  });

  it("should fire onCheckedChange when clicked", async () => {
    const handler = vi.fn();
    render(() => (
      <Toggle checked={false} onCheckedChange={handler} aria-label="Test" />
    ));
    await fireEvent.click(screen.getByRole("switch"));
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(true);
  });

  it("should render a visible label when label prop is provided", () => {
    render(() => (
      <Toggle
        checked={false}
        onCheckedChange={() => {}}
        label="Dark mode"
      />
    ));
    expect(screen.getByText("Dark mode")).toBeTruthy();
    const labelEl = screen.getByText("Dark mode");
    expect(labelEl.classList.contains("sigil-toggle__label")).toBe(true);
  });

  it("should set data-disabled attribute when disabled", () => {
    render(() => (
      <Toggle
        checked={false}
        onCheckedChange={() => {}}
        disabled={true}
        aria-label="Test"
      />
    ));
    const root = screen.getByRole("switch").closest(".sigil-toggle");
    expect(root).toBeTruthy();
    expect(root?.hasAttribute("data-disabled")).toBe(true);
  });

  it("should not fire onCheckedChange when disabled and clicked", async () => {
    const handler = vi.fn();
    render(() => (
      <Toggle
        checked={false}
        onCheckedChange={handler}
        disabled={true}
        aria-label="Test"
      />
    ));
    await fireEvent.click(screen.getByRole("switch"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("should append custom class names alongside component classes", () => {
    render(() => (
      <Toggle
        checked={false}
        onCheckedChange={() => {}}
        class="my-custom"
        aria-label="Test"
      />
    ));
    const root = screen.getByRole("switch").closest(".sigil-toggle");
    expect(root).toBeTruthy();
    expect(root?.classList.contains("my-custom")).toBe(true);
    expect(root?.classList.contains("sigil-toggle")).toBe(true);
  });

  it("should forward aria-label to the switch element", () => {
    render(() => (
      <Toggle
        checked={false}
        onCheckedChange={() => {}}
        aria-label="Toggle visibility"
      />
    ));
    expect(screen.getByLabelText("Toggle visibility")).toBeTruthy();
  });
});
