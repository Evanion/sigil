/**
 * Shared i18n test utility — creates a pre-initialized i18next instance
 * for use in component tests that render inside a TransProvider.
 */
import i18next, { type i18n } from "i18next";
import commonEn from "../i18n/locales/en/common.json";
import toolsEn from "../i18n/locales/en/tools.json";
import panelsEn from "../i18n/locales/en/panels.json";
import a11yEn from "../i18n/locales/en/a11y.json";

/**
 * Creates a fresh, fully-initialized i18next instance for tests.
 * Must be awaited before passing to TransProvider.
 */
export async function createTestI18n(): Promise<i18n> {
  const instance = i18next.createInstance();
  await instance.init({
    lng: "en",
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
