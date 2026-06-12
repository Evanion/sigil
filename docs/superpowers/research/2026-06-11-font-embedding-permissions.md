# Font Embedding Permissions & Substitution — Research Notes

**Date:** 2026-06-11
**Purpose:** Ground the "embed for portability, don't redistribute proprietary/system fonts, no system-font database" policy for the Font epic.
**Disclaimer:** Engineering research, not legal advice. The binding constraint is each font's EULA; fsType-honoring is the recognized engineering-diligence bar, not a safe harbor.

## OS/2 `fsType` (uint16) — the embeddability signal
Usage sub-field (bits 0–3, mutually exclusive in OS/2 v3+; multi-bit in v0–2 resolved **least-restrictive-wins**):
- `0x0000` **Installable** — embed + permanent install OK. (Apps treat ≈ Editable.)
- `0x0002` **Restricted License** — must NOT embed/modify/exchange without permission. *Only canonical `0x0002` counts as Restricted* (e.g. `0x0006` is not, under least-restrictive).
- `0x0004` **Preview & Print** — embed for temporary view/print; document must be **read-only**.
- `0x0008` **Editable** — embed for temporary use; document may be **read-write**, new text may be set.
- Bit 0 (`0x0001`) is permanently reserved/deprecated — treat as zero.

Modifiers (orthogonal, still apply):
- `0x0100` **No subsetting** — embed the full face or not at all.
- `0x0200` **Bitmap embedding only** — no outlines; if no bitmaps, the font is **unembeddable**.

Spec mandates: apps **must not embed** fonts not licensed to permit it; **must not modify fsType**; must **delete** temporarily-embedded fonts when the doc closes (Preview&Print / Editable). `fonttools subset` preserves fsType unchanged.

## How PDF & OOXML use it
- **PDF:** honors fsType (won't embed forbidden fonts); **subsets by default** (6-char tag prefix `ABCDEF+`); when a font isn't embedded, synthesizes a **metric-compatible substitute** (Adobe Serif/Sans Multiple Master warped to the **font descriptor**: Flags, FontBBox, Ascent/Descent/CapHeight/StemV/MissingWidth, PANOSE, per-glyph Widths) → preserves line breaks without the real font.
- **OOXML (Word/PPT):** honors fsType; Restricted → error/read-only; subset or full ("embed only characters used" vs "all"); embedded font is **obfuscated** (GUID XOR over first 32 bytes — anti-casual-extraction, not DRM); `fontTable.xml` maps names→parts. Mixed Preview&Print + Editable locks the **whole** doc read-only.

## Legal weight / reliability
- fsType is **advisory metadata**, not enforcement; force comes from the EULA, not the bit. Honoring it is documented best-practice diligence (MS Office, Distiller cited as compliant), **necessary but not always sufficient** — a EULA can be more restrictive than fsType conveys, and conversion of system fonts to WOFF is separately prohibited even when embedding is allowed.
- Reliability is **mixed**: many libre/OFL fonts correctly ship `0x0000`; some free fonts mis-mark Restricted; some proprietary mis-mark Installable. → Treat fsType as a **high-signal default that can be wrong both ways**; pair with **provenance** (don't embed OS-system-dir fonts) and **surface the decision to the user** with a responsibility notice (Sketch's model).

## Peer tools
- **Sketch:** embeds font binaries (v53+), auto on Workspace save or per-font in Document Settings; excludes system fonts; pushes license responsibility to the user + takedown path; missing fonts → visible-but-not-editable until install/embed/Replace. (No evidence it auto-gates on fsType — Sigil should be stricter.)
- **Figma / Penpot / XD:** reference-by-name + missing-font remap; no document-embedded binaries (Penpot embeds nothing in the file; bytes in server asset store).
- **Affinity / XD specifics:** embedding-vs-collect unverified / low-confidence.

## Subsetting
- `pyftsubset` (fonttools) and `hb-subset` (HarfBuzz, faster, WASM builds exist — aligns with Sigil's WASM core). Select by `--unicodes`/`--text`/`--glyphs`; `--layout-features` controls which OT features survive; preserves fsType; **must not subset No-subsetting fonts**.
- **Editable-doc hazard:** a subset built from current text lacks glyphs typed later → for an **editable** workfile **embed the full face** (always correct); reserve hard subsetting for **export/print** (frozen text). To re-subset on save you must keep the full font to grow the keep-set (can't grow a subset from a subset).

## Metric-compatible substitution (missing referenced font)
Preserve **layout** over glyph fidelity. Store the original font's metrics in the file (unitsPerEm, ascent/descent/line-gap, cap-height, x-height, italic-angle, PANOSE, advance widths) and retune a local fallback via the **CSS `size-adjust` / `ascent-override` / `descent-override` / `line-gap-override`** model (Chromium 87+/FF 89+) → no layout shift on swap. PANOSE/descriptor matching picks the closest fallback shape.

## Recommended Sigil policy (locked in the Font epic overview)
Embed when fsType ∈ {Installable, Editable} AND not system-provenance; reference-only otherwise (Restricted / Preview&Print / bitmap-only / no-OS2 / system-dir). Full-face embed in the editable `.sigil/` package; library/OFL referenced+refetched; store metrics on every ref for no-reflow fallback; surface the per-font decision + user-responsibility notice; never rewrite fsType; never transcode system fonts.

## Sources
MS OpenType OS/2 spec; Apple TrueType RM06; MS font-redistribution FAQ + license-restrictions; prepressure/Adobe PDF font docs; Adobe third-party font policies; officeopenxml.com + c-rex OOXML font embedding; fonttools subset + HarfBuzz hb-subset; MDN ascent-override/descent-override + web.dev size-adjust + Chrome font-fallbacks; Sketch Document-Settings Fonts; Figma missing-font; Penpot #5195.
