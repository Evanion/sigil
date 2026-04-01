# Competitive Analysis: Sigil vs Figma vs Penpot vs Paper.design

*Last updated: 2026-04-01*

## Positioning Overview

| Tool | Model | Core Differentiator |
|---|---|---|
| **Figma** | Cloud SaaS, proprietary | Market leader, vast ecosystem, AI features (Make, Buzz, Sites) |
| **Penpot** | Open source, self-hosted or cloud | CSS-native (Flexbox/Grid), open standards (SVG/HTML/CSS), native design tokens |
| **Paper.design** | Cloud, open alpha | HTML/CSS canvas (code-is-the-design), AI agent integration via MCP, shader effects |
| **Sigil** | Local-first, container-based | Agent-native (MCP), git-diffable workfiles, hierarchical token inheritance, no cloud dependency |

## Feature Comparison Matrix

### Design Primitives

| Feature | Figma | Penpot | Paper | Sigil (MVP) | Gap? |
|---|---|---|---|---|---|
| Vector shapes (rect, ellipse, polygon) | Yes | Yes | Yes (HTML elements) | Yes | - |
| Pen tool / bezier paths | Yes | Yes | Limited | Yes | - |
| Boolean operations | Yes | Yes | No | Yes | - |
| Text tool | Yes | Yes | Yes (real HTML text) | Yes | - |
| Image support | Yes | Yes | Yes | Yes | - |
| Illustration brushes | Yes (Figma Draw) | No | No | No | Consider post-MVP |
| Text on a path | Yes (Figma Draw) | No | No | No | Post-MVP |
| Pattern fills | Yes (Figma Draw) | No | Shader library | No | Post-MVP |
| Dynamic stroke effects | Yes (Figma Draw) | No | No | No | Post-MVP |
| GPU shader effects | No | No | Yes (unique) | No | Not in scope |

### Layout System

| Feature | Figma | Penpot | Paper | Sigil (MVP) | Gap? |
|---|---|---|---|---|---|
| Auto-layout (Flexbox) | Yes | Yes (CSS Flexbox) | Yes (real CSS) | Yes (Taffy) | - |
| CSS Grid | Yes (new) | Yes (CSS Grid) | Yes (real CSS) | No | **Add post-MVP** |
| Absolute positioning / constraints | Yes | Yes | Yes | Yes (pinning) | - |
| Responsive breakpoints | Yes (Figma Sites) | Limited | Yes | No | Post-MVP |

### Component System

| Feature | Figma | Penpot | Paper | Sigil (MVP) | Gap? |
|---|---|---|---|---|---|
| Components | Yes | Yes | Yes (web components) | Yes | - |
| Component variants | Yes | Yes | Unknown | No | **Consider for MVP** |
| Component properties | Yes | Yes | Unknown | Yes (overrides) | - |
| Instance overrides | Yes | Yes | Unknown | Yes | - |
| Nested components | Yes | Yes | Unknown | Yes | - |
| Component library sharing | Yes | Yes | Unknown | Yes (inheritance) | - |

### Design Tokens & Styles

| Feature | Figma | Penpot | Paper | Sigil (MVP) | Gap? |
|---|---|---|---|---|---|
| Design tokens | Yes (Variables) | Yes (native, first-to-market) | Yes (synced) | Yes (W3C format) | - |
| Color styles | Yes | Yes | Yes | Yes (via tokens) | - |
| Typography styles | Yes | Yes | Yes | Yes (via tokens) | - |
| Token inheritance/scoping | Yes (modes/collections) | Unknown | Unknown | Yes (hierarchical workfiles) | **Unique advantage** |
| Token export/sync | Plugin-based | Built-in CSS | Built-in (Tailwind) | CLI + bindings | - |
| Multi-color-space support | Limited | No | Unknown | Yes (sRGB, P3, OKLCH, OKLAB) | **Unique advantage** |

### Prototyping

| Feature | Figma | Penpot | Paper | Sigil (MVP) | Gap? |
|---|---|---|---|---|---|
| Click-through prototyping | Yes | Yes | Limited | Yes | - |
| Interactive animations | Yes (Smart Animate) | Yes (animated transitions) | Unknown | No (deferred) | Post-MVP |
| Overlays | Yes | Yes | Unknown | No | Post-MVP |
| Scroll behavior | Yes | Yes | Unknown | No | Post-MVP |
| Stateful prototypes (variables) | Yes | No | Unknown | No (deferred) | Post-MVP |
| Publish as web app | Yes (Figma Sites) | No | Unknown | No | Post-MVP |

### Collaboration

| Feature | Figma | Penpot | Paper | Sigil (MVP) | Gap? |
|---|---|---|---|---|---|
| Real-time multi-user editing | Yes | Yes | Yes | No (Tier 1 = single user) | Tier 2 |
| Commenting | Yes | Yes | Unknown | No | Post-MVP |
| Version history | Yes | Yes | Yes | Git-based | Different approach |
| Branching | Yes (Figma Branching) | No | Unknown | Git branches | **Unique advantage** |
| Design review workflow | Yes | Limited | Unknown | No (Tier 3) | Tier 3 |

### Developer Handoff

| Feature | Figma | Penpot | Paper | Sigil (MVP) | Gap? |
|---|---|---|---|---|---|
| Inspect mode / Dev Mode | Yes (Dev Mode) | Yes (Inspect tab) | N/A (code IS design) | No | **Consider post-MVP** |
| CSS export | Yes | Yes (native CSS) | Yes (real CSS) | Via token bindings | Different approach |
| Code Connect (link to production code) | Yes | No | Yes (MCP) | Via MCP | Similar to Paper |
| React/component code export | Plugin-based | No | Yes (React, Tailwind) | Via bindings + agent | - |
| Design-to-code (AI) | Yes (Figma Make) | No | Yes (native) | Agent-driven | Different approach |

