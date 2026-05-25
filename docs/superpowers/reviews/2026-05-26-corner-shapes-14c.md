# PR #64 / Plan 14c — Review Findings

**PR:** https://github.com/Evanion/sigil/pull/64
**Branch:** `feature/corner-shapes-14c`
**Date:** 2026-05-26
**Reviewers dispatched:** Architect, Security, Logic (BE), Compliance, Data Scientist, FE, A11y, UX, BE code quality

**Summary:** 0 Critical / 3 High / 4 Major / 5 Medium / 8 Low / 3 Info.

The High findings cluster around a single root cause: per-corner helpers in `corner-path.ts` conflate `rx`/`ry` axis-of-edge selection because every test fixture uses circular `rx === ry`. The Major findings are performance + type-safety opportunities the renderer integration left on the table.

---

## High Severity

### RF-001 — Asymmetric radii (rx ≠ ry) produce incorrect geometry in Bevel, Notch, Superellipse

- **Sources:** Architect (RF-004, RF-005, RF-006, RF-007, RF-015), Logic (L-01, L-02, L-03, L-04), Frontend Engineer (FE-001), Backend Engineer (BE-14c-01, BE-14c-02)
- **Severity:** High
- **Status:** open
- **Locations:**
  - `frontend/src/canvas/corner-path.ts:84` — `appendBevelCorner` exit endpoint uses `rx` on the y-component
  - `frontend/src/canvas/corner-path.ts:178-179` — `appendNotchCorner` entry endpoint uses `ry` for entry-X scalar
  - `frontend/src/canvas/corner-path.ts:190` — `appendNotchCorner` exit endpoint uses `rx` on the y-component
  - `frontend/src/canvas/corner-path.ts:165-169` — `appendSuperellipseCorner` cp1/cp2 swap rx/ry on horizontal-entry/vertical-exit corners
- **Issue:** Each per-corner helper picks rx vs ry by entry/exit role rather than by the axis of the relevant edge. For TL and BR corners this is invisible because the wrong-axis term cancels via `entryDir`/`exitDir` having a zero component. For TR and BL with asymmetric radii (e.g., `{x: 30, y: 10}`), the helper places the endpoint at the wrong distance from the corner-point and the subsequent edge `lineTo` produces a visible discontinuity.

  The orchestrator `appendCornerPath` (lines 422-433) already uses `tr.radii.x` for top-edge distances and `br.radii.y` for right-edge distances correctly. The per-helper convention is inconsistent with the orchestrator's convention.

  Why undetected: every test fixture uses `r === r` (e.g., `bevel(16)` produces `{x:16, y:16}`). The `appendSuperellipseCorner` exit endpoint (line 171-172) is correctly written but the cp1/cp2 path is wrong.
- **Impact:** Any rectangle/frame/image with asymmetric corner radii will render with broken corner geometry — visible gaps or overlaps where the corner meets the straight edge. The data model supports `{x, y}` independently per Plan 14a; this is the rendering side of the same feature.
- **Recommended fix:** In each per-corner helper, derive the on-edge radius from the edge's axis, not the entry/exit role:
  - `appendBevelCorner:84`: `exitStartY = cornerY + exitDirY * ry` (not `rx`)
  - `appendNotchCorner:178`: `entryEndX = cornerX - entryDirX * rx` (not `ry`)
  - `appendNotchCorner:179`: `entryEndY = cornerY - entryDirY * ry` (already correct)
  - `appendNotchCorner:190`: `exitStartY = cornerY + exitDirY * ry` (not `rx`)
  - `appendSuperellipseCorner:165-169`: `cp1X *= rx`, `cp1Y *= ry`, `cp2X *= rx`, `cp2Y *= ry`
  Add regression tests with asymmetric radii (`{x: 30, y: 10}` and `{x: 10, y: 30}`) on TL/TR/BR/BL for all four bevel/notch/scoop/superellipse helpers. The scoop helper is correct because `ctx.ellipse` separates rx/ry natively — verify with the same test.

### RF-002 — Clip-stack drain not exception-safe; ctx.save() state leaks across renders

