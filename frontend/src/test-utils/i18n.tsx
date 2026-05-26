/**
 * Shared i18n test utility — creates a pre-initialized i18next instance
 * for use in component tests that render inside a TransProvider, and
 * provides a `withI18n` JSX wrapper for tests that don't manage the
 * provider themselves.
 */
import i18next, { type i18n } from "i18next";
import { TransProvider } from "@mbarzda/solid-i18next";
import type { JSX } from "solid-js";
import { render } from "@solidjs/testing-library";
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
    // Mirrors production `initI18n` (RF-004): missing keys return null so
    // `t("missing:key") || fallback` works as written and tests can detect
    // missing-key bugs.
    returnNull: true,
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
    // Mirrors production `initI18n` (RF-004): missing keys return null so
    // `t("missing:key") || fallback` works as written and tests can detect
    // missing-key bugs.
    returnNull: true,
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

/**
 * Renders a JSX subtree wrapped in a TransProvider. Wraps
 * `@solidjs/testing-library`'s `render` so test files don't each
 * re-implement the `<TransProvider>` shim (RF-030).
 *
 * Pass an `instance` to use a per-test i18next instance (e.g. when the
 * test calls `createTestI18n()` in `beforeEach`); otherwise the shared
 * `getTestI18nInstance()` singleton is used.
 */
export function renderWithI18n(ui: () => JSX.Element, instance?: i18n) {
  const i18nInstance = instance ?? getTestI18nInstance();
  return render(() => (
    <TransProvider instance={i18nInstance}>{ui() as unknown as JSX.Element}</TransProvider>
  ));
}