### AI & Agent Integration

| Feature | Figma | Penpot | Paper | Sigil (MVP) | Gap? |
|---|---|---|---|---|---|
| MCP server | Yes (read + write) | Community fork | Yes (first-class) | Yes (first-class) | - |
| AI image generation | Yes | No | Yes (Flux, Gemini, OpenAI) | No | **Consider post-MVP** |
| AI vectorization | Yes (Vectorize) | No | No | No | Post-MVP |
| Prompt-to-design | Yes (Figma Make) | No | Yes (via agents) | Yes (via agents) | - |
| Prompt-to-code | Yes (Figma Make → web apps) | No | Yes (native) | Via frontend agent | Different approach |
| Agent as equal partner | No (AI assists) | No | Partial (MCP) | Yes (core design) | **Unique advantage** |
| Visual snapshot for agents | Unknown | No | Yes (screenshot MCP) | Yes (Snapshot tool) | - |

### File Format & Deployment

| Feature | Figma | Penpot | Paper | Sigil (MVP) | Gap? |
|---|---|---|---|---|---|
| Open file format | No (proprietary) | Yes (SVG-based) | No | Yes (JSON, git-diffable) | **Unique advantage** |
| Self-hosted | No | Yes (Docker) | No | Yes (Docker) | - |
| Git-native persistence | No | No | No | Yes | **Unique advantage** |
| Offline support | Desktop app | Self-hosted | Desktop app | Local container | - |
| Open source | No | Yes (MPL 2.0) | No | Source-available (BSL) | - |

### Platform & Ecosystem

| Feature | Figma | Penpot | Paper | Sigil (MVP) | Gap? |
|---|---|---|---|---|---|
| Plugin ecosystem | Massive | Growing | Limited | Skills/bindings | Smaller scope |
| Desktop app | Yes | No (web only) | Yes | No (browser to container) | - |
| Mobile app | Yes (mirror) | No | No | No | Post-MVP |
| Multi-language UI | Yes (9 languages) | Limited | No | No | Post-MVP |

## Sigil's Unique Advantages

1. **Git-native file format** — no other tool stores designs as diffable files in git. This enables branching, merging, PR review, and CI/CD for design changes.
2. **Hierarchical token inheritance** — workfiles inherit tokens/components from parent directories, like CSS cascade. No competitor has this.
3. **Agent as equal partner** — not "AI assists human" (Figma) or "code IS design" (Paper), but both human and agent can create from scratch and hand off seamlessly.
4. **Local-first container deployment** — no cloud dependency, runs in dev container stacks alongside the codebase.
5. **Multi-color-space support** — sRGB, Display P3, OKLCH, OKLAB from day one.

## Feature Gaps to Consider

### High Priority (consider for MVP or early post-MVP)

1. **Component variants** — Figma and Penpot both have this. A component with multiple states (default, hover, disabled, etc.) is essential for design systems. Our override system supports it conceptually but we don't have an explicit variant model.
2. **CSS Grid layout** — Penpot and Paper both support this alongside Flexbox. Taffy supports it. Could be added to our layout engine.
3. **AI image generation** — Paper has multi-model support (Flux, Gemini, OpenAI). Figma has it. This is becoming table-stakes for AI-native tools. Could integrate via MCP tools that call external APIs.

### Medium Priority (post-MVP)

4. **Inspect/Dev Mode** — Figma's Dev Mode and Penpot's Inspect tab are heavily used. We rely on agents for code generation, but a visual inspect mode would help human developers.
5. **Animated transitions / Smart Animate** — both Figma and Penpot have this. Our prototype model supports transition types but we need the rendering engine to execute them.
6. **Live data connectors** — Paper connects to APIs/Google Sheets for real content in designs. Interesting differentiator we could support via MCP.
7. **Responsive breakpoints** — Figma Sites and Paper both support this. Important for web design workflows.

### Low Priority (future)

8. **Illustration tools** — Figma Draw (brushes, text on path, pattern fills). Niche but growing.
9. **Publish as website** — Figma Sites publishes designs as responsive websites. Ambitious but far from our MVP.
10. **GPU shader effects** — Paper's unique feature. Not in our scope.

## Sources

- [Figma Release Notes](https://www.figma.com/release-notes/)
- [Figma AI Features 2026 Guide](https://growai.in/figma-ai-features-designers-developers-2026/)
- [Figma Config 2025 Features](https://forum.figma.com/product-updates-3/let-s-talk-about-the-new-features-we-announced-at-config-2025-40301)
- [Penpot GitHub](https://github.com/penpot/penpot)
- [Penpot AI Horizon 2025](https://www.oreateai.com/blog/penpots-ai-horizon-what-to-expect-in-2025-for-open-source-design/60cb2d4078dbd365fd3158cd4524f256)
- [Paper.design MCP Review](https://www.banani.co/blog/paper-design-mcp-review)
- [Paper.design Guide](https://uxpilot.ai/paper-design)
- [Paper Design Review](https://www.designtoolmark.com/blog/article/paper-design-is-this-the-new-home-for-designers)
- [Paper MCP Docs](https://paper.design/docs/mcp)
- [Guide to Paper and Claude Code](https://adplist.substack.com/p/a-guide-to-paper-and-claude-code)
