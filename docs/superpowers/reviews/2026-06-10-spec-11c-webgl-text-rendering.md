# Review Findings — Spec 11c WebGL Text Rendering

**Target:** `docs/superpowers/specs/2026-06-10-11c-webgl-text-rendering.md`
**Date:** 2026-06-10
**Mode:** Spec review (full reviewer panel — Architect, Security, BE, Logic, Compliance, Data Scientist, FE, A11y, UX, DevOps)
**Reviewed revision:** the spec as revised after round-1 evaluation. That revision already corrected: `MAX_FONT_SIZE` value (line 18), `TextKind`→`NodeKind::Text` (line 54), `NodeKindText` (line 57), added a "frontend, not core" intent line (line 7), removed the persisted `rendering_mode`/`feature_flags` fields in favor of a "no new fields" rationale (lines 71–76), and added a References-to-11a/11b section (lines 137–143). The findings below are the second-tier issues that survived or were introduced by that revision. All reported at reviewer confidence ≥ 80, deduplicated across the panel and validated against the live file.

**Verdict:** Not ready for implementation. The four Criticals interlock around one unmade decision — *where do OpenType feature settings live?* Resolving RF-001 (persist them on `TextStyle` with the full transport inventory) and RF-004 (canvas topology) makes most of the rest mechanical. RF-002 ("render identically" impossibility) and RF-003 (canvas text alternative for assistive tech) need explicit design answers.

**Tally:** 4 Critical · 9 High · 14 Medium · 3 Minor.

---

## Critical

### RF-001 — "No new persisted fields" contradicts the OpenType-feature acceptance criteria
- **Status:** open
- **Sources:** Architect, Security, BE, Logic, Data Scientist, FE, UX, Compliance
- **Location:** lines 71–76 (Cross-Stack Type Extension Inventory, "does NOT extend… not persisted") vs. lines 108, 110 (acceptance: "OpenType feature toggles in typography panel", "Parity with CSS `font-feature-settings`").
- **Description:** Keeping *render-mode* out of the document is the correct call. But *selected OpenType features* are user intent and document content (like `font_weight` / `letter_spacing` already on `TextStyle`) — they must persist and round-trip through save/load, GraphQL, MCP, and broadcast. As written, either the toggles don't survive reload, or an agent toggling a ligature via MCP never broadcasts to human clients (violates CLAUDE.md §1 "agents and humans see each other's changes in real time"). This makes the four "NO CHANGE" transport rows (RF-005) false for the feature-settings case.
- **Recommended fix:** Split the two concepts explicitly. (1) Render backend = runtime, not persisted (keep, add a receipt). (2) OpenType feature settings = new persisted field on `TextStyle` (e.g. `font_features: Vec<FeatureSetting>`) with the full §10 Transport Boundary Inventory: Rust `node.rs` field + `validate.rs` rules, TS `document.ts` mirror, GraphQL resolver, `apply-remote.ts` handler, MCP tool, persistence, and a `tests/fixtures/parity/` fixture (see RF-025). If feature settings are deferred, move lines 108/110 to Future Considerations.

### RF-002 — "All existing documents render identically" is unachievable
- **Status:** open
- **Sources:** Logic, UX, BE
- **Location:** line 118 vs. line 37 (Canvas-2D fallback) and lines 89–92 (SDF/WebGL pipeline).
- **Description:** SDF/WebGL and Canvas-2D `fillText` use different rasterization (AA model, hinting, subpixel, gamma) — pixel parity is not achievable. Worse, the fallback re-shapes text through a *different engine* than HarfBuzz, changing advances/kerning/line breaks → paragraph **reflow**. The "identical" criterion and the "graceful fallback" design are mutually exclusive.
- **Recommended fix:** Make HarfBuzz the single source of truth for *measurement/layout* regardless of which backend paints pixels, so geometry is stable and only raster quality differs. Restate the criterion as "equivalent layout and visually faithful output; pixel-exact parity with Canvas-2D is explicitly NOT a goal," and define a visual-regression tolerance + method.

