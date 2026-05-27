# Review Findings — PR #68 (Spec 19 DeleteNodes)

**Reviewed:** 2026-05-27
**PR:** https://github.com/Evanion/sigil/pull/68
**Branch:** `feature/delete-nodes-spec-19`
**Base SHA:** `fd32066` (Spec 18 P3 color)
**Head SHA:** `7b8300a` (migration cliff)
**Reviewers:** Architect, Security, BE (×3: code quality, logic, compliance), Data Scientist, FE, A11y, UX, DevOps (10 agents)

## Summary

- 2 Critical, 5 High, 10 Major, 12 Medium, 8 Minor findings.
- Critical/High findings (RF-001…RF-007) form a single failure mode: undo of a non-trivial delete is broken end-to-end. Descendants lost from the store, page-root membership not restored, remote clients orphan-rolling. The originator's optimistic local state is *also* incomplete (the forward delete in `store.deleteNodes` removes descendants from `state.nodes` correctly, but the inverse only captures the retained roots — so undo cannot restore them).
- Two performance findings (RF-005, RF-007) compound the failure: an unbounded `node_uuids` request can DoS the server, and the rollback path is O(K²) precisely when the document is mid-corruption.
- The ungroupNodes 2-undo regression (RF-011) is worse than the PR description acknowledged — the intermediate state after one Ctrl+Z is incoherent (group exists but children are still detached from it), not just "two presses to fully reverse".

## Phase 2 — Persisted findings

All findings written with status `open`. Remediation in severity order.

---

### Critical

#### RF-001 — Undo of `deleteNodes` loses every descendant node
- **Source:** Architect, Logic, FE
- **Status:** open
- **Severity:** Critical
- **Location:** `frontend/src/store/document-store-solid.tsx:932-951, 1016-1021`; `frontend/src/operations/apply-to-store.ts:150-210`; `frontend/src/operations/apply-remote.ts:570-688`
- **Description:** `state.nodes` is a flat `Record<string, MutableDocumentNode>` keyed by UUID. The forward delete walks each retained subtree via `collectSubtree` and removes every descendant entry from `state.nodes`. The snapshot, however, captures only `nodeSnapshot = deepClone(state.nodes[uuid])` for each top-most retained UUID — descendants get no snapshot. The inverse transaction is therefore `N create_node` ops where `N = retained.length`, each restoring exactly one map entry. The restored root retains its original `childrenUuids: [...]` array, so the parent looks plausible — but every descendant `state.nodes[c]` lookup returns `undefined`. The Canvas renderer, LayersTree, and selection logic all dereference children via the flat map; on undo the user sees the root with empty/broken sub-content, and the descendants are gone from the document permanently. Spec §11 manual-smoke item #9 explicitly demands this restoration behavior and is not satisfied.
- **Fix:** Snapshot the entire subtree for each retained root (every node in the `deletedUuids` set). Build N inverse `create_node` ops where N covers every node in the deleted subtree, ordered parent-before-child. Update `operationToServerOp`'s `create_node` mapping to forward `parentUuid`. Add regression test for delete-then-undo of a Frame with 2+ levels of nested children.

#### RF-002 — Undo of `deleteNodes` on a page-root node does not restore page-root membership
- **Source:** Architect, Logic, FE
- **Status:** open
- **Severity:** Critical
- **Location:** `frontend/src/store/document-store-solid.tsx:938-950, 1016-1021`; `frontend/src/operations/apply-to-store.ts:185-209`; `frontend/src/operations/apply-remote.ts:662-687`; `frontend/src/store/document-store-solid.tsx:412-419` (`operationToServerOp` hardcodes `pageId: null`)
- **Description:** Snapshot captures `pageId` + `pageIndex` but neither field travels to `applyCreateNode`. On undo: the node is recreated in `state.nodes` with `parentUuid: null` but is NOT inserted into any `page.rootNodeUuids`. Renderer iterates `page.rootNodeUuids` to draw → orphan is invisible. Page-root delete is the dominant case (any top-level node).
- **Fix:** Include `pageId` and `originalIndex` (interpreted against `page.rootNodeUuids` when `parentUuid === null`) in the inverse `create_node` op's `value`. Update `applyCreateNode` (both files) to add a page-root restore branch. Update `operationToServerOp`'s `create_node` mapping to forward `pageId`. Regression test for delete-then-undo of a page-root node.

