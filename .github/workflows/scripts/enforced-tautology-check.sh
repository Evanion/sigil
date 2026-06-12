#!/usr/bin/env bash
#
# _enforced-tautology guard (CLAUDE.md §11 "Constant Enforcement Tests").
#
# Flags any test whose name ends in `_enforced` (Rust: `fn test_*_enforced`;
# TypeScript: an `it("…_enforced"…)` / `test("…_enforced"…)` / `describe`
# whose title contains `_enforced` or the bare word `enforced`) whose BODY
# does NOT exercise enforcement — i.e. bodies that contain only tautological
# constant-reading assertions (`assert!(CONST <= literal)`,
# `assert_eq!(CONST, …)`, `expect(CONST).toBe(…)`) and lack an enforcement
# signal (a call to a fallible validator returning Result/Option/throwing,
# or an assertion that a constructor/deserialization path rejects an
# out-of-range value with a typed error).
#
# Precedent: PR #67 `test_min_color_channel_enforced` asserted
# `MIN_COLOR_CHANNEL <= 0.0` (tautology); the `_enforced` suffix let it pass
# any name-only audit despite zero enforcement. Re-surfaced as PR #77 RF-008
# governance gap — the guard the rule mandated was never shipped. This is it.
#
# Per CLAUDE.md §11 "CI Guards Must Cover Their Whole File Class": scope is by
# glob — Rust `crates/**/*.rs` AND TypeScript `frontend/src/**/*.{ts,tsx}` —
# not a single named file.
#
# Defensive parsing per .claude/rules/ci-shell-discipline.md:
#   - parameter expansion (`${line%%:*}`), never `cut -d:` (filenames may
#     legally contain ':');
#   - every `$((…))` arithmetic input validated digit-only first (bash
#     arithmetic recursively expands variables — an unvalidated capture is a
#     code-injection sink);
#   - sed start addresses clamped >= 1 (GNU sed rejects address 0 under
#     `set -e`);
#   - `--` before every untrusted filename argument;
#   - bash-array accumulator emitted via `printf '%s\n'`.
#
# Usage: enforced-tautology-check.sh [ROOT]
#   ROOT defaults to the repository root (two levels up from this script).
#   The sentinel violation-fires test passes a fixture directory as ROOT.
#
# Exit 0 with "no tautological _enforced tests found"; exit 1 listing each
# violation as `file:line:reason`.

set -euo pipefail