### RF-003 — WebGL canvas text has no text alternative for assistive technology
- **Status:** open
- **Sources:** A11y
- **Location:** lines 5–8 (Overview), Phase 2 lines 89–92, acceptance line 118.
- **Description:** A WebGL `<canvas>` is an opaque bitmap to AT. Moving text to SDF glyphs makes every text node's `content` invisible to screen readers unless a text alternative is defined. The "render identically" criterion is visual-only and would pass while silently regressing SR access to all canvas text (WCAG 1.1.1, 1.3.1).
- **Recommended fix:** Add an Accessibility section requiring a defined text-alternative mechanism (e.g. a synchronized visually-hidden DOM mirror of text nodes, or an accessibility-tree representation of the design tree) plus an acceptance criterion + test: "a screen reader can read the content of every text node rendered by the WebGL path."

### RF-004 — "Hybrid" canvas topology is undefined (and per-node switching breaks consistency)
- **Status:** open
- **Sources:** FE, UX
- **Location:** Overview line 5 ("hybrid approach"), Phase 4 line 101 ("automatic switching… per feature requirements").
- **Description:** A single `HTMLCanvasElement` cannot hold both a `2d` and a `webgl` context (`getContext` is one-shot per element). The current pipeline interleaves text with clip-stacked frames and z-ordered fills, so text is not a separable top layer; an overlay canvas would break z-order and frame clipping. The spec never states whether WebGL and 2D share one canvas, stack two, or composite offscreen — the load-bearing gap. Per-node renderer selection also makes adjacent text nodes (one with a ligature, one without) visibly mismatch in weight/sharpness with no property the designer set (UX-1).
- **Recommended fix:** Specify the canvas topology explicitly and address z-order/clip interleaving (and the WebGL→`drawImage` readback cost if compositing into the 2D pipeline). Do not select renderer per-node by feature use: route all text through one backend per view (WebGL when available, Canvas-2D as a document-wide fallback only), so no two text nodes in a viewport use different backends.

---

## High

### RF-005 — Transport "NO CHANGE" entries lack §10 receipts; `apply-remote.ts` mislabeled
- **Status:** open · **Sources:** Compliance, Architect, Data Scientist
- **Location:** lines 60–69.
- **Description:** §10 requires every "No code change" entry to carry a machine-verifiable receipt (sentinel guard, reproducible `rg` + output, or e2e smoke test). All four entries assert "NO CHANGE" with prose only. Line 64 labels `apply-remote.ts` a "WebSocket broadcast path" — the live transport is GraphQL subscriptions; `apply-remote.ts` is the frontend remote-op dispatcher. (If RF-001 resolves toward persistence, these entries become "changed," not "no change".)
- **Recommended fix:** For each genuinely-unchanged path, quote the reproducible `rg` enumeration with empty/accounted-for output, or add an exhaustiveness sentinel. Correct the transport label to "GraphQL subscription broadcast."

### RF-006 — Asserted limits have no constant, enforcement point, or test
- **Status:** open · **Sources:** Security, BE, Compliance, Data Scientist
- **Location:** lines 20–21 ("50 features per text node", "10,000 glyphs maximum").
- **Description:** Bare numbers with no named `MAX_*` constant, no enforcement boundary, no `test_*_enforced`. Violates §11 "Constants Must Be Enforced" / "Constant Enforcement Tests." The feature-count cap, if features persist, must be enforced symmetrically across core + GraphQL + MCP + frontend store.
- **Recommended fix:** Name each (`MAX_FONT_FEATURES_PER_NODE`, `MAX_CACHED_GLYPHS`/`MAX_GLYPH_ATLAS_BYTES`), site in `validate.rs` (and the shared TS validation module for frontend-runtime caps), specify the typed error, and require a real rejection test per constant.

### RF-007 — Glyph cache has no memory budget and no eviction policy
- **Status:** open · **Sources:** Data Scientist, Architect
- **Location:** lines 21, 48, 116.
- **Description:** The cap is by glyph *count*, not bytes — the dimension that matters under "limited container resources." SDF atlas at 64×64 R8 ≈ 4 KB/glyph → ~40 MB for 10k; MSDF (RGBA) ≈ 120–160 MB. Behavior at glyph 10,001 is undefined (reject? LRU? clear?), and a Latin+CJK+emoji document exceeds 10k distinct glyphs in normal use at the 1000-node target, so eviction *will* fire.
- **Recommended fix:** Replace the count cap with `MAX_GLYPH_ATLAS_BYTES` (recommend 64 MB = one 8192×8192 R8 page), state the SDF channel format, atlas dimensions, and max page count. Specify LRU eviction keyed on `(font, glyph, size_bucket, feature_set)` with an atlas free-list, plus an enforcement test.