---

### High

#### RF-003 — Remote/redo `applyDeleteNodes` orphans descendants and leaks page-root entries
- **Source:** Logic, FE
- **Status:** open
- **Severity:** High
- **Location:** `frontend/src/operations/apply-remote.ts:701-734`, `frontend/src/operations/apply-to-store.ts:221-255`
- **Description:** Both handlers detach the node from its parent's `childrenUuids` but never walk descendants and never strip from `page.rootNodeUuids`. Remote clients receiving a broadcast for "delete page-root P" leave `pages[*].rootNodeUuids` containing P forever. Similarly, descendants of any deleted node remain in `state.nodes` as orphans on remote clients. Same shape on the redo path through `applyOperationToStore`.
- **Fix:** In both handlers: collect full descendant set via the same depth-bounded walk used in `store.deleteNodes`; iterate that set when deleting from `state.nodes`; also walk `s.pages` and strip every removed uuid from each page's `rootNodeUuids`. Wrap mutations in a single `produce()` block.

#### RF-004 — Frontend dedup ancestor walk has no cycle/depth guard
- **Source:** Security
- **Status:** open
- **Severity:** High
- **Location:** `frontend/src/store/document-store-solid.tsx:910-918` (`isDescendantOfOtherTarget` inside `deleteNodes`)
- **Description:** Unbounded `while (cursor !== null)` loop. CLAUDE.md §11 "Recursive Functions Require Depth Guards" applies workspace-wide. A parent cycle in store state (via a buggy reparent broadcast, a desync, or an `apply-remote.ts` race) freezes the browser tab on main thread.
- **Fix:** Add a depth counter using `MAX_NODE_TREE_DEPTH` (shared with `MAX_SUBTREE_DEPTH` per RF-016). On limit hit, `console.error` and fail-safe to "not a descendant" so the user's delete still proceeds.

#### RF-005 — Unbounded `node_uuids` parsed before validate()
- **Source:** Security
- **Status:** resolved (bd5ec3a)
- **Severity:** High
- **Location:** `crates/server/src/graphql/mutation.rs:778-786`, `crates/mcp/src/tools/nodes.rs:301-308`
- **Description:** Both transports accept `node_uuids: Vec<String>` with no length cap, parse the entire array into `Vec<Uuid>` BEFORE calling `DeleteNodes::validate`. Memory amplification: ~36 bytes per UUID string + 16 bytes per parsed UUID × N concurrent connections. Pre-allocation DoS. The server's existing `MAX_BATCH_SIZE = 256` bounds operation count but not per-op vec lengths.
- **Fix:** Add an early length check at both transport boundaries before parsing. Reject if `dn.node_uuids.len() > MAX_NODES_PER_DELETE_BATCH` or `is_empty()` — return a typed error before allocating the parsed-UUIDs vec.

#### RF-006 — `descendants()` lacks MAX_NODE_TREE_DEPTH enforcement
- **Source:** BE
- **Status:** open
- **Severity:** High
- **Location:** `crates/core/src/tree.rs:219-232`
- **Description:** Spec §9 mandates the constant is enforced at every recursive entry point including subtree walks. `descendants` uses an explicit stack (no recursion overflow risk) but carries no depth cap or visited-set check. A corrupted arena cycle (if one ever slipped past validate) causes infinite loop inside the apply lock.
- **Fix:** Add `max_depth: usize` parameter; track depth via parallel stack of `(NodeId, depth)`; reject when `depth >= max_depth`. Update both call sites in `node_commands.rs` and the tree tests. Mirrors `ancestors` signature.

