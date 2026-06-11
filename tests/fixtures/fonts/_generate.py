#!/usr/bin/env python3
"""Generate tiny, license-clean synthetic test fonts with known OS/2.fsType values.

These are hand-built two-glyph fonts (.notdef + 'A') authored from scratch for
Sigil's font-classification tests — no third-party font is copied, so there are
no license restrictions on the output (treat as public-domain test fixtures).

fsType values produced (OS/2 version 4 → mutually-exclusive interpretation):
  installable.ttf  fsType=0x0000  -> Permissions::Installable
  editable.ttf     fsType=0x0008  -> Permissions::Editable
  restricted.ttf   fsType=0x0002  -> Permissions::Restricted

Run:  python3 tests/fixtures/fonts/_generate.py
"""
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables.O_S_2f_2 import Panose
import os

UPM = 1000
OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _panose():
    p = Panose()
    # bFamilyType=2 (Latin Text), bSerifStyle=2 (Cove/serif) -> is_serif heuristic true
    p.bFamilyType = 2
    p.bSerifStyle = 2
    p.bWeight = 5
    p.bProportion = 3
    p.bContrast = 0
    p.bStrokeVariation = 0
    p.bArmStyle = 0
    p.bLetterForm = 0
    p.bMidline = 0
    p.bXHeight = 0
    return p


def build(fs_type: int, filename: str) -> None:
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder([".notdef", "A"])
    fb.setupCharacterMap({0x41: "A"})

    notdef = TTGlyphPen(None).glyph()
    a_pen = TTGlyphPen(None)
    a_pen.moveTo((100, 0))
    a_pen.lineTo((400, 0))
    a_pen.lineTo((250, 700))
    a_pen.closePath()
    fb.setupGlyf({".notdef": notdef, "A": a_pen.glyph()})

    fb.setupHorizontalMetrics({".notdef": (600, 0), "A": (500, 100)})
    fb.setupHorizontalHeader(ascent=800, descent=-200, lineGap=0)
    fb.setupNameTable({
        "familyName": "SigilTest",
        "styleName": "Regular",
        "psName": "SigilTest-Regular",
        "fullName": "SigilTest Regular",
    })
    fb.setupOS2(
        version=4,
        fsType=fs_type,
        sTypoAscender=800,
        sTypoDescender=-200,
        sTypoLineGap=0,
        usWinAscent=800,
        usWinDescent=200,
        sxHeight=500,
        sCapHeight=700,
        xAvgCharWidth=500,
        panose=_panose(),
    )
    fb.setupPost()
    path = os.path.join(OUT_DIR, filename)
    fb.save(path)
    print(f"wrote {path} (fsType=0x{fs_type:04x})")


if __name__ == "__main__":
    build(0x0000, "installable.ttf")
    build(0x0008, "editable.ttf")
    build(0x0002, "restricted.ttf")
