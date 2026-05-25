# Frontend Defensive Coding Rules

These rules apply to all frontend code in `frontend/` — Solid.js reactivity, store management, history/undo, optimistic updates, and DOM lifecycle. They are extracted from CLAUDE.md Section 11 and carry the same enforcement weight.

---

### Reactive Pipelines Must Be Verified End-to-End

When a value flows from a producer (signal, computed memo, callback prop, store field) to a renderer or side-effecting consumer, the connection MUST be verified by a test that exercises the full path: trigger the producer, assert the consumer's output. A pipeline that compiles and type-checks but whose downstream consumer receives a voided or disconnected value is a silent no-op — the compiler cannot detect broken wiring. This pattern recurs: a signal read but assigned to `_` or not forwarded; a callback prop defined but never passed to the child; a store field populated but the renderer reads a different field. Every new reactive connection introduced in a PR must have at least one integration or component test that asserts the consumer receives and acts on the value. Unit-testing the producer in isolation is not sufficient — the wiring itself must be tested.

### Display Layers Must Preserve User Intent Across Lossy Transforms

When a UI control displays a value that is derived from stored state via a lossy or non-bijective transform (HSL↔sRGB where achromatic colors collapse hue, OkLCH↔sRGB with gamut clipping, font-weight keyword↔numeric mapping, line-height unit coercion, angle modulus normalization), the component MUST carry a "last-typed" cache alongside the derived display value. When the derived value is in the collapsed/lossy region, the display and edit handlers MUST read from the cache instead of re-deriving, and MUST update the cache from user input.

A reactive display that re-derives every render will re-collapse the user's typed value on the next tick, erasing their edit before the commit ever reaches the store. The compiler cannot detect this — every individual link in the reactive chain works; the bug is in the round-trip. This pattern is distinct from "reactive wiring" bugs.

Checklist for any new display↔storage transform:
1. Identify every coordinate in the display space whose inverse image under the storage→display transform has cardinality > 1 (the "collapsed region" — e.g., H is undefined when S=0).
2. Store the last user-supplied value for each such coordinate in component-local state.
3. When reading for render, use the cached value if the derived value falls in the collapsed region.
4. Add a regression test: enter a value in the collapsed region, assert that the displayed value on the next render matches the entry (not the round-tripped collapse).