- **Sources:** Frontend Engineer (FE-002)
- **Severity:** High
- **Status:** open
- **Location:** `frontend/src/canvas/renderer.ts:889-920` (clip stack drain)
- **Issue:** The `while (clipStack.length > 0) { ctx.restore(); ... }` drain is positioned AFTER the node-draw loop. If `drawNode()`, `buildCornerPath()`, `ctx.clip()`, or `ctx.save()` throws inside the loop, control exits `render()` before the drain runs. The caller at `frontend/src/shell/Canvas.tsx:700-704` swallows the throw with `try { renderCanvas(...) } catch { console.error(...) }`, and the next animation frame calls `render()` again. The top of `render()` resets only the transform (line 829) — the save/restore stack is per-context and is NOT reset.

  Each crash that occurred after a `ctx.save()` permanently leaks a save slot. After several crashes, an outer `ctx.restore()` from selection-handle drawing will pop back to a stale state (wrong clip region, wrong transform).
- **Recommended fix:** Wrap the node loop in:
  ```typescript
  try {
    for (const node of nodes) { ... }
  } finally {
    while (clipStack.length > 0) {
      ctx.restore();
      clipStack.pop();
    }
  }
  ```
  Also consider: at the top of every `render()`, run `ctx.restore()` until the canvas state stack returns to a known baseline (tracked via a per-render save-counter). This is defense-in-depth for hypothetical leftover state.

### RF-003 — Missing regression tests for asymmetric radii, MAX_RENDER_DEPTH guard, frame/image fill arms, and clamp-preserves-variant

- **Sources:** Logic (L-05), Backend Engineer (BE-14c-08), Architect (RF-011, RF-012), Security (RF-001)
- **Severity:** High
- **Status:** open
- **Issue:** Several spec-promised tests are missing or under-covered:
  1. **Asymmetric radii** — no test exercises `rx ≠ ry` for any per-corner helper. This is the bug class behind RF-001; tests need to cover all four corner positions (TL/TR/BR/BL) × four shape types (bevel/notch/scoop/superellipse).
  2. **MAX_RENDER_DEPTH on isDescendant** — spec §4.3 promised `test_drawNode_clip_uses_max_render_depth_guard`. The constant is enforced (`renderer.ts:881-884` emits the diagnostic), but no test constructs a 65-deep frame chain or a cycle and asserts the warning fires.
  3. **Frame fill arm + Image fill arm** — only the rectangle arm has a "ctx.fill(Path2D)" assertion. Frame is indirectly covered via the clip tests but the explicit "frame uses path-based fill" assertion is missing.
  4. **Clamping preserves variant tags** — `scaleCorners` reconstructs each Corner variant; a test should verify `[superellipse(40,0.5), bevel(40), notch(40), scoop(40)]` under clamp scale=0.75 produces `[superellipse(30,0.5), bevel(30), notch(30), scoop(30)]` (variants preserved, smoothing preserved).
- **Recommended fix:** Add the missing tests in the RF-001 fix commit. The MAX_RENDER_DEPTH test must spy on `console.warn` and assert the structured payload format.

---

## Major Severity

### RF-004 — Path2D allocated 2× per node and 3× per frame; redundant within drawNode

- **Sources:** Architect (RF-001), Data Scientist (DS-001), UX (UX-14c-05)
- **Severity:** Major
- **Status:** open
- **Locations:**
  - `frontend/src/canvas/renderer.ts:376` (fill path)
  - `frontend/src/canvas/renderer.ts:569` (stroke path)
  - `frontend/src/canvas/renderer.ts:909` (clip path)
- **Issue:** `drawNode` calls `buildCornerPath` once for the fill branch and again for the stroke branch on the same node. `render()` then calls it a third time when pushing the frame's clip. Each call allocates a fresh `Path2D` plus an array of 4 frozen `CornerGeometry` literals plus (when clamping triggers) a fresh `[Corner; 4]`.

  At the 1000-node ceiling (CLAUDE.md §1 budget), ~2100 Path2D + ~8400 geometry literals per frame. Conservative cost estimate: ~2.8 ms/frame on allocation alone. Within budget on desktop but tight headroom for low-end devices.
