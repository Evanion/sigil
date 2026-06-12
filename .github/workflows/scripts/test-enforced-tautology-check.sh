#!/usr/bin/env bash
#
# Violation-fires sentinel test for enforced-tautology-check.sh.
#
# Per CLAUDE.md §11 "CI Guards Must Ship With a Violation-Fires Test" and
# "CI Guards Must Cover Their Whole File Class": this sentinel exercises the
# real check (same entry point CI uses) against synthetic fixtures and asserts:
#
#   1. The check FAILS (exit 1) on a tree containing a known-bad tautological
#      `_enforced` test — in BOTH languages (Rust + TypeScript), so a future
#      maintainer who narrows the guard to one language fails this sentinel.
#   2. The check PASSES (exit 0) on a tree of known-good `_enforced` tests that
#      DO exercise a fallible boundary — in BOTH languages.
#   3. Each language's bad fixture is detected on its own (so dropping either
#      language's scan from the guard fails the sentinel).
#
# Run by the enforced-test-tautology-check CI job BEFORE the real scan, so a
# misconfigured guard fails fast.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="${SCRIPT_DIR}/enforced-tautology-check.sh"

if [ ! -x "$CHECK" ]; then
  echo "FAIL: check script not found or not executable: $CHECK" >&2
  exit 1
fi

tmproot=$(mktemp -d)
trap 'rm -rf "$tmproot"' EXIT

# ── Fixture builders ─────────────────────────────────────────────────────────

# Known-bad Rust: assert_eq! against a bare constant — the PR #67 / RF-008 shape.
write_bad_rust() {
  local dir="$1"
  mkdir -p "$dir/crates/demo/src"
  cat > "$dir/crates/demo/src/bad.rs" <<'EOF'
#[cfg(test)]
mod tests {
    #[test]
    fn test_max_demo_enforced() {
        // Tautology: reads the constant, proves no enforcement.
        assert_eq!(MAX_DEMO, 256);
    }
}
EOF
}

# Known-bad TypeScript: expect(CONST).toBe(literal) — the same shape in vitest.
write_bad_ts() {
  local dir="$1"
  mkdir -p "$dir/frontend/src/demo"
  cat > "$dir/frontend/src/demo/bad.test.ts" <<'EOF'
import { describe, it, expect } from "vitest";
describe("demo", () => {
  it("test_max_stops_enforced", () => {
    expect(MAX_STOPS).toBe(32);
  });
});
EOF
}

# Known-good Rust: calls a fallible validator and asserts it rejects.
write_good_rust() {
  local dir="$1"
  mkdir -p "$dir/crates/demo/src"
  cat > "$dir/crates/demo/src/good.rs" <<'EOF'
#[cfg(test)]
mod tests {
    #[test]
    fn test_max_demo_enforced() {
        // Real enforcement: an over-cap value is rejected by the validator.
        assert!(validate_demo(MAX_DEMO + 1).is_err());
    }
}
EOF
}

# Known-good TypeScript: asserts the store rejected the over-cap input.
write_good_ts() {
  local dir="$1"
  mkdir -p "$dir/frontend/src/demo"
  cat > "$dir/frontend/src/demo/good.test.ts" <<'EOF'
import { describe, it, expect, vi } from "vitest";
describe("demo", () => {
  it("test_max_fills_enforced: should not add fill when at maximum", () => {
    const setFills = vi.fn();
    // ...at-capacity store, click add...
    expect(setFills).not.toHaveBeenCalled();
  });
});
EOF
}

# run_check <dir> -> echoes the exit code without aborting under `set -e`.
run_check() {
  local dir="$1" rc=0
  bash "$CHECK" "$dir" >/dev/null 2>&1 || rc=$?
  echo "$rc"
}

fail() { echo "FAIL: $1" >&2; exit 1; }

# ── Case 1: both-language BAD tree must FAIL ─────────────────────────────────
both_bad="$tmproot/both-bad"
write_bad_rust "$both_bad"
write_bad_ts "$both_bad"
if [ "$(run_check "$both_bad")" -eq 0 ]; then
  fail "guard passed a tree containing tautological _enforced tests (Rust + TS)"
fi

# ── Case 2: both-language GOOD tree must PASS ────────────────────────────────
both_good="$tmproot/both-good"
write_good_rust "$both_good"
write_good_ts "$both_good"
if [ "$(run_check "$both_good")" -ne 0 ]; then
  fail "guard rejected a tree of legitimate enforcement _enforced tests (Rust + TS)"
fi

# ── Case 3: Rust-only BAD must FAIL (proves Rust scan is wired) ──────────────
rust_bad="$tmproot/rust-bad"
write_bad_rust "$rust_bad"
write_good_ts "$rust_bad"   # TS side clean — only the Rust tautology should trip it
if [ "$(run_check "$rust_bad")" -eq 0 ]; then
  fail "guard missed a Rust-only tautology (Rust scan not wired / file-class gap)"
fi

# ── Case 4: TS-only BAD must FAIL (proves TS scan is wired) ──────────────────
ts_bad="$tmproot/ts-bad"
write_good_rust "$ts_bad"   # Rust side clean — only the TS tautology should trip it
write_bad_ts "$ts_bad"
if [ "$(run_check "$ts_bad")" -eq 0 ]; then
  fail "guard missed a TS-only tautology (TS scan not wired / file-class gap)"
fi

echo "enforced-tautology-check sentinel test passed (bad fires, good passes, both languages)"
