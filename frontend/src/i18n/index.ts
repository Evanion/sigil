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
    // RF-004: surface missing translation keys at runtime. With i18next's
    // default behavior, `t("missing:key")` returns the key string itself
    // (truthy), which silently masks missing-key bugs — `t(k) || fallback`
    // never reaches the fallback branch. Setting `returnNull: true` returns
    // `null` for a missing key so callers' `|| fallback` works as written
    // and tests/dev tooling can detect missing keys.
    returnNull: true,
    interpolation: {
      // Solid.js handles escaping in JSX text and JSX attribute slots —
      // avoid double-escaping.
      //
      // RF-031 invariant: do NOT pipe `t()` results into HTML-sink
      // consumers (innerHTML, raw HTML insertion APIs). `escapeValue: false`
      // means translation values are inserted verbatim — safe in JSX text
      // and attribute slots (Solid escapes those), but unsafe if rendered
      // as raw HTML. Today no such usage exists in `frontend/src`; this
      // comment exists so any future regression is flagged at review time.
      escapeValue: false,
    },
  });

  persistLocale(i18nInstance.language);

  // Persist locale whenever it changes at runtime.
  //
  // RF-023: this subscription lives for the lifetime of the singleton
  // `i18nInstance`. In production this is intentional — the instance is
  // never disposed before the page unloads, and the singleton's lifetime
  // matches the document's. The matching `.off()` is exposed via
  // `teardownI18n()` below for tests + HMR that need to dispose the
  // instance and recreate it (otherwise the subscription accumulates a
  // closure over each prior persistLocale binding).
  i18nInstance.on("languageChanged", persistLocale);

  return i18nInstance;
}

/**
 * Removes the `languageChanged` listener installed by `initI18n`. Safe to
 * call even when `initI18n` has not run (i18next's `.off()` is a no-op for
 * unregistered listeners).
 *
 * No production code calls this today — `i18nInstance` is treated as a
 * singleton whose lifetime matches the document. The function exists to
 * support tests and future hot-module-replacement (HMR) flows that
 * re-import this module and would otherwise leak a stale closure over
 * each prior `persistLocale` binding.
 */
export function teardownI18n(): void {
  i18nInstance.off("languageChanged", persistLocale);
}

export { i18nInstance };
