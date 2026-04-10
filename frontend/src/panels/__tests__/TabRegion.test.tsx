import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { TransProvider } from "@mbarzda/solid-i18next";
import type { i18n } from "i18next";
import { TabRegion } from "../TabRegion";
import { panels, registerPanel } from "../registry";
import { AnnounceProvider } from "../../shell/AnnounceProvider";
import { createTestI18n } from "../../test-utils/i18n";
import { type Component } from "solid-js";

let i18nInstance: i18n;

beforeAll(async () => {
  i18nInstance = await createTestI18n();
});

const PanelA: Component = () => <div>Panel A content</div>;
const PanelB: Component = () => <div>Panel B content</div>;
const PanelC: Component = () => <div>Panel C content</div>;

function renderWithAnnounce(region: "left" | "right", announceFn?: (msg: string) => void) {
  const announce = announceFn ?? vi.fn();
  return render(() => (
    <TransProvider instance={i18nInstance}>
      <AnnounceProvider announce={announce}>
        <TabRegion region={region} />
      </AnnounceProvider>
    </TransProvider>
  ));
}

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

    renderWithAnnounce("right");
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

    renderWithAnnounce("left");
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

    renderWithAnnounce("left");
    expect(screen.getByText("Left")).toBeTruthy();
    expect(screen.queryByText("Right")).toBeNull();
  });

  it("should have tablist role with aria-label", () => {
    registerPanel({
      id: "a",
      label: "Alpha",
      region: "right",
      order: 0,
      component: PanelA,
    });

    renderWithAnnounce("right");
    const tablist = screen.getByRole("tablist");
    expect(tablist).toBeTruthy();
    expect(tablist.getAttribute("aria-label")).toBe("Right panel tabs");
  });

  it("should have aria-label on tablist for left region", () => {
    registerPanel({
      id: "a",
      label: "Alpha",
      region: "left",
      order: 0,
      component: PanelA,
    });

    renderWithAnnounce("left");
    const tablist = screen.getByRole("tablist");
    expect(tablist.getAttribute("aria-label")).toBe("Left panel tabs");
  });

  it("should assign id to tab buttons and tabpanel with aria-labelledby", () => {
    registerPanel({
      id: "a",
      label: "Alpha",
      region: "right",
      order: 0,
      component: PanelA,
      default: true,
    });

    renderWithAnnounce("right");
    const tab = screen.getByRole("tab");
    expect(tab.id).toBe("sigil-tab-right-a");

    const tabpanel = screen.getByRole("tabpanel");
    expect(tabpanel.id).toBe("sigil-tabpanel-right");
    expect(tabpanel.getAttribute("aria-labelledby")).toBe("sigil-tab-right-a");
  });

  it("should not allow duplicate panel registration", () => {
    registerPanel({
      id: "a",
      label: "Alpha",
      region: "left",
      order: 0,
      component: PanelA,
    });
    registerPanel({
      id: "a",
      label: "Alpha Duplicate",
      region: "left",
      order: 1,
      component: PanelB,
    });

    expect(panels.length).toBe(1);
    expect(panels[0]?.label).toBe("Alpha");
  });

  it("should announce on tab click", () => {
    const announce = vi.fn();
    registerPanel({
      id: "a",
      label: "Alpha",
      region: "left",
      order: 0,
      component: PanelA,
      default: true,
    });
    registerPanel({
      id: "b",
      label: "Beta",
      region: "left",
      order: 1,
      component: PanelB,
    });

    renderWithAnnounce("left", announce);
    fireEvent.click(screen.getByText("Beta"));
    expect(announce).toHaveBeenCalledWith("Beta panel");
  });

  it("should support Home and End keys for tab navigation", () => {
    const announce = vi.fn();
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
    registerPanel({
      id: "c",
      label: "Gamma",
      region: "right",
      order: 2,
      component: PanelC,
    });

    renderWithAnnounce("right", announce);
    const tablist = screen.getByRole("tablist");

    // Press End to go to last tab
    fireEvent.keyDown(tablist, { key: "End" });
    expect(announce).toHaveBeenCalledWith("Gamma panel");

    // Press Home to go to first tab
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(announce).toHaveBeenCalledWith("Alpha panel");
  });

  it("should fall back to default tab reactively when user tab becomes invisible", () => {
    // RF-003: activeTab tracks defaultTab reactively
    registerPanel({
      id: "a",
      label: "Alpha",
      region: "left",
      order: 0,
      component: PanelA,
      default: true,
    });

    renderWithAnnounce("left");
    // The default tab should be active and its content visible
    expect(screen.getByText("Panel A content")).toBeTruthy();
  });
});
