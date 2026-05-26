/**
 * @vitest-environment jsdom
 *
 * Per-locale smoke test: mount a single button labeled with a known
 * translatable key under each of en/fr/es and assert the rendered
 * text matches the locale file's value.
 *
 * Catches catastrophic locale-load failures (missing namespace, JSON
 * parse error, fallback-chain misconfiguration).
 */
import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { TransProvider, useTransContext } from "@mbarzda/solid-i18next";
import i18next from "i18next";
import commonEn from "../locales/en/common.json";
import commonFr from "../locales/fr/common.json";
import commonEs from "../locales/es/common.json";

interface LocaleCase {
  readonly lng: "en" | "fr" | "es";
  readonly resources: Record<string, Record<string, unknown>>;
  readonly expectedCancel: string;
}

const cases: readonly LocaleCase[] = [
  { lng: "en", resources: { en: { common: commonEn } }, expectedCancel: commonEn.cancel as string },
  { lng: "fr", resources: { fr: { common: commonFr } }, expectedCancel: commonFr.cancel as string },
  { lng: "es", resources: { es: { common: commonEs } }, expectedCancel: commonEs.cancel as string },
];

function TestButton() {
  const [t] = useTransContext();
  return <button>{t("common:cancel")}</button>;
}

describe("per-locale rendering smoke test (Spec 17)", () => {
  for (const c of cases) {
    it(`renders "${c.expectedCancel}" for locale ${c.lng}`, async () => {
      const instance = i18next.createInstance();
      await instance.init({
        lng: c.lng,
        fallbackLng: "en",
        ns: ["common"],
        defaultNS: "common",
        resources: c.resources,
        interpolation: { escapeValue: false },
      });

      const { container } = render(() => (
        <TransProvider instance={instance} lng={c.lng}>
          <TestButton />
        </TransProvider>
      ));

      const btn = container.querySelector("button");
      expect(btn?.textContent).toBe(c.expectedCancel);
    });
  }
});