- **Recommended fix:** Hoist `const path = buildCornerPath(x, y, width, height, node.kind.corners)` once per `drawNode` invocation for corner-bearing kinds; reuse for the fill loop AND the stroke branch. For the clip-push, refactor `drawNode` to return the path (or pass it through a per-render scratch map) so the clip-push site at line 909 reuses the same instance instead of rebuilding.

### RF-005 — `isDescendant` ancestry walk is O(n × d²) worst case; `buildRenderOrder` already provides depth

- **Sources:** Architect (RF-002), Data Scientist (DS-003)
- **Severity:** Major
- **Status:** open
- **Locations:**
  - `frontend/src/canvas/renderer.ts:868-887` (`isDescendant`)
  - `frontend/src/canvas/renderer.ts:898` (pop loop)
  - `frontend/src/canvas/render-order.ts:62-86` (depth available but not exposed)
- **Issue:** The clip-stack pop loop calls `isDescendant(node.uuid, top-of-stack)` to decide whether to pop. Each `isDescendant` walks up to `MAX_RENDER_DEPTH = 64` ancestors. In the pathological case (64-level nesting + many siblings), one transition pops up to 64 frames, each doing a 64-ancestor walk → ~4M comparisons per render. Within budget at MAX_RENDER_DEPTH ceiling but pure waste — `buildRenderOrder` produces DFS-monotone-depth order and already knows each node's depth.
- **Recommended fix:** Add a `depth: number` field to `RenderOrderNode` (or return a parallel `depths: number[]` from `buildRenderOrder`). Clip-stack pop becomes: `while (clipStack.length > node.depth) { ctx.restore(); clipStack.pop(); }`. O(1) amortized, no ancestry walk, no `nodesByUuid` map allocation (RF-004 / DS-004 also resolved).

### RF-006 — `render()` typed as `DocumentNode[]` but requires `RenderOrderNode.parentUuid` at runtime

- **Sources:** Architect (RF-003, RF-009), Frontend Engineer (FE-007)
- **Severity:** Major
- **Status:** open
- **Locations:**
  - `frontend/src/canvas/renderer.ts:815-819` (signature)
  - `frontend/src/canvas/renderer.ts:863-866` (`as RenderOrderNode` cast)
  - `frontend/src/canvas/__tests__/renderer.test.ts:1042-1083, 1153, 1179, 1203, 1231` (test casts)
- **Issue:** The renderer claims to accept `readonly DocumentNode[]` but at runtime requires every entry to carry the optional `parentUuid` field defined on `RenderOrderNode`. The compiler cannot prevent a caller from passing a plain `DocumentNode[]` (no parent info) — the clip stack would silently behave as if every node were a root.

  The test file works around the narrow type by constructing nodes with `parentUuid`/`childrenUuids` and casting `as DocumentNode`. This pattern is the exact "typed hole" CLAUDE.md warns about.
- **Recommended fix:** Widen the parameter to `readonly RenderOrderNode[]`. The single production caller (`shell/Canvas.tsx:157-162`) already constructs the array via `buildRenderOrder` whose return type can be widened to `RenderOrderNode[]`. Remove the runtime `as RenderOrderNode` cast and all the `as DocumentNode` test casts.

### RF-007 — No exhaustiveness sentinel on `drawNode` fill/stroke switches over `NodeKind`

- **Sources:** Frontend Engineer (FE-003)
- **Severity:** Major
- **Status:** open
- **Locations:**
  - `frontend/src/canvas/renderer.ts:368-543` (fill switch)
  - `frontend/src/canvas/renderer.ts:556-577` (stroke switch)
- **Issue:** `frontend-defensive.md` "Discriminated Unions Must Have a Type-Level Exhaustiveness Sentinel" requires every dispatch switch to end with `default: { const _: never = x; ... }`. Both new switches in `drawNode` enumerate all 8 NodeKind variants but have NO default arm. When a new NodeKind variant is added (Plan 14d shape primitives, or future polygon/star kinds), the renderer will silently render nothing — no compile-time signal.

  The `Corner` discriminated union has a type-level test at `frontend/src/types/__tests__/document-corners.test-d.ts`. The equivalent NodeKind sentinel does not exist.