ROOT="${1:-}"
if [ -z "$ROOT" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
fi

if [ ! -d "$ROOT" ]; then
  echo "::error::enforced-tautology-check: ROOT is not a directory: $ROOT" >&2
  exit 2
fi

# ── Detection model ─────────────────────────────────────────────────────────
#
# A `_enforced` test is a TAUTOLOGY when EVERY assertion in its body merely
# reads a constant's value (the §11-enumerated shapes:
# `assert!(CONST <relop> literal)`, `assert_eq!(CONST, …)`,
# `expect(CONST).toBe(…)`) and the body never exercises a runtime boundary.
#
# Rather than try to enumerate every legitimate behavioral-assertion spelling
# (`.not.toHaveBeenCalled()`, `.toHaveLength(N)`, `computeResize(…).width
# toBe(1)`, `undoCount toBe(MAX)`, …) — which risks both false positives and
# false negatives — the detector works the other way around, matching the
# rule's literal definition of the violation:
#
#   flag  <=>  the body contains at least one ASSERTION
#              AND every assertion is a CONSTANT-ONLY (tautological) assertion
#              AND the body contains no fallible-boundary signal.
#
# "Constant-only assertion" = an `assert!`/`assert_eq!`/`assert_ne!`/`expect(…)`
# whose asserted SUBJECT is a bare SCREAMING_SNAKE_CASE constant identifier
# (the thing the test is supposed to be enforcing, read directly). A test that
# asserts against ANY runtime value (a function result, a mock-call count, a
# store field, a collection length) is exercising behavior and is NOT flagged.
#
# This precisely matches the PR #67 / RF-008 failure: a body whose sole
# assertion is `assert_eq!(MUTATION_BROADCAST_CAPACITY, 256)` /
# `assert!(MIN_COLOR_CHANNEL <= 0.0)` — and nothing else.

# Fallible-boundary signals: if any appears, the test exercises enforcement
# directly and is never a tautology. Broad on purpose (false negative here is
# bounded by review; a false positive blocks a legitimate test).
#   Rust:  is_err/is_none/expect_err/unwrap_err/assert_err, Err(, matches!(…Err),
#          validate_/check_/_validate(, ::new(/::try_/from_json/deserialize,
#          ::open(/::register(, panic!(
#   TS:    .toThrow(/toThrowError, toBeNull, rejects, toBe(false|null|undefined),
#          === null/undefined, expect(() => …)
ENFORCE_RE='is_err\(|is_none\(|\.expect_err\(|\.unwrap_err\(|assert_err|\bErr\(|matches!\([^)]*Err|validate_|check_[a-z]|_validate\(|::new\(|::try_|try_from|from_json|deserialize|::open\(|::register\(|panic!\(|\.toThrow|toThrowError|toBeNull|\brejects\b|toBe\(false\)|toBe\(null\)|toBe\(undefined\)|===\s*null|===\s*undefined|expect\(\s*\(\s*\)'

# An ASSERTION line of any kind (Rust macro or vitest expect).
ASSERTION_RE='assert(_eq|_ne)?!\(|\bexpect\('

# A CONSTANT-ONLY assertion: the asserted subject is a bare SCREAMING_SNAKE_CASE
# identifier read directly. Matches the three §11-enumerated tautology shapes:
#   assert!(CONST <op> literal)          assert!(MIN_X <= 0.0)
#   assert_eq!(CONST, literal)           assert_eq!(MAX_X, 32)
#   assert_ne!(CONST, literal)
#   expect(CONST).toBe(literal)          expect(MAX_X).toBe(32)
# The leading `[A-Z][A-Z0-9_]*` with no preceding `.`/`(`/alnum ensures we match
# a top-level constant, not `result.MAX` or `foo(MAX)`.
TAUTOLOGY_ASSERT_RE='assert(_eq|_ne)?!\(\s*[A-Z][A-Z0-9_]+\s*[,<>=!)]|expect\(\s*[A-Z][A-Z0-9_]+\s*\)'

errs=()

# extract_and_check <file> <decl_lineno> <title>
# Reads the brace-balanced body starting at decl_lineno and appends to errs[]
# when the body is a constant-reading tautology (see detection model above).
extract_and_check() {
  local file="$1" decl_lineno="$2" title="$3"
  # Validate the line number is digit-only BEFORE any arithmetic / tail use.
  if ! [[ "$decl_lineno" =~ ^[0-9]+$ ]]; then
    echo "::warning::skipping non-numeric line field for $file: $decl_lineno" >&2
    return 0
  fi
  # Read from the declaration line to EOF, then brace-balance to find the body.
  # `--` guards filenames beginning with '-'. tail -n +N is 1-indexed and
  # rejects 0, so clamp.
  local start=$((decl_lineno >= 1 ? decl_lineno : 1))
  local body depth=0 started=0 body_lines=()
  local line
  while IFS= read -r line; do
    # Count braces to find the balanced end of the test body.
    local opens closes
    opens="${line//[^\{]/}"
    closes="${line//[^\}]/}"
    depth=$((depth + ${#opens} - ${#closes}))
    if [ "${#opens}" -gt 0 ]; then started=1; fi
    body_lines+=("$line")
    if [ "$started" -eq 1 ] && [ "$depth" -le 0 ]; then
      break
    fi
  done < <(tail -n "+${start}" -- "$file")

  body=$(printf '%s\n' "${body_lines[@]}")

  # A fallible boundary anywhere in the body ⇒ real enforcement ⇒ never flag.
  if printf '%s' "$body" | grep -qE "$ENFORCE_RE"; then
    return 0
  fi

  # Count total assertions vs. constant-only (tautological) assertions.
  local total_assert taut_assert
  total_assert=$(printf '%s' "$body" | grep -cE "$ASSERTION_RE" || true)
  taut_assert=$(printf '%s' "$body" | grep -cE "$TAUTOLOGY_ASSERT_RE" || true)

  # No assertion at all ⇒ the body must be doing its enforcement some other
  # way (a panic on bad input, a `?`-propagating call). Don't flag — the
  # enforcement-signal pass above already cleared genuinely-enforcing bodies,
  # and a zero-assertion body is out of scope for the "reads the constant but
  # proves nothing" failure this guard targets.
  if [ "$total_assert" -eq 0 ]; then
    return 0
  fi

  # Tautology ⇔ EVERY assertion is constant-only. If even one assertion is
  # against a runtime value, the test exercises behavior and is legitimate.
  if [ "$taut_assert" -ge "$total_assert" ]; then
    errs+=("$file:$decl_lineno:_enforced test '$title' is a tautology — its only assertion(s) read a constant's value (e.g. assert_eq!(CONST, literal) / expect(CONST).toBe(...)) and never exercise a fallible boundary. Call the validator/constructor and assert it rejects an out-of-range value.")
  fi
}

# ── Rust: fn test_*_enforced ────────────────────────────────────────────────
# grep -n gives "<file>:<lineno>:<rest>"; parse with parameter expansion only.
while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  file="${hit%%:*}"
  rest="${hit#*:}"
  lineno="${rest%%:*}"
  match="${rest#*:}"
  # Derive a human title for the message.
  title="$(printf '%s' "$match" | sed -E 's/.*fn[[:space:]]+(test_[A-Za-z0-9_]*_enforced).*/\1/')"
  extract_and_check "$file" "$lineno" "$title"
done < <(grep -rEn 'fn[[:space:]]+test_[A-Za-z0-9_]*_enforced[[:space:]]*\(' \
           --include='*.rs' "$ROOT/crates" 2>/dev/null || true)

# ── TypeScript: it/test/describe titles containing _enforced ────────────────
# Match a test-registration call whose string title contains `_enforced` or
# the bare word `enforced`. The body is the brace-balanced block that follows
# the `=> {` / `function {` on (or after) the same line.
if [ -d "$ROOT/frontend/src" ]; then
  while IFS= read -r hit; do
    [ -z "$hit" ] && continue
    file="${hit%%:*}"
    rest="${hit#*:}"
    lineno="${rest%%:*}"
    match="${rest#*:}"
    title="$(printf '%s' "$match" | sed -E 's/.*(it|test|describe)\([^"'"'"'`]*["'"'"'`]([^"'"'"'`]*).*/\2/')"
    extract_and_check "$file" "$lineno" "$title"
  done < <(grep -rEn '(it|test|describe)\(\s*["'"'"'`][^"'"'"'`]*(_enforced|\benforced\b)' \
             --include='*.ts' --include='*.tsx' "$ROOT/frontend/src" 2>/dev/null || true)
fi

if [ "${#errs[@]}" -gt 0 ]; then
  echo "::error::Tautological _enforced test(s) found — each reads a constant but never exercises a fallible boundary. Per CLAUDE.md §11 'Constant Enforcement Tests', a _enforced test MUST call a fallible validator/constructor and assert it rejects an out-of-range value." >&2
  printf '%s\n' "${errs[@]}" >&2
  exit 1
fi

rust_count=0
if [ -d "$ROOT/crates" ]; then
  rust_count=$(grep -rEc 'fn[[:space:]]+test_[A-Za-z0-9_]*_enforced' \
    --include='*.rs' "$ROOT/crates" 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
fi
ts_count=0
if [ -d "$ROOT/frontend/src" ]; then
  ts_count=$(grep -rEc '(it|test|describe)\(\s*["'"'"'`][^"'"'"'`]*(_enforced|\benforced\b)' \
    --include='*.ts' --include='*.tsx' "$ROOT/frontend/src" 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
fi
echo "No tautological _enforced tests found (${rust_count} Rust + ${ts_count} TS _enforced tests scanned)."
