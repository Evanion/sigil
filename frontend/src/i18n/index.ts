import i18next, { type i18n } from "i18next";
import commonEn from "./locales/en/common.json";
import toolsEn from "./locales/en/tools.json";
import panelsEn from "./locales/en/panels.json";
import a11yEn from "./locales/en/a11y.json";
import commonEs from "./locales/es/common.json";
import toolsEs from "./locales/es/tools.json";
import panelsEs from "./locales/es/panels.json";
import a11yEs from "./locales/es/a11y.json";
import commonFr from "./locales/fr/common.json";
import toolsFr from "./locales/fr/tools.json";
import panelsFr from "./locales/fr/panels.json";
import a11yFr from "./locales/fr/a11y.json";

const LOCALE_STORAGE_KEY = "sigil-locale";

/**
 * Returns the persisted locale from localStorage, falling back to the
 * browser's preferred language, and finally to "en".
 */
function getInitialLocale(): string {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // localStorage may be unavailable (e.g. in tests or private browsing).
  }
  return typeof navigator !== "undefined" ? (navigator.language ?? "en") : "en";
}

/**
 * Persists the current locale to localStorage so it survives page reloads.
 */
function persistLocale(lng: string): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, lng);
  } catch {
    // Silently ignore — localStorage may be unavailable.
  }
}

/** The shared i18next instance used throughout the app. */
const i18nInstance: i18n = i18next.createInstance();

/**
 * Initialize i18next with English locale resources and namespace support.
 * Must be called (and awaited) before the first render.
 */
export async function initI18n(): Promise<i18n> {
  // RF-014: Guard against double initialization — i18next throws if
  // init() is called twice on the same instance.
  if (i18nInstance.isInitialized) return i18nInstance;

  const lng = getInitialLocale();

  await i18nInstance.init({
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
    // RF-011: Normalize BCP-47 subtags (e.g. "en-US" → "en") so that
    // a locale like "pt-BR" falls back to "pt" resources instead of
    // missing entirely.
    load: "languageOnly",
    interpolation: {
      // Solid.js handles escaping — avoid double-escaping.
      escapeValue: false,
    },
  });

  persistLocale(i18nInstance.language);

  // Persist locale whenever it changes at runtime.
  i18nInstance.on("languageChanged", persistLocale);

  return i18nInstance;
}

export { i18nInstance };
