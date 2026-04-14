# Frontend Defensive Coding Rules

These rules apply to all frontend code in `frontend/` — Solid.js reactivity, store management, history/undo, optimistic updates, and DOM lifecycle. They are extracted from CLAUDE.md Section 11 and carry the same enforcement weight.

---

### Reactive Pipelines Must Be Verified End-to-End

When a value flows from a producer (signal, computed memo, callback prop, store field) to a renderer or side-effecting consumer, the connection MUST be verified by a test that exercises the full path: trigger the producer, assert the consumer's output. A pipeline that compiles and type-checks but whose downstream consumer receives a voided or disconnected value is a silent no-op — the compiler cannot detect broken wiring. This pattern recurs: a signal read but assigned to `_` or not forwarded; a callback prop defined but never passed to the child; a store field populated but the renderer reads a different field. Every new reactive connection introduced in a PR must have at least one integration or component test that asserts the consumer receives and acts on the value. Unit-testing the producer in isolation is not sufficient — the wiring itself must be tested.

### User-Initiated Mutations Must Use Optimistic Updates

Every mutation triggered by a direct user action (drag-and-drop, rename, toggle, delete) that modifies server state MUST apply the expected state change to the local store immediately, before the server responds. Waiting for a server round-trip before updating the UI creates perceptible lag that violates the "feels like Figma" UX requirement. The optimistic update contract:
1. Snapshot the pre-mutation local state.
2. Apply the change to the local store immediately.
3. Send the mutation to the server.
4. On success: reconcile with server response (accept server-canonical values).
5. On error: revert to the snapshot and display a visible error notification.
A mutation that does a full refetch on success instead of optimistic update is a performance bug. A full refetch is only acceptable as a fallback on error.

### Debounced Mutations Must Preserve Rollback Snapshots

When a mutation is debounced (delayed to batch rapid user input), the pre-mutation snapshot for rollback MUST be captured on the first invocation of the debounce window, not when the debounced function finally fires. The debounce timer resets on each call, but the snapshot must remain from the first call — otherwise the rollback target drifts with each intermediate state. On error, revert to this original snapshot. On success, discard the snapshot and clear the timer. Every debounced mutation must implement the same five-step optimistic update contract from "User-Initiated Mutations Must Use Optimistic Updates" — debouncing delays the server call but does not exempt the function from error handling or rollback.

### Module-Level Timers and Subscriptions Must Be Cleared on Teardown

Every `setTimeout`, `setInterval`, `requestAnimationFrame`, `addEventListener`, or subscription registration at module scope or store scope MUST have a corresponding cleanup in the module's or store's teardown/destroy function. A timer that fires after its owning context is destroyed operates on stale references — this causes silent errors, memory leaks, and test flakiness. When adding a timer or subscription, add the cleanup call in the same commit.

### Continuous-Value Controls Must Coalesce History Entries

Any UI control that fires change events at high frequency during a single user gesture (color picker during drag, slider during drag, canvas transform during drag, numeric scrub) MUST coalesce those events into a single history/undo entry. The pattern: capture the pre-gesture snapshot on gesture start (pointerdown, focus), apply intermediate values to the store without creating history entries, and commit a single history entry on gesture end (pointerup, blur, dialog close). Creating a discrete undo entry per intermediate value floods the undo stack — the user must press Ctrl+Z dozens of times to undo a single drag. This obligation applies to both the client-side history manager and server-side mutations. If the control does not expose gesture start/end events, the implementer must add them or wrap the control to provide them before wiring it to a tracked mutation.

### Imperative Canvas Classes Must Expose a `destroy()` Method

Every class in `frontend/` that lives outside Solid's component tree and registers DOM event listeners, `requestAnimationFrame` loops, or timers MUST expose a `destroy()` method that cancels all rAF handles, removes all event listeners, clears all timers, and sets internal state to a destroyed sentinel. The Solid component that owns the class MUST call `destroy()` in `onCleanup()`.

