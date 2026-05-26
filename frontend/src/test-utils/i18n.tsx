/**
 * Shared i18n test utility — creates a pre-initialized i18next instance
 * for use in component tests that render inside a TransProvider, and
 * provides a `withI18n` JSX wrapper for tests that don't manage the
 * provider themselves.
 */
import i18next, { type i18n } from "i18next";
import { TransProvider } from "@mbarzda/solid-i18next";
import type { JSX } from "solid-js";
import commonEn from "../i18n/locales/en/common.json";
import toolsEn from "../i18n/locales/en/tools.json";
import panelsEn from "../i18n/locales/en/panels.json";
import a11yEn from "../i18n/locales/en/a11y.json";

/**
 * Shared synchronously-initialized i18next instance used by `withI18n`
 * and other test-utility helpers. Initialised lazily on first access.
 */
let sharedInstance: i18n | null = null;

function ensureInstance(): i18n {
  if (sharedInstance) return sharedInstance;
  const instance = i18next.createInstance();
  // i18next supports a synchronous init (returns the instance) when no
  // backend plugin is attached — all resources are inline here.
  instance.init({
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
  sharedInstance = instance;
  return instance;
}

/**
 * Returns the shared test i18next instance. Initialised on first call.
 *
 * Use this directly when you need to inspect/mutate the instance in a
 * test (e.g. switching languages); otherwise prefer `withI18n()` to
 * just wrap a render call in a TransProvider.
 */
export function getTestI18nInstance(): i18n {
  return ensureInstance();
}

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

/**
 * Wraps a JSX subtree (returned by a thunk) in a TransProvider with
 * the shared test i18next instance:
 *
 *   render(() => withI18n(() => <MyComp />))
 *
 * `children` is a function so that the wrapped JSX is evaluated INSIDE
 * the TransProvider's children-getter, where `useTransContext()` resolves
 * correctly. Passing JSX directly (e.g. `withI18n(<MyComp/>)`) would
 * evaluate the JSX before TransProvider mounts and child components'
 * `useTransContext()` calls would return `undefined`.
 */
export function withI18n(children: () => JSX.Element): JSX.Element {
  // Solid accepts function-as-child for lazy evaluation; the TypeScript JSX
  // types declare children as JSX.Element only — cast through unknown to
  // preserve the lazy semantics required for TransProvider's context to be
  // set up before the children evaluate.
  return (
    <TransProvider instance={getTestI18nInstance()}>
      {children as unknown as JSX.Element}
    </TransProvider>
  );
}
