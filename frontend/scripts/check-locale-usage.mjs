/**
 * Verifies that every `t("ns:key")` reference in frontend/src resolves to
 * an existing key in the corresponding en/<ns>.json file. Also reports
 * orphan keys — keys present in en/<ns>.json that no source file
 * references.
 *
 * Why two checks, two scripts:
 *   - check-locale-parity.mjs verifies the shape of the locale files
 *     against each other (en vs fr vs es).
 *   - check-locale-usage.mjs verifies the contract between source code
 *     and the en locale (the canonical source of truth).
 *
 * The regex is intentionally narrow and matches the common case
 * (`t("ns:key")` or `t('ns:key')`). Programmatic key construction is
 * outside this script's scope.
 *
 * Exit code 0 if all match; 1 if any unresolved reference or
 * (when not suppressed) orphan key is found.
 *
 * Usage: node frontend/scripts/check-locale-usage.mjs [--no-orphans]
 */

import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, dirname, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { MAX_LOCALE_NESTING_DEPTH, loadLocaleNamespace } from "./check-locale-parity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = join(__dirname, "..", "src");
const NAMESPACES = ["common", "tools", "panels", "a11y"];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);
const SKIP_FILE_SUFFIXES = [
  ".test.ts",
  ".test.tsx",
  ".test-d.ts",
  ".stories.ts",
  ".stories.tsx",
  ".spec.ts",
  ".spec.tsx",
];

/**
 * Match `t("ns:key")`, `t('ns:key')`, including when the call appears
 * after a member access (e.g., `i18n.t("ns:key")`). Namespace is a
 * lowercase identifier (digits allowed, e.g., "a11y"); key may contain
 * dots, underscores, digits.
 */
const T_CALL_REGEX = /\bt\s*\(\s*['"]([a-z][a-z0-9]*):([A-Za-z0-9_.]+)['"]/gi;

function walkSource(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // Skip any __tests__ directory wholesale.
      if (entry === "__tests__") continue;
      walkSource(full, out);
      continue;
    }
    if (!stat.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(extname(entry))) continue;
    if (SKIP_FILE_SUFFIXES.some((s) => entry.endsWith(s))) continue;
    out.push(full);
  }
  return out;
}

/**
 * Strip `//` line comments and `/* ... *\/` block comments from a source
 * file's text. This is intentionally simplistic — it does not handle
 * strings containing `//` correctly. The regex match consumer is
 * itself narrow enough that the rare false positive is acceptable.
 *
 * Why: t("ns:key") references that appear inside comments (e.g.,
 * documentation showing default i18next behavior for missing keys) are
 * not real references and must not be flagged as unknown-namespace
 * references.
 */
function stripComments(text) {
  // Strip block comments first (greedy across lines via [\s\S]).
  let out = text.replace(/\/\*[\s\S]*?\*\//g, "");
  // Strip line comments. A naive approach (`//[^\n]*`) is sufficient
  // for our matching purposes — a `//` inside a JS string literal would
  // be wrongly stripped, but the `t(...)` regex itself requires a
  // quoted argument, so a `t("ns:key")` reference inside a string
  // (which would itself need escaping) cannot exist in practice.
  out = out.replace(/\/\/[^\n]*/g, "");
  return out;
}

/** Extract every `t("ns:key")` call from a source file's text. */
export function extractTCalls(text) {
  const cleaned = stripComments(text);
  const calls = [];
  for (const match of cleaned.matchAll(T_CALL_REGEX)) {
    calls.push({ namespace: match[1], key: match[2] });
  }
  return calls;
}

/** Resolve a dotted key path against a locale tree. Returns the leaf
 *  value if the path exists (string, null, or number), undefined if the
 *  path does not resolve to a leaf. */
export function resolveKeyPath(tree, dottedPath, depth = 0) {
  if (depth >= MAX_LOCALE_NESTING_DEPTH) {
    throw new Error(
      `Key path resolution exceeded MAX_LOCALE_NESTING_DEPTH (${MAX_LOCALE_NESTING_DEPTH}) at "${dottedPath}"`,
    );
  }
  const parts = dottedPath.split(".");
  let node = tree;
  for (const part of parts) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
      return undefined;
    }
    if (!(part in node)) return undefined;
    node = node[part];
  }
  // Final node must be a non-object leaf (string is the common case,
  // null is permitted, numbers/booleans accepted defensively).
  if (typeof node === "object" && node !== null && !Array.isArray(node)) {
    return undefined;
  }
  return node;
}

