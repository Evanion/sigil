# Spec 05: Bindings & CLI

> Sub-spec of the [Agent Designer PDR](2026-04-01-agent-designer-design.md)

## Overview

Standalone tooling that generates platform-specific code from Sigil design tokens. One-way flow: Sigil workfiles are the source of truth, generated files are output.

## CLI Tool

```
sigil export --format css --input ./design.sigil/tokens --output ./src/tokens.css
```

- Reads token JSON files from a workfile's `tokens/` directory
- Resolves inheritance (walks parent `.sigil/` directories)
- Generates output in the specified format
- Watch mode: `--watch` flag to regenerate on changes

## MVP Binding Formats

- **CSS custom properties** (`@sigil/css`)
- **Tailwind config** (`@sigil/tailwind`)

## Future Binding Formats (Deferred)

- Swift asset catalogs
- Android resource XML
- Flutter theme data
- Bundler plugins (Vite, Webpack, Turbopack)

## Integration Points

- **CI/CD:** run as a build step, optionally fail if generated output is stale
- **Bundler plugins:** deferred to post-MVP
- **Watch mode:** for development workflow

## Depends On

- Spec 00 (Toolchain)
- Spec 01 (Core Engine — token model and serialization)

## Depended On By

- Nothing (leaf node)
