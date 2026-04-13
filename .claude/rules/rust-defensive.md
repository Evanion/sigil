# Rust Defensive Coding Rules

These rules apply to all Rust code in `crates/` — core crate validation, serialization, arena management, lock handling, and FieldOperation design. They are extracted from CLAUDE.md Section 11 and carry the same enforcement weight.

---

### Constructors Must Validate

Every public constructor (`new`, `from_*`, `try_from_*`) must call all applicable validation functions. If `validate.rs` defines rules for a field, the constructor for any type containing that field must enforce those rules. "Validation exists but isn't called" is a bug.

### Deserialization Boundaries Must Match Validation Rules

When validation rules are added or changed in `validate.rs` (or equivalent), the deserialization entry points MUST be updated in the same commit to enforce the new rules. A checklist:
- Every field validated in `validate.rs` must also be validated during deserialization.
- When adding a new validation rule, search for all `deserialize_*` and `from_json` functions and update them.

Custom `Deserialize` implementations MUST reject duplicate keys in map/struct inputs. Serde's default behavior silently resolves duplicates via last-writer-wins, which can mask data corruption. When implementing custom deserializers that collect into maps, track seen keys and return an error on the first duplicate.

### Arena Operations Must Preserve Identity on Undo

When using generational arenas, removing and re-inserting an entity produces a NEW key. Any operation that needs to restore a previous state (undo, rollback) MUST use `reinsert(key, value)` or equivalent to preserve the original key. Never use `insert()` in an undo path for arena-managed entities — this silently breaks all external references to that entity.

### Restore State Before Propagating Errors

When an item is removed from a collection (popped from a stack, removed from a vec, taken from a map) and a subsequent operation on that item may fail, the item MUST be restored to its original position before returning the error. Pattern: pop, attempt operation, push back on failure. Using `?` after a destructive removal without restoration loses the item permanently.

### Multi-Item Mutations Must Roll Back on Partial Failure

When a mutation function loops over multiple items (reparenting N children, removing N nodes from a group, applying N property changes), the loop MUST track which items have been successfully modified. If item K fails, the method must reverse modifications to items 0 through K-1 before returning the error. Pattern: maintain a `completed: Vec<ReverseInfo>` alongside the loop; on failure, iterate `completed` in reverse order and undo each. This applies to loops within any single mutation function — whether a `FieldOperation`'s `apply()`, a GraphQL resolver, or an MCP tool handler. A loop that modifies 5 of 10 items and then returns an error has corrupted the document.

### Ordered Collection Mutations Must Preserve Position

When removing an element from an ordered collection (Vec, VecDeque) for a reversible operation, record the element's index at the time of removal. The undo path must use `insert(index, element)`, not `push(element)`. Pushing to the end silently changes ordering, which violates undo semantics.

### Cross-Field Invariant Validation

When a type has fields that must be mutually consistent (e.g., a discriminant enum and a value enum, a unit field and a numeric field), the constructor and deserialization path MUST validate the relationship between them. Single-field validation is not sufficient — add an explicit cross-field check and a test for each invalid combination.

### No Derive Deserialize on Validated Types

Any type in `crates/core/` that has validation logic in its constructor MUST NOT use `#[derive(Deserialize)]`. Instead, implement `Deserialize` manually (or via a helper) that routes through the validating constructor. Fields on validated types MUST be private to prevent direct construction. This prevents `#[derive(Deserialize)]` from creating an invisible second construction path that bypasses all validation.

### Validated Types Must Have Private Fields

Every type in `crates/core/` whose constructor (`new`, `from_*`, `try_from_*`) performs validation or computes derived state MUST have all fields private (`pub(crate)` at most). This applies to value objects and any type with invariants — not only deserialized types. Public fields allow callers to construct instances via struct literal syntax, bypassing the constructor entirely. They also allow mutation of internal state (e.g., pre-populated snapshots) between construction and use. If external code needs to read a field, add an accessor method. **Exception:** `FieldOperation` structs (forward-only operations with a `validate()` method on the trait) may have public fields. These are pure data carriers where validation happens at the trait level via `validate()` before `apply()`, not in a constructor. The server and MCP crates construct them via struct literal syntax, which is the intended pattern.

### FieldOperations Must Be Self-Contained

A `FieldOperation` struct's `apply()` method must be callable immediately after construction and `validate()` without the caller performing any additional setup. The struct receives the operation's parameters (what to do); `validate()` checks preconditions against the document; `apply()` performs the mutation. Callers MUST call `validate()` before `apply()`. The caller (server/MCP) is responsible for rollback on partial failure in multi-step operations — `FieldOperation` structs are forward-only and do not capture undo state.

### Arena-Local IDs Must Not Be Serialized