/** Walk the locale tree and emit every leaf's dotted key path, skipping
 *  top-level `_*` keys. Mirrors collectKeys in check-locale-parity.mjs
 *  but returns paths directly. */
function collectKeyPaths(obj, prefix = "", isTopLevel = true, depth = 0) {
  if (depth >= MAX_LOCALE_NESTING_DEPTH) {
    throw new Error(
      `Locale tree exceeds MAX_LOCALE_NESTING_DEPTH (${MAX_LOCALE_NESTING_DEPTH}) at "${prefix}"`,
    );
  }
  const paths = [];
  for (const [k, v] of Object.entries(obj)) {
    if (isTopLevel && k.startsWith("_")) continue;
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      paths.push(...collectKeyPaths(v, fullKey, false, depth + 1));
    } else {
      paths.push(fullKey);
    }
  }
  return paths;
}

/**
 * Analyse all source files under `srcRoot` and the namespace map.
 * Pure function — does no I/O directly. Useful for unit testing.
 */
export function analyseUsage({ sourceFiles, namespaceTrees }) {
  const missing = []; // { file, namespace, key } — t(...) call references a missing key
  const unknownNamespace = []; // { file, namespace, key } — namespace not in our allowlist
  const referencedKeys = new Map(); // namespace -> Set<key>

  for (const ns of Object.keys(namespaceTrees)) {
    referencedKeys.set(ns, new Set());
  }

  for (const { path, text } of sourceFiles) {
    for (const call of extractTCalls(text)) {
      const tree = namespaceTrees[call.namespace];
      if (tree === undefined) {
        unknownNamespace.push({ file: path, ...call });
        continue;
      }
      const resolved = resolveKeyPath(tree, call.key);
      if (resolved === undefined) {
        missing.push({ file: path, ...call });
      } else {
        referencedKeys.get(call.namespace).add(call.key);
      }
    }
  }

  // Orphan detection — keys present in en/<ns>.json but not referenced
  // by any source file.
  const orphans = []; // { namespace, key }
  for (const [ns, tree] of Object.entries(namespaceTrees)) {
    const referenced = referencedKeys.get(ns);
    for (const path of collectKeyPaths(tree)) {
      if (!referenced.has(path)) {
        orphans.push({ namespace: ns, key: path });
      }
    }
  }

  return { missing, unknownNamespace, orphans };
}

function main() {
  const args = process.argv.slice(2);
  const skipOrphanCheck = args.includes("--no-orphans");

  const namespaceTrees = {};
  for (const ns of NAMESPACES) {
    namespaceTrees[ns] = loadLocaleNamespace("en", ns);
  }

  const sourcePaths = walkSource(FRONTEND_SRC);
  const sourceFiles = sourcePaths.map((path) => ({
    path,
    text: readFileSync(path, "utf-8"),
  }));

  const { missing, unknownNamespace, orphans } = analyseUsage({
    sourceFiles,
    namespaceTrees,
  });

  let hasFailures = false;

  if (missing.length > 0) {
    hasFailures = true;
    console.error("✗ t() calls referencing missing locale keys:");
    for (const { file, namespace, key } of missing) {
      const rel = relative(FRONTEND_SRC, file);
      console.error(`  ${rel}: t("${namespace}:${key}")`);
    }
  }

  if (unknownNamespace.length > 0) {
    hasFailures = true;
    console.error("\n✗ t() calls referencing unknown namespaces (not in allowlist):");
    const known = NAMESPACES.join(", ");
    console.error(`  (known namespaces: ${known})`);
    for (const { file, namespace, key } of unknownNamespace) {
      const rel = relative(FRONTEND_SRC, file);
      console.error(`  ${rel}: t("${namespace}:${key}")`);
    }
  }

  if (!skipOrphanCheck && orphans.length > 0) {
    hasFailures = true;
    console.error("\n✗ Orphan keys in en/<ns>.json (no t() reference found):");
    for (const { namespace, key } of orphans) {
      console.error(`  ${namespace}:${key}`);
    }
    console.error("\n  (Rerun with --no-orphans to ignore orphan detection.)");
  }

  if (!hasFailures) {
    console.log("✓ All t() references resolve to existing locale keys.");
    process.exit(0);
  }

  process.exit(1);
}

// Run main() only when invoked directly, not when imported by tests.
// `realpathSync` resolves symlinks/`pnpm` shims; `fileURLToPath` handles
// Windows paths and spaces correctly. See RF-020 (PR #66 review).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main();
}
