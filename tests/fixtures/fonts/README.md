# Font classification test fixtures

These are **synthetic, hand-built two-glyph fonts** (`.notdef` + `A`) authored
from scratch by `_generate.py` for Sigil's `classify_font` tests. No third-party
font is copied or subset, so there are **no license restrictions** — treat them
as public-domain test data (same terms as the repository).

| File | `OS/2.fsType` | `ttf-parser` `Permissions` | Expected `EmbedDecision` (UserSupplied) |
|------|---------------|----------------------------|------------------------------------------|
| `installable.ttf` | `0x0000` | `Installable` | `Embed` |
| `editable.ttf` | `0x0008` | `Editable` | `Embed` |
| `restricted.ttf` | `0x0002` | `Restricted` | `ReferenceRestricted` |

All three share: `unitsPerEm = 1000`, family `SigilTest`, PostScript name
`SigilTest-Regular`, ascent `800`, descent `-200`, line-gap `0`, cap-height
`700`, x-height `500`, `xAvgCharWidth = 500`, PANOSE `bFamilyType=2` (Latin
Text) / `bSerifStyle=2` (serif). OS/2 version 4 (mutually-exclusive fsType
interpretation).

A `SystemDirectory`-provenance classification of any of these must yield
`ReferenceSystem` regardless of fsType (provenance overrides permission).

## Regenerating

```sh
python3 -m pip install fonttools
python3 tests/fixtures/fonts/_generate.py
```

The output is deterministic. If `fonttools` changes table-padding behavior the
byte size may shift slightly; the `fsType`/metric values are what the tests
assert, not the file size.