Types that represent arena indices or generational IDs (e.g., `NodeId`) MUST NOT appear in serialized or persisted data formats. Serialized document formats MUST use stable, globally-unique identifiers (UUIDs). Arena-keyed types must be mapped to their stable ID at the serialization boundary. Arena indices are meaningless outside a running session — serializing them produces corrupt references on reload.

### Uniqueness Constraints on Named Collections

When a collection contains entities with a name or identifier field that must be unique within that collection (e.g., component names in a document, property names in a component, variant names in a component), the insertion point MUST reject duplicates with a typed error. Do not rely on the collection type (HashMap vs Vec) to enforce this implicitly — validate explicitly and return an error that identifies the conflicting name.

### Filesystem Writes Must Be Atomic

Every file write in the server crate must use the write-to-temp-then-rename pattern. Write the full content to a temporary file in the SAME directory as the target (to ensure same-filesystem rename), then `fs::rename()` to the final path. This prevents partial writes on crash or power loss. Direct `fs::write()` to the final path is a bug in the server crate.

### Hold Locks for the Full Read-Modify-Write Sequence

Never split a read-then-write into two separate lock acquisitions. Acquiring a read lock, releasing it, and then acquiring a write lock is a TOCTOU race — another thread can mutate the value between the two acquisitions. Any logic of the form "read to check a condition, then write based on that condition" MUST hold a single write lock (or upgradeable read lock) for the entire sequence. This applies to `RwLock`, `Mutex`, and any wrapper around them. If the write lock scope is too coarse, redesign the data structure rather than splitting the lock.

### RAII Guards Do Not Provide Transactional Rollback

Dropping a lock guard (`MutexGuard`, `RwLockWriteGuard`) releases the lock — it does NOT revert mutations made while the lock was held. If a batch of N mutations is applied under a single lock acquisition and mutation K fails, mutations 0 through K-1 remain applied after the guard drops. The lock only serializes access; it provides no undo semantics. When a batch must be atomic (all-or-nothing), the code must implement explicit rollback: track completed mutations, and on failure, reverse them before releasing the lock. This also applies to TypeScript: holding a reference to an object during a sequence of mutations does not provide transactional semantics.

### NodeKind Variants Must Have Complete Validation Coverage

When a new `NodeKind` variant is added to `crates/core/`, the same PR MUST add a corresponding arm to every dispatch site that branches on `NodeKind`. The mandatory sites are:
1. `CreateNode::validate` — must validate all fields introduced by the variant's associated data.
2. The workfile deserialization path — must call the same validation.
3. Any `match kind { ... }` in the core crate.

A `match` that uses a catch-all (`_ =>`) arm for a `NodeKind` dispatch is a bug — it silently ignores new variants. All `NodeKind` matches in `crates/core/` must be exhaustive with no wildcard arms.

### CSS-Rendered String Fields Must Reject CSS-Significant Characters

Any string field in `crates/core/` or the frontend that is used to produce a CSS property value or Canvas 2D context property (e.g., `ctx.font`, `ctx.fillStyle`) MUST be validated to reject CSS-significant characters. Denylist: single quote, double quote, semicolon, curly braces, backslash, and C0 control characters (bytes 0x00–0x1F). Apply in `validate.rs` (Rust) and a shared validation helper (TypeScript). Examples: `font_family`, variable font axis names, CSS custom property names.

This validation obligation applies at two boundaries, both mandatory: (1) input arrival — validate at the API/deserialization boundary before storing; (2) output use — any function that constructs a Canvas 2D context property (`ctx.font`, `ctx.fillStyle`) or a CSS property string by interpolating a user-controlled field MUST call the CSS character validation helper immediately before interpolation, even if the value was already validated at input. Defense in depth: values may travel through code paths that bypass input validation.

### Side-Effect Artifacts Must Be Constructed After Precondition Verification

When implementing a mutation that requires lock acquisition and entity existence verification, all side-effect artifacts (broadcast payloads, response objects, audit log entries) MUST be constructed AFTER the lock is acquired and AFTER preconditions (entity exists, fields valid) are confirmed. Pre-building these artifacts before verification wastes allocation on error paths and risks constructing a payload from stale pre-lock state. Pattern: acquire lock, verify preconditions, apply mutation, construct broadcast payload from verified post-mutation state, release lock, send broadcast.

### Delete Operations Must Enforce Collection-Level Invariants

Any `FieldOperation` that removes an entity from a bounded collection MUST validate both (1) that the entity exists, AND (2) that removing it will not violate a minimum-cardinality invariant. If a document must always contain at least one page, `DeletePage::validate` must check `page_count > MIN_PAGES_PER_DOCUMENT`. The minimum MUST be defined as a `MIN_*` constant in `validate.rs`. Do not rely on the frontend to enforce this — frontend guards are bypassable via GraphQL and MCP.
