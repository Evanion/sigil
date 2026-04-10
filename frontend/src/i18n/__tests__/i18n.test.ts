import { describe, it, expect, beforeEach } from "vitest";
import i18next, { type i18n } from "i18next";
import commonEn from "../locales/en/common.json";
import toolsEn from "../locales/en/tools.json";
import panelsEn from "../locales/en/panels.json";
import a11yEn from "../locales/en/a11y.json";
import commonEs from "../locales/es/common.json";
import toolsEs from "../locales/es/tools.json";
import panelsEs from "../locales/es/panels.json";
import a11yEs from "../locales/es/a11y.json";
import commonFr from "../locales/fr/common.json";
import toolsFr from "../locales/fr/tools.json";
import panelsFr from "../locales/fr/panels.json";
import a11yFr from "../locales/fr/a11y.json";

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
      es: {
        common: commonEs,
        tools: toolsEs,
        panels: panelsEs,
        a11y: a11yEs,
      },
      fr: {
        common: commonFr,
        tools: toolsFr,
        panels: panelsFr,
        a11y: a11yFr,
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

describe("i18n Spanish locale", () => {
  let instance: i18n;

  beforeEach(async () => {
    instance = await createTestInstance("es");
  });

  it("should initialize with Spanish as the active language", () => {
    expect(instance.language).toBe("es");
  });

  it("should load the common namespace in Spanish", () => {
    expect(instance.t("common:ok")).toBe("Aceptar");
    expect(instance.t("common:cancel")).toBe("Cancelar");
    expect(instance.t("common:undo")).toBe("Deshacer");
    expect(instance.t("common:redo")).toBe("Rehacer");
    expect(instance.t("common:save")).toBe("Guardar");
  });

  it("should load the tools namespace in Spanish", () => {
    expect(instance.t("tools:toolbar.label")).toBe("Herramientas de diseño");
    expect(instance.t("tools:select.label")).toBe("Seleccionar");
    expect(instance.t("tools:frame.label")).toBe("Marco");
    expect(instance.t("tools:rectangle.label")).toBe("Rectángulo");
    expect(instance.t("tools:pen.label")).toBe("Pluma");
  });

  it("should keep keyboard shortcuts unchanged in Spanish", () => {
    expect(instance.t("tools:select.shortcut")).toBe("V");
    expect(instance.t("tools:frame.shortcut")).toBe("F");
    expect(instance.t("tools:rectangle.shortcut")).toBe("R");
  });

  it("should load the panels namespace in Spanish", () => {
    expect(instance.t("panels:tabs.design")).toBe("Diseño");
    expect(instance.t("panels:tabs.layers")).toBe("Capas");
    expect(instance.t("panels:fill.title")).toBe("Relleno");
    expect(instance.t("panels:stroke.title")).toBe("Trazo");
    expect(instance.t("panels:typography.blendMode")).toBe("Modo de fusión");
  });

  it("should load the a11y namespace in Spanish", () => {
    expect(instance.t("a11y:canvas.label")).toBe("Lienzo de diseño");
    expect(instance.t("a11y:layers.tree")).toBe("Árbol de capas");
    expect(instance.t("a11y:status.connected")).toBe("Conectado al servidor");
  });

  it("should interpolate variables in Spanish translation strings", () => {
    expect(instance.t("a11y:page.created", { name: "Página 2" })).toBe("Página 2 creada");
    expect(instance.t("a11y:canvas.selected", { name: "Rectángulo 1" })).toBe(
      "Rectángulo 1 seleccionado",
    );
    expect(instance.t("a11y:canvas.multiSelected", { count: 5 })).toBe("5 objetos seleccionados");
  });

  it("should interpolate multi-parameter strings in Spanish", () => {
    expect(
      instance.t("a11y:layers.movedInside", { name: "Rectángulo 1", container: "Marco 1" }),
    ).toBe("Rectángulo 1 movido dentro de Marco 1");
    expect(instance.t("a11y:layers.over", { name: "Marco 1", position: "antes" })).toBe(
      "Sobre Marco 1, antes",
    );
  });
});

describe("i18n French locale", () => {
  let instance: i18n;

  beforeEach(async () => {
    instance = await createTestInstance("fr");
  });

  it("should initialize with French as the active language", () => {
    expect(instance.language).toBe("fr");
  });

  it("should load the common namespace in French", () => {
    expect(instance.t("common:ok")).toBe("OK");
    expect(instance.t("common:cancel")).toBe("Annuler");
    expect(instance.t("common:save")).toBe("Enregistrer");
    expect(instance.t("common:redo")).toBe("Rétablir");
    expect(instance.t("common:delete")).toBe("Supprimer");
  });

  it("should load the tools namespace in French", () => {
    expect(instance.t("tools:toolbar.label")).toBe("Outils de conception");
    expect(instance.t("tools:select.label")).toBe("Sélection");
    expect(instance.t("tools:frame.label")).toBe("Cadre");
    expect(instance.t("tools:pen.label")).toBe("Plume");
    expect(instance.t("tools:hand.label")).toBe("Main");
  });

  it("should keep keyboard shortcuts unchanged in French", () => {
    expect(instance.t("tools:select.shortcut")).toBe("V");
    expect(instance.t("tools:frame.shortcut")).toBe("F");
    expect(instance.t("tools:text.shortcut")).toBe("T");
  });

  it("should load the panels namespace in French", () => {
    expect(instance.t("panels:tabs.layers")).toBe("Calques");
    expect(instance.t("panels:fill.title")).toBe("Remplissage");
    expect(instance.t("panels:stroke.title")).toBe("Contour");
    expect(instance.t("panels:typography.blendMode")).toBe("Mode de fusion");
    expect(instance.t("panels:typography.title")).toBe("Typographie");
  });

  it("should load the a11y namespace in French", () => {
    expect(instance.t("a11y:canvas.label")).toBe("Canevas de conception");
    expect(instance.t("a11y:layers.tree")).toBe("Arborescence des calques");
    expect(instance.t("a11y:status.connected")).toBe("Connecté au serveur");
  });

  it("should interpolate variables in French translation strings", () => {
    expect(instance.t("a11y:page.created", { name: "Page 2" })).toBe("Page 2 créée");
    expect(instance.t("a11y:canvas.selected", { name: "Rectangle 1" })).toBe(
      "Rectangle 1 sélectionné",
    );
    expect(instance.t("a11y:canvas.multiSelected", { count: 5 })).toBe("5 objets sélectionnés");
  });

  it("should interpolate multi-parameter strings in French", () => {
    expect(
      instance.t("a11y:layers.movedInside", { name: "Rectangle 1", container: "Cadre 1" }),
    ).toBe("Rectangle 1 déplacé dans Cadre 1");
    expect(instance.t("a11y:layers.over", { name: "Cadre 1", position: "avant" })).toBe(
      "Au-dessus de Cadre 1, avant",
    );
  });
});
