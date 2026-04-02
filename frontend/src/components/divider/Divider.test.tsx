import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { Divider } from "./Divider";

describe("Divider", () => {
  afterEach(() => {
    cleanup();
  });

  it("should render with the separator role", () => {
    render(() => <Divider />);
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("should always include the base sigil-divider class", () => {
    render(() => <Divider />);
    const el = screen.getByRole("separator");
    expect(el.classList.contains("sigil-divider")).toBe(true);
  });

  it("should default to horizontal orientation", () => {
    render(() => <Divider />);
    const el = screen.getByRole("separator");
    expect(el.getAttribute("data-orientation")).toBe("horizontal");
  });

  it("should not apply the vertical class when horizontal", () => {
    render(() => <Divider />);
    const el = screen.getByRole("separator");
    expect(el.classList.contains("sigil-divider--vertical")).toBe(false);
  });

  it("should apply the vertical class when orientation is vertical", () => {
    render(() => <Divider orientation="vertical" />);
    const el = screen.getByRole("separator");
    expect(el.classList.contains("sigil-divider--vertical")).toBe(true);
  });

  it("should set aria-orientation to vertical when vertical", () => {
    render(() => <Divider orientation="vertical" />);
    const el = screen.getByRole("separator");
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
  });

  it("should append custom class names alongside component classes", () => {
    render(() => <Divider class="my-custom" />);
    const el = screen.getByRole("separator");
    expect(el.classList.contains("my-custom")).toBe(true);
    expect(el.classList.contains("sigil-divider")).toBe(true);
  });
});