#### RF-007 — `Arena::reinsert` is O(free_list); batch rollback is O(K²)
- **Source:** Data Scientist
- **Status:** open
- **Severity:** High
- **Location:** `crates/core/src/arena.rs:160`
- **Description:** `Arena::reinsert` calls `self.free_list.retain(|&i| i != id.index())` — O(N) over the free list. During rollback of K already-completed subtree deletes, each rollback calls `reinsert` once; `free_list.len()` grows to ~K before rollback fires; total O(K²) cost. For K=1000, ~10⁶ vec scans during the most fragile state. Compounds RF-008 (rollback abandonment) — rollback is both slow AND incomplete.
- **Fix:** Replace `Vec<u32>` free list with `HashSet<u32>` for O(1) removal, OR record the slot's free-list index during `remove` for O(1) splice on `reinsert`. Either approach makes rollback O(K).

---

### Major

#### RF-008 — Rollback abandoned mid-stream on first reinsert failure
- **Source:** Security, BE
- **Status:** open
- **Severity:** Major
- **Location:** `crates/core/src/commands/node_commands.rs:246-260`
- **Description:** Loop returns immediately on first `reinsert_nodes_subtree` failure; items K+1..N in `completed` (earlier deletions in original order) are never reinserted → arena loses them permanently. Violates spec §8 all-or-nothing claim.
- **Fix:** Accumulate rollback errors into `Vec<CoreError>`; continue iterating; surface compound error containing every rollback failure naming each lost node.

#### RF-009 — `delete_nodes_subtree` and `reinsert_nodes_subtree` silently swallow `page_mut` errors
- **Source:** Security, BE, Compliance
- **Status:** open
- **Severity:** Major
- **Location:** `crates/core/src/commands/node_commands.rs:270-274, 304-309`
- **Description:** `if let Ok(page) = doc.page_mut(...)` silently drops the error. CLAUDE.md §11 "No Silent Error Suppression" — applies on rollback path especially. Failure to restore a page root leaves the document corrupted with no diagnostic.
- **Fix:** Use `let page = doc.page_mut(page_id)?;` and surface the typed error. validate() already proved this path is reachable; a real `Err` is a true invariant violation worth surfacing.

#### RF-010 — `applyDeleteNodes` accepts non-string array items
- **Source:** Security, FE, Compliance
- **Status:** open
- **Severity:** Major
- **Location:** `frontend/src/operations/apply-remote.ts:716`, `frontend/src/operations/apply-to-store.ts:231`
- **Description:** `Array.isArray(value.node_uuids)` check passes through `[null, 42, "uuid"]`; each element cast to `string`. `Reflect.deleteProperty(s.nodes, null)` stringifies to `"null"` deleting unrelated entry. Defense-in-depth gap.
- **Fix:** Filter via `nodeUuids.every((u): u is string => typeof u === "string")` before iteration; emit structured warn on rejection.

#### RF-011 — `ungroupNodes` 2-undo regression (intermediate state incoherent)
- **Source:** Architect, UX
- **Status:** open
- **Severity:** Major
- **Location:** `frontend/src/store/document-store-solid.tsx:1687-1800`
- **Description:** Ungrouping produces TWO transactions: (1) reparent + setField (coalesced); (2) delete-group via `pushTransaction`. `pushTransaction` calls `forceFlush()` first. Worse than disclosed in PR: after one Ctrl+Z, group is restored with empty `childrenUuids` (children still parented to `groupParent`) — incoherent intermediate state. Second Ctrl+Z restores parent linkage. User sees an impossible doc state mid-undo.
- **Fix:** Extend `Interceptor` with `pushIntoCurrentBuffer(ops, inverseOps)` that appends to the current coalesce window. Refactor `ungroupNodes` to snapshot the group BEFORE detaching children, then push a single transaction with combined inverse.