Precedent: RF-D01 (PR #57 color picker — HSL hue/saturation lost on achromatic colors).

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

### Effects That Call Helper Functions Inherit the Helper's Reactive Reads

Solid's `createEffect` tracks every reactive read that occurs during the effect's execution, including reads inside functions called transitively. An effect written as `createEffect(() => { const _ = props.value; helperFn(); })` does NOT track only `props.value` — if `helperFn()` reads signals or store fields, the effect subscribes to those too and re-runs whenever any of them change. This silently breaks intended "run only when X changes" semantics.

Specifically, never call a function from inside an effect when the function:
1. Reads signals, stores, or memos that are NOT the intended trigger for the effect, AND
2. Fires external side effects (callback props, event emission, network calls, history commits).

The correct pattern is to separate the two concerns:
- One function reads only non-reactive state or the intended trigger and performs state mirroring (e.g., `announceCommit()` — updates an internal signal for SR announcements).
- A second function performs the external side effect (e.g., `commitColor()` — calls `props.onCommit`).

The effect calls only the first. The second is invoked exclusively from explicit user-event handlers (pointerup, blur, Enter). This keeps the side-effect path under the caller's control and out of the reactive graph.

If a helper function must be called from both an effect and a user-event handler, factor the reactive reads into a pre-computed argument that the caller passes in, so the helper body contains no reactive reads.

### Imperative Canvas Classes Must Expose a `destroy()` Method

Every class in `frontend/` that lives outside Solid's component tree and registers DOM event listeners, `requestAnimationFrame` loops, or timers MUST expose a `destroy()` method that cancels all rAF handles, removes all event listeners, clears all timers, and sets internal state to a destroyed sentinel. The Solid component that owns the class MUST call `destroy()` in `onCleanup()`.

### Polymorphic Style Setter APIs Must Use Discriminated Unions

Any store function that accepts a style field name and value as separate arguments MUST use a discriminated union type — not `(field: string, value: unknown)`. The discriminated union enforces field-value type relationships at compile time. A `(field: string, value: unknown)` signature is a typed hole.

### Default-Value Factories for Mutable Containers Must Construct Independent Instances

Any function returning a default instance of a mutable container (array, object with mutable nested objects) MUST construct each element with a fresh allocation. The shorthand `Array(n).fill(x)`, `[x, x, x, x]`, or `Array.from({length: n}, () => x)` where `x` is itself an object produces N references to the SAME object — mutating one element mutates all of them. This is a latent footgun for any future positional in-place mutation, even if today's callers happen to treat the array as immutable.

Pattern: `Array.from({length: n}, () => makeFresh())` where `makeFresh` allocates the nested object too — NOT `Array(n).fill(makeOnce())`. Every default-factory function MUST have a test that asserts `result[i] !== result[j]` for at least one pair of distinct indices AND, for arrays of objects with nested mutable fields, asserts that `result[i].nestedField !== result[j].nestedField`. A docstring claim of "fresh tuple, callers may mutate without aliasing" is not enforcement — the test is.

Applies equally to Rust factory functions returning `[T; N]` of types containing `Box`, `Vec`, or other heap-allocated content (`Vec::clone` on each element is correct; `[v.clone(); N]` evaluates `v.clone()` once and then bit-copies — incorrect for types containing `Rc`/`Arc` if interior mutability is in play). Applies equally to shorthand parsers that synthesize an array of N defaults from a scalar or partial-object input.

### Discriminated Unions Must Have a Type-Level Exhaustiveness Sentinel

Every TypeScript discriminated union used for runtime dispatch (`Corner`, `Fill`, `Effect`, `NodeKind` mirror, any `type X = A | B | C` with a discriminant field) MUST have a colocated type-level test that exhaustively switches on the discriminant and ends with a `default: const _exhaustive: never = x;` sentinel. The test goes in a `.test-d.ts` file (vitest type-test) so adding a new variant without updating downstream dispatch sites fails `tsc --noEmit` rather than silently shipping a runtime no-op.

Pattern:

```ts
function _cornerExhaustive(c: Corner): string {
  switch (c.type) {
    case 'round': return 'round';
    case 'bevel': return 'bevel';
    case 'notch': return 'notch';
    case 'scoop': return 'scoop';
    case 'superellipse': return 'superellipse';
    default: { const _x: never = c; return _x; }
  }
}
```

The exhaustiveness sentinel must include every set/map/array that branches on the discriminant — `VALID_CORNER_TYPES`, `CORNER_BEARING_KINDS`, renderer dispatch tables — by referencing them in the test body so a new variant fails the test if any one of them is out of date.

**CI enforcement:** A grep step in CI MUST verify that every `export type X = ...` discriminated union in `frontend/src/types/` has a colocated test-d file at `frontend/src/types/__tests__/<name>.test-d.ts`. A discriminated union without a sentinel file fails CI. Precedent: PR #64 (Plan 14c) — `NodeKind` had no sentinel file even though `Corner` did; the renderer's `drawNode` switches over NodeKind would have silently rendered nothing for a new variant. The gap went undetected for the lifetime of the union.

**Runtime coverage obligation:** The sentinel proves every arm exists at compile time; it does NOT prove every arm produces the intended runtime behavior. When a function adds or expands a switch over a discriminated union, every variant arm MUST have at least one direct test assertion against the new call site. A test that exercises only one arm and trusts the sentinel for the others does not satisfy this — sentinels enforce presence, not correctness. Precedent: PR #64 — `drawNode` added fill switches over all 8 NodeKind variants but only the rectangle arm had a direct `ctx.fill(Path2D)` assertion; frame and image arms were uncovered until remediation added explicit tests.

### Tests for Multi-Axis Inputs Must Cover Non-Degenerate Cases

When a function accepts an input value with N independent axes that can take different values (e.g., `{x, y}` radius pair, `{width, height}` dimensions, 2D coordinates, matrix entries, per-channel color), at least one test fixture MUST exercise the case where the axes differ from each other. A test suite where every fixture sets `x === y` (or `width === height`, etc.) is biased toward the degenerate subset of the input domain, and bugs in axis selection — picking the wrong axis based on role rather than identity — are invisible to it.

Required coverage when a type permits axis-independent values:
1. At least one fixture where each pair/tuple of independent axes has **distinct** values (e.g., `{x: 30, y: 10}` not `{x: 16, y: 16}`).
2. At least one fixture where the axis assignment is **swapped** relative to (1) (e.g., `{x: 10, y: 30}`).
3. The test must assert axis-specific output, not just "the function returned something."

This applies whether the type is in Rust (`Vec2`, `Size`, `RadiusPair`) or TypeScript (any `{x, y}` or `{width, height}` shape). When adding a new type with axis-independent fields, add the asymmetric-fixture obligation to its test file alongside the basic cases.

Precedent: PR #64 (Plan 14c) — every corner-radius test fixture used `{x: r, y: r}`; per-corner helpers picked `rx` vs `ry` by entry/exit role instead of edge axis. Three independent helpers (Bevel, Notch, Superellipse) shipped wrong geometry, and the bug was invisible to the entire test suite until asymmetric fixtures were added during remediation.

### Imperative Push/Pop Stacks Must Drain via try-finally

The "Temporary State Flags Must Use try-finally" rule (CLAUDE.md §11) extends to any imperative API exposing a `push`/`pop` (or `save`/`restore`, `begin`/`end`, `acquire`/`release`) pair where the pop is owed by the caller. Canvas 2D `ctx.save()`/`ctx.restore()`, WebGL state, audio context state, and any custom imperative stack maintained alongside it MUST drain in a `finally` block that wraps the entire push-into-stack scope.

If a loop body pushes onto a stack and a subsequent loop iteration is expected to pop, an exception inside the loop skips every pending pop and leaks state across renders. A drain placed at the bottom of the function does NOT cover this — the parent caller's `try/catch` swallows the throw, calls the function again on the next frame, and operates on a corrupted stack.

Pattern:

```typescript
try {
  for (const item of items) {
    ctx.save();
    stack.push(item);
    drawItem(item); // may throw
  }
} finally {
  while (stack.length > 0) {
    ctx.restore();
    stack.pop();
  }
}
```

Precedent: PR #64 (Plan 14c) — the clip-stack drain was positioned AFTER the node-draw loop. A throw inside `drawNode` skipped the drain; the parent caller's `try/catch` in `Canvas.tsx` resumed rendering on the next animation frame with `ctx.save()` slots permanently leaked, corrupting all subsequent renders.

### Defensive Message Parsing

Every `JSON.parse` call on data from an external source (WebSocket, fetch, postMessage, file read) must be wrapped in try-catch. Parse failures must be handled gracefully — log and discard, never crash the application. After parsing, validate the shape of the parsed object before type-casting. This applies to both frontend TypeScript and any future Node.js code.

### Internal Mutation Entry Points Must Diagnose Their Own No-Ops

Every store function or remote-operation handler that can early-return without mutating MUST emit a `console.warn` (for invariant-class no-ops) or `console.error` (for type-system invariant violations) identifying the rejection cause, the target entity, and a structured payload of the relevant context. Examples that require a diagnostic:

- Target node missing from store (e.g., `setCorners` called with stale uuid).
- Target kind does not accept the field (e.g., `setCorners` on a Text node).
- Input failed shape parsing (e.g., `parseCornersInput` returns null).
- Broadcast handler rejects payload after validation (every early-return in `apply-remote.ts`).
- Discriminated-union narrowing fallback fires (e.g., `??` default for a field the type system says must be present).

"It compiled and ran but did nothing" is the worst diagnostic outcome of a remote-operation pipeline — there is no error trail in production and no test failure in development. The warn/error message MUST be structured (an object payload, not a sentence) so it can be queried and aggregated in logs. Mirrors the CLAUDE.md §11 "No Silent Clamping" rule for the **receiving** side of an internal API.

### Overlay-Mode Keyboard Handlers Must Use stopPropagation at the Overlay Root

Any component that activates an "overlay edit mode" (text editing, in-place rename, formula input) MUST register a `keydown` handler on the overlay's root element that calls `event.stopPropagation()` for every shortcut it handles locally. Document-level shortcut handlers MUST check `event.defaultPrevented` or rely on propagation being stopped before acting. Do NOT use `document.addEventListener` for shortcuts that should be inactive during overlay modes.

### Symmetric Validation for Reversible Operations

For any operation with an apply/undo pair (commands, transactions, client-side Operations), both directions MUST validate their inputs. If `apply` validates a field before modifying it, `undo` must validate before reverting. Asymmetric validation means undo can corrupt state when applied to a document that has diverged. Additionally, forward and inverse operations MUST use the same field schema. If the forward operation's apply function reads `value.position`, the inverse operation must also provide `value.position` — not `value.oldPosition` or any other renamed field. A renamed field in the inverse silently produces `undefined` when the shared apply function reads the forward field name, causing the operation to no-op or corrupt state. When defining an operation type, define a single value schema and populate it from different sources (forward populates from user intent, inverse populates from the captured snapshot), but never change the field names.

### Error Recovery Must Not Produce User-Visible Side Effects

When an operation fails and the error handler reverts local state, the revert mechanism MUST NOT produce side effects that are visible to the user as new operations. Specifically: error rollback must not create undo entries, redo entries, toast notifications of success, or broadcast events to other clients. If the system's primary revert API (e.g., `undo()`) produces such side effects, the error path must use a dedicated rollback API that suppresses them (e.g., `rollbackLast()`, `revertWithoutHistory()`). The general principle: from the user's perspective, a failed operation that was rolled back should be as if it never happened — no trace in the undo stack, no trace in the redo stack, no trace in the activity log.

This obligation extends to optimistic updates. When a mutation uses the optimistic update pattern (apply locally, then send to server), and the server call fails, the error handler MUST remove the undo entry that was created for the optimistic local change before reverting the store. A rollback that reverts the store but leaves the undo entry produces a ghost undo step — the user presses Ctrl+Z and the operation appears to succeed (the entry is popped) but nothing changes (the state was already reverted). The rollback API must support entry removal without triggering a new undo/redo cycle.

### History Commits Must Contain At Least One Operation

Never commit an empty entry to a history/undo stack. Before finalizing a transaction, batch, or compound operation, check that it contains at least one operation. If all operations were skipped (e.g., all targets were missing, all values were unchanged), cancel the transaction instead of committing it. An empty history entry creates a "ghost" undo step — the user presses Ctrl+Z and nothing happens, which breaks their mental model of the undo stack. This applies to both the backend command history and the frontend client-side history manager.

### Business Logic Must Not Live in Inline JSX Handlers

Any logic in a JSX event handler (`onInput`, `onChange`, `onClick`, `onPointerDown`, etc.) that does more than (a) read the event value, (b) call a single named function, or (c) set a single signal/store value MUST be extracted into a named, exported function in a same-concern utility file (e.g., `*-helpers.ts`, `*-utils.ts`). "Business logic" includes: input sanitization, validation, formatting, transformation, computation, and any conditional branching beyond a simple null/undefined guard.

The extracted function:
1. Must be a named export (not a default export) so it is discoverable via import search.
2. Must have at least one unit test that exercises its core behavior and edge cases.
3. Must be imported by all call sites that need the same logic — duplication of the function body across components is a bug, subject to the same reasoning as the Rust rule "inline copies diverge silently."

This rule is the TypeScript counterpart to the Rust convention "Define all validation artifacts in `validate.rs`." Inline anonymous functions in JSX are not independently testable, not discoverable by other developers, and get copy-pasted when the same logic is needed elsewhere.

### Kobalte Imports Must Live in `components/` Wrappers

All `@kobalte/core/*` imports MUST live inside `frontend/src/components/<wrapper>/` directories. Consumer code (panels, canvas, tools, stores, shells) imports from the project wrapper (e.g., `import { Slider } from "../components/slider/Slider"`), never directly from `@kobalte/core/*`.

**Why:** Direct Kobalte imports scattered across the app create silent drift — when interaction fixes, a11y improvements, or styling updates land on a wrapped primitive, call sites that bypassed the wrapper never get those updates. Wrapping ensures every improvement applies everywhere.

**How to apply:**
- When adding a new Kobalte primitive, create a wrapper at `frontend/src/components/<name>/<Name>.tsx` that re-exports the project API.
- When consuming a Kobalte primitive from any non-`components/` file, import from the project wrapper.
- The wrapper is responsible for: applying the project's Number.isFinite guards on numeric callbacks, exposing gesture-start/end events for history coalescing (when applicable), enforcing the project's CSS naming convention (`sigil-*` prefix), and respecting `prefers-reduced-motion` on any transitions.
- A direct import from `@kobalte/core/*` anywhere outside `frontend/src/components/` is a bug. Enforced by a CI grep (see `.github/workflows/ci.yml` "kobalte-import-discipline" step).
