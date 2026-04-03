import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { TabRegion } from "../TabRegion";
import { panels, registerPanel } from "../registry";
import { type Component } from "solid-js";

const PanelA: Component = () => <div>Panel A content</div>;
const PanelB: Component = () => <div>Panel B content</div>;

describe("TabRegion", () => {
  beforeEach(() => {
    // Clear the global registry between tests
    panels.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it("should render tabs for registered panels", () => {
    registerPanel({
      id: "a",
      label: "Alpha",
      region: "right",
      order: 0,
      component: PanelA,
      default: true,
    });
    registerPanel({
      id: "b",
      label: "Beta",
      region: "right",
      order: 1,
      component: PanelB,
    });

    render(() => <TabRegion region="right" />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("should render default panel content", () => {
    registerPanel({
      id: "a",
      label: "Alpha",
      region: "left",
      order: 0,
      component: PanelA,
      default: true,
    });

    render(() => <TabRegion region="left" />);
    expect(screen.getByText("Panel A content")).toBeTruthy();
  });

  it("should only show panels for the matching region", () => {
    registerPanel({
      id: "left-panel",
      label: "Left",
      region: "left",
      order: 0,
      component: PanelA,
    });
    registerPanel({
      id: "right-panel",
      label: "Right",
      region: "right",
      order: 0,
      component: PanelB,
    });

    render(() => <TabRegion region="left" />);
    expect(screen.getByText("Left")).toBeTruthy();
    expect(screen.queryByText("Right")).toBeNull();
  });

  it("should have tablist role", () => {
    registerPanel({
      id: "a",
      label: "Alpha",
      region: "right",
      order: 0,
      component: PanelA,
    });

    render(() => <TabRegion region="right" />);
    expect(screen.getByRole("tablist")).toBeTruthy();
  });
});
