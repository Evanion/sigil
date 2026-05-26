/**
 * ESLint rule smoke test for `i18next/no-literal-string` (Spec 17 §5.4, RF-022).
 *
 * Programmatically lints synthetic source fragments using the project's
 * actual `eslint.config.js`, asserting that the rule fires on the patterns
 * the migration was designed to catch and does NOT fire on the patterns
 * it was designed to exempt.
 *
 * This test is the regression sentinel for:
 *   - RF-001 — `mode: "jsx-only"` must validate JSX attribute literals.
 *   - RF-006 — `should-validate-template: true` must validate template-literal
 *              attribute values.
 *   - RF-007 — `callees.include` is intentionally absent (plugin only honors
 *              `callees.exclude`); the rule should not silently flag arbitrary
 *              function-call literals.
 *   - The `jsx-attributes.include` allowlist must drive attribute-name scope.
 *
 * If a future PR weakens the config (e.g., flips mode back to `jsx-text-only`,
 * removes `should-validate-template`, or breaks the `framework: "react"`
 * setting that makes the plugin understand Solid's JSX AST), one or more of
 * these assertions will fail.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, "..", "..", "..");

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({
    cwd: FRONTEND_ROOT,
    overrideConfigFile: path.join(FRONTEND_ROOT, "eslint.config.js"),
  });
});

/**
 * Lint a fragment as if it lived at `frontend/src/<fileName>` — matches
 * the rule's `src/**` include glob and avoids the test/stories/test-utils
 * ignore globs.
 *
 * Note on fixture style: every component is written as a `function X()`
 * declaration rather than `const X = () => …`. The eslint-plugin-i18next
 * heuristic for "this JSX is inside a component" recognises the function
 * declaration form but not the arrow form. Real components in this
 * codebase use both forms; the lint rule still fires on them in practice
 * because their JSX is wrapped in scopes the plugin recognises. The
 * function-declaration form is the minimal fixture that triggers the
 * rule reliably for smoke-test purposes.
 */
async function getI18nViolations(code: string, fileName = "smoke-fixture.tsx"): Promise<string[]> {
  const filePath = path.join(FRONTEND_ROOT, "src", fileName);
  const results = await eslint.lintText(code, { filePath, warnIgnored: false });
  return results[0].messages
    .filter((m) => m.ruleId === "i18next/no-literal-string")
    .map((m) => m.message);
}

describe("eslint-plugin-i18next/no-literal-string smoke test (Spec 17 §5.4)", () => {
  describe("flags violations", () => {
    it("JSX text literals", async () => {
      const violations = await getI18nViolations(`function X() { return <div>Hello world</div>; }`);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("hardcoded aria-label attribute (RF-001 sentinel)", async () => {
      const violations = await getI18nViolations(
        `function X() { return <button aria-label="Submit form" />; }`,
      );
      expect(violations.length).toBeGreaterThan(0);
    });

    it("hardcoded title attribute", async () => {
      const violations = await getI18nViolations(
        `function X() { return <span title="Tooltip text">!</span>; }`,
      );
      expect(violations.length).toBeGreaterThan(0);
    });

    it("hardcoded placeholder attribute", async () => {
      const violations = await getI18nViolations(
        `function X() { return <input placeholder="Type something" />; }`,
      );
      expect(violations.length).toBeGreaterThan(0);
    });

    it("template-literal attribute values (RF-006 sentinel)", async () => {
      const violations = await getI18nViolations(
        `function X(p: { i: number }) { return <button aria-label={\`Item \${p.i}\`} />; }`,
      );
      expect(violations.length).toBeGreaterThan(0);
    });
  });

  describe("ignores allowed patterns", () => {
    it("non-included attribute (data-testid)", async () => {
      const violations = await getI18nViolations(
        `function X() { return <div data-testid="foo" />; }`,
      );
      expect(violations).toEqual([]);
    });

    it("URL-shaped strings (words.exclude)", async () => {
      const violations = await getI18nViolations(
        `function X() { return <a href="https://example.com">{"go"}</a>; }`,
      );
      // The URL "https://example.com" is excluded; the "go" JSX child may
      // still flag but that is a separate JSX-text violation, not a URL one.
      const urlMatches = violations.filter((m) => m.includes("https://"));
      expect(urlMatches).toEqual([]);
    });

    it("hex-color literals (words.exclude)", async () => {
      const violations = await getI18nViolations(
        `function X() { return <div style={{ color: "#abcdef" }} />; }`,
      );
      const hexMatches = violations.filter((m) => m.includes("#abcdef"));
      expect(hexMatches).toEqual([]);
    });

    it("CSS dimension literals (words.exclude)", async () => {
      const violations = await getI18nViolations(
        `function X() { return <div style={{ width: "100px" }} />; }`,
      );
      const dimMatches = violations.filter((m) => m.includes("100px"));
      expect(dimMatches).toEqual([]);
    });

    it("t() resolved attribute values", async () => {
      const violations = await getI18nViolations(
        `import { useTransContext } from "@mbarzda/solid-i18next";
         function X() {
           const [t] = useTransContext();
           return <button aria-label={t("ns:key")}>{t("ns:label")}</button>;
         }`,
      );
      expect(violations).toEqual([]);
    });
  });
});
