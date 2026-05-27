#!/usr/bin/env bash
# Violation-fires test for the delete-node-removal-discipline grep (Spec 19).
# Per CLAUDE.md §11 "CI Guards Must Ship With a Violation-Fires Test": this
# script constructs synthetic source containing one of the banned strings and
# asserts the grep fires; then asserts a clean fixture passes. Run by the
# delete-node-removal-discipline CI job before the real grep.

set -euo pipefail

# Banned strings — every reference to the singular DeleteNode path that
# Spec 19 Task 16 removes. Each identifier is anchored with `\b` (word
# boundary) so the singular forms do NOT match the plural variants
# (e.g., `DeleteNode\b` rejects `DeleteNode` but accepts `DeleteNodes`).
# The `store\.deleteNode\(` arm already anchors via the literal `(`.
BANNED='DeleteNode\b|delete_node\b|DeleteNodeInput\b|createDeleteNodeOp\b|store\.deleteNode\('

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

# Construct a violation fixture (Rust) and a clean fixture.
cat > "$tmpdir/violation.rs" <<'EOF'
use agent_designer_core::commands::DeleteNode;
EOF

cat > "$tmpdir/violation.ts" <<'EOF'
case "delete_node":
  applyDeleteNode(op.nodeUuid);
EOF

cat > "$tmpdir/clean.rs" <<'EOF'
use agent_designer_core::commands::node_commands::DeleteNodes;
EOF

cat > "$tmpdir/clean.ts" <<'EOF'
case "delete_nodes":
  applyDeleteNodes(op.value);
EOF

# Assert the grep matches each violation fixture. Uses POSIX grep -E for
# portability — both macOS and GitHub Actions runners ship grep by default.
for f in "$tmpdir/violation.rs" "$tmpdir/violation.ts"; do
  if ! grep -E "$BANNED" "$f" >/dev/null; then
    echo "FAIL: grep did not match violation fixture: $f" >&2
    exit 1
  fi
done

# Assert the grep does NOT match the clean fixtures.
for f in "$tmpdir/clean.rs" "$tmpdir/clean.ts"; do
  if grep -E "$BANNED" "$f" >/dev/null 2>&1; then
    echo "FAIL: grep falsely matched clean fixture: $f" >&2
    grep -E "$BANNED" "$f" >&2 || true
    exit 1
  fi
done

echo "delete-node-removal-discipline sentinel test passed"
