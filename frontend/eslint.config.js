import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import i18next from "eslint-plugin-i18next";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Allow underscore-prefixed identifiers to signal intentional unused
      // values. This is the standard TypeScript convention and matches how
      // Rust handles `_` bindings in crates/core. Applies to function
      // parameters, caught error names, destructured properties, and
      // siblings after a used rest element.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // i18n rule — flipped from "warn" to "error" in Task 11 of Plan 17 after
  // the Tasks 4-7 migration eliminated every prior warning. Combined with
  // the i18n-allowlist-rationale CI step, no new hardcoded user-facing
  // strings can land without either a rationale comment or proper i18n key.
  {
    plugins: { i18next },
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/**/__tests__/**",
      "src/**/*.test.{ts,tsx}",
      "src/**/*.stories.{ts,tsx}",
      "src/test-utils/**",
    ],
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-text-only",
          "jsx-attributes": {
            include: [
              "aria-label",
              "aria-description",
              "aria-placeholder",
              "aria-roledescription",
              "aria-valuetext",
              "placeholder",
              "title",
              "alt",
            ],
          },
          callees: {
            include: ["setAnnouncement", "toast", "showToast"],
          },
          words: {
            exclude: [
              "^[a-z-]+$",
              "^https?://",
              "^#[0-9a-fA-F]{3,8}$",
              "^[0-9.]+(px|rem|em|%)$",
            ],
          },
        },
      ],
    },
  },
  {
    ignores: ["dist/"],
  },
);
