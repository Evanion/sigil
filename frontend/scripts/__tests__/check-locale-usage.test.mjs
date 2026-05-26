import { describe, it, expect } from "vitest";
import { analyseUsage, extractTCalls, resolveKeyPath } from "../check-locale-usage.mjs";

describe("extractTCalls", () => {
  it("extracts t() calls with double-quoted args", () => {
    const text = `const x = t("panels:title");`;
    expect(extractTCalls(text)).toEqual([{ namespace: "panels", key: "title" }]);
  });

  it("extracts t() calls with single-quoted args", () => {
    const text = `const x = t('a11y:fills.itemLabel');`;
    expect(extractTCalls(text)).toEqual([{ namespace: "a11y", key: "fills.itemLabel" }]);
  });

  it("extracts t() calls from object member access (e.g., i18n.t)", () => {
    const text = `i18n.t("common:cancel"); other.t('tools:select');`;
    expect(extractTCalls(text)).toEqual([
      { namespace: "common", key: "cancel" },
      { namespace: "tools", key: "select" },
    ]);
  });

  it("does not match a bare string with a colon", () => {
    const text = `const url = "panels:title";`;
    expect(extractTCalls(text)).toEqual([]);
  });

  it("ignores t() calls without ns:key format", () => {
    const text = `t("hello world"); t("noNamespace");`;
    expect(extractTCalls(text)).toEqual([]);
  });

  it("ignores t() calls inside line comments", () => {
    const text = `
      // The default i18next behavior is t("missing:key") returns the key.
      const x = t("panels:title");
    `;
    expect(extractTCalls(text)).toEqual([{ namespace: "panels", key: "title" }]);
  });

  it("ignores t() calls inside block comments", () => {
    const text = `
      /* Example: t("missing:key") returns "missing:key" by default. */
      const x = t("common:cancel");
    `;
    expect(extractTCalls(text)).toEqual([{ namespace: "common", key: "cancel" }]);
  });

  it("extracts multiple t() calls from the same file", () => {
    const text = `
      const a = t("panels:fills.title");
      const b = t('common:cancel');
    `;
    const result = extractTCalls(text);
    expect(result).toContainEqual({ namespace: "panels", key: "fills.title" });
    expect(result).toContainEqual({ namespace: "common", key: "cancel" });
    expect(result).toHaveLength(2);
  });
});

describe("resolveKeyPath", () => {
  it("resolves a top-level key to its leaf value", () => {
    expect(resolveKeyPath({ greeting: "Hi" }, "greeting")).toBe("Hi");
  });

  it("resolves a dotted key path through nested objects", () => {
    expect(resolveKeyPath({ a: { b: { c: "deep" } } }, "a.b.c")).toBe("deep");
  });

  it("returns undefined for a non-existent key", () => {
    expect(resolveKeyPath({ a: "x" }, "missing")).toBeUndefined();
  });

  it("returns undefined for a partially-resolved path", () => {
    expect(resolveKeyPath({ a: { b: "x" } }, "a.b.c")).toBeUndefined();
  });

  it("returns undefined when the path lands on an object (not a leaf)", () => {
    expect(resolveKeyPath({ a: { b: "x" } }, "a")).toBeUndefined();
  });

  it("permits null leaf values", () => {
    expect(resolveKeyPath({ a: null }, "a")).toBeNull();
  });
});

describe("analyseUsage", () => {
  it("reports no failures when every t() call resolves", () => {
    const sourceFiles = [
      {
        path: "/fake/app.tsx",
        text: `t("panels:title"); t('common:cancel');`,
      },
    ];
    const namespaceTrees = {
      panels: { title: "Panels" },
      common: { cancel: "Cancel" },
    };
    const result = analyseUsage({ sourceFiles, namespaceTrees });
    expect(result.missing).toEqual([]);
    expect(result.unknownNamespace).toEqual([]);
    expect(result.orphans).toEqual([]);
  });

  it("reports a missing-key reference", () => {
    const sourceFiles = [{ path: "/fake/app.tsx", text: `t("panels:tokens.invalidValue");` }];
    const namespaceTrees = {
      panels: { tokens: { otherKey: "other" } },
    };
    const result = analyseUsage({ sourceFiles, namespaceTrees });
    expect(result.missing).toEqual([
      {
        file: "/fake/app.tsx",
        namespace: "panels",
        key: "tokens.invalidValue",
      },
    ]);
  });

  it("reports an unknown namespace", () => {
    const sourceFiles = [{ path: "/fake/app.tsx", text: `t("notreal:key");` }];
    const namespaceTrees = {
      panels: { title: "Panels" },
    };
    const result = analyseUsage({ sourceFiles, namespaceTrees });
    expect(result.unknownNamespace).toEqual([
      { file: "/fake/app.tsx", namespace: "notreal", key: "key" },
    ]);
    expect(result.missing).toEqual([]);
  });

  it("reports orphan keys (in locale but not referenced)", () => {
    const sourceFiles = [{ path: "/fake/app.tsx", text: `t("panels:title");` }];
    const namespaceTrees = {
      panels: { title: "Panels", neverUsed: "Orphan" },
    };
    const result = analyseUsage({ sourceFiles, namespaceTrees });
    expect(result.orphans).toEqual([{ namespace: "panels", key: "neverUsed" }]);
    expect(result.missing).toEqual([]);
  });

  it("does not flag nested keys whose dotted path matches a reference", () => {
    const sourceFiles = [{ path: "/fake/app.tsx", text: `t("panels:fills.itemLabel");` }];
    const namespaceTrees = {
      panels: { fills: { itemLabel: "Fill {{index}}" } },
    };
    const result = analyseUsage({ sourceFiles, namespaceTrees });
    expect(result.missing).toEqual([]);
    expect(result.orphans).toEqual([]);
  });

  it("ignores top-level _meta when computing orphans", () => {
    const sourceFiles = [{ path: "/fake/app.tsx", text: `t("panels:title");` }];
    const namespaceTrees = {
      panels: { _meta: { source: "x" }, title: "Panels" },
    };
    const result = analyseUsage({ sourceFiles, namespaceTrees });
    expect(result.orphans).toEqual([]);
  });

  it("treats different files as separate sources but aggregates references", () => {
    const sourceFiles = [
      { path: "/fake/a.tsx", text: `t("panels:title");` },
      { path: "/fake/b.tsx", text: `t("panels:title"); t("panels:other");` },
    ];
    const namespaceTrees = {
      panels: { title: "Panels", other: "Other" },
    };
    const result = analyseUsage({ sourceFiles, namespaceTrees });
    expect(result.missing).toEqual([]);
    expect(result.orphans).toEqual([]);
  });
});