### RF-008 — Residual core-boundary contradiction
- **Status:** open · **Sources:** Architect, FE
- **Location:** line 100 ("Connect renderer abstraction to **document engine**"), line 80 ("renderer abstraction"), vs. line 7 (frontend-only).
- **Description:** Line 7 states the work is frontend-only, but Phase 4 line 100 says "connect to the document engine" (= `sigil-core`). Any renderer interface / SDF / HarfBuzz / WebGL / glyph cache in `crates/` violates the non-negotiable §1/§4 core constitution.
- **Recommended fix:** State explicitly that the `TextRenderer` abstraction and all renderer code live in `frontend/src/canvas/` and NONE in any `crates/` member; the renderer reads the materialized `NodeKindText` from the frontend store. Remove "engine" wherever it implies core.

### RF-009 — No `destroy()` / `onCleanup` lifecycle contract for WebGL resources
- **Status:** open · **Sources:** FE
- **Location:** Phase 2 lines 89–92 (spec is silent).
- **Description:** WebGL context + regl + shader programs + SDF atlas are imperative GPU resource holders outside Solid's tree. The frontend-defensive "Imperative Canvas Classes Must Expose a `destroy()`" rule is mandatory (the project already follows it in `text-overlay.ts`). Without it, every document switch/HMR/unmount leaks a GL context (browsers cap ~16, then drop the oldest).
- **Recommended fix:** Require a `WebGLTextRenderer` class with `destroy()` (lose-context, dispose regl resources, free atlas textures, cancel rAF/timers) called from the owning component's `onCleanup`; add to Consistency Guarantees.

### RF-010 — Missing CSS-significant-character validation for feature/font strings
- **Status:** open · **Sources:** Security, BE
- **Location:** Input Validation (lines 16–21), Phase 3 lines 95–97, acceptance line 110.
- **Description:** OT feature tags and `font-feature-settings` values are interpolated into CSS / `ctx.font`. The rust-defensive "CSS-Rendered String Fields Must Reject CSS-Significant Characters" rule requires validation at both input arrival and output use. The spec mentions neither; font-family is already an unguarded `String` today.
- **Recommended fix:** Add a `FONT_FEATURE_TAG` allowlist (OT tags are exactly 4 ASCII `[A-Za-z0-9]`) + value range, apply the font-family denylist at input, and require an output-time validation call immediately before any `ctx.font` / `font-feature-settings` interpolation. Add enforcement tests.

### RF-011 — No dependency versions/pinning or WASM-artifact provenance
- **Status:** open · **Sources:** DevOps
- **Location:** Phase 2 lines 89–92, Risk Mitigation line 124.
- **Description:** HarfBuzz WASM, regl, and SDF tooling are added with no exact versions and no pinning strategy — violates §1 "pin all tool versions… No `latest`." The HarfBuzz `.wasm` has no stated provenance: built-in-CI (from what pinned source SHA + Emscripten version) vs. vendored binary (with checksum). A `.wasm` blob with no source commit is both a reproducibility hole and a supply-chain vector. (Memory note `project_hb_gpu_readiness` references hb-gpu 14.2 — not cited in the spec.)
- **Recommended fix:** Add a Dependencies section pinning each package to an exact version in `package.json`/`pnpm-lock.yaml`; decide and document vendored-binary (checked-in `.wasm` + source SHA + Emscripten version + SHA-256 verified in CI) vs. built-in-CI (pinned source SHA + toolchain in the dev container). Confirm the new deps flow through the frontend CI change-detection filter.

