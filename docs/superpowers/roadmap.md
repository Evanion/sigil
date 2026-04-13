# Sigil Roadmap

> Last updated: 2026-04-13

## Spec Status

| Spec | Title | Status | Notes |
|------|-------|--------|-------|
| 00 | Toolchain Setup | ✅ Done | |
| 01 | Core Engine | ✅ Done | 7 plans, all merged |
| 02 | Server | ✅ Done | GraphQL migration complete |
| 03 | MCP Server | ✅ Done | Tools + resources shipped |
| 04 | Frontend Editor | ✅ Done | Canvas, tools, interactions |
| 05 | Bindings & CLI | ⚠️ Scaffolded | Stubs only — build as plugins in M4 |
| 06 | Container & DevOps | ⚠️ Partial | Dockerfile done, scope narrowing to headless-only (ADR-001) |
| 07 | Component Library | ✅ Done | All inputs, overlays, navigation |
| 08 | Solid Shell + Panels | ✅ Done | Schema-driven panel system |
| 09 | Properties Panel | ✅ Done | Style mutations, color picker, panel UI |
| 09d | Gradient Editing | ⚠️ In review | PR #52 open |
| 10 | Layers + Pages + DnD | ✅ Done | Layers + pages panel shipped |
| 11a | Viewport Interactions | ✅ Done | Resize, snap, multi-select, align, group (PRs #33, #34, #35) |
| 11b | Text Tool | ✅ Done | PR #46 merged |
| 12 | i18n | ✅ Done | PR #51 merged, 3 locales |
| 15 | Undo/Redo Redesign | ✅ Done | Client-side HistoryManager (PRs #36–#39) |

## Architecture Decisions

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](../architecture/adr-001-deployment-and-mcp.md) | Desktop-first deployment with Tauri and MCP discovery | Accepted |
| [ADR-002](../architecture/adr-002-plugin-system.md) | WASM plugin system for community extensibility | Accepted |

---

## Milestone 1: "Actually Usable Editor"

**Goal:** A designer can open Sigil, create shapes, move/resize them, style them, and it feels like a real tool — not a demo.

**Why first:** Everything else (tokens, components, export) requires a working canvas editor as the foundation. The undo system must be reliable for all editing operations.

| # | Item | Type | Depends on | Effort | Status |
|---|------|------|-----------|--------|--------|
| 1.0 | **Undo/redo system redesign** | Spec 15 | Spec 02 | L | ✅ Done |
| 1.1 | **Viewport interactions** | Spec 11a | — | L | ✅ Done |
| 1.2 | **Pages panel** — CRUD, thumbnails, navigation, reorder | Plan 10c | — | M | ✅ Done |
| 1.3 | **i18n framework** | Spec 12 | — | S | ✅ Done |
| 1.4 | **Gradient fill editing** — stop editor, linear/radial controls | Spec 09d | Spec 09 | M | ⚠️ In review |
| 1.5 | **Text tool** — create, edit, canvas display + HTML overlay, typography | Spec 11b | — | L | ✅ Done |

**Exit criteria:** User can create a multi-page document, draw shapes, move/resize with snapping, apply solid + gradient fills, strokes, effects, manage layers/pages, and reliably undo/redo all operations.

---

## Milestone 2: "Design System Tool"

**Goal:** Token references, components, and export — the features that separate a design tool from a drawing app.

**Why second:** Competitive intel says components + tokens are non-negotiable for professional use. This milestone makes Sigil useful for design systems work.

| # | Item | Type | Depends on | Effort |
|---|------|------|-----------|--------|
| 2.1 | **Token references in fields** — binding UX, display, type classification, expressions | New spec (13) | — | L |
| 2.2 | **Corner shape types** — elliptical, chamfer, bevel, notch, scoop, superellipse | New spec (14) | — | M |
| ~~2.3~~ | ~~**Bindings & CLI**~~ — moved to M4 (4.10). Build as plugins, not hardcoded. | — | — | — |
| 2.4 | **P3 color space** — sRGB↔P3 gamut mapping matrices | Enhancement to color-math.ts | Spec 09 | S |
| 2.5 | **Per-fill opacity + effect visibility toggle** — small UX fixes | Enhancement to panels | — | S |

**Exit criteria:** User can create tokens, bind them to properties, see token refs in fields, and use the full range of corner shapes. (Token export via CSS/Tailwind moves to M4 as plugins.)

---

## Milestone 3: "Ship-Ready Desktop App"

**Goal:** Sigil is a polished, accessible, native desktop application with a distinctive visual identity that users install and agents discover automatically.

**Why now:** The editor features from M1 and M2 need a proper distribution vehicle. Shipping as a Tauri app unlocks native MCP (stdio transport), OS integration, and offline use. All subsequent milestones benefit from the native MCP experience. The visual identity must be established before first public release — first impressions of a native app are permanent.

| # | Item | Type | Depends on | Effort |
|---|------|------|-----------|--------|
| 3.1 | **Visual identity + design language** — distinctive UI theme, typography, surfaces, motion. Establish what makes Sigil look like Sigil, not a generic Figma clone. | New spec | M1 | L |
| 3.2 | **Tauri shell** — webview integration, entry point routing, IPC bridge | New spec (ADR-001) | M1, M2 | L |
| 3.3 | **MCP transport modes** — stdio sidecar, in-app HTTP, headless HTTP | New spec (ADR-001) | Spec 03 | M |
| 3.4 | **MCP discovery** — installer registration + well-known manifest | New spec (ADR-001) | 3.2, 3.3 | M |
| 3.5 | **Sidecar ↔ app IPC** — sidecar connects to running instance for live state | New spec (ADR-001) | 3.2, 3.3 | M |
| 3.6 | **Design/Inspect tab layout** — vertical tabs, avoid tabs-over-tabs | UX redesign | 3.1 | M |
| 3.7 | **Toolbar placement** — finalize position (left/bottom/top) | UX decision | 3.1 | S |
| 3.8 | **ColorArea dual ARIA slider** — a11y compliance | A11y fix | — | S |
| 3.9 | **Autosave/crash recovery** — dirty detection, periodic persist | New spec | Spec 02 | M |
| 3.10 | **Time-to-first-wow** — sample workfiles, templates, guided flow | New spec | M1+M2 | M |
| 3.11 | **Canvas accessibility** — screen reader access to design tree | New spec | — | L |
| 3.12 | **Docker headless mode** — strip frontend serving, MCP HTTP only | Spec 06 update | 3.3 | S |
| 3.13 | **Auto-update** — Tauri updater configuration, release pipeline | New spec | 3.2 | M |
| 3.14 | **Mock store extraction** — test util dedup | Refactor | — | S |

**Exit criteria:** Users install Sigil as a native desktop app with a distinctive, polished visual identity. AI tools discover Sigil's MCP server automatically. `sigil --mcp-stdio` works as a sidecar. Docker image serves headless/CI use cases. Accessibility audit passes WCAG 2.2 AA. A new user can follow a guided flow and produce something useful within 5 minutes.

---

## Milestone 4: "Extensible Platform"

**Goal:** A plugin system that lets the community extend Sigil with new capabilities — import formats, linting tools, custom panels, agent-accessible tools — without rebuilding from source.

**Why before M5:** Platform features like import/export, git merge UX, and advanced MCP tools can be built as plugins rather than hardcoded. Building the plugin system first means M5 features validate the plugin architecture and ship as examples for community developers.

| # | Item | Type | Depends on | Effort |
|---|------|------|-----------|--------|
| 4.1 | **Plugin API crate** — `Plugin` trait, `PluginContext`, registration APIs | New spec (ADR-002) | M3 | L |
| 4.2 | **WASM plugin host** — Wasmtime embedding, sandboxing, instance lifecycle | New spec (ADR-002) | 4.1 | L |
| 4.3 | **Plugin package format** — `.sigil-plugin` archive, manifest schema, loader | New spec (ADR-002) | 4.1, 4.2 | M |
| 4.4 | **Permission system** — capability-based permissions, install-time approval | New spec (ADR-002) | 4.3 | M |
| 4.5 | **Frontend plugin slots** — panel containers, toolbar regions, canvas overlays, context menus | New spec (ADR-002) | 4.1 | L |
| 4.6 | **Plugin ↔ MCP bridge** — plugins register MCP tools, agents discover plugin capabilities | New spec (ADR-002) | 4.2, Spec 03 | M |
| 4.7 | **Plugin storage** — scoped key-value store per plugin | New spec (ADR-002) | 4.2 | S |
| 4.8 | **Plugin hot-swap** — install, load, unload, update without restart | New spec (ADR-002) | 4.2, 4.3 | M |
| 4.9 | **Plugin SDK + example plugins** — project template, build tooling, local testing harness | New spec | 4.1–4.8 | L |
| 4.10 | **Bindings as plugins** — CSS custom props + Tailwind config export built on the plugin API | Spec 05 (ADR-002) | 4.1–4.8 | M |
| 4.11 | **CLI plugin host** — `sigil-cli` loads export plugins, runs token export headless | Spec 05 | 4.3, 4.10 | S |

**Exit criteria:** A developer can build a plugin in Rust/WASM + TypeScript, package it as `.sigil-plugin`, and a designer can install it at runtime. The plugin can register panels, MCP tools, and event handlers. CSS and Tailwind export ship as first-party plugins, validating the plugin architecture. The CLI can load export plugins for headless token export.

---

## Milestone 5: "Ecosystem"

**Goal:** Agent-native, interoperable, community-driven. The features that make Sigil a living platform.

| # | Item | Type | Depends on | Effort |
|---|------|------|-----------|--------|
| 5.1 | **Git conflict/merge UX** — three-way merge for .sigil workfiles | New spec | Spec 02 | XL |
| 5.2 | **Agent onboarding** — versioned guides per host (Cursor, Claude, etc.) | New spec | Spec 03, M3 | M |
| 5.3 | **MCP tool parity** — implement remaining Spec 03 tools or narrow scope | Enhancement | Spec 03 | L |
| 5.4 | **MCP injection/security** — hostile content in names, assets | Security audit | Spec 03 | M |
| 5.5 | **Import/interop** — Figma, Penpot, SVG import (built as plugins) | Plugin | M4 | XL |
| 5.6 | **Dockable panels** — A/B test fixed vs customizable layouts | New spec | Spec 08 | L |
| 5.7 | **Plugin distribution** — signing, marketplace or registry, version compat | New spec | M4 | L |
| 5.8 | **Dogfooding** — recreate Sigil UI as a .sigil workspace in the repo | Ongoing | M1+M2 | M |

**Exit criteria:** Agents can fully operate the tool via MCP. Users can import existing designs. Git workflows feel native. Community plugins are discoverable and installable. Import formats ship as plugins, validating the plugin architecture.

---

## Effort Key

- **S** = Small (1-2 plans, < 1 day implementation)
- **M** = Medium (2-4 plans, 1-3 days)
- **L** = Large (4+ plans, 3-7 days)
- **XL** = Extra large (multiple specs, 1-2 weeks)

---

## Dependency Graph

```
M1 (Usable Editor) — nearly complete
├── 1.0 Undo/redo ← DONE
├── 1.1 Viewport interactions ← DONE
├── 1.2 Pages panel ← DONE
├── 1.3 i18n ← DONE
├── 1.4 Gradient editing ← IN REVIEW (PR #52)
└── 1.5 Text tool ← DONE

M2 (Design System) ← M1
├── 2.1 Token refs ← M1 (needs working fields)
├── 2.2 Corner shapes ← nothing
├── 2.3 Bindings/CLI ← MOVED TO M4 (4.10, 4.11) — build as plugins
├── 2.4 P3 color ← Spec 09 ✅
└── 2.5 Fill opacity + effect toggle ← Spec 09 ✅

M3 (Desktop App) ← M1, M2
├── 3.1 Visual identity ← M1 (needs all UI surfaces to exist)
├── 3.2 Tauri shell ← M1+M2
├── 3.3 MCP transport modes ← Spec 03 ✅
├── 3.4 MCP discovery ← 3.2, 3.3
├── 3.5 Sidecar IPC ← 3.2, 3.3
├── 3.6–3.7 UX polish ← 3.1 (visual identity informs layout decisions)
├── 3.8 ColorArea a11y ← nothing
├── 3.9 Autosave ← Spec 02 ✅
├── 3.10 Onboarding ← M1+M2
├── 3.11 Canvas a11y ← M1
├── 3.12 Docker headless ← 3.3
├── 3.13 Auto-update ← 3.2
└── 3.14 Mock store ← nothing

M4 (Extensible Platform) ← M3
├── 4.1 Plugin API ← M3
├── 4.2 WASM host ← 4.1
├── 4.3 Package format ← 4.1, 4.2
├── 4.4 Permissions ← 4.3
├── 4.5 Frontend slots ← 4.1
├── 4.6 Plugin ↔ MCP bridge ← 4.2, Spec 03 ✅
├── 4.7 Plugin storage ← 4.2
├── 4.8 Hot-swap ← 4.2, 4.3
├── 4.9 SDK + examples ← 4.1–4.8
├── 4.10 Bindings as plugins ← 4.1–4.8 (Spec 05)
└── 4.11 CLI plugin host ← 4.3, 4.10

M5 (Ecosystem) ← M4
├── 5.1 Git merge ← Spec 02 ✅
├── 5.2 Agent onboarding ← Spec 03 ✅, M3
├── 5.3 MCP parity ← Spec 03 ✅
├── 5.4 MCP security ← Spec 03 ✅
├── 5.5 Import/interop ← M4 (built as plugins)
├── 5.6 Dockable panels ← Spec 08 ✅
├── 5.7 Plugin distribution ← M4
└── 5.8 Dogfooding ← M1+M2
```

## Next Actions

1. **Merge PR #52 (Gradient editing)** — last M1 item
2. **Brainstorm Spec 13 (Token references)** — first M2 item
3. **Brainstorm Spec 14 (Corner shapes)** — parallelizable with 13