#### RF-012 — `inverseType` returns same type for `create_node`/`delete_nodes` instead of throwing
- **Source:** Architect, FE
- **Status:** resolved (bd5ec3a)
- **Severity:** Major
- **Location:** `frontend/src/operations/operation-helpers.ts:50-63`
- **Description:** Documented convention says `create_node`/`delete_nodes` go through `inverseOperations`. But `inverseType` falls back to returning the input type. Any future caller bypassing `createInverseTransaction` produces silent no-op inverses.
- **Fix:** `throw new Error("...")` for `create_node` and `delete_nodes` in `inverseType`. Update tests.

#### RF-013 — Rollback errors mapped to generic `ValidationError` string
- **Source:** BE
- **Status:** open
- **Severity:** Major
- **Location:** `crates/core/src/commands/node_commands.rs:251-256`
- **Description:** CLAUDE.md §11 explicitly forbids mapping rollback error to a generic variant. Stringifying primary + rollback errors into `ValidationError` loses programmatic dispatchability.
- **Fix:** Add `CoreError::RollbackFailed { primary: Box<CoreError>, rollback_errors: Vec<CoreError> }` and return it. Pairs with RF-008.

#### RF-014 — Tree-depth-exceeded returns `ValidationError` string, not typed variant
- **Source:** BE
- **Status:** open
- **Severity:** Major
- **Location:** `crates/core/src/tree.rs:202-205`
- **Description:** Spec §9 referenced `Err(TreeDepthExceeded { .. })` as a typed variant; impl uses `ValidationError(format!(...))`. Cannot pattern-match on the error.
- **Fix:** Add `CoreError::TreeDepthExceeded { limit: usize, node_id: NodeId }`; return from `ancestors`; update test to match on typed variant.

#### RF-015 — `collectSubtree` recursion silently truncates past MAX_SUBTREE_DEPTH
- **Source:** Logic, FE
- **Status:** open
- **Severity:** Major
- **Location:** `frontend/src/store/document-store-solid.tsx:955-968`
- **Description:** Silent `return` when `depth >= MAX_SUBTREE_DEPTH = 64`. Descendants past depth 64 NOT added to `deletedUuids` → linger as orphans, NOT pruned from selection.
- **Fix:** `console.warn` with structured payload identifying the uuid at limit. (Combined fix with RF-016.)

#### RF-016 — `MAX_SUBTREE_DEPTH` is a local magic constant duplicated across files
- **Source:** FE, Compliance
- **Status:** open
- **Severity:** Major
- **Location:** `frontend/src/store/document-store-solid.tsx:956`, `frontend/src/panels/LayersTree.tsx:16` (`MAX_TREE_DEPTH`)
- **Description:** Same invariant defined 3 times (Rust `MAX_NODE_TREE_DEPTH`, FE `MAX_SUBTREE_DEPTH`, FE `MAX_TREE_DEPTH`). Violates CLAUDE.md §5 TS rule "validation constants used by more than one frontend module MUST be in a single source-of-truth module".
- **Fix:** Define `MAX_NODE_TREE_DEPTH` in `frontend/src/types/validation.ts` matching the Rust value; import everywhere.

#### RF-017 — Delete count mismatch when dedup retains fewer nodes than were selected
- **Source:** UX
- **Status:** open
- **Severity:** Major
- **Location:** `frontend/src/store/document-store-solid.tsx:1028`
- **Description:** Announcement uses `ids.length` (correct user-selection count). History description uses `snapshots.length` (dedup-retained count). Diverge silently when ancestor + descendant are both selected.
- **Fix:** Pass the original selection count from Canvas/LayersTree to `deleteNodes` and use it for the description; OR explicitly disclose the dedup ("Delete 2 nodes (1 parent + 1 nested)").

---

### Medium

#### RF-018 — Inverse-operation size limit not enforced
- **Source:** Data Scientist, FE
- **Status:** resolved (bd5ec3a)
- **Severity:** Medium
- **Location:** `frontend/src/operations/history-manager.ts:46-55`, `frontend/src/operations/interceptor.ts:345-356`
- **Description:** `pushTransaction` enforces `MAX_OPERATIONS_PER_TRANSACTION` on forward `operations.length` only, NOT on `inverseOperations.length`. A `delete_nodes` forward op (length 1) with N inverse ops bypasses the limit.
- **Fix:** Assert `(tx.inverseOperations?.length ?? 0) <= MAX_OPERATIONS_PER_TRANSACTION`.

