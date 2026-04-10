import { describe, it, expect, beforeEach } from "vitest";
import i18next, { type i18n } from "i18next";
import commonEn from "../locales/en/common.json";
import toolsEn from "../locales/en/tools.json";
import panelsEn from "../locales/en/panels.json";
import a11yEn from "../locales/en/a11y.json";

/**
 * Creates a fresh i18next instance with the same config as initI18n()
 * but without side effects (localStorage, navigator.language).
 */
async function createTestInstance(lng = "en"): Promise<i18n> {
  const instance = i18next.createInstance();
  await instance.init({
    lng,
    fallbackLng: "en",
    ns: ["common", "tools", "panels", "a11y"],
    defaultNS: "common",
    resources: {
      en: {
        common: commonEn,
        tools: toolsEn,
        panels: panelsEn,
        a11y: a11yEn,
      },
    },
    interpolation: {
      escapeValue: false,
    },
  });
  return instance;
}

describe("i18n initialization", () => {
  let instance: i18n;

  beforeEach(async () => {
    instance = await createTestInstance("en");
  });

  it("should initialize with English as the active language", () => {
    expect(instance.language).toBe("en");
  });

  it("should load the common namespace", () => {
    expect(instance.t("common:ok")).toBe("OK");
    expect(instance.t("common:cancel")).toBe("Cancel");
    expect(instance.t("common:undo")).toBe("Undo");
    expect(instance.t("common:redo")).toBe("Redo");
  });

  it("should load the tools namespace", () => {
    expect(instance.t("tools:select.label")).toBe("Select");
    expect(instance.t("tools:frame.label")).toBe("Frame");
    expect(instance.t("tools:toolbar.label")).toBe("Design tools");
  });

  it("should load the panels namespace", () => {
    expect(instance.t("panels:tabs.design")).toBe("Design");
    expect(instance.t("panels:tabs.layers")).toBe("Layers");
    expect(instance.t("panels:typography.title")).toBe("Typography");
    expect(instance.t("panels:fill.title")).toBe("Fill");
    expect(instance.t("panels:pages.title")).toBe("Pages");
  });

  it("should load the a11y namespace", () => {
    expect(instance.t("a11y:canvas.label")).toBe("Design canvas");
    expect(instance.t("a11y:layers.tree")).toBe("Layers tree");
    expect(instance.t("a11y:status.connected")).toBe("Connected to server");
  });

  it("should interpolate variables in translation strings", () => {
    expect(instance.t("a11y:page.created", { name: "Page 2" })).toBe("Created Page 2");
    expect(instance.t("a11y:canvas.selected", { name: "Rectangle 1" })).toBe(
      "Rectangle 1 selected",
    );
    expect(instance.t("a11y:canvas.multiSelected", { count: 5 })).toBe("5 objects selected");
  });

  it("should fall back to English when initialized with an unknown locale", async () => {
    const unknownInstance = await createTestInstance("xx-ZZ");
    expect(unknownInstance.t("common:ok")).toBe("OK");
    expect(unknownInstance.t("a11y:canvas.label")).toBe("Design canvas");
  });

  it("should use common as the default namespace", () => {
    // Without namespace prefix, should resolve from common
    expect(instance.t("ok")).toBe("OK");
    expect(instance.t("delete")).toBe("Delete");
  });

  it("should load all font weight names in panels namespace", () => {
    expect(instance.t("panels:fontWeight.400")).toBe("Regular");
    expect(instance.t("panels:fontWeight.700")).toBe("Bold");
    expect(instance.t("panels:fontWeight.900")).toBe("Black");
  });

  // RF-004: Verify locale-change reactivity
  it("should return updated strings after changing language back to English", async () => {
    // Change to a non-existent locale, then back to English to verify
    // the t() function tracks language changes.
    await instance.changeLanguage("xx");
    // With fallbackLng, keys still resolve to English
    expect(instance.t("common:ok")).toBe("OK");
    await instance.changeLanguage("en");
    expect(instance.t("common:ok")).toBe("OK");
    expect(instance.t("a11y:canvas.label")).toBe("Design canvas");
  });

  // RF-012: Multi-parameter interpolation tests
  it("should interpolate a11y:layers.over with name and position", () => {
    expect(instance.t("a11y:layers.over", { name: "Frame 1", position: "before" })).toBe(
      "Over Frame 1, before",
    );
  });

  it("should interpolate a11y:layers.movedInside with name and container", () => {
    expect(
      instance.t("a11y:layers.movedInside", { name: "Rectangle 1", container: "Frame 1" }),
    ).toBe("Rectangle 1 moved inside Frame 1");
  });

  it("should interpolate a11y:layers.movedTo with name and parent", () => {
    expect(instance.t("a11y:layers.movedTo", { name: "Ellipse 1", parent: "Group 1" })).toBe(
      "Ellipse 1 moved to Group 1",
    );
  });

  it("should interpolate a11y:page.movedToPosition with name and position", () => {
    expect(instance.t("a11y:page.movedToPosition", { name: "Page 1", position: "3" })).toBe(
      "Page 1 moved to position 3",
    );
  });

  it("should interpolate panels:pages.dragPage with name", () => {
    expect(instance.t("panels:pages.dragPage", { name: "Page 2" })).toBe("Drag Page 2");
  });

  it("should interpolate common:panelLabel with name", () => {
    expect(instance.t("common:panelLabel", { name: "Layers" })).toBe("Layers panel");
  });
});
