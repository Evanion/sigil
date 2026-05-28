/**
 * Verifies that fr/ and es/ locale JSON files have the same key tree
 * and the same `{{var}}` placeholder set as the corresponding en/ files.
 * Top-level keys starting with "_" (e.g., "_meta") are skipped — locales
 * may legitimately diverge on provenance metadata.
 *
 * Exit code 0 if all match; 1 if any divergence found.
 *
 * Usage: node frontend/scripts/check-locale-parity.mjs
 */

import { readFileSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, "..", "src", "i18n", "locales");
const NAMESPACES = ["common", "tools", "panels", "a11y", "welcome"];
const LOCALES = ["en", "fr", "es"];

/**
 * Maximum nesting depth for locale JSON trees. Translation files are
 * authored by humans and a sane upper bound prevents accidental
 * pathological structures (e.g., a malformed file with a self-referential
 * cycle once we ever support compound resources) from hanging the script.
 * Enforced via `depth >= MAX_LOCALE_NESTING_DEPTH` — see CLAUDE.md §11
 * "Recursive Functions Require Depth Guards".
 */
export const MAX_LOCALE_NESTING_DEPTH = 16;

/** Regex that extracts `{{var}}` placeholder names from a leaf string. */
const PLACEHOLDER_REGEX = /\{\{(\w+)\}\}/g;

/** Recursively collect dotted key paths from a nested object,
 *  skipping any top-level key beginning with "_". */
function collectKeys(obj, prefix = "", isTopLevel = true, depth = 0) {
  if (depth >= MAX_LOCALE_NESTING_DEPTH) {
    throw new Error(
      `Locale tree exceeds MAX_LOCALE_NESTING_DEPTH (${MAX_LOCALE_NESTING_DEPTH}) at prefix "${prefix}"`,
    );
  }
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    if (isTopLevel && k.startsWith("_")) continue;
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...collectKeys(v, fullKey, false, depth + 1));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

/** Recursively collect leaf string values keyed by their dotted path,
 *  skipping top-level `_*` keys and non-string leaves. */
function collectLeaves(obj, prefix = "", isTopLevel = true, depth = 0) {
  if (depth >= MAX_LOCALE_NESTING_DEPTH) {
    throw new Error(
      `Locale tree exceeds MAX_LOCALE_NESTING_DEPTH (${MAX_LOCALE_NESTING_DEPTH}) at prefix "${prefix}"`,
    );
  }
  const leaves = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isTopLevel && k.startsWith("_")) continue;
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(leaves, collectLeaves(v, fullKey, false, depth + 1));
    } else if (typeof v === "string") {
      leaves[fullKey] = v;
    }
  }
  return leaves;
}

/** Extract the set of placeholder names from a string value. */
function extractPlaceholders(str) {
  const names = new Set();
  for (const match of str.matchAll(PLACEHOLDER_REGEX)) {
    names.add(match[1]);
  }
  return names;
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

/** Compare placeholder sets between two locale trees for every key that
 *  exists in BOTH trees with a string leaf value. Keys missing from
 *  either side are NOT reported here (compareLocaleTrees owns that).
 *  Returns an array of `{ key, expected, actual }` where the placeholder
 *  sets differ. */
export function compareLocalePlaceholders(a, b) {
  const aLeaves = collectLeaves(a);
  const bLeaves = collectLeaves(b);
  const mismatches = [];
  for (const [key, aValue] of Object.entries(aLeaves)) {
    const bValue = bLeaves[key];
    if (bValue === undefined) continue; // structural divergence — already reported
    const expected = extractPlaceholders(aValue);
    const actual = extractPlaceholders(bValue);
    if (!placeholderSetsEqual(expected, actual)) {
      mismatches.push({
        key,
        expected: [...expected].sort(),
        actual: [...actual].sort(),
      });
    }
  }
  return mismatches;
}

function placeholderSetsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function loadLocaleNamespace(locale, ns) {
  const path = join(LOCALES_DIR, locale, `${ns}.json`);
  let raw;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(`Failed to read ${path}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON in ${path}: ${err.message}`);
  }
}

function main() {
  let totalFailures = 0;
  const structuralFailures = [];
  const placeholderFailures = [];

  for (const ns of NAMESPACES) {
    const enTree = loadLocaleNamespace("en", ns);
    for (const locale of LOCALES.filter((l) => l !== "en")) {
      const otherTree = loadLocaleNamespace(locale, ns);
      const { missing, extra } = compareLocaleTrees(enTree, otherTree);
      if (missing.length > 0 || extra.length > 0) {
        totalFailures++;
        structuralFailures.push({ namespace: ns, locale, missing, extra });
      }
      const placeholderMismatches = compareLocalePlaceholders(enTree, otherTree);
      if (placeholderMismatches.length > 0) {
        totalFailures++;
        placeholderFailures.push({
          namespace: ns,
          locale,
          mismatches: placeholderMismatches,
        });
      }
    }
  }

  if (totalFailures === 0) {
    console.log("✓ All locale key trees and placeholder sets match en/.");
    process.exit(0);
  }

  console.error("✗ Locale parity check failed:");

  if (structuralFailures.length > 0) {
    console.error("\nStructural divergences (missing/extra keys):");
    for (const { namespace, locale, missing, extra } of structuralFailures) {
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
  }

  if (placeholderFailures.length > 0) {
    console.error("\nPlaceholder divergences ({{var}} sets differ):");
    for (const { namespace, locale, mismatches } of placeholderFailures) {
      console.error(`\n  Namespace: ${namespace}, Locale: ${locale}`);
      for (const { key, expected, actual } of mismatches) {
        console.error(`    ${key}: expected {${expected.join(", ")}} got {${actual.join(", ")}}`);
      }
    }
  }

  process.exit(1);
}

// Run main() only when invoked directly, not when imported by tests.
// `realpathSync` resolves symlinks/`pnpm` shims; `fileURLToPath` handles
// Windows paths and spaces correctly. See RF-020 (PR #66 review).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main();
}