- **Recommended fix:** Add `default: { const _exhaustive: never = node.kind; throw new Error(...) }` to both switches. Add `frontend/src/types/__tests__/document-node-kind.test-d.ts` mirroring the corners test, referencing every set/map that branches on NodeKind.

---

## Medium Severity

### RF-008 — `clampScale` doesn't guard non-finite or non-positive dimensions when called externally

- **Sources:** Security (RF-002), Frontend Engineer (FE-005)
- **Severity:** Medium
- **Status:** open
- **Location:** `frontend/src/canvas/corner-path.ts:312-327` (`clampScale`)
- **Issue:** `clampScale` is `export`ed and tested independently. It does not guard `width <= 0`, `height <= 0`, or NaN. The orchestrator `appendCornerPath` validates first, but a future caller (e.g., a panel that previews clamp ratios) bypassing the orchestrator would propagate degenerate values silently.

  Per CLAUDE.md §11 "Floating-Point Validation": "Any pure function that operates on a numeric value must guard against NaN and infinity at its own entry point" — and "Math Helpers Must Guard Their Domain" applies to exported scalar-domain helpers.
- **Recommended fix:** Add at function entry: `if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;` with a structured `console.warn`. Add a test.

### RF-009 — Frame and Image fill arms uncovered by direct tests

- **Sources:** Backend Engineer (BE-14c-08)
- **Severity:** Medium
- **Status:** open
- **Location:** `frontend/src/canvas/__tests__/renderer.test.ts:900-947` (the new "uses buildCornerPath" tests)
- **Issue:** The new tests only assert the rectangle case (and the group negative case). No direct assertion that `frame.fill = ctx.fill(Path2D)` or `image.fill = ctx.fill(Path2D)`. Frame is exercised indirectly via the clip tests but those assert on `clip(Path2D)`, not on the fill path. Cover overlap with RF-003 (item 3).
- **Recommended fix:** Add "frame node calls ctx.fill(Path2D)" and "image node calls ctx.fill(Path2D)" tests adjacent to the existing rectangle case.

### RF-010 — Two commits use scope outside CLAUDE.md §6 allowlist

- **Sources:** Compliance Checker
- **Severity:** Medium
- **Status:** open
- **Location:** Commits `198d24e` and `d243eab` use `docs(spec-14):` scope. CLAUDE.md §6 allowlist is `{core, server, mcp, frontend, cli, bindings, devops}`.
- **Issue:** Project precedent for cross-cutting spec edits is scopeless `docs:` (or `docs(frontend):` if the change clearly maps to one crate/dir).
- **Recommended fix:** Document the precedent in CLAUDE.md §6 or use the allowed scopes going forward. No history rewrite required for this PR — note for next PR.

### RF-011 — Orphan-node case in clip stack produces silent unclipped render