### RF-012 — WebGL2 is untestable in headless CI as specified
- **Status:** open · **Sources:** DevOps
- **Location:** Risk Mitigation line 126 ("Tested on modern browsers"), acceptance line 118.
- **Description:** CI runs headless with no GPU. "Tested on modern browsers" is a manual statement, not a gate. WebGL2 in headless CI needs a software rasterizer (SwiftShader via headless Chromium/ANGLE), and "render identically" implies pixel/snapshot comparison needing a deterministic backend + tolerance.
- **Recommended fix:** Specify the headless WebGL2 strategy: rasterizer (SwiftShader recommended), version-pinned in the dev container + CI, snapshot comparison with a pinned tolerance, and which criteria are CI-gated vs. manual-only.

### RF-013 — Performance acceptance criteria are non-measurable
- **Status:** open · **Sources:** Data Scientist, DevOps, Architect
- **Location:** lines 112–116.
- **Description:** "<10ms per frame" (line 114) is 100fps — inconsistent with the project's 60fps/16.6ms bar — and gives no node count, no glyph count, no "complex layout" definition or baseline. "Maintains current performance" cites no current number. "Bounded by glyph cache limits" is circular (RF-007). No bundle-size budget for shipping a WASM shaper.
- **Recommended fix:** Restate each as a numeric, reproducible benchmark tied to the project bars (e.g. "1000 text nodes totaling ≥50k shaped glyphs at ≥60fps on the reference container profile"), establish the Canvas-2D baseline first, and add a gzipped bundle-size budget + CI size check (state whether the `.wasm` is lazy-loaded and whether HarfBuzz is subsetted).

---

## Medium

### RF-014 — Wrong constant name and unit
- **Status:** open · **Sources:** panel-wide
- **Location:** line 19.
- **Description:** `MAX_TEXT_CONTENT_LENGTH` does not exist; the constant is `MAX_TEXT_CONTENT_LEN` (`validate.rs:12`), and it bounds **bytes** (`content.len()`), not "characters." Multi-byte UTF-8 (CJK/emoji) has a far lower character ceiling — relevant to glyph-cache and shaping cost models.
- **Recommended fix:** Rename and change "characters" → "bytes (UTF-8)."

### RF-015 — Recursion Safety is self-contradictory and invented
- **Status:** open · **Sources:** Logic, Compliance, BE
- **Location:** lines 47–49.
- **Description:** Line 47 says shaping is "iterative, not recursion"; line 49 then asserts "Maximum nesting depth for complex ligature expansion: 10 levels." OpenType GSUB ligature substitution is a flat buffer pass, not recursive nesting — there is no depth to bound, and §10 requires a named constant + the error on exceed (neither given).
- **Recommended fix:** Remove the invented depth limit, or, if a real bounded loop exists in the integration, name the loop, its constant, and its overflow behavior.

### RF-016 — WASM Compatibility Checklist misframed for a frontend-only feature
- **Status:** open · **Sources:** Architect, Compliance
- **Location:** lines 9–14.
- **Description:** §10's WASM checklist protects `sigil-core` compiling to `wasm32-unknown-unknown`. Since this work is frontend-only, that checklist is the wrong one; line 11 ("WebGL… compatible with wasm32-unknown-unknown") is a category error (WebGL is a JS/browser API, not a Rust crate). HarfBuzz-WASM is a browser asset with no evidence link or version.
- **Recommended fix:** Replace with: "No new `sigil-core` dependency; zero `wasm32-unknown-unknown` Rust deps added. HarfBuzz WASM and WebGL are browser-side frontend assets and do not touch core." Document the HarfBuzz dep separately (version + evidence) per RF-011.

### RF-017 — Feature toggles: no WAI-ARIA pattern, label association, or keyboard contract
- **Status:** open · **Sources:** A11y
- **Location:** line 108, Phase 3 lines 94–96.
- **Description:** Feature toggles are interactive controls but the spec names no role/state (`aria-pressed`/`aria-checked`), no accessible name for abbreviated OT tags (`liga` needs "Standard ligatures"), and no keyboard operation. If grouped under a header, the Disclosure pattern applies.
- **Recommended fix:** Name the pattern (Toggle/checkbox group, optionally in a Disclosure section); full-text accessible names for tags; Tab/Space activation; `createUniqueId()` for `aria-controls`. Mandate Kobalte wrappers per the wrapper rule.