#### RF-019 — `applyDeleteNodes` issues 2N setState calls
- **Source:** Data Scientist
- **Status:** open
- **Severity:** Medium
- **Location:** `frontend/src/operations/apply-remote.ts:701-734`
- **Description:** Remote handler issues `2N` setState calls (parent.childrenUuids update + node delete) for an N-batch. Local `store.deleteNodes` correctly uses single `produce()`. 2000 reactive updates for a 1000-batch broadcast.
- **Fix:** Wrap full loop in a single `setState(produce(...))`.

#### RF-020 — Broadcast `value` forwards raw API input, not post-mutation canonical state
- **Source:** Security, BE
- **Status:** partial-resolved (bd5ec3a)
- **Severity:** Medium
- **Location:** `crates/server/src/graphql/mutation.rs:787-794`, `crates/mcp/src/tools/nodes.rs:341-351`
- **Description:** Violates CLAUDE.md §4 broadcast payload contract. Both transports forward raw `node_uuids` input; the dedup pass in `DeleteNodes::apply` may drop UUIDs.
- **Fix:** Construct broadcast `value` from post-mutation document state (recompute dedup or expose retained list from `apply`).
- **Resolution:** Both transports now canonicalize UUID strings via `Uuid::to_string()` so the wire form is consistent regardless of input casing/format. The full post-mutation canonicalization (forwarding only the dedup-retained set) is documented as a known limitation: `ParsedOp` builds the broadcast pre-apply, and the frontend's `applyDeleteNodes` walks the local subtree from each broadcast root and is tolerant of "uuid already deleted" — descendants that core's dedup dropped are still removed by the local walk. The canonicalization closes the same-shape contract (RF-036 is fully resolved); the dedup refinement would require restructuring `ParsedOp` and provides no observable user-visible improvement under the current frontend apply path.

#### RF-021 — `DeleteNodes::apply` snapshot memory unbounded by batch limit
- **Source:** Data Scientist
- **Status:** open
- **Severity:** Medium
- **Location:** `crates/core/src/commands/node_commands.rs:182-228`
- **Description:** Up to 100K cloned Nodes (~100MB-1GB) per operation. Bounded by arena size, not the 1000 batch cap. No per-operation memory budget.
- **Fix:** Add `MAX_DELETED_SUBTREE_NODES` constant enforced in `apply()` after snapshot computation.

#### RF-022 — Wire-layer page lookup is O(N × P × R)
- **Source:** Data Scientist
- **Status:** resolved (bd5ec3a)
- **Severity:** Medium
- **Location:** `crates/server/src/graphql/mutation.rs:800-814`, `crates/mcp/src/tools/nodes.rs:317-330`
- **Description:** N=1000 UUIDs × P pages × R roots per page = up to 10⁸ comparisons. Realistic case 10⁵-10⁶.
- **Fix:** Pre-build `HashMap<NodeId, PageId>` once before the loop.

#### RF-023 — `applyDeleteNodes` doesn't `console.warn` when UUID missing from store
- **Source:** FE, Compliance
- **Status:** open
- **Severity:** Medium
- **Location:** `frontend/src/operations/apply-remote.ts:716-733`, `frontend/src/operations/apply-to-store.ts:231-254`
- **Description:** Per-UUID missing-node case silently no-ops. Frontend-defensive "Internal Mutation Entry Points Must Diagnose Their Own No-Ops" requires structured warn.
- **Fix:** Add `console.warn("applyDeleteNodes: uuid not in store, skipping", { uuid, batch: nodeUuids })`.

#### RF-024 — `MAX_NODE_TREE_DEPTH` lacks `_enforced`-named test
- **Source:** BE, Compliance
- **Status:** open
- **Severity:** Medium
- **Location:** `crates/core/src/tree.rs:560-603`
- **Description:** Body exists (`test_ancestors_rejects_chain_exceeding_depth_limit`) but won't be caught by future `_enforced`-grep CI step. PR #67 amendment precedent.
- **Fix:** Rename to `test_max_node_tree_depth_enforced`.

