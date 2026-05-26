# CI Shell Script Discipline

These rules apply to all bash/sh code in `.github/workflows/*.yml`, `scripts/`, and any CI-invoked shell entry points. Shell scripts that parse compiler/grep/lint output handle adversarial inputs (filenames, line numbers, content snippets) and run with workflow-token privileges — defensive parsing is mandatory.

---

### Validate Numeric Inputs Before Arithmetic

Any variable used inside `$((...))` arithmetic expansion MUST be validated as a non-empty digit sequence before use. Bash arithmetic performs recursive variable evaluation; a filename or grep capture containing `$(...)` flowing into arithmetic can execute arbitrary commands under the runner's token.

Pattern:
```bash
if [[ ! "$lineno" =~ ^[0-9]+$ ]]; then
  echo "non-numeric lineno: $lineno" >&2; exit 1
fi
start=$((lineno > 1 ? lineno - 1 : 1))
```

Anti-pattern: `$((lineno - 1))` without prior `=~ ^[0-9]+$` validation.

### Do Not Split Delimited Output With `cut -d<delim>`

When parsing `<file>:<lineno>:<content>` output (grep, ripgrep, eslint compact), do NOT use `cut -d: -f1` — filenames may legally contain `:` on most filesystems. Use parameter expansion or `awk` with a field count.

Pattern:
```bash
file="${line%%:*}"
rest="${line#*:}"
lineno="${rest%%:*}"
```

Or:
```bash
file=$(awk -F: '{print $1}' <<<"$line")
```

Anti-pattern: `file=$(echo "$line" | cut -d: -f1)`.

### Address-Zero `sed` Off-by-One

Any `sed -n "Ns,Mp"` invocation derived from a line number MUST clamp the start address to ≥1. GNU sed rejects address 0; under `set -euo pipefail`, this aborts the workflow with an opaque error.

Pattern: `start=$((lineno > 1 ? lineno - 1 : 1))` before constructing the sed range.

### Pass `--` Before Untrusted Filenames

Any shell command that takes a filename from untrusted output (grep result, find result) MUST insert `--` before the filename argument to prevent flag injection:
```bash
sed -n "${start},${lineno}p" -- "$file"
```

### Grep-Based Exemption Tokens Must Require Non-Trivial Content

When CI greps for an exemption comment (`// i18n-allow:`, `// eslint-disable-next-line ...:`, `// a11y-ignore:`), the regex MUST require non-empty alphabetic content after the marker — at minimum, one 3+-letter word somewhere on the line. A bare marker with no rationale is not an exemption — it's a TODO the reviewer forgot.

Pattern: `grep -qE 'i18n-allow:.*[A-Za-z]{3,}'`

This admits rationales that begin with punctuation (so `i18n-allow: "= " prefix is decorative` validates) but rejects empty or punctuation-only content.

Anti-patterns:
- `grep -q 'i18n-allow:'` — accepts empty rationale.
- `grep -qE 'i18n-allow:[[:space:]]*[A-Za-z]+'` — over-strict; rejects rationales that lead with a quoted glyph or symbol the rationale is explaining.

### Use Bash Arrays for Multi-Line Accumulators

To collect multi-line error output, use an array + `printf '%s\n'` — not string accumulation with `\n` escapes.

Pattern:
```bash
errs=()
errs+=("file:line:reason")
printf '%s\n' "${errs[@]}"
```

Anti-pattern: `bad="$bad\nfile:line:reason"` — produces leading blank line, requires `-e` on echo, breaks with content containing `%`.

---

### Precedent

PR #66 (i18n CI gate lock) — five findings (RF-005, RF-015, RF-016, RF-017, RF-032) in a single ~20-line bash block in `.github/workflows/ci.yml`. Range: workflow crash on line 1, code-injection sink in arithmetic expansion, colon-in-filename parser break, accepted-empty-rationale exemption, cosmetic accumulator wart. Identifying this as a single discipline pattern prevents the next CI bash block from re-discovering them one at a time.