### RF-018 — Feature-detection display risks `aria-live` flooding
- **Status:** open · **Sources:** A11y
- **Location:** line 109, Phase 1 line 87.
- **Description:** "Show which OT features a font supports" changes on every font/selection change — the transient-mount/state-label hazards the aria-live-scoping rule warns against.
- **Recommended fix:** Represent availability as control *state* on each toggle (`aria-disabled` + full-text reason), not a live region. Any one-shot "Font X supports N features" announcement goes through a single persistent app-level `role="status"` whose text is replaced, not re-mounted.

### RF-019 — UI-rewrite a11y audit + behavioral inventory of `renderer.ts` omitted
- **Status:** open · **Sources:** A11y, Architect
- **Location:** Overview, Phase 4 line 100; `frontend/src/canvas/renderer.ts`.
- **Description:** This is a renderer rewrite. The a11y "Accessibility Behavior Must Be Audited During UI Rewrites" rule and the §11 "Behavioral Inventory Before Deleting or Rewriting Implementation Code" rule both require an explicit inventory of the outgoing code (canvas accessible name, text-alternative path, focus/keyboard handlers; and the measured-text bounds for hit-testing/selection from 11a/11b) — each preserved or removed-with-rationale. The spec mandates neither.
- **Recommended fix:** Add the audit/inventory obligation as an acceptance criterion; list the behaviors the WebGL path must preserve (hit-test bounds, caret positioning, devicePixelRatio/zoom handling, canvas accessible name).

### RF-020 — "Fallback with warning" underspecified
- **Status:** open · **Sources:** UX, FE
- **Location:** Risk Mitigation line 127, Consistency line 37.
- **Description:** "With warning" never says what/where/how often. A per-node warning floods toasts/`aria-live` (banned by the aria-live rule); a silent console log violates "Handlers Must Surface Failures to the User." Decision granularity (load-time vs per-frame) is also unspecified — per-frame flips flicker.
- **Recommended fix:** Specify per-font fallback decided at font-load and cached; one coalesced document-level notice ("Advanced typography unavailable on this device") in a single persistent `role="status"`, shown once per session, not per node.

### RF-021 — OpenType feature UI interaction model unspecified
- **Status:** open · **Sources:** UX, FE
- **Location:** line 108, Phase 3.
- **Description:** One line is the entire UX spec for a substantial new panel surface — no affordance (per-feature checkboxes? presets? raw `font-feature-settings` field?), no reuse of `TypographySection.tsx`'s control vocabulary, no Figma/Penpot reference. Both Figma and Penpot expose OT features as a curated list of *named* features, not raw 4-char tags.
- **Recommended fix:** Add an "OpenType Feature UI" section: curated named-feature toggles (matching Figma/Penpot) with a raw string escape hatch; reuse existing `ToggleButton`/segmented-control components; specify panel placement, keyboard, and ARIA; wire to the client HistoryManager (see RF-024).

### RF-022 — Feature-detection surfacing UX unspecified
- **Status:** open · **Sources:** UX
- **Location:** line 109.
- **Description:** No spec for how supported-vs-unsupported features are shown (hidden? disabled? greyed?), nor what happens to an enabled feature when the font swaps to one lacking it (silent no-op is banned by §11).
- **Recommended fix:** Show the full list with unsupported features visibly disabled + tooltip ("Not available in <font>"), per Figma. On font change, preserve the setting but show it inactive with an explanation — never silently drop.

### RF-023 — PDR section mis-titled and incomplete
- **Status:** open · **Sources:** Compliance
- **Location:** lines 23–31.
- **Description:** §10 mandates a section titled "PDR Traceability" with implemented + deferred PDR features (with rationale) AND an MVP-coverage clause. The spec's "PDR Cross-Reference" lists feature *names* with no IDs and omits the MVP-coverage statement.
- **Recommended fix:** Rename to "PDR Traceability," add concrete PDR references, and add the MVP-coverage clause.

### RF-024 — New panel controls lack landmark/focus-model/keyboard/undo spec
- **Status:** open · **Sources:** A11y, FE
- **Location:** lines 108–109, Phase 3.
- **Description:** §5 requires landmark roles + keyboard-navigable controls as part of "done." The new feature-toggle list has no landmark statement, no focus model (flat Tab vs roving tabindex for a long list), no keyboard-operability tests, and no mention of HistoryManager/undo wiring (required in the same PR for user-mutatable fields).
- **Recommended fix:** Confirm the controls sit in the existing `role="complementary"` typography panel; specify focus model (Disclosure sections for long lists so collapsed groups leave tab order); require keyboard tests; wire toggles to the client HistoryManager with gesture coalescing.