### Polymorphic Style Setter APIs Must Use Discriminated Unions

Any store function that accepts a style field name and value as separate arguments MUST use a discriminated union type — not `(field: string, value: unknown)`. The discriminated union enforces field-value type relationships at compile time. A `(field: string, value: unknown)` signature is a typed hole.

### Defensive Message Parsing

Every `JSON.parse` call on data from an external source (WebSocket, fetch, postMessage, file read) must be wrapped in try-catch. Parse failures must be handled gracefully — log and discard, never crash the application. After parsing, validate the shape of the parsed object before type-casting. This applies to both frontend TypeScript and any future Node.js code.

### Overlay-Mode Keyboard Handlers Must Use stopPropagation at the Overlay Root

Any component that activates an "overlay edit mode" (text editing, in-place rename, formula input) MUST register a `keydown` handler on the overlay's root element that calls `event.stopPropagation()` for every shortcut it handles locally. Document-level shortcut handlers MUST check `event.defaultPrevented` or rely on propagation being stopped before acting. Do NOT use `document.addEventListener` for shortcuts that should be inactive during overlay modes.

### Symmetric Validation for Reversible Operations

For any operation with an apply/undo pair (commands, transactions, client-side Operations), both directions MUST validate their inputs. If `apply` validates a field before modifying it, `undo` must validate before reverting. Asymmetric validation means undo can corrupt state when applied to a document that has diverged. Additionally, forward and inverse operations MUST use the same field schema. If the forward operation's apply function reads `value.position`, the inverse operation must also provide `value.position` — not `value.oldPosition` or any other renamed field. A renamed field in the inverse silently produces `undefined` when the shared apply function reads the forward field name, causing the operation to no-op or corrupt state. When defining an operation type, define a single value schema and populate it from different sources (forward populates from user intent, inverse populates from the captured snapshot), but never change the field names.

### Error Recovery Must Not Produce User-Visible Side Effects

When an operation fails and the error handler reverts local state, the revert mechanism MUST NOT produce side effects that are visible to the user as new operations. Specifically: error rollback must not create undo entries, redo entries, toast notifications of success, or broadcast events to other clients. If the system's primary revert API (e.g., `undo()`) produces such side effects, the error path must use a dedicated rollback API that suppresses them (e.g., `rollbackLast()`, `revertWithoutHistory()`). The general principle: from the user's perspective, a failed operation that was rolled back should be as if it never happened — no trace in the undo stack, no trace in the redo stack, no trace in the activity log.

### History Commits Must Contain At Least One Operation

Never commit an empty entry to a history/undo stack. Before finalizing a transaction, batch, or compound operation, check that it contains at least one operation. If all operations were skipped (e.g., all targets were missing, all values were unchanged), cancel the transaction instead of committing it. An empty history entry creates a "ghost" undo step — the user presses Ctrl+Z and nothing happens, which breaks their mental model of the undo stack. This applies to both the backend command history and the frontend client-side history manager.

### Business Logic Must Not Live in Inline JSX Handlers

Any logic in a JSX event handler (`onInput`, `onChange`, `onClick`, `onPointerDown`, etc.) that does more than (a) read the event value, (b) call a single named function, or (c) set a single signal/store value MUST be extracted into a named, exported function in a same-concern utility file (e.g., `*-helpers.ts`, `*-utils.ts`). "Business logic" includes: input sanitization, validation, formatting, transformation, computation, and any conditional branching beyond a simple null/undefined guard.

The extracted function:
1. Must be a named export (not a default export) so it is discoverable via import search.
2. Must have at least one unit test that exercises its core behavior and edge cases.
3. Must be imported by all call sites that need the same logic — duplication of the function body across components is a bug, subject to the same reasoning as the Rust rule "inline copies diverge silently."

This rule is the TypeScript counterpart to the Rust convention "Define all validation artifacts in `validate.rs`." Inline anonymous functions in JSX are not independently testable, not discoverable by other developers, and get copy-pasted when the same logic is needed elsewhere.
