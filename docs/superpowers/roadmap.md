# Sigil Roadmap

> Last updated: 2026-04-06

## Spec Status

| Spec | Title | Status | Notes |
|------|-------|--------|-------|
| 00 | Toolchain Setup | ✅ Done | |
| 01 | Core Engine | ✅ Done | 7 plans, all merged |
| 02 | Server | ✅ Done | GraphQL migration complete |
| 03 | MCP Server | ✅ Done | Tools + resources shipped |
| 04 | Frontend Editor | ✅ Done | Canvas, tools, interactions |
| 05 | Bindings & CLI | ❌ Not started | CSS + Tailwind export |
| 06 | Container & DevOps | ⚠️ Partial | Dockerfile done, graceful shutdown unverified |
| 07 | Component Library | ✅ Done | All inputs, overlays, navigation |
| 08 | Solid Shell + Panels | ✅ Done | Schema-driven panel system |
| 09 | Properties Panel | ✅ Done | Style mutations, color picker, panel UI |
| 10 | Layers + Pages + DnD | ⚠️ Partial | Layers done, **pages panel not implemented** |

---

## Milestone 1: "Actually Usable Editor"

**Goal:** A designer can open Sigil, create shapes, move/resize them, style them, and it feels like a real tool — not a demo.

**Why first:** Everything else (tokens, components, export) requires a working canvas editor as the foundation. Right now you can create shapes and color them, but you can't resize or move them interactively.

| # | Item | Type | Depends on | Effort |
|---|------|------|-----------|--------|
| 1.1 | **Viewport interactions** — move, resize, snap, align, distribute, multi-select | New spec (11) | — | L |
| 1.2 | **Pages panel** — CRUD, thumbnails, navigation, reorder | Plan 10c (exists) | — | M |
| 1.3 | **i18n framework** — set up before more strings accumulate | New spec (12) | — | S |
| 1.4 | **Gradient fill editing** — stop editor, linear/radial controls | New spec (09d) | Spec 09 | M |

**Exit criteria:** User can create a multi-page document, draw shapes, move/resize with snapping, apply solid + gradient fills, strokes, effects, and manage layers/pages.

---

## Milestone 2: "Design System Tool"

**Goal:** Token references, components, and export — the features that separate a design tool from a drawing app.

**Why second:** Competitive intel says components + tokens are non-negotiable for professional use. This milestone makes Sigil useful for design systems work.

| # | Item | Type | Depends on | Effort |
|---|------|------|-----------|--------|
| 2.1 | **Token references in fields** — binding UX, display, type classification, expressions | New spec (13) | — | L |
| 2.2 | **Corner shape types** — elliptical, chamfer, bevel, notch, scoop, superellipse | New spec (14) | — | M |
| 2.3 | **Bindings & CLI** — CSS custom props, Tailwind config export | Spec 05 (exists, no plans) | Spec 01 | M |
| 2.4 | **P3 color space** — sRGB↔P3 gamut mapping matrices | Enhancement to color-math.ts | Spec 09 | S |
| 2.5 | **Per-fill opacity + effect visibility toggle** — small UX fixes | Enhancement to panels | — | S |

**Exit criteria:** User can create tokens, bind them to properties, see token refs in fields, export to CSS/Tailwind, and use the full range of corner shapes.

---

## Milestone 3: "Ship-Ready Polish"

**Goal:** The UX feels polished, accessible, and professional. Onboarding works. Agent workflows are smooth.

| # | Item | Type | Depends on | Effort |
|---|------|------|-----------|--------|
| 3.1 | **Design/Inspect tab layout** — vertical tabs, avoid tabs-over-tabs | UX redesign | — | M |
| 3.2 | **Toolbar placement** — finalize position (left/bottom/top) | UX decision | — | S |
| 3.3 | **ColorArea dual ARIA slider** — a11y compliance | A11y fix | — | S |
| 3.4 | **Autosave/crash recovery** — dirty detection, periodic persist | New spec | Spec 02 | M |
| 3.5 | **Time-to-first-wow** — sample workfiles, templates, guided flow | New spec | M1+M2 | M |
| 3.6 | **Canvas accessibility** — screen reader access to design tree | New spec | — | L |
| 3.7 | **Mock store extraction** — test util dedup | Refactor | — | S |

**Exit criteria:** A new user can open the app, follow a guided flow, and produce something useful within 5 minutes. Accessibility audit passes WCAG 2.2 AA.

---

## Milestone 4: "Platform"

**Goal:** Multi-user, agent-native, interoperable. The features that make Sigil a platform, not just a tool.

| # | Item | Type | Depends on | Effort |
|---|------|------|-----------|--------|
| 4.1 | **Git conflict/merge UX** — three-way merge for .sigil workfiles | New spec | Spec 02 | XL |
| 4.2 | **Agent onboarding** — versioned guides per host (Cursor, Claude, etc.) | New spec | Spec 03 | M |
| 4.3 | **MCP tool parity** — implement remaining Spec 03 tools or narrow scope | Enhancement | Spec 03 | L |
| 4.4 | **MCP injection/security** — hostile content in names, assets | Security audit | Spec 03 | M |
| 4.5 | **Import/interop** — Figma, Penpot, SVG import | New spec | Spec 01 | XL |
| 4.6 | **Dockable panels** — A/B test fixed vs customizable layouts | New spec | Spec 08 | L |
| 4.7 | **Dogfooding** — recreate Sigil UI as a .sigil workspace in the repo | Ongoing | M1+M2 | M |

**Exit criteria:** Agents can fully operate the tool via MCP. Users can import existing designs. Git workflows feel native.

---

## Effort Key

- **S** = Small (1-2 plans, < 1 day implementation)
- **M** = Medium (2-4 plans, 1-3 days)
- **L** = Large (4+ plans, 3-7 days)
- **XL** = Extra large (multiple specs, 1-2 weeks)

---

## Dependency Graph

```
M1 (Usable Editor)
├── 1.1 Viewport interactions ← nothing (can start now)
├── 1.2 Pages panel ← Plan 10c exists
├── 1.3 i18n ← nothing (can start now)
└── 1.4 Gradient editing ← Spec 09 ✅

M2 (Design System) ← M1
├── 2.1 Token refs ← M1 (needs working fields)
├── 2.2 Corner shapes ← nothing
├── 2.3 Bindings/CLI ← Spec 01 ✅
├── 2.4 P3 color ← Spec 09 ✅
└── 2.5 Fill opacity + effect toggle ← Spec 09 ✅

M3 (Polish) ← M1, partially M2
├── 3.1 Tab layout ← M1 (needs panels settled)
├── 3.2 Toolbar ← M1
├── 3.3 ColorArea a11y ← nothing
├── 3.4 Autosave ← Spec 02 ✅
├── 3.5 Onboarding ← M1+M2
├── 3.6 Canvas a11y ← M1
└── 3.7 Mock store ← nothing

M4 (Platform) ← M2, M3
├── 4.1 Git merge ← Spec 02 ✅
├── 4.2 Agent onboarding ← Spec 03 ✅
├── 4.3 MCP parity ← Spec 03 ✅
├── 4.4 MCP security ← Spec 03 ✅
├── 4.5 Import/interop ← Spec 01 ✅
├── 4.6 Dockable panels ← Spec 08 ✅
└── 4.7 Dogfooding ← M1+M2
```

## Next Actions

1. **Start Spec 11 (Viewport Interactions)** — the biggest gap for M1
2. **Execute Plan 10c (Pages Panel)** — plan already exists
3. **Brainstorm Spec 12 (i18n)** — quick setup, prevents tech debt