### RF-025 — Persisted feature settings make `TextStyle` a validated type
- **Status:** open · **Sources:** BE, FE
- **Location:** node.rs `TextStyle` (currently `#[derive(Deserialize)]`, public fields); `tests/fixtures/parity/`.
- **Description:** Conditional on RF-001. Once `TextStyle` carries a validated field, it must drop `#[derive(Deserialize)]` for a manual `Deserialize` routed through a validating constructor with private fields (follow the existing `TextShadow` precedent in the same file), add a parity fixture, and update the TS exhaustiveness sentinel (`document-discriminated-unions.test-d.ts`) + `apply-remote.ts` `kind.text_style.font_features` handler.
- **Recommended fix:** State the `TextStyle` migration to a validated type, the parity-fixture obligation, and the sentinel/handler updates in the plan.

### RF-026 — Dev-container/toolchain + WebGL-unavailable test path unspecified
- **Status:** open · **Sources:** DevOps
- **Location:** Phase 1 line 86, Phase 2 line 91 ("SDF tooling"); `.devcontainer/`.
- **Description:** If HarfBuzz is built in CI, the dev container needs pinned Emscripten; if WebGL is tested headless, it needs pinned SwiftShader/ANGLE + Chromium — none named, guaranteeing host/CI drift. SDF tooling (build-time msdf-atlas-gen vs runtime) is named but unspecified (also touches the §11 `Math.sqrt` domain-guard rule for runtime distance fields). The WebGL2-unavailable detection predicate and its fallback test are missing.
- **Recommended fix:** Add a Dev-container/toolchain section pinning every new tool; choose build-time vs runtime SDF (with provenance per RF-011); specify the WebGL2-absent detection (`getContext('webgl2')` null, `webglcontextlost`) and a CI test forcing fallback.

### RF-027 — Cross-client layout parity not guaranteed
- **Status:** open · **Sources:** Data Scientist, UX
- **Location:** lines 71–76 (runtime renderer choice), Consistency line 43.
- **Description:** Render choice is client-local, but two clients with different WebGL capability rendering the same document could show divergent text geometry (one HarfBuzz-shaped, one Canvas-2D-shaped) with no document-state difference to reconcile — collaboration desync of layout.
- **Recommended fix:** Add to Consistency Guarantees: renderer choice is client-local, and shaped output (advances, line breaks) MUST be identical across backends for the same `TextStyle` (tie to RF-002's single-shaper resolution), or document the tolerated divergence.

---

## Minor

### RF-028 — Phases estimated in calendar weeks
- **Status:** open · **Sources:** Compliance
- **Location:** lines 84–102. Replace "Week 1"/"Weeks 2-3" with phase deliverables and acceptance gates (this repo scopes by deliverable, not wall-clock).

### RF-029 — Incorrect attribution of the text type
- **Status:** open · **Sources:** Architect, Compliance
- **Location:** line 140 ("`NodeKind::Text` variant defined in this spec"). The variant was defined in 11b, not here. Correct the attribution.

### RF-030 — Irrelevant Send/Sync bullet
- **Status:** open · **Sources:** Compliance
- **Location:** line 13. `Send`/`Sync` are Rust trait bounds; meaningless for a frontend-only TypeScript feature. Remove or re-scope.

---

## Notes for any future remediation

- The single highest-leverage decision is **RF-001**: where OpenType feature settings live. It determines whether the entire Transport Boundary Inventory (RF-005), the `TextStyle` validated-type migration (RF-025), and the feature-toggle UX/a11y findings (RF-017, RF-021, RF-024) are in scope.
- **RF-002 + RF-004 + RF-027** are one design knot: make HarfBuzz the single shaping/measurement source of truth so layout geometry is backend-independent, then the "identical rendering," "hybrid topology," and "cross-client parity" questions all resolve together.
- **RF-003** (canvas text alternative) is independent and must be designed regardless of the above.