- **Sources:** UX (UX-14c-06)
- **Severity:** Medium
- **Status:** open
- **Location:** `frontend/src/canvas/renderer.ts:868-887` (`isDescendant`)
- **Issue:** If `buildRenderOrder` ever emits a node missing `parentUuid` while `clipStack.length > 0`, `isDescendant` returns false immediately, the pop loop drains the stack, and the child renders unclipped. The visible symptom is "child of frame leaks outside frame bounds" with NO log entry. CLAUDE.md §11 / `frontend-defensive.md` "Internal Mutation Entry Points Must Diagnose Their Own No-Ops" requires a structured `console.warn` for this defensive case.
- **Recommended fix:** When `clipStack.length > 0` and the node has no `parentUuid` (and didn't match top-of-stack), emit `console.warn("[Canvas] Node has no parent chain but clip stack is non-empty", { nodeUuid, clipStackTop })`.

### RF-012 — Internal corner-path helpers lack their own NaN/Infinity guards

- **Sources:** Architect (RF-010), Security (RF-002, RF-003)
- **Severity:** Medium
- **Status:** open
- **Locations:**
  - `frontend/src/canvas/corner-path.ts:195-268` (`cornerGeometries`)
  - `frontend/src/canvas/corner-path.ts:330-353` (`scaleCorners`)
  - `frontend/src/canvas/corner-path.ts:65-192` (per-corner appenders)
- **Issue:** Per CLAUDE.md §11 Floating-Point Validation: "Any pure function that operates on a numeric value must guard against NaN and infinity at its own entry point — do not assume an upstream caller already validated." Internal helpers currently rely on `appendCornerPath` having run `validateDimensions`/`validateCornerRadii`. They are exported, so a direct call from a future caller (debug tool, test, future shape editor) would propagate NaN silently into Path2D operations the browser ignores.
- **Recommended fix:** Add Number.isFinite guards at the entry of each exported helper, OR un-export the per-corner helpers (keep them module-private) and document the chosen approach. Lean toward un-exporting since they're only used by tests; tests can import via a test-only entry point if needed.

---

## Low Severity

### RF-013 — Notch JSDoc block is orphaned

- **Sources:** Frontend Engineer (FE-004)
- **Severity:** Low
- **Status:** open
- **Location:** `frontend/src/canvas/corner-path.ts:88-98`
- **Issue:** Lines 88-98 are the Notch JSDoc, but the next function declared (line 111) is `appendScoopCorner`, not `appendNotchCorner` (which lives at line 176 with a shorter inline comment). IDEs attach the docstring to the wrong function.
- **Recommended fix:** Move lines 88-98 above `appendNotchCorner` at line 176.

### RF-014 — Test fixture casts (resolved by RF-006)

- **Sources:** Architect (RF-009)
- **Severity:** Low (subsumed by RF-006)
- **Status:** open

### RF-015 — Superellipse v1 constants lack calibration-status comment

- **Sources:** Architect (RF-008), Data Scientist (DS-005)
- **Severity:** Low
- **Status:** open
- **Location:** `frontend/src/canvas/corner-path.ts:23-30` (constants)
- **Issue:** `BLEED_AT_S0 = 1.0` and `BLEED_AT_S1 = 1.5` are hand-tuned. Spec §3.7 acknowledges calibration deferred to Plan 14d, but the code itself has no marker linking to that deferral. A future contributor "fixing" these to convenient round numbers would not realize they're calibration anchors.
- **Recommended fix:** Add a `// CALIBRATION: v1 anchor — see spec §3.7. Recompute against iOS/Figma reference in Plan 14d.` comment.

### RF-016 — getEffectiveTransform called 2-3× per selected node (out-of-scope perf polish)

- **Sources:** Architect (RF-014)
- **Severity:** Low
- **Status:** open (out of scope for 14c)

### RF-017 — corner-path.ts over-exports test-only helpers

- **Sources:** Backend Engineer (BE-14c-05)
- **Severity:** Low
- **Status:** open
- **Recommended fix:** Either document `// Exported for testing only — use buildCornerPath in production` or move helpers to `corner-path-internal.ts`.

### RF-018 — `clampScale` name is ambiguous

- **Sources:** Backend Engineer (BE-14c-06)
- **Severity:** Low
- **Status:** open
- **Recommended fix:** Rename to `computeRadiusFitScale` or similar. Affects test-only callers.

### RF-019 — PathRecorder.ellipse coerces counterclockwise bool→number

- **Sources:** Architect (RF-013)
- **Severity:** Low
- **Status:** open
- **Recommended fix:** Either preserve the bool or document the `args[7] = 0|1` convention.

### RF-020 — vitest.setup.ts Path2D shim uses wider cast than other shims

- **Sources:** Frontend Engineer (FE-008)
- **Severity:** Low
- **Status:** open

### RF-021 — `isDescendant` diagnostic text conflates cycle with depth-exhausted finite walk

- **Sources:** Frontend Engineer (FE-006)
- **Severity:** Low
- **Status:** open
- **Recommended fix:** Change warning text to "ancestry walk reached MAX_RENDER_DEPTH (possible cycle or extreme nesting)".

---

## Info / Pre-disclosed

### RF-022 — Superellipse v1 visual calibration deferred to Plan 14d

- **Sources:** UX (UX-14c-01), Data Scientist (DS-005)
- **Severity:** Info
- **Status:** deferred (spec §3.7, PR description item 5)

### RF-023 — Frame `clip_contents` toggle not in scope

- **Sources:** UX (UX-14c-02)
- **Severity:** Info
- **Status:** deferred (no spec for this; flag for future product decision)

### RF-024 — No accessibility regressions

- **Sources:** A11y (A11Y-001 through A11Y-005)
- **Severity:** Info
- **Status:** resolved (no a11y surface added; new affordances correctly deferred to Plan 14d)

---

## Items Verified Correct (no finding)

- Scoop direction (CCW sweep on ellipse, endpoints align with round corners) — Logic (L-scoop-1)
- clampScale per-edge sums + global min — Logic (L-clamp-1, L-clamp-2)
- Superellipse bleed interpolation algebra — Logic (L-bleed-1), Data Scientist (DS-005 numerics)
- isDescendant edge cases (self-as-descendant, missing nodes, undefined parentUuid) — Logic (L-isDescendant-1)
- Clip-stack drain at end of loop including sibling-of-frame scenario — Logic (L-clipdrain-1)
- Path2D shim satisfies `instanceof Path2D` — Logic (L-shim-1), FE
- Multi-fill rectangle calling ctx.fill twice — Logic (L-fillmulti-1)
- Stroke path uses fill path geometry with center alignment — Logic (L-strokepath-1)
- Path2D shim does not conflict with production paths — BE (BE-14c-11)
- corner-path.ts avoids NodeKind/DocumentNode coupling — BE (BE-14c-09)
- isDescendant recovery (returns false at MAX_RENDER_DEPTH → outer loop pops, no permanent stuck state) — BE (BE-14c-10)
- `aria-label` and `role="application"` preserved on canvas — A11y (A11Y-001)
- Clipped children remain in accessibility tree via Layers panel — A11y (A11Y-002)
- No new CSS animations — A11y (A11Y-003)
- No new keyboard/pointer interactions — A11y (A11Y-004)
- Selection highlight renders unclipped (correct) — UX (UX-14c-03)
- Group does not push a clip (matches Figma) — UX (verified across reviewers)
- Per-corner helpers allocate zero objects per call — Data Scientist (DS-006)

---

## Remediation Plan (proposed)

**Must resolve before merge (High):**
1. RF-001 — Fix bevel/notch/superellipse axis selection; add asymmetric-radii tests.
2. RF-002 — Wrap render loop in try/finally for clip-stack drain.
3. RF-003 — Add the four missing test categories (covered by RF-001 + RF-009 fixes + dedicated MAX_RENDER_DEPTH test + clamp-preserves-variant test).

**Resolve in same PR (Major):**
4. RF-004 — Hoist `path` once per drawNode; reuse for fill + stroke + clip-push.
5. RF-006 — Widen render() parameter to `RenderOrderNode[]`; remove all type casts.
6. RF-007 — Add exhaustiveness sentinels on drawNode switches + NodeKind type-test.
7. RF-005 — Replace `isDescendant` ancestry walk with depth-tracking. (Larger change — could defer to a 14d/perf follow-up if RF-001/004 PR risk grows too large.)

**Resolve in same PR (Medium):**
8. RF-008 — Add Number.isFinite + positive-dim guard to `clampScale`.
9. RF-009 — Add frame + image fill arm tests (overlaps with RF-003 item 3).
10. RF-011 — Add orphan-node console.warn in isDescendant.
11. RF-012 — Either guard internal helpers or un-export them.
12. RF-010 — Note for future PRs; no history rewrite.

**Resolve in same PR (Low):**
13. RF-013 — Move Notch JSDoc.
14. RF-015 — Add calibration-status comment.
15. RF-017 — Document test-only exports.
16. RF-018 — Rename `clampScale` to `computeRadiusFitScale`.
17. RF-019 — Document PathRecorder.ellipse convention.
18. RF-020 — Tighten Path2D shim cast.
19. RF-021 — Refine isDescendant warning text.

**Deferred (Info):**
20. RF-022 — Plan 14d Storybook calibration.
21. RF-023 — Future product decision on clip_contents toggle.
22. RF-024 — Already resolved (no a11y regressions).
23. RF-014 — Subsumed by RF-006.

**RF-016** (getEffectiveTransform per-node 2-3× call) — Out-of-scope perf polish; file as 14d/perf follow-up.
