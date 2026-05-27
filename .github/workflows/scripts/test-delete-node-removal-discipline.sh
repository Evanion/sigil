#!/usr/bin/env bash
# Violation-fires test for the delete-node-removal-discipline grep (Spec 19).
# Per CLAUDE.md §11 "CI Guards Must Ship With a Violation-Fires Test": this
# script constructs synthetic source containing one of the banned strings and
# asserts the grep fires; then asserts a clean fixture passes; then asserts
# the production-shape pipeline (BANNED match → ALLOWED filter) catches
# violations in code paths and skips them in allow-listed paths.
#
# Run by the delete-node-removal-discipline CI job BEFORE the real grep, so
# any misconfiguration of BANNED or ALLOWED fails fast.

set -euo pipefail

# Source the shared BANNED/ALLOWED constants so the sentinel exercises EXACTLY
# the same regexes the CI step runs (RF-029).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./delete-node-removal-discipline.env
source "${SCRIPT_DIR}/delete-node-removal-discipline.env"

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

# ── Part 1: BANNED regex semantics ─────────────────────────────────────
# Construct a violation fixture (Rust + TS) and a clean fixture (plural names).
mkdir -p "$tmpdir/crates" "$tmpdir/frontend/src"

cat > "$tmpdir/crates/violation.rs" <<'EOF'
use agent_designer_core::commands::DeleteNode;
EOF

cat > "$tmpdir/frontend/src/violation.ts" <<'EOF'
case "delete_node":
  applyDeleteNode(op.nodeUuid);
EOF

cat > "$tmpdir/crates/clean.rs" <<'EOF'
use agent_designer_core::commands::node_commands::DeleteNodes;
EOF

cat > "$tmpdir/frontend/src/clean.ts" <<'EOF'
case "delete_nodes":
  applyDeleteNodes(op.value);
EOF

# Assert the grep matches each violation fixture.
for f in "$tmpdir/crates/violation.rs" "$tmpdir/frontend/src/violation.ts"; do
  if ! grep -E "$BANNED" "$f" >/dev/null; then
    echo "FAIL: BANNED regex did not match violation fixture: $f" >&2
    exit 1
  fi
done

# Assert the grep does NOT match the clean fixtures.
for f in "$tmpdir/crates/clean.rs" "$tmpdir/frontend/src/clean.ts"; do
  if grep -E "$BANNED" "$f" >/dev/null 2>&1; then
    echo "FAIL: BANNED regex falsely matched clean fixture: $f" >&2
    grep -E "$BANNED" "$f" >&2 || true
    exit 1
  fi
done

# ── Part 2: ALLOWED filter pipeline (RF-031) ───────────────────────────
# Construct two more fixtures: one inside an allow-listed path that contains a
# banned string (should be filtered OUT by ALLOWED), and one inside a regular
# path (should remain after ALLOWED filter).
mkdir -p "$tmpdir/docs/superpowers/specs"
cat > "$tmpdir/docs/superpowers/specs/2026-05-27-19-delete-nodes.md" <<'EOF'
Mentions DeleteNode and delete_node legitimately in spec prose.
EOF

# Allowed file should be filtered out by ALLOWED.
allowed_hits=$(grep -rE "$BANNED" "$tmpdir/docs" 2>/dev/null | grep -vE "$ALLOWED" || true)
if [ -n "$allowed_hits" ]; then
  echo "FAIL: ALLOWED regex did not filter out the spec-file fixture" >&2
  echo "$allowed_hits" >&2
  exit 1
fi

# Production-path fixture should survive ALLOWED filter.
prod_hits=$(grep -rE "$BANNED" "$tmpdir/crates" 2>/dev/null | grep -vE "$ALLOWED" || true)
if [ -z "$prod_hits" ]; then
  echo "FAIL: production-path violation was filtered out by ALLOWED (regex too broad)" >&2
  exit 1
fi

echo "delete-node-removal-discipline sentinel test passed"
