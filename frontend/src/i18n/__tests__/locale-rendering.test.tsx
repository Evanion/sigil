/**
 * @vitest-environment jsdom
 *
 * Per-locale smoke test: mount components labeled with known
 * translatable keys under each of en/fr/es and assert the rendered
 * text matches the locale file's value.
 *
 * Catches catastrophic locale-load failures (missing namespace, JSON
 * parse error, fallback-chain misconfiguration) AND verifies that the
 * three migrated namespaces (common, panels, a11y) all resolve
 * correctly under each locale — not just `common:cancel` (RF-028).
 */
import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { TransProvider, useTransContext } from "@mbarzda/solid-i18next";
import i18next, { type Resource } from "i18next";
import commonEn from "../locales/en/common.json";
import commonFr from "../locales/fr/common.json";
import commonEs from "../locales/es/common.json";
import panelsEn from "../locales/en/panels.json";
import panelsFr from "../locales/fr/panels.json";
import panelsEs from "../locales/es/panels.json";
import a11yEn from "../locales/en/a11y.json";
import a11yFr from "../locales/fr/a11y.json";
import a11yEs from "../locales/es/a11y.json";

interface LocaleCase {
  readonly lng: "en" | "fr" | "es";
  readonly resources: Resource;
  readonly expectedCancel: string;
  readonly expectedFillAdd: string;
  readonly expectedFillItem: string;
}

const cases: readonly LocaleCase[] = [
  {
    lng: "en",
    resources: { en: { common: commonEn, panels: panelsEn, a11y: a11yEn } },
    expectedCancel: commonEn.cancel,
    expectedFillAdd: panelsEn.fill.add,
    expectedFillItem: a11yEn.fills.itemLabel.replace("{{index}}", "1"),
  },
  {
    lng: "fr",
    resources: { fr: { common: commonFr, panels: panelsFr, a11y: a11yFr } },
    expectedCancel: commonFr.cancel,
    expectedFillAdd: panelsFr.fill.add,
    expectedFillItem: a11yFr.fills.itemLabel.replace("{{index}}", "1"),
  },
  {
    lng: "es",
    resources: { es: { common: commonEs, panels: panelsEs, a11y: a11yEs } },
    expectedCancel: commonEs.cancel,
    expectedFillAdd: panelsEs.fill.add,
    expectedFillItem: a11yEs.fills.itemLabel.replace("{{index}}", "1"),
  },
];

function TestCancelButton() {
  const [t] = useTransContext();
  return <button data-testid="cancel">{t("common:cancel")}</button>;
}

function TestFillAddButton() {
  const [t] = useTransContext();
  return <button data-testid="fill-add">{t("panels:fill.add")}</button>;
}

function TestFillItemButton() {
  const [t] = useTransContext();
  return <button data-testid="fill-item">{t("a11y:fills.itemLabel", { index: 1 })}</button>;
}

describe("per-locale rendering smoke test (Spec 17, RF-028)", () => {
  for (const c of cases) {
    it(`renders common:cancel = "${c.expectedCancel}" under locale ${c.lng}`, async () => {
      const instance = i18next.createInstance();
      await instance.init({
        lng: c.lng,
        fallbackLng: "en",
        ns: ["common", "panels", "a11y"],
        defaultNS: "common",
        resources: c.resources,
        interpolation: { escapeValue: false },
      });

      const { container } = render(() => (
        <TransProvider instance={instance} lng={c.lng}>
          <TestCancelButton />
        </TransProvider>
      ));

      const btn = container.querySelector("[data-testid='cancel']");
      expect(btn?.textContent).toBe(c.expectedCancel);
    });

    it(`renders panels:fill.add = "${c.expectedFillAdd}" under locale ${c.lng}`, async () => {
      const instance = i18next.createInstance();
      await instance.init({
        lng: c.lng,
        fallbackLng: "en",
        ns: ["common", "panels", "a11y"],
        defaultNS: "common",
        resources: c.resources,
        interpolation: { escapeValue: false },
      });

      const { container } = render(() => (
        <TransProvider instance={instance} lng={c.lng}>
          <TestFillAddButton />
        </TransProvider>
      ));

      const btn = container.querySelector("[data-testid='fill-add']");
      expect(btn?.textContent).toBe(c.expectedFillAdd);
    });

    it(`renders a11y:fills.itemLabel = "${c.expectedFillItem}" with interpolation under locale ${c.lng}`, async () => {
      const instance = i18next.createInstance();
      await instance.init({
        lng: c.lng,
        fallbackLng: "en",
        ns: ["common", "panels", "a11y"],
        defaultNS: "common",
        resources: c.resources,
        interpolation: { escapeValue: false },
      });

      const { container } = render(() => (
        <TransProvider instance={instance} lng={c.lng}>
          <TestFillItemButton />
        </TransProvider>
      ));

      const btn = container.querySelector("[data-testid='fill-item']");
      expect(btn?.textContent).toBe(c.expectedFillItem);
    });
  }
});
