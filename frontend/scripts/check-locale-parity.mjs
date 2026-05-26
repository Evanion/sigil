/**
 * Verifies that fr/ and es/ locale JSON files have the same key tree
 * as the corresponding en/ files. Top-level keys starting with "_"
 * (e.g., "_meta") are skipped — locales may legitimately diverge on
 * provenance metadata.
 *
 * Exit code 0 if all match; 1 if any divergence found.
 *
 * Usage: node frontend/scripts/check-locale-parity.mjs
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, "..", "src", "i18n", "locales");
const NAMESPACES = ["common", "tools", "panels", "a11y"];
const LOCALES = ["en", "fr", "es"];

/** Recursively collect dotted key paths from a nested object,
 *  skipping any top-level key beginning with "_". */
function collectKeys(obj, prefix = "", isTopLevel = true) {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    if (isTopLevel && k.startsWith("_")) continue;
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...collectKeys(v, fullKey, false));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

/** Compare two locale trees; returns missing + extra keys in `b`
 *  relative to `a`. Skips top-level `_*` keys. */
export function compareLocaleTrees(a, b) {
  const aKeys = new Set(collectKeys(a));
  const bKeys = new Set(collectKeys(b));
  const missing = [...aKeys].filter((k) => !bKeys.has(k));
  const extra = [...bKeys].filter((k) => !aKeys.has(k));
  return { missing, extra };
}

function loadLocaleNamespace(locale, ns) {
  const path = join(LOCALES_DIR, locale, `${ns}.json`);
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(`Failed to load ${path}: ${err.message}`);
  }
}

function main() {
  let totalFailures = 0;
  const failures = [];

  for (const ns of NAMESPACES) {
    const enTree = loadLocaleNamespace("en", ns);
    for (const locale of LOCALES.filter((l) => l !== "en")) {
      const otherTree = loadLocaleNamespace(locale, ns);
      const { missing, extra } = compareLocaleTrees(enTree, otherTree);
      if (missing.length > 0 || extra.length > 0) {
        totalFailures++;
        failures.push({ namespace: ns, locale, missing, extra });
      }
    }
  }

  if (totalFailures === 0) {
    console.log("✓ All locale key trees match en/.");
    process.exit(0);
  }

  console.error("✗ Locale parity check failed:");
  for (const { namespace, locale, missing, extra } of failures) {
    console.error(`\n  Namespace: ${namespace}, Locale: ${locale}`);
    if (missing.length > 0) {
      console.error(`    Missing from ${locale}/${namespace}.json:`);
      for (const k of missing) console.error(`      - ${k}`);
    }
    if (extra.length > 0) {
      console.error(`    Extra in ${locale}/${namespace}.json (not in en):`);
      for (const k of extra) console.error(`      - ${k}`);
    }
  }
  process.exit(1);
}

// Run main() only when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
