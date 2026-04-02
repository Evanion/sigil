import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { TextInput } from "./TextInput";

describe("TextInput", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render an input element", () => {
    render(() => <TextInput value="" onValueChange={() => {}} aria-label="Test input" />);
    const input = screen.getByRole("textbox");
    expect(input).toBeTruthy();
    expect(input.tagName.toLowerCase()).toBe("input");
  });

  it("should display the current value", () => {
    render(() => <TextInput value="hello" onValueChange={() => {}} aria-label="Test input" />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("hello");
  });

  it("should fire onValueChange on input", async () => {
    const handler = vi.fn();
    render(() => <TextInput value="" onValueChange={handler} aria-label="Test input" />);
    const input = screen.getByRole("textbox");
    fireEvent.input(input, { target: { value: "new value" } });
    expect(handler).toHaveBeenCalledWith("new value");
  });

  it("should apply the base sigil-text-input class on root", () => {
    render(() => <TextInput value="" onValueChange={() => {}} aria-label="Test input" />);
    const input = screen.getByRole("textbox");
    const root = input.closest(".sigil-text-input");
    expect(root).toBeTruthy();
  });

  it("should render a visible label when label prop is provided", () => {
    render(() => <TextInput value="" onValueChange={() => {}} label="Username" />);
    const label = screen.getByText("Username");
    expect(label).toBeTruthy();
    expect(label.classList.contains("sigil-text-input__label")).toBe(true);
  });

  it("should apply placeholder text to the input", () => {
    render(() => (
      <TextInput value="" onValueChange={() => {}} placeholder="Type here..." aria-label="Test" />
    ));
    const input = screen.getByPlaceholderText("Type here...");
    expect(input).toBeTruthy();
  });

  it("should set the disabled state when disabled prop is true", () => {
    render(() => <TextInput value="" onValueChange={() => {}} disabled aria-label="Test" />);
    const input = screen.getByRole("textbox");
    expect(input.hasAttribute("disabled")).toBe(true);
  });

  it("should append custom class names alongside component classes", () => {
    render(() => (
      <TextInput value="" onValueChange={() => {}} class="my-custom" aria-label="Test" />
    ));
    const input = screen.getByRole("textbox");
    const root = input.closest(".sigil-text-input");
    expect(root).toBeTruthy();
    expect(root?.classList.contains("my-custom")).toBe(true);
    expect(root?.classList.contains("sigil-text-input")).toBe(true);
  });

  it("should apply sigil-text-input__input class on the input element", () => {
    render(() => <TextInput value="" onValueChange={() => {}} aria-label="Test" />);
    const input = screen.getByRole("textbox");
    expect(input.classList.contains("sigil-text-input__input")).toBe(true);
  });

  it("should forward aria-label to the input element", () => {
    render(() => <TextInput value="" onValueChange={() => {}} aria-label="Node name" />);
    const input = screen.getByLabelText("Node name");
    expect(input).toBeTruthy();
  });
});