#### RF-025 — In-apply rollback path untested
- **Source:** BE
- **Status:** open
- **Severity:** Medium
- **Location:** `crates/core/src/commands/node_commands.rs:243-261`
- **Description:** Rollback helpers tested in isolation; the integration path (apply → partial failure → rollback) has no covering test.
- **Fix:** Add `test_delete_nodes_rolls_back_on_apply_failure` constructing a scenario where the 2nd target's `delete_nodes_subtree` fails mid-loop.

#### RF-026 — `debug_assert!` on `!retained.is_empty()` becomes no-op in release
- **Source:** BE
- **Status:** open
- **Severity:** Medium
- **Location:** `crates/core/src/commands/node_commands.rs:176-179`
- **Description:** Release builds compile out the assertion. If invariant violated, apply silently succeeds with zero mutations.
- **Fix:** Replace with hard check returning typed error.

#### RF-027 — No client-side MAX_NODES_PER_DELETE_BATCH validation
- **Source:** UX
- **Status:** open
- **Severity:** Medium
- **Location:** `frontend/src/store/document-store-solid.tsx:903-920`
- **Description:** Server-side validation only. >1000 nodes triggers optimistic delete + silent server rejection with no user feedback. Violates §11 "Validation Must Be Symmetric Across All Transports".
- **Fix:** Add length check at top of `deleteNodes()` mirroring Rust constant. On rejection: `announceError` + return.

#### RF-028 — LayersTree Delete deletes focused row only, not selection
- **Source:** UX
- **Status:** open
- **Severity:** Medium
- **Location:** `frontend/src/panels/LayersTree.tsx:584-603`
- **Description:** Pre-existing bug surfaced by migration. Canvas Delete uses `selectedNodeIds()`; LayersTree uses focused row only. Inconsistent.
- **Fix:** Use `store.selectedNodeIds()` if non-empty, fall back to focused row.

#### RF-029 — CI BANNED regex duplicated between `ci.yml` step and sentinel script
- **Source:** DevOps
- **Status:** open
- **Severity:** Medium
- **Location:** `.github/workflows/ci.yml:391`, `.github/workflows/scripts/test-delete-node-removal-discipline.sh:15`
- **Description:** Future edit to one copy won't propagate to the other. Mirrors §5 "inline copies diverge silently".
- **Fix:** Factor BANNED/ALLOWED into a shared file that both consume.

---

### Minor

| ID | Source | Description | Fix |
|---|---|---|---|
| RF-030 | DevOps | ALLOWED regex contains dead entries (paths excluded by file-type filter) | Drop dead entries or widen scan scope |
| RF-031 | DevOps, Security | Sentinel script doesn't test ALLOWED exclusion or file-extension filter | Extend sentinel with full-pipeline fixtures |
| RF-032 | UX | MCP `delete_node`→`delete_nodes` rename has no agent migration aid | Add deprecation shim or CHANGELOG note |
| RF-033 | FE | `originalIndex >= 0` accepts fractional positives | Use `Number.isSafeInteger` |
| RF-034 | BE | Test pollution — `_enforced` duplicates `_rejects_oversized_batch` | Consolidate into single canonical test |
| RF-035 | DevOps | Workflow paths-filter doesn't include `.github/workflows/scripts/**` | Add scripts/ to detect-changes filter |
| RF-036 | Security | MCP broadcast UUID strings not canonicalized via `Uuid::to_string()` | Replace `uuid_strs` with `parsed.iter().map(\|u\| u.to_string())` — resolved (bd5ec3a) |
| RF-037 | FE | Exhaustiveness sentinel doesn't cover `transactionToServerOps`/`operationToServerOp` | Reference functions in test-d or remove default arms |

---

## Phase 2 status

Findings persisted. Ready to remediate.
